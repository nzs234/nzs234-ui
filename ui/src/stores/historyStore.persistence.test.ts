// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * historyStore 的写抑制契约(第二轮 code review 的 P0)。
 *
 * 后端 PUT /api/run_history 是**整体替换**(save_run_history_payload 直接用请求体
 * 覆盖磁盘文件),这一点与 train_drafts 的 per-type union 不同。于是"什么时候允许
 * 把本地列表整袋写回去"就是数据安全问题,而不是性能问题:
 * 在磁盘那份合进 LS 之前 PUT,等于用一份更窄的列表抹掉磁盘上更全的历史。
 *
 * 与 historyStore.test.ts 分文件:那份用真实时钟做功能门禁,这份要接管时钟
 * 并把 hydrate 摆在 pending/failed 的中间态。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadRunHistory: vi.fn(),
  saveRunHistory: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const store = await import('@/stores/historyStore')

const LS_KEY = 'lx-run-history-v1'
const DISK_DEBOUNCE_MS = 900

function record(overrides: Partial<import('@/stores/historyStore').RunRecord> = {}) {
  return { id: 'r1', name: 'run-1', typeId: 'sdxl-lora', at: 1000, config: {}, ...overrides }
}

function diskSnapshot(ids: string[], updatedAt: number) {
  return {
    status: 'success',
    data: {
      updated_at: updatedAt,
      records: ids.map((id) => record({ id, name: `disk-${id}`, at: updatedAt })),
    },
  }
}

/** 让 loadRunHistory 挂住,把 hydrate 钉在 pending。 */
function pendingHydrate() {
  let release: (value: unknown) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  mocks.loadRunHistory.mockReturnValue(
    new Promise((resolve, reject) => {
      release = resolve
      fail = reject
    }),
  )
  const promise = store.hydrateRunHistoryFromDisk()
  return { promise, release, fail }
}

function writtenIds(callIndex = -1): string[] {
  const call = mocks.saveRunHistory.mock.calls.at(callIndex)
  return ((call?.[0]?.records ?? []) as { id: string }[]).map((item) => item.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  store.__resetRunHistoryRuntimeState()
  mocks.saveRunHistory.mockResolvedValue({ status: 'success', data: {} })
  mocks.loadRunHistory.mockResolvedValue({ status: 'success', data: { updated_at: 0, records: [] } })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  store.__resetRunHistoryRuntimeState()
})

// ─── pending ─────────────────────────────────────────────────────────────────

