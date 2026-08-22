// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { createDefaultConfig } from '@/schema/schemaIndex.js'
import { isPathEmptyForAutofill } from '@/lib/modelPathMatch'

/** Mirrors backend last_training_query.build_resume_offer (P0-A). */
export interface ResumeOffer {
  available: boolean
  offerable: boolean
  show_banner: boolean
  hint: string
  suggested_resume: string | null
  resume_path: string | null
  run_status: string | null
  checkpoint_count: number
  run_id: string | null
  schema_id: string | null
  resume_capability: 'full' | 'partial' | 'weights_only' | null
  resume_level: 'full' | 'weights_only' | null
  resume_warning: string | null
}

export interface RestorableLastTraining {
  ok: boolean
  source: 'last-training' | 'saved_params' | 'none'
  schemaId: string
  config: Record<string, unknown>
  runId: string
  reason?: string
  /** Only present for last-training source when backend attaches it. */
  resumeOffer?: ResumeOffer | null
  suggestedResume?: string | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function nonEmptyConfig(bag: unknown): Record<string, unknown> | null {
  const r = asRecord(bag)
  if (!r) return null
  return Object.keys(r).length ? r : null
}

function extractResumeOffer(data: Record<string, unknown>): ResumeOffer | null {
  const offer = asRecord(data.resume_offer)
  if (!offer) return null
  const strOrNull = (v: unknown) => {
    const s = String(v ?? '').trim()
    return s ? s : null
  }
  return {
    available: offer.available === true,
    offerable: offer.offerable === true,
    show_banner: offer.show_banner === true,
    hint: String(offer.hint || 'none'),
    suggested_resume: strOrNull(offer.suggested_resume),
    resume_path: strOrNull(offer.resume_path),
    run_status: strOrNull(offer.run_status),
    checkpoint_count: Number(offer.checkpoint_count || 0) || 0,
    run_id: strOrNull(offer.run_id),
    schema_id: strOrNull(offer.schema_id),
    resume_capability: ['full', 'partial', 'weights_only'].includes(String(offer.resume_capability))
      ? (String(offer.resume_capability) as ResumeOffer['resume_capability'])
      : null,
    resume_level: offer.resume_level === 'full' || offer.resume_level === 'weights_only'
      ? offer.resume_level
      : null,
    resume_warning: strOrNull(offer.resume_warning),
  }
}

/** 从 last-training / saved_params 原始响应抽出可灌入草稿的 bag */
export function extractFromLastTrainingPayload(raw: unknown): RestorableLastTraining {
  const root = asRecord(raw) || {}
  // 兼容信封与裸 payload
  const data = asRecord(root.data) || root
  const has = data.has_last_training === true
  const schemaId = String(data.schema_id || data.training_type || data.typeId || '').trim()
  const restorable = nonEmptyConfig(data.restorable_config)
  const config = restorable || nonEmptyConfig(data.config)
  const resumeOffer = extractResumeOffer(data)
  const suggestedResume =
    strOrEmpty(data.suggested_resume) ||
    resumeOffer?.suggested_resume ||
    resumeOffer?.resume_path ||
    null
  if (has && config) {
    return {
      ok: true,
      source: 'last-training',
      schemaId,
      config,
      runId: String(data.run_id || ''),
      resumeOffer,
      suggestedResume,
    }
  }
  if (has && !config) {
    return {
      ok: false,
      source: 'last-training',
      schemaId,
      config: {},
      runId: String(data.run_id || ''),
      reason: String(data.error || 'raw_config_unavailable'),
      resumeOffer,
      suggestedResume,
    }
  }
  return {
    ok: false,
    source: 'none',
    schemaId: '',
    config: {},
    runId: '',
    reason: 'no_last_training',
    resumeOffer,
    suggestedResume: null,
  }
}

function strOrEmpty(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s : null
}

export function extractFromSavedParamsPayload(raw: unknown): RestorableLastTraining {
  const root = asRecord(raw) || {}
  const data = asRecord(root.data) || root
  if (!Object.keys(data).length) {
    return { ok: false, source: 'none', schemaId: '', config: {}, runId: '', reason: 'empty_saved_params' }
  }
  // 嵌套 { schema_id, config } 或扁平参数袋
  const nested = nonEmptyConfig(data.config)
  const schemaId = String(data.schema_id || data.training_type || data.typeId || nested?.schema_id || '').trim()
  const config = nested || data
  // 去掉元字段,避免污染 draft
  const cleaned = { ...config }
  for (const k of ['schema_id', 'training_type', 'typeId', 'has_last_training', 'run_id', 'normalized_config']) {
    delete cleaned[k]
  }
  if (!Object.keys(cleaned).length) {
    return { ok: false, source: 'saved_params', schemaId, config: {}, runId: '', reason: 'empty_config' }
  }
  return { ok: true, source: 'saved_params', schemaId, config: cleaned, runId: String(data.run_id || '') }
}

export async function fetchRestorableLastTraining(): Promise<RestorableLastTraining> {
  let lastTrainingResult: RestorableLastTraining | null = null
  try {
    // GET /train/last-training 是裸 payload(非 /api 信封),trainApi 已按 native 语义取。
    const resp = await trainApi.lastTraining()
    lastTrainingResult = extractFromLastTrainingPayload(resp)
    if (lastTrainingResult.ok) return lastTrainingResult
    // last 有记录但无 raw → 仍尝试 saved_params 回落
  } catch {
    /* 后端未起或路由不可达 */
  }
  try {
    const resp = await trainApi.savedParams()
    const unwrapped = unwrap(resp)
    const fromSaved = extractFromSavedParamsPayload(unwrapped)
    if (fromSaved.ok) return fromSaved
    // saved_params 也没有可用配置:保留 last-training 的判定与 resume_offer,
    // 否则 resume banner 会因为回落路径丢掉 offer 而永不显示。
    return lastTrainingResult ?? fromSaved
  } catch {
    // 两端都取不到:reason 必须是 fetch_failed(调用方据此区分"没记录"和"取不到"),
    // 但 last-training 若已经拿到 resume_offer 就带上,别让 banner 白白丢掉。
    return {
      ok: false,
      source: 'none',
      schemaId: '',
      config: {},
      runId: '',
      reason: 'fetch_failed',
      resumeOffer: lastTrainingResult?.resumeOffer ?? null,
      suggestedResume: lastTrainingResult?.suggestedResume ?? null,
    }
  }
}

const KEY_PATH_HINTS = [
  'pretrained_model_name_or_path',
  'vae',
  'qwen3',
  'train_data_dir',
  'dataset_dir',
  'output_dir',
  'output_name',
  'network_weights',
]

/**
 * 值是否等于 schema 默认。
 *
 * 必须结构比较:createDefaultConfig 对数组默认值做的是 `[...f.defaultValue]`,
 * 每次调用都是新引用,`===` 恒为 false。于是 preview_groups / multiSelect 这类
 * 字段总被算成"用户改过",isDraftNearDefault 永远返回 false —— 空白草稿也拿不到
 * 静默 seed,而显式恢复则永远多弹一次覆盖确认。
 */
function isSameAsDefault(value: unknown, defaultValue: unknown): boolean {
  if (value === defaultValue) return true
  if (Array.isArray(value) && Array.isArray(defaultValue)) {
    return value.length === defaultValue.length && value.every((item, i) => isSameAsDefault(item, defaultValue[i]))
  }
  const valueIsBag = value && typeof value === 'object' && !Array.isArray(value)
  const defaultIsBag = defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)
  if (valueIsBag && defaultIsBag) {
    const a = value as Record<string, unknown>
    const b = defaultValue as Record<string, unknown>
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => Object.hasOwn(b, key) && isSameAsDefault(a[key], b[key]))
  }
  return false
}

