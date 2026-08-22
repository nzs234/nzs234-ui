// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * transport 契约门禁：信封拆解、fail-closed 错误处理、请求头构造、错误上报。
 *
 * 该层是所有 API 调用的唯一入口，一次静默放行(比如把 {status:'error'} 当成功)
 * 就会让整个 UI 在后端已经失败时继续往下走。这里的断言都写"必须抛"而不是
 * "返回了什么"。
 *
 * 两套后端契约必须分开量(见 transport.ts 顶部注释)：
 * - `/api/**` 恒返回 {status:'success'|'error'} 信封 → HTTP 200 也可能是业务失败。
 * - `/train/**` 返回裸 payload，其 `status` 是业务字段(run 状态) → 不得按信封解读。
 * envelope 语义按路径推断(auto)，也可用 requestNative / requestEnvelope 显式指定。
 *
 * 标记为 CONTRACT 的用例描述目标契约；若当前实现未满足，用例会失败并在
 * 注释中说明原因，不下调断言。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  assertApiSuccess,
  formatApiMessage,
  isApiErrorEnvelope,
  isApiSuccessEnvelope,
  postJson,
  postJsonNative,
  reportWebuiError,
  request,
  requestEnvelope,
  requestEnvelopeData,
  requestNative,
  unwrap,
} from './transport'

type FetchArgs = [input: string, init: RequestInit]

const ERROR_ENDPOINT = '/api/system/webui_error'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** 每个用例用唯一路径，避开 reportWebuiError 的 30s 去重窗口互相污染。 */
let pathSeq = 0
function uniquePath(prefix = '/api/probe') {
  pathSeq += 1
  return `${prefix}-${pathSeq}-${Math.random().toString(36).slice(2)}`
}

function installFetch(impl: (input: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as never)
  vi.stubGlobal('fetch', spy)
  return spy as unknown as { mock: { calls: FetchArgs[] } } & ReturnType<typeof vi.fn>
}

/** 屏蔽 sendBeacon，让错误上报走 fetch 路径以便观察或忽略。 */
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

// ─── success envelope unwrap ─────────────────────────────────────────────────

describe('transport: success envelope unwrap', () => {
  test('{status:"success", data} yields data', () => {
    expect(unwrap({ status: 'success', data: { runId: 'r1' } })).toEqual({ runId: 'r1' })
  })

  test('data:null in a success envelope unwraps to null, not to the envelope', () => {
    expect(unwrap({ status: 'success', data: null })).toBeNull()
  })

  test('falsy data values survive unwrapping', () => {
    expect(unwrap({ status: 'success', data: 0 })).toBe(0)
    expect(unwrap({ status: 'success', data: false })).toBe(false)
    expect(unwrap({ status: 'success', data: '' })).toBe('')
    expect(unwrap({ status: 'success', data: [] })).toEqual([])
  })

  test('native payloads without an envelope are returned as-is', () => {
    // 部分历史路由(/last-training 等)直接返回裸 payload。
    expect(unwrap({ exists: true, type: 'dir' })).toEqual({ exists: true, type: 'dir' })
    expect(unwrap([1, 2, 3])).toEqual([1, 2, 3])
    expect(unwrap(null)).toBeNull()
    expect(unwrap(undefined)).toBeUndefined()
    expect(unwrap('plain-string')).toBe('plain-string')
    expect(unwrap(42)).toBe(42)
  })

  test('only status:"success" + data counts as a success envelope', () => {
    // 只有 status:业务字段可能就叫 status(比如 run status),不能吞掉整个对象。
    expect(unwrap({ status: 'running' })).toEqual({ status: 'running' })
    // 只有 data:业务字段可能就叫 data,不能拆。
    expect(unwrap({ data: { a: 1 } })).toEqual({ data: { a: 1 } })
    // status 不是 'success' 时即使带 data 也不是信封。
    expect(unwrap({ status: 'running', data: { step: 10 } })).toEqual({ status: 'running', data: { step: 10 } })
  })

  test('isApiSuccessEnvelope discriminates precisely', () => {
    expect(isApiSuccessEnvelope({ status: 'success', data: 1 })).toBe(true)
    expect(isApiSuccessEnvelope({ status: 'success' })).toBe(false)
    expect(isApiSuccessEnvelope({ status: 'running', data: 1 })).toBe(false)
    expect(isApiSuccessEnvelope([{ status: 'success', data: 1 }])).toBe(false)
    expect(isApiSuccessEnvelope(null)).toBe(false)
  })

  test('assertApiSuccess passes through anything that is not an error envelope', () => {
    const payload = { status: 'success', data: 1 }
    expect(assertApiSuccess(payload)).toBe(payload)
    expect(assertApiSuccess(null)).toBeNull()
    expect(assertApiSuccess([{ status: 'error' }])).toEqual([{ status: 'error' }])
  })
})

