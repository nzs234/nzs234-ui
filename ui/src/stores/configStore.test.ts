// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * configStore 契约门禁：per-type 草稿隔离、schema 归一、磁盘 hydrate merge、
 * hydrate 重试、草稿清理。
 *
 * 这些行为决定"用户上次填的东西还在不在"，出错的表现是静默数据丢失，
 * 靠 UI 冒烟测试几乎发现不了，所以在 store 层直接钉住。
 *
 * 标记为 CONTRACT 的用例描述目标契约；未满足时用例失败并在注释中说明，
 * 不下调断言。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '@/schema/schemaIndex.js'

const mocks = vi.hoisted(() => ({
  loadTrainDrafts: vi.fn(),
  saveTrainDrafts: vi.fn(),
  clearTrainDrafts: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const {
  useTrainConfigStore,
  hydrateTrainDraftsFromDisk,
  retryTrainDraftsHydration,
  flushTrainDraftsToDisk,
  clearCurrentTypeDraftOnDisk,
  normalizeDraftForType,
  isDraftKeyAllowedForType,
  getDraftHydrationStatus,
  __resetTrainDraftRuntimeState,
} = await import('@/stores/configStore')

const LS_KEY = 'lx-train-drafts-v1'

type Bag = Record<string, unknown>

function seed(typeId: string, drafts: Record<string, Bag>) {
  useTrainConfigStore.setState({
    typeId,
    drafts,
    schemaRev: 0,
    diskHydrated: false,
    hydrationStatus: 'idle',
    hydrationError: null,
  })
}

function readLs(): { typeId?: string; updated_at?: number; drafts?: Record<string, Bag> } {
  return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
}

function writeLs(payload: { typeId?: string; updated_at?: number; drafts?: Record<string, Bag> }) {
  localStorage.setItem(LS_KEY, JSON.stringify(payload))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // hydrate 单飞状态 / locallyEditedTypes / typeSelectedLocally 都在模块级，
  // 不重置会让用例之间互相"记住"上一次的本地编辑而跳过磁盘 merge。
  __resetTrainDraftRuntimeState()
  mocks.saveTrainDrafts.mockResolvedValue({})
  mocks.clearTrainDrafts.mockResolvedValue({})
  mocks.loadTrainDrafts.mockResolvedValue({})
  seed('anima-lora', { 'anima-lora': createDefaultConfig('anima-lora') as Bag })
})

// ─── draft creation / schema normalization ───────────────────────────────────

describe('configStore: draft creation', () => {
  test('a new type lazily materializes a full schema-default draft', () => {
    useTrainConfigStore.getState().setType('sdxl-lora')
    const state = useTrainConfigStore.getState()
    expect(state.typeId).toBe('sdxl-lora')
    expect(state.drafts['sdxl-lora']).toEqual(createDefaultConfig('sdxl-lora'))
  })

  test('switching back to an existing type does not rebuild its draft', () => {
    const store = useTrainConfigStore.getState()
    store.setValue('network_dim', 64)
    store.setType('sdxl-lora')
    useTrainConfigStore.getState().setType('anima-lora')
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(64)
  })

  test('saved values override schema defaults while new schema keys still appear', () => {
    useTrainConfigStore.getState().replaceDraft({ network_dim: 8 })
    const draft = useTrainConfigStore.getState().drafts['anima-lora']
    expect(draft.network_dim).toBe(8)
    // schema 新增字段必须补默认值，否则老草稿加载后新字段是 undefined。
    const defaults = createDefaultConfig('anima-lora') as Bag
    for (const key of Object.keys(defaults)) {
      if (key === 'network_dim') continue
      expect(draft, key).toHaveProperty(key)
    }
  })

  test('legacy string quant_train_mode is normalized to a boolean', () => {
    const store = useTrainConfigStore.getState()
    // 老草稿存的是下拉字符串；直接 Boolean('dequant') 会误判成开启。
    store.replaceDraft({ quant_train_mode: 'keep_w8' })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].quant_train_mode).toBe(true)
    useTrainConfigStore.getState().replaceDraft({ quant_train_mode: 'dequant' })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].quant_train_mode).toBe(false)
    useTrainConfigStore.getState().replaceDraft({ quant_train_mode: 'KEEP_W8' })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].quant_train_mode).toBe(true)
  })

  test('legacy Chinese-label pissa_export_mode values migrate to backend enums at the draft layer', () => {
    // sdxl schema 曾把中文 label 当 value；枚举化后旧草稿在加载时迁移，
    // 提交层不再保留第二份映射。sdxl-lora 的 schema 定义了 pissa_export_mode。
    const migrated = normalizeDraftForType('sdxl-lora', { pissa_export_mode: 'LoRA无损兼容导出' })
    expect(migrated.draft.pissa_export_mode).toBe('lora_compatible')
    expect(normalizeDraftForType('sdxl-lora', { pissa_export_mode: 'LoRA快速近似导出' }).draft.pissa_export_mode).toBe('approximate')
    expect(normalizeDraftForType('sdxl-lora', { pissa_export_mode: 'raw' }).draft.pissa_export_mode).toBe('raw')
  })

  test('setType ignores an empty type id', () => {
    useTrainConfigStore.getState().setType('')
    expect(useTrainConfigStore.getState().typeId).toBe('anima-lora')
  })

  test('setType rejects a type with no schema instead of showing an empty form', () => {
    // 未注册类型 createDefaultConfig 返回 {}；切过去 UI 渲染 0 字段，
    // 随后 debounce 写盘还会把这个空 bag 持久化，覆盖真实草稿。
    seed('anima-lora', { 'anima-lora': createDefaultConfig('anima-lora') as Bag })
    useTrainConfigStore.getState().setType('totally-bogus-type')
    const state = useTrainConfigStore.getState()
    expect(state.typeId).toBe('anima-lora')
    expect(state.drafts).not.toHaveProperty('totally-bogus-type')
  })

  test('hidden legacy types with a real schema are still selectable (expert restore path)', () => {
    useTrainConfigStore.getState().setType('sdxl-ileco')
    const state = useTrainConfigStore.getState()
    expect(state.typeId).toBe('sdxl-ileco')
    expect(Object.keys(state.drafts['sdxl-ileco']).length).toBeGreaterThan(10)
  })
})

