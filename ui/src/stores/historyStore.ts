// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 运行历史:提交时保存 draft 快照,供队列/监控「复制参数」。
   localStorage + 磁盘双写(assets/ui_state/run_history),cap 40。 */

import { trainApi, type RunHistoryDiskPayload } from '@/api/trainApi'
import { unwrap } from '@/api/transport'

const LS_KEY = 'lx-run-history-v1'
const CAP = 40
const DISK_DEBOUNCE_MS = 900

export interface RunRecord {
  /** 后端返回的 run/task id(可能为空,匹配时兜底用 name) */
  id: string
  name: string
  typeId: string
  at: number
  config: Record<string, unknown>
}

export interface RunHistoryPayload {
  version?: number
  updated_at?: number
  records?: RunRecord[]
}

function loadLocal(): RunRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as RunRecord[]
    return Array.isArray(arr) ? arr.slice(0, CAP) : []
  } catch {
    return []
  }
}

function saveLocal(records: RunRecord[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(records.slice(0, CAP)))
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(records.slice(0, Math.floor(CAP / 2))))
    } catch {
      /* ignore */
    }
  }
}

function sanitizeRecord(raw: unknown): RunRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const config = r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? (r.config as Record<string, unknown>) : {}
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    typeId: String(r.typeId ?? r.type_id ?? ''),
    at: Number(r.at) || 0,
    config: { ...config },
  }
}

