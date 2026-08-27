// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * queueApi 契约门禁(对应 backend/routers/training_queue.py):
 * - 方法/路径/请求体逐一断言,pause/resume 无请求体,reorder/replay 是 JSON;
 * - `/train/**` 是裸 payload 域:`status`(paused/queued/training_started 等)
 *   是业务字段,绝不能被信封解读吞掉 —— 响应必须原样透传。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { queueApi } from './queueApi'

type FetchArgs = [input: string, init?: RequestInit]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(payload: unknown): { mock: { calls: FetchArgs[] } } {
  const spy = vi.fn(async () => jsonResponse(payload))
  vi.stubGlobal('fetch', spy)
  return spy as unknown as { mock: { calls: FetchArgs[] } }
}

const PROJECTION = {
  revision: 7,
  current_run_id: 'run-cur',
  current_status: 'running',
  queued_runs: [{ run_id: 'run-a' }, { run_id: 'run-b' }],
  queue_depth: 2,
}

beforeEach(() => {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: vi.fn().mockReturnValue(true),
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('queueApi: /train/queue workbench operations', () => {
  test('pause POSTs to /train/queue/{runId}/pause with no body and passes payload through', async () => {
    const spy = installFetch({ status: 'paused', run_id: 'run-1', pid: 42 })
    await expect(queueApi.pause('run-1')).resolves.toMatchObject({ status: 'paused' })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/train/queue/run-1/pause')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  test('pause encodes run ids into the path segment', async () => {
    const spy = installFetch({ status: 'paused' })
    await queueApi.pause('weird/id 1')
    expect(spy.mock.calls[0][0]).toBe('/train/queue/weird%2Fid%201/pause')
  })

  test('resume POSTs to /train/queue/{runId}/resume with no body', async () => {
    const spy = installFetch({ status: 'resumed', run_id: 'run-2', pid: 43 })
    await expect(queueApi.resume('run-2')).resolves.toMatchObject({ status: 'resumed' })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/train/queue/run-2/resume')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  test('reorder POSTs {revision, ordered_run_ids} to /train/queue/reorder', async () => {
    const spy = installFetch(PROJECTION)
    await expect(queueApi.reorder(7, ['run-b', 'run-a'])).resolves.toMatchObject({ revision: 7 })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/train/queue/reorder')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      revision: 7,
      ordered_run_ids: ['run-b', 'run-a'],
    })
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  })

  test('replay POSTs {replay_kind, request_id} without an empty patch key', async () => {
    const spy = installFetch({ status: 'queued', run_id: 'new-run', queue_position: 1 })
    await expect(queueApi.replay('src-run', 'requeue', 'req-001')).resolves.toMatchObject({ run_id: 'new-run' })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/train/queue/src-run/replay')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ replay_kind: 'requeue', request_id: 'req-001' })
  })

  test('replay includes the optional config patch when provided', async () => {
    const spy = installFetch({ status: 'training_started', run_id: 'new-run' })
    await queueApi.replay('src-run', 'rerun', 'req-002', { output_name: 'renamed' })
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      replay_kind: 'rerun',
      request_id: 'req-002',
      patch: { output_name: 'renamed' },
    })
  })

  test('workbench GET stays native: business status fields are never treated as envelopes', async () => {
    const spy = installFetch({ revision: 8, current_run_id: 'r', current_status: 'paused', queued_runs: [] })
    await expect(queueApi.workbench()).resolves.toMatchObject({ current_status: 'paused', revision: 8 })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/train/queue')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  test('409 control conflicts surface as rejected ApiErrors carrying the stable code', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: { code: 'training_queue_control_conflict', message: 'no training running' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', spy)
    await expect(queueApi.pause('ghost')).rejects.toMatchObject({
      code: 'training_queue_control_conflict',
      status: 409,
    })
  })
})
