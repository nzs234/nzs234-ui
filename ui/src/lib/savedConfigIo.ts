// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 命名预设 JSON import/export（纯前端，不经训练入口） */
import { resolveTrainingTypeId } from '@/lib/trainingTypeAccess'
import { translate } from '@/i18n/useI18n'

export const SAVED_CONFIG_IO_MAX_BYTES = 2 * 1024 * 1024

export interface SavedConfigBundle {
  name: string
  schema_id?: string
  typeId?: string
  config: Record<string, unknown>
  exported_at?: number
  source?: string
}

export function safeFileStem(name: string): string {
  const cleaned = Array.from(String(name || 'preset').trim())
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code < 32) return '_'
      if ('<>:"/\\|?*'.includes(ch)) return '_'
      if (/\s/.test(ch)) return '-'
      return ch
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/_+/g, '_')
    .slice(0, 80)
  return cleaned || 'preset'
}

export function buildExportBundle(opts: {
  name: string
  config: Record<string, unknown>
  schemaId?: string
}): SavedConfigBundle {
  return {
    name: String(opts.name || 'preset').trim() || 'preset',
    schema_id: opts.schemaId || undefined,
    typeId: opts.schemaId || undefined,
    config: { ...(opts.config || {}) },
    exported_at: Date.now(),
    source: 'lulynx-webui',
  }
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const text = JSON.stringify(payload, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function exportBundleToDownload(bundle: SavedConfigBundle): void {
  downloadJsonFile(`${safeFileStem(bundle.name)}.json`, bundle)
}

/** 从 bundle 解析出的 schema_id 中挑出已注册类型 id(未注册/禁用交由调用方决定) */
export function pickImportTypeId(bundle: { schema_id?: string; schemaId?: string; typeId?: string; type_id?: string }): string | null {
  const candidates = [bundle.schema_id, bundle.schemaId, bundle.typeId, bundle.type_id]
  for (const candidate of candidates) {
    const resolved = resolveTrainingTypeId(String(candidate || '').trim())
    if (resolved) return resolved
  }
  return null
}

/** 解析导入 JSON；非法 / 过大 / 非 object → throw Error 消息 */
export function parseSavedConfigImport(text: string, byteLength?: number): SavedConfigBundle {
  if (byteLength != null && byteLength > SAVED_CONFIG_IO_MAX_BYTES) {
    throw new Error(translate('io.file_too_large', { mb: SAVED_CONFIG_IO_MAX_BYTES / 1024 / 1024 }))
  }
  if (text.length > SAVED_CONFIG_IO_MAX_BYTES) {
    throw new Error(translate('io.file_too_large', { mb: SAVED_CONFIG_IO_MAX_BYTES / 1024 / 1024 }))
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(translate('io.invalid_json'))
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(translate('io.root_must_object'))
  }
  const root = raw as Record<string, unknown>
  // 兼容 { name, config } / 直接 config 扁平 / { data: { config } }
  const nested =
    root.config && typeof root.config === 'object' && !Array.isArray(root.config)
      ? (root.config as Record<string, unknown>)
      : root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? ((root.data as Record<string, unknown>).config &&
          typeof (root.data as Record<string, unknown>).config === 'object'
            ? ((root.data as Record<string, unknown>).config as Record<string, unknown>)
            : (root.data as Record<string, unknown>))
        : null

  let config: Record<string, unknown>
  let name = String(root.name ?? root.id ?? '').trim()
  const schemaId = String(root.schema_id ?? root.schemaId ?? root.typeId ?? root.type_id ?? '').trim()

  if (nested && Object.keys(nested).length) {
    config = { ...nested }
    if (!name) name = String((root as { title?: string }).title || 'imported').trim()
  } else if (!('config' in root) && Object.keys(root).length) {
    // 扁平 config（无 name 包一层）
    const skip = new Set(['name', 'schema_id', 'schemaId', 'typeId', 'type_id', 'exported_at', 'source', 'version'])
    config = {}
    for (const [k, v] of Object.entries(root)) {
      if (!skip.has(k)) config[k] = v
    }
    if (!Object.keys(config).length) throw new Error(translate('io.no_config_field'))
    if (!name) name = 'imported'
  } else {
    throw new Error(translate('io.no_usable_config'))
  }

  return {
    name: name || 'imported',
    schema_id: schemaId || undefined,
    typeId: schemaId || undefined,
    config,
  }
}

export async function readFileAsSavedBundle(file: File): Promise<SavedConfigBundle> {
  if (file.size > SAVED_CONFIG_IO_MAX_BYTES) {
    throw new Error(translate('io.file_too_large', { mb: SAVED_CONFIG_IO_MAX_BYTES / 1024 / 1024 }))
  }
  const text = await file.text()
  const bundle = parseSavedConfigImport(text, file.size)
  if (!bundle.name || bundle.name === 'imported') {
    const stem = file.name.replace(/\.json$/i, '').trim()
    if (stem) bundle.name = stem
  }
  return bundle
}
