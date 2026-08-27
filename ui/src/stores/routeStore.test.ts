// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 路由可达性（dev-only 路由的生产门）。
 *
 * #/gallery 是开发者用的组件样张页（硬编码中文、无后端契约）。只在导航条里
 * 过滤掉它拦不住直链：用户手敲 hash 仍会把它渲染出来。所以门下沉到 routeStore：
 * 生产构建下 parseHash 落回 train、navigate 也拒绝进入。
 *
 * import.meta.env.DEV 在测试里默认 true（vitest 以 dev 模式跑），用 vi.stubEnv
 * 模拟生产构建；isRouteAvailable 在调用时读取，所以 stub 立刻生效。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ROUTES, isRouteAvailable, useRouteStore } from '@/stores/routeStore'

function setHash(hash: string): void {
  window.location.hash = hash
}

beforeEach(() => {
  setHash('#/train')
  useRouteStore.setState({ route: 'train' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  setHash('')
})

describe('routeStore: dev-only route availability', () => {
  test('gallery is the only dev-gated route in the table', () => {
    expect(ROUTES.filter((r) => r.dev).map((r) => r.id)).toEqual(['gallery'])
  })

  test('under DEV every registered route is reachable', () => {
    for (const route of ROUTES) {
      expect(isRouteAvailable(route.id), route.id).toBe(true)
    }
  })

  test('under a production build gallery becomes unreachable while the rest stay', () => {
    vi.stubEnv('DEV', false)
    expect(isRouteAvailable('gallery')).toBe(false)
    for (const route of ROUTES.filter((r) => !r.dev)) {
      expect(isRouteAvailable(route.id), route.id).toBe(true)
    }
  })

  test('unknown route ids are never available', () => {
    // @ts-expect-error 故意传非法 id：hash 直链可以送进任何字符串。
    expect(isRouteAvailable('nope')).toBe(false)
  })
})

describe('routeStore: hash direct links', () => {
  test('DEV: #/gallery resolves to gallery', () => {
    setHash('#/gallery')
    useRouteStore.getState().syncFromHash()
    expect(useRouteStore.getState().route).toBe('gallery')
  })

  test('production: #/gallery direct link falls back to train', () => {
    vi.stubEnv('DEV', false)
    setHash('#/gallery')
    useRouteStore.getState().syncFromHash()
    expect(useRouteStore.getState().route).toBe('train')
  })

  test('production: non-dev routes still resolve from the hash', () => {
    vi.stubEnv('DEV', false)
    setHash('#/queue')
    useRouteStore.getState().syncFromHash()
    expect(useRouteStore.getState().route).toBe('queue')
  })

  test('an unknown hash falls back to train in both modes', () => {
    setHash('#/nope')
    useRouteStore.getState().syncFromHash()
    expect(useRouteStore.getState().route).toBe('train')
    vi.stubEnv('DEV', false)
    useRouteStore.getState().syncFromHash()
    expect(useRouteStore.getState().route).toBe('train')
  })
})

describe('routeStore: navigate', () => {
  test('DEV: navigate("gallery") enters the lab and writes the hash', () => {
    useRouteStore.getState().navigate('gallery')
    expect(useRouteStore.getState().route).toBe('gallery')
    expect(window.location.hash).toBe('#/gallery')
  })

  test('production: navigate("gallery") redirects to train, hash included', () => {
    vi.stubEnv('DEV', false)
    useRouteStore.getState().navigate('gallery')
    expect(useRouteStore.getState().route).toBe('train')
    expect(window.location.hash).toBe('#/train')
  })

  test('production: navigating away from gallery is not blocked for normal routes', () => {
    vi.stubEnv('DEV', false)
    useRouteStore.getState().navigate('monitor')
    expect(useRouteStore.getState().route).toBe('monitor')
    expect(window.location.hash).toBe('#/monitor')
  })
})
