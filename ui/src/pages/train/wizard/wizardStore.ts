// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'
import { WIZARD_STEP_ORDER, type WizardStepId } from './wizardModel'
import type { PreflightSnapshot } from './preflight'

const STORAGE_KEY = 'lx-train-wizard-v1'

interface PersistedWizardState {
  mode?: 'wizard' | 'expert'
  activeStepByType?: Record<string, WizardStepId>
  completedStepsByType?: Record<string, WizardStepId[]>
  explicitFieldsByType?: Record<string, string[]>
  staleStepsByType?: Record<string, WizardStepId[]>
  categoryByType?: Record<string, string>
  preflightByType?: Record<string, PreflightSnapshot | undefined>
}

function readPersisted(): PersistedWizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as PersistedWizardState : {}
  } catch {
    return {}
  }
}

function persist(state: WizardState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      activeStepByType: state.activeStepByType,
      completedStepsByType: state.completedStepsByType,
      explicitFieldsByType: state.explicitFieldsByType,
      staleStepsByType: state.staleStepsByType,
      categoryByType: state.categoryByType,
      preflightByType: state.preflightByType,
    }))
  } catch {
    /* localStorage 不可用时仍保持内存向导状态 */
  }
}

export interface WizardState {
  mode: 'wizard' | 'expert'
  activeStepByType: Record<string, WizardStepId>
  completedStepsByType: Record<string, WizardStepId[]>
  explicitFieldsByType: Record<string, string[]>
  staleStepsByType: Record<string, WizardStepId[]>
  categoryByType: Record<string, string>
  preflightByType: Record<string, PreflightSnapshot | undefined>
  setMode(mode: 'wizard' | 'expert'): void
  setCategory(typeId: string, category: string): void
  setActiveStep(typeId: string, step: WizardStepId): void
  markComplete(typeId: string, step: WizardStepId): void
  markStaleFrom(typeId: string, step: WizardStepId): void
  markAllStale(typeId: string): void
  markExplicit(typeId: string, keys: Iterable<string>): void
  setPreflight(typeId: string, snapshot: PreflightSnapshot): void
  setPreflightWarningConfirmed(typeId: string, confirmed: boolean): void
  clearPreflight(typeId: string): void
  resetType(typeId: string): void
  hydrateType(typeId: string, validSteps: WizardStepId[]): void
  /**
   * 恢复/导入/回填后的一次性重置:清空该 type 的 completed/stale/explicit/preflight,
   * 再把被灌入的字段标成 explicit 并把所有步标成 stale。
   *
   * 存在的理由是原子性:调用方分四步调 resetType → markExplicit → markAllStale →
   * clearPreflight 会写四次 localStorage 并产生四个中间态,其中一步失败就留下
   * "已完成但内容已换"的半吊子向导状态 —— 用户会看到可以直接点启动的 review 步。
   */
  applyRestoredType(typeId: string, explicitKeys: Iterable<string>): void
}

const persisted = readPersisted()

