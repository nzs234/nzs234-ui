// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 新字段暴露 / 幻影键改名 / 互锁规则的 schema 层契约测试（2026-08 漂移审计跟进）。
 */

import { describe, expect, it } from 'vitest'
import {
  TRAINING_TYPES,
  getSectionsForType,
  buildRunConfig,
  createDefaultConfig,
} from './schemaIndex.js'
import schemaFieldLabelsEn from '@/i18n/schemaFieldLabelsEn.json'
import schemaFieldDescsEn from '@/i18n/schemaFieldDescsEn.json'

const labelPack = schemaFieldLabelsEn as unknown as Record<string, string>
const descPack = schemaFieldDescsEn as unknown as Record<string, string>

function fieldsOf(typeId: string) {
  return getSectionsForType(typeId).flatMap((section) => section.fields || [])
}

function fieldOf(typeId: string, key: string) {
  return fieldsOf(typeId).find((field) => field.key === key)
}

function optionValues(field: { options?: unknown } | undefined): string[] {
  if (!field || field.options == null) return []
  const raw = Array.isArray(field.options) ? field.options : []
  return raw.map((option) => (option && typeof option === 'object' ? String((option as { value: unknown }).value) : String(option)))
}

const VISIBLE_TYPES = TRAINING_TYPES.filter((type) => !type.hidden)

describe('T-LoRA rank schedule exposes the full backend support set', () => {
  it('every visible copy offers constant/linear/cosine/geometric (cosine promoted upstream)', () => {
    let copies = 0
    for (const type of VISIBLE_TYPES) {
      const field = fieldOf(type.id, 'tlora_rank_schedule')
      if (!field) continue
      copies += 1
      expect(optionValues(field)).toEqual(['constant', 'linear', 'cosine', 'geometric'])
      expect(field.defaultValue).toBe('constant')
    }
    expect(copies).toBeGreaterThanOrEqual(2)
  })
})

describe('anima phantom train_norm renamed to lycoris_train_norm', () => {
  it.each(['anima-lora'])('%s: no train_norm key remains; lycoris_train_norm ships', (typeId) => {
    const keys = new Set(fieldsOf(typeId).map((field) => field.key))
    expect(keys.has('train_norm')).toBe(false)
    expect(keys.has('lycoris_train_norm')).toBe(true)
    const field = fieldOf(typeId, 'lycoris_train_norm')
    expect(field?.type).toBe('boolean')
    expect(field?.defaultValue).toBe(false)
  })

  it('anima-finetune never carried the phantom and gains nothing stale', () => {
    const keys = new Set(fieldsOf('anima-finetune').map((field) => field.key))
    expect(keys.has('train_norm')).toBe(false)
  })

  it('lycoris_train_norm reaches the payload unchanged on anima routes', () => {
    const config = { ...createDefaultConfig('anima-lora'), lycoris_train_norm: true }
    const payload = buildRunConfig(config as Record<string, unknown>, 'anima-lora')
    expect(payload.lycoris_train_norm).toBe(true)
    expect(payload.train_norm).toBeUndefined()
  })
})

describe('tlora_enabled dead-key purge (real name t_lora_enabled)', () => {
  it('lora_type=tlora (anima selector) materializes t_lora_enabled and strips the legacy key', () => {
    const payload = buildRunConfig({ lora_type: 'tlora', tlora_enabled: true }, 'anima-lora')
    expect(payload.t_lora_enabled).toBe(true)
    expect(payload.tlora_enabled).toBeUndefined()
  })

  it('network_module=networks.tlora (sdxl selector) resolves through the renamed master flag', () => {
    const payload = buildRunConfig({ network_module: 'networks.tlora' }, 'sdxl-lora')
    expect(payload.t_lora_enabled).toBe(true)
    expect(payload.tlora_enabled).toBeUndefined()
  })

  it('non-tlora drafts ship t_lora_enabled=false instead of the dead key', () => {
    const payload = buildRunConfig(createDefaultConfig('sdxl-lora') as Record<string, unknown>, 'sdxl-lora')
    expect(payload.t_lora_enabled).toBe(false)
    expect(payload.tlora_enabled).toBeUndefined()
  })
})

