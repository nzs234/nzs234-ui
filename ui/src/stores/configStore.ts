// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'
import {
  createDefaultConfig,
  getFieldDefinition,
  getSectionsForType,
  hasSchemaForType,
  normalizeDraftValue,
} from '@/schema/schemaIndex.js'
import { trainApi, type TrainDraftsPayload } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import type { TrainDraftConflictPayload } from '@/api/trainApi'
import {
  UNKNOWN_DRAFT_REVISION,
  isDraftRevisionConflict,
  readDraftConflictRevision,
  readDraftRevision,
} from '@/features/training/draftRevision'
import { translate } from '@/i18n/useI18n'

/* 训练配置草稿:按训练类型分 draft; localStorage + 磁盘双写 */

const LS_KEY = 'lx-train-drafts-v1'
const DISK_DEBOUNCE_MS = 900
const LS_DEBOUNCE_MS = 400
const DEFAULT_TYPE_ID = 'anima-lora'

interface Persisted {
  typeId?: string
  updated_at?: number
  drafts?: Record<string, Record<string, unknown>>
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Persisted
  } catch {
    return {}
  }
}

function writeLocal(state: { typeId: string; drafts: Record<string, Record<string, unknown>> }) {
  try {
    const prev = loadPersisted()
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        typeId: state.typeId,
        updated_at: Date.now(),
        drafts: { ...prev.drafts, ...state.drafts },
      }),
    )
  } catch {
    /* 空间不足等,忽略 */
  }
}

/* ------------------------------------------------------------------ *
 * per-type 归一化
 * ------------------------------------------------------------------ */

/**
 * 不是 schema 字段、但 buildRunConfig / isFieldVisible 仍会读取的键。
 * 清理外来脏字段时必须原样留下,否则等于悄悄改了运行配置规则:
 * - semantic_* 三键由 runConfigBuilder 直接从 config 透传(资源中心写入,非 schema)。
 * - anima_attn_mode 被 isFieldVisible 的 requiresAttentionBackend 门控读取,
 *   但任何 schema 都没有定义它(仅存在于 legacy 配置里)。
 */
const PRESERVED_NON_SCHEMA_KEYS = new Set([
  'semantic_region_weighting_enabled',
  'semantic_segmentation_provider',
  'semantic_segmentation_model_path',
  'anima_attn_mode',
])

// applyBackendConfigOptions 只改已有字段的 options,不增删 key,所以这份缓存
// 不需要跟着 schemaRev 失效。
const schemaKeyCache = new Map<string, Set<string>>()

/** 目标类型 schema 的全部字段键(含 hidden / ui_group)。 */
function schemaKeysForType(typeId: string): Set<string> {
  const cached = schemaKeyCache.get(typeId)
  if (cached) return cached
  const keys = new Set<string>()
  for (const section of getSectionsForType(typeId) || []) {
    for (const field of section.fields || []) {
      if (field?.key) keys.add(field.key)
    }
  }
  schemaKeyCache.set(typeId, keys)
  return keys
}

/**
 * quant_train_mode 曾是下拉(dequant / keep_w8 字符串),现在是布尔开关。
 * 必须在 normalizeDraftValue 之前映射:该字段现在的 type 是 boolean,
 * Boolean('dequant') 是 true,直接交给 normalizeDraftValue 会把"关"读成"开"。
 */
function migrateLegacyQuantTrainMode(value: unknown): unknown {
  if (typeof value === 'boolean') return value
  if (value == null) return value
  const text = String(value).trim().toLowerCase()
  if (!text) return false
  if (text === 'keep_w8' || text === 'keepw8' || text === 'keep-w8') return true
  if (text === 'dequant' || text === 'off' || text === 'none' || text === 'false' || text === '0') return false
  // 未知 legacy 值:按 schema 侧 isKeepW8Mode 的口径判定,只有 keep_w8 系为开。
  return text === 'true' || text === '1'
}

/**
 * pissa_export_mode 曾把中文 label 直接当 value 存（sdxl schema 旧选项）。
 * 现已枚举化（lora_compatible/approximate/raw/auto），旧草稿值在草稿层迁移，
 * 提交层不再保留第二份映射（与 quant_train_mode 同一模式）。
 */
function migrateLegacyPissaExportMode(value: unknown): unknown {
  if (value == null) return value
  const text = String(value).trim()
  const aliases: Record<string, string> = {
    'LoRA无损兼容导出': 'lora_compatible',
    'LoRA快速近似导出': 'approximate',
  }
  return aliases[text] ?? value
}

const LEGACY_VALUE_MIGRATIONS: Record<string, (value: unknown) => unknown> = {
  quant_train_mode: migrateLegacyQuantTrainMode,
  pissa_export_mode: migrateLegacyPissaExportMode,
}

