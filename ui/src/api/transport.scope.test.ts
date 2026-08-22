// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * transport 的 envelope scope 契约(第二轮 code review 的 P0/P1)。
 *
 * 背景:裸 payload 的自证键(run_id/lines/points…)豁免是为了 `/train/**` 服务的 ——
 * 那个域里 `status:'error'` 是业务事实(训练真的失败了),误判成传输失败会把监控页
 * 正在跑的 run 清空。但这个豁免一旦无条件生效,就顺带削弱了 `/api/**`:
 * compat_common.err() 的信封里将来只要出现一个 run_id 字段,fail-closed 就失效了,
 * UI 会在后端已经失败时继续往下走。
 *
 * 结论:scope 必须由调用方给出。envelope 域不做豁免,native 域永不按信封解读,
 * auto 才用启发式。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  assertApiSuccess,
  isApiErrorEnvelope,
  reportWebuiError,
  request,
  requestEnvelope,
  requestEnvelopeData,
  requestNative,
  unwrap,
} from './transport'

const ERROR_ENDPOINT = '/api/system/webui_error'

/** 恰好同时是 compat 错误信封、又带裸 payload 自证键的 body。 */
const AMBIGUOUS_ERROR = { status: 'error', code: 'E_RUN', message: '启动失败', run_id: 'r-42' }

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

let pathSeq = 0
function uniquePath(prefix = '/api/scope') {
  pathSeq += 1
  return `${prefix}-${pathSeq}-${Math.random().toString(36).slice(2)}`
}

function installFetch(impl: (input: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as never)
  vi.stubGlobal('fetch', spy)
  return spy as unknown as { mock: { calls: [string, RequestInit][] } } & ReturnType<typeof vi.fn>
}

function stubBeacon(result: boolean | undefined = true) {
  const beacon = vi.fn().mockReturnValue(result)
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true })
  return beacon
}

beforeEach(() => {
  stubBeacon(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── explicit scope ──────────────────────────────────────────────────────────

describe('transport: assertApiSuccess accepts an explicit envelope scope', () => {
  test('envelope scope rejects status:error even when a native marker is present', () => {
    // 这是本轮修的核心:豁免不能削弱 /api 域的 fail-closed。
    expect(() => assertApiSuccess(AMBIGUOUS_ERROR, 200, 'envelope')).toThrow(ApiError)
    expect(isApiErrorEnvelope(AMBIGUOUS_ERROR, 'envelope')).toBe(true)
  })

  test('auto scope keeps the marker heuristic for callers with no provenance', () => {
    expect(() => assertApiSuccess(AMBIGUOUS_ERROR, 200, 'auto')).not.toThrow()
    expect(isApiErrorEnvelope(AMBIGUOUS_ERROR, 'auto')).toBe(false)
  })

  test('the default scope is auto (unchanged behaviour for existing callers)', () => {
    expect(() => assertApiSuccess(AMBIGUOUS_ERROR)).not.toThrow()
    expect(isApiErrorEnvelope(AMBIGUOUS_ERROR)).toBe(false)
  })

  test('native scope never reads an envelope, marker or not', () => {
    expect(() => assertApiSuccess({ status: 'error', code: 'E_X', message: 'm' }, 200, 'native')).not.toThrow()
    expect(isApiErrorEnvelope({ status: 'error', code: 'E_X' }, 'native')).toBe(false)
  })

  test('envelope scope still requires code/message/detail to call it an error', () => {
    // 裸 status:'error' 没有信封自证;compat_common.err() 恒带 code + message。
    expect(isApiErrorEnvelope({ status: 'error' }, 'envelope')).toBe(false)
    expect(() => assertApiSuccess({ status: 'error' }, 200, 'envelope')).not.toThrow()
  })

  test('envelope scope leaves success and other statuses alone', () => {
    for (const status of ['success', 'running', 'queued']) {
      expect(() => assertApiSuccess({ status, data: 1 }, 200, 'envelope'), status).not.toThrow()
    }
  })
})

// ─── request() feeds the scope down ──────────────────────────────────────────

describe('transport: request derives the scope and passes it down', () => {
  test('an /api path fails closed on an ambiguous error envelope', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    // 旧行为:run_id 让它被豁免成"成功",调用方拿到一个 error 信封当数据用。
    await expect(request(uniquePath('/api/run'))).rejects.toThrow(ApiError)
  })

  test('a /train path still returns the same body untouched', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    await expect(request(uniquePath('/train/status'))).resolves.toMatchObject({ run_id: 'r-42' })
  })

  test('an explicit envelope option on a /train path applies the strict scope', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    await expect(request(uniquePath('/train/probe'), { envelope: 'envelope' })).rejects.toThrow(ApiError)
  })

  test('requestNative on an /api path stays permissive', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    await expect(requestNative(uniquePath('/api/probe'))).resolves.toMatchObject({ status: 'error' })
  })

  test('requestEnvelope fails closed on the ambiguous body', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    await expect(requestEnvelope(uniquePath('/train/probe'))).rejects.toThrow(ApiError)
  })

  test('requestEnvelopeData applies the strict scope while unwrapping', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    await expect(requestEnvelopeData(uniquePath('/api/probe'))).rejects.toThrow(ApiError)
  })

  test('the thrown error keeps the message and payload of the envelope', async () => {
    installFetch(async () => jsonResponse(AMBIGUOUS_ERROR, 200))
    try {
      await request(uniquePath('/api/run'))
      throw new Error('expected request to reject')
    } catch (error) {
      expect((error as ApiError).message).toBe('启动失败')
      expect((error as ApiError).payload).toMatchObject({ run_id: 'r-42' })
    }
  })
})