/** 结构相等,或两侧都是字符串且 trim 后相等。 */
function isSameAfterTrim(value: unknown, defaultValue: unknown): boolean {
  if (isSameAsDefault(value, defaultValue)) return true
  if (typeof value === 'string' && typeof defaultValue === 'string') {
    return value.trim() === defaultValue.trim()
  }
  return false
}

/** 草稿是否仍近似默认(可静默 seed) */
export function isDraftNearDefault(typeId: string, draft: Record<string, unknown>): boolean {
  const defaults = createDefaultConfig(typeId) as Record<string, unknown>
  let meaningfulDiff = 0
  for (const [k, v] of Object.entries(draft || {})) {
    if (k.startsWith('_')) continue
    const d = defaults[k]
    if (isSameAfterTrim(v, d)) continue
    // 空数组/空对象在 schema 默认缺失时不算用户意图。
    if (Array.isArray(v) && v.length === 0 && (d == null || (Array.isArray(d) && d.length === 0))) continue
    // 路径类:占位/空不算用户意图
    if (typeof v === 'string' && KEY_PATH_HINTS.some((h) => k.includes(h) || k === h)) {
      if (isPathEmptyForAutofill(v, { key: k, defaultValue: d })) continue
    }
    if (v == null || v === '') continue
    meaningfulDiff += 1
    if (meaningfulDiff >= 3) return false
  }
  // 关键路径仍空/占位 → 更像默认
  for (const key of KEY_PATH_HINTS) {
    if (!(key in (defaults || {})) && draft[key] == null) continue
    const cur = draft[key]
    const def = defaults[key]
    // 与上面的通用分支同口径:两处必须都 trim 后比较。
    // 否则 output_name 多一个尾空格就会在这里被判成"用户有意图",
    // 而通用分支已经放过它 —— 同一个值两处结论相反,「上次训练」白弹确认框。
    if (cur != null && !isPathEmptyForAutofill(cur, { key, defaultValue: def }) && !isSameAfterTrim(cur, def)) {
      // 已有真实路径,若其它改动少仍可能 seed? 计划:关键路径非空则不算 near-default
      return false
    }
  }
  return meaningfulDiff < 3
}
