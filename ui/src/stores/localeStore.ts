// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

export type UiLanguage = 'zh' | 'en'

const LS_KEY = 'lx-ui-language'
const LAUNCHER_KEY = 'lx-language'

/**
 * 无持久化偏好时嗅探浏览器语言。
 *
 * 只认 `en*`（en / en-US / EN-GB…）→ en；其余语言一律 zh，与既有默认一致 ——
 * 这里不做"任何非中文都给 en"的推断,语言包只有 zh/en 两份,把 ja/ko 用户丢到
 * en 反而比给中文更陌生。navigator 可能不存在(SSR/测试桩)或抛错,所以整段包在
 * try 里,失败即回落 zh。
 */
function sniffFromNavigator(): UiLanguage {
  try {
    const tags = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ]
    for (const tag of tags) {
      if (typeof tag !== 'string' || !tag.trim()) continue
      // 只看第一个有意义的标签:用户把 en 排在 zh 之前时才算偏好英文。
      return /^en\b|^en-/i.test(tag.trim()) ? 'en' : 'zh'
    }
  } catch {
    /* ignore */
  }
  return 'zh'
}

/**
 * 初始语言:持久化偏好 > launcher 偏好 > 浏览器语言嗅探。
 *
 * 导出仅为可测:store 在模块加载时就取好初值,测试无法重放"首次进入"的那一刻。
 */
export function readInitial(): UiLanguage {
  try {
    const own = localStorage.getItem(LS_KEY)
    if (own === 'zh' || own === 'en') return own
    const launcher = localStorage.getItem(LAUNCHER_KEY)
    if (launcher === 'zh' || launcher === 'en') return launcher
  } catch {
    /* ignore */
  }
  // 本地无偏好:按浏览器语言嗅探(持久化逻辑不变 —— 嗅探结果不写回 storage,
  // 用户显式切换才落盘,否则日后改嗅探规则会被一份"其实没人选过"的偏好锁死)。
  return sniffFromNavigator()
}

interface LocaleState {
  language: UiLanguage
  setLanguage(lang: UiLanguage): void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: readInitial(),
  setLanguage(lang) {
    try {
      localStorage.setItem(LS_KEY, lang)
    } catch {
      /* ignore */
    }
    try {
      document.documentElement.lang = lang
    } catch {
      /* ignore */
    }
    set({ language: lang })
  },
}))

// apply once on module load
try {
  document.documentElement.lang = useLocaleStore.getState().language
} catch {
  /* ignore */
}
