// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// SDXL 桶全参数修正（2026-08）行为门禁：
//   1. 幻影键提交层剥除（sc_* 六键 / control_net_lr / TI weights）
//   2. BlockWeight 双 master 归一（lulynx_* 折叠 + master 键不出站）
//   3. sdxl_fixed_block_swap 死守卫桥接
//   4. finetune train_text_encoder 派生一致性
//   5. 三个补注册类型（dreambooth/lllite/ip-adapter）的 schema 闭环
//   6. 共享静态值表与后端合法集对齐（scheduler / sample_sampler / tlora）
import { describe, expect, it } from 'vitest'
import {
  TRAINING_TYPES,
  createDefaultConfig,
  getSectionsForType,
  buildRunConfig,
} from '@/schema/schemaIndex.js'
import { ALL_SCHEDULERS } from '@/schema/schemaCommon.js'

function fieldsOf(typeId: string) {
  return getSectionsForType(typeId).flatMap((section) => section.fields)
}

function build(typeId: string, patch: Record<string, unknown> = {}) {
  return buildRunConfig({ ...createDefaultConfig(typeId), ...patch }, typeId)
}

describe('phantom keys are stripped at submit time', () => {
  it('sc_* structured-caption knobs never ship (backend has zero readers)', () => {
    const payload = build('sdxl-lora', { sc_style_dropout: 0.9, sc_locked_tags: 'x' })
    for (const key of ['sc_trigger_dropout', 'sc_style_dropout', 'sc_quality_dropout', 'sc_content_dropout', 'sc_modifier_dropout', 'sc_locked_tags']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('control_net_lr is hidden legacy alias and never ships', () => {
    const payload = build('sdxl-controlnet')
    expect(payload).not.toHaveProperty('control_net_lr')
  })

  it('TI weights input is hidden and never ships', () => {
    const payload = build('sdxl-textual-inversion')
    expect(payload).not.toHaveProperty('weights')
  })
})

describe('block weight dual-master unification', () => {
  it('folds lulynx_* legacy aliases into the standard keys when the master is on', () => {
    const payload = build('sdxl-lora', {
      enable_block_weights: true,
      lulynx_down_lr_weight: '9,9',
      lulynx_mid_lr_weight: '',
      lulynx_up_lr_weight: '9,9',
      lulynx_block_lr_zero_threshold: 0.02,
    })
    expect(payload.down_lr_weight).toBe('9,9')
    expect(payload.up_lr_weight).toBe('9,9')
    expect(payload.block_lr_zero_threshold).toBe(0.02)
    for (const key of ['lulynx_block_weight_enabled', 'lulynx_down_lr_weight', 'lulynx_mid_lr_weight', 'lulynx_up_lr_weight', 'lulynx_block_lr_zero_threshold', 'enable_block_weights']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('legacy lulynx master alone still activates block weights', () => {
    const payload = build('sdxl-lora', { lulynx_block_weight_enabled: true, down_lr_weight: '1,2' })
    expect(payload.down_lr_weight).toBe('1,2')
  })

  it('drops weight strings when no master is on', () => {
    const payload = build('sdxl-lora')
    for (const key of ['down_lr_weight', 'mid_lr_weight', 'up_lr_weight', 'block_lr_zero_threshold']) {
      expect(payload).not.toHaveProperty(key)
    }
  })
})

describe('sdxl_fixed_block_swap guard bridge', () => {
  it('mirrors sdxl_low_vram_fixed_block_swap when low-vram optimization is on', () => {
    const on = build('sdxl-lora', { sdxl_low_vram_optimization: true, sdxl_low_vram_fixed_block_swap: true })
    expect(on.sdxl_fixed_block_swap).toBe(true)
    const off = build('sdxl-lora', { sdxl_low_vram_optimization: true, sdxl_low_vram_fixed_block_swap: false })
    expect(off.sdxl_fixed_block_swap).toBe(false)
  })

  it('never ships the mirror key when optimization is off', () => {
    const payload = build('sdxl-lora')
    expect(payload).not.toHaveProperty('sdxl_fixed_block_swap')
  })
})

describe('finetune train_text_encoder master', () => {
  it('defaults to true with consistent network_train_unet_only=false', () => {
    const payload = build('sdxl-finetune')
    expect(payload.train_text_encoder).toBe(true)
    expect(payload.network_train_unet_only).toBe(false)
    expect(payload.network_train_text_encoder_only).toBe(false)
  })

  it('flips to U-Net only when disabled', () => {
    const payload = build('sdxl-finetune', { train_text_encoder: false })
    expect(payload.network_train_unet_only).toBe(true)
  })

  it('does not ship the derived pair for lora types', () => {
    const payload = build('sdxl-lora')
    expect(payload).not.toHaveProperty('train_text_encoder')
  })
})

describe('newly registered sdxl types close the loop', () => {
  const NEW_TYPES = ['sdxl-dreambooth', 'sdxl-controlnet-lllite', 'sdxl-ip-adapter']

  it.each(NEW_TYPES)('%s is registered, visible and has sections', (typeId) => {
    expect(TRAINING_TYPES.some((t) => t.id === typeId)).toBe(true)
    const sections = getSectionsForType(typeId)
    expect(sections.length).toBeGreaterThan(3)
    // 同一类型内字段键不得重复（双卡重复定义会让默认值互相覆盖）。
    const keys = fieldsOf(typeId).map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('sdxl-dreambooth exposes prior preservation knobs', () => {
    const keys = new Set(fieldsOf('sdxl-dreambooth').map((f) => f.key))
    for (const key of ['instance_prompt', 'class_prompt', 'num_class_images', 'reg_data_dir', 'prior_loss_weight', 'use_lora', 'train_text_encoder']) {
      expect(keys.has(key), `missing ${key}`).toBe(true)
    }
    const payload = build('sdxl-dreambooth')
    expect(payload.model_train_type).toBe('sdxl-dreambooth')
    expect(payload.num_class_images).toBe(100)
  })

  it('lllite adapter params match backend reader keys', () => {
    const keys = new Set(fieldsOf('sdxl-controlnet-lllite').map((f) => f.key))
    for (const key of ['lllite_cond_emb_dim', 'lllite_mlp_dim', 'lllite_dropout', 'lllite_skip_input_blocks', 'lllite_skip_output_blocks', 'conditioning_data_dir']) {
      expect(keys.has(key), `missing ${key}`).toBe(true)
    }
  })

  it('ip-adapter uses backend canonical keys (not the orphan ip_adapter_* group)', () => {
    const keys = new Set(fieldsOf('sdxl-ip-adapter').map((f) => f.key))
    expect(keys.has('ip_image_encoder_path')).toBe(true)
    expect(keys.has('ip_num_tokens')).toBe(true)
    expect(keys.has('ip_adapter_enabled')).toBe(false)
    const payload = build('sdxl-ip-adapter')
    expect(payload.ip_image_encoder_path).toBe('openai/clip-vit-large-patch14')
    expect(payload.ip_num_tokens).toBe(16)
  })

  it('exposed-but-previously-missing backend fields exist across the four base types', () => {
    for (const typeId of ['sdxl-lora', 'sdxl-finetune', 'sdxl-controlnet', 'sdxl-textual-inversion']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      for (const key of ['weight_decay', 'sdpa_backend_policy', 'weight_compression_preset', 'blocks_to_swap', 'adaptive_step_logging_enabled', 'caption_tag_mutate_scope', 'tag_group_shuffle', 'caption_protect_prefix_from_dropout']) {
        expect(keys.has(key), `${typeId} missing ${key}`).toBe(true)
      }
    }
  })

  it('controlnet dataset exposes reg_data_dir; finetune drops the dead LoRA variants section', () => {
    expect(new Set(fieldsOf('sdxl-controlnet').map((f) => f.key)).has('reg_data_dir')).toBe(true)
    expect(getSectionsForType('sdxl-finetune').some((s) => s.id === 'lora-variants-ft')).toBe(false)
  })
})

describe('shared static value tables align with backend legal sets', () => {
  it('lr_scheduler static list contains one_cycle/restart_linear/plugin', () => {
    for (const value of ['one_cycle', 'restart_linear', 'plugin', 'lulynx_exponential_warmup']) {
      expect(ALL_SCHEDULERS, `${value} missing`).toContain(value)
    }
  })

  it('sample_sampler offers canonical names and keeps legacy names as options', () => {
    const field = fieldsOf('sdxl-lora').find((f) => f.key === 'sample_sampler')
    expect(field).toBeTruthy()
    const values = (field!.options as Array<{ value: string }>).map((o) => o.value)
    for (const v of ['euler_a', 'euler', 'ddim', 'dpm++_2m', 'dpm++_2m_sde', 'dpm++_sde', 'uni_pc', 'dpmsolver']) {
      expect(values, `${v} missing`).toContain(v)
    }
  })

  it('tlora_rank_schedule no longer offers the silently-degrading cosine value', () => {
    const field = fieldsOf('sdxl-lora').find((f) => f.key === 'tlora_rank_schedule')
    const values = field && Array.isArray(field.options) ? field.options : []
    expect(values).toEqual(['constant', 'linear', 'geometric'])
  })

  it('network dim slider upper bound matches backend max 1024', () => {
    const field = fieldsOf('sdxl-lora').find((f) => f.key === 'network_dim')
    expect(field?.max).toBe(1024)
  })

  it('rf-settings moved to the advanced tab; caption split into four cards', () => {
    const sections = getSectionsForType('sdxl-lora')
    expect(sections.find((s) => s.id === 'rf-settings')?.tab).toBe('advanced')
    for (const id of ['caption-settings', 'caption-dropout-settings', 'caption-variants-settings', 'caption-structured-settings', 'cache-settings']) {
      expect(sections.some((s) => s.id === id), `${id} missing`).toBe(true)
    }
  })

  it('max_token_length validation domain stays inside the backend accepted domain', () => {
    const field = fieldsOf('sdxl-lora').find((f) => f.key === 'max_token_length')
    expect(field?.min).toBeGreaterThanOrEqual(75)
  })
})
