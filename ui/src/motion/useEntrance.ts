// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { buildPageEnter } from './presets'
import { isEcoMotion, useThemeStore } from '@/stores/themeStore'

gsap.registerPlugin(useGSAP)

/**
 * 页面入场动效 hook:返回 ref 绑到页面根节点。
 * 主题切换时自动 revert 旧动效并按新主题重放。
 *
 * 跳过入场的两种情形:
 *  1. prefers-reduced-motion —— 系统级诉求,任何档位都尊重;
 *  2. 显式 ECO 档 —— 用户主动选了省电/静态,入场也算"动效"。
 *
 * AUTO 档有意保持现状:它只在训练运行中把 data-motion 降到 eco(themeStore
 * applyToDom),那是为了停常驻循环而不是禁掉一次性入场 —— 训练期间切页面仍应有
 * 正常的入场反馈。所以这里不能直接用 isEcoMotion(),它把 AUTO 的自动降档和用户
 * 显式选择混在同一个信号里;只有 motionMode 非 auto 时才认 data-motion。
 */
export function usePageEntrance(extraDeps: unknown[] = []) {
  const ref = useRef<HTMLDivElement | null>(null)
  const theme = useThemeStore((s) => s.theme)
  const motionMode = useThemeStore((s) => s.motionMode)
  useGSAP(
    () => {
      if (!ref.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      // motionMode 是权威来源;data-motion 兜住"store 之外被写过"的情形(initTheme
      // 在 React 挂载前就应用过一次)。auto 档不参与这条判断,见上方说明。
      if (motionMode === 'eco' || (motionMode !== 'auto' && isEcoMotion())) return
      buildPageEnter(theme, ref.current)
    },
    { scope: ref, dependencies: [theme, motionMode, ...extraDeps], revertOnUpdate: true },
  )
  return ref
}
