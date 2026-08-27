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

/**
 * dev-only 路由（#/gallery 设计实验室）在生产构建下不可达。
 *
 * 只靠导航隐藏（Topbar 的 `!r.dev` 过滤）拦不住直链 —— 用户手敲 `#/gallery`
 * 仍会渲染出一个开发者用的组件样张页。所以判定下沉到路由层：生产构建里
 * gallery 既不是合法 hash（parseHash 落回首页），navigate() 也拒绝进入。
 */
export function isRouteAvailable(route: RouteId): boolean {
  const meta = ROUTES.find((r) => r.id === route)
  if (!meta) return false
  return !meta.dev || import.meta.env.DEV
}

function parseHash(): RouteId {
  const h = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  const candidate = (VALID.has(h as RouteId) ? h : 'train') as RouteId
  return isRouteAvailable(candidate) ? candidate : 'train'
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
    // 不可达的 dev 路由重定向首页，而不是留在一个渲染不出内容的路由上。
    const target = isRouteAvailable(route) ? route : 'train'
    if (window.location.hash !== `#/${target}`) window.location.hash = `/${target}`
    set({ route: target })
  },
  syncFromHash() {
    set({ route: parseHash() })
  },
}))

