// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * configStore 的持久化竞态契约(第二轮 code review 的 P0/P1)。
 *
 * 与 configStore.test.ts 分文件的理由:这里几乎每条用例都要接管时钟、
 * 摆出"hydrate 失败/挂住"的中间态,再观察写盘的时机与内容。混进那份按功能
 * 分组的门禁里会让两边的 beforeEach 互相干扰(那份用真实时钟)。
 *
 * 关注点:
 * - hydrate 失败/pending 时的写抑制与恢复;
 * - clear 一个 type 不能吞掉别的 type 的待写改动;
 * - revision 乐观并发的完整闭环(带上 → 刷新 → 409 fail-closed → 重新 hydrate)。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '@/schema/schemaIndex.js'

const mocks = vi.hoisted(() => ({
  loadTrainDrafts: vi.fn(),
  saveTrainDrafts: vi.fn(),
  clearTrainDrafts: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const {
  useTrainConfigStore,
  hydrateTrainDraftsFromDisk,
  bootstrapTrainDrafts,
  flushTrainDraftsToDisk,
  clearCurrentTypeDraftOnDisk,
  getDraftHydrationStatus,
  getLastKnownDraftRevision,
  hasDraftRevisionConflict,
  getPendingDraftDiskWriteTypes,
  __resetTrainDraftRuntimeState,
} = await import('@/stores/configStore')

const LS_KEY = 'lx-train-drafts-v1'
const DISK_DEBOUNCE_MS = 900

type Bag = Record<string, unknown>

/** 后端 PUT/DELETE 的成功信封:data 是写后的完整 payload(revision 已 +1)。 */
function okEnvelope(revision: number, extra: Partial<Bag> = {}) {
  return { status: 'success', data: { version: 1, revision, ...extra } }
}

/** 模拟 FastAPI 的 409:ApiError 带 status + payload.detail.current_revision。 */
function conflictError(currentRevision: number) {
  const error = new Error('training draft revision conflict') as Error & {
    status?: number
    payload?: unknown
  }
  error.status = 409
  error.payload = {
    detail: {
      code: 'train_draft_revision_conflict',
      message: 'training draft revision conflict',
      current_revision: currentRevision,
    },
  }
  return error
}

function seed(typeId: string, drafts: Record<string, Bag>) {
  useTrainConfigStore.setState({
    typeId,
    drafts,
    schemaRev: 0,
    diskHydrated: false,
    hydrationStatus: 'idle',
    hydrationError: null,
  })
}

function readLs(): { typeId?: string; drafts?: Record<string, Bag> } {
  return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
}

/** 让 loadTrainDrafts 挂住,把 hydrate 钉在 pending。 */
function pendingHydrate() {
  let release: (value: unknown) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  mocks.loadTrainDrafts.mockReturnValue(
    new Promise((resolve, reject) => {
      release = resolve
      fail = reject
    }),
  )
  const promise = hydrateTrainDraftsFromDisk()
  return { promise, release, fail }
}

function lastPutBody(): Bag {
  return mocks.saveTrainDrafts.mock.calls.at(-1)?.[0] as Bag
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  __resetTrainDraftRuntimeState()
  mocks.saveTrainDrafts.mockResolvedValue(okEnvelope(1))
  mocks.clearTrainDrafts.mockResolvedValue(okEnvelope(1))
  mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 0, drafts: {} } })
  seed('sdxl-lora', {
    'sdxl-lora': createDefaultConfig('sdxl-lora') as Bag,
    'anima-lora': createDefaultConfig('anima-lora') as Bag,
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  __resetTrainDraftRuntimeState()
})

// ─── 失败态下的本地编辑与重试 ─────────────────────────────────────────────────

describe('configStore: edits made while hydration is failed', () => {
  test('a failed hydrate does not write the local bag over the unread disk copy', async () => {
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    expect((await hydrateTrainDraftsFromDisk()).status).toBe('failed')

    useTrainConfigStore.getState().setValue('network_dim', 64)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    // 磁盘内容一次都没读到过 → 整袋 PUT 就是用 LS 覆盖未知内容。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
    // 但改动必须被记成待写,而不是丢掉。
    expect(getPendingDraftDiskWriteTypes()).toContain('sdxl-lora')
  })

  test('an edit made while hydration is failed survives the successful retry', async () => {
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()

    // 失败之后用户继续填(LAST seed / autofill / 手填都走这条路)。
    useTrainConfigStore.getState().setValue('network_dim', 64)

    // 后端起来了,磁盘上有一份更早的值。
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { revision: 3, updated_at: Date.now() + 60_000, drafts: { 'sdxl-lora': { network_dim: 8 } } },
    })
    expect((await hydrateTrainDraftsFromDisk()).status).toBe('ready')

    // 关键:磁盘时间戳更新,但本地那笔编辑是在"磁盘还没读到手"的窗口里发生的,
    // 不能被这次 merge 抹掉 —— 否则用户填的东西在后端晚起时会凭空消失。
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(64)
  })

  test('the deferred edit reaches the disk once hydration finally succeeds', async () => {
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 64)
    // 失败态下不写盘;此时 store 已排了一次自动重试,mock 仍是失败的。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()

    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 3, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    expect((lastPutBody().drafts as Record<string, Bag>)['sdxl-lora'].network_dim).toBe(64)
  })

  test('a still-failing retry keeps the edit queued instead of dropping it', async () => {
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 64)
    await hydrateTrainDraftsFromDisk({ force: true })
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
    expect(getPendingDraftDiskWriteTypes()).toContain('sdxl-lora')
  })

  test('a failed hydration is retried automatically, without a second caller', async () => {
    // 这是 P1 的核心:TrainPage 的模块级 gate 让"下次调用会重试"在生产上不成立。
    // store 必须自己排重试,否则后端晚起一秒草稿就永久只在 LS 里。
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    expect((await hydrateTrainDraftsFromDisk()).status).toBe('failed')

    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { revision: 4, updated_at: Date.now() + 60_000, drafts: { 'wan22-ti2v-lora': { network_dim: 31 } } },
    })
    // 没有任何人再调 hydrate —— 只是时间过去了。
    await vi.advanceTimersByTimeAsync(2_000)

    expect(getDraftHydrationStatus()).toBe('ready')
    // 用一个内存里还没有的 type,避免与"失败窗口内的本地编辑赢"这条契约混在一起。
    expect(useTrainConfigStore.getState().drafts['wan22-ti2v-lora'].network_dim).toBe(31)
  })

  test('the automatic retry is bounded so a dead backend does not spin forever', async () => {
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    await vi.advanceTimersByTimeAsync(120_000)
    const calls = mocks.loadTrainDrafts.mock.calls.length
    // 1 次初始 + 有限次退避重试;无限重试会刷满网络错误并淹掉错误上报的去重窗口。
    expect(calls).toBeGreaterThan(1)
    expect(calls).toBeLessThanOrEqual(6)
  })

  test('an edit made during the automatic retry window is written once it succeeds', async () => {
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 64)

    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 4, drafts: {} } })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    expect((lastPutBody().drafts as Record<string, Bag>)['sdxl-lora'].network_dim).toBe(64)
  })

  test('localStorage still records the edit so a reload does not lose it', async () => {
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 64)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS)
    // 磁盘被挡住时 LS 是唯一防线,必须照写。
    expect(readLs().drafts?.['sdxl-lora']?.network_dim).toBe(64)
  })

  test('an explicit flush surfaces the failure instead of silently overwriting the disk', async () => {
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 64)

    await expect(flushTrainDraftsToDisk()).rejects.toThrow('backend down')
    // fail-closed:没读到磁盘就不 PUT。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
    expect(getPendingDraftDiskWriteTypes()).toContain('sdxl-lora')
  })

  test('an explicit flush during a pending hydrate waits for it rather than racing', async () => {
    const { release } = pendingHydrate()
    useTrainConfigStore.getState().setValue('network_dim', 64)
    const flushed = flushTrainDraftsToDisk()
    // 还挂在 hydrate 上,不能已经 PUT 出去。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()

    release({ status: 'success', data: { revision: 2, drafts: {} } })
    await flushed
    // 恰好一次:flush 自己那一发。hydrate 收尾的自动补写必须被它抑制掉,
    // 否则同一份内容连打两次后端,第二次还多一次撞 409 的机会。
    expect(mocks.saveTrainDrafts).toHaveBeenCalledTimes(1)
    expect((lastPutBody().drafts as Record<string, Bag>)['sdxl-lora'].network_dim).toBe(64)
  })
})