/**
 * 该键是否可以留在目标类型的草稿里。`_` 前缀是 UI 内部状态,一律保留。
 *
 * legacy 迁移键(quant_train_mode 等)不额外放行:它只在定义了该字段的族里
 * 有意义,在别的族里同样是外来键。迁移发生在"值"这一层,不改变"键属于谁"。
 */
export function isDraftKeyAllowedForType(typeId: string, key: string): boolean {
  if (!key) return false
  if (key.startsWith('_')) return true
  if (PRESERVED_NON_SCHEMA_KEYS.has(key)) return true
  return schemaKeysForType(typeId).has(key)
}

/** 与 runConfigBuilder._truthyFlag 同口径:字符串 flag 不能靠 Boolean() 判定。 */
function truthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'true' || text === '1' || text === 'yes' || text === 'on'
}

/**
 * 只归一"运行时类型错了就会坏事"的两类字段,其余原样保留:
 * - boolean:legacy 草稿里的字符串会被 Boolean() 判成 truthy(连 'false'/'dequant' 也是),
 *   开关显示为开,payload 也跟着错。
 * - multiSelect:非数组值会让读它的 UI 与比较逻辑直接崩。
 *
 * 刻意不对 number 之类做转换:buildRunConfig 自己已经 Number() 收口,
 * 在草稿层多一次转换会改变 payload 里出现哪些键(例如空值被换成默认值),
 * 那就等于悄悄改了运行配置规则。
 */
function coerceDraftValue(typeId: string, key: string, value: unknown): unknown {
  const field = getFieldDefinition(key, typeId)
  if (!field) return value
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : truthyFlag(value)
  if (field.type === 'multiSelect') return normalizeDraftValue(field, value)
  return value
}

export interface NormalizeDraftResult {
  draft: Record<string, unknown>
  /** 不属于目标 schema、已被丢弃的键(供调用方决定是否提示)。 */
  droppedKeys: string[]
}

/**
 * 把任意来源的配置袋归一到目标类型的草稿:
 * schema 默认值打底 → 只接收目标 schema(或白名单)键 → legacy 值迁移 → 类型归一。
 *
 * 归一而非原样接收是必需的:恢复/导入/回填都可能带来别的训练族字段,
 * 让它们留在草稿里就会污染 visibleWhen 与后续磁盘持久化,
 * 换型后一直漂在那里,直到某个 visibleWhen 把它读出来做出错误判断。
 */
export function normalizeDraftForType(
  typeId: string,
  saved?: Record<string, unknown> | null,
): NormalizeDraftResult {
  const draft = createDefaultConfig(typeId) as Record<string, unknown>
  const droppedKeys: string[] = []
  // 该 typeId 没有前端 schema(schema-less legacy):没有"属于它的字段"这个概念,
  // 此时清理就等于清空。原样保留原始记录,准入判断留给 trainingTypeAccess。
  if (!schemaKeysForType(typeId).size) {
    return { draft: { ...draft, ...(saved ?? {}) }, droppedKeys }
  }
  for (const [key, rawValue] of Object.entries(saved ?? {})) {
    if (!isDraftKeyAllowedForType(typeId, key)) {
      droppedKeys.push(key)
      continue
    }
    const migrate = LEGACY_VALUE_MIGRATIONS[key]
    if (migrate) {
      // 迁移结果已是目标类型;再过一遍 coerce 会在该族没有此字段时拿不到
      // field 定义而空转,或在有定义时重复判定。
      draft[key] = migrate(rawValue)
      continue
    }
    if (key.startsWith('_') || PRESERVED_NON_SCHEMA_KEYS.has(key)) {
      draft[key] = rawValue
      continue
    }
    draft[key] = coerceDraftValue(typeId, key, rawValue)
  }
  return { draft, droppedKeys }
}

function makeDraft(typeId: string, saved?: Record<string, unknown>): Record<string, unknown> {
  return normalizeDraftForType(typeId, saved).draft
}

/* ------------------------------------------------------------------ *
 * hydration 生命周期
 * ------------------------------------------------------------------ */

export type DraftHydrationStatus = 'idle' | 'pending' | 'ready' | 'failed'

export interface DraftHydrationOutcome {
  status: Extract<DraftHydrationStatus, 'ready' | 'failed'>
  /** 磁盘上被吸收的 type 数量(失败时为 0)。 */
  mergedTypes: number
  error?: string
}

interface TrainConfigState {
  typeId: string
  drafts: Record<string, Record<string, unknown>>
  /** applyBackendConfigOptions 修改 schema 后 bump,驱动依赖 schema 的组件重渲染 */
  schemaRev: number
  /** 磁盘 hydrate 完成标记(供 autofill 等后置步骤) */
  diskHydrated: boolean
  /** hydrate 的细粒度状态:失败可 retry;pending / failed 期间禁止写盘覆盖未读取的磁盘草稿 */
  hydrationStatus: DraftHydrationStatus
  hydrationError: string | null
  setType(typeId: string): void
  setValue(key: string, raw: unknown): void
  applyValues(values: Record<string, unknown>): void
  replaceDraft(config: Record<string, unknown>): void
  resetDraft(): void
  bumpSchemaRev(): void
  /** 磁盘草稿 merge(较新则覆盖 per-type) */
  mergeDiskDrafts(payload: TrainDraftsPayload): void
  markDiskHydrated(): void
}

