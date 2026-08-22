// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'

export type ToastKind = 'info' | 'ok' | 'warn' | 'err'

export interface Toast {
  id: number
  kind: ToastKind
  title?: string
  message: string
}

let nextId = 1

interface ToastState {
  toasts: Toast[]
  push(kind: ToastKind, message: string, title?: string): void
  dismiss(id: number): void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, message, title) {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, title, message }] })
    window.setTimeout(() => get().dismiss(id), kind === 'err' ? 7000 : 4200)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export const toast = {
  info: (m: string, t?: string) => useToastStore.getState().push('info', m, t),
  ok: (m: string, t?: string) => useToastStore.getState().push('ok', m, t),
  warn: (m: string, t?: string) => useToastStore.getState().push('warn', m, t),
  err: (m: string, t?: string) => useToastStore.getState().push('err', m, t),
}
