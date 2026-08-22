// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 上次训练 / saved_params 恢复链契约门禁。
 *
 * 这条链决定「上次训练」按钮会不会把用户当前草稿冲掉，以及 resume offer 会不会
 * 把 weights_only 的运行说成可完整续训。两者都是不可逆的用户体验损失。
 *
 * isDraftNearDefault 是覆盖确认弹窗的唯一判据：判 true 就静默覆盖草稿。
 * 标记为 CONTRACT 的用例描述目标契约；未满足时用例失败并在注释中说明。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '@/schema/schemaIndex.js'

const mocks = vi.hoisted(() => ({
  lastTraining: vi.fn(),
  savedParams: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({ trainApi: mocks }))

const {
  extractFromLastTrainingPayload,
  extractFromSavedParamsPayload,
  fetchRestorableLastTraining,
  isDraftNearDefault,
} = await import('@/lib/lastTrainingRestore')

type Bag = Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── last-training extraction ────────────────────────────────────────────────

describe('lastTrainingRestore: extractFromLastTrainingPayload', () => {
  test('a bare payload with restorable_config is restorable', () => {
    const result = extractFromLastTrainingPayload({
      has_last_training: true,
      schema_id: 'sdxl-ileco',
      run_id: 'r9',
      restorable_config: { pretrained_model_name_or_path: '/m.safetensors' },
    })
    expect(result).toMatchObject({
      ok: true,
      source: 'last-training',
      schemaId: 'sdxl-ileco',
      runId: 'r9',
    })
    expect(result.config).toEqual({ pretrained_model_name_or_path: '/m.safetensors' })
  })

  test('an enveloped payload is unwrapped through data', () => {
    const result = extractFromLastTrainingPayload({
      status: 'success',
      data: { has_last_training: true, schema_id: 'sdxl-lora', restorable_config: { a: 1 } },
    })
    expect(result.ok).toBe(true)
    expect(result.schemaId).toBe('sdxl-lora')
  })

  test('restorable_config wins over config when both are present', () => {
    const result = extractFromLastTrainingPayload({
      has_last_training: true,
      schema_id: 'sdxl-lora',
      restorable_config: { source: 'restorable' },
      config: { source: 'raw' },
    })
    expect(result.config).toEqual({ source: 'restorable' })
  })

  test('config is used when restorable_config is absent or empty', () => {
    expect(extractFromLastTrainingPayload({
      has_last_training: true, schema_id: 'sdxl-lora', config: { source: 'raw' },
    }).config).toEqual({ source: 'raw' })
    expect(extractFromLastTrainingPayload({
      has_last_training: true, schema_id: 'sdxl-lora', restorable_config: {}, config: { source: 'raw' },
    }).config).toEqual({ source: 'raw' })
  })

  test('schema id falls back through schema_id -> training_type -> typeId', () => {
    const read = (bag: Bag) => extractFromLastTrainingPayload({ has_last_training: true, restorable_config: { a: 1 }, ...bag }).schemaId
    expect(read({ schema_id: 'a', training_type: 'b', typeId: 'c' })).toBe('a')
    expect(read({ training_type: 'b', typeId: 'c' })).toBe('b')
    expect(read({ typeId: 'c' })).toBe('c')
    expect(read({})).toBe('')
  })

  test('a run with no raw config reports raw_config_unavailable instead of "nothing to restore"', () => {
    // 这两种情况的 UI 文案不同：有记录但没 raw 是"这次运行没存参数"。
    const result = extractFromLastTrainingPayload({ has_last_training: true, schema_id: 'sdxl-lora', run_id: 'r9' })
    expect(result).toMatchObject({ ok: false, source: 'last-training', reason: 'raw_config_unavailable', runId: 'r9' })
    expect(result.config).toEqual({})
  })

  test('an explicit backend error string is surfaced as the reason', () => {
    const result = extractFromLastTrainingPayload({ has_last_training: true, error: 'config_file_missing' })
    expect(result.reason).toBe('config_file_missing')
  })

  test('has_last_training must be strictly true', () => {
    for (const value of ['true', 1, undefined, null, false]) {
      const result = extractFromLastTrainingPayload({ has_last_training: value, restorable_config: { a: 1 } })
      expect(result, String(value)).toMatchObject({ ok: false, source: 'none', reason: 'no_last_training' })
    }
  })

  test('garbage input degrades to no_last_training rather than throwing', () => {
    for (const value of [null, undefined, 'string', 42, []]) {
      expect(() => extractFromLastTrainingPayload(value)).not.toThrow()
      expect(extractFromLastTrainingPayload(value).ok, String(value)).toBe(false)
    }
  })
})

// ─── resume offer ────────────────────────────────────────────────────────────

describe('lastTrainingRestore: resume offer normalization', () => {
  const offer = (bag: Bag) =>
    extractFromLastTrainingPayload({
      has_last_training: true,
      schema_id: 'sdxl-lora',
      restorable_config: { a: 1 },
      resume_offer: bag,
    }).resumeOffer

  test('booleans are strict: only true counts as enabled', () => {
    const strict = offer({ available: 'true', offerable: 1, show_banner: true })
    // available/offerable 决定是否提示续训；宽松判定会给出无法兑现的按钮。
    expect(strict).toMatchObject({ available: false, offerable: false, show_banner: true })
  })

  test('resume_capability is restricted to the backend enum', () => {
    expect(offer({ resume_capability: 'full' })?.resume_capability).toBe('full')
    expect(offer({ resume_capability: 'partial' })?.resume_capability).toBe('partial')
    expect(offer({ resume_capability: 'weights_only' })?.resume_capability).toBe('weights_only')
    expect(offer({ resume_capability: 'anything-else' })?.resume_capability).toBeNull()
    expect(offer({})?.resume_capability).toBeNull()
  })

  test('resume_level only accepts full or weights_only', () => {
    expect(offer({ resume_level: 'full' })?.resume_level).toBe('full')
    expect(offer({ resume_level: 'weights_only' })?.resume_level).toBe('weights_only')
    // partial 不是合法 level；错判成 full 会让用户以为优化器状态也恢复了。
    expect(offer({ resume_level: 'partial' })?.resume_level).toBeNull()
  })

  test('blank strings normalize to null so the UI can hide empty rows', () => {
    const normalized = offer({ suggested_resume: '   ', resume_path: '', run_status: '  ', resume_warning: '' })
    expect(normalized).toMatchObject({
      suggested_resume: null,
      resume_path: null,
      run_status: null,
      resume_warning: null,
    })
  })

  test('checkpoint_count is coerced to a finite number', () => {
    expect(offer({ checkpoint_count: '3' })?.checkpoint_count).toBe(3)
    expect(offer({ checkpoint_count: 'abc' })?.checkpoint_count).toBe(0)
    expect(offer({})?.checkpoint_count).toBe(0)
  })

  test('hint defaults to "none" rather than an empty string', () => {
    expect(offer({})?.hint).toBe('none')
    expect(offer({ hint: 'checkpoint_found' })?.hint).toBe('checkpoint_found')
  })

  test('a missing resume_offer yields null, not a fabricated offer', () => {
    const result = extractFromLastTrainingPayload({
      has_last_training: true, schema_id: 'sdxl-lora', restorable_config: { a: 1 },
    })
    expect(result.resumeOffer).toBeNull()
  })

  test('suggestedResume prefers the top-level value, then the offer, then resume_path', () => {
    const read = (bag: Bag) =>
      extractFromLastTrainingPayload({ has_last_training: true, restorable_config: { a: 1 }, ...bag }).suggestedResume
    expect(read({ suggested_resume: '/top', resume_offer: { suggested_resume: '/offer', resume_path: '/path' } })).toBe('/top')
    expect(read({ resume_offer: { suggested_resume: '/offer', resume_path: '/path' } })).toBe('/offer')
    expect(read({ resume_offer: { resume_path: '/path' } })).toBe('/path')
    expect(read({})).toBeNull()
  })
})

// ─── saved_params extraction ─────────────────────────────────────────────────

describe('lastTrainingRestore: extractFromSavedParamsPayload', () => {
  test('a nested { schema_id, config } bundle is unpacked', () => {
    const result = extractFromSavedParamsPayload({ schema_id: 'sdxl-lora', config: { network_dim: 32 } })
    expect(result).toMatchObject({ ok: true, source: 'saved_params', schemaId: 'sdxl-lora' })
    expect(result.config).toEqual({ network_dim: 32 })
  })

  test('a flat parameter bag is accepted and meta keys are stripped', () => {
    const result = extractFromSavedParamsPayload({
      schema_id: 'sdxl-lora',
      training_type: 'lora',
      typeId: 'sdxl-lora',
      has_last_training: true,
      run_id: 'r1',
      normalized_config: { junk: true },
      network_dim: 32,
    })
    expect(result.ok).toBe(true)
    // 元字段不能污染草稿。
    expect(result.config).toEqual({ network_dim: 32 })
    expect(result.runId).toBe('r1')
  })

  test('the schema id can come from the nested config', () => {
    const result = extractFromSavedParamsPayload({ config: { schema_id: 'anima-lora', network_dim: 8 } })
    expect(result.schemaId).toBe('anima-lora')
  })

  test('an envelope is unwrapped through data', () => {
    const result = extractFromSavedParamsPayload({ status: 'success', data: { schema_id: 'sdxl-lora', config: { a: 1 } } })
    expect(result.ok).toBe(true)
    expect(result.schemaId).toBe('sdxl-lora')
  })

  test('an empty payload reports empty_saved_params', () => {
    expect(extractFromSavedParamsPayload({})).toMatchObject({ ok: false, source: 'none', reason: 'empty_saved_params' })
    expect(extractFromSavedParamsPayload(null)).toMatchObject({ ok: false, reason: 'empty_saved_params' })
  })

  test('a bag that is only meta keys reports empty_config', () => {
    const result = extractFromSavedParamsPayload({ schema_id: 'sdxl-lora', run_id: 'r1' })
    expect(result).toMatchObject({ ok: false, source: 'saved_params', reason: 'empty_config', schemaId: 'sdxl-lora' })
  })
})

// ─── fetch fallback chain ────────────────────────────────────────────────────

describe('lastTrainingRestore: fetchRestorableLastTraining', () => {
  test('last-training success short-circuits the saved_params call', async () => {
    mocks.lastTraining.mockResolvedValue({
      has_last_training: true, schema_id: 'sdxl-lora', restorable_config: { a: 1 },
    })
    const result = await fetchRestorableLastTraining()
    expect(result).toMatchObject({ ok: true, source: 'last-training' })
    expect(mocks.savedParams).not.toHaveBeenCalled()
  })

  test('a last-training record without raw config falls back to saved_params', async () => {
    mocks.lastTraining.mockResolvedValue({ has_last_training: true, schema_id: 'sdxl-lora' })
    mocks.savedParams.mockResolvedValue({ status: 'success', data: { schema_id: 'sdxl-lora', config: { network_dim: 8 } } })
    const result = await fetchRestorableLastTraining()
    expect(result).toMatchObject({ ok: true, source: 'saved_params' })
    expect(result.config).toEqual({ network_dim: 8 })
  })

  test('a last-training transport failure falls back to saved_params', async () => {
    mocks.lastTraining.mockRejectedValue(new Error('route missing'))
    mocks.savedParams.mockResolvedValue({ schema_id: 'sdxl-lora', config: { network_dim: 8 } })
    const result = await fetchRestorableLastTraining()
    expect(result.ok).toBe(true)
    expect(result.source).toBe('saved_params')
  })

  test('both endpoints failing yields fetch_failed and never throws', async () => {
    mocks.lastTraining.mockRejectedValue(new Error('down'))
    mocks.savedParams.mockRejectedValue(new Error('down'))
    await expect(fetchRestorableLastTraining()).resolves.toMatchObject({
      ok: false, source: 'none', reason: 'fetch_failed',
    })
  })

  test('a business-error saved_params envelope is treated as a failure', async () => {
    mocks.lastTraining.mockResolvedValue({})
    mocks.savedParams.mockResolvedValue({ status: 'error', message: 'nope' })
    await expect(fetchRestorableLastTraining()).resolves.toMatchObject({ ok: false, reason: 'fetch_failed' })
  })
})

// ─── isDraftNearDefault ──────────────────────────────────────────────────────

describe('lastTrainingRestore: isDraftNearDefault', () => {
  /**
   * 数组型默认值(adaptive_training_adjustments / adaptive_training_locked_items /
   * preview_groups)当前会被引用比较判成"已修改"，见本组末尾两条 CONTRACT 用例。
   * 为了让下面每条用例只考察自己那一条规则、不被该缺陷连带带红，
   * 这里从基线里去掉这三个键。
   */
  const ARRAY_DRIFT_KEYS = ['adaptive_training_adjustments', 'adaptive_training_locked_items', 'preview_groups']

  function baseline(typeId: string): Bag {
    const defaults = createDefaultConfig(typeId) as Bag
    const draft: Bag = { ...defaults }
    for (const key of ARRAY_DRIFT_KEYS) delete draft[key]
    return draft
  }

  test('the isolation baseline itself is near-default', () => {
    // 若这条失败，说明除数组引用之外还有别的默认值被误判成修改。
    expect(isDraftNearDefault('sdxl-lora', baseline('sdxl-lora'))).toBe(true)
  })

  test('a draft with several real edits is not near-default (confirm required)', () => {
    const draft = {
      ...baseline('sdxl-lora'),
      network_dim: 128,
      network_alpha: 64,
      max_train_steps: 4000,
      output_name: 'my-run',
    }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(false)
  })

  test('a real model path alone is enough to require confirmation', () => {
    const draft = {
      ...baseline('sdxl-lora'),
      pretrained_model_name_or_path: 'D:/models/real.safetensors',
    }
    // 用户已经指了真实底模：静默覆盖会丢掉他刚选的路径。
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(false)
  })

  test('placeholder-style paths do not count as user intent', () => {
    const draft = {
      ...baseline('sdxl-lora'),
      pretrained_model_name_or_path: './sd-models/model.safetensors',
      train_data_dir: '',
    }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('whitespace-only differences from a string default are ignored', () => {
    const draft = baseline('sdxl-lora')
    // save_precision 不在 KEY_PATH_HINTS 里，走的是通用 trim 比较分支。
    draft.save_precision = `  ${String(draft.save_precision)}  `
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('CONTRACT: whitespace padding on a path-hint field is not a real edit either', () => {
    // 通用分支用 v.trim() === String(d).trim() 判等，但 KEY_PATH_HINTS 的
    // 第二轮扫描改用严格 cur !== def，于是同一个"只多了空格"的值在两处结论相反：
    // output_name 加个尾空格就会让草稿被判成有用户意图，「上次训练」白弹确认框。
    // 目标契约：两处判等口径一致(都 trim 后比较)。
    // 生产实现尚未修复 → 本用例目前失败，属于已知待合并项。
    const draft = baseline('sdxl-lora')
    draft.output_name = `${String(draft.output_name)} `
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('underscore-prefixed bookkeeping keys are ignored', () => {
    const draft = { ...baseline('sdxl-lora'), _internalA: 1, _internalB: 2, _internalC: 3 }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('empty and nullish values never count as edits', () => {
    const draft = { ...baseline('sdxl-lora'), output_name: '', max_train_steps: null, seed: undefined }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('one or two edits still count as near-default (silent seed allowed)', () => {
    const draft = { ...baseline('sdxl-lora'), network_dim: 128, network_alpha: 64 }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })

  test('three or more meaningful edits cross the threshold', () => {
    const draft = { ...baseline('sdxl-lora'), network_dim: 128, network_alpha: 64, max_train_steps: 4000 }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(false)
  })

  test('an empty draft is near-default', () => {
    expect(isDraftNearDefault('sdxl-lora', {})).toBe(true)
  })

  test('CONTRACT: a pristine schema-default draft must be near-default', () => {
    // createDefaultConfig 为数组型字段(adaptive_training_adjustments /
    // adaptive_training_locked_items / preview_groups)每次返回新数组实例，
    // isDraftNearDefault 用 === 比较引用 → 三个数组各记一次 meaningfulDiff，
    // 恰好达到 >= 3 的阈值，于是"从没动过的草稿"也被判成有用户意图，
    // 「上次训练」永远弹覆盖确认框。
    // 目标契约：值相等的数组/对象默认值不算修改。
    // 生产实现尚未修复 → 本用例目前失败，属于已知待合并项。
    for (const typeId of ['sdxl-lora', 'anima-lora']) {
      expect(isDraftNearDefault(typeId, createDefaultConfig(typeId) as Bag), typeId).toBe(true)
    }
  })

  test('CONTRACT: equal-valued array fields must not be counted as edits', () => {
    // 上一条的最小复现：只把三个数组字段换成等值的新实例。
    const defaults = createDefaultConfig('sdxl-lora') as Bag
    const draft = {
      ...defaults,
      adaptive_training_adjustments: [],
      adaptive_training_locked_items: [],
      preview_groups: [],
    }
    expect(isDraftNearDefault('sdxl-lora', draft)).toBe(true)
  })
})
