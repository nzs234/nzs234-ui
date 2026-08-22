// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * draft revision 识别逻辑的门禁。
 *
 * 这几个函数决定"要不要把一次写失败当成并发冲突处理"。判错的两个方向都很贵:
 * 把普通失败当冲突 → 白跑一轮 hydrate 并把 revision 重置成未知;
 * 把冲突当普通失败 → 下一次写继续用过期 revision,稳定 409,草稿再也写不进磁盘。
 */

import { describe, expect, test } from 'vitest'
import {
  TRAIN_DRAFT_CONFLICT_CODE,
  TRAIN_DRAFT_CONFLICT_STATUS,
  UNKNOWN_DRAFT_REVISION,
  isDraftRevisionConflict,
  readDraftConflictRevision,
  readDraftRevision,
} from './draftRevision'

describe('draftRevision: readDraftRevision', () => {
  test('a valid non-negative revision is read', () => {
    expect(readDraftRevision({ revision: 0 })).toBe(0)
    expect(readDraftRevision({ revision: 42 })).toBe(42)
    expect(readDraftRevision({ revision: '7' })).toBe(7)
  })

  test('missing, negative and non-numeric values are reported as absent', () => {
    // 返回 null 而不是 0:归零会让下一次写带一个过期的 revision,稳定撞 409。
    expect(readDraftRevision({})).toBeNull()
    expect(readDraftRevision({ revision: -1 })).toBeNull()
    expect(readDraftRevision({ revision: 'abc' })).toBeNull()
    expect(readDraftRevision({ revision: null })).toBeNull()
    expect(readDraftRevision(null)).toBeNull()
    expect(readDraftRevision('str')).toBeNull()
  })

  test('a fractional revision is truncated rather than rejected', () => {
    expect(readDraftRevision({ revision: 3.9 })).toBe(3)
  })
})

describe('draftRevision: readDraftConflictRevision', () => {
  test('the FastAPI detail wrapper is unwrapped', () => {
    const payload = {
      detail: { code: TRAIN_DRAFT_CONFLICT_CODE, message: 'conflict', current_revision: 9 },
    }
    expect(readDraftConflictRevision(payload)).toBe(9)
  })

  test('a bare detail object is accepted too', () => {
    expect(readDraftConflictRevision({ current_revision: 5 })).toBe(5)
  })

  test('an absent or invalid current_revision reports null', () => {
    expect(readDraftConflictRevision({ detail: { code: 'x' } })).toBeNull()
    expect(readDraftConflictRevision({ detail: { current_revision: -2 } })).toBeNull()
    expect(readDraftConflictRevision(null)).toBeNull()
    expect(readDraftConflictRevision('nope')).toBeNull()
  })
})

describe('draftRevision: isDraftRevisionConflict', () => {
  test('an ApiError with status 409 is a conflict', () => {
    expect(isDraftRevisionConflict({ status: TRAIN_DRAFT_CONFLICT_STATUS })).toBe(true)
  })

  test('the conflict code is recognized even without the status', () => {
    // 上报链路里 status 可能已经丢了(例如经过一层包装),code 是第二道识别。
    expect(isDraftRevisionConflict({ payload: { detail: { code: TRAIN_DRAFT_CONFLICT_CODE } } })).toBe(true)
    expect(isDraftRevisionConflict({ payload: { code: TRAIN_DRAFT_CONFLICT_CODE } })).toBe(true)
  })

  test('ordinary write failures are not conflicts', () => {
    expect(isDraftRevisionConflict(new Error('disk full'))).toBe(false)
    expect(isDraftRevisionConflict({ status: 500, payload: { detail: 'boom' } })).toBe(false)
    expect(isDraftRevisionConflict({ status: 409.5 })).toBe(false)
    expect(isDraftRevisionConflict(null)).toBe(false)
    expect(isDraftRevisionConflict('409')).toBe(false)
  })

  test('another 409 without the draft conflict code still counts (status is authoritative)', () => {
    // /api/train_drafts 上的 409 只有这一种来源;把它排除会让真冲突漏网。
    expect(isDraftRevisionConflict({ status: 409, payload: { detail: 'something else' } })).toBe(true)
  })
})

describe('draftRevision: UNKNOWN_DRAFT_REVISION', () => {
  test('it is negative so it never looks like a real revision', () => {
    // 生产代码用 `>= 0` 判断"是否已知";常量必须落在那个判断的另一侧。
    expect(UNKNOWN_DRAFT_REVISION).toBeLessThan(0)
  })
})
