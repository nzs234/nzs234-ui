// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { translate } from '@/i18n/useI18n'

export interface OutputConflictResult {
  conflict: boolean
  message: string
  existing: string[]
}

const cache = new Map<string, { at: number; result: OutputConflictResult }>()
const CACHE_TTL_MS = 12_000

function keyOf(dir: string, name: string) {
  return `${dir.trim()}::${name.trim()}`
}

export function shouldCheckOutputConflict(dir: unknown, name: unknown): boolean {
  return Boolean(String(dir ?? '').trim() && String(name ?? '').trim())
}

export async function checkOutputConflictStatus(
  outputDir: string,
  outputName: string,
): Promise<OutputConflictResult> {
  const dir = String(outputDir ?? '').trim()
  const name = String(outputName ?? '').trim()
  if (!dir || !name) return { conflict: false, message: '', existing: [] }

  const key = keyOf(dir, name)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  try {
    const resp = await trainApi.checkOutputConflict(dir, name)
    const data = unwrap<Record<string, unknown>>(resp) || {}
    const existing = Array.isArray(data.existing_files)
      ? (data.existing_files as unknown[]).map(String)
      : []
    const conflict = data.conflict === true || data.exists === true || existing.length > 0
    const message = conflict
      ? typeof data.message === 'string' && data.message
        ? data.message
        : translate('output.conflict_exists', { extra: existing.length ? ` (${existing.join(', ')})` : '' })
      : ''
    const result = { conflict, message, existing }
    cache.set(key, { at: Date.now(), result })
    return result
  } catch {
    return { conflict: false, message: '', existing: [] }
  }
}
