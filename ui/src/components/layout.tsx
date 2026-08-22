// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { type KeyboardEvent, type ReactNode } from 'react'

/* 布局件: 面板 / 页签 (无障碍键盘 roving tabIndex) / 页面标题 */

export function Panel({
  title,
  idx,
  panelId,
  right,
  hoverable,
  className,
  children,
}: {
  title?: ReactNode
  idx?: string
  panelId?: string
  right?: ReactNode
  hoverable?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={['lx-panel', hoverable ? 'hoverable' : '', className].filter(Boolean).join(' ')}>
      {title != null && (
        <header className="lx-panel-head">
          <h2 className="lx-panel-title">
            {idx ? <i className="lx-idx">{idx} /</i> : null}
            {title}
          </h2>
          {right ?? (panelId ? <span className="lx-panel-id">{panelId}</span> : null)}
        </header>
      )}
      {children}
    </section>
  )
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix = 'lx-tab',
}: {
  tabs: { id: T; label: string; idx?: string }[]
  active: T
  onChange: (id: T) => void
  idPrefix?: string
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return
    const currentIndex = tabs.findIndex((t) => t.id === active)
    if (currentIndex === -1) return

    let nextIndex = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = tabs.length - 1
    }

    if (nextIndex !== -1) {
      const nextTab = tabs[nextIndex]
      if (nextTab) {
        onChange(nextTab.id)
        const btn = document.getElementById(`${idPrefix}-${nextTab.id}`)
        if (btn) btn.focus()
      }
    }
  }

  return (
    <div className="lx-tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === active
        return (
          <button
            key={t.id}
            id={`${idPrefix}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            className={['lx-tab', selected ? 'on' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(t.id)}
          >
            {t.idx ? <span className="lx-idx">{t.idx}</span> : null}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function PageHead({
  idx,
  tag,
  lines,
  sub,
}: {
  idx: string
  tag?: string
  lines: { text: string; outline?: boolean }[]
  sub?: ReactNode
  marquee?: string
}) {
  return (
    <div className="lx-page-head">
      <div className="lx-page-eyebrow">
        <span className="lx-idx lx-num">( {idx} )</span>
        {tag ? <span>{tag}</span> : null}
      </div>
      <h1 className="lx-page-title">
        {lines.map((l, i) => (
          <span key={i} className={['line', l.outline ? 'outline' : ''].filter(Boolean).join(' ')}>
            {l.text}
          </span>
        ))}
      </h1>
      {sub ? <p className="lx-page-sub">{sub}</p> : null}
    </div>
  )
}
