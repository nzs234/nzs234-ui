// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

export type ThemeId = 'editorial' | 'acid' | 'glass'
export type MotionMode = 'auto' | 'full' | 'eco'

export const THEME_META: Record<ThemeId, { label: string; zh: string }> = {
  editorial: { label: 'Warm Gray', zh: '暖灰' },
  acid: { label: 'Obsidian', zh: '黑曜' },
  glass: { label: 'Slate', zh: '石板' },
}

const THEME_KEY = 'lx-theme'
const MOTION_KEY = 'lx-motion'
const THEMES: ThemeId[] = ['editorial', 'acid', 'glass']
const MODES: MotionMode[] = ['auto', 'full', 'eco']

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

interface ThemeState {
  theme: ThemeId
  motionMode: MotionMode
  /** 由 taskStore 根据是否有 RUNNING 任务驱动;auto 档据此降档 */
  trainingActive: boolean
  setTheme(theme: ThemeId): void
  setMotionMode(mode: MotionMode): void
  setTrainingActive(active: boolean): void
}

function applyToDom(theme: ThemeId, mode: MotionMode, trainingActive: boolean) {
  const el = document.documentElement
  el.dataset.theme = theme
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const eco = reduced || mode === 'eco' || (mode === 'auto' && trainingActive)
  el.dataset.motion = eco ? 'eco' : 'full'
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (THEMES as string[]).includes(readLS(THEME_KEY, 'editorial'))
    ? (readLS(THEME_KEY, 'editorial') as ThemeId)
    : 'editorial',
  motionMode: (MODES as string[]).includes(readLS(MOTION_KEY, 'auto'))
    ? (readLS(MOTION_KEY, 'auto') as MotionMode)
    : 'auto',
  trainingActive: false,
  setTheme(theme) {
    writeLS(THEME_KEY, theme)
    set({ theme })
    applyToDom(theme, get().motionMode, get().trainingActive)
  },
  setMotionMode(motionMode) {
    writeLS(MOTION_KEY, motionMode)
    set({ motionMode })
    applyToDom(get().theme, motionMode, get().trainingActive)
  },
  setTrainingActive(trainingActive) {
    if (trainingActive === get().trainingActive) return
    set({ trainingActive })
    applyToDom(get().theme, get().motionMode, trainingActive)
  },
}))

/** React 挂载前同步应用,避免主题闪烁 */
export function initTheme() {
  const s = useThemeStore.getState()
  applyToDom(s.theme, s.motionMode, s.trainingActive)
}

/** 当前是否处于 eco 降档(供 JS 驱动的循环动效判断) */
export function isEcoMotion(): boolean {
  return document.documentElement.dataset.motion === 'eco'
}

