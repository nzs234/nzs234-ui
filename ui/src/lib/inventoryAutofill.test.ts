// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * inventory 自动填充：缓存/单飞 + 「不覆盖用户输入」的二次确认。
 *
 * 这层唯一会造成真实损失的分支是 autofillEmptyModelPaths 里那次「再读一遍草稿」：
 * 扫描是异步的，用户完全可能在请求飞行途中手填了路径；少了那次复核就会把他刚
 * 输入的路径覆盖掉(不可逆，用户还不会立刻发现)。缓存/单飞分支的失效则表现为
 * 每次聚焦输入框都重新扫一遍全盘。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listLocalResources: vi.fn(),
}))

vi.mock('@/api/resourceApi', () => ({
  resourceApi: { listLocalResources: mocks.listLocalResources },
}))

const {
  autofillEmptyModelPaths,
  candidatesForField,
  countCandidatesForField,
  loadInventoryItems,
} = await import('./inventoryAutofill')
const { useTrainConfigStore, __resetTrainDraftRuntimeState } = await import('@/stores/configStore')
const { createDefaultConfig } = await import('@/schema/schemaIndex.js')

/** 一个 sdxl 底模候选：足以让 pretrained_model_name_or_path 唯一命中。 */
function sdxlBase(path = 'D:/models/sdxl-base.safetensors') {
  return {
    path,
    name: path.split('/').pop(),
    model_family: 'sdxl',
    artifact_kind: 'checkpoint',
    size: 6_000_000_000,
    modified_at: '2026-01-01',
    tags: [],
  }
}

function setDraft(typeId: string, patch: Record<string, unknown> = {}) {
  useTrainConfigStore.setState({
    typeId,
    drafts: { [typeId]: { ...(createDefaultConfig(typeId) as Record<string, unknown>), ...patch } },
  })
}

/** loadInventoryItems 的模块级缓存跨用例存活；每个用例先把它冲掉。 */
async function resetInventoryCache() {
  mocks.listLocalResources.mockResolvedValue({ items: [] })
  await loadInventoryItems({ refresh: true })
  mocks.listLocalResources.mockReset()
}

beforeEach(async () => {
  localStorage.clear()
  __resetTrainDraftRuntimeState()
  await resetInventoryCache()
  setDraft('sdxl-lora')
})

// ─── loadInventoryItems ─────────────────────────────────────────────────────

describe('inventoryAutofill: loadInventoryItems', () => {
  test('首次调用拉取并归一化 items', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase(), { path: '' }] })
    const items = await loadInventoryItems({ refresh: true })
    // 缺 path 的行在 normalizeResourceItems 里被丢掉。
    expect(items.map((i) => i.path)).toEqual(['D:/models/sdxl-base.safetensors'])
    expect(mocks.listLocalResources).toHaveBeenCalledWith({ limit: 1000, refresh: true })
  })

  test('TTL 内复用缓存，不重复请求', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    await loadInventoryItems({ refresh: true })
    await loadInventoryItems()
    await loadInventoryItems()
    expect(mocks.listLocalResources).toHaveBeenCalledTimes(1)
  })

  test('refresh:true 强制穿透缓存', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    await loadInventoryItems({ refresh: true })
    await loadInventoryItems({ refresh: true })
    expect(mocks.listLocalResources).toHaveBeenCalledTimes(2)
  })

  test('并发调用共享同一次飞行请求（单飞）', async () => {
    // 注意顺序：缓存判定在单飞判定之前，所以必须先让 TTL 过期，
    // 两次无 refresh 的调用才会真的落到同一个 inflight 上。
    let release: (value: unknown) => void = () => {}
    mocks.listLocalResources.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const nowSpy = vi.spyOn(Date, 'now')
    try {
      nowSpy.mockReturnValue(Date.now() + 25_000)
      const a = loadInventoryItems()
      const b = loadInventoryItems()
      release({ items: [sdxlBase()] })
      const [ra, rb] = await Promise.all([a, b])
      expect(mocks.listLocalResources).toHaveBeenCalledTimes(1)
      expect(rb).toBe(ra)
      expect(ra.map((i) => i.path)).toEqual(['D:/models/sdxl-base.safetensors'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  test('TTL 过期后重新拉取', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    await loadInventoryItems({ refresh: true })
    const nowSpy = vi.spyOn(Date, 'now')
    try {
      nowSpy.mockReturnValue(Date.now() + 25_000)
      await loadInventoryItems()
    } finally {
      nowSpy.mockRestore()
    }
    expect(mocks.listLocalResources).toHaveBeenCalledTimes(2)
  })

  test('信封响应经 unwrap 拆包', async () => {
    mocks.listLocalResources.mockResolvedValue({ status: 'success', data: { items: [sdxlBase()] } })
    expect(await loadInventoryItems({ refresh: true })).toHaveLength(1)
  })

  test('items 不是数组时退化成空列表，不抛', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: 'nope' })
    expect(await loadInventoryItems({ refresh: true })).toEqual([])
  })

  test('请求失败时回落到上一次缓存而不是清空', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    await loadInventoryItems({ refresh: true })
    mocks.listLocalResources.mockRejectedValue(new Error('backend down'))
    const items = await loadInventoryItems({ refresh: true })
    expect(items.map((i) => i.path)).toEqual(['D:/models/sdxl-base.safetensors'])
  })

  test('从未成功过且请求失败 → 空列表', async () => {
    mocks.listLocalResources.mockRejectedValue(new Error('backend down'))
    await expect(loadInventoryItems({ refresh: true })).resolves.toEqual([])
  })
})

