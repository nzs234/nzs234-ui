// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * historyStore 契约门禁：cap 40、按 id 去重、最新在前、磁盘 merge 方向、
 * hydrate 重试、损坏记录清洗。
 *
 * 运行历史是队列/监控「复制参数」的唯一数据源，静默丢记录或留重复项都会
 * 让用户复制到错误的配置。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadRunHistory: vi.fn(),
  saveRunHistory: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const LS_KEY = 'lx-run-history-v1'
const CAP = 40

const store = await import('@/stores/historyStore')

beforeEach(() => {
  // addRunRecord 会排一个 900ms 的真实 timer；不接管时钟的话它会在
  // 套件结束后触发，mock 已被清掉，于是变成 vitest 的 unhandled error。
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  // hydrate 的单飞/结果状态在模块级，不重置会让用例之间互相跳过请求。
  store.__resetRunHistoryRuntimeState()
  mocks.saveRunHistory.mockResolvedValue({})
  mocks.loadRunHistory.mockResolvedValue({ status: 'success', data: {} })
})

afterEach(() => {
  // 丢掉挂着的 debounce timer，再交还真实时钟。
  vi.clearAllTimers()
  vi.useRealTimers()
})

function readLs(): unknown[] {
  return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
}

function record(overrides: Partial<import('@/stores/historyStore').RunRecord> = {}) {
  return {
    id: 'r1',
    name: 'run-1',
    typeId: 'sdxl-lora',
    at: 1000,
    config: {},
    ...overrides,
  }
}

// ─── addRunRecord ────────────────────────────────────────────────────────────

describe('historyStore: addRunRecord', () => {
  test('the newest record lands first and carries the run id', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'r1' })
    store.addRunRecord('anima-lora', { output_name: 'b' }, { run_id: 'r2' })
    const records = store.listRunRecords()
    expect(records[0]).toMatchObject({ id: 'r2', name: 'b', typeId: 'anima-lora' })
    expect(records[1]).toMatchObject({ id: 'r1', name: 'a' })
  })

  test('run id is read from run_id, then task_id, then id', () => {
    store.addRunRecord('sdxl-lora', {}, { task_id: 't1' })
    expect(store.listRunRecords()[0].id).toBe('t1')
    store.addRunRecord('sdxl-lora', {}, { id: 'i1' })
    expect(store.listRunRecords()[0].id).toBe('i1')
    store.addRunRecord('sdxl-lora', {}, { run_id: 'r1', task_id: 't2' })
    expect(store.listRunRecords()[0].id).toBe('r1')
  })

  test('a missing run id degrades to an empty string instead of "undefined"', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, null)
    expect(store.listRunRecords()[0].id).toBe('')
  })

  test('the display name falls back output_name -> config_name -> typeId', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'on', config_name: 'cn' }, {})
    expect(store.listRunRecords()[0].name).toBe('on')
    store.addRunRecord('sdxl-lora', { config_name: 'cn' }, {})
    expect(store.listRunRecords()[0].name).toBe('cn')
    store.addRunRecord('anima-lora', {}, {})
    expect(store.listRunRecords()[0].name).toBe('anima-lora')
  })

  test('the config is snapshotted, not aliased to the live draft', () => {
    const draft: Record<string, unknown> = { network_dim: 32 }
    store.addRunRecord('sdxl-lora', draft, { run_id: 'r1' })
    draft.network_dim = 64
    expect(store.listRunRecords()[0].config.network_dim).toBe(32)
  })

  test('re-submitting the same run id replaces the old entry instead of duplicating it', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'first' }, { run_id: 'r1' })
    store.addRunRecord('sdxl-lora', { output_name: 'second' }, { run_id: 'r1' })
    const records = store.listRunRecords()
    expect(records.filter((item) => item.id === 'r1')).toHaveLength(1)
    expect(records[0].name).toBe('second')
  })

  test('records without an id are all kept (nothing to dedupe on)', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, {})
    store.addRunRecord('sdxl-lora', { output_name: 'b' }, {})
    expect(store.listRunRecords()).toHaveLength(2)
  })

  test('history is capped at 40 and drops the oldest entries', () => {
    for (let index = 0; index < CAP + 8; index += 1) {
      store.addRunRecord('sdxl-lora', { output_name: `n${index}` }, { run_id: `r${index}` })
    }
    const records = store.listRunRecords()
    expect(records).toHaveLength(CAP)
    expect(records[0].name).toBe(`n${CAP + 7}`)
    // 最老的一批被丢弃。
    expect(records.some((item) => item.id === 'r0')).toBe(false)
    expect(readLs()).toHaveLength(CAP)
  })

  test('a corrupt localStorage payload is treated as empty rather than throwing', () => {
    localStorage.setItem(LS_KEY, '{not json')
    expect(() => store.addRunRecord('sdxl-lora', {}, { run_id: 'r1' })).not.toThrow()
    expect(store.listRunRecords()).toHaveLength(1)
    localStorage.setItem(LS_KEY, '{"not":"an array"}')
    expect(store.listRunRecords()).toEqual([])
  })
})

