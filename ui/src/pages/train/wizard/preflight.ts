// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { translate } from '@/i18n/useI18n'

export type PreflightListKey = 'errors' | 'blockers' | 'issues' | 'warnings' | 'notes' | 'messages' | 'checks'

/** 预检快照有效时长：超出后视为过期，即使 fingerprint 未变化也必须重新预检。 */
export const PREFLIGHT_TTL_MS = 10 * 60 * 1000

export interface PreflightSnapshot {
  typeId: string
  schemaRev: number
  fingerprint: string
  report: Record<string, unknown>
  warningConfirmed: boolean
  createdAt: number
}

export interface NormalizedPreflightReport {
  errors: unknown[]
  blockers: unknown[]
  issues: unknown[]
  warnings: unknown[]
  notes: unknown[]
  messages: unknown[]
  checks: unknown[]
  blocking: unknown[]
  confirmable: unknown[]
  canStart: boolean
}

function normalizeList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function normalizePreflightReport(value: unknown): NormalizedPreflightReport {
  const report = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result = {
    errors: normalizeList(report.errors),
    blockers: normalizeList(report.blockers),
    issues: normalizeList(report.issues),
    warnings: normalizeList(report.warnings),
    notes: normalizeList(report.notes),
    messages: normalizeList(report.messages),
    checks: normalizeList(report.checks),
  }
  const hasExplicitBlocking = result.errors.length > 0 || result.blockers.length > 0
  const canStart = report.can_start !== false
  // 后端 can_start=false 而列表为空时仍按阻塞处理（后端判定当前配置不可启动）。
  const blocking = [...result.errors, ...result.blockers]
  if (!canStart && !hasExplicitBlocking) {
    blocking.push({ message: translate('preflight.backend_reports_unstartable'), severity: 'blocker' })
  }
  return {
    ...result,
    blocking,
    confirmable: [...result.issues, ...result.warnings],
    canStart,
  }
}

/** 提取后端预检返回的 recommended_config_patch（自动修复候选），无则返回 null。 */
export function getPreflightRecommendedPatch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const report = value as Record<string, unknown>
  const patch = report.recommended_config_patch
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const entries = Object.entries(patch as Record<string, unknown>)
    return entries.length ? Object.fromEntries(entries) : null
  }
  const nested = (report.training_capabilities || report.vram_profile) as Record<string, unknown> | undefined
  const nestedPatch = nested?.recommended_config_patch
  if (nestedPatch && typeof nestedPatch === 'object' && !Array.isArray(nestedPatch)) {
    const entries = Object.entries(nestedPatch as Record<string, unknown>)
    return entries.length ? Object.fromEntries(entries) : null
  }
  return null
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

/** Small deterministic browser-safe fingerprint; cryptographic strength is unnecessary here. */
export function fingerprintPayload(value: unknown): string {
  const text = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`
}

export function isPreflightCurrent(
  snapshot: PreflightSnapshot | undefined,
  typeId: string,
  schemaRev: number,
  payload: Record<string, unknown>,
  opts: { now?: number; ttl?: number } = {},
): boolean {
  const now = opts.now ?? Date.now()
  const ttl = opts.ttl ?? PREFLIGHT_TTL_MS
  return Boolean(
    snapshot
      && snapshot.typeId === typeId
      && snapshot.schemaRev === schemaRev
      && snapshot.fingerprint === fingerprintPayload(payload)
      && (!snapshot.createdAt || now - snapshot.createdAt <= ttl),
  )
}

