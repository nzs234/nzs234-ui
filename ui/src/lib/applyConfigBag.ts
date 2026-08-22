// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { restoreConfigIntoDraft, type RestoreConfigResult } from '@/features/training/restoreConfigService'
import type { TrainingTypeAccess } from '@/lib/trainingTypeAccess'
import { toast } from '@/stores/toastStore'
import { translate } from '@/i18n/useI18n'

export interface RestorableBag {
  ok: boolean
  schemaId?: string
  typeId?: string
  config: Record<string, unknown>
  runId?: string
  name?: string
  reason?: string
  source?: string
}

export interface ApplyConfigBagResult {
  ok: boolean
  /** 成功切换到的类型 id(未切换或无 sid 时为 null)。 */
  typeId: string | null
  /** 失败原因(成功时 undefined),让调用方能区分"没配置"和"类型被拒"。 */
  failure?: 'no_config' | 'type_blocked'
  /** 被拒类型的准入判定,便于上报/提示。 */
  typeAccess?: TrainingTypeAccess
  /** 已忽略的、不属于目标类型 schema 的字段键。 */
  droppedKeys?: string[]
}

const ACCESS_REASON_KEY: Record<TrainingTypeAccess, string> = {
  // 'restorable' 出现在这里只有一种情况:准入判定说可以,但 setType 拒绝了切型
  // (两边条件漂移)。没有更贴切的文案,退回通用的"类型不可用"。
  restorable: 'restore.type_unregistered',
  missing: 'restore.type_unregistered',
  unregistered: 'restore.type_unregistered',
  disabled: 'restore.type_disabled',
  schema_unavailable: 'restore.type_schema_unavailable',
}

function reportTypeBlocked(result: Extract<RestoreConfigResult, { ok: false }>, tag: string) {
  const id = result.resolution.requestedTypeId || ''
  toast.warn(
    translate('restore.type_blocked', { id, reason: translate(ACCESS_REASON_KEY[result.resolution.access]) }),
    tag,
  )
}

function applyCore(bag: RestorableBag, opts: { toastTag?: string } = {}): ApplyConfigBagResult {
  const tag = opts.toastTag || 'PARAMS'
  if (!bag.ok || !bag.config || !Object.keys(bag.config).length) {
    toast.warn(
      bag.reason === 'raw_config_unavailable' ? translate('restore.no_raw') : translate('restore.none'),
      tag,
    )
    return { ok: false, typeId: null, failure: 'no_config' }
  }

  // fail-closed:候选类型未注册 / disabled / 无 schema 时不回落到当前类型。
  // 旧实现在这里只弹一句 warn 就继续 replaceDraft,等于把别的训练族的参数
  // 灌进当前类型 —— 用户会拿着张冠李戴的配置直接点启动。
  const result = restoreConfigIntoDraft(
    {
      config: bag.config,
      typeCandidates: [bag.schemaId, bag.typeId],
      label: bag.name,
      runId: bag.runId,
      source: (bag.source as never) || 'unknown',
    },
    { allowFallbackToCurrentType: false },
  )

  if (!result.ok) {
    // type_switch_failed 与 type_unavailable 对调用方是同一件事:目标类型没能拿到,
    // 配置一个字都没落地。都归到 type_blocked,不能降级成"填进当前类型"。
    if (result.reason === 'type_unavailable' || result.reason === 'type_switch_failed') {
      reportTypeBlocked(result, tag)
      return {
        ok: false,
        typeId: null,
        failure: 'type_blocked',
        typeAccess: result.resolution.access,
      }
    }
    toast.warn(translate('restore.none'), tag)
    return { ok: false, typeId: null, failure: 'no_config' }
  }

  if (result.droppedKeys.length) {
    toast.warn(translate('restore.dropped_fields', { count: result.droppedKeys.length }), tag)
  }
  const label = bag.name || bag.runId || result.typeId || translate('restore.config_fallback')
  toast.ok(translate('restore.filled', { label }), tag)
  // 兼容旧返回语义:typeId 仅在真的换过型时非 null。
  return {
    ok: true,
    typeId: result.resolution.switched ? result.typeId : null,
    droppedKeys: result.droppedKeys,
  }
}

/** 将 restorable bag 灌入 train draft(可换 type,隐藏 legacy 可恢复) */
export function applyConfigBag(bag: RestorableBag, opts: { toastTag?: string } = {}): boolean {
  return applyCore(bag, opts).ok
}

/** applyConfigBag 的带元信息版本:额外返回实际切换到的 typeId。 */
export function applyConfigBagWithMeta(bag: RestorableBag, opts: { toastTag?: string } = {}): ApplyConfigBagResult {
  return applyCore(bag, opts)
}

/** 解析 GET /api/runs/:id/restorable_config 响应 */
export function extractRunRestorable(raw: unknown, fallbackId = ''): RestorableBag {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root
  const config =
    data.config && typeof data.config === 'object' && !Array.isArray(data.config)
      ? (data.config as Record<string, unknown>)
      : {}
  const ok = data.ok === true && Object.keys(config).length > 0
  return {
    ok,
    schemaId: String(data.schema_id || data.schemaId || data.typeId || ''),
    typeId: String(data.schema_id || data.typeId || ''),
    config,
    runId: String(data.run_id || data.runId || fallbackId),
    reason: String(data.reason || (ok ? '' : 'unavailable')),
    source: String(data.source || 'runs'),
  }
}