// ─── findRunRecord ───────────────────────────────────────────────────────────

describe('historyStore: findRunRecord', () => {
  beforeEach(() => {
    store.addRunRecord('sdxl-lora', { output_name: 'alpha' }, { run_id: 'r1' })
    store.addRunRecord('anima-lora', { output_name: 'beta' }, { run_id: 'r2' })
    store.addRunRecord('anima-lora', { output_name: 'no-id' }, {})
  })

  test('an id match wins over a name match', () => {
    expect(store.findRunRecord('r1')?.name).toBe('alpha')
  })

  test('the name is used as a fallback when the id misses', () => {
    expect(store.findRunRecord('missing-id', 'beta')?.id).toBe('r2')
    expect(store.findRunRecord(undefined, 'no-id')?.name).toBe('no-id')
  })

  test('an empty id never matches records that also have an empty id', () => {
    // 不能让"没有 id"互相匹配，否则复制参数会拿到任意一条无 id 记录。
    expect(store.findRunRecord('')).toBeUndefined()
  })

  test('a total miss returns undefined', () => {
    expect(store.findRunRecord('nope', 'also-nope')).toBeUndefined()
    expect(store.findRunRecord()).toBeUndefined()
  })
})

// ─── mergeHistoryRecords ─────────────────────────────────────────────────────

describe('historyStore: mergeHistoryRecords', () => {
  test('primary order wins and duplicate ids collapse to the primary copy', () => {
    const merged = store.mergeHistoryRecords(
      [record({ id: 'a', name: 'primary-a' })],
      [record({ id: 'a', name: 'secondary-a' }), record({ id: 'b', name: 'secondary-b' })],
    )
    expect(merged.map((item) => item.name)).toEqual(['primary-a', 'secondary-b'])
  })

  test('id-less records dedupe on name+timestamp', () => {
    const merged = store.mergeHistoryRecords(
      [record({ id: '', name: 'x', at: 5 })],
      [record({ id: '', name: 'x', at: 5 }), record({ id: '', name: 'x', at: 6 })],
    )
    expect(merged).toHaveLength(2)
    expect(merged.map((item) => item.at)).toEqual([5, 6])
  })

  test('the merged result is capped at 40', () => {
    const many = Array.from({ length: 30 }, (_, index) => record({ id: `p${index}` }))
    const more = Array.from({ length: 30 }, (_, index) => record({ id: `s${index}` }))
    expect(store.mergeHistoryRecords(many, more)).toHaveLength(CAP)
  })

  test('nullish entries are skipped', () => {
    const merged = store.mergeHistoryRecords(
      [null as never, record({ id: 'a' })],
      [undefined as never],
    )
    expect(merged.map((item) => item.id)).toEqual(['a'])
  })

  test('empty inputs produce an empty list', () => {
    expect(store.mergeHistoryRecords([], [])).toEqual([])
  })
})

// ─── hydrateRunHistoryFromDisk ───────────────────────────────────────────────

