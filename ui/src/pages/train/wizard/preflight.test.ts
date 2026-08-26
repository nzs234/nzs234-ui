// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

import {
  PREFLIGHT_TTL_MS,
  fingerprintPayload,
  getPreflightRecommendedPatch,
  isPreflightCurrent,
  normalizePreflightReport,
  type PreflightSnapshot,
} from './preflight'
import { I18N_BUNDLES, activeLanguage } from '@/test/i18n'

describe('normalizePreflightReport', () => {
  test('errors/blockers land in blocking; issues/warnings land in confirmable; canStart honors can_start', () => {
    const report = normalizePreflightReport({
      errors: ['e1'],
      blockers: ['b1'],
      issues: ['i1'],
      warnings: ['w1'],
      notes: ['n1'],
      messages: ['m1'],
      checks: ['c1'],
      can_start: true,
    })
    expect(report.blocking).toEqual(['e1', 'b1'])
    expect(report.confirmable).toEqual(['i1', 'w1'])
    expect(report.errors).toEqual(['e1'])
    expect(report.blockers).toEqual(['b1'])
    expect(report.issues).toEqual(['i1'])
    expect(report.warnings).toEqual(['w1'])
    expect(report.canStart).toBe(true)
  })

  test('can_start not false means canStart true (missing/undefined can_start)', () => {
    expect(normalizePreflightReport({}).canStart).toBe(true)
    expect(normalizePreflightReport({ can_start: 'weird' }).canStart).toBe(true)
  })

  test('can_start:false with empty lists -> generic blocker, canStart false', () => {
    const report = normalizePreflightReport({ can_start: false })
    expect(report.canStart).toBe(false)
    expect(report.blocking).toHaveLength(1)
    // 文案走 i18n 双语包：断言用当前语言包派生，不抄字面量（zh/en 都得非裸键）。
    expect(report.blocking[0]).toMatchObject({
      message: I18N_BUNDLES[activeLanguage()]['preflight.backend_reports_unstartable'],
      severity: 'blocker',
    })
  })

  test('can_start:false with existing errors -> no duplicate generic blocker', () => {
    const report = normalizePreflightReport({ errors: ['e1'], can_start: false })
    expect(report.canStart).toBe(false)
    expect(report.blocking).toEqual(['e1'])
  })

  test('non-object input is treated as an empty report', () => {
    const report = normalizePreflightReport(null)
    expect(report.blocking).toEqual([])
    expect(report.confirmable).toEqual([])
    expect(report.canStart).toBe(true)
  })
})

describe('isPreflightCurrent', () => {
  const NOW = 10_000_000
  const payload = { model: 'sdxl', dim: 32 }

  function snapshot(overrides: Partial<PreflightSnapshot> = {}): PreflightSnapshot {
    return {
      typeId: 'sdxl-lora',
      schemaRev: 3,
      fingerprint: fingerprintPayload(payload),
      report: {},
      warningConfirmed: false,
      createdAt: NOW - 1_000,
      ...overrides,
    }
  }

  test('returns true when typeId/schemaRev/fingerprint match and createdAt is fresh', () => {
    expect(isPreflightCurrent(snapshot(), 'sdxl-lora', 3, payload, { now: NOW })).toBe(true)
  })

  test('returns false when the payload differs (different fingerprint)', () => {
    expect(isPreflightCurrent(snapshot(), 'sdxl-lora', 3, { model: 'yolo' }, { now: NOW })).toBe(false)
  })

  test('returns false when typeId differs', () => {
    expect(isPreflightCurrent(snapshot(), 'yolo', 3, payload, { now: NOW })).toBe(false)
  })

  test('returns false when schemaRev differs', () => {
    expect(isPreflightCurrent(snapshot(), 'sdxl-lora', 4, payload, { now: NOW })).toBe(false)
  })

  test('returns false when createdAt is older than the TTL', () => {
    const expired = snapshot({ createdAt: NOW - PREFLIGHT_TTL_MS - 1 })
    expect(isPreflightCurrent(expired, 'sdxl-lora', 3, payload, { now: NOW })).toBe(false)
  })

  test('returns true at exactly the TTL boundary', () => {
    const boundary = snapshot({ createdAt: NOW - PREFLIGHT_TTL_MS })
    expect(isPreflightCurrent(boundary, 'sdxl-lora', 3, payload, { now: NOW })).toBe(true)
  })

  test('undefined snapshot is not current', () => {
    expect(isPreflightCurrent(undefined, 'sdxl-lora', 3, payload, { now: NOW })).toBe(false)
  })
})

describe('getPreflightRecommendedPatch', () => {
  test('returns the object from report.recommended_config_patch', () => {
    expect(getPreflightRecommendedPatch({ recommended_config_patch: { a: 1 } })).toEqual({ a: 1 })
  })

  test('returns null when absent or empty', () => {
    expect(getPreflightRecommendedPatch({})).toBeNull()
    expect(getPreflightRecommendedPatch({ recommended_config_patch: {} })).toBeNull()
    expect(getPreflightRecommendedPatch({ recommended_config_patch: [] })).toBeNull()
    expect(getPreflightRecommendedPatch(null)).toBeNull()
  })

  test('falls back to the nested training_capabilities patch', () => {
    expect(getPreflightRecommendedPatch({ training_capabilities: { recommended_config_patch: { b: 2 } } })).toEqual({ b: 2 })
    expect(getPreflightRecommendedPatch({ vram_profile: { recommended_config_patch: { c: 3 } } })).toEqual({ c: 3 })
  })
})

describe('fingerprintPayload', () => {
  test('same object with different key order produces the same fingerprint', () => {
    const first = { a: 1, b: { c: [1, 2], d: 'x' } }
    const second = { b: { d: 'x', c: [1, 2] }, a: 1 }
    expect(fingerprintPayload(first)).toBe(fingerprintPayload(second))
  })

  test('different values produce different fingerprints', () => {
    expect(fingerprintPayload({ a: 1 })).not.toBe(fingerprintPayload({ a: 2 }))
  })
})
