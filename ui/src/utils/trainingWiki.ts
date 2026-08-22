// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * Training wiki loader with manifest aliases + schema fallback.
 * Parity target: lora-scripts-ui-main/ui/src/utils/trainingWiki.js (P2 dual-tree).
 */
import type { SchemaField } from '@/schema/schemaIndex'

const WIKI_ROOT = 'training-wiki'

export type WikiStandard = {
  summary?: string
  effect?: string
  whenToUse?: string
  avoidWhen?: string
  recommendedValues?: Record<string, string>
  optionDescriptions?: Record<string, string>
  [key: string]: unknown
}

export type WikiAdvanced = {
  principle?: string
  tradeoffs?: string
  [key: string]: unknown
}

export type WikiEntry = {
  key?: string
  title?: string
  category?: string
  appliesTo?: string[]
  standard?: WikiStandard | null
  advanced?: WikiAdvanced | null
  relatedConfigs?: string[]
  optionDescriptions?: Record<string, string>
  fallback?: boolean
  resolvedVia?: string
}

type ManifestItem = {
  key?: string
  entry?: string
  aliases?: string[]
}

type Manifest = {
  entries?: ManifestItem[]
}

let manifestPromise: Promise<Manifest> | null = null
const entryPromises = new Map<string, Promise<WikiEntry | null>>()

export async function loadTrainingWikiManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<Manifest>(`${WIKI_ROOT}/manifest.json`).catch(() => ({ entries: [] }))
  }
  return manifestPromise
}

export async function loadTrainingWikiEntry(fieldKey: string): Promise<WikiEntry | null> {
  const key = String(fieldKey || '').trim()
  if (!key) return null
  if (!entryPromises.has(key)) {
    entryPromises.set(key, resolveEntry(key))
  }
  return entryPromises.get(key) ?? null
}

/** Test/dev helper — clear in-memory caches between smoke runs. */
export function clearTrainingWikiCache(): void {
  manifestPromise = null
  entryPromises.clear()
}

export function buildSchemaFallbackEntry(field: SchemaField | null | undefined): WikiEntry | null {
  if (!field) return null
  const key = String(field.key || '').trim()
  const label = stripKeySuffix(String(field.label || key || '参数说明'))
  const desc = String(field.desc || field.importantDesc || '').trim()
  const summary =
    desc ||
    (key
      ? `「${label}」对应训练配置键 ${key}。完整 Wiki 条目还在补充中，以下为 schema 推断。`
      : '这个参数来自当前训练 schema，完整 Wiki 条目还在补充中。')

  const type = String(field.type || 'string').toLowerCase()
  const defaultText = formatDefault(field.defaultValue)
  const effect = buildEffectLine(type, label, desc, defaultText)
  const whenToUse = buildWhenToUseLine(type, desc, defaultText)
  const avoidWhen = buildAvoidWhenLine(type, field)

  return {
    key,
    title: label,
    category: '训练参数',
    standard: {
      summary,
      effect,
      whenToUse,
      avoidWhen,
    },
    advanced: null,
    relatedConfigs: [],
    fallback: true,
    resolvedVia: 'schema_fallback',
  }
}

async function resolveEntry(key: string): Promise<WikiEntry | null> {
  const manifest = await loadTrainingWikiManifest()
  const item = findManifestEntry(manifest, key)
  if (item?.entry) {
    const fromManifest = await fetchJson<WikiEntry>(`${WIKI_ROOT}/${item.entry}`).catch(() => null)
    if (fromManifest) {
      return {
        ...fromManifest,
        key: fromManifest.key || item.key || key,
        resolvedVia: item.key === key ? 'manifest_key' : 'manifest_alias',
      }
    }
  }
  // Manifest lag safety: still try entries/{key}.json when registered path fails or is missing.
  const direct = await fetchJson<WikiEntry>(
    `${WIKI_ROOT}/entries/${encodeURIComponent(key)}.json`,
  ).catch(() => null)
  if (direct) {
    return { ...direct, key: direct.key || key, resolvedVia: 'entries_direct' }
  }
  return null
}

function findManifestEntry(manifest: Manifest | null | undefined, key: string): ManifestItem | null {
  const entries = Array.isArray(manifest?.entries) ? manifest!.entries! : []
  return (
    entries.find(
      (item) => item.key === key || (Array.isArray(item.aliases) && item.aliases.includes(key)),
    ) || null
  )
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Wiki resource not found: ${url}`)
  return (await response.json()) as T
}

function stripKeySuffix(label: string): string {
  return String(label || '')
    .replace(/（[^）]+）\s*$/, '')
    .trim()
}

function formatDefault(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}…` : value
  try {
    const s = JSON.stringify(value)
    return s.length > 80 ? `${s.slice(0, 77)}…` : s
  } catch {
    return ''
  }
}

function buildEffectLine(type: string, label: string, desc: string, defaultText: string): string {
  if (desc) {
    if (defaultText !== '') return `${desc}（schema 默认：${defaultText}）`
    return desc
  }
  if (type === 'boolean') {
    return defaultText === 'true'
      ? `默认开启。关闭「${label}」会改变训练/运行时行为，请结合预检确认。`
      : `默认关闭。开启「${label}」后才会进入对应训练/运行时路径。`
  }
  if (type === 'select') {
    return defaultText
      ? `从选项中选择；schema 默认值为 ${defaultText}。`
      : '从下拉选项中选择合适的取值。'
  }
  if (type === 'number') {
    return defaultText !== ''
      ? `数值参数；schema 默认 ${defaultText}。建议小步调整并短测。`
      : '数值参数；建议小步调整并短测。'
  }
  return '具体效果取决于当前训练类型和后端运行时解析。'
}

function buildWhenToUseLine(type: string, desc: string, defaultText: string): string {
  const lower = desc.toLowerCase()
  if (/debug|调试|诊断|probe|实验|experimental|research/.test(lower)) {
    return '主要用于调试/实验场景；确认问题后再考虑长期打开。'
  }
  if (/hdd|整片|shard|缓存|cache|磁盘/.test(desc)) {
    return '按磁盘介质与缓存策略选择；HDD 更宜整片，SSD/调试可 per_file。'
  }
  if (type === 'boolean' && defaultText === 'false') {
    return '需要对应能力时再开启；不确定时先保持默认关闭并短测。'
  }
  if (type === 'boolean' && defaultText === 'true') {
    return '产品默认路径通常保持开启；仅在明确冲突或预检建议时再关。'
  }
  return '不确定时先保持默认值，小步数短测确认再调整。'
}

function buildAvoidWhenLine(type: string, field: SchemaField): string {
  const parts: string[] = []
  if (typeof field.visibleWhen === 'function') {
    parts.push('它可能受其它选项显隐/互斥约束，界面隐藏时不要强行写进导出配置')
  }
  const desc = String(field.desc || '')
  if (/互斥|冲突|不要|勿|禁止|exclusive|incompatible/.test(desc)) {
    parts.push('描述中已提示互斥或风险，优先按预检与描述处理')
  }
  if (type === 'boolean') {
    parts.push('与预检/依赖冲突时优先关实验开关')
  }
  if (!parts.length) {
    return '如果它与其它选项互斥、预检提示冲突，优先按预检建议处理。'
  }
  return `${parts.join('；')}。`
}
