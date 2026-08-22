// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/* 基础原子:按钮/徽标/状态点/进度条/KPI/空态/跑马灯 */

export function Button({
  variant = 'ghost',
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' }) {
  const cls = ['lx-btn', variant, size, className].filter(Boolean).join(' ')
  return <button type="button" className={cls} {...rest} />
}

export function Badge({
  tone,
  children,
  className,
}: {
  tone?: 'accent' | 'ok' | 'warn' | 'danger'
  children: ReactNode
  className?: string
}) {
  return <span className={['lx-badge', tone, className].filter(Boolean).join(' ')}>{children}</span>
}

export function Dot({ tone = 'idle', pulse }: { tone?: 'ok' | 'accent' | 'warn' | 'danger' | 'idle'; pulse?: boolean }) {
  return <span className={['lx-dot', tone === 'idle' ? '' : tone, pulse ? 'pulse lx-loop' : ''].filter(Boolean).join(' ')} />
}

export function Bar({
  value,
  lg,
  thin,
  shimmer,
  className,
}: {
  value: number
  lg?: boolean
  thin?: boolean
  shimmer?: boolean
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={['lx-bar', lg ? 'lg' : '', thin ? 'thin' : '', shimmer ? 'shimmer' : '', className].filter(Boolean).join(' ')}>
      <span className={shimmer ? 'lx-loop' : undefined} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Kpi({ label, value, accent, title }: { label: string; value: ReactNode; accent?: boolean; title?: string }) {
  return (
    <div className={['lx-kpi', accent ? 'accent' : ''].filter(Boolean).join(' ')} title={title}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

export function Empty({
  title,
  desc,
  icon,
  action,
  headingLevel = 3,
  children,
}: {
  title: string
  desc?: string
  icon?: ReactNode
  action?: ReactNode
  headingLevel?: 2 | 3 | 4
  children?: ReactNode
}) {
  const HeadingTag = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <div className="lx-empty">
      {icon ? <div className="lx-empty-icon">{icon}</div> : null}
      <HeadingTag style={{ font: '600 16px var(--lx-font-sans)', color: 'var(--lx-text)', margin: '0 0 6px' }}>
        {title}
      </HeadingTag>
      {desc ? <p>{desc}</p> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
      {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}
    </div>
  )
}
