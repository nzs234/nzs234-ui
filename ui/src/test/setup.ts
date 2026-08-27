// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
  })
}

if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

/**
 * 语言基线钉成 zh-CN。
 *
 * localeStore 在无持久化偏好时嗅探 navigator.language,而 jsdom 默认报 en-US ——
 * 不钉的话"默认语言是 zh"这件事就变成隐式依赖运行环境的 locale(本机 / CI 换个
 * 镜像就整片变红,且看不出根因)。需要 en 的用例走 setLanguage('en') 显式切换,
 * 嗅探本身由 src/stores/localeStore.test.ts 直接对 readInitial() 断言。
 */
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  Object.defineProperty(navigator, 'languages', { value: ['zh-CN', 'zh'], configurable: true })
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})