// ─── unwrap scope ────────────────────────────────────────────────────────────

describe('transport: unwrap accepts a scope', () => {
  test('unwrap defaults to auto for backwards compatibility', () => {
    expect(unwrap(AMBIGUOUS_ERROR)).toMatchObject({ run_id: 'r-42' })
  })

  test('unwrap with the envelope scope fails closed', () => {
    expect(() => unwrap(AMBIGUOUS_ERROR, 'envelope')).toThrow(ApiError)
  })

  test('unwrap with the envelope scope still unwraps data normally', () => {
    expect(unwrap({ status: 'success', data: { a: 1 } }, 'envelope')).toEqual({ a: 1 })
    expect(unwrap({ status: 'success', data: null }, 'envelope')).toBeNull()
  })

  test('unwrap with the native scope passes an error envelope straight through', () => {
    expect(unwrap({ status: 'error', code: 'E', message: 'm' }, 'native')).toMatchObject({ code: 'E' })
  })
})

// ─── error report dedupe key ─────────────────────────────────────────────────

describe('transport: reportWebuiError dedupe key always includes the path', () => {
  test('the same message on two different paths is reported twice', () => {
    // 两个端点各自 500 "Internal Server Error" 是两件独立的事;合并去重会让
    // 第二个端点的故障永远上报不出去。
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    const error = new Error('Internal Server Error')
    reportWebuiError(kind, error, { path: '/api/train/preflight', status: 500 })
    reportWebuiError(kind, error, { path: '/api/run', status: 500 })
    expect(beacon).toHaveBeenCalledTimes(2)
  })

  test('the same message on the same path is still de-duplicated', () => {
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error('same'), { path: '/api/same' })
    reportWebuiError(kind, new Error('same'), { path: '/api/same' })
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  test('a missing path degrades to an empty segment without merging distinct messages', () => {
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error(`a-${Math.random()}`))
    reportWebuiError(kind, new Error(`b-${Math.random()}`))
    expect(beacon).toHaveBeenCalledTimes(2)
  })

  test('an empty message on two paths does not collapse into one report', () => {
    // 旧 key 在 message 为空时才退回 path;非空 message 会完全遮住 path。
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error(''), { path: '/api/a' })
    reportWebuiError(kind, new Error(''), { path: '/api/b' })
    expect(beacon).toHaveBeenCalledTimes(2)
  })

  test('two failing endpoints both reach the reporting endpoint through request()', async () => {
    stubBeacon(false)
    const spy = installFetch(async (input) => {
      if (input === ERROR_ENDPOINT) return jsonResponse({ ok: 1 })
      return jsonResponse({ detail: 'Internal Server Error' }, 500)
    })
    const suffix = Math.random().toString(36).slice(2)
    await expect(request(`/api/alpha-${suffix}`)).rejects.toThrow(ApiError)
    await expect(request(`/api/beta-${suffix}`)).rejects.toThrow(ApiError)
    const reports = spy.mock.calls.filter((call) => call[0] === ERROR_ENDPOINT)
    expect(reports).toHaveLength(2)
  })
})