// ─── bootstrap:生产可重试 ───────────────────────────────────────────────────

describe('configStore: bootstrapTrainDrafts', () => {
  test('it is idempotent after success (no repeated backend calls)', async () => {
    await bootstrapTrainDrafts()
    await bootstrapTrainDrafts()
    await bootstrapTrainDrafts()
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)
    expect(getDraftHydrationStatus()).toBe('ready')
  })

  test('it retries by itself after a failure, so a module-level gate cannot strand it', async () => {
    // TrainPage 用一个模块级布尔把 hydrate 门在"整个会话只发起一次";
    // 后端晚起一秒就再也读不到磁盘草稿。bootstrap 必须自己决定要不要重试。
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    expect((await bootstrapTrainDrafts()).status).toBe('failed')

    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { revision: 1, updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 12 } } },
    })
    expect((await bootstrapTrainDrafts()).status).toBe('ready')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(12)
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(2)
  })

  test('concurrent bootstrap calls share one in-flight request', async () => {
    let release: (value: unknown) => void = () => {}
    mocks.loadTrainDrafts.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const all = Promise.all([bootstrapTrainDrafts(), bootstrapTrainDrafts(), bootstrapTrainDrafts()])
    release({ status: 'success', data: { revision: 1, drafts: {} } })
    await all
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)
  })
})

