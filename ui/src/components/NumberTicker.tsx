// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef } from 'react'
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
  const initial = useRef(value.toFixed(decimals))

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
      {initial.current}
    </span>
  )
}
