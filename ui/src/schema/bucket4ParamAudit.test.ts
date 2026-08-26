// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 第 6 站桶（收官站，2026-08）全参数修正行为门禁：LTX23/LTX25、universal-dit、
// krea2、zimage、boogu、flux2、wan22。
//   A. P0 已解除：12 型后端已注册（webui_owned identity-only 薄壳）→ 入口可见，
//      数据定义保留不变
//   B. 幻影治理：boogu 三键 hidden+剥除 / wan22·flux2 bucket 键不暴露 /
//      krea2 aggressive 预设不再被 always-submit 默认值短路
//   C. 补暴露：wan22 视频 3 键、universal_dit forward/output JSON、zimage use_cache 转正
//   D. DoRA rider：zimage / wan22-TI2V(5B) / boogu-Base 单开关；krea2/flux2/edit/A14B 暂缓
//   E. 值域与显隐：boogu residency 对齐 block_offload、wan22-ft A14B×扩层互斥、
//      universal-dit 架构覆盖文案、七族 preview-settings 下架、FT save 对称过滤
//   F. 排版：ltx23 Flow Matching 移 training 页、krea2 vram_preset 移 offload 组顶、
//      wan22 双入口参数化派生
import { describe, expect, it } from 'vitest'
import {
  ALL_TRAINING_TYPES,
  TRAINING_TYPES,
  createDefaultConfig,
  getSectionsForType,
  buildRunConfig,
} from '@/schema/schemaIndex.js'
import { validateConfig } from '@/utils/configValidator'

const WEBUI_OWNED_12 = [
  'krea2-lora', 'flux2-lora', 'zimage-lora', 'wan22-ti2v-lora', 'wan22-t2v-a14b-lora',
  'boogu-lora', 'boogu-edit-lora', 'krea2-finetune', 'boogu-finetune', 'flux2-finetune',
  'zimage-finetune', 'wan22-finetune',
] as const

function sectionsOf(typeId: string) {
  return getSectionsForType(typeId)
}

function fieldsOf(typeId: string) {
  return sectionsOf(typeId).flatMap((section) => section.fields)
}

function fieldOf(typeId: string, key: string) {
  return fieldsOf(typeId).find((f) => f.key === key)
}

function sectionOf(typeId: string, id: string) {
  return sectionsOf(typeId).find((section) => section.id === id)
}

function build(typeId: string, patch: Record<string, unknown> = {}, explicitKeys?: ReadonlySet<string>) {
  return buildRunConfig({ ...createDefaultConfig(typeId), ...patch }, typeId, explicitKeys ? { explicitKeys } : undefined)
}

describe('A/P0 resolved: 12 webui-owned types are visible and keep full data definitions', () => {
  it('exposes all 12 types with no hidden/disabled gating (backend registered identity-only schemas)', () => {
    expect(TRAINING_TYPES.filter((t) => (WEBUI_OWNED_12 as readonly string[]).includes(t.id))).toHaveLength(12)
    for (const typeId of WEBUI_OWNED_12) {
      const entry = ALL_TRAINING_TYPES.find((t) => t.id === typeId)!
      expect(entry, typeId).toBeTruthy()
      expect(entry.hidden, typeId).toBeFalsy()
      expect(entry.disabled, typeId).toBeFalsy()
      expect(entry.disabledReason, typeId).toBeUndefined()
    }
  })

  it('keeps their schema data intact so the payload surface is unchanged', () => {
    for (const typeId of WEBUI_OWNED_12) {
      const sections = getSectionsForType(typeId)
      expect(sections.length, typeId).toBeGreaterThan(3)
      expect(fieldOf(typeId, 'model_train_type')?.defaultValue, typeId).toBe(typeId)
    }
  })
})