// ─── per-type isolation ──────────────────────────────────────────────────────

describe('configStore: per-type isolation', () => {
  beforeEach(() => {
    seed('sdxl-lora', {
      'sdxl-lora': createDefaultConfig('sdxl-lora') as Bag,
      'anima-lora': { ...(createDefaultConfig('anima-lora') as Bag), network_dim: 77 },
    })
  })

  test('setValue only touches the active type', () => {
    useTrainConfigStore.getState().setValue('network_dim', 64)
    const { drafts } = useTrainConfigStore.getState()
    expect(drafts['sdxl-lora'].network_dim).toBe(64)
    expect(drafts['anima-lora'].network_dim).toBe(77)
  })

  test('setValue coerces via the schema field definition', () => {
    const store = useTrainConfigStore.getState()
    store.setValue('network_dim', '64')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(64)
    useTrainConfigStore.getState().setValue('network_dim', '')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe('')
    useTrainConfigStore.getState().setValue('network_dim', 'abc')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe('')
    useTrainConfigStore.getState().setValue('enable_bucket', 'truthy')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].enable_bucket).toBe(true)
  })

  test('unknown keys are stored verbatim so imported bags are not silently dropped', () => {
    useTrainConfigStore.getState().setValue('some_backend_only_key', 'raw-value')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].some_backend_only_key).toBe('raw-value')
  })

  test('applyValues normalizes every entry and leaves other types alone', () => {
    useTrainConfigStore.getState().applyValues({ network_dim: '32', network_alpha: '8', train_data_dir: '/d' })
    const { drafts } = useTrainConfigStore.getState()
    expect(drafts['sdxl-lora'].network_dim).toBe(32)
    expect(drafts['sdxl-lora'].network_alpha).toBe(8)
    expect(drafts['sdxl-lora'].train_data_dir).toBe('/d')
    expect(drafts['anima-lora'].network_dim).toBe(77)
  })

  test('applyValues tolerates null/undefined input', () => {
    const before = useTrainConfigStore.getState().drafts['sdxl-lora']
    useTrainConfigStore.getState().applyValues(undefined as never)
    expect(useTrainConfigStore.getState().drafts['sdxl-lora']).toEqual(before)
  })

  test('replaceDraft rebases on schema defaults, clearing stale keys of the same type', () => {
    useTrainConfigStore.getState().applyValues({ output_name: 'custom', network_dim: 128 })
    useTrainConfigStore.getState().replaceDraft({ network_dim: 8 })
    const draft = useTrainConfigStore.getState().drafts['sdxl-lora']
    expect(draft.network_dim).toBe(8)
    // 未出现在新 bag 里的键回到 schema 默认，而不是保留上一份草稿的残值。
    expect(draft.output_name).toBe((createDefaultConfig('sdxl-lora') as Bag).output_name)
  })

  test('replaceDraft never leaks into another type', () => {
    useTrainConfigStore.getState().replaceDraft({ network_dim: 8 })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(77)
  })

  test('resetDraft restores exactly the schema defaults for the active type only', () => {
    useTrainConfigStore.getState().applyValues({ network_dim: 128, output_name: 'x' })
    useTrainConfigStore.getState().resetDraft()
    const { drafts } = useTrainConfigStore.getState()
    expect(drafts['sdxl-lora']).toEqual(createDefaultConfig('sdxl-lora'))
    expect(drafts['anima-lora'].network_dim).toBe(77)
  })

  test('bumpSchemaRev is monotonic and does not disturb drafts', () => {
    const before = useTrainConfigStore.getState().drafts
    useTrainConfigStore.getState().bumpSchemaRev()
    useTrainConfigStore.getState().bumpSchemaRev()
    expect(useTrainConfigStore.getState().schemaRev).toBe(2)
    expect(useTrainConfigStore.getState().drafts).toBe(before)
  })
})