describe('historyStore: writes while hydration is pending', () => {
  test('a record added during a pending hydrate is not written back yet', async () => {
    const { release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    // LS 此刻是"本机记录,还没合入磁盘那份"的半成品。整袋 PUT 会把别的会话
    // 写进去的 run 记录静默抹掉 —— 磁盘那份马上就到,等一下是纯收益。
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()
    expect(store.hasDeferredRunHistoryDiskWrite()).toBe(true)

    release(diskSnapshot(['d1'], 9999))
  })

  test('the deferred write lands after hydration, carrying the merged list', async () => {
    const { promise, release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    release(diskSnapshot(['d1'], 9999))
    await promise
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    const ids = writtenIds()
    // 两边都在:本地新提交的没丢,磁盘上原有的也没被抹掉。
    expect(ids).toContain('local-1')
    expect(ids).toContain('d1')
    expect(store.hasDeferredRunHistoryDiskWrite()).toBe(false)
  })

  test('an already scheduled write is cancelled when a hydrate starts', async () => {
    // 先在 idle 下排一笔写(debounce 还没到)。
    store.addRunRecord('sdxl-lora', { output_name: 'first' }, { run_id: 'local-1' })
    const { promise, release } = pendingHydrate()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    // 那笔写会用未合并的 LS 覆盖磁盘,必须被撤掉而不是照常触发。
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()

    release(diskSnapshot(['d1'], 9999))
    await promise
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    // 撤掉不等于丢掉:hydrate 后补发,且内容是并集。
    expect(writtenIds()).toEqual(expect.arrayContaining(['local-1', 'd1']))
  })

  test('several records added during the window collapse into one merged write', async () => {
    const { promise, release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'local-1' })
    store.addRunRecord('sdxl-lora', { output_name: 'b' }, { run_id: 'local-2' })
    release(diskSnapshot(['d1'], 9999))
    await promise
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    expect(writtenIds()).toEqual(expect.arrayContaining(['local-1', 'local-2', 'd1']))
  })

  test('a pure hydrate with no local submissions does not write anything back', async () => {
    await store.hydrateRunHistoryFromDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()
  })

  test('localStorage is updated immediately even while the disk write is held back', async () => {
    const { release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    // 磁盘被挡住时 LS 是唯一防线;不能连它一起压下。
    expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')).toHaveLength(1)
    release(diskSnapshot([], 1))
  })
})

// ─── failed ──────────────────────────────────────────────────────────────────

describe('historyStore: writes while hydration has failed', () => {
  test('the write still happens: LS is the only source of truth left', async () => {
    mocks.loadRunHistory.mockRejectedValue(new Error('backend down'))
    expect((await store.hydrateRunHistoryFromDisk()).status).toBe('failed')

    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)

    // GET 拿不到的内容 PUT 也保护不了。压下只会让用户刚提交的 run
    // 连磁盘都进不去,跨会话彻底丢失 —— 那比覆盖一份读不出来的文件更糟。
    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    expect(writtenIds()).toContain('local-1')
  })

  test('a write in the failed state also triggers a hydrate retry', async () => {
    mocks.loadRunHistory.mockRejectedValueOnce(new Error('backend down'))
    await store.hydrateRunHistoryFromDisk()
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(1)

    mocks.loadRunHistory.mockResolvedValue(diskSnapshot(['d1'], 9999))
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)

    // 重试让下一次写变成完整并集,而不是一直用 LS 覆盖。
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(2)
    expect(store.getRunHistoryHydrationStatus()).toBe('ready')
    expect(store.listRunRecords().map((item) => item.id)).toEqual(
      expect.arrayContaining(['local-1', 'd1']),
    )
  })

  test('a record added during the failed-state retry is not lost', async () => {
    mocks.loadRunHistory.mockRejectedValueOnce(new Error('backend down'))
    await store.hydrateRunHistoryFromDisk()

    // 重试挂住,期间又提交一条。
    let release: (value: unknown) => void = () => {}
    mocks.loadRunHistory.mockReturnValue(new Promise((resolve) => { release = resolve }))
    store.addRunRecord('sdxl-lora', { output_name: 'a' }, { run_id: 'local-1' })
    await vi.advanceTimersByTimeAsync(10)
    store.addRunRecord('sdxl-lora', { output_name: 'b' }, { run_id: 'local-2' })
    release(diskSnapshot(['d1'], 9999))
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    const ids = store.listRunRecords().map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['local-1', 'local-2', 'd1']))
    expect(writtenIds()).toEqual(expect.arrayContaining(['local-1', 'local-2']))
  })
})

// ─── flush ───────────────────────────────────────────────────────────────────

describe('historyStore: flushRunHistoryToDisk', () => {
  test('it waits for a pending hydrate instead of racing it', async () => {
    const { release } = pendingHydrate()
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    const flushed = store.flushRunHistoryToDisk()
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()

    release(diskSnapshot(['d1'], 9999))
    await flushed
    expect(mocks.saveRunHistory).toHaveBeenCalledTimes(1)
    expect(writtenIds()).toEqual(expect.arrayContaining(['local-1', 'd1']))
  })

  test('it hydrates first when nothing has been read yet', async () => {
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    mocks.loadRunHistory.mockResolvedValue(diskSnapshot(['d1'], 9999))
    await store.flushRunHistoryToDisk()
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(1)
    expect(writtenIds()).toEqual(expect.arrayContaining(['local-1', 'd1']))
  })

  test('it surfaces a hydration failure rather than overwriting the disk silently', async () => {
    mocks.loadRunHistory.mockRejectedValue(new Error('backend down'))
    store.addRunRecord('sdxl-lora', { output_name: 'local' }, { run_id: 'local-1' })
    // addRunRecord 在 idle 下排了一笔 debounce 写;先把它清掉,只观察 flush。
    vi.clearAllTimers()
    mocks.saveRunHistory.mockClear()

    await expect(store.flushRunHistoryToDisk()).rejects.toThrow('backend down')
    expect(mocks.saveRunHistory).not.toHaveBeenCalled()
    // 意图不能静默丢掉。
    expect(store.hasDeferredRunHistoryDiskWrite()).toBe(true)
  })
})

// ─── bootstrap ───────────────────────────────────────────────────────────────

describe('historyStore: bootstrapRunHistory', () => {
  test('it is idempotent after success', async () => {
    await store.bootstrapRunHistory()
    await store.bootstrapRunHistory()
    expect(mocks.loadRunHistory).toHaveBeenCalledTimes(1)
  })

  test('it retries by itself after a failure', async () => {
    mocks.loadRunHistory.mockRejectedValueOnce(new Error('down'))
    expect((await store.bootstrapRunHistory()).status).toBe('failed')
    mocks.loadRunHistory.mockResolvedValue(diskSnapshot(['d1'], 500))
    expect((await store.bootstrapRunHistory()).status).toBe('ready')
    expect(store.listRunRecords().map((item) => item.id)).toEqual(['d1'])
  })
})