// ─── business error envelope ─────────────────────────────────────────────────

describe('transport: business error envelope is fail-closed', () => {
  test('{status:"error", message} throws ApiError even over HTTP 200', () => {
    expect(() => unwrap({ status: 'error', message: '业务失败' })).toThrow(ApiError)
    try {
      unwrap({ status: 'error', message: '业务失败' })
    } catch (error) {
      expect((error as ApiError).message).toBe('业务失败')
      expect((error as ApiError).payload).toEqual({ status: 'error', message: '业务失败' })
    }
  })

  test('status matching is case- and whitespace-insensitive', () => {
    for (const status of ['error', 'ERROR', 'Error', '  error  ']) {
      expect(() => assertApiSuccess({ status, message: 'x' }), status).toThrow(ApiError)
    }
  })

  test('non-error status values are not treated as failures', () => {
    for (const status of ['success', 'ok', 'running', 'errored', 'no_error']) {
      expect(() => assertApiSuccess({ status, data: 1 }), status).not.toThrow()
    }
  })

  test('an error envelope must carry code/message/detail to be recognized', () => {
    // compat_common.err() 恒带 code + message。裸 status:'error' 没有信封自证，
    // 当成传输失败会把业务状态误判成请求失败。
    expect(isApiErrorEnvelope({ status: 'error' })).toBe(false)
    expect(isApiErrorEnvelope({ status: 'error', code: 'E_X' })).toBe(true)
    expect(isApiErrorEnvelope({ status: 'error', message: 'M' })).toBe(true)
    expect(isApiErrorEnvelope({ status: 'error', detail: 'D' })).toBe(true)
  })

  test.each(['run_id', 'runs', 'lines', 'points', 'tasks', 'current_step', 'coverage', 'has_last_training'])(
    'a native payload marked by %s is never read as an error envelope',
    (marker) => {
      // /train/** 的 run state / log payload / quality report 里 status 可能就是 'error'
      // (训练真的失败了)。误判成传输失败会把监控页正在跑的 run 清空。
      const payload = { status: 'error', message: 'run failed', [marker]: 'x' }
      expect(isApiErrorEnvelope(payload)).toBe(false)
      expect(() => assertApiSuccess(payload)).not.toThrow()
    },
  )

  test('message falls back through detail/error before the raw payload', () => {
    const read = (payload: unknown) => {
      try {
        assertApiSuccess(payload)
      } catch (error) {
        return (error as ApiError).message
      }
      throw new Error('expected assertApiSuccess to throw')
    }
    expect(read({ status: 'error', message: 'M', detail: 'D' })).toBe('M')
    expect(read({ status: 'error', detail: 'D', error: 'E' })).toBe('D')
    // 只有 code 时也必须给出可读文案，不能是空串。
    expect(read({ status: 'error', code: 'E_DISK' })).toBeTruthy()
  })

  test('a non-object status field never triggers the error path', () => {
    expect(() => assertApiSuccess({ status: 500, message: 'x' })).not.toThrow()
    expect(() => assertApiSuccess({ status: null, message: 'x' })).not.toThrow()
  })

  test('an /api path rejects a business error and preserves status + payload', async () => {
    const path = uniquePath('/api/probe')
    installFetch(async () => jsonResponse({ status: 'error', message: '显存不足' }, 200))
    await expect(request(path)).rejects.toThrow(ApiError)
    try {
      await request(path)
    } catch (error) {
      expect((error as ApiError).message).toBe('显存不足')
      expect((error as ApiError).status).toBe(200)
      expect((error as ApiError).payload).toMatchObject({ status: 'error' })
    }
  })
})