describe('historyStore: hydrateRunHistoryFromDisk', () => {
  test('an empty local history absorbs the disk records', async () => {
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 500, records: [record({ id: 'd1', name: 'disk-1', at: 500 })] },
    })
    await store.hydrateRunHistoryFromDisk()
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['d1'])
  })

  test('a newer disk snapshot takes precedence over local records', async () => {
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: {
        updated_at: Date.now() + 60_000,
        records: [record({ id: 'd1', name: 'disk-1', at: Date.now() + 60_000 })],
      },
    })
    await store.hydrateRunHistoryFromDisk()
    expect(store.listRunRecords()[0].id).toBe('d1')
    // 本地记录不能被丢弃，只是排在后面。
    expect(store.listRunRecords().some((item) => item.id === 'local-1')).toBe(true)
  })

  test('an older disk snapshot keeps local records first', async () => {
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 1, records: [record({ id: 'd1', at: 1 })] },
    })
    await store.hydrateRunHistoryFromDisk()
    const ids = store.listRunRecords().map((item) => item.id)
    expect(ids[0]).toBe('local-1')
    expect(ids).toContain('d1')
  })

  test('malformed disk records are sanitized into well-typed entries', async () => {
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: {
        updated_at: 500,
        records: [
          { id: 7, name: null, type_id: 'sdxl-lora', at: 'not-a-number', config: 'not-an-object' },
          'garbage',
          null,
        ],
      },
    })
    await store.hydrateRunHistoryFromDisk()
    const records = store.listRunRecords()
    // 非对象条目被丢弃；对象条目被强制成正确类型。
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: '7', name: '', typeId: 'sdxl-lora', at: 0 })
    expect(records[0].config).toEqual({})
  })

  test('type_id is accepted as an alias of typeId', async () => {
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 500, records: [{ id: 'd1', name: 'x', type_id: 'anima-lora', at: 5, config: {} }] },
    })
    await store.hydrateRunHistoryFromDisk()
    expect(store.listRunRecords()[0].typeId).toBe('anima-lora')
  })

  test('an empty disk record list leaves local history untouched', async () => {
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: Date.now(), records: [] },
    })
    await store.hydrateRunHistoryFromDisk()
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['local-1'])
  })

  test('a backend failure is reported as failed and local history survives', async () => {
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    mocks.loadRunHistory.mockRejectedValue(new Error('backend down'))
    const outcome = await store.hydrateRunHistoryFromDisk()
    expect(outcome).toMatchObject({ status: 'failed', mergedRecords: 0 })
    expect(outcome.error).toContain('backend down')
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['local-1'])
    expect(store.getRunHistoryHydrationStatus()).toBe('failed')
  })

  test('a business-error envelope is treated as a failure', async () => {
    mocks.loadRunHistory.mockResolvedValue({ status: 'error', message: 'nope', code: 'E_X' })
    expect((await store.hydrateRunHistoryFromDisk()).status).toBe('failed')
    expect(store.listRunRecords()).toEqual([])
  })

  test('a successful hydration reports the merged count and is not repeated', async () => {
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 500, records: [record({ id: 'd1', at: 500 }), record({ id: 'd2', at: 501 })] },
    })
    const outcome = await store.hydrateRunHistoryFromDisk()
    expect(outcome).toMatchObject({ status: 'ready', mergedRecords: 2 })
    await store.hydrateRunHistoryFromDisk()
    await store.retryRunHistoryHydration()
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(1)
    expect(store.getRunHistoryHydrationStatus()).toBe('ready')
  })

  test('force re-requests even after success', async () => {
    mocks.loadRunHistory.mockResolvedValue({ status: 'success', data: { updated_at: 1, records: [] } })
    await store.hydrateRunHistoryFromDisk()
    await store.hydrateRunHistoryFromDisk({ force: true })
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(2)
  })

  test('concurrent calls share a single in-flight request', async () => {
    let release: (value: unknown) => void = () => {}
    mocks.loadRunHistory.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const first = store.hydrateRunHistoryFromDisk()
    const second = store.hydrateRunHistoryFromDisk()
    release({ status: 'success', data: { updated_at: 1, records: [] } })
    await Promise.all([first, second])
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(1)
  })

  test('a failed hydration stays retryable and the retry absorbs disk records', async () => {
    // 旧实现在请求前就把 diskHydrated 置 true，后端未起时这一整个会话都拿不到
    // 磁盘历史，Queue/Monitor 的「复制参数」永久只看得到本机 LS。
    mocks.loadRunHistory.mockRejectedValueOnce(new Error('backend down'))
    expect((await store.hydrateRunHistoryFromDisk()).status).toBe('failed')
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 500, records: [record({ id: 'd1', at: 500 })] },
    })
    expect((await store.hydrateRunHistoryFromDisk()).status).toBe('ready')
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['d1'])
  })

  test('retryRunHistoryHydration re-requests after a failure', async () => {
    mocks.loadRunHistory.mockRejectedValueOnce(new Error('down'))
    await store.hydrateRunHistoryFromDisk()
    mocks.loadRunHistory.mockResolvedValue({
      status: 'success',
      data: { updated_at: 500, records: [record({ id: 'd2', at: 500 })] },
    })
    expect((await store.retryRunHistoryHydration()).status).toBe('ready')
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['d2'])
  })
})

