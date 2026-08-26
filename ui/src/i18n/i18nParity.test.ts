// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * i18n 语言包契约门禁。
 *
 * 生产的 formatMessage() 在缺键时回落到**裸键本身**(`bundle[key] ?? key`),
 * 所以一个漏翻的键不会崩、不会告警,只会让用户在界面上看到 `queue.go_train`
 * 这种字符串。人工点不出来、类型系统也拦不住 —— 只能靠这层测试。
 *
 * 这里守四件事:
 *  1. zh.json 与 en.json 的键集合完全一致(双向,不是"en 是 zh 的子集");
 *  2. 代码里 t('literal') / translate('literal') 用到的键在两份包里都能解析;
 *  3. 值非空 —— 空串同样会渲染成空白 UI,和缺键一样是坏的;
 *  4. {var} 占位符两语言一致,避免某一语言插值静默丢参。
 *
 * 若并行的生产改动(语言包补全)尚未合入,本文件会先红 —— 这是设计意图,
 * 不要靠改断言或改语言包来"修绿"。
 */
import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import zh from '@/i18n/zh.json'
import en from '@/i18n/en.json'
import schemaFieldLabelsEn from '@/i18n/schemaFieldLabelsEn.json'
import schemaFieldDescsEn from '@/i18n/schemaFieldDescsEn.json'
import schemaFieldOptionsEn from '@/i18n/schemaFieldOptionsEn.json'
import { WIZARD_STEP_ORDER } from '@/pages/train/wizard/wizardModel'
import { TRAINING_TYPES } from '@/schema/trainingTypeRegistry.js'
import { createDefaultConfig, getSectionsForType } from '@/schema/schemaIndex.js'

const BUNDLES: Record<string, Record<string, string>> = { zh, en }
const LANGUAGES = Object.keys(BUNDLES)

const SRC_ROOT = path.resolve(__dirname, '..')

/** t('a.b') / tt('a.b') / translate('a.b');只收字面量键,模板/变量键交给运行时测试。 */
const LITERAL_KEY_CALL = /(?:^|[^A-Za-z0-9_$.])(?:t|tt|translate)\(\s*'([A-Za-z0-9_.]+)'/g

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      // 只扫生产源码:测试文件里的 t(...) 是断言辅助,不是待翻译的界面文本。
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      if (entry.name.endsWith('.d.ts')) continue
      out.push(full)
    }
  }
  walk(SRC_ROOT)
  return out
}

function usedLiteralKeys(): Map<string, string> {
  const hits = new Map<string, string>()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(LITERAL_KEY_CALL)) {
      const key = match[1]
      // 只有 a.b 形状的才是翻译键;裸标识符是普通函数调用的误命中。
      if (!key.includes('.')) continue
      if (!hits.has(key)) hits.set(key, path.relative(SRC_ROOT, file))
    }
  }
  return hits
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe('i18n bundle parity', () => {
  test('zh.json and en.json expose exactly the same key set', () => {
    const zhKeys = Object.keys(zh)
    const enKeys = Object.keys(en)
    const missingInEn = zhKeys.filter((key) => !(key in en)).sort()
    const missingInZh = enKeys.filter((key) => !(key in zh)).sort()

    expect(missingInEn, `keys present in zh.json but missing from en.json: ${missingInEn.join(', ')}`).toEqual([])
    expect(missingInZh, `keys present in en.json but missing from zh.json: ${missingInZh.join(', ')}`).toEqual([])
    // Set 相等 + 键数相等:后者顺带否掉 JSON 里的重复键(JSON.parse 会静默保留最后一个)。
    expect(new Set(enKeys)).toEqual(new Set(zhKeys))
    expect(enKeys.length).toBe(zhKeys.length)
  })

  test.each(LANGUAGES)('%s.json has no empty or non-string values', (language) => {
    const bundle = BUNDLES[language]
    const bad = Object.entries(bundle)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([key]) => key)
    // 空串和缺键一样会渲染成空白按钮/空白提示,门禁必须一起管。
    expect(bad, `empty/non-string values in ${language}.json: ${bad.join(', ')}`).toEqual([])
  })

  test('interpolation placeholders match across languages', () => {
    const mismatched = Object.keys(zh)
      .filter((key) => key in en)
      .map((key) => ({ key, zh: placeholders(BUNDLES.zh[key]), en: placeholders(BUNDLES.en[key]) }))
      .filter((row) => row.zh.join(',') !== row.en.join(','))
    // 占位符不一致 = 某一语言会静默丢掉插值参数(例如 en 少写 {name} 时提示里没有名字)。
    expect(
      mismatched,
      `placeholder mismatch: ${mismatched.map((r) => `${r.key} zh{${r.zh}} en{${r.en}}`).join('; ')}`,
    ).toEqual([])
  })
})

describe('i18n key usage', () => {
  test('every literal translation key used in production code resolves in all bundles', () => {
    const used = usedLiteralKeys()
    expect(used.size, 'no t()/translate() literal keys found — the scanner regex is probably broken').toBeGreaterThan(100)

    const unresolved: string[] = []
    for (const [key, file] of used) {
      for (const language of LANGUAGES) {
        const value = BUNDLES[language][key]
        if (typeof value !== 'string' || !value.trim()) unresolved.push(`${key} (${language}) @ ${file}`)
      }
    }
    // 未解析的键会被 formatMessage 原样渲染 —— 用户看到的就是 `queue.go_train`。
    expect(unresolved, `unresolved translation keys:\n  ${unresolved.join('\n  ')}`).toEqual([])
  })

  test('no bundle value looks like a bare translation key left as a placeholder', () => {
    // 形如 "queue.go_train" 的值 = 有人把键复制成了值,界面等价于没翻译。
    const suspicious: string[] = []
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(BUNDLES[language])) {
        if (/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value.trim())) {
          suspicious.push(`${language}:${key} = ${value}`)
        }
      }
    }
    expect(suspicious, `bundle values that look like bare keys: ${suspicious.join(', ')}`).toEqual([])
  })
})

