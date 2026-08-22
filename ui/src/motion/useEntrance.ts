// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { buildPageEnter } from './presets'
import { useThemeStore } from '@/stores/themeStore'

gsap.registerPlugin(useGSAP)

/**
 * 页面入场动效 hook:返回 ref 绑到页面根节点。
 * 主题切换时自动 revert 旧动效并按新主题重放;prefers-reduced-motion 时跳过。
 * (eco 档只停常驻循环,一次性入场保留)
 */
export function usePageEntrance(extraDeps: unknown[] = []) {
  const ref = useRef<HTMLDivElement | null>(null)
  const theme = useThemeStore((s) => s.theme)
  useGSAP(
    () => {
      if (!ref.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      buildPageEnter(theme, ref.current)
    },
    { scope: ref, dependencies: [theme, ...extraDeps], revertOnUpdate: true },
  )
  return ref
}
