// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import type { ReactNode } from 'react'

/* Wizard 结构化外壳原语:薄、可换肤,只输出 lx-w-* 类名(样式见 wizard.css)。
   i18n 标签由调用方通过 t() 传入,保持组件语言无关。 */

export type StepCardStatus = 'locked' | 'active' | 'complete' | 'warning' | 'error' | 'stale' | 'pending'

export function WizardShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['lx-w-shell', className].filter(Boolean).join(' ')}>{children}</div>
}

export function WizardRail({ children, className }: { children: ReactNode; className?: string }) {
  return <aside className={['lx-w-rail', className].filter(Boolean).join(' ')}>{children}</aside>
}

export function WizardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={['lx-w-header', className].filter(Boolean).join(' ')}>{children}</header>
}

export function WizardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={['lx-w-content', className].filter(Boolean).join(' ')}>{children}</main>
}

export function WizardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <footer className={['lx-w-footer', className].filter(Boolean).join(' ')}>{children}</footer>
}

export function StepCard({
  index,
  label,
  status = 'pending',
  disabled,
  onSelect,
  children,
  className,
}: {
  index: string | number
  label: ReactNode
  status?: StepCardStatus
  disabled?: boolean
  onSelect?: () => void
  children?: ReactNode
  className?: string
}) {
  return (
    <li className={['lx-w-stepcard', `is-${status}`, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-current={status === 'active' ? 'step' : undefined}
      >
        <span className="lx-w-stepcard-index">{index}</span>
        <span className="lx-w-stepcard-copy">
          <strong>{label}</strong>
          {children}
        </span>
      </button>
    </li>
  )
}

export function ChoiceCard({
  selected,
  disabled,
  title,
  subtitle,
  meta,
  onSelect,
  className,
}: {
  selected?: boolean
  disabled?: boolean
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  onSelect?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={['lx-w-choice', selected ? 'is-selected' : '', className].filter(Boolean).join(' ')}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
      {meta ? <small>{meta}</small> : null}
    </button>
  )
}

export function FieldGroup({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={['lx-w-fieldgroup', className].filter(Boolean).join(' ')}>
      {title ? <h3>{title}</h3> : null}
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  )
}

export function ReviewSection({
  title,
  onEdit,
  children,
  className,
}: {
  title: ReactNode
  onEdit?: () => void
  children?: ReactNode
  className?: string
}) {
  return (
    <article className={['lx-w-review-section', className].filter(Boolean).join(' ')}>
      <div className="lx-w-review-section-head">
        <h3>{title}</h3>
        {onEdit ? (
          <button type="button" onClick={onEdit}>
            修改
          </button>
        ) : null}
      </div>
      {children}
    </article>
  )
}

export function PreflightPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={['lx-w-preflight', className].filter(Boolean).join(' ')}>{children}</section>
}

/** i18n 键:步骤 id → wizard.step.<id> */
export function wizardStepLabelKey(id: string): string {
  return `wizard.step.${id}`
}
