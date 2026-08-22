// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

import { WIZARD_STEP_ORDER, type WizardStepId } from './wizardModel'
import type { PreflightSnapshot } from './preflight'

// wizardStore reads/writes localStorage at module scope (key 'lx-train-wizard-v1'),
// so a working localStorage must be installed BEFORE importing the store.
const storage = new Map<string, string>()
const localStorageStub: Storage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, String(value)) },
  removeItem: (key) => { storage.delete(key) },
  clear: () => { storage.clear() },
  key: () => null,
  get length() { return storage.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true })

const { useWizardStore } = await import('./wizardStore')

/**
 * 故意注入一个不在 WIZARD_STEP_ORDER 里的步骤 id。
 *
 * 这类值在类型上不可能出现，但在运行时完全可能:旧版本持久化下来的
 * localStorage 里就带着已删除的步骤 id。hydrateType 必须把它们过滤掉，
 * 所以门禁必须能构造这种非法输入 —— 用局部 cast 而不是放宽 WizardStepId。
 */
function retiredStepId(id: string): WizardStepId {
  return id as unknown as WizardStepId
}

function resetState() {
  storage.clear()
  useWizardStore.setState({
    mode: 'wizard',
    activeStepByType: {},
    completedStepsByType: {},
    explicitFieldsByType: {},
    staleStepsByType: {},
    categoryByType: {},
    preflightByType: {},
  })
}

function snapshot(): PreflightSnapshot {
  return {
    typeId: 'sdxl-lora',
    schemaRev: 1,
    fingerprint: 'abc',
    report: {},
    warningConfirmed: false,
    createdAt: 1,
  }
}

const LATER_STEPS = WIZARD_STEP_ORDER.slice(WIZARD_STEP_ORDER.indexOf('adapter') + 1)

describe('wizardStore', () => {
  beforeEach(() => {
    resetState()
  })

  test('markStaleFrom(typeId, adapter) stales later steps and drops their completion', () => {
    const store = useWizardStore.getState()
    store.markComplete('t', 'type')
    store.markComplete('t', 'model')
    store.markComplete('t', 'files')
    store.markComplete('t', 'dataset')
    store.markStaleFrom('t', 'adapter')

    const state = useWizardStore.getState()
    // type/model completion preserved.
    expect(state.completedStepsByType.t).toContain('type')
    expect(state.completedStepsByType.t).toContain('model')
    // later steps removed from completion.
    expect(state.completedStepsByType.t).not.toContain('files')
    expect(state.completedStepsByType.t).not.toContain('dataset')
    // later steps added to stale; earlier steps not.
    for (const id of LATER_STEPS) {
      expect(state.staleStepsByType.t).toContain(id)
    }
    expect(state.staleStepsByType.t).not.toContain('type')
    expect(state.staleStepsByType.t).not.toContain('model')
  })

  test('markAllStale stales every step including type/model', () => {
    const store = useWizardStore.getState()
    store.markComplete('t', 'type')
    store.markComplete('t', 'files')
    store.markAllStale('t')

    const state = useWizardStore.getState()
    expect(state.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
    expect(state.completedStepsByType.t).toEqual([])
  })

  test('markComplete removes a step from stale and adds it to completed', () => {
    const store = useWizardStore.getState()
    store.markStaleFrom('t', 'files')
    expect(useWizardStore.getState().staleStepsByType.t).toContain('dataset')
    store.markComplete('t', 'dataset')

    const state = useWizardStore.getState()
    expect(state.staleStepsByType.t).not.toContain('dataset')
    expect(state.completedStepsByType.t).toContain('dataset')
  })

  test('markExplicit dedups keys and persists to localStorage', () => {
    const store = useWizardStore.getState()
    store.markExplicit('t', ['a', 'b'])
    store.markExplicit('t', ['b', 'c'])

    const state = useWizardStore.getState()
    expect(state.explicitFieldsByType.t).toEqual(['a', 'b', 'c'])

    const raw = storage.get('lx-train-wizard-v1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.explicitFieldsByType.t).toEqual(['a', 'b', 'c'])
  })

  test('setPreflight/clearPreflight are isolated per type', () => {
    const store = useWizardStore.getState()
    const snapA = snapshot()
    const snapB = { ...snapshot(), typeId: 'yolo' }
    store.setPreflight('a', snapA)
    store.setPreflight('b', snapB)
    expect(useWizardStore.getState().preflightByType.a).toBe(snapA)
    expect(useWizardStore.getState().preflightByType.b).toBe(snapB)

    store.clearPreflight('a')
    const state = useWizardStore.getState()
    expect(state.preflightByType.a).toBeUndefined()
    expect(state.preflightByType.b).toBe(snapB)
  })

  test('hydrateType drops invalid step ids from completed/stale', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('t', 'files')
    store.markComplete('t', 'type')
    store.markComplete('t', 'files')
    store.markComplete('t', retiredStepId('ghost-step'))
    store.markStaleFrom('t', 'dataset')
    store.markComplete('t', 'dataset')
    store.hydrateType('t', ['type', 'model', 'files', 'dataset'] as WizardStepId[])

    const state = useWizardStore.getState()
    expect(state.completedStepsByType.t).not.toContain('ghost-step')
    expect(state.completedStepsByType.t).toEqual(expect.arrayContaining(['type', 'files', 'dataset']))
    // stale steps after 'dataset' are not valid for this type -> dropped.
    expect(state.staleStepsByType.t).toEqual([])
    // valid active step is preserved.
    expect(state.activeStepByType.t).toBe('files')
  })

  test('hydrateType resets an invalid active step to the first valid step', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('t', retiredStepId('bogus-step'))
    store.hydrateType('t', ['type', 'model'] as WizardStepId[])
    expect(useWizardStore.getState().activeStepByType.t).toBe('type')
  })
})

