// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * train_drafts 乐观并发(revision)的读写工具。
 *
 * 刻意与 trainApi 分开:configStore 的测试把整个 `@/api/trainApi` 模块换成 mock,
 * 从那里 import 运行时值会在 mock 下变成 undefined。而"如何识别 409、从哪里取
 * 磁盘当前 revision"是纯逻辑,不该被 API 层的 mock 边界连带掉。
 */

/** PUT/DELETE /api/train_drafts 的 revision 冲突。 */
export const TRAIN_DRAFT_CONFLICT_STATUS = 409
export const TRAIN_DRAFT_CONFLICT_CODE = 'train_draft_revision_conflict'

/** 未知 revision:还没成功读过磁盘,此时不带 revision 提交。 */
export const UNKNOWN_DRAFT_REVISION = -1

function toRevision(value: unknown): number | null {
  // Number(null) 是 0、Number('') 也是 0:靠 Number() 判定会把"字段缺失"读成
  // revision 0,于是本地以为自己拿到了磁盘的初始版本,下一次写稳定撞 409。
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return null
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : null
}

/** 从任意 payload 里读出 revision;不是合法非负整数则返回 null。 */
export function readDraftRevision(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  return toRevision((payload as { revision?: unknown }).revision)
}

/**
 * 从 409 的 ApiError.payload 里挖出磁盘当前 revision。
 * FastAPI 把 HTTPException(detail=dict) 序列化成 {detail:{code,message,current_revision}};
 * 直接给出 detail 对象的调用方也一并支持。
 */
export function readDraftConflictRevision(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const detail = (root.detail && typeof root.detail === 'object' ? root.detail : root) as Record<string, unknown>
  return toRevision(detail.current_revision)
}

/** 该错误是否是 revision 冲突(而不是普通的写失败)。 */
export function isDraftRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: unknown; payload?: unknown }
  if (Number(candidate.status) === TRAIN_DRAFT_CONFLICT_STATUS) return true
  const payload = candidate.payload
  if (!payload || typeof payload !== 'object') return false
  const root = payload as Record<string, unknown>
  const detail = (root.detail && typeof root.detail === 'object' ? root.detail : root) as Record<string, unknown>
  return String(detail.code || '') === TRAIN_DRAFT_CONFLICT_CODE
}
