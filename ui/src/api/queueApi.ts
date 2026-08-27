// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { postJsonNative, request, requestNative } from './transport'

/* 队列/任务域 API */

/* `/api/**` compat 域(裸列表 + success/error 信封) */

export interface TaskRecord {
  id?: string
  task_id?: string
  name?: string
  status?: string
  progress?: number
  type?: string
  error?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  metadata?: Record<string, unknown>
  stages?: unknown[]
  queue_position?: number
  queue_message?: string
  [extra: string]: unknown
}

/* ------------------------------------------------------------------ *
 * `/train/queue` 工作台域(backend/routers/training_queue.py)
 * 裸 payload:`status` 在这里是业务字段(pause/resume 结果、replay 结果),
 * 不是 compat 信封 → 必须走 native 语义。
 * ------------------------------------------------------------------ */

/** GET /train/queue 投影中的单个排队条目。 */
export interface QueueWorkbenchEntry {
  run_id?: string
  config_name?: string
  queue_position?: number
  queued_at?: string
  /** ETA 探针:{available:true|false, wait_seconds?/reason?, ...},后端恒携带。 */
  eta?: Record<string, unknown>
  [extra: string]: unknown
}

/** GET /train/queue 队列工作台投影(revision 是 reorder/edit 的乐观锁)。 */
export interface QueueWorkbenchPayload {
  revision?: number
  current_run_id?: string
  current_status?: string
  queued_runs?: QueueWorkbenchEntry[]
  queue_depth?: number
  eta_evidence?: Record<string, unknown>
}

/**
 * POST pause/resume 结果:status ∈ paused|resumed|already_paused|not_paused;
 * 其余(no_training_running/run_not_current/error 等)后端会转成 409
 * training_queue_control_conflict,不会以成功形态到达这里。
 */
export interface QueueControlResult {
  status?: string
  run_id?: string
  pid?: number
  message?: string
  queue?: QueueWorkbenchPayload
}

/**
 * POST replay 结果(QueueOperationResult 落表):status ∈ training_started|queued|
 * 已存在的重放 run 状态;request_id 相同的重放是幂等的,返回既有 run。
 */
export interface QueueReplayResult {
  status?: string
  run_id?: string
  config_name?: string
  execution_profile_id?: string
  requested_attention_backend?: string
  resolved_attention_backend?: string
  queue_position?: number
  queue_depth?: number
  message?: string
}

export type QueueReplayKind = 'requeue' | 'rerun'

export const queueApi = {
  tasks: () => request<{ tasks?: TaskRecord[] }>('/api/tasks'),
  terminate: (taskId: string) => request(`/api/tasks/terminate/${encodeURIComponent(taskId)}`),
  deleteTask: (taskId: string) => request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  deleteAll: () => request('/api/tasks', { method: 'DELETE' }),
  /** GET /train/queue:revision + 排队顺序 + 当前运行状态的权威来源。 */
  workbench: () => requestNative<QueueWorkbenchPayload>('/train/queue'),
  /** 挂起当前排队选中的 worker;非当前运行返回 409。 */
  pause: (runId: string) =>
    requestNative<QueueControlResult>(`/train/queue/${encodeURIComponent(runId)}/pause`, { method: 'POST' }),
  /** 恢复已挂起的当前 worker;未挂起时后端幂等返回 not_paused。 */
  resume: (runId: string) =>
    requestNative<QueueControlResult>(`/train/queue/${encodeURIComponent(runId)}/resume`, { method: 'POST' }),
  /**
   * 全量重排排队条目:ordered_run_ids 必须恰好等于全部排队 run_id 的一个排列,
   * 否则 400;revision 过期 409(training_queue_revision_conflict)。返回新投影。
   */
  reorder: (revision: number, orderedRunIds: string[]) =>
    postJsonNative<QueueWorkbenchPayload>('/train/queue/reorder', {
      revision,
      ordered_run_ids: orderedRunIds,
    }),
  /**
   * 重放终态 run:requeue 仅限 failed/cancelled/stopped,rerun 可含 completed;
   * request_id(≤128)决定幂等性;patch 可选(config 增量,不含不可变字段)。
   */
  replay: (runId: string, replayKind: QueueReplayKind, requestId: string, patch?: Record<string, unknown>) =>
    postJsonNative<QueueReplayResult>(`/train/queue/${encodeURIComponent(runId)}/replay`, {
      replay_kind: replayKind,
      request_id: requestId,
      ...(patch ? { patch } : {}),
    }),
}
