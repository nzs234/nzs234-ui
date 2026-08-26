// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ANIMA 桶全参数修正（2026-08）行为门禁：
//   A. 正确性：anima_model_prediction_type 值域 / tlora 调度 / weighting 双键 /
//      gdlokr 标注 / 幻影键剥除 / multi-addift 与 few-step 处置
//   B. 补暴露：缓存模式+六键 / finetune 五组分组 LR / policy profile path / attn_mode
//   C. 显隐矛盾：同类型内字段键零重复（单入口）
//   D. 排版：Flow/时间步合卡、S_LORA_VARIANTS expert 化、向导分桶
import { describe, expect, it } from 'vitest'
import {
  ALL_TRAINING_TYPES,
  createDefaultConfig,
  getSectionsForType,
  buildRunConfig,
} from '@/schema/schemaIndex.js'
import { ANIMA_TIMESTEP_SAMPLING_OPTIONS } from '@/schema/animaSchema.js'

const ANIMA_TYPES = [
  'anima-lora',
  'anima-finetune',
  'anima-controlnet',
  'anima-ileco',
  'anima-addift',
  'anima-multi-addift',
  'anima-edit-model',
] as const

function fieldsOf(typeId: string) {
  return getSectionsForType(typeId).flatMap((section) => section.fields)
}

function sectionsOf(typeId: string) {
  return getSectionsForType(typeId)
}

function build(typeId: string, patch: Record<string, unknown> = {}) {
  return buildRunConfig({ ...createDefaultConfig(typeId), ...patch }, typeId)
}

describe('A1: prediction target uses the backend canonical key', () => {
  it('plain model_prediction_type is gone from every anima type (value domain was disjoint)', () => {
    for (const typeId of ANIMA_TYPES) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      expect(keys.has('model_prediction_type'), `${typeId} still exposes model_prediction_type`).toBe(false)
    }
  })

  it('anima_model_prediction_type offers exactly the anima_flow.py legal set', () => {
    const field = fieldsOf('anima-lora').find((f) => f.key === 'anima_model_prediction_type')
    expect(field).toBeTruthy()
    const values = (field!.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['velocity', 'noise', 'epsilon', 'sample'])
    expect(field!.defaultValue).toBe('velocity')
  })

  it('concept-edit paths no longer default to a ValueError-bound raw target', () => {
    for (const typeId of ['anima-ileco', 'anima-addift', 'anima-multi-addift', 'concept-edit']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      expect(keys.has('model_prediction_type'), `${typeId} still carries the raw-default bomb`).toBe(false)
    }
  })
})

describe('A2: tlora_rank_schedule aligned with backend {constant,linear,geometric}', () => {
  it('both former cosine copies now offer the legal set with a legal default', () => {
    for (const typeId of ['anima-lora', 'anima-ileco']) {
      const fields = fieldsOf(typeId).filter((f) => f.key === 'tlora_rank_schedule')
      expect(fields.length, `${typeId} tlora_rank_schedule copies`).toBe(1)
      const field = fields[0]
      const values = Array.isArray(field.options) ? field.options : []
      expect(values).toEqual(['constant', 'linear', 'geometric'])
      expect(field.defaultValue).toBe('constant')
    }
  })
})

