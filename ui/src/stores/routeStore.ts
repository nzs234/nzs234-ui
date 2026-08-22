// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

export type RouteId = 'train' | 'generate' | 'monitor' | 'queue' | 'resources' | 'gallery'

export const ROUTES: { id: RouteId; zh: string; en: string; idx: string; dev?: boolean }[] = [
  { id: 'train', zh: '训练', en: 'Train', idx: '01' },
  { id: 'generate', zh: '出图', en: 'Generate', idx: '02' },
  { id: 'monitor', zh: '监控', en: 'Monitor', idx: '03' },
  { id: 'queue', zh: '队列', en: 'Queue', idx: '04' },
  { id: 'resources', zh: '资源', en: 'Resources', idx: '05' },
  { id: 'gallery', zh: '设计实验室', en: 'Design Lab', idx: 'LAB', dev: true },
]

const VALID = new Set(ROUTES.map((r) => r.id))

function parseHash(): RouteId {
  const h = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (VALID.has(h as RouteId) ? h : 'train') as RouteId
}

interface RouteState {
  route: RouteId
  navigate(route: RouteId): void
  /** hashchange 同步,AppShell 挂载时调用一次 */
  syncFromHash(): void
}

export const useRouteStore = create<RouteState>((set) => ({
  route: parseHash(),
  navigate(route) {
    if (window.location.hash !== `#/${route}`) window.location.hash = `/${route}`
    set({ route })
  },
  syncFromHash() {
    set({ route: parseHash() })
  },
}))

