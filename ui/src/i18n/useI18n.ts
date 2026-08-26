// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback } from 'react'
import { useLocaleStore } from '@/stores/localeStore'
import zh from './zh.json'
import en from './en.json'
import schemaFieldLabelsEn from './schemaFieldLabelsEn.json'
import schemaFieldDescsEn from './schemaFieldDescsEn.json'
import schemaFieldOptionsEn from './schemaFieldOptionsEn.json'
import schemaTabsEn from './schemaTabsEn.json'
import schemaGroupsEn from './schemaGroupsEn.json'

const bundles: Record<string, Record<string, string>> = { zh, en }

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

function formatMessage(
  language: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const bundle = bundles[language] ?? bundles.zh
  let text = bundle[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

/** Non-hook translator for pure helpers (uses current locale store language). */
export function translate(key: string, vars?: Record<string, string | number>): string {
  return formatMessage(useLocaleStore.getState().language, key, vars)
}

export function useI18n() {
  const language = useLocaleStore((s) => s.language)

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => formatMessage(language, key, vars),
    [language],
  )

  return { t, language }
}

/** Schema field label/desc resolver (label_zh/label_en with label fallback). */
export function resolveFieldLabel(
  field: { key?: string; label?: string; label_zh?: string; label_en?: string; [k: string]: unknown },
  language: string,
): string {
  const preferEn = language === 'en'
  const primary = preferEn ? field.label_en : field.label_zh
  const secondary = preferEn ? field.label_zh : field.label_en
  if (typeof primary === 'string' && primary.trim()) return primary
  if (preferEn && field.key && typeof (schemaFieldLabelsEn as Record<string, string>)[field.key] === 'string') {
    return (schemaFieldLabelsEn as Record<string, string>)[field.key]
  }
  if (typeof secondary === 'string' && secondary.trim()) return secondary
  if (typeof field.label === 'string' && field.label.trim()) return field.label
  return String(field.key ?? '')
}

/** Resolve training UI tab label (UI_TABS). */
export function resolveTabLabel(tab: { key: string; label?: string }, language: string): string {
  if (language === 'en') {
    const en = (schemaTabsEn as Record<string, string>)[tab.key]
    if (en) return en
  }
  return tab.label || tab.key
}

export function resolveGroupLabel(group: string, language: string): string {
  if (language === 'en') {
    const en = (schemaGroupsEn as Record<string, string>)[group]
    if (en) return en
  }
  return group
}

export function resolveFieldDesc(
  field: {
    key?: string
    desc?: string
    desc_zh?: string
    desc_en?: string
    title?: string
    [k: string]: unknown
  },
  language: string,
): string {
  const preferEn = language === 'en'
  const primary = preferEn ? field.desc_en : field.desc_zh
  const secondary = preferEn ? field.desc_zh : field.desc_en
  if (typeof primary === 'string' && primary.trim()) return primary
  if (
    preferEn &&
    field.key &&
    typeof (schemaFieldDescsEn as Record<string, string>)[field.key] === 'string'
  ) {
    return (schemaFieldDescsEn as Record<string, string>)[field.key]
  }
  if (typeof secondary === 'string' && secondary.trim()) return secondary
  if (typeof field.desc === 'string' && field.desc.trim()) return field.desc
  if (typeof field.title === 'string' && field.title.trim()) return field.title
  return ''
}

/** Resolve select/multiSelect option label for current language. */
export function resolveOptionLabel(
  fieldKey: string | undefined,
  option: { value?: string | number; label?: string; label_en?: string; label_zh?: string },
  language: string,
): string {
  const preferEn = language === 'en'
  const value = option.value == null ? '' : String(option.value)
  if (preferEn) {
    if (typeof option.label_en === 'string' && option.label_en.trim()) return option.label_en
    if (fieldKey && value) {
      const hit = (schemaFieldOptionsEn as Record<string, string>)[`${fieldKey}|${value}`]
      if (typeof hit === 'string' && hit.trim()) return hit
    }
  } else if (typeof option.label_zh === 'string' && option.label_zh.trim()) {
    return option.label_zh
  }
  if (typeof option.label === 'string' && option.label.trim()) return option.label
  return value
}

/**
 * Resolve a disabled option/field reason for current language.
 *
 * schema 的 disabledReason 默认是中文；带 disabledReason_en 的条目（可见的
 * disabled 选项：KL-Shampoo/Gluon、flux train_t5xxl/tlora_flux 等）在 EN 下走英文，
 * 不再裸露中文。与 resolveFieldLabel 的双语字段优先级同构：en 命中 → zh 原文。
 */
export function resolveDisabledReason(
  target: { disabledReason?: string; disabledReason_en?: string } | undefined,
  language: string,
): string {
  if (!target) return ''
  if (
    language === 'en' &&
    typeof target.disabledReason_en === 'string' &&
    target.disabledReason_en.trim()
  ) {
    return target.disabledReason_en
  }
  return typeof target.disabledReason === 'string' ? target.disabledReason : ''
}
