// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback } from 'react'
import { useLocaleStore } from '@/stores/localeStore'
import zh from './zh.json'
import en from './en.json'
import schemaTabsEn from './schemaTabsEn.json'
import schemaGroupsEn from './schemaGroupsEn.json'

/*
 * 按 field.key 索引的三份大 EN 包(labels/descs/options,合计 ~300KB)不在这里 ——
 * 它们只被 schema 字段渲染读到,留在本模块会随启动链(main → AppShell → Topbar →
 * useI18n)静态进入口 chunk,让每个路由的首屏都先下 300KB 训练字段文案。
 * 见 ./schemaFieldI18n.ts(resolveFieldLabel / resolveFieldDesc / resolveOptionLabel)。
 */

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

/**
 * Resolve a training type's entry annotation (registry `note`) for current language.
 *
 * note 是**类型级**属性（TRAINING_TYPES 条目上的入口标注），不是 schema 字段，
 * 所以走不了 schemaFieldDescsEn 那条按 field.key 索引的包。通道与
 * disabledReason/disabledReason_en 同构：registry 里就地挂 note_en，EN 命中即用，
 * 否则回落 zh 原文 —— 语言包里不需要为每个类型再造一个键。
 */
export function resolveTypeNote(
  target: { note?: string; note_en?: string } | undefined,
  language: string,
): string {
  if (!target) return ''
  if (language === 'en' && typeof target.note_en === 'string' && target.note_en.trim()) {
    return target.note_en
  }
  return typeof target.note === 'string' ? target.note : ''
}