describe('new backend capabilities exposed in the UI (P1 follow-ups)', () => {
  it('newbie_sigma_schedule: standard|lulynx, default standard on newbie-lora only', () => {
    const field = fieldOf('newbie-lora', 'newbie_sigma_schedule')
    expect(field, 'newbie-lora should expose sigma schedule').toBeTruthy()
    expect(optionValues(field!)).toEqual(['standard', 'lulynx'])
    expect(field!.defaultValue).toBe('standard')
    // 其他类型不得误挂该键（后端仅 Newbie 分支消费）。
    for (const typeId of ['sdxl-lora', 'anima-lora']) {
      expect(fieldOf(typeId, 'newbie_sigma_schedule'), typeId).toBeUndefined()
    }
  })

  it('preview solver sample_algorithm/sample_sde_eta mirror configs_monitoring defaults', () => {
    for (const typeId of ['sdxl-lora', 'anima-lora']) {
      const algorithm = fieldOf(typeId, 'sample_algorithm')
      const eta = fieldOf(typeId, 'sample_sde_eta')
      expect(algorithm, `${typeId} sample_algorithm`).toBeTruthy()
      expect(optionValues(algorithm!)).toEqual(['sde', 'ode'])
      expect(algorithm!.defaultValue).toBe('sde')
      expect(eta, `${typeId} sample_sde_eta`).toBeTruthy()
      expect(eta!.defaultValue).toBe(1)
    }
  })

  it('anima_faithful_degrade_policy: fail|warn, default fail, gated by faithful forward', () => {
    const field = fieldOf('anima-lora', 'anima_faithful_degrade_policy')
    expect(field).toBeTruthy()
    expect(optionValues(field!)).toEqual(['fail', 'warn'])
    expect(field!.defaultValue).toBe('fail')
    expect(typeof field!.visibleWhen).toBe('function')
    // 关闭忠实前向时降级策略不可见；开启时可见。
    expect(field!.visibleWhen!({ anima_faithful_forward: false })).toBe(false)
    expect(field!.visibleWhen!({ anima_faithful_forward: true })).toBe(true)
  })

  it('trajectory_variant family rides the canonical distillation gate (dp_dmd_turbo)', () => {
    for (const typeId of ['sdxl-lora', 'universal-dit-lora']) {
      const variant = fieldOf(typeId, 'trajectory_variant')
      if (!variant) continue
      expect(optionValues(variant)).toEqual(['two_step', 'sparse'])
      expect(variant.defaultValue).toBe('two_step')
      const sparseSteps = fieldOf(typeId, 'trajectory_sparse_steps')!
      expect(sparseSteps.min).toBe(2)
      expect(sparseSteps.defaultValue).toBe(4)
      const mixRatio = fieldOf(typeId, 'trajectory_mix_ratio')!
      expect(mixRatio.min).toBe(0)
      expect(mixRatio.max).toBe(1)
      expect(mixRatio.defaultValue).toBe(1)
      return
    }
    throw new Error('no type exposes trajectory_variant — check the distillation block mounting')
  })
})

describe('glokr_factor exposes the LyCORIS GLoKr Kronecker factor (LoKr sibling)', () => {
  it('ships beside lokr_factor with -1 auto default, gated on algo=glokr', () => {
    const field = fieldOf('sdxl-lora', 'glokr_factor')
    expect(field, 'sdxl-lora should expose glokr_factor').toBeTruthy()
    expect(field!.type).toBe('number')
    expect(field!.defaultValue).toBe(-1)
    expect(field!.min).toBe(-1)
    expect(typeof field!.visibleWhen).toBe('function')
    expect(field!.visibleWhen!({ network_module: 'lycoris.kohya', lycoris_algo: 'glokr' })).toBe(true)
    expect(field!.visibleWhen!({ network_module: 'lycoris.kohya', lycoris_algo: 'lokr' })).toBe(false)
    expect(field!.visibleWhen!({ network_module: 'networks.lora', lycoris_algo: 'glokr' })).toBe(false)
  })

  it('reaches the payload unchanged on the lycoris glokr route', () => {
    const config = {
      ...createDefaultConfig('sdxl-lora'),
      network_module: 'lycoris.kohya',
      lycoris_algo: 'glokr',
      glokr_factor: 4,
    } as Record<string, unknown>
    const payload = buildRunConfig(config, 'sdxl-lora')
    expect(payload.glokr_factor).toBe(4)
  })
})

describe('ui_group factory ids are explicit and collision-free', () => {
  it('the four shared factories emit distinct ascii keys and keep EN packs resolvable', () => {
    const expectedKeys = [
      '__ui_group_lycoris_structure',
      '__ui_group_lycoris_regularization',
      '__ui_group_lokr_params',
      '__ui_group_prefix_protection',
      '__ui_group_entity_injectors',
      '__ui_group_dora_variant_frontier',
    ]
    const seen = new Set<string>()
    for (const type of VISIBLE_TYPES) {
      for (const field of fieldsOf(type.id)) {
        if (field.type !== 'ui_group') continue
        seen.add(field.key)
        expect(field.key.startsWith('__ui_group_'), field.key).toBe(true)
        // 纯中文标题折叠出的碰撞键必须绝迹。
        expect(field.key).not.toBe('__ui_group_')
      }
    }
    for (const key of expectedKeys) expect(seen.has(key), `${key} missing`).toBe(true)
    for (const key of seen) {
      expect(labelPack[key], `${key} label_en`).toBeTruthy()
      expect(descPack[key], `${key} desc_en`).toBeTruthy()
    }
  })
})
