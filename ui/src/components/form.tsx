// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/* 表单原子:字段容器/输入/下拉/开关/滑杆 */

export function FieldShell({
  label,
  en,
  right,
  required,
  children,
  className,
  id,
  as = 'label',
}: {
  label: ReactNode
  en?: string
  right?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
  id?: string
  as?: 'label' | 'div'
}) {
  const Tag = as
  return (
    <Tag id={id} className={['lx-field', required ? 'is-required' : '', className].filter(Boolean).join(' ')}>
      <span id={id ? `${id}-label` : undefined} className="lx-field-label">
        <span>
          {label}
          {required ? <span className="lx-field-required" aria-hidden="true"> *</span> : null}
          {en ? <span style={{ opacity: 0.65 }}> · {en}</span> : null}
        </span>
        {right}
      </span>
      {children}
    </Tag>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={['lx-input', className].filter(Boolean).join(' ')} spellCheck={false} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={['lx-textarea', className].filter(Boolean).join(' ')} spellCheck={false} {...rest} />
})

export function Select({
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean; title?: string }[] }) {
  return (
    <span className="lx-select-wrap">
      <select className={['lx-select', className].filter(Boolean).join(' ')} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  ariaRequired,
  ariaInvalid,
  ariaErrorMessage,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  ariaRequired?: boolean
  ariaInvalid?: boolean
  ariaErrorMessage?: string
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      className={['lx-switch', checked ? 'on' : ''].filter(Boolean).join(' ')}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-required={ariaRequired ? 'true' : undefined}
      aria-invalid={ariaInvalid ? 'true' : undefined}
      aria-errormessage={ariaErrorMessage}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  disabled,
  id,
  ariaLabelledby,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  id?: string
  ariaLabelledby?: string
}) {
  const generatedId = useId()
  return (
    <input
      id={id || generatedId}
      type="range"
      className="lx-range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-labelledby={ariaLabelledby}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}
