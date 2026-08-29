// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

/**
 * 界面版本(V1/V2)开关。
 *
 * V2 不是独立页面树,而是一层以 html[data-uiv='v2'] 为作用域的完整皮肤
 * (见 theme/v2/v2.css):所有页面组件、store、业务逻辑原样复用,只换
 * 配色/排版/布局外壳。这样切换零成本,也不会分叉出两份需要同步维护的功能代码。
 */
export type UiVersion = 'v1' | 'v2'

const VERSION_KEY = 'lx-uiversion'
const VERSIONS: UiVersion[] = ['v1', 'v2']

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

interface UiVersionState {
  version: UiVersion
  setVersion(version: UiVersion): void
}

function applyToDom(version: UiVersion) {
  document.documentElement.dataset.uiv = version
}

export const useUiVersionStore = create<UiVersionState>((set) => ({
  version: (VERSIONS as string[]).includes(readLS(VERSION_KEY, 'v1'))
    ? (readLS(VERSION_KEY, 'v1') as UiVersion)
    : 'v1',
  setVersion(version) {
    writeLS(VERSION_KEY, version)
    set({ version })
    applyToDom(version)
  },
}))

/** React 挂载前同步应用,避免 V2 用户首帧闪回 V1 */
export function initUiVersion() {
  applyToDom(useUiVersionStore.getState().version)
}