// ─── clear 与兄弟 type 的待写改动 ────────────────────────────────────────────

describe('configStore: clearing one type preserves other types pending writes', () => {
  beforeEach(() => {
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready' })
  })

  test('a sibling edit still reaches the disk, and the cleared type is written as defaults', async () => {
    // 改 anima-lora → 切回 sdxl-lora → 清空 sdxl-lora。
    useTrainConfigStore.getState().setType('anima-lora')
    useTrainConfigStore.getState().setValue('network_dim', 77)
    useTrainConfigStore.getState().setType('sdxl-lora')
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()

    await clearCurrentTypeDraftOnDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.clearTrainDrafts).toHaveBeenCalledTimes(1)
    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    const drafts = lastPutBody().drafts as Record<string, Bag>
    expect(drafts['anima-lora'].network_dim).toBe(77)
    // 被清的 type 写的是默认值,而不是清空前的旧值。
    expect(drafts['sdxl-lora'].network_dim).toBe((createDefaultConfig('sdxl-lora') as Bag).network_dim)
  })

  test('the pending-write bookkeeping is emptied by the flush, not thrown away', async () => {
    useTrainConfigStore.getState().setType('anima-lora')
    useTrainConfigStore.getState().setValue('network_dim', 77)
    useTrainConfigStore.getState().setType('sdxl-lora')
    await clearCurrentTypeDraftOnDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)
    // 补写已经发生 → 队列自然清空。若实现是无条件丢弃,这里也会是空的,
    // 所以上一条用例才是判据;这条只保证不会永久积压。
    expect(getPendingDraftDiskWriteTypes()).toEqual([])
  })

  test('an edit made during the clear round trip is not swallowed', async () => {
    let releaseDelete: (value: unknown) => void = () => {}
    mocks.clearTrainDrafts.mockReturnValue(new Promise((resolve) => { releaseDelete = resolve }))
    const clearing = clearCurrentTypeDraftOnDisk()
    // DELETE 还在飞的时候,别的页面改了另一个 type(资源中心 applyValues 就是这样)。
    useTrainConfigStore.getState().setType('anima-lora')
    useTrainConfigStore.getState().setValue('network_dim', 55)
    releaseDelete(okEnvelope(2))
    await clearing
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    expect((lastPutBody().drafts as Record<string, Bag>)['anima-lora'].network_dim).toBe(55)
  })

  test('clearing does not resurrect the old value of the cleared type', async () => {
    useTrainConfigStore.getState().setValue('network_dim', 99)
    useTrainConfigStore.getState().setType('anima-lora')
    useTrainConfigStore.getState().setValue('network_dim', 77)
    useTrainConfigStore.getState().setType('sdxl-lora')
    await clearCurrentTypeDraftOnDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)

    const drafts = lastPutBody().drafts as Record<string, Bag>
    expect(drafts['sdxl-lora'].network_dim).not.toBe(99)
  })

  test('a later edit after the clear is written normally', async () => {
    await clearCurrentTypeDraftOnDisk()
    mocks.saveTrainDrafts.mockClear()
    useTrainConfigStore.getState().setValue('network_dim', 5)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)
    expect((lastPutBody().drafts as Record<string, Bag>)['sdxl-lora'].network_dim).toBe(5)
  })
})

// ─── revision 乐观并发闭环 ───────────────────────────────────────────────────

