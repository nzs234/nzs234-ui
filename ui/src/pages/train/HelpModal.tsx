// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import type { SchemaField, SchemaFieldOption } from '@/schema/schemaIndex'
import { Modal } from '@/components/overlay'
import { Badge } from '@/components/primitives'
import { useI18n } from '@/i18n/useI18n'
import {
  buildSchemaFallbackEntry,
  loadTrainingWikiEntry,
  type WikiEntry,
} from '@/utils/trainingWiki'

/* 字段帮助: training-wiki manifest + aliases → entries/{key}.json
 * 结构 {title,category,appliesTo,standard{...},advanced{...},relatedConfigs}
 * select 额外展示 field.options + wiki recommendedValues / optionDescriptions
 * miss → schema fallback（P2 双树）
 */

type OptionRow = {
  value: string
  label: string
  description?: string
}

const STANDARD_KEYS: Record<string, string> = {
  summary: 'help.summary',
  effect: 'help.effect',
  whenToUse: 'help.when',
  avoidWhen: 'help.avoid',
}
const ADVANCED_KEYS: Record<string, string> = {
  principle: 'help.principle',
  tradeoffs: 'help.tradeoff',
}

/** Nested maps in wiki standard — not plain prose rows. */
const OPTION_MAP_KEYS = new Set(['recommendedValues', 'optionDescriptions', 'options', 'choices', 'values'])

function asStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[String(k)] = String(v)
    }
  }
  return out
}

function proseMap(
  data: Record<string, unknown> | null | undefined,
  allowed: Record<string, string>,
): Record<string, string> {
  if (!data) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (OPTION_MAP_KEYS.has(k)) continue
    if (!(k in allowed) && typeof v !== 'string') continue
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

function normalizeSchemaOption(opt: string | SchemaFieldOption): { value: string; label: string } | null {
  if (opt == null) return null
  if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
    const value = String(opt)
    return { value, label: value }
  }
  if (typeof opt === 'object') {
    const value = opt.value == null ? '' : String(opt.value)
    if (!value && !opt.label) return null
    return { value, label: String(opt.label || value) }
  }
  return null
}

function optionKeyAliases(value: string): string[] {
  const raw = String(value || '')
  const lower = raw.toLowerCase()
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  const compact = snake.replace(/_/g, '')
  const digitSplit = snake.replace(/([a-z])(\d)/g, '$1_$2')
  const digitCompact = digitSplit.replace(/_/g, '')
  const soft = snake.replace(/_+/g, '_')
  return [...new Set([raw, lower, snake, compact, digitSplit, digitCompact, soft].filter(Boolean))]
}

/**
 * 返回该选项认领的**全部** wiki 键（不是说明文本）。
 *
 * 必须是全部而不是首个：`optionDescriptions` 讲「它是什么」、`recommendedValues` 讲
 * 「为什么选它」，两张表被压平成一个对象，同一个选项在两边的键名常常写法不同
 * （`AdamW8bit` vs `adamw_8bit`）。只认领首个命中的话，另一个键就会漏成孤儿，
 * 被当成一行「补充说明」，标签直接显示 `adamw_8bit` 这种原始键名。
 */
function lookupOptionDescriptionKeys(
  wikiDesc: Record<string, string>,
  value: string,
  label: string
): string[] {
  const hits: string[] = []
  const direct = new Set([...optionKeyAliases(value), ...optionKeyAliases(label)])
  const compact = new Set(
    [...direct].map((s) => s.toLowerCase().replace(/_/g, '')).filter(Boolean)
  )
  for (const k of Object.keys(wikiDesc)) {
    if (direct.has(k) || compact.has(k.toLowerCase().replace(/_/g, ''))) hits.push(k)
  }
  return hits
}

/**
 * 把 wiki 的说明贴到 schema 真实 options 上，并把「贴不上去的 wiki 键」单独拆出来。
 *
 * 拆分的原因：这些键并不都是可选值。`recommendedValues` 装的是场景建议
 * （`block + swap_ratio=0.3-0.5`），`optionDescriptions` 里也有名词解释
 * （thunder 的 `nvfuser` / `sdpa` 是逗号组合串里的分量，不是能单选的值）。
 * 以前它们被无条件塞进「可选值」列表，用户就会看到选择器里根本没有的值，
 * 和真实的幽灵值长得一模一样。现在归到「补充说明」，不再冒充可选项。
 */