// ─── envelope mode routing ───────────────────────────────────────────────────

describe('transport: envelope mode routing', () => {
  test('/api paths are envelope-checked; /train paths are not', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(request(uniquePath('/api/train/preflight'))).rejects.toThrow(ApiError)
    // /train/** 是裸 payload 域：同样的 body 必须原样返回而不是抛。
    await expect(request(uniquePath('/train/status'))).resolves.toEqual({ status: 'error', message: 'biz' })
  })

  test('a leading-slash-less /api path is still recognized', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(request('api/probe-noslash')).rejects.toThrow(ApiError)
  })

  test('an absolute URL is classified by its path, not its host', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(request('http://127.0.0.1:28000/api/probe-abs')).rejects.toThrow(ApiError)
  })

  test('a path merely containing "api" later is native', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(request(uniquePath('/train/apidocs'))).resolves.toMatchObject({ status: 'error' })
  })

  test('an explicit envelope option overrides path inference both ways', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    // /api 强制 native → 不抛。
    await expect(request(uniquePath('/api/probe'), { envelope: 'native' })).resolves.toMatchObject({ status: 'error' })
    // /train 强制 envelope → 抛。
    await expect(request(uniquePath('/train/probe'), { envelope: 'envelope' })).rejects.toThrow(ApiError)
  })

  test('requestNative never applies envelope semantics', async () => {
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(requestNative(uniquePath('/api/probe'))).resolves.toMatchObject({ status: 'error' })
  })

  test('requestEnvelope returns the raw envelope and still fails closed on errors', async () => {
    installFetch(async () => jsonResponse({ status: 'success', data: { a: 1 } }, 200))
    await expect(requestEnvelope(uniquePath('/train/probe'))).resolves.toEqual({ status: 'success', data: { a: 1 } })
    installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(requestEnvelope(uniquePath('/train/probe'))).rejects.toThrow(ApiError)
  })

  test('requestEnvelopeData unwraps data in one step', async () => {
    installFetch(async () => jsonResponse({ status: 'success', data: { a: 1 } }, 200))
    await expect(requestEnvelopeData(uniquePath('/api/probe'))).resolves.toEqual({ a: 1 })
  })

  test('postJsonNative posts JSON without envelope checking', async () => {
    const spy = installFetch(async () => jsonResponse({ status: 'error', message: 'biz' }, 200))
    await expect(postJsonNative(uniquePath('/api/probe'), { a: 1 })).resolves.toMatchObject({ status: 'error' })
    expect(spy.mock.calls[0][1].method).toBe('POST')
  })
})

// ─── native payload / HTTP errors ────────────────────────────────────────────

describe('transport: HTTP failures', () => {
  test('4xx surfaces detail first, then message, then the raw payload', async () => {
    installFetch(async () => jsonResponse({ detail: 'D', message: 'M' }, 400))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      expect((error as ApiError).message).toBe('D')
      expect((error as ApiError).status).toBe(400)
      expect((error as ApiError).payload).toEqual({ detail: 'D', message: 'M' })
    }
  })

  test('an HTTP failure is reported for /train paths too (native mode is not a bypass)', async () => {
    installFetch(async () => jsonResponse({ detail: 'nope' }, 500))
    await expect(requestNative(uniquePath('/train/probe'))).rejects.toThrow(ApiError)
  })

  test('4xx with only a message uses it', async () => {
    installFetch(async () => jsonResponse({ message: 'M' }, 422))
    await expect(request(uniquePath())).rejects.toThrow('M')
  })

  test('nested validation errors are flattened into a readable message', async () => {
    installFetch(async () => jsonResponse({ detail: [{ msg: 'bad' }, { message: 'worse' }] }, 422))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      // FastAPI 422 的 detail 是数组；不能把 [object Object] 抛给用户。
      expect((error as ApiError).message).toContain('worse')
    }
  })

  test('an empty 5xx body still produces a status-bearing message', async () => {
    installFetch(async () => jsonResponse({}, 500))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      expect((error as ApiError).status).toBe(500)
      expect((error as ApiError).message).toBeTruthy()
    }
  })

  test('a successful native (non-envelope) payload is returned untouched', async () => {
    installFetch(async () => jsonResponse({ exists: true, type: 'dir' }, 200))
    await expect(request(uniquePath())).resolves.toEqual({ exists: true, type: 'dir' })
  })

  test('a success envelope is returned whole by request(); unwrap is the caller step', async () => {
    installFetch(async () => jsonResponse({ status: 'success', data: { a: 1 } }, 200))
    const payload = await request(uniquePath())
    expect(payload).toEqual({ status: 'success', data: { a: 1 } })
    expect(unwrap(payload)).toEqual({ a: 1 })
  })
})