// ─── autofillEmptyModelPaths ────────────────────────────────────────────────

describe('inventoryAutofill: autofillEmptyModelPaths', () => {
  const draftOf = () => useTrainConfigStore.getState().drafts['sdxl-lora'] ?? {}

  test('空底模位被唯一候选填上，并计入返回值', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: '' })
    const n = await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().pretrained_model_name_or_path).toBe('D:/models/sdxl-base.safetensors')
    expect(n).toBeGreaterThanOrEqual(1)
  })

  test('inventory 为空时直接返回 0，不动草稿', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [] })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: '' })
    expect(await autofillEmptyModelPaths({ refresh: true })).toBe(0)
    expect(draftOf().pretrained_model_name_or_path).toBe('')
  })

  test('用户已填的真实路径不被覆盖', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: 'D:/mine/chosen.safetensors' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().pretrained_model_name_or_path).toBe('D:/mine/chosen.safetensors')
  })

  test('占位默认值被视为空并覆盖', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: './sd-models/model.safetensors' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().pretrained_model_name_or_path).toBe('D:/models/sdxl-base.safetensors')
  })

  test('扫描飞行期间用户手填 → 复核后放弃覆盖', async () => {
    // 这是本模块最贵的一条分支：少了 autofillEmptyModelPaths 里那次重新 getState
    // 就会把用户刚输入的路径抹掉。
    let release: (value: unknown) => void = () => {}
    mocks.listLocalResources.mockReturnValue(new Promise((resolve) => { release = resolve }))
    setDraft('sdxl-lora', { pretrained_model_name_or_path: '' })
    const pending = autofillEmptyModelPaths({ refresh: true })
    useTrainConfigStore.getState().setValue('pretrained_model_name_or_path', 'D:/typed/by-user.safetensors')
    release({ items: [sdxlBase()] })
    await pending
    expect(draftOf().pretrained_model_name_or_path).toBe('D:/typed/by-user.safetensors')
  })

  test('异族候选不会填进底模位（family 门禁在 schema 之外再兜一层）', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: [{ ...sdxlBase('D:/models/flux-base.safetensors'), model_family: 'flux' }],
    })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: '' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().pretrained_model_name_or_path).toBe('')
  })

  test('多候选时不填（只在 UI 里列出来）', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: [sdxlBase('D:/models/a.safetensors'), sdxlBase('D:/models/b.safetensors')],
    })
    setDraft('sdxl-lora', { pretrained_model_name_or_path: '' })
    expect(await autofillEmptyModelPaths({ refresh: true })).toBe(0)
    expect(draftOf().pretrained_model_name_or_path).toBe('')
  })

  test('VAE 位不会被 checkpoint 顶上（角色过滤生效）', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', { vae: '' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().vae).toBe('')
  })

  test('唯一 VAE 候选填进 vae 位', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: [{ ...sdxlBase('D:/vae/sdxl-vae.safetensors'), artifact_kind: 'vae', size: 300_000_000 }],
    })
    setDraft('sdxl-lora', { vae: '' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().vae).toBe('D:/vae/sdxl-vae.safetensors')
  })

  test('network_weights 即使为空也不自动填', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: [{ ...sdxlBase('D:/loras/only.safetensors'), artifact_kind: 'lora', size: 100_000_000 }],
    })
    setDraft('sdxl-lora', { network_weights: '' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().network_weights).toBe('')
  })

  test('type=file 的 text-file 字段不会被模型权重填上', async () => {
    // modelFileFields 收集端与 applyUniqueAutofill 双重防线:
    // pickerType 为 'text-file' 的 LUT/manifest 路径不是模型权重输入,
    // 唯一候选的 .safetensors 底模不得被写进这类 JSON 路径字段。
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', { timestep_weighting_lut_path: '' })
    await autofillEmptyModelPaths({ refresh: true })
    expect(draftOf().timestep_weighting_lut_path).toBe('')
  })

  test('text-file 字段为空时不计入自动填数量', async () => {
    // 修复前:sdxl-lora 草稿这些字段为空 + inventory 只有一个 sdxl
    // checkpoint → autofillEmptyModelPaths() 返回 4(把底模写进 4 个
    // LUT/JSON 字段);修复后只填主模,返回 1。
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    setDraft('sdxl-lora', {
      pretrained_model_name_or_path: '',
      timestep_weighting_lut_path: '',
      dataset_intelligence_manifest_path: '',
      sample_difficulty_metadata_path: '',
      adaptive_rank_profile_path: '',
    })
    const n = await autofillEmptyModelPaths({ refresh: true })
    expect(n).toBe(1)
    expect(draftOf().pretrained_model_name_or_path).toBe('D:/models/sdxl-base.safetensors')
    expect(draftOf().timestep_weighting_lut_path).toBe('')
    expect(draftOf().dataset_intelligence_manifest_path).toBe('')
    expect(draftOf().sample_difficulty_metadata_path).toBe('')
    expect(draftOf().adaptive_rank_profile_path).toBe('')
  })

  test('当前 type 没有草稿时按空草稿处理，不抛', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    useTrainConfigStore.setState({ typeId: 'sdxl-lora', drafts: {} })
    await expect(autofillEmptyModelPaths({ refresh: true })).resolves.toBeGreaterThanOrEqual(0)
  })
})

