// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * restoreConfigService 契约门禁。
 *
 * 这是「恢复上次训练 / 导入预设 / 从 Queue 回填某个 run」的唯一入口。它的错误
 * 模式不是崩溃，而是静默产出一个「看起来能跑、参数张冠李戴」的配置:把 wan22
 * 视频族的参数灌进 sdxl-lora，用户点启动才发现。所以这里的断言集中在两点:
 *   1. fail-closed —— 类型不可用时绝不落地任何东西;
 *   2. 原子性 —— 落地就必须切型 + 换 draft + 重置向导状态，不留半成品。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadTrainDrafts: vi.fn(),
  saveTrainDrafts: vi.fn(),
  clearTrainDrafts: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const { resolveRestoreTargetType, restoreConfigIntoDraft } = await import(
  '@/features/training/restoreConfigService'
)
const { useTrainConfigStore, __resetTrainDraftRuntimeState } = await import('@/stores/configStore')
const { useWizardStore } = await import('@/pages/train/wizard/wizardStore')
const { WIZARD_STEP_ORDER } = await import('@/pages/train/wizard/wizardModel')
const { createDefaultConfig } = await import('@/schema/schemaIndex.js')

/** 注册、未禁用、有 schema，但不在新手可见列表里 —— 恢复路径必须能落进去。 */
const HIDDEN_RESTORABLE_TYPE = 'sdxl-ileco'
/** ALL_TRAINING_TYPES 里唯一被 disabled 的类型。 */
const DISABLED_TYPE = 'concept-edit'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  __resetTrainDraftRuntimeState()
  mocks.saveTrainDrafts.mockResolvedValue({})
  mocks.clearTrainDrafts.mockResolvedValue({})
  useTrainConfigStore.setState({
    typeId: 'sdxl-lora',
    drafts: { 'sdxl-lora': createDefaultConfig('sdxl-lora') },
    schemaRev: 0,
    diskHydrated: true,
    hydrationStatus: 'ready',
    hydrationError: null,
  })
  useWizardStore.setState({
    mode: 'wizard',
    activeStepByType: {},
    completedStepsByType: {},
    explicitFieldsByType: {},
    staleStepsByType: {},
    categoryByType: {},
    preflightByType: {},
  })
})

function draftOf(typeId: string): Record<string, unknown> {
  return useTrainConfigStore.getState().drafts[typeId] ?? {}
}

// ─── resolveRestoreTargetType ────────────────────────────────────────────────

