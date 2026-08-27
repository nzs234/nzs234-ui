// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 初始语言解析（readInitial）。
 *
 * store 在模块加载时就取好初值，测试无法重放"首次进入"那一刻 —— 所以断言直接
 * 打在 readInitial() 上（它是 store 初值的唯一来源）。
 *
 * 守两件事：
 *  1. 持久化偏好优先级不变（own > launcher > 嗅探）—— 嗅探不许劫持用户的显式选择；
 *  2. 无偏好时按 navigator 嗅探：en* → en，其余（含 ja/ko/de 等无语言包的）→ zh。
 *
 * navigator.language 在 src/test/setup.ts 里被钉成 zh-CN，这里逐用例覆写后复原。
 */
import { afterEach, describe, expect, test } from 'vitest'
import { readInitial } from '@/stores/localeStore'

const LS_KEY = 'lx-ui-language'
const LAUNCHER_KEY = 'lx-language'

const originalLanguage = navigator.language
const originalLanguages = navigator.languages

function stubNavigator(language: unknown, languages?: unknown): void {
  Object.defineProperty(navigator, 'language', { value: language, configurable: true })
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true })
}

afterEach(() => {
  stubNavigator(originalLanguage, originalLanguages)
  localStorage.clear()
})

describe('localeStore readInitial: persisted preference wins', () => {
  test('own key beats both the launcher key and the browser locale', () => {
    localStorage.setItem(LS_KEY, 'zh')
    localStorage.setItem(LAUNCHER_KEY, 'en')
    stubNavigator('en-US', ['en-US'])
    expect(readInitial()).toBe('zh')
  })

  test('launcher key is used when the UI has no own preference', () => {
    localStorage.setItem(LAUNCHER_KEY, 'en')
    stubNavigator('zh-CN', ['zh-CN'])
    expect(readInitial()).toBe('en')
  })

  test('garbage in storage falls through to the sniffer instead of being trusted', () => {
    localStorage.setItem(LS_KEY, 'fr')
    stubNavigator('en-GB', ['en-GB'])
    expect(readInitial()).toBe('en')
  })
})

describe('localeStore readInitial: navigator sniffing', () => {
  test.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['EN-gb', 'en'],
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['zh-TW', 'zh'],
    // 无语言包的语言一律回落 zh，与既有默认一致（不推断成 en）。
    ['ja-JP', 'zh'],
    ['ko-KR', 'zh'],
    ['de-DE', 'zh'],
  ])('navigator.language %s resolves to %s', (tag, expected) => {
    stubNavigator(tag, [tag])
    expect(readInitial()).toBe(expected)
  })

  test('navigator.languages ordering decides: en first -> en, zh first -> zh', () => {
    stubNavigator('en-US', ['en-US', 'zh-CN'])
    expect(readInitial()).toBe('en')
    stubNavigator('en-US', ['zh-CN', 'en-US'])
    expect(readInitial()).toBe('zh')
  })

  test('blank / missing / non-string navigator values fall back to zh', () => {
    stubNavigator(undefined, undefined)
    expect(readInitial()).toBe('zh')
    stubNavigator('   ', ['  '])
    expect(readInitial()).toBe('zh')
    stubNavigator(42, [42])
    expect(readInitial()).toBe('zh')
  })

  test('a language tag merely containing "en" is not treated as English', () => {
    // 'zh-Hans' / 'da-DK' 之类不能因为字符串里有 en 就判成英文。
    stubNavigator('den-XX', ['den-XX'])
    expect(readInitial()).toBe('zh')
  })
})