export const useWizardStore = create<WizardState>((set, get) => ({
  mode: persisted.mode || 'wizard',
  activeStepByType: persisted.activeStepByType || {},
  completedStepsByType: persisted.completedStepsByType || {},
  explicitFieldsByType: persisted.explicitFieldsByType || {},
  staleStepsByType: persisted.staleStepsByType || {},
  categoryByType: persisted.categoryByType || {},
  preflightByType: persisted.preflightByType || {},
  setMode(mode) {
    set({ mode })
    persist({ ...get(), mode })
  },
  setCategory(typeId, category) {
    const categoryByType = { ...get().categoryByType, [typeId]: category }
    set({ categoryByType })
    persist({ ...get(), categoryByType })
  },
  setActiveStep(typeId, step) {
    const activeStepByType = { ...get().activeStepByType, [typeId]: step }
    set({ activeStepByType })
    persist({ ...get(), activeStepByType })
  },
  markComplete(typeId, step) {
    const completed = new Set(get().completedStepsByType[typeId] || [])
    completed.add(step)
    const completedStepsByType = { ...get().completedStepsByType, [typeId]: [...completed] }
    const stale = new Set(get().staleStepsByType[typeId] || [])
    stale.delete(step)
    const staleStepsByType = { ...get().staleStepsByType, [typeId]: [...stale] }
    set({ completedStepsByType, staleStepsByType })
    persist({ ...get(), completedStepsByType, staleStepsByType })
  },
  markStaleFrom(typeId, step) {
    const order = WIZARD_STEP_ORDER
    const index = order.indexOf(step)
    const stale = new Set(get().staleStepsByType[typeId] || [])
    const completed = new Set(get().completedStepsByType[typeId] || [])
    order.slice(index + 1).forEach((id) => {
      stale.add(id)
      completed.delete(id)
    })
    const staleStepsByType = { ...get().staleStepsByType, [typeId]: [...stale] }
    const completedStepsByType = { ...get().completedStepsByType, [typeId]: [...completed] }
    set({ staleStepsByType, completedStepsByType })
    persist({ ...get(), staleStepsByType, completedStepsByType })
  },
  markAllStale(typeId) {
    const order = WIZARD_STEP_ORDER
    const stale = new Set(get().staleStepsByType[typeId] || [])
    const completed = new Set(get().completedStepsByType[typeId] || [])
    for (const id of order) {
      stale.add(id)
      completed.delete(id)
    }
    const staleStepsByType = { ...get().staleStepsByType, [typeId]: [...stale] }
    const completedStepsByType = { ...get().completedStepsByType, [typeId]: [...completed] }
    set({ staleStepsByType, completedStepsByType })
    persist({ ...get(), staleStepsByType, completedStepsByType })
  },
  markExplicit(typeId, keys) {
    const next = new Set(get().explicitFieldsByType[typeId] || [])
    for (const key of keys) next.add(key)
    const explicitFieldsByType = { ...get().explicitFieldsByType, [typeId]: [...next] }
    set({ explicitFieldsByType })
    persist({ ...get(), explicitFieldsByType })
  },
  setPreflight(typeId, snapshot) {
    const preflightByType = { ...get().preflightByType, [typeId]: snapshot }
    set({ preflightByType })
    persist({ ...get(), preflightByType })
  },
  setPreflightWarningConfirmed(typeId, confirmed) {
    const current = get().preflightByType[typeId]
    if (!current) return
    const preflightByType = { ...get().preflightByType, [typeId]: { ...current, warningConfirmed: confirmed } }
    set({ preflightByType })
    persist({ ...get(), preflightByType })
  },
  clearPreflight(typeId) {
    const preflightByType = { ...get().preflightByType }
    delete preflightByType[typeId]
    set({ preflightByType })
    persist({ ...get(), preflightByType })
  },
  resetType(typeId) {
    const activeStepByType = { ...get().activeStepByType, [typeId]: 'type' as WizardStepId }
    const completedStepsByType = { ...get().completedStepsByType, [typeId]: [] }
    const staleStepsByType = { ...get().staleStepsByType, [typeId]: [] }
    const explicitFieldsByType = { ...get().explicitFieldsByType, [typeId]: [] }
    const preflightByType = { ...get().preflightByType }
    delete preflightByType[typeId]
    set({ activeStepByType, completedStepsByType, staleStepsByType, explicitFieldsByType, preflightByType })
    persist({ ...get(), activeStepByType, completedStepsByType, staleStepsByType, explicitFieldsByType, preflightByType })
  },
  applyRestoredType(typeId, explicitKeys) {
    const activeStepByType = { ...get().activeStepByType, [typeId]: 'type' as WizardStepId }
    // 内容整体被换掉:每一步都要重走,所以 stale=全量、completed=空。
    const staleStepsByType = { ...get().staleStepsByType, [typeId]: [...WIZARD_STEP_ORDER] }
    const completedStepsByType = { ...get().completedStepsByType, [typeId]: [] }
    const explicitFieldsByType = {
      ...get().explicitFieldsByType,
      [typeId]: [...new Set([...explicitKeys])],
    }
    const preflightByType = { ...get().preflightByType }
    delete preflightByType[typeId]
    set({ activeStepByType, staleStepsByType, completedStepsByType, explicitFieldsByType, preflightByType })
    persist({
      ...get(),
      activeStepByType,
      staleStepsByType,
      completedStepsByType,
      explicitFieldsByType,
      preflightByType,
    })
  },
  hydrateType(typeId, validSteps) {
    const active = get().activeStepByType[typeId]
    const activeStepByType = {
      ...get().activeStepByType,
      [typeId]: active && validSteps.includes(active) ? active : validSteps[0] || 'type',
    }
    const completedStepsByType = {
      ...get().completedStepsByType,
      [typeId]: (get().completedStepsByType[typeId] || []).filter((id) => validSteps.includes(id)),
    }
    const staleStepsByType = {
      ...get().staleStepsByType,
      [typeId]: (get().staleStepsByType[typeId] || []).filter((id) => validSteps.includes(id)),
    }
    set({ activeStepByType, completedStepsByType, staleStepsByType })
    persist({ ...get(), activeStepByType, completedStepsByType, staleStepsByType })
  },
}))