// ─── disk hydrate merge ──────────────────────────────────────────────────────

describe('configStore: mergeDiskDrafts', () => {
  test('a newer disk payload overwrites untouched types', () => {
    writeLs({ typeId: 'anima-lora', updated_at: 100, drafts: { 'anima-lora': { network_dim: 1 } } })
    seed('anima-lora', { 'anima-lora': { ...(createDefaultConfig('anima-lora') as Bag), network_dim: 1 } })

    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: 999,
      drafts: { 'anima-lora': { network_dim: 5 }, 'sdxl-lora': { network_dim: 7 } },
    })

    const state = useTrainConfigStore.getState()
    expect(state.drafts['anima-lora'].network_dim).toBe(5)
    expect(state.drafts['sdxl-lora'].network_dim).toBe(7)
  })

  test('an edit made during the hydrate window beats the late disk response', () => {
    // hydrate 是异步的，别的页面随时可能写草稿。磁盘响应晚到不代表它更新：
    // 用户刚填的值不能被几百毫秒后落地的 merge 吞掉。
    useTrainConfigStore.setState({ hydrationStatus: 'pending' })
    useTrainConfigStore.getState().setValue('network_dim', 99)
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: Date.now() + 60_000,
      drafts: { 'anima-lora': { network_dim: 5 } },
    })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(99)
  })

  test('outside the hydrate window the timestamp contract still rules', () => {
    // 该保护只在 hydrate 窗口内生效；窗口外仍严格按 updated_at 裁决，
    // 否则等于悄悄改了持久化层的既有口径。
    // LS 写入是 debounce 的，这里直接写 LS 以模拟"已经落过盘"的本地状态。
    useTrainConfigStore.getState().setValue('network_dim', 99)
    writeLs({ typeId: 'anima-lora', updated_at: 1000, drafts: { 'anima-lora': { network_dim: 99 } } })
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: 2000,
      drafts: { 'anima-lora': { network_dim: 5 } },
    })
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(5)
  })

  test('a type chosen during the hydrate window is not overridden by the disk typeId', () => {
    useTrainConfigStore.setState({ hydrationStatus: 'pending' })
    useTrainConfigStore.getState().setType('sdxl-lora')
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'anima-lora',
      updated_at: Date.now(),
      drafts: { 'anima-lora': { network_dim: 5 } },
    })
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
  })

  test('the disk typeId is adopted when nothing was chosen during hydration', () => {
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'sdxl-lora',
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': { network_dim: 7 } },
    })
    expect(useTrainConfigStore.getState().typeId).toBe('sdxl-lora')
  })

  test('a disk typeId pointing at a retired schema is not adopted', () => {
    // 磁盘上的 typeId 可能指向已下线的 schema：切过去 UI 就是 0 字段的空壳。
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'retired-legacy-type',
      updated_at: Date.now(),
      drafts: { 'retired-legacy-type': { network_dim: 3 }, 'sdxl-lora': { network_dim: 7 } },
    })
    const state = useTrainConfigStore.getState()
    expect(state.typeId).toBe('anima-lora')
    expect(Object.keys(state.drafts[state.typeId] ?? {}).length).toBeGreaterThan(1)
  })

  test('an older disk payload keeps local values but still absorbs types LS never had', () => {
    writeLs({ typeId: 'anima-lora', updated_at: 9999, drafts: { 'anima-lora': { network_dim: 42 } } })
    seed('anima-lora', { 'anima-lora': { ...(createDefaultConfig('anima-lora') as Bag), network_dim: 42 } })

    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'sdxl-lora',
      updated_at: 1,
      drafts: { 'anima-lora': { network_dim: 1 }, 'sdxl-lora': { network_dim: 5 } },
    })

    const state = useTrainConfigStore.getState()
    // 本地较新 → 不换 type，也不覆盖同名 type 的值。
    expect(state.typeId).toBe('anima-lora')
    expect(state.drafts['anima-lora'].network_dim).toBe(42)
    // 但 LS 里根本没有的 type 应该被吸收，避免磁盘草稿凭空消失。
    expect(state.drafts['sdxl-lora'].network_dim).toBe(5)
  })

  test('disk drafts merge into schema defaults rather than replacing the whole bag', () => {
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': { network_dim: 7 } },
    })
    const draft = useTrainConfigStore.getState().drafts['sdxl-lora']
    expect(draft.network_dim).toBe(7)
    expect(Object.keys(draft).length).toBeGreaterThan(10)
  })

  test('a missing/invalid drafts map is a no-op', () => {
    const before = useTrainConfigStore.getState().drafts
    useTrainConfigStore.getState().mergeDiskDrafts({ version: 1, updated_at: Date.now() })
    expect(useTrainConfigStore.getState().drafts).toBe(before)
    useTrainConfigStore.getState().mergeDiskDrafts({ drafts: 'nope' as never })
    expect(useTrainConfigStore.getState().drafts).toBe(before)
  })

  test('non-object per-type entries are skipped instead of poisoning the draft', () => {
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': null as never, 'anima-lora': { network_dim: 3 } },
    })
    const state = useTrainConfigStore.getState()
    expect(state.drafts['anima-lora'].network_dim).toBe(3)
    expect(state.drafts['sdxl-lora']).toBeUndefined()
  })

  test('a disk typeId with no draft anywhere does not switch the active type', () => {
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'sdxl-lora',
      updated_at: Date.now(),
      drafts: { 'anima-lora': { network_dim: 3 } },
    })
    // payload.typeId 在 drafts 里没有对应 bag → 保持当前类型。
    expect(useTrainConfigStore.getState().typeId).toBe('anima-lora')
  })

  test('a newer merge writes the result straight back to localStorage', () => {
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      typeId: 'sdxl-lora',
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': { network_dim: 11 } },
    })
    const persisted = readLs()
    expect(persisted.typeId).toBe('sdxl-lora')
    expect(persisted.drafts?.['sdxl-lora']?.network_dim).toBe(11)
  })

  test('foreign-schema keys from a disk bag are dropped for the target type', () => {
    // 磁盘上可能存着别的训练族字段；留在草稿里会污染 visibleWhen 判定。
    useTrainConfigStore.getState().mergeDiskDrafts({
      version: 1,
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': { network_dim: 7, alpha_self_attn: 32 } },
    })
    const draft = useTrainConfigStore.getState().drafts['sdxl-lora']
    expect(draft.network_dim).toBe(7)
    expect(draft).not.toHaveProperty('alpha_self_attn')
  })
})