describe('restoreConfigService: resolveRestoreTargetType', () => {
  test('the first restorable candidate wins', () => {
    const resolution = resolveRestoreTargetType(['anima-lora', 'sdxl-lora'], 'sdxl-lora')
    expect(resolution).toMatchObject({
      typeId: 'anima-lora',
      switched: true,
      requestedTypeId: 'anima-lora',
      access: 'restorable',
      fellBackToCurrentType: false,
    })
  })

  test('an unusable first candidate is skipped for a usable later one', () => {
    // 后端可能同时给 schema_id 和 training_type，前者是旧值/别名的情况很常见。
    const resolution = resolveRestoreTargetType(['not-a-real-type', 'anima-lora'], 'sdxl-lora')
    expect(resolution.typeId).toBe('anima-lora')
    // requestedTypeId 保留第一候选，这样 UI 能提示"类型 X 不可用"。
    expect(resolution.requestedTypeId).toBe('not-a-real-type')
    // 注意:RestoreTypeResolution.access 的注释写的是「第一个候选的准入判定」，
    // 但命中分支实际返回的是**被采纳候选**的判定。这里按实际行为锁定，
    // 免得 UI 依赖注释去写 `access !== 'restorable'` 的提示逻辑。
    // 影响有限(成功路径本来就不该提示)，但注释与实现不一致本身值得收敛。
    expect(resolution.access).toBe('restorable')
  })

  test('resolving to the current type is not reported as a switch', () => {
    const resolution = resolveRestoreTargetType(['sdxl-lora'], 'sdxl-lora')
    expect(resolution.switched).toBe(false)
    expect(resolution.typeId).toBe('sdxl-lora')
  })

  test('a hidden-but-registered legacy type is restorable', () => {
    const resolution = resolveRestoreTargetType([HIDDEN_RESTORABLE_TYPE], 'sdxl-lora')
    expect(resolution.typeId).toBe(HIDDEN_RESTORABLE_TYPE)
    expect(resolution.access).toBe('restorable')
  })

  test('a disabled type is never resolved, even as the only candidate', () => {
    const resolution = resolveRestoreTargetType([DISABLED_TYPE], 'sdxl-lora')
    expect(resolution.typeId).toBeNull()
    expect(resolution.access).toBe('disabled')
  })

  test('no candidates at all stays on the current type', () => {
    // 纯 config 袋(外部 TOML 导入)没有类型信息，留在当前类型是唯一合理解读。
    const resolution = resolveRestoreTargetType(undefined, 'anima-lora')
    expect(resolution).toMatchObject({
      typeId: 'anima-lora',
      switched: false,
      requestedTypeId: null,
      fellBackToCurrentType: false,
    })
  })

  test('blank and duplicate candidates are normalized away', () => {
    const resolution = resolveRestoreTargetType(
      [null, undefined, '  ', '', 'anima-lora', 'anima-lora'],
      'sdxl-lora',
    )
    expect(resolution.typeId).toBe('anima-lora')
    expect(resolution.requestedTypeId).toBe('anima-lora')
  })

  test('whitespace-padded candidates are trimmed, not rejected', () => {
    expect(resolveRestoreTargetType(['  anima-lora  '], 'sdxl-lora').typeId).toBe('anima-lora')
  })

  test('an all-blank candidate list is treated as "no candidates"', () => {
    const resolution = resolveRestoreTargetType(['', '   ', null], 'sdxl-lora')
    expect(resolution.typeId).toBe('sdxl-lora')
    expect(resolution.requestedTypeId).toBeNull()
  })

  test('fail-closed is the default: unusable candidates resolve to null', () => {
    const resolution = resolveRestoreTargetType(['not-a-real-type'], 'sdxl-lora')
    expect(resolution.typeId).toBeNull()
    expect(resolution.fellBackToCurrentType).toBe(false)
  })

  test('the fallback is opt-in and reports itself', () => {
    const resolution = resolveRestoreTargetType(['not-a-real-type'], 'sdxl-lora', {
      allowFallbackToCurrentType: true,
    })
    expect(resolution.typeId).toBe('sdxl-lora')
    expect(resolution.fellBackToCurrentType).toBe(true)
    expect(resolution.access).toBe('unregistered')
  })

  test('even with the fallback on, a disabled type reports why it was rejected', () => {
    const resolution = resolveRestoreTargetType([DISABLED_TYPE], 'sdxl-lora', {
      allowFallbackToCurrentType: true,
    })
    expect(resolution.typeId).toBe('sdxl-lora')
    expect(resolution.access).toBe('disabled')
    expect(resolution.fellBackToCurrentType).toBe(true)
  })
})

// ─── fail-closed ─────────────────────────────────────────────────────────────

