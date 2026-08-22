// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* HTTP 传输层:同源相对路径,统一拒绝 HTTP/业务错误信封;
   错误统一格式化并上报 /api/system/webui_error(sendBeacon 优先,30s 去重)

   两套后端契约必须区分,不能用同一把尺子量:
   - `/api/**`(resources/web/routers/compat*.py)恒返回 {status:'success'|'error', ...} 信封,
     HTTP 200 也可能是业务失败 → 必须 fail-closed。
   - `/train/**`(resources/web/routers/backend_native.py)返回裸 payload,其中 `status` 是
     业务字段(run 状态、report 可用性等)。把裸 payload 的 status 当信封解读会把正常响应
     误判成错误 —— 所以信封判定按路径推断(auto),并提供显式的 native/envelope helper。 */
import { translate } from '@/i18n/useI18n'

const ERROR_ENDPOINT = '/api/system/webui_error'
const MAX_TEXT = 4000
const RECENT_TTL_MS = 30000
const BODY_SNIPPET = 200
const recent = new Map<string, number>()

function compactText(value: unknown, max = MAX_TEXT): string {
  const text = value == null ? '' : String(value)
  return text.length > max ? text.slice(0, max) : text
}

function errorToPayload(error: unknown): Record<string, unknown> {
  if (!error) return {}
  if (error instanceof Error) {
    return {
      name: compactText(error.name, 200),
      message: compactText(error.message),
      stack: compactText(error.stack || ''),
    }
  }
  if (typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error)) as Record<string, unknown>
    } catch {
      return { message: compactText(error) }
    }
  }
  return { message: compactText(error) }
}

export function reportWebuiError(kind: string, error: unknown, context: Record<string, unknown> = {}) {
  const payload = {
    kind: compactText(kind || 'webui_error', 120),
    url: compactText(window.location?.href || '', 1000),
    user_agent: compactText(window.navigator?.userAgent || '', 1000),
    error: errorToPayload(error),
    context,
  }
  // path 无条件参与去重 key:不同端点的同名失败(例如两个路由都 500 "Internal
  // Server Error")是两件独立的事,合并掉会让第二个端点的故障永远上报不出去。
  const key = [
    payload.kind,
    String(context?.path ?? ''),
    (payload.error as { message?: string })?.message || '',
  ].join('|')
  const now = Date.now()
  for (const [k, ts] of recent.entries()) if (now - ts > RECENT_TTL_MS) recent.delete(k)
  if (now - (recent.get(key) ?? 0) < RECENT_TTL_MS) return
  recent.set(key, now)
  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(ERROR_ENDPOINT, blob)) return
    }
    void fetch(ERROR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {
    /* 上报失败静默 */
  }
}

