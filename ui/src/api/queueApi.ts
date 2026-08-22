// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { request } from './transport'

/* 队列/任务域 API */

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

export const queueApi = {
  tasks: () => request<{ tasks?: TaskRecord[] }>('/api/tasks'),
  terminate: (taskId: string) => request(`/api/tasks/terminate/${encodeURIComponent(taskId)}`),
  deleteTask: (taskId: string) => request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  deleteAll: () => request('/api/tasks', { method: 'DELETE' }),
}