/**
 * 磁盘内容还没合进内存的窗口内被本地改写过的 type。
 *
 * hydrate 是异步的,而 TrainPage 之外的页面(资源中心 applyValues、监控页恢复)
 * 随时可能写草稿。若磁盘响应晚于这些写入落地,mergeDiskDrafts 会用磁盘上的 bag
 * 把用户刚填的内容盖掉 —— 表现是"填完切个页面回来就没了"。updated_at 裁决不了
 * 这种竞态:磁盘时间戳是它被写入时的时间,而"响应到得晚"不代表内容更新。
 *
 * 'failed' 也算在窗口内:hydrate 失败意味着磁盘内容一次都没读到过,
 * 此后的本地编辑必须能挺过后续那次成功的重试 —— 否则 LAST seed / autofill
 * 填出来的东西会被迟到几分钟的 merge 一把抹掉。
 *
 * 'idle'(本会话还没发起 hydrate)不在窗口内:那时 mergeDiskDrafts 仍严格按
 * updated_at 裁决,那是持久化层的既有口径,不能因为这个保护顺手改掉。
 *
 * 放在模块级而非 store state:它不参与渲染,也不该被测试的 setState 重置成"干净"
 * (__resetTrainDraftRuntimeState 提供显式重置)。
 */
const editedDuringHydration = new Set<string>()
/** 该窗口内显式选过类型:merge 不得把 typeId 抢回磁盘记录的那个。 */
let typeSelectedDuringHydration = false

/** 磁盘内容尚未合入内存(正在读 or 读失败过)。 */
function diskMergePending(): boolean {
  const status = useTrainConfigStore.getState().hydrationStatus
  return status === 'pending' || status === 'failed'
}

function markLocalEdit(typeId: string) {
  if (!typeId) return
  dirtyTypesSinceWrite.add(typeId)
  if (diskMergePending()) editedDuringHydration.add(typeId)
}

const persisted = loadPersisted()
const initialType = persisted.typeId || DEFAULT_TYPE_ID

