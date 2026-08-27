// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 本地 inventory → 训练字段路径匹配(保守:唯一才自动填,多候选只列) */

export interface PathCandidate {
  path: string
  name: string
  model_family: string
  model_type: string
  artifact_kind: string
  size: number
  modified_at: string
  tags: string[]
}

export interface SchemaFieldLike {
  key: string
  type?: string
  pickerType?: string
  defaultValue?: unknown
}

const LORA_KINDS = new Set(['lora', 'acceleration_lora', 'acceleration-lora'])
const VAE_HINTS = ['vae']
const LLM_HINTS = ['llm', 'qwen', 'clip', 'text_encoder', 'text-encoder', 'tokenizer']

/** typeId 前缀 → model_family 候选(小写) */
export function familiesForTypeId(typeId: string): string[] {
  const id = String(typeId || '').toLowerCase()
  if (id.startsWith('anima')) return ['anima']
  if (id.startsWith('newbie')) return ['newbie']
  if (id.startsWith('krea2') || id.startsWith('krea-2') || id.startsWith('krea')) return ['krea2', 'krea']
  if (id.startsWith('boogu')) return ['boogu']
  if (id.startsWith('wan')) return ['wan', 'wan22', 'wan2.2', 'wan2']
  if (id.startsWith('flux')) return ['flux']
  if (id.startsWith('sdxl')) return ['sdxl']
  if (id.startsWith('sd15') || id.startsWith('sd1')) return ['sd15', 'sd1.5']
  return []
}

/**
 * 判定「看起来填了其实没选真路径」。
 * Wave D0 起 schema 主模 default 已是空串；旧草稿/磁盘仍可能写着 ./sd-models/...，
 * 必须继续当空，否则 autofill / path check / LAST seed 会误判。
 */
export function isPlaceholderDefault(value: unknown, field?: SchemaFieldLike | null): boolean {
  const text = String(value ?? '').trim()
  if (!text) return true
  // 历史假路径(与 schema default 是否仍写它无关)
  if (text.startsWith('./sd-models') || text.startsWith('.\\sd-models')) return true
  if (text === './sd-models/model.safetensors' || text === '.\\sd-models\\model.safetensors') return true
  const def = field ? String(field.defaultValue ?? '').trim() : ''
  if (def && text === def) {
    if (def.startsWith('./') || def.startsWith('.\\')) return true
    if (def.includes('sd-models') || def.includes('model.safetensors')) return true
  }
  return false
}

/** 空串 / schema 占位默认 → 允许自动填 */
export function isPathEmptyForAutofill(value: unknown, field?: SchemaFieldLike | null): boolean {
  const text = String(value ?? '').trim()
  if (!text) return true
  return isPlaceholderDefault(text, field)
}

function haystack(item: PathCandidate): string {
  return [
    item.path,
    item.name,
    item.model_family,
    item.model_type,
    item.artifact_kind,
    ...(item.tags || []),
  ]
    .join(' ')
    .toLowerCase()
}

function isLoraLike(item: PathCandidate): boolean {
  const kind = (item.artifact_kind || item.model_type || '').toLowerCase().replace(/-/g, '_')
  if (LORA_KINDS.has(kind)) return true
  const h = haystack(item)
  return h.includes('lora') && !h.includes('checkpoint')
}

function matchesFamily(item: PathCandidate, families: string[]): boolean {
  if (!families.length) return true
  const fam = (item.model_family || '').toLowerCase()
  if (fam && families.some((f) => fam === f || fam.includes(f) || f.includes(fam))) return true
  const h = haystack(item)
  return families.some((f) => h.includes(f))
}