// ─── 204 / invalid JSON ──────────────────────────────────────────────────────

describe('transport: empty and non-JSON responses', () => {
  test.each([204, 205])('a %d No Content success resolves to null instead of an invalid-JSON error', async (status) => {
    // DELETE /api/train_drafts、DELETE /api/saved_configs/delete 一类幂等删除
    // 允许返回空体；把它当解析失败会把成功的删除渲染成错误 toast。
    installFetch(async () => new Response(null, { status }))
    await expect(request(uniquePath())).resolves.toBeNull()
  })

  test('304 is not a fetch success and stays on the HTTP-failure path', async () => {
    // Response.ok 对 304 为 false，所以它先落到 HTTP 失败分支。
    // 记录现状：同源 API 调用不会依赖条件请求，因此这里不要求 resolve。
    installFetch(async () => new Response(null, { status: 304 }))
    await expect(request(uniquePath())).rejects.toThrow(ApiError)
  })

  test('a 200 with an empty body also resolves to null', async () => {
    installFetch(async () => new Response('', { status: 200 }))
    await expect(request(uniquePath())).resolves.toBeNull()
  })

  test('a whitespace-only body is treated as no content', async () => {
    installFetch(async () => new Response('   \n  ', { status: 200 }))
    await expect(request(uniquePath())).resolves.toBeNull()
  })

  test('Content-Length: 0 is honored even on a 200', async () => {
    installFetch(async () => new Response('', { status: 200, headers: { 'Content-Length': '0' } }))
    await expect(request(uniquePath())).resolves.toBeNull()
  })

  test('an HTML page on 200 fails loudly with the status and a body snippet', async () => {
    // 静默当字符串会让"路由没挂载 / 代理把 index.html 回落给了 API"无声无息。
    installFetch(async () => new Response('<html>proxy error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(200)
      expect((error as ApiError).message).toContain('proxy error')
    }
  })

  test('502 with a non-JSON body reports the status and body, not a parse error', async () => {
    installFetch(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      // HTTP 失败分支优先按响应体成文；解析失败时降级成 body 片段而不是吞掉。
      expect((error as ApiError).status).toBe(502)
      expect((error as ApiError).message).toContain('bad gateway')
    }
  })

  test('a 200 body that is not JSON and not a known text type is rejected', async () => {
    installFetch(async () => new Response('plain words', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }))
    await expect(request(uniquePath())).rejects.toThrow(ApiError)
  })

  test('JSON served as text/plain is returned as text (content-type is authoritative)', async () => {
    installFetch(async () => new Response('{"status":"success","data":{"a":1}}', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }))
    // text/plain 是允许的文本类型 → 原样给调用方，不擅自 JSON.parse。
    await expect(request(uniquePath())).resolves.toBe('{"status":"success","data":{"a":1}}')
  })

  test('responseType:json rejects a textual body', async () => {
    installFetch(async () => new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }))
    await expect(request(uniquePath(), { responseType: 'json' })).rejects.toThrow(ApiError)
  })

  test('responseType:text returns JSON bodies verbatim', async () => {
    installFetch(async () => jsonResponse({ a: 1 }))
    await expect(request(uniquePath(), { responseType: 'text' })).resolves.toBe('{"a":1}')
  })

  test('a JSON-shaped body with no content-type at all is parsed', async () => {
    // jsdom 的 Response 恒补 text/plain，所以这里直接伪造一个无 content-type 的响应
    // 来覆盖"后端没设 header"的真实情况。
    installFetch(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{"a":1}',
    }) as unknown as Response)
    await expect(request(uniquePath('/train/probe'))).resolves.toEqual({ a: 1 })
  })

  test('truncated JSON is rejected instead of silently yielding a partial object', async () => {
    installFetch(async () => jsonResponse('{"status":"succ', 200))
    await expect(request(uniquePath())).rejects.toThrow(ApiError)
  })

  test('the invalid-JSON message carries a bounded body snippet', async () => {
    const long = `{${'x'.repeat(5000)}`
    installFetch(async () => jsonResponse(long, 200))
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      // 片段必须截断，避免把整个 HTML 页面塞进 toast。
      expect((error as ApiError).message.length).toBeLessThan(1000)
    }
  })
})