// ─── draft key normalization ─────────────────────────────────────────────────

describe('configStore: normalizeDraftForType', () => {
  test('foreign keys are reported as dropped rather than silently kept', () => {
    const { draft, droppedKeys } = normalizeDraftForType('sdxl-lora', {
      network_dim: 8,
      alpha_self_attn: 32,
      totally_made_up_key: 1,
    })
    expect(draft.network_dim).toBe(8)
    expect(droppedKeys).toEqual(expect.arrayContaining(['alpha_self_attn', 'totally_made_up_key']))
    expect(draft).not.toHaveProperty('alpha_self_attn')
  })

  test('underscore-prefixed UI state is always preserved', () => {
    const { draft, droppedKeys } = normalizeDraftForType('sdxl-lora', { _uiScroll: 120 })
    expect(draft._uiScroll).toBe(120)
    expect(droppedKeys).not.toContain('_uiScroll')
  })

  test.each([
    'semantic_region_weighting_enabled',
    'semantic_segmentation_provider',
    'semantic_segmentation_model_path',
    'anima_attn_mode',
  ])('non-schema key %s survives because runtime code still reads it', (key) => {
    // 这些键不是 schema 字段，但 runConfigBuilder / isFieldVisible 会读；
    // 清掉等于悄悄改了运行配置规则。
    const { draft, droppedKeys } = normalizeDraftForType('sdxl-lora', { [key]: 'value' })
    expect(draft[key]).toBe('value')
    expect(droppedKeys).not.toContain(key)
    expect(isDraftKeyAllowedForType('sdxl-lora', key)).toBe(true)
  })

  test('boolean fields coerce legacy string flags by semantics, not JS truthiness', () => {
    for (const truthy of ['true', 'True', '1', 'yes', 'on', true, 1]) {
      const { draft } = normalizeDraftForType('sdxl-lora', { enable_bucket: truthy })
      expect(draft.enable_bucket, String(truthy)).toBe(true)
    }
    for (const falsy of ['false', 'off', 'no', '0', '', 'garbage', false]) {
      const { draft } = normalizeDraftForType('sdxl-lora', { enable_bucket: falsy })
      expect(draft.enable_bucket, String(falsy)).toBe(false)
    }
  })

  test('legacy quant_train_mode strings map to the right boolean', () => {
    // 该字段只存在于 anima-lora 的 schema 里；在别的类型上它是外来键，会被丢弃。
    for (const on of ['keep_w8', 'keepw8', 'keep-w8', 'KEEP_W8', 'true', '1']) {
      expect(normalizeDraftForType('anima-lora', { quant_train_mode: on }).draft.quant_train_mode, on).toBe(true)
    }
    for (const off of ['dequant', 'off', 'none', 'false', '0', '']) {
      expect(normalizeDraftForType('anima-lora', { quant_train_mode: off }).draft.quant_train_mode, off).toBe(false)
    }
    expect(normalizeDraftForType('sdxl-lora', { quant_train_mode: 'keep_w8' }).droppedKeys)
      .toContain('quant_train_mode')
  })

  test('number fields are NOT coerced at the draft layer (buildRunConfig owns that)', () => {
    // 草稿层多做一次 Number() 会改变 payload 里出现哪些键。
    const { draft } = normalizeDraftForType('sdxl-lora', { network_dim: '64' })
    expect(draft.network_dim).toBe('64')
  })

  test('a schema-less legacy type keeps its raw record instead of being emptied', () => {
    const { draft, droppedKeys } = normalizeDraftForType('retired-legacy-type', { anything: 1, other: 2 })
    // 没有"属于它的字段"这个概念时，清理就等于清空。
    expect(draft).toMatchObject({ anything: 1, other: 2 })
    expect(droppedKeys).toEqual([])
  })

  test('isDraftKeyAllowedForType rejects empty and foreign keys', () => {
    expect(isDraftKeyAllowedForType('sdxl-lora', '')).toBe(false)
    expect(isDraftKeyAllowedForType('sdxl-lora', 'alpha_self_attn')).toBe(false)
    expect(isDraftKeyAllowedForType('sdxl-lora', 'network_dim')).toBe(true)
    expect(isDraftKeyAllowedForType('anima-lora', 'alpha_self_attn')).toBe(true)
  })
})