export const useTrainConfigStore = create<TrainConfigState>((set, get) => ({
  typeId: initialType,
  drafts: { [initialType]: makeDraft(initialType, persisted.drafts?.[initialType]) },
  schemaRev: 0,
  diskHydrated: false,
  hydrationStatus: 'idle',
  hydrationError: null,
  setType(typeId) {
    if (!typeId) return
    // 无 schema 的类型没有可编辑字段:切过去只会让 UI 渲染 0 个字段,
    // 随后 debounce 写盘还会把这个空 bag 持久化,覆盖真实草稿。
    // 准入判断的完整版在 trainingTypeAccess;这里是 store 层的最后一道闸。
    if (!hasSchemaForType(typeId)) return
    if (diskMergePending()) typeSelectedDuringHydration = true
    const { drafts } = get()
    if (!drafts[typeId]) {
      set({ typeId, drafts: { ...drafts, [typeId]: makeDraft(typeId, loadPersisted().drafts?.[typeId]) } })
    } else {
      set({ typeId })
    }
  },
  setValue(key, raw) {
    const { typeId, drafts } = get()
    const field = getFieldDefinition(key, typeId)
    const value = normalizeDraftValue(field, raw)
    markLocalEdit(typeId)
    set({ drafts: { ...drafts, [typeId]: { ...drafts[typeId], [key]: value } } })
  },
  applyValues(values) {
    const { typeId, drafts } = get()
    const nextDraft = { ...drafts[typeId] }
    for (const [key, raw] of Object.entries(values || {})) {
      nextDraft[key] = normalizeDraftValue(getFieldDefinition(key, typeId), raw)
    }
    markLocalEdit(typeId)
    set({ drafts: { ...drafts, [typeId]: nextDraft } })
  },
  replaceDraft(config) {
    const { typeId, drafts } = get()
    markLocalEdit(typeId)
    set({ drafts: { ...drafts, [typeId]: makeDraft(typeId, config) } })
  },
  resetDraft() {
    const { typeId, drafts } = get()
    markLocalEdit(typeId)
    set({ drafts: { ...drafts, [typeId]: createDefaultConfig(typeId) } })
  },
  bumpSchemaRev() {
    set({ schemaRev: get().schemaRev + 1 })
  },
  mergeDiskDrafts(payload) {
    const diskDrafts = payload?.drafts
    if (!diskDrafts || typeof diskDrafts !== 'object') return
    const diskUpdated = Number(payload.updated_at) || 0
    const lsUpdated = Number(loadPersisted().updated_at) || 0
    // 磁盘较新或 LS 无时间戳时,用磁盘覆盖已加载 type 的 bag
    if (diskUpdated < lsUpdated && lsUpdated > 0) {
      // 仍吸收 LS 没有的 type
      const { drafts } = get()
      const next = { ...drafts }
      let changed = false
      for (const [tid, bag] of Object.entries(diskDrafts)) {
        if (!next[tid] && bag && typeof bag === 'object' && !editedDuringHydration.has(tid)) {
          next[tid] = makeDraft(tid, bag as Record<string, unknown>)
          changed = true
        }
      }
      if (changed) set({ drafts: next })
      return
    }
    const { drafts, typeId } = get()
    const next = { ...drafts }
    for (const [tid, bag] of Object.entries(diskDrafts)) {
      if (!bag || typeof bag !== 'object') continue
      // 磁盘内容尚未合入内存的窗口内已在本地改过这个 type:本地赢。
      if (editedDuringHydration.has(tid)) continue
      next[tid] = makeDraft(tid, bag as Record<string, unknown>)
    }
    const candidateType =
      payload.typeId && typeof payload.typeId === 'string' && (next[payload.typeId] || diskDrafts[payload.typeId])
        ? payload.typeId
        : ''
    // 磁盘上的 typeId 可能指向已下线的 schema:切过去 UI 就是 0 字段的空壳。
    const diskType = candidateType && hasSchemaForType(candidateType) ? candidateType : ''
    const nextType = typeSelectedDuringHydration || !diskType ? typeId : diskType
    if (!next[nextType]) {
      next[nextType] = makeDraft(nextType, diskDrafts[nextType] as Record<string, unknown> | undefined)
    }
    set({ typeId: nextType, drafts: next })
    writeLocal({ typeId: nextType, drafts: next })
  },
  /**
   * 手动把状态标成"磁盘已读到手"。
   * 正常路径由 runHydration 自己设置;这个 action 留给不经过 hydrate 的宿主
   * (预置了 drafts 的嵌入场景),它是唯一能在没发请求时解除写抑制的入口。
   */
  markDiskHydrated() {
    set({ diskHydrated: true, hydrationStatus: 'ready', hydrationError: null })
  },
}))

/** 当前类型草稿(不存在时惰性建立由 setType 保证;这里兜底返回空对象) */
export function useDraft(): Record<string, unknown> {
  return useTrainConfigStore((s) => s.drafts[s.typeId]) ?? {}
}

let lsTimer: number | undefined
let diskTimer: number | undefined
let diskWriteFailedNotified = false
/** 计数而非布尔:hydrate / clear 可能重叠,布尔会被先结束的那个提前解锁。 */
let suppressDiskWriteDepth = 0
/**
 * 被抑制掉的写所涉及的 type 集合。
 *
 * 不能用一个布尔:clearCurrentTypeDraftOnDisk 结束时要丢弃"刚被清掉那个 type"的
 * 待写意图,而同期别的 type(资源中心 applyValues、恢复事务)的修改必须仍然落盘。
 * 一个布尔只能全丢或全留,前者静默丢数据,后者把刚清掉的空 bag 又写回去。
 */
const deferredDiskWriteTypes = new Set<string>()
/** 上次成功落盘之后被本地改动过、仍需持久化的 type。 */
const dirtyTypesSinceWrite = new Set<string>()

function scheduleDiskWrite() {
  if (typeof window === 'undefined') return
  window.clearTimeout(diskTimer)
  diskTimer = window.setTimeout(() => {
    void writeDraftsToDisk().catch(() => {
      if (!diskWriteFailedNotified) {
        diskWriteFailedNotified = true
        // 动态 import 避免 store↔toast 循环;失败静默也可
        import('@/stores/toastStore')
          .then(({ toast }) => toast.warn(translate('draft.flush_fail'), 'DRAFT'))
          .catch(() => {})
      }
    })
  }, DISK_DEBOUNCE_MS)
}

/**
 * 把当前尚未落盘的改动记成"待写"。
 *
 * 以 dirtyTypesSinceWrite 为准而不是 state 里的全部 type:mergeDiskDrafts 自己
 * 引起的 state 变化不该产生待写意图,否则 hydrate 一结束就会立刻把刚读回来的
 * 内容原样 PUT 回去(还得赌 revision 没被别人动过)。dirty 集合为空 = 没有
 * 本地改动待持久化,什么都不用做。
 */
function markAllTypesDeferred() {
  for (const typeId of dirtyTypesSinceWrite) {
    if (typeId) deferredDiskWriteTypes.add(typeId)
  }
}