describe('A3/A5: legacy alias and phantom keys never ship', () => {
  it('weighting_scheme / sigmoid_scale / guidance_scale are absent from anima payloads', () => {
    // weighting_scheme 曾被空串 anima_weighting_scheme 静默压制
    // （field_alias_map.merge_field_aliases 冲突分支保留 canonical 直填值）。
    for (const typeId of ['anima-lora', 'anima-finetune']) {
      const payload = build(typeId)
      for (const key of ['weighting_scheme', 'sigmoid_scale', 'guidance_scale', 'mode_scale', 'model_prediction_type']) {
        expect(payload, `${typeId} ships ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('anima_guidance_scale (dead on both ends) is hidden and stripped at submit time', () => {
    const field = fieldsOf('anima-lora').find((f) => f.key === 'anima_guidance_scale')
    expect(field?.type).toBe('hidden')
    const payload = build('anima-lora')
    expect(payload).not.toHaveProperty('anima_guidance_scale')
  })

  it('the four sdxl_flow_* dead weights are gone from flowParams consumers', () => {
    for (const typeId of ['anima-lora', 'newbie-lora', 'krea2-lora']) {
      const keys = new Set(fieldsOf(typeId).map((f) => f.key))
      for (const key of ['sdxl_model_prediction_type', 'sdxl_flow_weighting_scheme', 'sdxl_flow_shift', 'sdxl_sigmoid_scale']) {
        expect(keys.has(key), `${typeId} still defines ${key}`).toBe(false)
      }
    }
  })

  it('anima-finetune drops unet_lr/text_encoder_lr (not read by its LR check)', () => {
    const keys = new Set(fieldsOf('anima-finetune').map((f) => f.key))
    expect(keys.has('unet_lr')).toBe(false)
    expect(keys.has('text_encoder_lr')).toBe(false)
    const payload = build('anima-finetune')
    expect(payload).not.toHaveProperty('unet_lr')
    expect(payload).not.toHaveProperty('text_encoder_lr')
  })
})

describe('A4: gdlokr/oft dropdown values are annotated against the backend mapping set', () => {
  it('lora_type options keep every backend-reachable value with indirect paths labelled', () => {
    const field = fieldsOf('anima-lora').find((f) => f.key === 'lora_type')
    const options = (field!.options as Array<string | { value: string; label?: string }>).map((o) =>
      typeof o === 'string' ? { value: o, label: o } : o,
    )
    const byValue = new Map(options.map((o) => [o.value, o]))
    expect(byValue.get('gdlokr')!.label).toMatch(/gdlokr_enabled/)
    expect(byValue.get('oft')!.label).toMatch(/diag-oft/)
    for (const value of ['lora', 'lora_plus', 'rs_lora', 'lora_fa', 'vera', 'tlora', 'flexrank', 'fera', 'locon', 'loha', 'lokr', 'glora', 'glokr', 'ia3', 'full', 'diag-oft']) {
      expect(byValue.has(value), `missing ${value}`).toBe(true)
    }
  })
})

describe('A6: multi-addift disabled, few-step annotated as lab probe, edit-model stays hidden', () => {
  it('anima-multi-addift is hidden + disabled with an explicit reason (zero backend schema/route)', () => {
    const entry = ALL_TRAINING_TYPES.find((t) => t.id === 'anima-multi-addift')
    expect(entry?.hidden).toBe(true)
    expect(entry?.disabled).toBe(true)
    expect(entry?.disabledReason).toBeTruthy()
  })

  it('anima-few-step-lora stays visible and carries the lab entry note', () => {
    const entry = ALL_TRAINING_TYPES.find((t) => t.id === 'anima-few-step-lora')
    expect(entry?.hidden).toBeUndefined()
    expect(entry?.disabled).toBeUndefined()
    expect(String(entry?.note)).toMatch(/lulynx-lab/)
  })

  it('few-step wizard routing only references keys that exist in the schema/lab contract', () => {
    const schemaKeys = new Set(fieldsOf('anima-few-step-lora').map((f) => f.key))
    const fewstepStep = sectionsOf('anima-few-step-lora').find((s) => s.id.endsWith('-few-step-distill-settings'))
    expect(fewstepStep).toBeTruthy()
    for (const deadKey of ['batch_size', 'learning_rate', 'distillation_loss_weight', 'teacher_lora_scope']) {
      expect(schemaKeys.has(deadKey), `dead override key ${deadKey} leaked into schema`).toBe(false)
    }
  })

  it('anima-edit-model remains hidden', () => {
    expect(ALL_TRAINING_TYPES.find((t) => t.id === 'anima-edit-model')?.hidden).toBe(true)
  })
})

describe('B: previously missing backend fields are exposed', () => {
  it('cache mode pair is exposed on lora and finetune with check-legal values', () => {
    for (const typeId of ['anima-lora', 'anima-finetune']) {
      const modeField = fieldsOf(typeId).find((f) => f.key === 'native_cache_mode')
      expect(modeField, `${typeId} native_cache_mode`).toBeTruthy()
      const values = (modeField!.options as Array<{ value: string }>).map((o) => o.value)
      for (const v of ['cache_first', 'online_cache', 'rebuild_cache', 'force_cache_only']) {
        expect(values, `${typeId} cache mode ${v}`).toContain(v)
      }
      const cached = fieldsOf(typeId).find((f) => f.key === 'anima_cached_training')
      expect(cached?.defaultValue, `${typeId} anima_cached_training default`).toBe(true)
    }
  })

  it('the anima cache pipeline knobs (resize/build/token-limit) are exposed', () => {
    const keys = new Set(fieldsOf('anima-lora').map((f) => f.key))
    for (const key of [
      'anima_cache_target_resolution',
      'anima_cache_resize_mode',
      'anima_cache_resize_max_edge',
      'anima_cache_build_batch_size',
      'anima_cache_build_prefetch',
      'anima_text_token_limit',
      'anima_cached_text_token_limit',
    ]) {
      expect(keys.has(key), `missing ${key}`).toBe(true)
    }
  })

  it('finetune exposes the five grouped learning rates consumed by check_learning_rates', () => {
    const keys = new Set(fieldsOf('anima-finetune').map((f) => f.key))
    for (const key of ['anima_self_attn_lr', 'anima_cross_attn_lr', 'anima_mlp_lr', 'anima_mod_lr', 'anima_llm_adapter_lr']) {
      expect(keys.has(key), `missing ${key}`).toBe(true)
    }
    const payload = build('anima-finetune', { anima_self_attn_lr: 1e-4 })
    expect(payload.anima_self_attn_lr).toBe(1e-4)
  })

  it('FG-LoRA non-all policies expose adapter_target_policy_profile_path', () => {
    const field = fieldsOf('anima-lora').find((f) => f.key === 'adapter_target_policy_profile_path')
    expect(field).toBeTruthy()
    expect(field!.visibleWhen?.({ adapter_target_policy: 'profiled' })).toBe(true)
    expect(field!.visibleWhen?.({ adapter_target_policy: 'all' })).toBe(false)
  })

  it('attn_mode gives anima an explicit attention entry that survives submit as intent', () => {
    for (const typeId of ['anima-lora', 'anima-finetune']) {
      const field = fieldsOf(typeId).find((f) => f.key === 'attn_mode')
      expect(field, `${typeId} attn_mode`).toBeTruthy()
      const values = (field!.options as Array<{ value: string }>).map((o) => o.value)
      for (const v of ['', 'sdpa', 'xformers', 'flash2', 'sageattn']) {
        expect(values, `${typeId} attn option ${v}`).toContain(v)
      }
    }
    const payload = build('anima-lora', { anima_vram_optimizer: true, attn_mode: 'flash2' })
    expect(payload.attention_backend).toBe('flash2')
    expect(payload.attn_mode).toBe('flash2')
    const auto = build('anima-lora', {})
    expect(auto).not.toHaveProperty('attn_mode')
  })
})

describe('C: single entry per key inside each anima type', () => {
  it.each([...ANIMA_TYPES])('%s has no duplicate field keys across sections', (typeId) => {
    const seen = new Map<string, string[]>()
    for (const section of sectionsOf(typeId)) {
      for (const field of section.fields) {
        if (field.type === 'ui_group') continue
        seen.set(field.key, [...(seen.get(field.key) ?? []), section.id])
      }
    }
    const dups = [...seen.entries()].filter(([, ids]) => ids.length > 1)
    expect(dups.map(([key, ids]) => `${key}@${ids.join('+')}`)).toEqual([])
  })
})

describe('D: layout regrouping', () => {
  it('flow/timestep parameters live in one merged card with the full nine-value domain', () => {
    const sections = sectionsOf('anima-lora')
    const card = sections.find((s) => s.id === 'timestep-sampling-settings')
    expect(card).toBeTruthy()
    const keys = new Set(card!.fields.map((f) => f.key))
    for (const key of ['timestep_sampling', 'discrete_flow_shift', 'anima_sigmoid_scale', 'anima_weighting_scheme', 'mode_scale', 'flow_logit_mean', 'flow_logit_std', 'anima_model_prediction_type', 'loss_type', 'smart_noise_enabled']) {
      expect(keys.has(key), `merged card missing ${key}`).toBe(true)
    }
    // bp_low 归 sampling-optimization 专家卡（含 bp_low_scale 的完整五键组）
    expect(keys.has('bp_low_enabled')).toBe(false)
    const samplingCard = sections.find((s) => s.id === 'sampling-optimization')
    expect(new Set(samplingCard!.fields.map((f) => f.key)).has('bp_low_scale')).toBe(true)
    // anima-params 不再重复挂 flow 键
    const animaParams = sections.find((s) => s.id === 'anima-params')!
    expect(animaParams.fields.some((f) => f.key === 'timestep_sampling')).toBe(false)
  })

  it('S_LORA_VARIANTS is mounted as an expert sub-card like SDXL', () => {
    const variants = sectionsOf('anima-lora').find((s) => s.id === 'lora-variants')
    expect(variants?.expert).toBe(true)
    const networkMain = sectionsOf('anima-lora').find((s) => s.id === 'network-settings')
    expect(networkMain!.fields.some((f) => f.key === 'dora_enabled')).toBe(false)
  })

  it('data_backend is owned by dataset-settings only', () => {
    const owners = sectionsOf('anima-lora')
      .filter((s) => s.fields.some((f) => f.key === 'data_backend'))
      .map((s) => s.id)
    expect(owners).toEqual(['dataset-settings'])
  })

  it('wizard routes anima grouped LRs and flow params into the core step', async () => {
    const { buildWizardProjection } = await import('@/pages/train/wizard/wizardModel')
    // 分组 LR 对 lora 挂在 expert 卡（向导不投影）；finetune 的非 expert 优化器卡必须落 core。
    const ft = buildWizardProjection('anima-finetune', createDefaultConfig('anima-finetune'))
    const ftCoreKeys = new Set(ft.steps.find((s) => s.id === 'core')!.fields.map((f) => f.key))
    for (const key of ['timestep_sampling', 'discrete_flow_shift', 'anima_weighting_scheme', 'anima_llm_adapter_lr', 'qwen3_max_token_length']) {
      expect(ftCoreKeys.has(key), `finetune ${key} should land in core`).toBe(true)
    }
    expect(ft.steps.find((s) => s.id === 'adapter')?.fields.some((f) => f.key === 'anima_llm_adapter_lr')).toBeFalsy()
    expect(ft.steps.find((s) => s.id === 'other-settings')?.fields.some((f) => f.key === 'anima_self_attn_lr')).toBeFalsy()
    const lora = buildWizardProjection('anima-lora', createDefaultConfig('anima-lora'))
    const loraCoreKeys = new Set(lora.steps.find((s) => s.id === 'core')!.fields.map((f) => f.key))
    for (const key of ['timestep_sampling', 'discrete_flow_shift', 'anima_weighting_scheme', 'loss_type']) {
      expect(loraCoreKeys.has(key), `lora ${key} should land in core`).toBe(true)
    }
  })

  it('shared nine-value timestep options stay in sync between the constant and merged card', () => {
    const field = fieldsOf('anima-lora').find((f) => f.key === 'timestep_sampling')
    expect(field!.options).toBe(ANIMA_TIMESTEP_SAMPLING_OPTIONS)
    expect(ANIMA_TIMESTEP_SAMPLING_OPTIONS.map((o) => o.value)).toEqual([
      'shift', 'sigma', 'uniform', 'sigmoid', 'logit_normal', 'flux_shift', 'qwen_shift', 'ideogram4_shift', 'logsnr',
    ])
  })
})
