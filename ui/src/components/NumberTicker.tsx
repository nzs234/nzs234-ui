// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { isEcoMotion } from '@/stores/themeStore'

/** 数字滚动:value 变化时 GSAP 补间 textContent;eco/reduced 直接落值 */
export function NumberTicker({
  value,
  decimals = 0,
  className,
}: {
  value: number
  decimals?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const shown = useRef(value)
  // 首帧文本:effect 之后由 GSAP 直接写 textContent,所以这里只需要一个不再变化的
  // 初值。用 state 而不是渲染期读 ref.current —— 后者在渲染阶段读 ref 是不纯的。
  const [initialText] = useState(() => (Number.isFinite(value) ? value.toFixed(decimals) : '--'))

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (isEcoMotion() || reduced || !Number.isFinite(value)) {
      shown.current = value
      el.textContent = Number.isFinite(value) ? value.toFixed(decimals) : '--'
      return
    }
    const o = { v: shown.current }
    const tween = gsap.to(o, {
      v: value,
      duration: 0.6,
      ease: 'power1.out',
      onUpdate: () => {
        el.textContent = o.v.toFixed(decimals)
      },
    })
    shown.current = value
    return () => {
      tween.kill()
    }
  }, [value, decimals])

  return (
    <span ref={ref} className={className}>
      {initialText}
    </span>
  )
}