// ─── hydrate / retry ─────────────────────────────────────────────────────────

describe('configStore: hydrateTrainDraftsFromDisk', () => {
  test('a success envelope is unwrapped and merged, reporting the merged type count', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { typeId: 'sdxl-lora', updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 33 } } },
    })
    const outcome = await hydrateTrainDraftsFromDisk()
    expect(outcome).toMatchObject({ status: 'ready', mergedTypes: 1 })
    const state = useTrainConfigStore.getState()
    expect(state.typeId).toBe('sdxl-lora')
    expect(state.drafts['sdxl-lora'].network_dim).toBe(33)
    expect(state.diskHydrated).toBe(true)
    expect(state.hydrationStatus).toBe('ready')
  })

  test('a bare (non-envelope) payload is accepted too', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({
      typeId: 'sdxl-lora',
      updated_at: Date.now(),
      drafts: { 'sdxl-lora': { network_dim: 21 } },
    })
    await hydrateTrainDraftsFromDisk()
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(21)
  })

  test('a failure keeps drafts intact, reports failed, and still unblocks post-steps', async () => {
    const before = useTrainConfigStore.getState().drafts
    mocks.loadTrainDrafts.mockRejectedValue(new Error('backend down'))
    const outcome = await hydrateTrainDraftsFromDisk()
    expect(outcome).toMatchObject({ status: 'failed', mergedTypes: 0 })
    expect(outcome.error).toContain('backend down')
    const state = useTrainConfigStore.getState()
    expect(state.drafts).toBe(before)
    // diskHydrated 仍要置 true，否则依赖它的 autofill / LAST seed 永久卡住；
    // 但 hydrationStatus 必须是 failed，这样调用方知道可以重试。
    expect(state.diskHydrated).toBe(true)
    expect(state.hydrationStatus).toBe('failed')
    expect(state.hydrationError).toContain('backend down')
  })

  test('a business-error envelope is treated as a failure, not merged', async () => {
    const before = useTrainConfigStore.getState().drafts
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'error', message: 'nope', code: 'E_X' })
    const outcome = await hydrateTrainDraftsFromDisk()
    expect(outcome.status).toBe('failed')
    expect(useTrainConfigStore.getState().drafts).toBe(before)
  })

  test('a failed hydration stays retryable and the retry merges', async () => {
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('backend down'))
    expect((await hydrateTrainDraftsFromDisk()).status).toBe('failed')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora']).toBeUndefined()

    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { typeId: 'sdxl-lora', updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 44 } } },
    })
    expect((await hydrateTrainDraftsFromDisk()).status).toBe('ready')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(44)
  })

  test('retryTrainDraftsHydration re-requests after a failure', async () => {
    mocks.loadTrainDrafts.mockRejectedValueOnce(new Error('down'))
    await hydrateTrainDraftsFromDisk()
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 51 } } },
    })
    expect((await retryTrainDraftsHydration()).status).toBe('ready')
    expect(useTrainConfigStore.getState().drafts['sdxl-lora'].network_dim).toBe(51)
  })

  test('a successful hydration is not repeated on later calls', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { updated_at: 1, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    await hydrateTrainDraftsFromDisk()
    await retryTrainDraftsHydration()
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)
  })

  test('force re-requests even after success', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { updated_at: 1, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    await hydrateTrainDraftsFromDisk({ force: true })
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(2)
  })

  test('concurrent calls share a single in-flight request', async () => {
    let release: (value: unknown) => void = () => {}
    mocks.loadTrainDrafts.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const a = hydrateTrainDraftsFromDisk()
    const b = hydrateTrainDraftsFromDisk()
    release({ status: 'success', data: { updated_at: 1, drafts: {} } })
    await Promise.all([a, b])
    expect(mocks.loadTrainDrafts).toHaveBeenCalledTimes(1)
  })

  test('hydration does not echo the merged state straight back to disk', async () => {
    mocks.loadTrainDrafts.mockResolvedValue({
      status: 'success',
      data: { typeId: 'sdxl-lora', updated_at: Date.now(), drafts: { 'sdxl-lora': { network_dim: 33 } } },
    })
    await hydrateTrainDraftsFromDisk()
    // 抑制回写是必需的：此刻内存里是"LS + 尚未合入磁盘"的半成品，
    // 写回去会把磁盘上更全的 per-type bag 抹掉。
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
  })

  test('getDraftHydrationStatus tracks the lifecycle', async () => {
    expect(getDraftHydrationStatus()).toBe('idle')
    mocks.loadTrainDrafts.mockResolvedValue({ status: 'success', data: { updated_at: 1, drafts: {} } })
    await hydrateTrainDraftsFromDisk()
    expect(getDraftHydrationStatus()).toBe('ready')
  })
})

