// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 错误码→i18n 映射层(F2 收口)。
 *
 * 后端错误面(调研结论,2026-08):
 * - `/api/**` compat 信封:compat_common.err() 恒返回 {status:'error',code,message},
 *   但所有调用点都用默认 code='error'(泛化),没有稳定业务错误码。
 * - `/train/**`(backend_native)HTTP 失败时 detail 可为结构体:
 *   {message, code, issue:{code,...}} —— code 来自 LulynxError 体系
 *   (config.invalid / request.invalid / runtime.resolution_failed /
 *    plugin.execution_failed / user.action_required / runtime.unhandled_exception),
 *   这里有稳定错误码通道。
 * - 其余 HTTPException 大多只有裸字符串 detail(中/英混杂),FastAPI 校验错是数组。
 *
 * 因此策略是双轨:
 *  1. 已知 code → 映射到双语 i18n 键(api.error.*);
 *  2. 未知 code → 按界面语言处理原文:zh 直接展示中文原文;en 下原文可读则展示,
 *     原文是中文(CJK)时给「按 HTTP 状态分类的通用文案」+ 把原文挂到次要行,
 *     信息不丢失。 */
import { translate } from '@/i18n/useI18n'
import { useLocaleStore } from '@/stores/localeStore'

/** LulynxError 体系(core/contracts/errors.py)的稳定码 → i18n 键。 */
export const API_ERROR_CODE_KEYS: Record<string, string> = {
  'config.invalid': 'api.error.config_invalid',
  'request.invalid': 'api.error.request_invalid',
  'runtime.resolution_failed': 'api.error.runtime_resolution_failed',
  'plugin.execution_failed': 'api.error.plugin_execution_failed',
  'user.action_required': 'api.error.user_action_required',
  'runtime.unhandled_exception': 'api.error.runtime_unhandled_exception',
  /* /train/queue 工作台(routers/training_queue.py)的业务冲突码。 */
  training_queue_revision_conflict: 'api.error.training_queue_revision_conflict',
  training_queue_control_conflict: 'api.error.training_queue_control_conflict',
  training_queue_invalid: 'api.error.training_queue_invalid',
}

/** 未知 code 时按 HTTP 状态类别兜底的通用文案键。 */
export const API_ERROR_STATUS_KEYS = {
  unauthorized: 'api.error.http_unauthorized',
  forbidden: 'api.error.http_forbidden',
  not_found: 'api.error.http_not_found',
  conflict: 'api.error.http_conflict',
  validation: 'api.error.http_validation',
  rate_limited: 'api.error.http_rate_limited',
  server: 'api.error.http_server',
} as const

export type HttpStatusCategory = keyof typeof API_ERROR_STATUS_KEYS

const VALIDATION_STATUSES = new Set([400, 413, 414, 415, 422, 431])

/** HTTP status → 兜底文案类别;无法分类时返回 ''(调用方走 api.request_fail)。 */
export function classifyHttpStatus(status?: number): HttpStatusCategory | '' {
  if (status == null || !Number.isFinite(status)) return ''
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (VALIDATION_STATUSES.has(status)) return 'validation'
  if (status >= 500 && status < 600) return 'server'
  return ''
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * 从后端响应体提取稳定错误码。
 * 优先级:信封顶层 code > detail.code > detail.issue.code(/train/** 平台 issue 形态)。
 * 提不到返回空串——不是所有路由都带码,FastAPI 校验错的 detail 是数组。
 */
export function extractApiErrorCode(payload: unknown): string {
  const obj = plainObject(payload)
  if (!obj) return ''
  if (typeof obj.code === 'string' && obj.code.trim()) return obj.code.trim()
  const detail = plainObject(obj.detail)
  if (detail) {
    if (typeof detail.code === 'string' && detail.code.trim()) return detail.code.trim()
    const issue = plainObject(detail.issue)
    if (issue && typeof issue.code === 'string' && issue.code.trim()) return issue.code.trim()
  }
  return ''
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 原文是否含汉字(判定「EN 界面会裸露中文」的启发式)。 */
export function textHasCjk(text: string): boolean {
  return CJK_RE.test(text)
}

export interface ComposedApiMessage {
  /** 主展示行(当前语言可读)。 */
  message: string
  /** 提取到的稳定错误码;'' 表示未知。 */
  code: string
  /** 后端原始消息(formatApiMessage 结果),恒保留供上报/次要行使用。 */
  raw: string
  /** 次要展示行(EN 下后端中文原文);无次要行时为空串。 */
  detail: string
}

function genericStatusMessage(category: HttpStatusCategory | '', status?: number): string {
  const key = category ? API_ERROR_STATUS_KEYS[category] : 'api.request_fail'
  // request_fail / http_server 的模板都带 {status};其余键没有占位符,
  // 多余的 vars 无害。缺 status 时必须别传 vars,否则插值漏成裸 "{status}"。
  return translate(key, status != null ? { status } : undefined)
}

/**
 * transport 的统一合成入口:给定已格式化的后端原文 + 原始 payload + HTTP 状态,
 * 按已知 code → 语言/可读性回退的两级策略产出主行与次要行。
 */
export function composeApiErrorMessage(raw: string, payload: unknown, status?: number): ComposedApiMessage {
  const code = extractApiErrorCode(payload)
  const mappedKey = code ? API_ERROR_CODE_KEYS[code] : ''
  if (mappedKey) return { message: translate(mappedKey), code, raw, detail: '' }
  // 未知 code / 无 code:按界面语言与原文可读性回退。
  const language = useLocaleStore.getState().language
  const rawUsable = Boolean(raw.trim())
  if (language !== 'en' || !rawUsable || !textHasCjk(raw)) {
    return { message: raw, code, raw, detail: '' }
  }
  // EN 界面 + 中文原文:通用分类文案做主行,原文下沉为次要行(信息不丢)。
  return { message: genericStatusMessage(classifyHttpStatus(status), status), code, raw, detail: raw }
}

/** 展示侧统一出口:主行 + 可选次要行。非 ApiError 值按自身 message 透传。 */
export function describeApiError(error: unknown): { text: string; detail?: string } {
  if (!(error instanceof Error)) return { text: error == null ? '' : String(error) }
  // 鸭子判定 detail 字段,避免与 transport 形成循环依赖。
  const detail = (error as { detail?: unknown }).detail
  return {
    text: error.message,
    detail: typeof detail === 'string' && detail.trim() ? detail : undefined,
  }
}
