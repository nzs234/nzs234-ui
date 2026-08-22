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