// ─── flush / cleanup ─────────────────────────────────────────────────────────

describe('configStore: flush and draft cleanup', () => {
  beforeEach(() => {
    seed('sdxl-lora', {
      'sdxl-lora': { ...(createDefaultConfig('sdxl-lora') as Bag), network_dim: 99 },
      'anima-lora': { ...(createDefaultConfig('anima-lora') as Bag), network_dim: 77 },
    })
    writeLs({
      typeId: 'sdxl-lora',
      updated_at: 5,
      drafts: { 'sdxl-lora': { network_dim: 99 }, 'anima-lora': { network_dim: 77 } },
    })
  })

  test('flush writes both localStorage and disk immediately', async () => {
    await flushTrainDraftsToDisk()
    expect(mocks.saveTrainDrafts).toHaveBeenCalledTimes(1)
    const body = mocks.saveTrainDrafts.mock.calls[0][0]
    expect(body.typeId).toBe('sdxl-lora')
    expect(body.drafts['sdxl-lora'].network_dim).toBe(99)
    expect(body.version).toBe(1)
    expect(readLs().drafts?.['sdxl-lora']?.network_dim).toBe(99)
  })

  test('a flush failure propagates so the caller can surface it', async () => {
    mocks.saveTrainDrafts.mockRejectedValue(new Error('disk full'))
    await expect(flushTrainDraftsToDisk()).rejects.toThrow('disk full')
  })

  test('clearing the active type resets it to schema defaults and DELETEs only that type', async () => {
    await clearCurrentTypeDraftOnDisk()
    const state = useTrainConfigStore.getState()
    expect(state.drafts['sdxl-lora']).toEqual(createDefaultConfig('sdxl-lora'))
    // 其它类型的草稿必须原样保留。
    expect(state.drafts['anima-lora'].network_dim).toBe(77)
    expect(mocks.clearTrainDrafts).toHaveBeenCalledWith('sdxl-lora')
  })

  test('clearing rewrites localStorage so the next hydrate cannot resurrect the draft', async () => {
    await clearCurrentTypeDraftOnDisk()
    const persisted = readLs()
    expect(persisted.typeId).toBe('sdxl-lora')
    // 该 type 在 LS 里被替换成默认 bag(而不是保留 99)。
    expect(persisted.drafts?.['sdxl-lora']?.network_dim).toBe((createDefaultConfig('sdxl-lora') as Bag).network_dim)
    expect(persisted.drafts?.['anima-lora']?.network_dim).toBe(77)
  })

  test('clearing does not trigger a debounced disk write of the emptied bag', async () => {
    await clearCurrentTypeDraftOnDisk()
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
  })

  test('a failing DELETE still leaves the in-memory draft reset', async () => {
    mocks.clearTrainDrafts.mockRejectedValue(new Error('delete failed'))
    await expect(clearCurrentTypeDraftOnDisk()).rejects.toThrow('delete failed')
    // resetDraft 已经发生；不能因为网络失败而把 99 留在界面上。
    expect(useTrainConfigStore.getState().drafts['sdxl-lora']).toEqual(createDefaultConfig('sdxl-lora'))
  })
})