/** 按 id 优先去重合并,新在前,cap */
export function mergeHistoryRecords(primary: RunRecord[], secondary: RunRecord[]): RunRecord[] {
  const out: RunRecord[] = []
  const seen = new Set<string>()
  for (const rec of [...primary, ...secondary]) {
    if (!rec) continue
    const key = rec.id ? `id:${rec.id}` : `name:${rec.name}:${rec.at}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rec)
    if (out.length >= CAP) break
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 磁盘写:PUT 是整体替换,所以未合并磁盘前不许落盘
 * ------------------------------------------------------------------ */

let diskTimer: number | undefined
/** 已排上 debounce、还没触发的写(hydrate 开始时要能撤掉它)。 */
let diskWritePending = false
/** 因未合并磁盘而被压下的写:hydrate 成功后补发,不让提交记录丢失。 */
let deferredDiskWrite = false

/**
 * 当前是否必须压下"把本地列表整袋写回磁盘"。
 *
 * run_history 的 PUT 语义与 train_drafts 不同:后端 save_run_history_payload 是
 * **整体替换**(train_drafts 至少还按 type 做 union)。所以在磁盘记录合进本地之前
 * 落盘 = 用不完整的 LS 抹掉磁盘上的全部历史。新浏览器/清过缓存的会话里
 * LS 只有刚提交的这一条,磁盘上可能有 40 条,一次 PUT 就全没了。
 *
 * - pending:hydrate 正在飞。磁盘那份马上就到,几百毫秒后 LS 就是并集了 ——
 *   等一下再写是纯收益,没有任何理由抢在它前面。→ 压下。
 * - failed:请求已经回来了,而且是失败。这时"再等等"不会等到任何东西:
 *   GET 拿不到的内容 PUT 也没法保护,压下只会让本次提交的记录连磁盘都进不去,
 *   跨会话彻底丢失。而 GET 失败大概率 PUT 也失败(后端没起),真发生"GET 失败
 *   但 PUT 成功"时,覆盖的是一份读不出来的磁盘文件 —— 用 LS 换掉它是可接受的,
 *   丢掉用户刚提交的 run 不可接受。→ 放行,并顺手重试 hydrate。
 * - ready:磁盘已合并进 LS,整袋写回是安全的。
 * - idle:本会话还没发起过 hydrate。AppShell mount 即调 hydrateRunHistoryFromDisk,
 *   而 addRunRecord 只可能发生在用户配完并提交训练之后,那时状态已是
 *   ready/pending/failed 之一。压下 idle 只会让"从未 hydrate 的宿主环境"
 *   永远写不进磁盘。→ 放行,并由 bootstrapRunHistory 显式收口。
 */
function diskWriteBlocked(): boolean {
  return hydrationStatus === 'pending'
}

function currentDiskPayload(): RunHistoryDiskPayload {
  return { version: 1, updated_at: Date.now(), records: loadLocal().slice(0, CAP) }
}

function writeDiskNow(): Promise<void> {
  // fire-and-forget:Promise.resolve 包一层,调用方返回非 Promise 时也不会
  // 变成未捕获异常打断调用者的 timer 回调。
  return Promise.resolve(trainApi.saveRunHistory(currentDiskPayload())).then(
    () => undefined,
    () => undefined, // 后端未起:仅 LS
  )
}

function scheduleDiskWrite() {
  if (typeof window === 'undefined') return
  if (diskWriteBlocked()) {
    deferredDiskWrite = true
    return
  }
  // hydrate 失败过 → 磁盘那份至今没读到手。写照常进行(见 diskWriteBlocked 的说明),
  // 但同时重试一次 hydrate:成功的话下一次写就是完整并集,而不是一直用 LS 覆盖。
  if (hydrationStatus === 'failed') void retryRunHistoryHydration().catch(() => {})
  window.clearTimeout(diskTimer)
  diskWritePending = true
  diskTimer = window.setTimeout(() => {
    diskWritePending = false
    void writeDiskNow()
  }, DISK_DEBOUNCE_MS)
}

/** hydrate 落地后补发被压下的写。 */
function flushDeferredDiskWrite() {
  if (!deferredDiskWrite || diskWriteBlocked()) return
  deferredDiskWrite = false
  scheduleDiskWrite()
}

/** 是否有被压下、等 hydrate 成功后才能落盘的写(诊断/测试用)。 */
export function hasDeferredRunHistoryDiskWrite(): boolean {
  return deferredDiskWrite
}

/** 提交成功后记录;runResponse 里能挖到 run_id/task_id 就带上 */
export function addRunRecord(typeId: string, config: Record<string, unknown>, runResponse: unknown) {
  const resp = runResponse as Record<string, unknown> | null
  const id = String(resp?.run_id ?? resp?.task_id ?? resp?.id ?? '')
  const name = String(config.output_name ?? config.config_name ?? typeId)
  const records = loadLocal().filter((r) => !(id && r.id === id))
  records.unshift({ id, name, typeId, at: Date.now(), config: { ...config } })
  saveLocal(records.slice(0, CAP))
  scheduleDiskWrite()
}

/**
 * 立即写盘(取消 debounce)。磁盘尚未合并时先把 hydrate 等完:
 * 显式 flush 是调用方的意图,不能静默丢掉,但同样不能拿半成品覆盖磁盘。
 * hydrate 仍失败时抛错,由调用方决定提示什么。
 */
export async function flushRunHistoryToDisk(): Promise<void> {
  if (typeof window !== 'undefined') window.clearTimeout(diskTimer)
  diskWritePending = false
  if (hydrationStatus !== 'ready') {
    const outcome = await hydrateRunHistoryFromDisk()
    if (outcome.status !== 'ready') {
      deferredDiskWrite = true
      throw new Error(outcome.error || 'run history hydration failed')
    }
  }
  deferredDiskWrite = false
  await trainApi.saveRunHistory(currentDiskPayload())
}

/** 按任务 id 或名称匹配本地记录 */
export function findRunRecord(taskId?: string, name?: string): RunRecord | undefined {
  const records = loadLocal()
  if (taskId) {
    const hit = records.find((r) => r.id && r.id === taskId)
    if (hit) return hit
  }
  if (name) {
    const hit = records.find((r) => r.name && r.name === name)
    if (hit) return hit
  }
  return undefined
}

export function listRunRecords(): RunRecord[] {
  return loadLocal()
}

/* ------------------------------------------------------------------ *
 * hydrate:可 await、失败可重试
 * ------------------------------------------------------------------ */

export type RunHistoryHydrationStatus = 'idle' | 'pending' | 'ready' | 'failed'

export interface RunHistoryHydrationOutcome {
  status: Extract<RunHistoryHydrationStatus, 'ready' | 'failed'>
  /** 从磁盘吸收的记录数(失败时 0)。 */
  mergedRecords: number
  error?: string
}

let hydrationStatus: RunHistoryHydrationStatus = 'idle'
let hydrationInflight: Promise<RunHistoryHydrationOutcome> | null = null
let hydrationOutcome: RunHistoryHydrationOutcome | null = null

export function getRunHistoryHydrationStatus(): RunHistoryHydrationStatus {
  return hydrationStatus
}

async function runHydration(): Promise<RunHistoryHydrationOutcome> {
  hydrationStatus = 'pending'
  let outcome: RunHistoryHydrationOutcome
  try {
    // 本会话已经排过一次 debounce 写,但磁盘还没合并进来:那个 timer 一旦触发就是
    // 用不完整的 LS 整体替换磁盘。先撤掉它,改由 hydrate 成功后补发。
    if (diskWritePending) {
      if (typeof window !== 'undefined') window.clearTimeout(diskTimer)
      diskWritePending = false
      deferredDiskWrite = true
    }
    const resp = await trainApi.loadRunHistory()
    const data = unwrap<RunHistoryPayload>(resp)
    const diskRecords = Array.isArray(data?.records)
      ? data!.records!.map(sanitizeRecord).filter((x): x is RunRecord => Boolean(x))
      : []
    if (diskRecords.length) {
      const local = loadLocal()
      const diskAt = Number(data?.updated_at) || 0
      const localMax = local.reduce((m, r) => Math.max(m, r.at || 0), 0)
      // 磁盘较新或本地空 → 磁盘优先;否则本地优先再补磁盘缺的
      const merged =
        !local.length || diskAt >= localMax
          ? mergeHistoryRecords(diskRecords, local)
          : mergeHistoryRecords(local, diskRecords)
      saveLocal(merged)
    }
    outcome = { status: 'ready', mergedRecords: diskRecords.length }
    hydrationStatus = 'ready'
  } catch (error) {
    // 旧实现在请求前就把 diskHydrated 置 true,后端未起时这一整个会话都拿不到
    // 磁盘历史,Queue/Monitor 的「复制参数」永久只看得到本机 LS。
    // 标成 failed 才能让下次进入页面时重试。
    outcome = {
      status: 'failed',
      mergedRecords: 0,
      error: (error as Error)?.message || 'run history hydration failed',
    }
    hydrationStatus = 'failed'
  } finally {
    hydrationInflight = null
  }
  hydrationOutcome = outcome
  // 成功后补发被压下的写:此刻 LS 已经是"磁盘 ∪ 本地"的并集,整袋替换是安全的。
  // 仍失败时 deferredDiskWrite 保持 true,等下一次 retry。
  flushDeferredDiskWrite()
  return outcome
}

/**
 * 启动时磁盘 merge(较新或 LS 空时吸收);可在 Queue/App mount 调一次。
 * 并发调用共享同一次请求;成功过就不再重复打后端,失败则下次调用自动重试。
 */
export function hydrateRunHistoryFromDisk(
  opts: { force?: boolean } = {},
): Promise<RunHistoryHydrationOutcome> {
  if (hydrationInflight) return hydrationInflight
  if (!opts.force && hydrationOutcome?.status === 'ready') return Promise.resolve(hydrationOutcome)
  hydrationInflight = runHydration()
  return hydrationInflight
}

/** 上次失败时重试;已 ready 则直接返回。 */
export function retryRunHistoryHydration(): Promise<RunHistoryHydrationOutcome> {
  return hydrateRunHistoryFromDisk({ force: hydrationOutcome?.status !== 'ready' })
}

/**
 * 稳定的启动入口:幂等,可在任意 mount / 路由切换 / 可见性恢复时调用。
 * 成功过就直接返回缓存结果;失败过则自动重试一次,不需要调用方记住"上次失败了"。
 */
export function bootstrapRunHistory(): Promise<RunHistoryHydrationOutcome> {
  return retryRunHistoryHydration()
}

/** 仅测试/诊断用。 */
export function __resetRunHistoryRuntimeState(): void {
  hydrationStatus = 'idle'
  hydrationInflight = null
  hydrationOutcome = null
  deferredDiskWrite = false
  diskWritePending = false
  if (typeof window !== 'undefined') window.clearTimeout(diskTimer)
  diskTimer = undefined
}
