// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 配置恢复事务(单一事实源)。
 *
 * 「恢复上次训练 / 导入预设 / 从 Queue-Monitor 回填某个 run」原本各自散在三个页面里,
 * 每处都手抄一遍同样的五步:解析类型 → 切换类型 → 清理脏字段 → 替换 draft →
 * 清理向导状态。手抄件之间已经漂移(有的不切型、有的不清 preflight、有的把未知
 * schema 的配置直接灌进当前类型),而每一处漂移都能让用户拿着别的训练族的参数点启动。
 *
 * 这里把它收敛成一个可复用的事务:
 * - 解析类型走 trainingTypeAccess 的准入判定,fail-closed;
 * - 未知/禁用/无 schema 的配置绝不落进当前 draft;
 * - draft 替换经 normalizeDraftForType 清掉不属于目标 schema 的持久脏字段;
 * - 向导状态用 wizardStore.applyRestoredType 一次写完。
 *
 * 依赖方向刻意是单向的:本模块 → configStore / wizardStore。页面只调本模块,
 * store 不反向 import 这里,所以不会形成循环依赖。
 */
import {
  describeTrainingTypeAccess,
  type TrainingTypeAccess,
} from '@/lib/trainingTypeAccess'
import { normalizeDraftForType, useTrainConfigStore } from '@/stores/configStore'
import { useWizardStore } from '@/pages/train/wizard/wizardStore'

/** 恢复来源;仅用于日志/提示,不改变行为。 */
export type RestoreSource = 'last-training' | 'saved_params' | 'runs' | 'history' | 'import' | 'external' | 'unknown'

export interface RestoreConfigInput {
  config: Record<string, unknown>
  /** 候选类型 id,按优先级排列(通常是 schema_id, typeId)。 */
  typeCandidates?: (string | null | undefined)[]
  source?: RestoreSource
  /** 展示名(toast/日志用)。 */
  label?: string
  runId?: string
}

export type RestoreFailureReason =
  /** config 为空。 */
  | 'empty_config'
  /** 候选类型全部不可用,且不允许回落到当前类型。 */
  | 'type_unavailable'
  /** setType 没能真的切过去(store 层闸门拒绝):绝不把目标类型的配置写进当前类型。 */
  | 'type_switch_failed'

export interface RestoreTypeResolution {
  /** 最终写入的类型 id(失败时为 null)。 */
  typeId: string | null
  /** 是否发生了类型切换。 */
  switched: boolean
  /** 第一个候选(用于提示 "类型 X 不可用")。 */
  requestedTypeId: string | null
  /** 第一个候选的准入判定。 */
  access: TrainingTypeAccess
  /** 候选不可用、回落到当前类型时为 true。 */
  fellBackToCurrentType: boolean
}

export interface RestoreConfigSuccess {
  ok: true
  typeId: string
  resolution: RestoreTypeResolution
  /** 实际写入 draft 的字段键(已剔除不属于目标 schema 的)。 */
  appliedKeys: string[]
  /** 被丢弃的脏字段键。 */
  droppedKeys: string[]
}

export interface RestoreConfigFailure {
  ok: false
  reason: RestoreFailureReason
  resolution: RestoreTypeResolution
}

export type RestoreConfigResult = RestoreConfigSuccess | RestoreConfigFailure

export interface RestoreConfigOptions {
  /**
   * 候选类型不可用时,是否允许把配置灌进当前类型。
   * 默认 false —— 这就是 fail-closed:一个别的训练族(或 disabled 类型)的参数袋
   * 灌进当前类型,产出的是"看起来能跑、实际参数张冠李戴"的配置。
   */
  allowFallbackToCurrentType?: boolean
  /** 是否重置该类型的向导状态(默认 true)。 */
  resetWizardState?: boolean
}