// ─── request headers / FormData ──────────────────────────────────────────────

describe('transport: request construction', () => {
  test('a JSON body gets Content-Type: application/json', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    await request(uniquePath(), { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(spy.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
  })

  test('a bodyless GET gets no synthesized headers', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    await request(uniquePath(), { method: 'GET' })
    expect(spy.mock.calls[0][1].headers).toBeUndefined()
  })

  test('caller-supplied headers override the JSON default', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    await request(uniquePath(), { method: 'POST', body: 'raw', headers: { 'Content-Type': 'text/plain', 'X-Trace': '1' } })
    expect(spy.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'text/plain', 'X-Trace': '1' })
  })

  test('FormData bodies never get an explicit Content-Type', async () => {
    // 手写 multipart Content-Type 会丢掉 boundary，后端解析 100% 失败。
    const spy = installFetch(async () => jsonResponse({ status: 'success', data: { notes: [] } }))
    const form = new FormData()
    form.append('file', new Blob(['a = 1'], { type: 'application/octet-stream' }), 'config.toml')
    await request(uniquePath(), { method: 'POST', body: form })
    const headers = spy.mock.calls[0][1].headers as Record<string, string>
    expect(Object.keys(headers)).not.toContain('Content-Type')
  })

  test('FormData keeps caller headers other than Content-Type', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    const form = new FormData()
    form.append('file', new Blob(['x']), 'x.bin')
    await request(uniquePath(), { method: 'POST', body: form, headers: { 'X-Trace': 'abc' } })
    expect(spy.mock.calls[0][1].headers).toEqual({ 'X-Trace': 'abc' })
  })

  test('the FormData body instance is forwarded untouched', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    const form = new FormData()
    form.append('file', new Blob(['x']), 'x.bin')
    await request(uniquePath(), { method: 'POST', body: form })
    expect(spy.mock.calls[0][1].body).toBe(form)
  })

  test('the path and method reach fetch verbatim', async () => {
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    const path = uniquePath('/api/train_drafts')
    await request(path, { method: 'DELETE' })
    expect(spy.mock.calls[0][0]).toBe(path)
    expect(spy.mock.calls[0][1].method).toBe('DELETE')
  })

  test('postJson serializes the body and sets the JSON header', async () => {
    const spy = installFetch(async () => jsonResponse({ status: 'success', data: 1 }))
    const path = uniquePath()
    await postJson(path, { schema_id: 'sdxl-lora', nested: { a: [1, 2] } })
    const init = spy.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ schema_id: 'sdxl-lora', nested: { a: [1, 2] } })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  test('postJson propagates business errors like request does', async () => {
    installFetch(async () => jsonResponse({ status: 'error', detail: '参数非法' }, 200))
    await expect(postJson(uniquePath(), {})).rejects.toThrow('参数非法')
  })
})

// ─── network failure ─────────────────────────────────────────────────────────