describe('B/phantom cleanup', () => {
  it('boogu task/text-length/cap phantoms are hidden and never reach the payload', () => {
    for (const typeId of ['boogu-lora', 'boogu-edit-lora']) {
      const task = fieldOf(typeId, 'boogu_task')
      expect(task?.type, typeId).toBe('hidden')
      const maxLen = fieldOf(typeId, 'boogu_max_text_length')
      expect(maxLen?.type, typeId).toBe('hidden')
    }
    expect(fieldOf('boogu-edit-lora', 'boogu_control_image_max_pixels')?.type).toBe('hidden')

    const payload = build('boogu-lora', { boogu_task: 't2i', boogu_max_text_length: 2048 })
    expect(payload).not.toHaveProperty('boogu_task')
    expect(payload).not.toHaveProperty('boogu_max_text_length')
    const editPayload = build('boogu-edit-lora', { boogu_control_image_max_pixels: 999999 })
    expect(editPayload).not.toHaveProperty('boogu_control_image_max_pixels')
  })

  it('wan22 drops the three bucket knobs (bucket matrix support=none)', () => {
    for (const typeId of ['wan22-ti2v-lora', 'wan22-t2v-a14b-lora', 'wan22-finetune']) {
      expect(fieldOf(typeId, 'enable_bucket'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'min_bucket_reso'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'max_bucket_reso'), typeId).toBeUndefined()
      expect(build(typeId), typeId).not.toHaveProperty('enable_bucket')
    }
  })

  it('flux2 drops the bucket knobs until BUCKET_TRAINING_MATRIX gains a flux2 row', () => {
    for (const typeId of ['flux2-lora', 'flux2-finetune']) {
      expect(fieldOf(typeId, 'enable_bucket'), typeId).toBeUndefined()
      expect(build(typeId), typeId).not.toHaveProperty('enable_bucket')
    }
  })

  it('krea2 aggressive preset is no longer short-circuited by always-submitted defaults', () => {
    // 后端只在「未显式设置」时按预设覆写 slots/prefetch/pin（configs.py:341-347）；
    // 提交层把仍等于 standard 档默认值的「未触碰注入默认」剥掉，让预设生效。
    const aggressive = build('krea2-lora', { krea2_vram_preset: 'aggressive' })
    expect(aggressive).not.toHaveProperty('krea2_block_offload_gpu_slots')
    expect(aggressive).not.toHaveProperty('krea2_block_offload_prefetch_depth')
    expect(aggressive).not.toHaveProperty('krea2_block_offload_pin_memory')
    // 用户显式改过的非默认值照常透传。
    const custom = build('krea2-lora', { krea2_vram_preset: 'aggressive', krea2_block_offload_gpu_slots: 8 })
    expect(custom.krea2_block_offload_gpu_slots).toBe(8)
    // standard 预设不受影响。
    const standard = build('krea2-lora')
    expect(standard.krea2_block_offload_gpu_slots).toBe(4)
    expect(standard.krea2_block_offload_prefetch_depth).toBe(2)
    expect(standard.krea2_block_offload_pin_memory).toBe(true)
  })

  it('krea2 aggressive keeps standard-tier values the user explicitly set (touched keys)', () => {
    // 表达力修复：aggressive 下用户显式要 standard 档数值不再被剥除——
    // 「未触碰的注入默认」才让位给预设；markExplicit 过的键按手填值出站，
    // 后端 model_fields_set 判定会尊重它们。逐键独立判定，未触碰的键仍被剥除。
    const touched = new Set([
      'krea2_block_offload_gpu_slots',
      'krea2_block_offload_pin_memory',
    ])
    const payload = build('krea2-lora', { krea2_vram_preset: 'aggressive' }, touched)
    expect(payload.krea2_block_offload_gpu_slots).toBe(4)
    expect(payload.krea2_block_offload_pin_memory).toBe(true)
    expect(payload).not.toHaveProperty('krea2_block_offload_prefetch_depth')
  })
})

describe('C/exposures', () => {
  it('wan22 exposes target_frames / frame_stride / fps aligned with backend defaults', () => {
    for (const typeId of ['wan22-ti2v-lora', 'wan22-t2v-a14b-lora']) {
      expect(fieldOf(typeId, 'wan22_target_frames')?.defaultValue, typeId).toBe(1)
      expect(fieldOf(typeId, 'wan22_frame_stride')?.defaultValue, typeId).toBe(1)
      expect(fieldOf(typeId, 'wan22_fps')?.defaultValue, typeId).toBe(16)
      const payload = build(typeId)
      expect(payload.wan22_target_frames, typeId).toBe(1)
      expect(payload.wan22_fps, typeId).toBe(16)
    }
  })

  it('universal-dit forwards forward_mapping/output_selector JSON only when probing runs a forward', () => {
    const mapping = fieldOf('sdxl-lora', 'universal_dit_forward_mapping_json')
    const selector = fieldOf('sdxl-lora', 'universal_dit_output_selector_json')
    expect(mapping).toBeTruthy()
    expect(selector).toBeTruthy()
    const base = createDefaultConfig('sdxl-lora')
    // 未开启 universal_dit_enabled 时不可见。
    expect(mapping!.visibleWhen!({ ...base })).toBe(false)
    // 开启但 probe_mode=static（不执行前向）时不可见。
    expect(mapping!.visibleWhen!({ ...base, universal_dit_enabled: true, universal_dit_probe_mode: 'static' })).toBe(false)
    // forward / train_smoke 下可见。
    expect(selector!.visibleWhen!({ ...base, universal_dit_enabled: true, universal_dit_probe_mode: 'forward' })).toBe(true)
    expect(selector!.visibleWhen!({ ...base, universal_dit_enabled: true, universal_dit_probe_mode: 'train_smoke' })).toBe(true)
  })

  it('wan22 sigma-stage routing stays intentionally unexposed (primary-only training makes it a no-op)', () => {
    for (const typeId of ['wan22-ti2v-lora', 'wan22-t2v-a14b-lora']) {
      expect(fieldOf(typeId, 'wan22_sigma_stage_routing'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'wan22_sigma_stage_boundary'), typeId).toBeUndefined()
    }
  })

  it('zimage use_cache defaults to true now that the npz contract has landed', () => {
    const field = fieldOf('zimage-lora', 'use_cache')
    expect(field!.defaultValue).toBe(true)
    expect(String(field!.desc)).toContain('*_zimage.npz')
    expect(String(field!.desc)).not.toContain('后续补齐')
    expect(build('zimage-lora').use_cache).toBe(true)
  })
})