// ─── 候选查询 ───────────────────────────────────────────────────────────────

describe('inventoryAutofill: candidatesForField / countCandidatesForField', () => {
  test('candidatesForField 返回该字段的候选列表', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    const hits = await candidatesForField('sdxl-lora', 'pretrained_model_name_or_path', { refresh: true })
    expect(hits.map((i) => i.path)).toEqual(['D:/models/sdxl-base.safetensors'])
  })

  test('角色不匹配的字段返回空列表', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    expect(await candidatesForField('sdxl-lora', 'network_weights', { refresh: true })).toEqual([])
  })

  test('candidatesForField 上限 12', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => sdxlBase(`D:/models/m${i}.safetensors`)),
    })
    expect(await candidatesForField('sdxl-lora', 'pretrained_model_name_or_path', { refresh: true })).toHaveLength(12)
  })

  test('countCandidatesForField 上限拉到 50，不被 12 截断', async () => {
    mocks.listLocalResources.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => sdxlBase(`D:/models/m${i}.safetensors`)),
    })
    expect(await countCandidatesForField('sdxl-lora', 'pretrained_model_name_or_path', { refresh: true })).toBe(20)
  })

  test('两个查询都复用同一份 inventory 缓存', async () => {
    mocks.listLocalResources.mockResolvedValue({ items: [sdxlBase()] })
    await candidatesForField('sdxl-lora', 'pretrained_model_name_or_path', { refresh: true })
    await countCandidatesForField('sdxl-lora', 'pretrained_model_name_or_path')
    expect(mocks.listLocalResources).toHaveBeenCalledTimes(1)
  })
})
