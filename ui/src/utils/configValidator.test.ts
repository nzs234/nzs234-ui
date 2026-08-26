// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 配置验证器单元测试
 *
 * 文案断言全部从 i18n 语言包派生（uiText 同源），不抄字面量：语言包改文案时
 * 用例跟着走；「键必须存在/值非空」由 i18nParity.test.ts 单独把门。
 */

import { validateConfig } from './configValidator'
import { useLocaleStore, type UiLanguage } from '@/stores/localeStore'
import zhBundle from '@/i18n/zh.json'
import enBundle from '@/i18n/en.json'

const bundles: Record<UiLanguage, Record<string, string>> = { zh: zhBundle as Record<string, string>, en: enBundle as Record<string, string> }

/** 当前语言下某个键的包内文本（带 {var} 插值）；缺失即抛错。 */
function uiText(key: string, vars?: Record<string, string | number>): string {
  const language = useLocaleStore.getState().language
  const value = bundles[language][key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing i18n key ${key}`)
  let out = value
  for (const [name, val] of Object.entries(vars ?? {})) out = out.replace(`{${name}}`, String(val))
  return out
}

function pickWarning(result: ReturnType<typeof validateConfig>, field: string) {
  return result.warnings.find((w) => w.fields?.includes(field))
}

describe('validateConfig', () => {
  test('冲突 1: Gradient Release Full + TurboCore → 自动 fallback 到 post_step', () => {
    const config = {
      turbocore_enabled: true,
      gradient_release_mode: 'full',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
    expect(pickWarning(result, 'turbocore_enabled')?.message).toBe(uiText('validator.gradient_release_turbocore'))
    expect(result.autoFixes?.gradient_release_mode).toBe('post_step')
  })

  test('冲突 1: Gradient Release Compatible + TurboCore → 自动 fallback 到 post_step', () => {
    const config = {
      turbocore_enabled: true,
      gradient_release_mode: 'compatible',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
    expect(result.warnings.length).toBe(1)
    expect(result.autoFixes?.gradient_release_mode).toBe('post_step')
  })

  test('冲突 2: torch.compile + 随机化特征 → 警告', () => {
    const config = {
      torch_compile_scope: 'per_block',
      pyramid_noise_offset_enable: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(pickWarning(result, 'torch_compile_scope')?.message).toBe(uiText('validator.compile_random_features'))
  })

  test('建议 1: 全参微调 + 小显存 → 警告（fields 定位，不依赖文案）', () => {
    ;(global as any).window = { __SYSTEM_VRAM_MB: 16000 }

    const config = {
      model_train_type: 'sdxl-finetune',
      gradient_release_mode: 'off',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(pickWarning(result, 'gradient_release_mode')?.fields).toContain('gradient_release_mode')

    delete (global as any).window
  })

  test('建议 1: DreamBooth 全参路线（sd/sdxl）同样命中小显存 Gradient Release 建议', () => {
    ;(global as any).window = { __SYSTEM_VRAM_MB: 16000 }
    try {
      for (const typeId of ['sd-dreambooth', 'sdxl-dreambooth']) {
        const result = validateConfig({ model_train_type: typeId, gradient_release_mode: 'off' }, typeId)
        const warning = pickWarning(result, 'gradient_release_mode')
        expect(warning, typeId).toBeTruthy()
        expect(warning?.fields).toContain('gradient_release_mode')
      }
      // 非 finetune/dreambooth 的 LoRA 路线不受影响：不触发该建议。
      const loraResult = validateConfig({ model_train_type: 'sdxl-lora', gradient_release_mode: 'off' }, 'sdxl-lora')
      expect(loraResult.warnings.some(w => w.message === uiText('validator.finetune_small_vram_gradient_release'))).toBe(false)
    } finally {
      delete (global as any).window
    }
  })

  test('建议 2: LoRA rank 过大 → 警告（bundle 派生插值）', () => {
    const config = {
      model_train_type: 'sdxl-lora',
      network_dim: 128,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(pickWarning(result, 'network_dim')?.message).toBe(
      uiText('validator.lora_rank_overfit_risk', { dim: 128 }),
    )
  })

  test('建议 3: 学习率过大 → 警告', () => {
    const config = {
      learning_rate: 1e-2,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(pickWarning(result, 'learning_rate')?.message).toBe(
      uiText('validator.learning_rate_too_large', { lr: String(0.01) }),
    )
  })

  test('建议 4: 训练步数过少 → 警告', () => {
    const config = {
      max_train_steps: 50,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(pickWarning(result, 'max_train_steps')?.message).toBe(
      uiText('validator.max_train_steps_too_few', { steps: 50 }),
    )
  })

  test('冲突 3: DoRA 叠加在 LyCORIS 算法（LoKr）上 → 警告并自动关闭', () => {
    const config = {
      network_module: 'lycoris.kohya',
      lycoris_algo: 'lokr',
      dora_wd: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.autoFixes?.dora_enabled).toBe(false)
    expect(result.autoFixes?.dora_wd).toBe(false)
  })

  test('冲突 3: 五站审计收官 —— audited 家族警告携带 routeId 且走 audited 文案', () => {
    const base = { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', use_dora: true, train_data_dir: '/d', pretrained_model_name_or_path: '/m' }
    const auditedTypes = ['sdxl-lora', 'anima-lora', 'krea2-lora', 'sd-lora', 'flux-lora']
    for (const typeId of auditedTypes) {
      const result = validateConfig({ ...base, model_train_type: typeId }, typeId)
      const warning = pickWarning(result, 'use_dora')
      // audited 文案含具体 routeId；pending（防御性回退）文案不含「实证」结论。
      expect(warning?.message, typeId).toBe(uiText('validator.dora_unstackable_audited', {
        type: typeId,
        base: String(base.lycoris_algo),
      }))
      expect(warning?.fields).toEqual(['dora_enabled', 'use_dora', 'dora_wd'])
      expect(result.autoFixes?.use_dora, typeId).toBe(false)
    }
    // NEWBIE 站：adapter_type 二次映射不改 rider 语义，autoFix 照常生效。
    const newbie = validateConfig({
      model_train_type: 'newbie-lora',
      adapter_type: 'lokr',
      use_dora: true,
      train_data_dir: '/d',
      pretrained_model_name_or_path: '/m',
    }, 'newbie-lora')
    expect(newbie.autoFixes?.use_dora).toBe(false)
  })

  test('冲突 3: FLUX/LTX 站已实证，警告自动关闭 use_dora', () => {
    const base = { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', use_dora: true, train_data_dir: '/d', pretrained_model_name_or_path: '/m' }
    const flux = validateConfig({ ...base, model_train_type: 'flux-lora' }, 'flux-lora')
    expect(flux.autoFixes?.use_dora).toBe(false)
    for (const typeId of ['ltx23-lora', 'ltx25-lora']) {
      const result = validateConfig({ ...base, model_train_type: typeId }, typeId)
      expect(result.autoFixes?.use_dora, typeId).toBe(false)
    }
  })

  test('冲突 3: Anima lora_type=lokr + dora_wd → 警告并自动关闭', () => {
    const result = validateConfig({
      model_train_type: 'anima-lora',
      lora_type: 'lokr',
      dora_wd: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.autoFixes?.use_dora).toBe(false)
  })

  test('冲突 3: DoRA 叠加在原生 LoRA 上 → 不警告', () => {
    const result = validateConfig({
      network_module: 'networks.lora',
      dora_enabled: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.fields?.includes('dora_enabled'))).toBe(false)
  })

  test('冲突 3: DoRA + 不兼容算法（ia3）→ 警告并自动关闭', () => {
    const config = {
      network_module: 'lycoris.kohya',
      lycoris_algo: 'ia3',
      use_dora: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.fields?.includes('dora_enabled'))).toBe(true)
    expect(result.autoFixes?.dora_enabled).toBe(false)
    expect(result.autoFixes?.dora_wd).toBe(false)
  })

  test('冲突 4: network_alpha > network_dim → 警告（bundle 派生插值）', () => {
    const config = {
      model_train_type: 'sdxl-lora',
      network_dim: 16,
      network_alpha: 32,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(pickWarning(result, 'network_alpha')?.message).toBe(
      uiText('validator.alpha_exceeds_dim', { alpha: 32, dim: 16 }),
    )
  })

  test('冲突 5: 数据集路径为空 → 错误', () => {
    const config = { pretrained_model_name_or_path: '/path/to/model' }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message === uiText('validator.missing_train_data_dir'))).toBe(true)
  })

  test('冲突 6: 模型路径为空 → 错误', () => {
    const config = { train_data_dir: '/path/to/data' }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message === uiText('validator.missing_model_path'))).toBe(true)
  })

  test('建议 5: Anima 短训练 + lulynx_steady_accel=off → 组合推荐含两条子建议', () => {
    const config = {
      model_train_type: 'anima-lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'off',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    const expected = uiText('validator.anima_short_training_recommendations', {
      recommendations: [
        uiText('validator.anima_rec_steady_accel'),
        uiText('validator.anima_rec_gradient_accumulation'),
      ].join('; '),
    })
    expect(pickWarning(result, 'lulynx_steady_accel')?.message).toBe(expected)
  })

  test('建议 5: Anima 短训练 + steady=auto 仍提示梯度累积', () => {
    const config = {
      model_train_type: 'anima-lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'auto',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    const warning = pickWarning(result, 'gradient_accumulation_steps')
    expect(warning?.message).toContain(uiText('validator.anima_rec_gradient_accumulation'))
    expect(warning?.message).not.toContain(uiText('validator.anima_rec_steady_accel'))
  })

  test('建议 5: steady=auto 且梯度累积已为 2 → 不警告', () => {
    const result = validateConfig({
      model_train_type: 'anima-lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'auto',
      gradient_accumulation_steps: 2,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes(uiText('validator.anima_short_training_recommendations').replace('：{recommendations}', '')))).toBe(false)
  })

  test('正常配置 → 无错误', () => {
    const config = {
      model_train_type: 'anima-lora',
      network_dim: 16,
      network_alpha: 8,
      learning_rate: 1e-4,
      max_train_steps: 800,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
  })
})

describe('validateConfig save-interval double-zero interlock (configs_save_interval_interlock mirror)', () => {
  test.each<[string]>([['sdxl-lora'], ['anima-lora'], ['newbie-lora']])('%s: both intervals 0 -> error listing both fields', (typeId) => {
    const result = validateConfig({
      model_train_type: typeId,
      save_every_n_epochs: 0,
      save_every_n_steps: 0,
    }, typeId)
    const error = result.errors.find((e) => e.fields?.includes('save_every_n_epochs'))
    expect(error, `${typeId} should flag both-zero`).toBeTruthy()
    expect(error?.fields).toEqual(['save_every_n_epochs', 'save_every_n_steps'])
    expect(error?.message).toBe(uiText('validator.save_interval_both_zero'))
  })

  test('epochs-only route is legal (0 epochs + steps>0)', () => {
    const result = validateConfig({ save_every_n_epochs: 0, save_every_n_steps: 100 }, 'sdxl-lora')
    expect(result.errors.find((e) => e.fields?.includes('save_every_n_epochs'))).toBeUndefined()
  })

  test('empty strings read as off, matching backend read_save_interval', () => {
    const result = validateConfig(
      { save_every_n_epochs: '', save_every_n_steps: '' } as Record<string, unknown>,
      'sdxl-lora',
    )
    expect(result.errors.find((e) => e.fields?.includes('save_every_n_epochs'))).toBeTruthy()
  })

  test('unwritten keys fall back to schema defaults (no false positive)', () => {
    const result = validateConfig({}, 'sdxl-lora')
    expect(result.errors.find((e) => e.fields?.includes('save_every_n_epochs'))).toBeUndefined()
  })

  test('without typeId the interlock is not applied (legacy contract)', () => {
    const result = validateConfig({})
    expect(result.errors.find((e) => e.fields?.includes('save_every_n_epochs'))).toBeUndefined()
  })
})

describe('validateConfig with typeId (schema-driven input resolution)', () => {
  test('sdxl-lora empty config reports model input and training data groups as empty', () => {
    const result = validateConfig({}, 'sdxl-lora')
    const messages = result.errors.map((error) => error.message)
    // 组标签经 inputGroupLabel → schemaGroupsEn 链路本地化（默认 zh 直接用 zh 文本）。
    expect(messages.some((message) => message === uiText('validator.input_group_empty', { group: '模型输入' }))).toBe(true)
    expect(messages.some((message) => message === uiText('validator.input_group_empty', { group: '训练数据' }))).toBe(true)
  })

  test('sdxl-lora with model+dataset (and output) filled -> no missing-input errors', () => {
    const result = validateConfig({
      pretrained_model_name_or_path: '/path/to/model',
      train_data_dir: '/path/to/data',
      output_dir: '/path/to/output',
    }, 'sdxl-lora')
    expect(result.errors.filter((error) => error.fields?.some((f) => f !== 'save_every_n_epochs'))).toEqual([])
  })

  test('aesthetic-scorer with annotations filled but image_root empty -> no missing errors', () => {
    const result = validateConfig({
      annotations: '/path/to/annotations.jsonl',
      image_root: '',
      output_dir: '/path/to/output',
    }, 'aesthetic-scorer')
    expect(result.errors.filter((e) => !e.fields?.includes('save_every_n_epochs'))).toEqual([])
  })

  test('aesthetic-scorer without annotations still errors (annotations required)', () => {
    const result = validateConfig({ image_root: '/path/to/images' }, 'aesthetic-scorer')
    expect(result.errors.some((error) => error.fields?.includes('annotations'))).toBe(true)
    // 组标签走 inputGroupLabel → schemaGroupsEn 双语链路（默认 zh 文本）。
    expect(result.errors[0].message).toBe(uiText('validator.input_group_empty', { group: '标注文件' }))
  })
})

describe('validateConfig messages follow the active UI language', () => {
  const original = useLocaleStore.getState().language

  afterEach(() => {
    // localeStore 是模块级单例，不复位会把语言泄漏给同一文件里后面的用例。
    useLocaleStore.getState().setLanguage(original as UiLanguage)
  })

  test('same input produces the en bundle text under en', () => {
    const config = { model_train_type: 'sdxl-lora', network_dim: 128 }
    useLocaleStore.getState().setLanguage('zh')
    const zhMessage = pickWarning(validateConfig(config, 'sdxl-lora'), 'network_dim')?.message
    useLocaleStore.getState().setLanguage('en')
    const enMessage = pickWarning(validateConfig(config, 'sdxl-lora'), 'network_dim')?.message
    expect(zhMessage).not.toBe(enMessage)
    expect(enMessage).toBe(enBundle['validator.lora_rank_overfit_risk'].replace('{dim}', '128'))
  })
})
