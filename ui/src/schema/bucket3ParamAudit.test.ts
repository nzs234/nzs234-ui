// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 第 3 站桶全参数修正（2026-08）行为门禁：Newbie / SD(sd-lora) / FLUX(flux-lora) /
// MiniMax-H3(lora+finetune)。
//   A. P0：newbie_force_cache_only 默认 false + 文案如实（仅建缓存不训练）
//   B. 值域：mixed_precision 无 fp32 / 优化器下拉禁用未接入值 / flux dim·α 默认
//      对齐 registry / lokr_* 别名劫持键移除
//   C. 幻影：共享死旋钮 hidden + 提交层剥除；flux 死流键类型域剥除（anima 不受影响）
//   D. 补暴露：H3 CFG/σ/cache/加载组、newbie init·shuffle、flux offload 三档
//   E. 显隐矛盾：sd-lora train_text_encoder master 三键一致、prefetch 锚 streaming、
//      H3 swap×checkpoint 联动复位、compile 冲突警示
//   F. 排版：newbie 归位 + expert 标志、H3 save 过滤对称化
import { describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  getSectionsForType,
  buildRunConfig,
} from '@/schema/schemaIndex.js'
import { TARGET_LORA_OPTIMIZERS, ALL_OPTIMIZERS } from '@/schema/features/settingsOptions.js'
import { validateConfig } from '@/utils/configValidator'
import schemaFieldLabelsEn from '@/i18n/schemaFieldLabelsEn.json'
import schemaFieldDescsEn from '@/i18n/schemaFieldDescsEn.json'

const BUCKET_TYPES = [
  'newbie-lora',
  'sd-lora',
  'flux-lora',
  'minimax-h3-lora',
  'minimax-h3-finetune',
] as const

function fieldsOf(typeId: string) {
  return getSectionsForType(typeId).flatMap((section) => section.fields)
}

function sectionsOf(typeId: string) {
  return getSectionsForType(typeId)
}

function fieldOf(typeId: string, key: string) {
  return fieldsOf(typeId).find((f) => f.key === key)
}

function build(typeId: string, patch: Record<string, unknown> = {}) {
  return buildRunConfig({ ...createDefaultConfig(typeId), ...patch }, typeId)
}

describe('A/P0: newbie_force_cache_only means cache-only (no training)', () => {
  it('defaults to false with honest copy', () => {
    const field = fieldOf('newbie-lora', 'newbie_force_cache_only')
    expect(field).toBeTruthy()
    expect(field!.defaultValue).toBe(false)
    expect(String(field!.label)).not.toContain('参与训练')
    expect(String(field!.desc)).toContain('不进入训练循环')
  })

  it('ships false by default and true only when explicitly enabled', () => {
    expect(build('newbie-lora').newbie_force_cache_only).toBe(false)
    expect(build('newbie-lora', { newbie_force_cache_only: true }).newbie_force_cache_only).toBe(true)
  })

  it('EN pack copy matches the new semantics (cache-only, no training, default off)', () => {
    // 旧 EN 文案 "Refuse live encode paths…" 描述的是已废弃的语义。
    const desc = String(schemaFieldDescsEn.newbie_force_cache_only ?? '')
    expect(desc).toMatch(/cache/i)
    expect(desc).toMatch(/without entering the training loop|exits early/i)
    expect(desc.toLowerCase()).not.toContain('refuse live encode')
    expect(String(schemaFieldLabelsEn.newbie_force_cache_only ?? '')).toMatch(/no training/i)
  })
})