// ── 孤儿键门禁 ──────────────────────────────────────────────────────────────
// 缺键会让用户看到裸键;孤儿键是反方向的腐烂:语言包里留着指向已删字段的条目,
// 看似"覆盖很全",实则永远渲染不出来,还会把后续翻译者引向不存在的字段。
// 与 tools/i18nGapScan.mjs 同一条判定链,这里钉住"不许新增"。

/** 全 schema 字段 key 集合(含隐藏类型;hidden section 由 getSectionsForType 过滤)。 */
function schemaFieldKeys(): Set<string> {
  const keys = new Set<string>()
  for (const type of TRAINING_TYPES) {
    let sections: ReturnType<typeof getSectionsForType> = []
    try {
      sections = getSectionsForType(type.id)
    } catch {
      continue
    }
    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field?.key) keys.add(field.key)
      }
    }
  }
  return keys
}

/** `fieldKey|value` option 键集合(options 函数按默认配置求值)。 */
function schemaOptionKeys(): Set<string> {
  const keys = new Set<string>()
  for (const type of TRAINING_TYPES) {
    let sections: ReturnType<typeof getSectionsForType> = []
    try {
      sections = getSectionsForType(type.id)
    } catch {
      continue
    }
    const defaults = (() => {
      try {
        return createDefaultConfig(type.id)
      } catch {
        return {}
      }
    })()
    for (const section of sections) {
      for (const field of section.fields || []) {
        if (!field?.key || (field.type !== 'select' && field.type !== 'multiSelect')) continue
        let raw: unknown = null
        try {
          raw = typeof field.options === 'function' ? (field.options as (c: Record<string, unknown>) => unknown)(defaults) : field.options
        } catch {
          continue
        }
        if (!raw) continue
        for (const option of Array.isArray(raw) ? raw : Array.from(raw as Iterable<unknown>)) {
          const value = option && typeof option === 'object' ? (option as { value?: unknown }).value : option
          keys.add(`${field.key}|${String(value ?? '').trim()}`)
        }
      }
    }
  }
  return keys
}

describe('i18n schema EN packs', () => {
  test('schemaFieldLabelsEn / schemaFieldDescsEn contain no orphan entries', () => {
    const fieldKeys = schemaFieldKeys()
    expect(fieldKeys.size).toBeGreaterThan(1000)
    for (const [packName, pack] of [
      ['schemaFieldLabelsEn.json', schemaFieldLabelsEn],
      ['schemaFieldDescsEn.json', schemaFieldDescsEn],
    ] as const) {
      const orphans = Object.keys(pack).filter((key) => !fieldKeys.has(key))
      expect(orphans, `${packName} orphan entries: ${orphans.join(', ')}`).toEqual([])
    }
  })

  test('schemaFieldOptionsEn contains no orphan entries', () => {
    const optionKeys = schemaOptionKeys()
    expect(optionKeys.size).toBeGreaterThan(500)
    const orphans = Object.keys(schemaFieldOptionsEn).filter((key) => !optionKeys.has(key))
    expect(orphans, `schemaFieldOptionsEn.json orphan entries: ${orphans.join(', ')}`).toEqual([])
  })
})

describe('i18n bundle dead keys', () => {
  /**
   * bundle 里不再被任何代码路径引用的键。引用判定:
   *  1. 源码里的点分字符串字面量(含 adapterModel 注册的 noticeKey/familyNote 等);
   *  2. 模板字面量前缀(仅收含 '.' 的 i18n 形状前缀,如 `generate.status_${status}`、
   *     `wizard.step.${id}`,排除 lx-input- 这类 DOM id);
   *  3. wizardModel 导出的步骤 id 展开出的 wizard.step(_desc).<id> 动态族与
   *     wizard.status.<status> / wizard.category.<c>(_desc) 动态族。
   * 门禁目标是防回潮(不许新增死键),不是证明每个键都被引用 —— 判定偏保守。
   */
  test('zh/en bundles expose no unreferenced keys', () => {
    const literals = new Set<string>()
    const stems = new Set<string>()
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)) {
        literals.add(match[1])
      }
      for (const match of text.matchAll(/`([a-zA-Z][a-zA-Z0-9._-]*)\$\{/g)) {
        // 只认带点的翻译键形状前缀,避免 DOM id 前缀把门禁放成筛子。
        if (match[1].includes('.')) stems.add(match[1])
      }
    }
    for (const stepId of WIZARD_STEP_ORDER) {
      literals.add(`wizard.step.${stepId}`)
      literals.add(`wizard.step_desc.${stepId}`)
    }
    for (const status of ['locked', 'active', 'complete', 'warning', 'error', 'stale', 'pending']) {
      literals.add(`wizard.status.${status}`)
    }

    const dead: string[] = []
    for (const language of LANGUAGES) {
      for (const key of Object.keys(BUNDLES[language])) {
        if (literals.has(key)) continue
        if (['wizard.category.', 'wizard.adapter_group.'].some((stem) => key.startsWith(stem))) continue
        if ([...stems].some((stem) => key.startsWith(stem))) continue
        dead.push(`${language}:${key}`)
      }
    }
    expect(dead, `unreferenced bundle keys:\n  ${dead.join('\n  ')}`).toEqual([])
  })
})