useTrainConfigStore.subscribe((state) => {
  window.clearTimeout(lsTimer)
  lsTimer = window.setTimeout(() => {
    writeLocal(state)
  }, LS_DEBOUNCE_MS)

  if (suppressDiskWriteDepth > 0) {
    markAllTypesDeferred()
    return
  }
  // 磁盘内容尚未合入内存就写盘:此刻是"LS + 尚未合入磁盘"的半成品,
  // 写回去会把磁盘上更全的 per-type bag 抹掉。failed 同样算未合入。
  if (diskMergePending()) {
    markAllTypesDeferred()
    return
  }
  scheduleDiskWrite()
})

/**
 * 本次 PUT 的请求体。
 *
 * drafts 整袋提交(后端是 per-type union,少带一个 type 只是不更新它,不会删它)。
 * 被 clear 过的 type 此时是 schema 默认值,写回去正是它应有的状态 ——
 * DELETE 负责让磁盘不再留旧值,PUT 让它与内存一致,两者不冲突。
 */
function draftsPayloadNow(): TrainDraftsPayload {
  const snapshot = useTrainConfigStore.getState()
  return {
    version: 1,
    typeId: snapshot.typeId,
    updated_at: Date.now(),
    drafts: snapshot.drafts,
    // revision 参与乐观并发:与磁盘不一致时后端返回 409 而不是盲目覆盖。
    // 未知(还没成功读过磁盘)时不带 —— 带一个猜的值只会稳定撞 409。
    ...(lastKnownDiskRevision >= 0 ? { revision: lastKnownDiskRevision } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * hydrate:可 await、可 retry、单飞
 * ------------------------------------------------------------------ */

let hydrationInflight: Promise<DraftHydrationOutcome> | null = null
let hydrationOutcome: DraftHydrationOutcome | null = null

/**
 * 失败后的自动重试。
 *
 * "下次调用会重试"这个语义在生产上不够:TrainPage 用模块级布尔把 hydrate 门在
 * 整个会话只发起一次(而它属于 UI 页面所有权,本轮不能改),于是后端晚起一秒就
 * 再也没有"下次调用"。草稿从此只活在 LS 里,换机器就没了。
 *
 * 所以重试的责任放在 store 自己:失败后按退避自动再试,次数有上限 ——
 * 后端真的没起时无限重试只会刷满一屏网络错误,还会让 error 上报被去重淹掉。
 * 上限用尽后仍可由 bootstrapTrainDrafts / retryTrainDraftsHydration 手动再触发。
 */
const HYDRATION_RETRY_DELAYS_MS = [1_000, 3_000, 9_000]
let hydrationRetryTimer: number | undefined
let hydrationRetryAttempt = 0

function cancelHydrationRetry() {
  if (typeof window !== 'undefined') window.clearTimeout(hydrationRetryTimer)
  hydrationRetryTimer = undefined
}

function scheduleHydrationRetry() {
  if (typeof window === 'undefined') return
  const delay = HYDRATION_RETRY_DELAYS_MS[hydrationRetryAttempt]
  if (delay === undefined) return
  hydrationRetryAttempt += 1
  cancelHydrationRetry()
  hydrationRetryTimer = window.setTimeout(() => {
    hydrationRetryTimer = undefined
    // 期间已经有人成功 hydrate 过就不必再打后端。
    if (hydrationOutcome?.status === 'ready') return
    void hydrateTrainDraftsFromDisk({ force: true }).catch(() => {})
  }, delay)
}
/**
 * 最近一次已知的磁盘 revision(train_drafts_adapter 的乐观并发标记)。
 * -1 = 未知(还没 hydrate 过成功):此时不带 revision 提交,因为带一个猜出来的
 * 值只会稳定撞 409,而不带则退化成"无条件覆盖"—— 与 revision 引入前一致。
 */
let lastKnownDiskRevision = UNKNOWN_DRAFT_REVISION
/** 已因 409 拒绝过一次写;重新 hydrate 拿到新 revision 后清除。 */
let revisionConflictPending = false

/** 磁盘 hydrate 的当前状态(不订阅渲染时用这个,渲染用 store 的 hydrationStatus)。 */
export function getDraftHydrationStatus(): DraftHydrationStatus {
  return useTrainConfigStore.getState().hydrationStatus
}

/** 已知的磁盘 revision;-1 表示还没成功读过磁盘。 */
export function getLastKnownDraftRevision(): number {
  return lastKnownDiskRevision
}

/** 上一次写是否被 revision 冲突拒绝(尚未通过重新 hydrate 恢复)。 */
export function hasDraftRevisionConflict(): boolean {
  return revisionConflictPending
}

/** ApiError 上挂的 409 响应体(FastAPI 的 {detail:{...}})。 */
function conflictPayloadOf(error: unknown): TrainDraftConflictPayload | undefined {
  return (error as { payload?: TrainDraftConflictPayload } | null)?.payload
}

/**
 * 记下磁盘 revision。老后端不下发该字段时保持已知值不动 ——
 * 归零会让下一次写稳定撞 409。
 */
function rememberRevision(payload: unknown): void {
  const value = readDraftRevision(payload)
  if (value === null) return
  lastKnownDiskRevision = value
}

/**
 * revision 闭环的写路径。
 *
 * 1) 带上已知 revision 提交 → 后端 compare-and-replace。
 * 2) 成功:响应 data 里是写后的完整 payload(revision 已 +1),据此刷新本地记录。
 *    不刷新的话第二次写必然撞 409 —— 这正是"只把 revision 塞进请求"的半实现坑。
 * 3) 409:别的标签页/进程在我们之后写过。fail-closed —— 本次写不重试、不无条件
 *    覆盖,而是把磁盘 revision 记下来并重新 hydrate 去把对方的改动合进来。
 *    本地编辑在 editedDuringHydration 的保护下不会被那次 merge 抹掉。
 */
async function writeDraftsToDisk(): Promise<void> {
  const body = draftsPayloadNow()
  const writtenTypes = Object.keys(body.drafts ?? {})
  try {
    const resp = await trainApi.saveTrainDrafts(body)
    rememberRevision(unwrap<TrainDraftsPayload>(resp, 'envelope'))
    revisionConflictPending = false
    // 只清掉本次真的提交上去的 type:写请求飞行期间新产生的脏 type 不能被误清。
    for (const typeId of writtenTypes) {
      dirtyTypesSinceWrite.delete(typeId)
      deferredDiskWriteTypes.delete(typeId)
    }
    diskWriteFailedNotified = false
  } catch (error) {
    if (!isDraftRevisionConflict(error)) throw error
    // 冲突已经在处理中(上一次 409 触发的 hydrate/重试还没走完):不要再嵌套一轮,
    // 否则 409 → hydrate → 补写 → 409 会变成不收敛的循环。
    const alreadyRecovering = revisionConflictPending
    revisionConflictPending = true
    // 拿到对方的 revision 就能让下一次写重新对齐;拿不到就退回"未知",
    // 由重新 hydrate 去读。两种情况都不允许本次写强行覆盖。
    lastKnownDiskRevision = readDraftConflictRevision(conflictPayloadOf(error)) ?? UNKNOWN_DRAFT_REVISION
    // 本地编辑保留为待写;force hydrate 把对方的改动合进来(editedDuringHydration
    // 保证刚填的值不被那次 merge 抹掉),之后由 flushDeferredDiskWrite 用新 revision 重试。
    markAllTypesDeferred()
    if (!alreadyRecovering) await hydrateTrainDraftsFromDisk({ force: true })
    throw error
  }
}

async function runHydration(): Promise<DraftHydrationOutcome> {
  suppressDiskWriteDepth += 1
  // 已排上的 debounce 写会用尚未合并磁盘的内存整袋覆盖;撤掉它,改由 hydrate 后补发。
  if (typeof window !== 'undefined') window.clearTimeout(diskTimer)
  useTrainConfigStore.setState({ hydrationStatus: 'pending', hydrationError: null })
  let outcome: DraftHydrationOutcome
  try {
    const resp = await trainApi.loadTrainDrafts()
    const data = unwrap<TrainDraftsPayload>(resp, 'envelope')
    let mergedTypes = 0
    if (data && typeof data === 'object') {
      rememberRevision(data)
      mergedTypes = Object.keys(data.drafts ?? {}).length
      useTrainConfigStore.getState().mergeDiskDrafts(data)
    }
    outcome = { status: 'ready', mergedTypes }
    hydrationRetryAttempt = 0
    cancelHydrationRetry()
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready', hydrationError: null })
  } catch (error) {
    // 后端未起:仅 LS。标成 failed 而不是 ready,这样调用方能重试;
    // diskHydrated 仍置 true,后置步骤(autofill / LAST seed)不能被永久卡住。
    const message = (error as Error)?.message || 'train draft hydration failed'
    outcome = { status: 'failed', mergedTypes: 0, error: message }
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'failed', hydrationError: message })
  } finally {
    suppressDiskWriteDepth = Math.max(0, suppressDiskWriteDepth - 1)
    hydrationInflight = null
  }
  hydrationOutcome = outcome
  // 失败时不补发:磁盘内容一次都没读到过,整袋写回就是用 LS 抹掉磁盘。
  // deferredDiskWriteTypes 保持不动,等下一次成功的 hydrate。
  if (outcome.status === 'ready') flushDeferredDiskWrite({ immediate: true })
  else scheduleHydrationRetry()
  return outcome
}

/**
 * 补发被压下的写(仅当确实有待写内容)。
 *
 * immediate=true 用于 clear/hydrate 这类"已经等过一次网络往返"的收尾:
 * 那笔改动早就该落盘了,再压 900ms debounce 只是延长它暴露在丢失风险里的时间。
 */
function flushDeferredDiskWrite(opts: { immediate?: boolean } = {}) {
  if (suppressDiskWriteDepth > 0 || diskMergePending()) return
  const pending = [...deferredDiskWriteTypes]
  deferredDiskWriteTypes.clear()
  if (!pending.length) return
  for (const typeId of pending) dirtyTypesSinceWrite.add(typeId)
  if (!opts.immediate) {
    scheduleDiskWrite()
    return
  }
  if (typeof window !== 'undefined') window.clearTimeout(diskTimer)
  void writeDraftsToDisk().catch(() => {
    // 失败时把 type 放回待写队列,下一次编辑/hydrate 会再试。
    for (const typeId of pending) deferredDiskWriteTypes.add(typeId)
  })
}

/** 还有待落盘的 type(诊断/测试用)。 */
export function getPendingDraftDiskWriteTypes(): string[] {
  return [...deferredDiskWriteTypes]
}

/**
 * 启动时从磁盘 hydrate; 可在 TrainPage mount 调用一次。
 * 并发调用共享同一次请求;已 ready 时直接返回,不重复打后端。
 */
export function hydrateTrainDraftsFromDisk(opts: { force?: boolean } = {}): Promise<DraftHydrationOutcome> {
  if (hydrationInflight) return hydrationInflight
  if (!opts.force && hydrationOutcome?.status === 'ready') return Promise.resolve(hydrationOutcome)
  hydrationInflight = runHydration()
  return hydrationInflight
}

/**
 * hydrate 至少成功一次(失败会自动重试);跨页写盘前 await 它即可避免覆盖磁盘数据。
 * 与 hydrateTrainDraftsFromDisk 的差别:后者在"上次失败"时也只是再试一次,
 * 语义上这两个入口现在是一致的 —— 失败态从不 latch。
 */
export function ensureTrainDraftsHydrated(): Promise<DraftHydrationOutcome> {
  return hydrateTrainDraftsFromDisk()
}

/** 等待当前 hydrate 落地,但不触发新的请求。 */
export function waitForTrainDraftsHydration(): Promise<DraftHydrationOutcome | null> {
  if (hydrationInflight) return hydrationInflight
  return Promise.resolve(hydrationOutcome)
}

/** 上次 hydrate 失败时重试一次(ready 后不做无意义的重复请求)。 */
export function retryTrainDraftsHydration(): Promise<DraftHydrationOutcome> {
  // 手动重试重置退避:用户/新一次 mount 明确表达了"现在再试一次"的意图。
  if (hydrationOutcome?.status !== 'ready') hydrationRetryAttempt = 0
  return hydrateTrainDraftsFromDisk({ force: hydrationOutcome?.status !== 'ready' })
}

/**
 * 稳定的启动入口:幂等,可在任意 mount / 路由切换 / 可见性恢复时调用。
 *
 * 调用方无需记住"上次是否失败过"、也无需自己加模块级布尔去防重复请求:
 * 成功过就返回缓存结果,失败过就立刻重试,并发调用共享同一次请求。
 * 失败后 store 还会按退避自动重试若干次(见 HYDRATION_RETRY_DELAYS_MS),
 * 所以即使调用方只调一次,后端晚起也不会让磁盘草稿永久读不到。
 *
 * 这是给后续 UI 集成用的推荐入口:TrainPage 现在的
 * `if (draftsHydrateStarted) return; draftsHydrateStarted = true` 那段可以整段
 * 换成无条件的 `void bootstrapTrainDrafts()`。
 */
export function bootstrapTrainDrafts(): Promise<DraftHydrationOutcome> {
  return retryTrainDraftsHydration()
}

/** 立即写盘(取消 debounce);失败抛错给调用方 toast */
export async function flushTrainDraftsToDisk(): Promise<void> {
  window.clearTimeout(diskTimer)
  window.clearTimeout(lsTimer)
  // 磁盘内容尚未合入内存就整袋覆盖,会用半成品干掉磁盘上更全的记录。
  // 显式 flush 是用户动作,不能静默丢弃 —— 先把磁盘读到手再写。
  // failed 也要走这一步:没读过磁盘的 flush 就是无条件覆盖。
  if (diskMergePending()) {
    // 抑制 hydrate 收尾时的自动补写:本函数马上就要整袋写一次,
    // 让它先补一发只是多打一次后端(还多一次 409 的机会)。
    suppressDiskWriteDepth += 1
    let outcome: DraftHydrationOutcome
    try {
      outcome = await hydrateTrainDraftsFromDisk()
    } finally {
      suppressDiskWriteDepth = Math.max(0, suppressDiskWriteDepth - 1)
    }
    if (outcome.status !== 'ready') {
      // 拿不到磁盘内容,但显式 flush 不能静默丢:记下待写,报错给调用方。
      markAllTypesDeferred()
      throw new Error(outcome.error || 'train draft hydration failed')
    }
  }
  const snapshot = useTrainConfigStore.getState()
  writeLocal({ typeId: snapshot.typeId || DEFAULT_TYPE_ID, drafts: snapshot.drafts })
  // 本次写覆盖全部 type,积压的待写意图随之作废(失败时 writeDraftsToDisk 会重新记账)。
  deferredDiskWriteTypes.clear()
  await writeDraftsToDisk()
}

/**
 * 清当前 type 草稿为 schema 默认,并 DELETE 磁盘该 type。
 * 与 RESET 区分:RESET 只改内存(仍会 debounce 写默认 bag)。
 */
export async function clearCurrentTypeDraftOnDisk(): Promise<void> {
  const { typeId, resetDraft } = useTrainConfigStore.getState()
  window.clearTimeout(diskTimer)
  suppressDiskWriteDepth += 1
  try {
    resetDraft()
    // LS:去掉该 type 键,避免下次 hydrate 又捞回
    try {
      const prev = loadPersisted()
      const drafts = { ...(prev.drafts || {}) }
      delete drafts[typeId]
      const nextType = useTrainConfigStore.getState().typeId
      drafts[nextType] = useTrainConfigStore.getState().drafts[nextType] || createDefaultConfig(nextType)
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ typeId: nextType, updated_at: Date.now(), drafts }),
      )
    } catch {
      /* ignore */
    }
    // revision 已知时启用乐观并发:磁盘在我们读到之后被别人改过就不盲删。
    // 未知时连参数都不传 —— 传 undefined 会让"是否启用并发控制"这件事
    // 在调用点上看不出来,也让契约测试无法区分两种调用。
    const resp =
      lastKnownDiskRevision >= 0
        ? await trainApi.clearTrainDrafts(typeId, lastKnownDiskRevision)
        : await trainApi.clearTrainDrafts(typeId)
    rememberRevision(unwrap<TrainDraftsPayload>(resp, 'envelope'))
    // 该 type 的旧值已从磁盘删除,内存里现在是 schema 默认值:它不再"有改动待持久化"。
    // 后续若有别的 type 触发写盘,默认 bag 会跟着一起提交 —— 那与内存一致,是对的;
    // 真正必须避免的是把 clear 之前的旧值写回去,而 resetDraft 已经保证内存里没有旧值。
    dirtyTypesSinceWrite.delete(typeId)
  } catch (error) {
    if (isDraftRevisionConflict(error)) {
      revisionConflictPending = true
      lastKnownDiskRevision = readDraftConflictRevision(conflictPayloadOf(error)) ?? UNKNOWN_DRAFT_REVISION
      // fail-closed 覆盖整个 clear 操作:既不重试删除,也不把"重置成默认值"
      // 顺手 PUT 上去 —— 那是同一个用户意图的另一半,不能在意图已被拒绝后偷偷生效。
      // (内存里的 resetDraft 保留,与「DELETE 失败仍重置界面」的既有契约一致。)
      dirtyTypesSinceWrite.delete(typeId)
      deferredDiskWriteTypes.delete(typeId)
      // 重新 hydrate 把对方的改动读进来,用户看到实际状态后可以再决定要不要清。
      void hydrateTrainDraftsFromDisk({ force: true }).catch(() => {})
    }
    throw error
  } finally {
    suppressDiskWriteDepth = Math.max(0, suppressDiskWriteDepth - 1)
    // 只丢弃"刚被清掉那个 type"的待写意图。别的 type 在本次 clear 期间可能
    // 也被改过(资源中心 applyValues、恢复事务),把它们一并丢掉就是静默丢数据 ——
    // 旧实现在这里无条件 `deferredDiskWrite = false`,兄弟类型的编辑因此永远进不了磁盘。
    deferredDiskWriteTypes.delete(typeId)
    flushDeferredDiskWrite({ immediate: true })
  }
}

/** 仅测试/诊断用:重置模块级的 hydrate 与本地脏标记。 */
export function __resetTrainDraftRuntimeState(): void {
  hydrationInflight = null
  hydrationOutcome = null
  lastKnownDiskRevision = UNKNOWN_DRAFT_REVISION
  revisionConflictPending = false
  hydrationRetryAttempt = 0
  cancelHydrationRetry()
  suppressDiskWriteDepth = 0
  deferredDiskWriteTypes.clear()
  dirtyTypesSinceWrite.clear()
  diskWriteFailedNotified = false
  editedDuringHydration.clear()
  typeSelectedDuringHydration = false
  if (typeof window !== 'undefined') {
    window.clearTimeout(diskTimer)
    window.clearTimeout(lsTimer)
  }
  diskTimer = undefined
  lsTimer = undefined
}
