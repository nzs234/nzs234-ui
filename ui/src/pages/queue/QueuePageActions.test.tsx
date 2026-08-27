// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 队列页控制操作渲染 + 点击流(与 WizardFlow* 同一套约定):
 * - 断言全部从生产语言包派生(uiText),不硬编码文案;
 * - 可见性矩阵来自后端语义(backend/routers/training_queue.py):
 *   pause/resume 仅当前运行条目、上移/下移仅排队条目且受 revision 门禁、
 *   replay 仅终态条目(failed 系→requeue,completed→rerun)。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import QueuePage from './QueuePage'
import { queueApi, type TaskRecord } from '@/api/queueApi'
import { setLanguage, uiText } from '@/test/i18n'

vi.mock('@/api/queueApi', () => ({
  queueApi: {
    tasks: vi.fn(),
    terminate: vi.fn(),
    deleteTask: vi.fn(),
    deleteAll: vi.fn(),
    workbench: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    reorder: vi.fn(),
    replay: vi.fn(),
  },
}))

vi.mock('@/stores/historyStore', () => ({
  findRunRecord: vi.fn(() => undefined),
  bootstrapRunHistory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/motion/useEntrance', () => ({
  usePageEntrance: () => ({ current: null }),
}))

const CURRENT_ID = 'run-current'
const QUEUED_A = 'run-q-a'
const QUEUED_B = 'run-q-b'

function task(id: string, name: string, status: string): TaskRecord {
  return { task_id: id, name, status, created_at: `2026-08-27T0${id.length}:00:00Z` }
}

const TASKS = [
  task(CURRENT_ID, 'Current Run', 'RUNNING'),
  task(QUEUED_A, 'Queued A', 'QUEUED'),
  task(QUEUED_B, 'Queued B', 'QUEUED'),
  task('run-failed', 'Old Failed', 'FAILED'),
  task('run-done', 'Done Run', 'COMPLETED'),
]

const WORKBENCH = {
  revision: 7,
  current_run_id: CURRENT_ID,
  current_status: 'running',
  queued_runs: [{ run_id: QUEUED_A }, { run_id: QUEUED_B }],
  queue_depth: 2,
}

function rowOf(labelText: string): HTMLElement {
  const li = screen.getByText(labelText).closest('li')
  if (!li) throw new Error(`task row for ${labelText} not found`)
  return li
}

function rowButton(row: HTMLElement, key: string): HTMLButtonElement {
  return within(row).getByRole('button', { name: uiText(key) })
}

async function renderQueue(opts?: { currentStatus?: string }) {
  vi.mocked(queueApi.workbench).mockResolvedValue({
    ...WORKBENCH,
    current_status: opts?.currentStatus ?? 'running',
  })
  render(<QueuePage />)
  // 工作台投影与任务列表并行加载;等任一行出现再断言。
  await screen.findByText('Current Run')
}

beforeEach(async () => {
  setLanguage('zh')
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(queueApi.tasks).mockResolvedValue({ tasks: TASKS })
  vi.mocked(queueApi.reorder).mockResolvedValue(WORKBENCH)
  vi.mocked(queueApi.replay).mockResolvedValue({ status: 'queued', run_id: 'new-run' })
})

describe('QueuePage 控制按钮可见性(后端语义)', () => {
  test('运行中=暂停+终止;排队=上移/下移(边界禁用);终态=重放;互不越界', async () => {
    await renderQueue()

    const current = rowOf('Current Run')
    expect(rowButton(current, 'queue.pause')).toBeEnabled()
    expect(within(current).queryByRole('button', { name: uiText('queue.resume') })).toBeNull()
    expect(within(current).queryByRole('button', { name: uiText('queue.move_up') })).toBeNull()
    expect(within(current).queryByRole('button', { name: uiText('queue.replay') })).toBeNull()
    expect(rowButton(current, 'queue.terminate')).toBeEnabled()

    const queuedA = rowOf('Queued A')
    expect(rowButton(queuedA, 'queue.move_up')).toBeDisabled()
    expect(rowButton(queuedA, 'queue.move_down')).toBeEnabled()
    expect(within(queuedA).queryByRole('button', { name: uiText('queue.pause') })).toBeNull()
    expect(within(queuedA).queryByRole('button', { name: uiText('queue.replay') })).toBeNull()

    const queuedB = rowOf('Queued B')
    expect(rowButton(queuedB, 'queue.move_down')).toBeDisabled()

    const failed = rowOf('Old Failed')
    expect(rowButton(failed, 'queue.replay')).toBeEnabled()
    expect(within(failed).queryByRole('button', { name: uiText('queue.move_up') })).toBeNull()

    const done = rowOf('Done Run')
    expect(rowButton(done, 'queue.replay')).toBeEnabled()
  })

  test('工作台 current_status=paused 时当前运行只显示恢复', async () => {
    await renderQueue({ currentStatus: 'paused' })
    const current = rowOf('Current Run')
    await waitFor(() => expect(rowButton(current, 'queue.resume')).toBeEnabled())
    expect(within(current).queryByRole('button', { name: uiText('queue.pause') })).toBeNull()
  })
})

describe('QueuePage 控制点击流', () => {
  test('暂停点击命中当前运行条目', async () => {
    const user = userEvent.setup()
    vi.mocked(queueApi.pause).mockResolvedValue({ status: 'paused' })
    await renderQueue()
    await user.click(rowButton(rowOf('Current Run'), 'queue.pause'))
    await waitFor(() => expect(vi.mocked(queueApi.pause)).toHaveBeenCalledWith(CURRENT_ID))
  })

  test('下移点击按全量 ordered_run_ids 调 reorder(revision 门禁)', async () => {
    const user = userEvent.setup()
    await renderQueue()
    await user.click(rowButton(rowOf('Queued A'), 'queue.move_down'))
    await waitFor(() =>
      expect(vi.mocked(queueApi.reorder)).toHaveBeenCalledWith(7, [QUEUED_B, QUEUED_A]),
    )
  })

  test('重放:failed 条目走 requeue,completed 条目走 rerun,均带幂等 request_id', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderQueue()

    await user.click(rowButton(rowOf('Old Failed'), 'queue.replay'))
    await waitFor(() =>
      expect(vi.mocked(queueApi.replay)).toHaveBeenCalledWith(
        'run-failed',
        'requeue',
        expect.any(String),
      ),
    )

    await user.click(rowButton(rowOf('Done Run'), 'queue.replay'))
    await waitFor(() =>
      expect(vi.mocked(queueApi.replay)).toHaveBeenCalledWith(
        'run-done',
        'rerun',
        expect.any(String),
      ),
    )
    expect(confirmSpy).toHaveBeenCalledTimes(2)
  })

  test('确认框取消时不发起重放', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderQueue()
    await user.click(rowButton(rowOf('Old Failed'), 'queue.replay'))
    expect(vi.mocked(queueApi.replay)).not.toHaveBeenCalled()
  })
})