// ─── 合法步骤过滤 ─────────────────────────────────────────────────────────────

describe('wizardStore: valid-step filtering', () => {
  beforeEach(() => {
    resetState()
  })

  test('hydrateType keeps every still-valid completed step', () => {
    const store = useWizardStore.getState()
    const valid = ['type', 'model', 'files', 'dataset', 'output', 'review'] as WizardStepId[]
    for (const id of valid) store.markComplete('t', id)
    store.hydrateType('t', valid)
    expect(useWizardStore.getState().completedStepsByType.t).toEqual(expect.arrayContaining(valid))
  })

  test('switching to a narrower type drops steps that no longer exist', () => {
    const store = useWizardStore.getState()
    // 先按 LoRA 走一遍(含 adapter/performance)，再切到只有基础步骤的类型。
    for (const id of ['type', 'model', 'adapter', 'files', 'performance'] as WizardStepId[]) {
      store.markComplete('t', id)
    }
    store.hydrateType('t', ['type', 'model', 'files', 'review'] as WizardStepId[])
    const state = useWizardStore.getState()
    expect(state.completedStepsByType.t).toEqual(expect.arrayContaining(['type', 'model', 'files']))
    // adapter / performance 对新类型无意义，必须消失而不是留着显示"已完成"。
    expect(state.completedStepsByType.t).not.toContain('adapter')
    expect(state.completedStepsByType.t).not.toContain('performance')
  })

  test('stale marks are filtered by the same valid-step list', () => {
    const store = useWizardStore.getState()
    store.markAllStale('t')
    store.hydrateType('t', ['type', 'model', 'files'] as WizardStepId[])
    const stale = useWizardStore.getState().staleStepsByType.t
    expect(stale.every((id) => ['type', 'model', 'files'].includes(id))).toBe(true)
    expect(stale).toEqual(expect.arrayContaining(['type', 'model', 'files']))
  })

  test('an empty valid-step list falls back to the type step', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('t', 'files')
    store.markComplete('t', 'files')
    store.hydrateType('t', [] as WizardStepId[])
    const state = useWizardStore.getState()
    // 没有任何合法步骤时不能把 activeStep 留在已消失的 id 上。
    expect(state.activeStepByType.t).toBe('type')
    expect(state.completedStepsByType.t).toEqual([])
    expect(state.staleStepsByType.t).toEqual([])
  })

  test('hydrateType is idempotent', () => {
    const store = useWizardStore.getState()
    const valid = ['type', 'model', 'files'] as WizardStepId[]
    store.setActiveStep('t', 'files')
    store.markComplete('t', 'files')
    store.hydrateType('t', valid)
    const first = useWizardStore.getState()
    const snapshot = {
      active: first.activeStepByType.t,
      completed: [...(first.completedStepsByType.t ?? [])],
      stale: [...(first.staleStepsByType.t ?? [])],
    }
    useWizardStore.getState().hydrateType('t', valid)
    const second = useWizardStore.getState()
    expect(second.activeStepByType.t).toBe(snapshot.active)
    expect(second.completedStepsByType.t).toEqual(snapshot.completed)
    expect(second.staleStepsByType.t).toEqual(snapshot.stale)
  })

  test('hydrateType never leaks state across types', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('a', 'files')
    store.markComplete('a', 'files')
    store.setActiveStep('b', 'dataset')
    store.markComplete('b', 'dataset')
    store.hydrateType('a', ['type', 'model'] as WizardStepId[])
    const state = useWizardStore.getState()
    expect(state.activeStepByType.a).toBe('type')
    expect(state.activeStepByType.b).toBe('dataset')
    expect(state.completedStepsByType.b).toContain('dataset')
  })

  test('hydrateType persists the filtered result', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('t', retiredStepId('ghost'))
    store.markComplete('t', retiredStepId('ghost'))
    store.hydrateType('t', ['type', 'model'] as WizardStepId[])
    const persisted = JSON.parse(storage.get('lx-train-wizard-v1') ?? '{}')
    expect(persisted.activeStepByType.t).toBe('type')
    expect(persisted.completedStepsByType.t).not.toContain('ghost')
  })
})