function roleFilter(fieldKey: string, item: PathCandidate): boolean {
  const key = fieldKey.toLowerCase()
  const h = haystack(item)
  const kind = (item.artifact_kind || item.model_type || '').toLowerCase()

  if (key === 'network_weights' || key.includes('lora') && key.includes('weight')) {
    return isLoraLike(item)
  }
  if (key === 'vae' || key.endsWith('_vae') || key.includes('vae_path')) {
    return VAE_HINTS.some((t) => kind.includes(t) || h.includes(t))
  }
  if (
    key === 'qwen3' ||
    key.includes('llm') ||
    key.includes('text_encoder') ||
    key.includes('clip') ||
    key.includes('tokenizer')
  ) {
    return LLM_HINTS.some((t) => kind.includes(t) || h.includes(t))
  }
  if (key === 'pretrained_model_name_or_path' || key.includes('dit') || key.includes('unet') || key.includes('transformer')) {
    if (isLoraLike(item)) return false
    if (VAE_HINTS.some((t) => kind === t)) return false
    // 主权重: checkpoint / dit / unet / 空 kind 大文件
    if (['checkpoint', 'dit', 'unet', 'transformer', 'base'].some((t) => kind.includes(t))) return true
    if (!kind || kind === 'model' || kind === 'file') return true
    // family 命中但 kind 未知: 仍接受非 lora/vae
    return !VAE_HINTS.some((t) => h.includes(`/${t}`) || h.includes(`\\${t}`))
  }
  // 其他 model-file: 排除 lora 默认
  return !isLoraLike(item)
}

/** 是否参与自动填(network_weights 仅扫描手动选) */
export function fieldAllowsAutofill(fieldKey: string): boolean {
  const key = fieldKey.toLowerCase()
  if (key === 'network_weights') return false
  if (key === 'resume') return false
  // output_path 是「写出 sidecar/LoRA」的落盘目标,自动填已有权重路径
  // 会让训练尝试覆写 inventory 里的模型,必须手动选
  if (key === 'output_path') return false
  return true
}

/** 纯文本/图片类文件字段(LUT/manifest/参考图)不参与模型权重自动填 */
function isNonModelFilePicker(field: SchemaFieldLike): boolean {
  return field.pickerType === 'text-file' || field.pickerType === 'image-file'
}

export function normalizeResourceItems(raw: unknown[]): PathCandidate[] {
  const out: PathCandidate[] = []
  for (const row of raw || []) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const path = String(r.path || '').trim()
    if (!path) continue
    out.push({
      path,
      name: String(r.name || path.split(/[/\\]/).pop() || path),
      model_family: String(r.model_family || ''),
      model_type: String(r.model_type || ''),
      artifact_kind: String(r.artifact_kind || r.kind || ''),
      size: Number(r.size) || 0,
      modified_at: String(r.modified_at || ''),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    })
  }
  return out
}

export function filterCandidatesForField(
  items: PathCandidate[],
  typeId: string,
  fieldKey: string,
  opts: { requireFamily?: boolean; limit?: number } = {},
): PathCandidate[] {
  const families = familiesForTypeId(typeId)
  const requireFamily = opts.requireFamily ?? fieldKey === 'pretrained_model_name_or_path'
  const limit = opts.limit ?? 12
  let list = items.filter((it) => roleFilter(fieldKey, it))
  if (requireFamily) {
    if (!families.length) return []
    list = list.filter((it) => matchesFamily(it, families))
  } else if (families.length) {
    // 软偏好: family 命中优先,但不丢非 family(vae/llm 可能无 family)
    const famHit = list.filter((it) => matchesFamily(it, families))
    if (famHit.length) list = famHit
  }
  list = [...list].sort((a, b) => b.size - a.size || b.modified_at.localeCompare(a.modified_at))
  return list.slice(0, limit)
}

/** 唯一高置信 → path; 否则 null */
export function uniqueAutofillPath(
  items: PathCandidate[],
  typeId: string,
  fieldKey: string,
): string | null {
  if (!fieldAllowsAutofill(fieldKey)) return null
  const hits = filterCandidatesForField(items, typeId, fieldKey, { limit: 3 })
  if (hits.length !== 1) return null
  return hits[0].path
}

/** 对 draft 中可自动填字段应用唯一匹配(不覆盖非空) */
export function applyUniqueAutofill(
  draft: Record<string, unknown>,
  typeId: string,
  items: PathCandidate[],
  fields: SchemaFieldLike[],
): Record<string, string> {
  const updates: Record<string, string> = {}
  for (const field of fields) {
    // LUT/manifest/参考图等非权重文件字段不自动填:
    // roleFilter 兜底分支只排除 LoRA,放进来会把底模写进 JSON 路径字段
    if (isNonModelFilePicker(field)) continue
    if (field.type !== 'file' && field.pickerType !== 'model-file') continue
    if (!fieldAllowsAutofill(field.key)) continue
    if (!isPathEmptyForAutofill(draft[field.key], field)) continue
    const path = uniqueAutofillPath(items, typeId, field.key)
    if (path) updates[field.key] = path
  }
  return updates
}