function normalizeCandidates(candidates: (string | null | undefined)[] | undefined): string[] {
  const out: string[] = []
  for (const candidate of candidates ?? []) {
    const value = String(candidate ?? '').trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * 解析目标类型:第一个通过准入的候选胜出。
 * 全部不通过时按 allowFallbackToCurrentType 决定回落或失败。
 */
export function resolveRestoreTargetType(
  typeCandidates: (string | null | undefined)[] | undefined,
  currentTypeId: string,
  options: RestoreConfigOptions = {},
): RestoreTypeResolution {
  const candidates = normalizeCandidates(typeCandidates)
  const requestedTypeId = candidates[0] ?? null
  const firstAccess = requestedTypeId ? describeTrainingTypeAccess(requestedTypeId) : 'missing'
  const accepted = candidates.find((candidate) => describeTrainingTypeAccess(candidate) === 'restorable')

  if (accepted) {
    return {
      typeId: accepted,
      switched: accepted !== currentTypeId,
      requestedTypeId,
      access: describeTrainingTypeAccess(accepted),
      fellBackToCurrentType: false,
    }
  }

  // 没给候选(纯 config 袋,例如外部 TOML 导入)→ 留在当前类型是唯一合理解读。
  if (!candidates.length) {
    return {
      typeId: currentTypeId,
      switched: false,
      requestedTypeId: null,
      access: 'missing',
      fellBackToCurrentType: false,
    }
  }

  if (options.allowFallbackToCurrentType) {
    return {
      typeId: currentTypeId,
      switched: false,
      requestedTypeId,
      access: firstAccess,
      fellBackToCurrentType: true,
    }
  }

  return {
    typeId: null,
    switched: false,
    requestedTypeId,
    access: firstAccess,
    fellBackToCurrentType: false,
  }
}

/**
 * 一次原子的恢复事务。
 * 顺序固定:解析类型 → 切型 → 归一化 + 替换 draft → 重置向导状态。
 * 任何一步判定为不可恢复就整体不落地,绝不留半个应用完的 draft。
 */
export function restoreConfigIntoDraft(
  input: RestoreConfigInput,
  options: RestoreConfigOptions = {},
): RestoreConfigResult {
  const store = useTrainConfigStore.getState()
  const currentTypeId = store.typeId
  const resolution = resolveRestoreTargetType(input.typeCandidates, currentTypeId, options)

  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config : null
  if (!config || !Object.keys(config).length) {
    return { ok: false, reason: 'empty_config', resolution }
  }
  if (!resolution.typeId) {
    return { ok: false, reason: 'type_unavailable', resolution }
  }

  const targetTypeId = resolution.typeId
  // 先算归一化结果再动 store:清理规则若判定这袋配置对目标 schema 毫无内容,
  // 也不至于已经把类型切走、把 draft 换掉。
  const { droppedKeys } = normalizeDraftForType(targetTypeId, config)
  const appliedKeys = Object.keys(config).filter((key) => !droppedKeys.includes(key))

  if (resolution.switched) {
    store.setType(targetTypeId)
    // setType 是 store 层的最后一道闸(无 schema 直接 return),而且它是同步的,
    // 所以这里能立刻验证。不验证就意味着:闸门拒绝切型之后 replaceDraft 仍然
    // 执行 —— 目标类型 A 的配置袋被 normalizeDraftForType 按当前类型 B 的 schema
    // 裁一遍写进 B。裁完剩下的键在 B 里都合法,UI 看不出任何异常,
    // 用户就拿着"A 的意图 + B 的字段"点了启动。
    // describeTrainingTypeAccess 与 setType 的判定条件本应一致,所以这条分支
    // 是防御性的:两边一旦漂移,失败方式必须是拒绝而不是静默错配。
    if (useTrainConfigStore.getState().typeId !== targetTypeId) {
      return { ok: false, reason: 'type_switch_failed', resolution }
    }
  }
  // replaceDraft 内部同样走 normalizeDraftForType(schema 默认打底 + 清脏字段 + legacy 值迁移)。
  useTrainConfigStore.getState().replaceDraft(config)

  if (options.resetWizardState !== false) {
    useWizardStore.getState().applyRestoredType(targetTypeId, appliedKeys)
  }

  return { ok: true, typeId: targetTypeId, resolution, appliedKeys, droppedKeys }
}