// ─── hydrate 期间的写抑制 ─────────────────────────────────────────────────────

describe('historyStore: writes during a pending hydrate', () => {
  /** 让 loadRunHistory 挂住，把 hydrate 钉在 pending 状态。 */
  function pendingHydrate() {
    let release: (value: unknown) => void = () => {}
    mocks.loadRunHistory.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const promise = store.hydrateRunHistoryFromDisk()
    return { promise, release: (value: unknown) => release(value) }
  }

  test('the hydrate window is observable while in flight', () => {
    const { release } = pendingHydrate()
    expect(store.getRunHistoryHydrationStatus()).toBe('pending')
    release({ status: 'success', data: { updated_at: 1, records: [] } })
  })

  test('CONTRACT: a record added during a pending hydrate must not be written back yet', async () => {
    // configStore 对同样的竞态有 suppressDiskWriteDepth 保护;historyStore 没有。
    // 此刻 LS 里是「本机记录，但还没合入磁盘那份」的半成品，把它整袋 PUT 回去
    // 就会用一份更窄的列表覆盖磁盘上更全的历史 —— 别的机器/别的会话写进去的
    // run 记录会被静默抹掉。正确做法是等 hydrate 落地后再写。
    const { promise, release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    vi.advanceTimersByTime(2000)
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()

    release({
      status: 'success',
      data: { updated_at: 9999, records: [record({ id: 'd1', at: 9999 })] },
    })
    await promise
  })

  test('CONTRACT: the deferred write must land after hydrate resolves, carrying the merged list', async () => {
    const { promise, release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    release({
      status: 'success',
      data: { updated_at: 9999, records: [record({ id: 'd1', at: 9999 })] },
    })
    await promise
    vi.advanceTimersByTime(2000)

    // 写盘必须发生(编辑不能被吞),且内容是 merge 后的完整列表。
    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    const ids = mocks.saveRunHistory.mock.calls[0][0].records.map((item: { id: string }) => item.id)
    expect(ids).toContain('local-1')
    expect(ids).toContain('d1')
  })

  test('the merge itself keeps both the local and the disk record', async () => {
    // 这条不是 CONTRACT:内存/LS 的 merge 方向已经是对的，坏的只有写盘时机。
    const { promise, release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    release({
      status: 'success',
      data: { updated_at: 9999, records: [record({ id: 'd1', at: 9999 })] },
    })
    await promise
    const ids = store.listRunRecords().map((item) => item.id)
    expect(ids).toContain('local-1')
    expect(ids).toContain('d1')
  })

  test('a failed hydrate must not strand the pending write', async () => {
    mocks.loadRunHistory.mockRejectedValue(new Error('backend down'))
    const outcome = await store.hydrateRunHistoryFromDisk()
    expect(outcome.status).toBe('failed')
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    vi.advanceTimersByTime(2000)
    // hydrate 失败后写盘照常尝试:此时 LS 就是唯一事实源，没有覆盖风险。
    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
  })
})

// ─── disk write ──────────────────────────────────────────────────────────────

describe('historyStore: disk write', () => {
  test('adding a record schedules a debounced disk write of the capped list', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'r1' })
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    const body = mocks.saveRunHistory.mock.calls[0][0]
    expect(body.version).toBe(1)
    expect(body.records).toHaveLength(1)
  })

  test('rapid submissions collapse into a single write', () => {
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'r1' })
    store.addRunRecord('sdxl-lora', { output_name: 'b' }, { run_id: 'r2' })
    vi.advanceTimersByTime(1000)
    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    expect(mocks.saveRunHistory.mock.calls[0][0].records).toHaveLength(2)
  })

  test('a failing disk write never breaks the local record', () => {
    mocks.saveRunHistory.mockRejectedValue(new Error('disk full'))
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'r1' })
    vi.advanceTimersByTime(1000)
    expect(store.listRunRecords()).toHaveLength(1)
  })
})