function buildOptionRows(
  field: SchemaField,
  entry: WikiEntry | null
): { options: OptionRow[]; notes: OptionRow[] } {
  const wikiDesc = {
    ...asStringMap(entry?.optionDescriptions),
    ...asStringMap(entry?.standard?.optionDescriptions),
    ...asStringMap(entry?.standard?.recommendedValues),
  }
  const schemaOpts = Array.isArray(field.options) ? field.options : []
  const options: OptionRow[] = []
  const seen = new Set<string>()
  // 记下被 option 用掉的 wiki 键（含别名命中，如 adamw_8bit → AdamW8bit），
  // 否则同一条说明会既贴在选项上、又多出一行补充说明。
  const consumed = new Set<string>()

  for (const opt of schemaOpts) {
    const n = normalizeSchemaOption(opt)
    if (!n) continue
    const key = n.value || n.label
    if (seen.has(key)) continue
    seen.add(key)
    const hits = lookupOptionDescriptionKeys(wikiDesc, n.value, n.label)
    for (const h of hits) consumed.add(h)
    // 同一选项在两张表里都有话说时全部展示，去重后按原顺序拼接。
    const texts = [...new Set(hits.map((h) => wikiDesc[h]).filter(Boolean))]
    options.push({
      value: n.value,
      label: n.label,
      description: texts.length ? texts.join('　·　') : undefined,
    })
  }

  const notes: OptionRow[] = []
  for (const [k, desc] of Object.entries(wikiDesc)) {
    if (seen.has(k) || consumed.has(k)) continue
    notes.push({ value: '', label: k, description: desc })
  }

  return { options, notes }
}

function KvBlock({
  data,
  labelKeys,
  t,
}: {
  data: Record<string, string>
  labelKeys: Record<string, string>
  t: (key: string) => string
}) {
  const rows = Object.entries(data).filter(([, v]) => v)
  if (!rows.length) return null
  return (
    <dl className="lx-wiki-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{labelKeys[k] ? t(labelKeys[k]) : k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function OptionsBlock({
  rows,
  heading,
  t,
}: {
  rows: OptionRow[]
  heading: string
  t: (key: string) => string
}) {
  if (!rows.length) return null
  return (
    <>
      <h4 className="lx-wiki-h">{t(heading)}</h4>
      <ul className="lx-wiki-options">
        {rows.map((row) => (
          <li key={row.value || row.label} className="lx-wiki-option">
            <div className="lx-wiki-option-head">
              <span className="lx-wiki-option-label">{row.label}</span>
              {row.value && row.value !== row.label ? (
                <code className="lx-num lx-wiki-option-value">{row.value}</code>
              ) : null}
            </div>
            {row.description ? <p className="lx-wiki-option-desc">{row.description}</p> : null}
          </li>
        ))}
      </ul>
    </>
  )
}

export function HelpModal({ field, onClose }: { field: SchemaField | null; onClose: () => void }) {
  const { t } = useI18n()
  const [entry, setEntry] = useState<WikiEntry | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!field) return
    setLoading(true)
    setEntry(null)
    let alive = true
    void loadTrainingWikiEntry(field.key)
      .then((wiki) => {
        if (!alive) return
        setEntry(wiki || buildSchemaFallbackEntry(field))
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setEntry(buildSchemaFallbackEntry(field))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [field])

  const { options: optionRows, notes: noteRows } = useMemo(
    () => (field ? buildOptionRows(field, entry) : { options: [], notes: [] }),
    [field, entry]
  )
  const standardProse = useMemo(
    () => proseMap((entry?.standard as Record<string, unknown> | null | undefined) ?? undefined, STANDARD_KEYS),
    [entry],
  )
  const advancedProse = useMemo(
    () => proseMap((entry?.advanced as Record<string, unknown> | null | undefined) ?? undefined, ADVANCED_KEYS),
    [entry],
  )

  return (
    <Modal open={!!field} title={entry?.title || field?.label || field?.key || ''} onClose={onClose} width={560}>
      {field ? (
        <div className="lx-wiki">
          <div className="lx-wiki-meta">
            <code className="lx-num">{field.key}</code>
            {entry?.category ? <Badge>{entry.category}</Badge> : null}
            {entry?.fallback ? <Badge tone="accent">schema</Badge> : null}
            {(entry?.appliesTo ?? []).slice(0, 4).map((item) => (
              <Badge key={item} tone="accent">
                {item}
              </Badge>
            ))}
          </div>
          {loading ? (
            <p className="lx-wiki-fallback">{t('help.loading')}</p>
          ) : (
            <>
              {entry ? (
                <>
                  {Object.keys(standardProse).length ? (
                    <KvBlock data={standardProse} labelKeys={STANDARD_KEYS} t={t} />
                  ) : null}
                  {Object.keys(advancedProse).length ? (
                    <>
                      <h4 className="lx-wiki-h">{t('help.advanced')}</h4>
                      <KvBlock data={advancedProse} labelKeys={ADVANCED_KEYS} t={t} />
                    </>
                  ) : null}
                  {!Object.keys(standardProse).length && !Object.keys(advancedProse).length ? (
                    <p className="lx-wiki-fallback">{field.desc || field.title || t('help.empty')}</p>
                  ) : null}
                </>
              ) : (
                <p className="lx-wiki-fallback">{field.desc || field.title || t('help.empty')}</p>
              )}
              <OptionsBlock rows={optionRows} heading="help.options" t={t} />
              <OptionsBlock rows={noteRows} heading="help.notes" t={t} />
              {entry?.relatedConfigs?.length ? (
                <>
                  <h4 className="lx-wiki-h">{t('help.related')}</h4>
                  <div className="lx-wiki-meta">
                    {entry.relatedConfigs.map((k) => (
                      <code key={k} className="lx-num">
                        {k}
                      </code>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
