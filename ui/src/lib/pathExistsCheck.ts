// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { isPlaceholderDefault } from '@/lib/modelPathMatch'
import type { SchemaFieldLike } from '@/lib/modelPathMatch'
import { translate } from '@/i18n/useI18n'

export type PathCheckStatus = 'idle' | 'checking' | 'ok' | 'missing' | 'type_mismatch' | 'error'

export interface PathCheckResult {
  status: PathCheckStatus
  message: string
  exists?: boolean
  pathType?: string
}

/** checkPathStatus 的可选字段信息;含 pickerType / allowModelDirectory 以便应用 save-target 规则 */
export interface PathCheckOptions {
  type?: string
  key?: string
  defaultValue?: unknown
  pickerType?: string
  allowModelDirectory?: boolean
}

/**
 * 是否为「保存目标」字段:路径是"将要创建的文件/目录",而非要读取的既有文件。
 * 后端 picker 对这些字段开的是"选择既有文件"对话框(错误语义),UI 应改为选父目录。
 */
export function isSaveTargetField(field: PathCheckOptions | null | undefined): boolean {
  if (!field) return false
  if (field.pickerType === 'output-model-file') return true
  const key = String(field.key || '')
  if (key.endsWith('output_path')) return true
  if (key === 'output_dir') return true
  return false
}

const SAVE_TARGET_OK_HINT = '将在该目录创建输出文件'

const cache = new Map<string, { at: number; result: PathCheckResult }>()
const CACHE_TTL_MS = 15_000

function cacheKey(path: string, expect: string) {
  return `${expect}::${path}`
}

/** 空/占位不检查 */
export function shouldCheckPath(path: string, field?: SchemaFieldLike | null): boolean {
  const text = String(path ?? '').trim()
  if (!text) return false
  if (isPlaceholderDefault(text, field || undefined)) return false
  return true
}

export function statusMessage(status: PathCheckStatus, fieldType?: string): string {
  if (status === 'missing') return translate('path.missing')
  if (status === 'type_mismatch') {
    return fieldType === 'folder' ? translate('path.expect_dir') : translate('path.expect_file')
  }
  if (status === 'error') return translate('path.check_fail')
  if (status === 'checking') return translate('path.checking')
  return ''
}

function toFieldLike(field: PathCheckOptions | null | undefined): SchemaFieldLike | null {
  if (!field) return null
  return {
    key: String(field.key || ''),
    type: field.type,
    pickerType: field.pickerType,
    defaultValue: field.defaultValue,
  }
}

/** 取路径的父目录字符串(用于 save-target 校验:检查父目录是否存在) */
export function parentDirOf(path: string): string {
  const raw = String(path ?? '').trim()
  if (!raw) return '/'
  let text = raw.replace(/[\\/]+$/, '')
  if (!text) return '/'
  const idx = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  if (idx < 0) return '/'
  if (idx === 0) return text.charAt(0)
  let parent = text.slice(0, idx)
  // 裸盘符 → 补分隔符(C: → C:/),便于后端校验
  if (/^[a-zA-Z]:$/.test(parent)) parent += '/'
  return parent || '/'
}

/** 期望类型:file 或 dir */
function expectType(field: PathCheckOptions | null | undefined, saveTarget: boolean): 'dir' | 'file' {
  if (saveTarget) return 'dir'
  if (field?.allowModelDirectory) return 'dir'
  if (field?.type === 'folder') return 'dir'
  return 'file'
}

export async function checkPathStatus(
  path: string,
  field: PathCheckOptions | null,
): Promise<PathCheckResult> {
  const text = String(path ?? '').trim()
  const like = toFieldLike(field)
  if (!shouldCheckPath(text, like)) {
    return { status: 'idle', message: '' }
  }
  const saveTarget = isSaveTargetField(field)
  const expect = expectType(field, saveTarget)
  // save-target: 校验的是"要创建的文件的父目录"
  const checkPath = saveTarget ? parentDirOf(text) : text
  // 缓存原始结果;message 按调用方语义(save-target 与否)逐次映射,避免两种语义互相污染
  const key = cacheKey(checkPath, expect)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return mapToResult(hit.result, saveTarget, field?.type)

  let raw: PathCheckResult
  try {
    const resp = await trainApi.checkPathExists(checkPath)
    const data = unwrap<{ exists?: boolean; type?: string }>(resp) || {}
    const exists = Boolean(data.exists)
    const pathType = String(data.type || (exists ? 'dir' : 'missing'))
    let status: PathCheckStatus = 'ok'
    if (!exists || pathType === 'missing') status = 'missing'
    else if (expect === 'file' && pathType === 'dir') status = 'type_mismatch'
    else if (expect === 'dir' && pathType === 'file') status = 'type_mismatch'
    raw = { status, message: '', exists, pathType }
  } catch {
    raw = { status: 'error', message: '' }
  }
  cache.set(key, { at: Date.now(), result: raw })
  return mapToResult(raw, saveTarget, field?.type)
}

function mapToResult(
  raw: PathCheckResult,
  saveTarget: boolean,
  fieldType?: string,
): PathCheckResult {
  if (raw.status === 'error') {
    return { ...raw, message: statusMessage('error', fieldType) }
  }
  if (saveTarget) {
    // 父目录确为目录 → ok;父目录缺失或非目录 → missing
    return raw.status === 'ok'
      ? { ...raw, status: 'ok', message: SAVE_TARGET_OK_HINT }
      : { ...raw, status: 'missing', message: statusMessage('missing', fieldType) }
  }
  return { ...raw, message: statusMessage(raw.status, fieldType) }
}
