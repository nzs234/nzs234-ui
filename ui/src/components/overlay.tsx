// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, type ReactNode } from 'react'
import { useToastStore } from '@/stores/toastStore'
import { X } from 'lucide-react'

/* 覆盖层: 模态 (包含 Focus Trap, Escape, 焦点恢复) / Toast 宿主 */

export function Modal({
  open,
  title,
  onClose,
  children,
  width,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  const modalRef = useRef<HTMLDivElement>(null)
  const prevActiveRef = useRef<HTMLElement | null>(null)
  const titleIdRef = useRef(`lx-modal-title-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    if (!open) return
    prevActiveRef.current = document.activeElement as HTMLElement

    // Focus first focusable element inside modal
    const timer = window.setTimeout(() => {
      if (modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length > 0) {
          focusables[0].focus()
        } else {
          modalRef.current.focus()
        }
      }
    }, 50)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      if (prevActiveRef.current && typeof prevActiveRef.current.focus === 'function') {
        prevActiveRef.current.focus()
      }
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="lx-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        className="lx-modal"
        style={width ? { maxWidth: width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className="lx-modal-head">
          <span id={titleIdRef.current} className="lx-modal-title">{title}</span>
          <button type="button" className="lx-btn sm ghost" onClick={onClose} aria-label="Close dialog">
            <X size={15} />
          </button>
        </div>
        <div className="lx-modal-body">{children}</div>
      </div>
    </div>
  )
}

const KIND_TITLE: Record<string, string> = { info: 'INFO', ok: 'OK', warn: 'WARN', err: 'ERROR' }

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="lx-toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`lx-toast ${t.kind}`}
          role="status"
          tabIndex={0}
          aria-label={`${t.title ?? KIND_TITLE[t.kind]}: ${t.message}`}
        >
          <div className="lx-toast-head">
            <b>{t.title ?? KIND_TITLE[t.kind]}</b>
            <button
              type="button"
              className="lx-toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
          <div className="lx-toast-msg">{t.message}</div>
        </div>
      ))}
    </div>
  )
}

