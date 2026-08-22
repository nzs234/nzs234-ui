// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

export type UiLanguage = 'zh' | 'en'

const LS_KEY = 'lx-ui-language'
const LAUNCHER_KEY = 'lx-language'

function readInitial(): UiLanguage {
  try {
    const own = localStorage.getItem(LS_KEY)
    if (own === 'zh' || own === 'en') return own
    const launcher = localStorage.getItem(LAUNCHER_KEY)
    if (launcher === 'zh' || launcher === 'en') return launcher
  } catch {
    /* ignore */
  }
  return 'zh'
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