// ─── 恢复事务 ─────────────────────────────────────────────────────────────────

describe('wizardStore: restore transaction', () => {
  beforeEach(() => {
    resetState()
  })

  /**
   * TrainPage.doRestoreLast / SavedConfigsModal.onLoad 用的是同一组动作：
   *   resetType -> markExplicit -> markAllStale
   * 恢复后每一步都必须重新校验(全 stale)，同时记住哪些字段来自恢复(explicit)。
   */
  function restoreTransaction(typeId: string, restoredKeys: string[]) {
    const wizard = useWizardStore.getState()
    wizard.resetType(typeId)
    wizard.markExplicit(typeId, restoredKeys)
    wizard.markAllStale(typeId)
  }

  test('the restore transaction stales every step and drops all completions', () => {
    const store = useWizardStore.getState()
    for (const id of ['type', 'model', 'files', 'dataset', 'review'] as WizardStepId[]) store.markComplete('t', id)
    restoreTransaction('t', ['pretrained_model_name_or_path', 'train_data_dir'])

    const state = useWizardStore.getState()
    expect(state.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
    expect(state.completedStepsByType.t).toEqual([])
  })

  test('the restore transaction rewinds the active step to type', () => {
    const store = useWizardStore.getState()
    store.setActiveStep('t', 'review')
    restoreTransaction('t', ['a'])
    expect(useWizardStore.getState().activeStepByType.t).toBe('type')
  })

  test('restored keys are recorded as explicit so they are not treated as untouched defaults', () => {
    restoreTransaction('t', ['pretrained_model_name_or_path', 'train_data_dir', 'output_name'])
    expect(useWizardStore.getState().explicitFieldsByType.t)
      .toEqual(['pretrained_model_name_or_path', 'train_data_dir', 'output_name'])
  })

  test('resetType clears explicit fields before the new set is recorded', () => {
    const store = useWizardStore.getState()
    store.markExplicit('t', ['stale_key_from_previous_run'])
    restoreTransaction('t', ['fresh_key'])
    // 上一次恢复留下的 explicit 不能与新恢复混在一起。
    expect(useWizardStore.getState().explicitFieldsByType.t).toEqual(['fresh_key'])
  })

  test('resetType drops a stored preflight so the stale payload cannot gate launch', () => {
    const store = useWizardStore.getState()
    store.setPreflight('t', snapshot())
    expect(useWizardStore.getState().preflightByType.t).toBeTruthy()
    restoreTransaction('t', ['a'])
    // 恢复换掉了整个配置；旧预检结果必须失效，否则可能直接允许启动。
    expect(useWizardStore.getState().preflightByType.t).toBeUndefined()
  })

  test('the restore transaction is scoped to the restored type', () => {
    const store = useWizardStore.getState()
    store.markComplete('other', 'files')
    store.setActiveStep('other', 'files')
    store.setPreflight('other', snapshot())
    store.markExplicit('other', ['other_key'])

    restoreTransaction('t', ['a'])

    const state = useWizardStore.getState()
    expect(state.completedStepsByType.other).toContain('files')
    expect(state.activeStepByType.other).toBe('files')
    expect(state.preflightByType.other).toBeTruthy()
    expect(state.explicitFieldsByType.other).toEqual(['other_key'])
  })

  test('restoring into a different type leaves the source type untouched', () => {
    const store = useWizardStore.getState()
    store.markComplete('sdxl-lora', 'files')
    restoreTransaction('sdxl-ileco', ['pretrained_model_name_or_path'])
    const state = useWizardStore.getState()
    expect(state.completedStepsByType['sdxl-lora']).toContain('files')
    expect(state.staleStepsByType['sdxl-ileco']).toEqual(WIZARD_STEP_ORDER)
  })

  test('the whole transaction survives a reload through localStorage', () => {
    restoreTransaction('t', ['k1', 'k2'])
    const persisted = JSON.parse(storage.get('lx-train-wizard-v1') ?? '{}')
    expect(persisted.activeStepByType.t).toBe('type')
    expect(persisted.completedStepsByType.t).toEqual([])
    expect(persisted.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
    expect(persisted.explicitFieldsByType.t).toEqual(['k1', 'k2'])
  })

  test('a subsequent hydrateType narrows the all-stale set to the restored type steps', () => {
    restoreTransaction('t', ['a'])
    const valid = ['type', 'model', 'files', 'review'] as WizardStepId[]
    useWizardStore.getState().hydrateType('t', valid)
    const stale = useWizardStore.getState().staleStepsByType.t
    expect(stale).toEqual(valid)
  })

  test('re-validating one step after restore only clears that step', () => {
    restoreTransaction('t', ['a'])
    useWizardStore.getState().markComplete('t', 'files')
    const state = useWizardStore.getState()
    expect(state.staleStepsByType.t).not.toContain('files')
    expect(state.completedStepsByType.t).toEqual(['files'])
    expect(state.staleStepsByType.t).toContain('review')
  })

  test('an empty restored key set still produces a clean all-stale state', () => {
    restoreTransaction('t', [])
    const state = useWizardStore.getState()
    expect(state.explicitFieldsByType.t).toEqual([])
    expect(state.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
  })
})

// ─── applyRestoredType 原子重置 ───────────────────────────────────────────────

/**
 * applyRestoredType 是把上面那三步(resetType -> markExplicit -> markAllStale)
 * 收敛成的单个动作。收敛的意义就在于原子性:三步版本每一步都 set() 一次,
 * 中间态会被订阅者看到 —— 比如「completed 已清空但 stale 还没铺满」的那一帧,
 * 足以让 review 步骤短暂地看起来可启动。
 */
describe('wizardStore: applyRestoredType', () => {
  beforeEach(() => {
    resetState()
  })

  test('one call produces the same end state as the three-step transaction', () => {
    const store = useWizardStore.getState()
    for (const id of ['type', 'model', 'files'] as WizardStepId[]) store.markComplete('t', id)
    store.setActiveStep('t', 'review')
    store.setPreflight('t', snapshot())
    store.markExplicit('t', ['stale_key'])

    useWizardStore.getState().applyRestoredType('t', ['fresh_key', 'other_key'])

    const state = useWizardStore.getState()
    expect(state.activeStepByType.t).toBe('type')
    expect(state.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
    expect(state.completedStepsByType.t).toEqual([])
    expect(state.explicitFieldsByType.t).toEqual(['fresh_key', 'other_key'])
    expect(state.preflightByType.t).toBeUndefined()
  })

  test('subscribers never observe a half-applied restore', () => {
    const store = useWizardStore.getState()
    for (const id of ['type', 'model', 'files'] as WizardStepId[]) store.markComplete('t', id)
    store.setPreflight('t', snapshot())

    const frames: { completed: number; stale: number; preflight: boolean }[] = []
    const unsubscribe = useWizardStore.subscribe((state) => {
      frames.push({
        completed: (state.completedStepsByType.t || []).length,
        stale: (state.staleStepsByType.t || []).length,
        preflight: Boolean(state.preflightByType.t),
      })
    })
    useWizardStore.getState().applyRestoredType('t', ['k'])
    unsubscribe()

    // 单次 set:恰好一帧,且那一帧已经是完全恢复后的状态。
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({ completed: 0, stale: WIZARD_STEP_ORDER.length, preflight: false })
  })

  test('explicit keys are deduped', () => {
    useWizardStore.getState().applyRestoredType('t', ['a', 'b', 'a'])
    expect(useWizardStore.getState().explicitFieldsByType.t).toEqual(['a', 'b'])
  })

  test('any iterable of keys is accepted, not just arrays', () => {
    // restoreConfigService 传的是 appliedKeys 数组，但签名声明的是 Iterable，
    // Set 输入必须同样可用，否则调用方得先手动摊平。
    useWizardStore.getState().applyRestoredType('t', new Set(['x', 'y']))
    expect(useWizardStore.getState().explicitFieldsByType.t).toEqual(['x', 'y'])
  })

  test('other types are untouched', () => {
    const store = useWizardStore.getState()
    store.markComplete('other', 'files')
    store.setActiveStep('other', 'files')
    store.setPreflight('other', snapshot())
    store.markExplicit('other', ['other_key'])

    useWizardStore.getState().applyRestoredType('t', ['k'])

    const state = useWizardStore.getState()
    expect(state.completedStepsByType.other).toContain('files')
    expect(state.activeStepByType.other).toBe('files')
    expect(state.preflightByType.other).toBeTruthy()
    expect(state.explicitFieldsByType.other).toEqual(['other_key'])
  })

  test('the atomic result is persisted in one write', () => {
    useWizardStore.getState().applyRestoredType('t', ['k'])
    const persisted = JSON.parse(storage.get('lx-train-wizard-v1') ?? '{}')
    expect(persisted.activeStepByType.t).toBe('type')
    expect(persisted.completedStepsByType.t).toEqual([])
    expect(persisted.staleStepsByType.t).toEqual(WIZARD_STEP_ORDER)
    expect(persisted.explicitFieldsByType.t).toEqual(['k'])
    expect(persisted.preflightByType?.t).toBeUndefined()
  })
})

// ─── preflight 确认状态 ───────────────────────────────────────────────────────

describe('wizardStore: preflight confirmation', () => {
  beforeEach(() => {
    resetState()
  })

  test('setPreflightWarningConfirmed toggles only the stored snapshot', () => {
    const store = useWizardStore.getState()
    store.setPreflight('t', snapshot())
    store.setPreflightWarningConfirmed('t', true)
    expect(useWizardStore.getState().preflightByType.t?.warningConfirmed).toBe(true)
    useWizardStore.getState().setPreflightWarningConfirmed('t', false)
    expect(useWizardStore.getState().preflightByType.t?.warningConfirmed).toBe(false)
  })

  test('confirming with no snapshot is a no-op and does not fabricate one', () => {
    useWizardStore.getState().setPreflightWarningConfirmed('t', true)
    // 凭空造出一个 confirmed 快照会让 launch 按钮在没跑预检时就可点。
    expect(useWizardStore.getState().preflightByType.t).toBeUndefined()
  })

  test('setPreflight replaces the snapshot, resetting a previous confirmation', () => {
    const store = useWizardStore.getState()
    store.setPreflight('t', snapshot())
    store.setPreflightWarningConfirmed('t', true)
    useWizardStore.getState().setPreflight('t', { ...snapshot(), fingerprint: 'changed' })
    const stored = useWizardStore.getState().preflightByType.t
    expect(stored?.fingerprint).toBe('changed')
    expect(stored?.warningConfirmed).toBe(false)
  })

  test('mode changes persist and do not disturb per-type state', () => {
    const store = useWizardStore.getState()
    store.markComplete('t', 'files')
    store.setMode('expert')
    expect(useWizardStore.getState().mode).toBe('expert')
    expect(useWizardStore.getState().completedStepsByType.t).toContain('files')
    expect(JSON.parse(storage.get('lx-train-wizard-v1') ?? '{}').mode).toBe('expert')
  })

  test('setCategory is per-type and persisted', () => {
    const store = useWizardStore.getState()
    store.setCategory('t', 'lora')
    store.setCategory('u', 'finetune')
    const state = useWizardStore.getState()
    expect(state.categoryByType).toMatchObject({ t: 'lora', u: 'finetune' })
    expect(JSON.parse(storage.get('lx-train-wizard-v1') ?? '{}').categoryByType.t).toBe('lora')
  })
})