describe('D/DoRA riders (single-toggle form)', () => {
  it('zimage / wan22-TI2V(5B only) / boogu-Base define dora_enabled; deferred families do not', () => {
    expect(fieldOf('zimage-lora', 'dora_enabled')).toBeTruthy()
    expect(fieldOf('boogu-lora', 'dora_enabled')).toBeTruthy()
    const wanRider = fieldOf('wan22-ti2v-lora', 'dora_enabled')
    expect(wanRider).toBeTruthy()
    // A14B 变体下 rider 隐藏（暂缓）。
    expect(wanRider!.visibleWhen!({ wan22_model_variant: 'ti2v-5b' })).toBe(true)
    expect(wanRider!.visibleWhen!({ wan22_model_variant: 't2v-a14b' })).toBe(false)
    for (const typeId of ['krea2-lora', 'boogu-edit-lora', 'flux2-lora', 'wan22-t2v-a14b-lora']) {
      expect(fieldOf(typeId, 'dora_enabled'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'use_dora'), typeId).toBeUndefined()
    }
  })

  it('enabling the rider submits both dora_enabled and use_dora route flags', () => {
    const payload = build('zimage-lora', { dora_enabled: true })
    expect(payload.dora_enabled).toBe(true)
    expect(payload.use_dora).toBe(true)
    const offPayload = build('zimage-lora')
    expect(offPayload.dora_enabled).toBe(false)
    expect(Boolean(offPayload.use_dora)).toBe(false)
  })

  it('finetune derivatives carry no adapter surface and thus no rider', () => {
    for (const typeId of ['zimage-finetune', 'wan22-finetune', 'boogu-finetune']) {
      expect(sectionOf(typeId, 'adapter-settings'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'dora_enabled'), typeId).toBeUndefined()
    }
  })
})

