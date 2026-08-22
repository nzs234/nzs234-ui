// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * normalizePreviewGroups 单测(node 友好,无 DOM)。
 */

import { describe, it, expect } from 'vitest'
import { normalizePreviewGroups } from './previewGroups'

describe('normalizePreviewGroups', () => {
  it('returns [] for non-array input', () => {
    expect(normalizePreviewGroups(undefined)).toEqual([])
    expect(normalizePreviewGroups(null)).toEqual([])
    expect(normalizePreviewGroups(42)).toEqual([])
    expect(normalizePreviewGroups('{"a":1}')).toEqual([])
    expect(normalizePreviewGroups({ name: 'a' })).toEqual([])
  })

  it('keeps objects, drops scalars / null / nested arrays', () => {
    const raw = [{ name: 'fit', prompt: 'cat' }, 'string', null, 3, [1, 2], { prompt: 'p' }]
    expect(normalizePreviewGroups(raw)).toEqual([
      { name: 'fit', prompt: 'cat' },
      { prompt: 'p' },
    ])
  })

  it('returns a new array, does not mutate the input', () => {
    const raw = [{ name: 'a' }]
    const out = normalizePreviewGroups(raw)
    expect(out).not.toBe(raw)
    expect(out).toEqual([{ name: 'a' }])
  })

  it('always yields an array of objects', () => {
    const out = normalizePreviewGroups([1, 'x', null, undefined, {}, { a: 1 }])
    expect(Array.isArray(out)).toBe(true)
    expect(out.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))).toBe(true)
  })
})