describe('restoreConfigService: fail-closed', () => {
  test('an unknown type restores nothing at all', () => {
    const before = { ...draftOf('sdxl-lora') }
    const result = restoreConfigIntoDraft({
      config: { network_dim: 128, output_name: 'from-elsewhere' },
      typeCandidates: ['some-fork-only-type'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('type_unavailable')
    // 关键点:当前 draft 一个字节都不能变。
    expect(draftOf('sdxl-lora')).toEqual(before)
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
  })

  test('a disabled type restores nothing at all', () => {
    const before = { ...draftOf('sdxl-lora') }
    const result = restoreConfigIntoDraft({
      config: { network_dim: 128 },
      typeCandidates: [DISABLED_TYPE],
    })
    expect(result.ok).toBe(false)
    expect(draftOf('sdxl-lora')).toEqual(before)
  })

  test('a rejected restore leaves the wizard state untouched', () => {
    useWizardStore.getState().markComplete('sdxl-lora', 'files')
    restoreConfigIntoDraft({ config: { network_dim: 1 }, typeCandidates: ['nope'] })
    // 向导状态被清掉但 draft 没换 = 用户白丢一遍进度。
    expect(useWizardStore.getState().completedStepsByType['sdxl-lora']).toContain('files')
    expect(useWizardStore.getState().staleStepsByType['sdxl-lora'] ?? []).toEqual([])
  })

  test('an empty config is rejected before anything is touched', () => {
    const before = { ...draftOf('sdxl-lora') }
    const result = restoreConfigIntoDraft({ config: {}, typeCandidates: ['anima-lora'] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('empty_config')
    // 类型没被切走 —— 空配置不该把用户从当前类型踢出去。
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
    expect(draftOf('sdxl-lora')).toEqual(before)
  })

  test('a non-object config is rejected as empty', () => {
    // 后端返回 null/数组/字符串都遇到过;这些是运行时可能出现但类型上不合法的
    // 输入，所以用局部 cast 构造，而不是放宽生产签名。
    for (const bad of [null, undefined, [], 'str', 42]) {
      const result = restoreConfigIntoDraft({
        config: bad as unknown as Record<string, unknown>,
        typeCandidates: ['anima-lora'],
      })
      expect(result.ok, String(bad)).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toBe('empty_config')
    }
  })

  test('empty_config is reported even when the type itself is fine', () => {
    // reason 的优先级必须稳定，UI 的提示文案依赖它。
    const result = restoreConfigIntoDraft({ config: {}, typeCandidates: ['bogus'] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('empty_config')
  })

  test('the failure result still carries the resolution for the UI message', () => {
    const result = restoreConfigIntoDraft({
      config: { network_dim: 1 },
      typeCandidates: [DISABLED_TYPE],
    })
    expect(result.ok).toBe(false)
    expect(result.resolution.requestedTypeId).toBe(DISABLED_TYPE)
    expect(result.resolution.access).toBe('disabled')
  })
})

// ─── 切型断言 ────────────────────────────────────────────────────────────────

describe('restoreConfigService: type switching', () => {
  test('a successful restore switches the active type', () => {
    const result = restoreConfigIntoDraft({
      config: { network_dim: 64, output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    expect(result.ok).toBe(true)
    expect(useTrainConfigStore.getState().typeId).toBe('anima-lora')
    expect(draftOf('anima-lora').output_name).toBe('restored')
  })

  test('the restored config lands in the target type, never the previous one', () => {
    const before = { ...draftOf('sdxl-lora') }
    restoreConfigIntoDraft({
      config: { output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    // 这是最贵的一个 bug:切了型但 draft 写进了旧类型(或反过来)。
    expect(draftOf('sdxl-lora')).toEqual(before)
    expect(draftOf('anima-lora').output_name).toBe('restored')
  })

  test('restoring into a hidden legacy type works end to end', () => {
    const result = restoreConfigIntoDraft({
      config: { output_name: 'legacy-run' },
      typeCandidates: [HIDDEN_RESTORABLE_TYPE],
    })
    expect(result.ok).toBe(true)
    expect(useTrainConfigStore.getState().typeId).toBe(HIDDEN_RESTORABLE_TYPE)
    expect(draftOf(HIDDEN_RESTORABLE_TYPE).output_name).toBe('legacy-run')
  })

  test('restoring into the current type does not report a switch', () => {
    const result = restoreConfigIntoDraft({
      config: { output_name: 'same-type' },
      typeCandidates: ['sdxl-lora'],
    })
    expect(result.ok).toBe(true)
    expect(result.resolution.switched).toBe(false)
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
  })

  test('a config with no type candidates lands in the current type', () => {
    restoreConfigIntoDraft({ config: { output_name: 'imported' } })
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
    expect(draftOf('sdxl-lora').output_name).toBe('imported')
  })

  test('the target draft is rebased on schema defaults, not merged onto the old one', () => {
    // 上一次编辑留在 anima-lora 上的值不能透过恢复活下来。
    useTrainConfigStore.setState({
      drafts: {
        ...useTrainConfigStore.getState().drafts,
        'anima-lora': { ...createDefaultConfig('anima-lora'), output_name: 'stale-leftover' },
      },
    })
    restoreConfigIntoDraft({
      config: { network_dim: 64 },
      typeCandidates: ['anima-lora'],
    })
    expect(draftOf('anima-lora').output_name).not.toBe('stale-leftover')
  })

  test('foreign schema keys are dropped and reported', () => {
    const result = restoreConfigIntoDraft({
      config: { output_name: 'restored', totally_not_a_field_xyz: 1 },
      typeCandidates: ['anima-lora'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.droppedKeys).toContain('totally_not_a_field_xyz')
    expect(result.appliedKeys).toContain('output_name')
    expect(result.appliedKeys).not.toContain('totally_not_a_field_xyz')
    expect(draftOf('anima-lora').totally_not_a_field_xyz).toBeUndefined()
  })
})

// ─── 向导状态重置 ────────────────────────────────────────────────────────────

describe('restoreConfigService: wizard reset', () => {
  test('a successful restore stales every step of the target type', () => {
    useWizardStore.getState().markComplete('anima-lora', 'files')
    restoreConfigIntoDraft({
      config: { output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    const state = useWizardStore.getState()
    expect(state.staleStepsByType['anima-lora']).toEqual(WIZARD_STEP_ORDER)
    expect(state.completedStepsByType['anima-lora']).toEqual([])
    expect(state.activeStepByType['anima-lora']).toBe('type')
  })

  test('applied keys become explicit fields so autofill will not overwrite them', () => {
    const result = restoreConfigIntoDraft({
      config: { output_name: 'restored', network_dim: 64 },
      typeCandidates: ['anima-lora'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    const explicit = useWizardStore.getState().explicitFieldsByType['anima-lora'] ?? []
    for (const key of result.appliedKeys) expect(explicit).toContain(key)
  })

  test('dropped keys are not recorded as explicit', () => {
    restoreConfigIntoDraft({
      config: { output_name: 'restored', totally_not_a_field_xyz: 1 },
      typeCandidates: ['anima-lora'],
    })
    expect(useWizardStore.getState().explicitFieldsByType['anima-lora'])
      .not.toContain('totally_not_a_field_xyz')
  })

  test('a stored preflight for the target type is dropped', () => {
    useWizardStore.getState().setPreflight('anima-lora', {
      typeId: 'anima-lora',
      schemaRev: 1,
      fingerprint: 'abc',
      report: {},
      warningConfirmed: true,
      createdAt: 1,
    })
    restoreConfigIntoDraft({
      config: { output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    // 恢复换掉了整袋配置;旧预检若留着，warningConfirmed=true 会直接放行启动。
    expect(useWizardStore.getState().preflightByType['anima-lora']).toBeUndefined()
  })

  test('resetWizardState:false leaves the wizard alone but still applies the draft', () => {
    useWizardStore.getState().markComplete('anima-lora', 'files')
    const result = restoreConfigIntoDraft(
      { config: { output_name: 'restored' }, typeCandidates: ['anima-lora'] },
      { resetWizardState: false },
    )
    expect(result.ok).toBe(true)
    expect(draftOf('anima-lora').output_name).toBe('restored')
    expect(useWizardStore.getState().completedStepsByType['anima-lora']).toContain('files')
  })

  test('the wizard state of other types is untouched', () => {
    useWizardStore.getState().markComplete('sdxl-lora', 'files')
    useWizardStore.getState().markExplicit('sdxl-lora', ['sdxl_key'])
    restoreConfigIntoDraft({
      config: { output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    const state = useWizardStore.getState()
    expect(state.completedStepsByType['sdxl-lora']).toContain('files')
    expect(state.explicitFieldsByType['sdxl-lora']).toEqual(['sdxl_key'])
  })
})
