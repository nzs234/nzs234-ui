// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * restoreConfigService 的切型断言契约(第二轮 code review 的 P1)。
 *
 * setType 是 store 层的最后一道闸(无 schema 的类型直接 return)。恢复事务在它
 * 之后无条件 replaceDraft,就存在这条静默错配路径:
 *   闸门拒绝切到目标类型 A → replaceDraft 仍然执行 → A 的配置袋被
 *   normalizeDraftForType 按当前类型 B 的 schema 裁一遍写进 B。
 * 裁完剩下的键在 B 里都合法,UI 看不出任何异常,用户就拿着"A 的意图 + B 的字段"
 * 点了启动。正确行为是整体失败,不落地任何东西。
 *
 * describeTrainingTypeAccess 与 setType 的判定条件本应一致,所以这条分支是防御性的。
 * 用例通过 mock 让两者刻意漂移,验证漂移时的失败方式是拒绝而不是错配 ——
 * 这正是它必须被测的理由:真实漂移只会在改 schema 注册表时悄悄出现。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadTrainDrafts: vi.fn(),
  saveTrainDrafts: vi.fn(),
  clearTrainDrafts: vi.fn(),
  setTypeShouldFail: { value: false },
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

/**
 * 只拦 setType,其余一律走真实实现。
 * 这样 replaceDraft / normalizeDraftForType 的行为不被 mock 影响 ——
 * 用例要观察的正是"切型失败时 replaceDraft 会不会照样写进当前类型"。
 */
vi.mock('@/stores/configStore', async () => {
  const actual = await vi.importActual<typeof import('@/stores/configStore')>('@/stores/configStore')
  const store = actual.useTrainConfigStore
  const realSetType = store.getState().setType
  store.setState({
    setType(typeId: string) {
      if (mocks.setTypeShouldFail.value) return
      realSetType(typeId)
    },
  })
  return actual
})

const { restoreConfigIntoDraft } = await import('@/features/training/restoreConfigService')
const { useTrainConfigStore } = await import('@/stores/configStore')
const { useWizardStore } = await import('@/pages/train/wizard/wizardStore')
const { createDefaultConfig } = await import('@/schema/schemaIndex.js')

type Bag = Record<string, unknown>

function draftOf(typeId: string): Bag {
  return useTrainConfigStore.getState().drafts[typeId] ?? {}
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.setTypeShouldFail.value = false
  mocks.saveTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 1 } })
  mocks.clearTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 1 } })
  mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { revision: 0, drafts: {} } })
  useTrainConfigStore.setState({
    typeId: 'sdxl-lora',
    drafts: { 'sdxl-lora': createDefaultConfig('sdxl-lora') as Bag },
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

describe('restoreConfigService: the type switch is asserted, not assumed', () => {
  test('a refused switch fails the whole restore instead of writing into the current type', () => {
    const before = { ...draftOf('sdxl-lora') }
    mocks.setTypeShouldFail.value = true

    const result = restoreConfigIntoDraft({
      config: { network_dim: 128, output_name: 'from-anima' },
      typeCandidates: ['anima-lora'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('type_switch_failed')
    // 关键:sdxl-lora 的 draft 一个字节都不能变。network_dim 在两个 schema 里
    // 都合法,所以这正是"看起来正常、实际张冠李戴"的那条路径。
    expect(draftOf('sdxl-lora')).toEqual(before)
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
  })

  test('the target type draft is not created either', () => {
    mocks.setTypeShouldFail.value = true
    restoreConfigIntoDraft({ config: { network_dim: 1 }, typeCandidates: ['anima-lora'] })
    // 半个应用完的 draft 比彻底失败更糟:用户切过去会看到一份来源不明的配置。
    expect(useTrainConfigStore.getState().drafts['anima-lora']).toBeUndefined()
  })

  test('the wizard state is left untouched when the switch is refused', () => {
    useWizardStore.getState().markComplete('sdxl-lora', 'files')
    mocks.setTypeShouldFail.value = true
    restoreConfigIntoDraft({ config: { network_dim: 1 }, typeCandidates: ['anima-lora'] })
    expect(useWizardStore.getState().completedStepsByType['sdxl-lora']).toContain('files')
    expect(useWizardStore.getState().explicitFieldsByType['anima-lora'] ?? []).toEqual([])
  })

  test('the failure still carries the resolution so the UI can explain it', () => {
    mocks.setTypeShouldFail.value = true
    const result = restoreConfigIntoDraft({ config: { network_dim: 1 }, typeCandidates: ['anima-lora'] })
    expect(result.ok).toBe(false)
    expect(result.resolution.requestedTypeId).toBe('anima-lora')
    expect(result.resolution.typeId).toBe('anima-lora')
    expect(result.resolution.switched).toBe(true)
  })

  test('a restore that needs no switch is unaffected by the assertion', () => {
    // 目标就是当前类型 → 不调 setType,断言也不该把它拦下来。
    mocks.setTypeShouldFail.value = true
    const result = restoreConfigIntoDraft({
      config: { output_name: 'same-type' },
      typeCandidates: ['sdxl-lora'],
    })
    expect(result.ok).toBe(true)
    expect(draftOf('sdxl-lora').output_name).toBe('same-type')
  })

  test('a candidate-less restore still lands in the current type', () => {
    mocks.setTypeShouldFail.value = true
    const result = restoreConfigIntoDraft({ config: { output_name: 'imported' } })
    expect(result.ok).toBe(true)
    expect(draftOf('sdxl-lora').output_name).toBe('imported')
  })

  test('a successful switch proceeds exactly as before', () => {
    const result = restoreConfigIntoDraft({
      config: { output_name: 'restored' },
      typeCandidates: ['anima-lora'],
    })
    expect(result.ok).toBe(true)
    expect(useTrainConfigStore.getState().typeId).toBe('anima-lora')
    expect(draftOf('anima-lora').output_name).toBe('restored')
  })
})

describe('applyConfigBag: a refused switch is reported as type_blocked', () => {
  test('the bag is rejected rather than degraded into the current type', async () => {
    const { applyConfigBagWithMeta } = await import('@/lib/applyConfigBag')
    const before = { ...draftOf('sdxl-lora') }
    mocks.setTypeShouldFail.value = true

    const result = applyConfigBagWithMeta({
      ok: true,
      schemaId: 'anima-lora',
      config: { network_dim: 128 },
    })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('type_blocked')
    expect(result.typeId).toBeNull()
    expect(draftOf('sdxl-lora')).toEqual(before)
  })
})