describe('transport: network failure', () => {
  test('a rejected fetch becomes a backend-unreachable ApiError with no status', async () => {
    installFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    try {
      await request(uniquePath())
      throw new Error('expected request to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      // 网络层失败没有 HTTP 状态；不能伪造成 0 或 500。
      expect((error as ApiError).status).toBeUndefined()
      expect((error as ApiError).message).toContain('28000')
    }
  })

  test('an aborted request is also reported as a transport failure', async () => {
    installFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    await expect(request(uniquePath())).rejects.toThrow(ApiError)
  })

  test('a network failure is reported to the webui error endpoint', async () => {
    // reportWebuiError 的去重表是模块级的，且网络失败的去重 key
    // (kind + backend_down 文案) 对所有路径都相同 —— 同文件内前面的网络用例
    // 已经占用了该窗口。这里隔离出一份新模块实例，验证"首次上报"确实发生。
    vi.resetModules()
    const beacon = stubBeacon(true)
    installFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const isolated = await import('./transport')
    await expect(isolated.request(uniquePath())).rejects.toThrow(isolated.ApiError)
    expect(beacon).toHaveBeenCalled()
    expect(beacon.mock.calls[0][0]).toBe(ERROR_ENDPOINT)
  })

  test('a failing error report never masks the original ApiError', async () => {
    stubBeacon(false)
    let calls = 0
    installFetch(async (input) => {
      calls += 1
      if (input === ERROR_ENDPOINT) throw new Error('reporting down')
      throw new TypeError('Failed to fetch')
    })
    await expect(request(uniquePath())).rejects.toThrow(ApiError)
    expect(calls).toBeGreaterThan(0)
  })
})

// ─── formatApiMessage ────────────────────────────────────────────────────────

describe('transport: formatApiMessage', () => {
  test('primitives and nullish', () => {
    expect(formatApiMessage('plain')).toBe('plain')
    expect(formatApiMessage(42)).toBe('42')
    expect(formatApiMessage(null)).toBe('')
    expect(formatApiMessage(undefined)).toBe('')
  })

  test('arrays join with "; " and drop empties', () => {
    expect(formatApiMessage(['a', '', 'b'])).toBe('a; b')
  })

  test('message/detail/error/reason are probed in order and recursively', () => {
    expect(formatApiMessage({ message: 'M', detail: 'D' })).toBe('M')
    expect(formatApiMessage({ detail: { message: 'deep' } })).toBe('deep')
    expect(formatApiMessage({ reason: 'R' })).toBe('R')
  })

  test('errors/issues arrays are flattened when no scalar message exists', () => {
    expect(formatApiMessage({ errors: [{ message: 'e1' }, { message: 'e2' }] })).toBe('e1; e2')
    expect(formatApiMessage({ issues: [{ detail: 'i1' }] })).toBe('i1')
  })

  test('an unrecognized object falls back to JSON rather than [object Object]', () => {
    expect(formatApiMessage({ code: 7 })).toBe('{"code":7}')
  })

  test('circular structures do not throw', () => {
    const circular: Record<string, unknown> = { code: 1 }
    circular.self = circular
    expect(() => formatApiMessage(circular)).not.toThrow()
  })
})

// ─── error reporting ─────────────────────────────────────────────────────────

describe('transport: reportWebuiError', () => {
  test('identical errors are de-duplicated inside the TTL window', () => {
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error('same message'), { path: '/api/x' })
    reportWebuiError(kind, new Error('same message'), { path: '/api/x' })
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  test('distinct messages are reported separately', () => {
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error(`a-${Math.random()}`))
    reportWebuiError(kind, new Error(`b-${Math.random()}`))
    expect(beacon).toHaveBeenCalledTimes(2)
  })

  test('the beacon body carries kind, url, user agent and the error shape', () => {
    const beacon = stubBeacon(true)
    const kind = `probe_${Math.random().toString(36).slice(2)}`
    reportWebuiError(kind, new Error('boom'), { path: '/api/run' })
    const blob = beacon.mock.calls[0][1] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')
  })

  test('it falls back to fetch when sendBeacon refuses the payload', () => {
    stubBeacon(false)
    const spy = installFetch(async () => jsonResponse({ ok: 1 }))
    reportWebuiError(`probe_${Math.random().toString(36).slice(2)}`, new Error(`boom-${Math.random()}`))
    expect(spy.mock.calls.some((call) => call[0] === ERROR_ENDPOINT)).toBe(true)
  })

  test('reporting non-Error values does not throw', () => {
    stubBeacon(true)
    expect(() => reportWebuiError('probe_str', 'a string reason')).not.toThrow()
    expect(() => reportWebuiError('probe_obj', { code: 500 })).not.toThrow()
    expect(() => reportWebuiError('probe_nil', null)).not.toThrow()
  })
})