export function installGlobalErrorReporter() {
  window.addEventListener('error', (e) => {
    reportWebuiError('window_error', e.error ?? e.message, { source: e.filename, line: e.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportWebuiError('unhandled_rejection', e.reason)
  })
}

export function formatApiMessage(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(formatApiMessage).filter(Boolean).join('; ')
  const obj = value as Record<string, unknown>
  for (const key of ['message', 'detail', 'error', 'reason']) {
    const text = formatApiMessage(obj[key])
    if (text) return text
  }
  for (const key of ['errors', 'issues']) {
    const arr = obj[key]
    if (Array.isArray(arr) && arr.length) {
      const text = arr.map(formatApiMessage).filter(Boolean).join('; ')
      if (text) return text
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export class ApiError extends Error {
  status?: number
  payload?: unknown
  constructor(message: string, status?: number, payload?: unknown) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

/* ------------------------------------------------------------------ *
 * 信封契约
 * ------------------------------------------------------------------ */

/** compat_common.ok(): {status:'success', data} */
export interface ApiSuccessEnvelope<T = unknown> {
  status: 'success'
  data?: T
}

/** compat_common.err(): {status:'error', code, message} */
export interface ApiErrorEnvelope {
  status: 'error'
  code?: string
  message?: unknown
  detail?: unknown
}

export type ApiEnvelope<T = unknown> = ApiSuccessEnvelope<T> | ApiErrorEnvelope

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function envelopeStatus(payload: unknown): string {
  const obj = plainObject(payload)
  if (!obj || typeof obj.status !== 'string') return ''
  return obj.status.trim().toLowerCase()
}

/**
 * 信封判定的作用域。
 * - `envelope`:调用方已知这是 `/api/**` compat 域 → `status:'error'` 恒 fail-closed,
 *   不做任何 marker 豁免。compat_common.err() 只会产出 {status,code,message},
 *   裸 payload 的自证键在这个域里根本不可能出现在顶层,豁免只会削弱 fail-closed。
 * - `native`:裸 payload 域,`status` 是业务字段 → 永不按信封解读。
 * - `auto`:来源未知(例如 unwrap 拿到的是已经取回的对象),用 marker 启发式兜底。
 */
export type EnvelopeScope = 'auto' | 'envelope' | 'native'

/** 裸 payload 的自证键:出现任一即说明这是业务对象,不是 compat 错误信封。 */
const NATIVE_PAYLOAD_MARKERS = [
  'run_id',
  'runs',
  'queued_runs',
  'current_run_id',
  'lines',
  'points',
  'events',
  'tasks',
  'current_step',
  'total_steps',
  'coverage',
  'has_last_training',
]

/**
 * 只有 compat 错误信封才算 envelope 错误。
 *
 * scope='envelope'(显式的 `/api/**` 调用)时只要求 `status:'error'` + 有 code/message/detail:
 * 这个域里的 marker 豁免是纯粹的削弱 —— 后端只可能是 compat_common.err(),而一个
 * 恰好带 `run_id` 字段的错误信封(err() 的 message 里带 run 信息、或将来给 err()
 * 加上上下文)会被豁免成"成功",让 UI 在后端已经失败时继续往下走。
 *
 * scope='auto'(来源未知,例如直接对已取回对象调 unwrap)才启用 marker 启发式:
 * `/train/**` 的 run state / log payload / quality report 里 `status` 可能就是 'error'
 * (训练真的失败了),误判成传输失败会把监控页正在跑的 run 清空。
 */
export function isApiErrorEnvelope(payload: unknown, scope: EnvelopeScope = 'auto'): payload is ApiErrorEnvelope {
  if (scope === 'native') return false
  if (envelopeStatus(payload) !== 'error') return false
  const obj = payload as Record<string, unknown>
  if (scope !== 'envelope' && NATIVE_PAYLOAD_MARKERS.some((key) => key in obj)) return false
  return 'code' in obj || 'message' in obj || 'detail' in obj
}

export function isApiSuccessEnvelope<T = unknown>(payload: unknown): payload is ApiSuccessEnvelope<T> {
  return envelopeStatus(payload) === 'success' && plainObject(payload) !== null && 'data' in (payload as object)
}

function apiBusinessError(payload: unknown, status?: number, scope: EnvelopeScope = 'auto'): ApiError | null {
  if (!isApiErrorEnvelope(payload, scope)) return null
  const obj = payload as unknown as Record<string, unknown>
  return new ApiError(
    formatApiMessage(obj.message ?? obj.detail ?? obj.error ?? payload) || translate('api.request_fail', { status: status ?? 200 }),
    status,
    payload,
  )
}

/**
 * 兼容 API 会以 HTTP 200 返回 {status:'error'}；该信封必须与 HTTP 失败同样 fail-closed。
 *
 * scope 由调用方给出:`request()` 已按路径/显式选项判定过是哪个域,把结论传下来,
 * 不要在这里重新猜。省略时是 'auto'(启发式),仅供拿不到来源信息的调用方使用。
 */
export function assertApiSuccess<T = unknown>(payload: T, status?: number, scope: EnvelopeScope = 'auto'): T {
  const error = apiBusinessError(payload, status, scope)
  if (error) throw error
  return payload
}

/* ------------------------------------------------------------------ *
 * request
 * ------------------------------------------------------------------ */

/** 信封语义:auto = 按路径推断(/api → envelope,其余 native)。 */
export type TransportEnvelopeMode = 'auto' | 'envelope' | 'native'

/** 响应体解析:auto = 按 content-type;json = 必须 JSON;text = 恒返回文本。 */
export type TransportResponseType = 'auto' | 'json' | 'text'

export interface TransportOptions extends RequestInit {
  envelope?: TransportEnvelopeMode
  responseType?: TransportResponseType
}

const TEXTUAL_CONTENT_TYPES = ['text/plain', 'text/csv', 'text/markdown', 'application/x-ndjson']

function resolveEnvelopeMode(path: string, mode: TransportEnvelopeMode | undefined): 'envelope' | 'native' {
  if (mode === 'envelope' || mode === 'native') return mode
  // 同源相对路径:/api 前缀即 compat 信封域。
  return /^\/?api(\/|$)/.test(path.replace(/^https?:\/\/[^/]+/i, '')) ? 'envelope' : 'native'
}

function invalidJsonError(path: string, status: number, snippet: string): ApiError {
  const base =
    status === 502
      ? translate('api.backend_not_started')
      : translate('api.invalid_json', { path })
  return new ApiError(snippet ? `${base} · ${snippet}` : base, status)
}

/** 无内容响应(204/205/304 或空 body)统一表达为 null。 */
function isNoContentStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function parseBody(
  text: string,
  contentType: string,
  responseType: TransportResponseType,
  path: string,
  status: number,
): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (responseType === 'text') return text
  const type = contentType.toLowerCase()
  const looksJson = type.includes('json') || (!type && /^[[{"]/.test(trimmed))
  if (looksJson) {
    try {
      return JSON.parse(text)
    } catch {
      throw invalidJsonError(path, status, compactText(trimmed, BODY_SNIPPET))
    }
  }
  if (responseType === 'json') {
    throw invalidJsonError(path, status, compactText(trimmed, BODY_SNIPPET))
  }
  if (TEXTUAL_CONTENT_TYPES.some((candidate) => type.includes(candidate))) return text
  // text/html 等:通常是路由未挂载 / 代理错配把 index.html 回落给了 API 调用。
  // 静默当成字符串会让契约漂移无声无息,必须显式失败。
  throw invalidJsonError(path, status, compactText(trimmed, BODY_SNIPPET))
}

export async function request<T = unknown>(path: string, options: TransportOptions = {}): Promise<T> {
  const { envelope, responseType = 'auto', ...init } = options
  let response: Response
  try {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    const headers: HeadersInit | undefined = isFormData
      ? { ...(init.headers || {}) }
      : init.body
        ? { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
        : init.headers
    response = await fetch(path, {
      ...init,
      headers,
    })
  } catch {
    const error = new ApiError(translate('api.backend_down'))
    reportWebuiError('api_network_error', error, { path, method: init.method || 'GET' })
    throw error
  }

  const contentType = response.headers?.get?.('content-type') || ''
  const noContent = isNoContentStatus(response.status) || response.headers?.get?.('content-length') === '0'
  const rawText = noContent ? '' : await readBodyText(response)

  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = parseBody(rawText, contentType, 'auto', path, response.status)
    } catch {
      payload = rawText ? compactText(rawText.trim(), BODY_SNIPPET) : null
    }
    const obj = plainObject(payload)
    const error = new ApiError(
      formatApiMessage(obj?.detail ?? obj?.message ?? payload) || translate('api.request_fail', { status: response.status }),
      response.status,
      payload,
    )
    reportWebuiError('api_response_error', error, { path, status: response.status })
    throw error
  }

  let payload: unknown
  try {
    payload = noContent ? null : parseBody(rawText, contentType, responseType, path, response.status)
  } catch (error) {
    reportWebuiError('api_invalid_json', error, { path, status: response.status })
    throw error
  }

  if (resolveEnvelopeMode(path, envelope) === 'native') return payload as T
  try {
    // 显式 'envelope' scope:该域内不做 marker 豁免。
    return assertApiSuccess(payload as T, response.status, 'envelope')
  } catch (error) {
    reportWebuiError('api_business_error', error, { path, status: response.status })
    throw error
  }
}

/** `/train/**` 等裸 payload 路由:绝不把业务 `status` 当信封。 */
export function requestNative<T = unknown>(path: string, options: TransportOptions = {}): Promise<T> {
  return request<T>(path, { ...options, envelope: 'native' })
}

/** `/api/**` compat 路由:强制 success/error 信封语义,返回原始信封。 */
export function requestEnvelope<T = unknown>(path: string, options: TransportOptions = {}): Promise<ApiEnvelope<T>> {
  return request<ApiEnvelope<T>>(path, { ...options, envelope: 'envelope' })
}

/** `/api/**` compat 路由:强制信封语义并直接拆出 data。 */
export async function requestEnvelopeData<T = unknown>(path: string, options: TransportOptions = {}): Promise<T> {
  return unwrap<T>(await requestEnvelope<T>(path, options), 'envelope')
}

export function postJson<T = unknown>(path: string, data: unknown, options: TransportOptions = {}): Promise<T> {
  return request<T>(path, { ...options, method: options.method || 'POST', body: JSON.stringify(data) })
}

export function postJsonNative<T = unknown>(path: string, data: unknown, options: TransportOptions = {}): Promise<T> {
  return postJson<T>(path, data, { ...options, envelope: 'native' })
}

/**
 * 拆成功信封:{status:'success', data} → data;业务错误信封抛 ApiError。
 *
 * 默认 scope 是 'auto':unwrap 拿到的只是一个对象,看不出它来自哪个域,
 * 所以保留 marker 启发式。已知来自 `/api/**` 的调用方应显式传 'envelope',
 * 那样即使信封里带了 run_id 之类的字段也照样 fail-closed。
 */
export function unwrap<T = unknown>(payload: unknown, scope: EnvelopeScope = 'auto'): T {
  const checked = assertApiSuccess(payload, undefined, scope)
  if (isApiSuccessEnvelope<T>(checked)) return (checked as ApiSuccessEnvelope<T>).data as T
  return checked as T
}
