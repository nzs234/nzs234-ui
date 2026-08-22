// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { gsap } from 'gsap'
import type { ThemeId } from '@/stores/themeStore'

/** 把 .lx-page-title 的每个 .line 按字符拆成 .ch(幂等),供逐字动效 */
export function splitTitleChars(scope: HTMLElement) {
  scope.querySelectorAll<HTMLElement>('.lx-page-title .line').forEach((line) => {
    if (line.dataset.split) return
    line.dataset.split = '1'
    const txt = line.textContent ?? ''
    line.textContent = ''
    for (const c of txt) {
      const s = document.createElement('span')
      s.className = 'ch'
      s.textContent = c === ' ' ? ' ' : c
      line.appendChild(s)
    }
  })
}

/** 字符乱序解码效果 */
export function scramble(node: HTMLElement | null, _dur = 0.5) {
  if (!node) return
}

/** acid 主题 glitch: 保持空操作以符合统一 research studio 风格 */
export function glitchBurst() {
  // no-op for modern clean research studio
}

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

