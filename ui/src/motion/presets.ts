// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { gsap } from 'gsap'
import type { ThemeId } from '@/stores/themeStore'

/** 页面入场时间线: 精致淡入微位移动效 */
export function buildPageEnter(_theme: ThemeId, scope: HTMLElement): gsap.core.Timeline {
  const q = (sel: string) => scope.querySelector<HTMLElement>(sel)
  const eyebrow = q('.lx-page-eyebrow')
  const title = q('.lx-page-title')
  const sub = q('.lx-page-sub')
  const panels = Array.from(scope.querySelectorAll<HTMLElement>('.lx-panel, .lx-w-shell')).slice(0, 8)
  const tl = gsap.timeline()

  if (eyebrow) tl.from(eyebrow, { autoAlpha: 0, y: 6, duration: 0.22, ease: 'power2.out' })
  if (title) tl.from(title, { autoAlpha: 0, y: 8, duration: 0.28, ease: 'power2.out' }, '-=.1')
  if (sub) tl.from(sub, { autoAlpha: 0, y: 6, duration: 0.24, ease: 'power2.out' }, '-=.15')
  if (panels.length) {
    tl.from(panels, { autoAlpha: 0, y: 12, duration: 0.32, stagger: 0.04, ease: 'power2.out' }, '-=.15')
  }

  return tl
}