// ─── clear 与其它类型待写数据的竞态 ───────────────────────────────────────────

/**
 * clearCurrentTypeDraftOnDisk 会 clearTimeout(diskTimer) 并把
 * suppressDiskWriteDepth 抬起来。问题在于它同时清掉的是**全局**的那一个
 * debounce timer:如果此刻另一个 type 刚被编辑、写盘还挂在队列里，那笔编辑
 * 就一起被取消了。而 finally 里是 `deferredDiskWrite = false`，等于把
 * "还有东西要写" 这个事实也一并丢掉。
 *
 * 场景:改 anima-lora → 切到 sdxl-lora → 点「清空当前类型」。
 * anima-lora 的改动此后只活在内存和 LS 里，磁盘上永远拿不到。
 */
describe('configStore: clearing one type must not swallow another type pending write', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seed('sdxl-lora', {
      'sdxl-lora': createDefaultConfig('sdxl-lora') as Bag,
      'anima-lora': createDefaultConfig('anima-lora') as Bag,
    })
    useTrainConfigStore.setState({ diskHydrated: true, hydrationStatus: 'ready' })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  /** 编辑 anima-lora，然后切回 sdxl-lora，让 anima 的写盘还挂在 debounce 里。 */
  function editSiblingThenSwitchBack() {
    useTrainConfigStore.getState().setType('anima-lora')
    useTrainConfigStore.getState().setValue('network_dim', 77)
    useTrainConfigStore.getState().setType('sdxl-lora')
  }

  test('the sibling edit really is still pending before the clear', () => {
    editSiblingThenSwitchBack()
    expect(mocks.saveTrainDrafts).not.toHaveBeenCalled()
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(77)
  })

  test('the clear itself still resets only the active type in memory', async () => {
    editSiblingThenSwitchBack()
    vi.useRealTimers()
    await clearCurrentTypeDraftOnDisk()
    expect(useTrainConfigStore.getState().drafts['sdxl-lora']).toEqual(createDefaultConfig('sdxl-lora'))
    // 内存里的兄弟类型没被动过 —— 丢的只是写盘。
    expect(useTrainConfigStore.getState().drafts['anima-lora'].network_dim).toBe(77)
  })

  test('CONTRACT: the sibling type edit must still reach the disk after the clear', async () => {
    editSiblingThenSwitchBack()
    vi.useRealTimers()
    await clearCurrentTypeDraftOnDisk()
    vi.useFakeTimers()
    vi.advanceTimersByTime(5000)

    // 目标契约:clear 只该取消「被清掉那个 type」的写，别的 type 的编辑必须补写。
    expect(mocks.saveTrainDrafts).toHaveBeenCalled()
    const body = mocks.saveTrainDrafts.mock.calls.at(-1)?.[0]
    expect(body.drafts['anima-lora'].network_dim).toBe(77)
    // 同一笔写里，被清的 type 应该是默认值，而不是清空前的旧值。
    expect(body.drafts['sdxl-lora'].network_dim)
      .toBe((createDefaultConfig('sdxl-lora') as Bag).network_dim)
  })

  test('CONTRACT: the pending-write flag must not be cleared unconditionally', async () => {
    // 直接盯 deferredDiskWrite 的可观测后果:clear 之后再改一次别的 type，
    // 那笔改动必须能写出去。目前 finally 里的 `deferredDiskWrite = false`
    // 只丢掉 clear 之前积压的那一笔，所以这条用它的前一笔来定位问题。
    editSiblingThenSwitchBack()
    vi.useRealTimers()
    await clearCurrentTypeDraftOnDisk()
    vi.useFakeTimers()
    vi.advanceTimersByTime(5000)
    const wroteSibling = mocks.saveTrainDrafts.mock.calls.some(
      (call) => call[0]?.drafts?.['anima-lora']?.network_dim === 77,
    )
    expect(wroteSibling).toBe(true)
  })

  test('a later edit after the clear is still written normally', () => {
    // 这条不是 CONTRACT:抑制窗口在 finally 里已正确退栈，
    // 所以 clear 之后的新编辑不受影响。锁住它，免得未来修 bug 时把窗口关死。
    vi.useRealTimers()
    return clearCurrentTypeDraftOnDisk().then(() => {
      vi.useFakeTimers()
      useTrainConfigStore.getState().setValue('network_dim', 5)
      vi.advanceTimersByTime(5000)
      expect(mocks.saveTrainDrafts).toHaveBeenCalled()
      expect(mocks.saveTrainDrafts.mock.calls.at(-1)?.[0].drafts['sdxl-lora'].network_dim).toBe(5)
    })
  })

  test('localStorage keeps the sibling edit even though the disk write is lost', async () => {
    // LS 有自己的 debounce，clear 不碰它，所以刷新后改动还在。
    // 这正是这个 bug 难被发现的原因:只有换机器/换会话才会暴露。
    editSiblingThenSwitchBack()
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    await clearCurrentTypeDraftOnDisk()
    expect(readLs().drafts?.['anima-lora']?.network_dim).toBe(77)
  })
})