describe('configStore: draft revision closed loop', () => {
  test('the revision is unknown until a hydrate succeeds, and no revision is sent', async () => {
    expect(getLastKnownDraftRevision()).toBe(-1)
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready' })
    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    // 猜一个 revision 只会稳定撞 409;未知时退化成无条件覆盖,与引入前一致。
    expect(lastPutBody()).not.toHaveProperty('revision')
  })

  test('hydrate records the disk revision', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    expect(getLastKnownDraftRevision()).toBe(7)
  })

  test('a PUT carries the known revision', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    expect(lastPutBody().revision).toBe(7)
  })

  test('the response revision is adopted so the second write does not conflict', async () => {
    // 这是"只把 revision 塞进请求"的半实现坑:不读回响应,第二次写必 409。
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    mocks.saveTrainDrafts.mockResolvedValue(okEnvelope(8))

    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    expect(lastPutBody().revision).toBe(7)
    expect(getLastKnownDraftRevision()).toBe(8)

    useTrainConfigStore.getState().setValue('network_dim', 4)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    expect(lastPutBody().revision).toBe(8)
  })

  test('a DELETE carries the known revision and adopts the response revision', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    mocks.clearTrainDrafts.mockResolvedValue(okEnvelope(8))
    await clearCurrentTypeDraftOnDisk()
    expect(mocks.clearTrainDrafts).toHaveBeenCalledWith('sdxl-lora', 7)
    expect(getLastKnownDraftRevision()).toBe(8)
  })

  test('a DELETE omits the revision entirely while it is unknown', async () => {
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready' })
    await clearCurrentTypeDraftOnDisk()
    expect(mocks.clearTrainDrafts).toHaveBeenCalledWith('sdxl-lora')
  })

  test('a 409 fails closed: the write is not retried blindly and hydration is re-run', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)

    // 另一个标签页在我们读到之后写过盘 → 磁盘 revision 已经是 9。
    mocks.saveTrainDrafts.mockRejectedValue(conflictError(9))
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { revision: 9, updated_at: Date.now() + 60_000, drafts: { 'anima-lora': { network_dim: 21 } } },
    })

    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)

    // 冲突被记下,并重新 hydrate 把对方的改动读进来。
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(2)
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(21)
    // 本地编辑不能因为那次 merge 而丢。
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(3)
  })

  test('a 409 does not turn into an endless conflict loop: the retry uses the fresh revision', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()

    mocks.saveTrainDrafts.mockRejectedValueOnce(conflictError(9))
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 9, drafts: {} } })
    mocks.saveTrainDrafts.mockResolvedValue(okEnvelope(10))

    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 4)

    // 第二次写用的是重新 hydrate 拿到的 revision,而不是 409 之前那个旧值。
    const revisions = mocks.saveTrainDrafts.mock.calls.map((call) => (call[0] as Bag).revision)
    expect(revisions[0]).toBe(7)
    expect(revisions.at(-1)).toBe(9)
    expect(hasDraftRevisionConflict()).toBe(false)
    expect(getLastKnownDraftRevision()).toBe(10)
  })

  test('a 409 on DELETE fails closed and does not delete again', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    mocks.clearTrainDrafts.mockRejectedValue(conflictError(9))

    await expect(clearCurrentTypeDraftOnDisk()).rejects.toThrow(/conflict/i)
    expect(mocks.clearTrainDrafts).toHaveBeenCalledTimes(1)
    expect(hasDraftRevisionConflict()).toBe(true)
  })

  test('an ordinary write failure is not mistaken for a revision conflict', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    mocks.saveTrainDrafts.mockRejectedValue(new Error('disk full'))

    useTrainConfigStore.getState().setValue('network_dim', 3)
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)

    expect(hasDraftRevisionConflict()).toBe(false)
    // 普通失败不该触发重新 hydrate。
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)
    // revision 保持原值,下次写还用它。
    expect(getLastKnownDraftRevision()).toBe(7)
  })

  test('a hydrate that reports no revision leaves the last known value alone', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 7, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    // 老后端不下发 revision:不能把已知值重置成 0(那会稳定撞 409)。
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { drafts: {} } })
    await hydrateTrainDraftsFromDisk({ force: true })
    expect(getLastKnownDraftRevision()).toBe(7)
  })
})

// ─── hydrate 期间的写抑制 ────────────────────────────────────────────────────

describe('configStore: writes during a pending hydrate', () => {
  test('an in-flight hydrate cancels an already scheduled disk write', async () => {
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready' })
    useTrainConfigStore.getState().setValue('network_dim', 64)
    // 写已排队但还没触发。
    const { release } = pendingHydrate()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    // 那笔写会用"尚未合并磁盘"的内存整袋覆盖,必须被撤掉。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()

    release({ status: 'success', data: { revision: 1, drafts: {} } })
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2)
    // 但不能丢:hydrate 落地后补发。
    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    expect((lastPutBody().drafts as Record<string, Bag>)['sdxl-lora'].network_dim).toBe(64)
  })

  test('a pure hydrate with no local edits does not echo the merged state back', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { revision: 1, updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 33 } } },
    })
    await hydrateTrainDraftsFromDisk()
    await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 3)
    // 没有本地改动 → 没有任何理由 PUT(还得赌 revision 没被别人动过)。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
  })
})