describe('E/value domains & visibility contradictions', () => {
  it('boogu residency default aligns with the backend honest default block_offload', () => {
    for (const typeId of ['boogu-lora', 'boogu-edit-lora']) {
      expect(fieldOf(typeId, 'boogu_block_residency')?.defaultValue, typeId).toBe('block_offload')
      expect(build(typeId).boogu_block_residency, typeId).toBe('block_offload')
    }
  })

  it('wan22 depth expansion hides under t2v-a14b and the validator auto-resets stale drafts', () => {
    const enabledField = fieldOf('wan22-finetune', 'wan22_depth_expansion_enabled')
    expect(enabledField).toBeTruthy()
    expect(enabledField!.visibleWhen!({ wan22_model_variant: 'ti2v-5b' })).toBe(true)
    expect(enabledField!.visibleWhen!({ wan22_model_variant: 't2v-a14b' })).toBe(false)
    // A14B 下扩层子字段不收集 → payload 不含 enabled。
    const payload = build('wan22-finetune', { wan22_model_variant: 't2v-a14b', wan22_depth_expansion_enabled: true })
    expect(payload.wan22_depth_expansion_enabled).toBeUndefined()

    const result = validateConfig(
      { ...createDefaultConfig('wan22-finetune'), wan22_model_variant: 't2v-a14b', wan22_depth_expansion_enabled: true },
      'wan22-finetune',
    )
    expect(result.autoFixes?.wan22_depth_expansion_enabled).toBe(false)
    expect(result.warnings.some((w) => w.message.includes('TI2V-5B'))).toBe(true)
    // TI2V 组合合法，无告警。
    const ok = validateConfig(
      { ...createDefaultConfig('wan22-finetune'), wan22_model_variant: 'ti2v-5b', wan22_depth_expansion_enabled: true },
      'wan22-finetune',
    )
    expect(ok.autoFixes?.wan22_depth_expansion_enabled).toBeUndefined()
  })

  it('universal-dit copy states architecture-level override instead of fallback probing', () => {
    const field = fieldOf('sdxl-lora', 'universal_dit_enabled')
    expect(String(field!.label)).not.toContain('fallback')
    expect(String(field!.desc)).toContain('架构硬覆盖')
  })

  it('preview/quality sections are taken down across the sampler-less families (kept hidden for drafts)', () => {
    for (const typeId of [
      'krea2-lora', 'krea2-finetune', 'flux2-lora', 'flux2-finetune', 'zimage-lora',
      'wan22-ti2v-lora', 'wan22-t2v-a14b-lora', 'wan22-finetune', 'boogu-lora', 'boogu-edit-lora',
    ]) {
      expect(sectionOf(typeId, 'preview-settings'), typeId).toBeUndefined()
      expect(fieldsOf(typeId).some((f) => f.key === 'enable_preview'), typeId).toBe(false)
      expect(build(typeId), typeId).not.toHaveProperty('enable_preview')
    }
    // ltx23 本就未挂 preview（对照）。
    expect(sectionOf('ltx23-lora', 'preview-settings')).toBeUndefined()
  })

  it('FT derivatives drop LoRA-only export artifacts (thin_svd_* / convrot groupsize)', () => {
    for (const typeId of ['krea2-finetune', 'boogu-finetune', 'flux2-finetune', 'zimage-finetune', 'wan22-finetune']) {
      expect(fieldOf(typeId, 'thin_svd_export_enabled'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'thin_svd_export_rank'), typeId).toBeUndefined()
      expect(fieldOf(typeId, 'export_comfy_int8_groupsize'), typeId).toBeUndefined()
    }
    // LoRA 入口保留这些导出件。
    expect(fieldOf('krea2-lora', 'thin_svd_export_enabled')).toBeTruthy()
  })
})

describe('F/layout regrouping', () => {
  it('ltx23 flow-matching group moves to the training tab (mirrors backend schema layout)', () => {
    for (const typeId of ['ltx23-lora', 'ltx25-lora', 'ltx25-finetune']) {
      const flow = sectionOf(typeId, 'ltx23-flow-matching')
      expect(flow?.tab, typeId).toBe('training')
      expect(flow?.fields.map((f) => f.key)).toEqual([
        'ltx23_timestep_sampling', 'ltx23_discrete_flow_shift', 'ltx23_isolate_modalities', 'ltx23_fps',
      ])
    }
    // model-settings 不再承载这四键。
    const modelKeys = sectionOf('ltx23-lora', 'model-settings')!.fields.map((f) => f.key)
    expect(modelKeys).not.toContain('ltx23_timestep_sampling')
  })

  it('krea2 vram_preset sits at the top of the offload section it overrides', () => {
    const offload = sectionOf('krea2-lora', 'krea2-offload-settings')
    expect(offload?.fields[0]?.key).toBe('krea2_vram_preset')
    expect(sectionOf('krea2-lora', 'model-settings')!.fields.some((f) => f.key === 'krea2_vram_preset')).toBe(false)
    // FT 派生同步。
    const ftOffload = sectionOf('krea2-finetune', 'krea2-offload-settings')
    expect(ftOffload?.fields[0]?.key).toBe('krea2_vram_preset')
  })

  it('wan22 A14B entry derives from the same builder as TI2V with only documented deltas', () => {
    const ti2v = sectionsOf('wan22-ti2v-lora').map((s) => s.id)
    const a14b = sectionsOf('wan22-t2v-a14b-lora').map((s) => s.id)
    expect(a14b).toEqual(ti2v)
    // 差异仅在默认值：变体与 flow shift。
    expect(createDefaultConfig('wan22-t2v-a14b-lora').wan22_model_variant).toBe('t2v-a14b')
    expect(createDefaultConfig('wan22-t2v-a14b-lora').wan22_discrete_flow_shift).toBe(12.0)
    expect(createDefaultConfig('wan22-ti2v-lora').wan22_discrete_flow_shift).toBe(5.0)
    // A14B offload 基线 slots=2 / prefetch=1。
    expect(createDefaultConfig('wan22-t2v-a14b-lora').wan22_block_offload_gpu_slots).toBe(2)
    expect(createDefaultConfig('wan22-t2v-a14b-lora').wan22_block_offload_prefetch_depth).toBe(1)
  })
})