describe('B/value domains', () => {
  it('newbie mixed_precision drops fp32 (outside backend enum)', () => {
    const field = fieldOf('newbie-lora', 'mixed_precision')
    expect(field!.options).toEqual(['bf16', 'fp16', 'no'])
  })

  it('optimizer dropdowns disable KL-Shampoo/Gluon (bare values fail backend enum)', () => {
    for (const list of [TARGET_LORA_OPTIMIZERS, ALL_OPTIMIZERS]) {
      for (const value of ['KL-Shampoo', 'Gluon']) {
        const entry = list.find((opt) => typeof opt === 'object' && opt.value === value) as
          | { disabled?: boolean; disabledReason?: string }
          | undefined
        expect(entry, `${value} in optimizer list`).toBeTruthy()
        expect(entry!.disabled).toBe(true)
        expect(entry!.disabledReason).toBeTruthy()
      }
    }
  })

  it('flux network defaults align with the launcher registry schema (dim 16 / alpha 8)', () => {
    expect(fieldOf('flux-lora', 'network_dim')!.defaultValue).toBe(16)
    expect(fieldOf('flux-lora', 'network_alpha')!.defaultValue).toBe(8)
  })

  it('lokr_rank/alpha/dropout alias-hijacked knobs are gone; real LoKr params stay', () => {
    const keys = new Set(fieldsOf('newbie-lora').map((f) => f.key))
    for (const key of ['lokr_rank', 'lokr_alpha', 'lokr_dropout']) {
      expect(keys.has(key), `${key} still defined`).toBe(false)
    }
    for (const key of ['lokr_factor', 'lokr_rank_dropout', 'lokr_module_dropout', 'lokr_train_norm']) {
      expect(keys.has(key), `${key} missing`).toBe(true)
    }
  })

  it('block residency options expose the streaming_offload tier', () => {
    const field = fieldOf('newbie-lora', 'newbie_block_residency')
    const values = (field!.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['resident', 'streaming_offload', 'block_cpu_pinned'])
  })
})

describe('C/phantoms hidden and stripped', () => {
  it('shared dead knobs never ship for any bucket type', () => {
    for (const typeId of BUCKET_TYPES) {
      const payload = build(typeId)
      for (const key of [
        'dora_init_scale', 'dora_use_scalar_magnitude', 'dora_normalize_magnitude',
        'lora2_adaptive_rank_threshold',
        'ed_lora_fusion_alpha',
        'ac_early_stopping_threshold', 'ac_te_freeze_step', 'ac_auto_lr_scale_factor', 'ac_target_loss',
        'compile_cache_prewarm', 'torch_compile_first_step_timeout',
      ]) {
        expect(payload, `${typeId} ships ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('shared dead knobs are hidden but retained for legacy drafts', () => {
    for (const typeId of BUCKET_TYPES) {
      for (const key of ['dora_init_scale', 'ac_target_loss', 'compile_cache_prewarm', 'lora2_adaptive_rank_threshold']) {
        const field = fieldsOf(typeId).find((f) => f.key === key)
        if (field) expect(field.type, `${typeId}:${key}`).toBe('hidden')
      }
    }
  })

  it('apply_t5_attn_mask is hidden on flux-lora and stripped', () => {
    expect(fieldOf('flux-lora', 'apply_t5_attn_mask')!.type).toBe('hidden')
    expect(build('flux-lora')).not.toHaveProperty('apply_t5_attn_mask')
  })

  it('flux dead flow keys are type-scoped phantoms (hidden + stripped)', () => {
    for (const key of ['sigmoid_scale', 'weighting_scheme', 'mode_scale', 'model_prediction_type']) {
      expect(fieldOf('flux-lora', key)!.type, `flux ${key} hidden`).toBe('hidden')
      expect(build('flux-lora'), `flux payload strips ${key}`).not.toHaveProperty(key)
    }
  })

  it('shared weighting_scheme options drop sigma_sqrt and include cosine (runtime legal set)', () => {
    // 用 lumina-lora（仍暴露该键的 flowParams 族）验证共享选项面。
    const field = fieldOf('lumina-lora', 'weighting_scheme')
    const values = ((field!.options ?? []) as Array<string | { value: string }>).map((o) =>
      typeof o === 'string' ? o : o.value)
    expect(values).not.toContain('sigma_sqrt')
    expect(values).toContain('cosine')
  })
})

describe('D/exposures', () => {
  it('h3 flow training group exposes CFG preservation + shift quartet + av loss mix', () => {
    for (const typeId of ['minimax-h3-lora', 'minimax-h3-finetune']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      for (const key of [
        'h3_cfg_preservation_enabled', 'h3_cfg_scale', 'h3_cfg_schedule',
        'h3_cfg_preservation_sigma_min', 'h3_unconditional_prompt',
        'h3_timestep_shift', 'h3_image_timestep_shift', 'h3_video_sigma_shift', 'h3_audio_sigma_shift',
        'h3_audio_loss_weight', 'h3_video_only', 'h3_condition_noise_clean',
      ]) {
        expect(keys.has(key), `${typeId} missing ${key}`).toBe(true)
      }
      const cfg = fieldOf(typeId, 'h3_cfg_preservation_enabled')
      expect(cfg!.defaultValue).toBe(true)
      expect(fieldOf(typeId, 'h3_cfg_scale')!.defaultValue).toBe(4.0)
    }
  })

  it('h3 cache management + te streaming + load-time optimizations are exposed', () => {
    for (const typeId of ['minimax-h3-lora', 'minimax-h3-finetune']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      for (const key of [
        'h3_cache_build_enabled', 'h3_cache_rebuild', 'h3_cache_dir', 'h3_cache_include_audio',
        'h3_cache_max_pixels', 'h3_cache_max_samples',
        'h3_te_layer_streaming', 'h3_prune_adaln_on_load', 'h3_load_direct_to_device',
      ]) {
        expect(keys.has(key), `${typeId} missing ${key}`).toBe(true)
      }
    }
  })

  it('newbie adapter init block (PiSSA/OLoRA/LoftQ) and caption shuffle are exposed', () => {
    const keys = new Set(fieldsOf('newbie-lora').map((f) => f.key))
    for (const key of ['adapter_init_strategy', 'adapter_init_export_mode', 'loftq_bits', 'loftq_quant_type', 'shuffle_caption', 'shuffle_caption_tags_only']) {
      expect(keys.has(key), `newbie missing ${key}`).toBe(true)
    }
  })

  it('flux exposes the transformer offload tiers', () => {
    const field = fieldOf('flux-lora', 'flux_transformer_offload')
    expect(field).toBeTruthy()
    expect(field!.options).toEqual(['auto', 'off', 'aggressive'])
    expect(build('flux-lora').flux_transformer_offload).toBe('auto')
  })
})

describe('E/visibility contradictions fixed at submit layer', () => {
  it('sd-lora uses an explicit train_text_encoder master with consistent derived keys', () => {
    const keys = new Set(fieldsOf('sd-lora').map((f) => f.key))
    expect(keys.has('train_text_encoder')).toBe(true)
    expect(keys.has('network_train_unet_only')).toBe(false)
    expect(keys.has('network_train_text_encoder_only')).toBe(false)

    expect(build('sd-lora').train_text_encoder).toBe(true)
    expect(build('sd-lora').network_train_unet_only).toBe(false)
    expect(build('sd-lora', { train_text_encoder: false }).network_train_unet_only).toBe(true)
  })

  it('structurally frozen types no longer expose TE-only fake switches', () => {
    for (const typeId of ['flux-lora', 'minimax-h3-lora', 'minimax-h3-finetune'] as const) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      expect(keys.has('network_train_unet_only'), `${typeId} unet_only`).toBe(false)
      expect(keys.has('network_train_text_encoder_only'), `${typeId} te_only`).toBe(false)
    }
  })

  it('train_length_mode is expanded away on all bucket S_TRAIN consumers', () => {
    for (const typeId of ['sd-lora', 'flux-lora', 'minimax-h3-lora', 'minimax-h3-finetune']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      expect(keys.has('train_length_mode'), `${typeId} keeps train_length_mode`).toBe(false)
      const steps = fieldOf(typeId, 'max_train_steps')!
      expect(steps.defaultValue).toBe(0)
      expect(steps.visibleWhen).toBeUndefined()
      const epochs = fieldOf(typeId, 'max_train_epochs')!
      expect(epochs.visibleWhen).toBeUndefined()
      expect(build(typeId)).not.toHaveProperty('train_length_mode')
    }
    // newbie 不消费 S_TRAIN（自带 training-settings），同样无该键。
    expect(new Set(fieldsOf('newbie-lora').map((f) => f.key)).has('train_length_mode')).toBe(false)
  })

  it('newbie prefetch fields anchor on streaming_offload only', () => {
    const prefetchField = fieldOf('newbie-lora', 'newbie_block_prefetch')
    expect(prefetchField).toBeTruthy()
    // streaming_offload 下可见、block_cpu_pinned 与 resident 下不可见（锚定函数存在）。
    expect(prefetchField!.visibleWhen).toBeTruthy()
  })
})

describe('E/warnings from configValidator', () => {
  it('flags compile without use_cache on newbie', () => {
    const result = validateConfig({
      model_train_type: 'newbie-lora',
      execution_backend: 'torch_compile',
      use_cache: false,
    }, 'newbie-lora')
    expect(result.warnings.some((w) => (w.fields ?? []).includes('use_cache'))).toBe(true)
  })

  it('flags compile × blocks_to_swap on flux/newbie', () => {
    for (const typeId of ['flux-lora', 'newbie-lora'] as const) {
      const result = validateConfig({
        model_train_type: typeId,
        execution_backend: 'torch_compile',
        blocks_to_swap: 5,
      }, typeId)
      expect(result.warnings.some((w) => (w.fields ?? []).includes('blocks_to_swap')), typeId).toBe(true)
    }
  })

  it('warns and auto-fixes h3 checkpoint mode when swap is enabled', () => {
    const result = validateConfig({
      model_train_type: 'minimax-h3-lora',
      h3_blocks_to_swap: 12,
      h3_checkpoint_mode: 'selective',
    }, 'minimax-h3-lora')
    expect(result.warnings.some((w) => (w.fields ?? []).includes('h3_checkpoint_mode'))).toBe(true)
    expect(result.autoFixes?.h3_checkpoint_mode).toBe('unsloth')
  })

  it('normalizes the same combo at submit time', () => {
    expect(
      build('minimax-h3-lora', { h3_blocks_to_swap: 12, h3_checkpoint_mode: 'ffn' }).h3_checkpoint_mode,
    ).toBe('unsloth')
    expect(
      build('minimax-h3-lora', { h3_blocks_to_swap: 0, h3_checkpoint_mode: 'full' }).h3_checkpoint_mode,
    ).toBe('full')
  })
})

describe('F/layout normalization', () => {
  it('newbie optimizer/log sections moved off training/model tabs; training params split out', () => {
    const sections = sectionsOf('newbie-lora')
    const byId = new Map(sections.map((s) => [s.id, s]))
    expect(byId.get('optimizer-settings')!.tab).toBe('optimizer')
    expect(byId.get('log-settings')!.tab).toBe('advanced')
    expect(byId.get('training-settings')!.tab).toBe('training')
    expect(byId.get('save-settings')!.fields.map((f) => f.key)).not.toContain('max_train_epochs')

    const saveKeys = new Set(byId.get('save-settings')!.fields.map((f) => f.key))
    expect(saveKeys.has('save_state')).toBe(true)
    expect(saveKeys.has('output_name')).toBe(true)
    // 跨 section 无重复键
    const allKeys = sections.flatMap((s) => s.fields.filter((f) => f.type !== 'ui_group').map((f) => f.key))
    expect(new Set(allKeys).size).toBe(allKeys.length)
  })

  it('newbie quality-pack/diagnostics are expert-gated like sibling families', () => {
    for (const section of sectionsOf('newbie-lora')) {
      if (section.id === 'quality-pack-settings' || section.id === 'diagnostics-settings') {
        expect(section.expert, section.id).toBe(true)
      }
    }
  })

  it('h3 finetune filters LoRA export pieces symmetrically; lora keeps them', () => {
    const ftSaveKeys = new Set(
      sectionsOf('minimax-h3-finetune').find((s) => s.id === 'save-settings')!.fields.map((f) => f.key),
    )
    for (const key of ['thin_svd_export_enabled', 'thin_svd_export_rank', 'export_comfy_int8_groupsize', 'merge_export']) {
      expect(ftSaveKeys.has(key), `ft save keeps ${key}`).toBe(false)
    }
    const loraSaveKeys = new Set(
      sectionsOf('minimax-h3-lora').find((s) => s.id === 'save-settings')!.fields.map((f) => f.key),
    )
    expect(loraSaveKeys.has('thin_svd_export_enabled')).toBe(true)
  })

  it('flux lycoris dead structure is trimmed away with includeLycoris=false', () => {
    const keys = new Set(fieldsOf('flux-lora').map((f) => f.key))
    for (const key of ['lycoris_algo', 'conv_dim', 'lycoris_preset', 'lokr_factor', 'decompose_both']) {
      expect(keys.has(key), `flux still carries ${key}`).toBe(false)
    }
    expect(keys.has('dora_wd')).toBe(true)
  })
})

describe('G/copy channels (review fixes)', () => {
  it('train_t5xxl EN label states "not recommended" (the switch is preflight-rejected)', () => {
    // 该开关在 flux 上是 disabled 幻影（后端预检必拒），EN label 曾写成
    // "(recommended)"，与语义及 zh 文案「不推荐」自相矛盾。
    expect(String(schemaFieldLabelsEn.train_t5xxl ?? '')).toBe('Train T5-XXL (not recommended)')
  })

  it('shuffle_caption_tags_only has an accurate EN label; mixed_precision EN desc covers the no tier', () => {
    expect(String(schemaFieldLabelsEn.shuffle_caption_tags_only ?? '').toLowerCase()).toContain('shuffle')
    const mixed = String(schemaFieldDescsEn.mixed_precision ?? '')
    expect(mixed).toContain("'no'")
    expect(mixed.toLowerCase()).toContain('full-precision')
  })

  it('visible disabled options carry an English reason channel (disabledReason_en)', () => {
    // optimizer 下拉：KL-Shampoo / Gluon
    for (const list of [TARGET_LORA_OPTIMIZERS, ALL_OPTIMIZERS]) {
      for (const value of ['KL-Shampoo', 'Gluon']) {
        const entry = list.find((opt) => typeof opt === 'object' && opt.value === value) as
          | { disabled?: boolean; disabledReason?: string; disabledReason_en?: string }
          | undefined
        expect(entry, `${value} in optimizer list`).toBeTruthy()
        expect(entry!.disabled).toBe(true)
        expect(String(entry!.disabledReason_en ?? '').trim(), `${value} en reason`).not.toBe('')
      }
    }
    // flux：train_t5xxl 字段级 + network_module 三个选项级
    expect(String(fieldOf('flux-lora', 'train_t5xxl')!.disabledReason_en ?? '').trim()).not.toBe('')
    const moduleOptions = (fieldOf('flux-lora', 'network_module')!.options ?? []) as Array<{ value: string; disabled?: boolean; disabledReason_en?: string }>
    for (const value of ['networks.tlora_flux', 'networks.oft_flux', 'lycoris.kohya']) {
      const opt = moduleOptions.find((entry) => entry.value === value)
      expect(opt?.disabled, value).toBe(true)
      expect(String(opt?.disabledReason_en ?? '').trim(), value).not.toBe('')
    }
    // newbie：adapter_type glora/glokr
    const adapterOptions = (fieldOf('newbie-lora', 'adapter_type')!.options ?? []) as Array<{ value: string; disabled?: boolean; disabledReason_en?: string }>
    for (const value of ['glora', 'glokr']) {
      const opt = adapterOptions.find((entry) => entry.value === value)
      expect(opt?.disabled, value).toBe(true)
      expect(String(opt?.disabledReason_en ?? '').trim(), value).not.toBe('')
    }
  })
})
