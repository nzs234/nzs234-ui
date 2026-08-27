// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
//
// wizardRoutingAudit — 2026-08 全类型路由审计的锁定测试。
//
// 背景：fieldBucket 的正则启发式存在「抢键」先例（GOAL 的 /preset/ 抢走
// lycoris_preset）。本文件把审计结论钉住：
//   1. 全量扫描（40 可见类型 × 默认 config + 家族选中 config + 门控子参数启用
//      config）中，每个新钉键只要可见就必须落在期望步骤；
//   2. 每个新钉键至少在一个扫描变体里可见（防死钉/防拼写漂移）；
//   3. GOAL/OUTPUT/PREVIEW/TI-token 抢键的已知受害面逐一回归（含 lycoris_preset
//      防退化）。
// 期望桶的依据 = 字段所属 schema section 的语义（optimizer-settings→core、
// speed 页签各族→performance、validation/preview-settings→preview、caption
// 族→dataset 等），与 wizardModel.ts 钉表内的逐键注释一一对应。

import { describe, expect, it } from 'vitest'
import { TRAINING_TYPES, createDefaultConfig } from '@/schema/schemaIndex.js'
import { normalizeAdapterEntityMutex } from '@/schema/schemaCommon.js'
import { adapterOptions, buildAdapterSelection } from './adapterModel'
import { buildWizardProjection, type WizardProjection, type WizardStepId } from './wizardModel'

function stepForField(projection: WizardProjection, key: string): WizardStepId | undefined {
  const step = projection.steps.find((entry) => entry.fields.some((field) => field.key === key))
  return step?.id
}

function expectRoutedTo(typeId: string, key: string, expected: WizardStepId, config?: Record<string, unknown>): void {
  const projection = buildWizardProjection(typeId, config ?? createDefaultConfig(typeId))
  expect(stepForField(projection, key), `${typeId}: ${key} should land in ${expected}`).toBe(expected)
}

// 新钉键 → 期望步骤（与 wizardModel.ts 2026-08 审计批次一一对应）。
const PINNED_ROUTING: Record<string, WizardStepId> = {
  // adapter（网络结构，network/adapter/head-settings 语义）
  scale_weight_norms: 'adapter',
  enable_base_weight: 'adapter',
  pissa_init: 'adapter',
  train_norm: 'adapter',
  bypass_mode: 'adapter',
  layered_alpha_enabled: 'adapter',
  alpha_self_attn: 'adapter',
  alpha_cross_attn: 'adapter',
  alpha_mlp: 'adapter',
  alpha_adaln: 'adapter',
  mora_enabled: 'adapter',
  newbie_target_modules: 'adapter',
  target_modules: 'adapter',
  hidden_dims: 'adapter',
  freeze_extractors: 'adapter',
  include_waifu_score: 'adapter',
  // files（模型文件与获取方式）
  ae: 'files',
  v2: 'files',
  llm_path: 'files',
  projector_path: 'files',
  boogu_model_version: 'files',
  flux2_model_version: 'files',
  wan22_model_variant: 'files',
  wan22_noise_stage: 'files',
  h3_partition: 'files',
  universal_dit_allow_remote_download: 'files',
  universal_dit_trust_remote_code: 'files',
  // dataset（caption / 数据读取 / 视频帧采样）
  keep_tokens: 'dataset',
  keep_tokens_separator: 'dataset',
  max_token_length: 'dataset',
  random_triggers: 'dataset',
  random_triggers_position: 'dataset',
  random_triggers_probability: 'dataset',
  nl_dropout_rate: 'dataset',
  oom_skip_batch_enabled: 'dataset',
  oom_skip_batch_max_consecutive: 'dataset',
  albumentations_enabled: 'dataset',
  dataloader_num_workers: 'dataset',
  enable_mixed_resolution_training: 'dataset',
  resolution_aware_batch_enabled: 'dataset',
  h3_frame_count: 'dataset',
  h3_fps: 'dataset',
  ltx23_frame_stride: 'dataset',
  ltx23_target_frames: 'dataset',
  wan22_frame_stride: 'dataset',
  wan22_target_frames: 'dataset',
  wan22_fps: 'dataset',
  // core（优化器 / 损失 / 噪声 / 时间步 / 训练范围）
  unet_lr: 'core',
  text_encoder_lr: 'core',
  min_snr_gamma: 'core',
  huber_c: 'core',
  huber_schedule: 'core',
  huber_scale: 'core',
  gradient_guard_strategy: 'core',
  max_grad_norm: 'core',
  train_length_mode: 'core',
  v_parameterization: 'core',
  loss_type: 'core',
  guidance_scale: 'core',
  discrete_flow_shift: 'core',
  t5xxl_max_token_length: 'core',
  flow_model: 'core',
  masked_loss: 'core',
  alpha_mask: 'core',
  initial_step: 'core',
  skip_until_initial_step: 'core',
  adaptive_noise_scale: 'core',
  ip_noise_gamma: 'core',
  ip_noise_gamma_random_strength: 'core',
  multires_noise_discount: 'core',
  multires_noise_iterations: 'core',
  immiscible_diffusion_enabled: 'core',
  p2_weighting_mode: 'core',
  stepped_loss_enabled: 'core',
  smart_noise_enabled: 'core',
  smart_noise_logsnr_focus: 'core',
  smart_noise_focus_strength: 'core',
  smart_noise_focus_spread: 'core',
  lulynx_weight_noise_enabled: 'core',
  lulynx_weight_noise_mode: 'core',
  lulynx_weight_noise_sigma: 'core',
  lulynx_weight_noise_bound_norm: 'core',
  lulynx_weight_noise_log_every: 'core',
  anima_faithful_forward: 'core',
  anima_faithful_degrade_policy: 'core',
  flow_uncertainty_weighting_enabled: 'core',
  newbie_sigma_schedule: 'core',
  anima_text_token_limit: 'core',
  anima_cached_text_token_limit: 'core',
  anima_depth_expansion_enabled: 'core',
  anima_depth_expansion_target_layers: 'core',
  anima_depth_expansion_train_scope: 'core',
  krea2_depth_expansion_enabled: 'core',
  krea2_depth_expansion_target_layers: 'core',
  krea2_depth_expansion_train_scope: 'core',
  flux2_depth_expansion_enabled: 'core',
  zimage_depth_expansion_enabled: 'core',
  wan22_depth_expansion_enabled: 'core',
  boogu_depth_expansion_enabled: 'core',
  h3_depth_expansion_enabled: 'core',
  krea2_training_mode: 'core',
  krea2_text_fusion_mode: 'core',
  wan22_expert_timestep_preset: 'core',
  ltx23_discrete_flow_shift: 'core',
  ltx23_isolate_modalities: 'core',
  wan22_discrete_flow_shift: 'core',
  zimage_discrete_flow_shift: 'core',
  wan22_max_text_length: 'core',
  zimage_max_text_length: 'core',
  ltx23_max_text_length: 'core',
  h3_audio_loss_weight: 'core',
  h3_audio_sigma_shift: 'core',
  h3_cfg_preservation_enabled: 'core',
  h3_cfg_scale: 'core',
  h3_cfg_schedule: 'core',
  h3_condition_noise_clean: 'core',
  h3_unconditional_prompt: 'core',
  h3_video_only: 'core',
  h3_video_sigma_shift: 'core',
  // preview（验证 / 评估）
  eval_batch_size: 'preview',
  eval_data_dir: 'preview',
  validate_every_n_steps: 'preview',
  validate_every_n_epochs: 'preview',
  max_validation_steps: 'preview',
  quality_evaluation_enabled: 'preview',
  quality_evaluation_xy_grid: 'preview',
  quality_evaluation_num_samples: 'preview',
  quality_evaluation_suite_id: 'preview',
  quality_evaluation_validation_seeds: 'preview',
  quality_evaluation_compare_base: 'preview',
  quality_evaluation_metric_weights: 'preview',
  quality_evaluation_metrics: 'preview',
  quality_evaluation_validation_prompts: 'preview',
  fid_real_image_dir: 'preview',
  preference_scoring_enabled: 'preview',
  preference_models: 'preview',
  // performance（显存 / 加速 / 缓存 / 精度 / 量化 / 散热）
  weight_compression_preset: 'performance',
  train_quant_preset: 'performance',
  krea2_vram_preset: 'performance',
  cache_text_encoder_outputs: 'performance',
  cache_text_encoder_outputs_to_disk: 'performance',
  h3_cache_text_encoder_outputs: 'performance',
  h3_cache_max_samples: 'performance',
  full_fp16: 'performance',
  full_bf16: 'performance',
  no_half_vae: 'performance',
  fp8_base: 'performance',
  fp8_base_unet: 'performance',
  sdxl_unet_backend: 'performance',
  attn_mode: 'performance',
  disable_mmap_load_safetensors: 'performance',
  lowram: 'performance',
  pytorch_cuda_expandable_segments: 'performance',
  gradient_release_enabled: 'performance',
  gradient_release_mode: 'performance',
  gradient_release_grad_clip_mode: 'performance',
  gradient_release_downgrade_reason: 'performance',
  memory_reclaim_interval_steps: 'performance',
  optimizer_state_paging_enabled: 'performance',
  vram_smart_sensing_baseline_steps: 'performance',
  vram_smart_sensing_window_steps: 'performance',
  model_to_condition_enabled: 'performance',
  activation_compression_enabled: 'performance',
  split_attn: 'performance',
  vae_chunk_size: 'performance',
  lora_activation_recompute_mode: 'performance',
  h3_int8_gemm_mode: 'performance',
  h3_load_direct_to_device: 'performance',
  h3_te_layer_streaming: 'performance',
  h3_prune_adaln_on_load: 'performance',
  h3_preserve_lora_master_dtype: 'performance',
  vae_batch_size: 'performance',
  text_encoder_batch_size: 'performance',
  persistent_data_loader_workers: 'performance',
  quant_train_mode: 'performance',
  quant_requantize_policy: 'performance',
  weight_compression_enabled: 'performance',
  lulynx_optimization_enabled: 'performance',
  lulynx_steady_accel: 'performance',
  performance_expert_mode: 'performance',
  enhanced_protection_mode: 'performance',
  vortex_enabled: 'performance',
  pcie_transfer_format: 'performance',
  newbie_safe_fallback: 'performance',
  cooldown_every_n_epochs: 'performance',
  cooldown_minutes: 'performance',
  cooldown_until_temp_c: 'performance',
  cooldown_poll_seconds: 'performance',
  gpu_power_limit_w: 'performance',
  gpu_duty_cycle: 'performance',
  gpu_target_temp_c: 'performance',
  gpu_lock_clocks_mhz: 'performance',
  gpu_circuit_enabled: 'performance',
  gpu_circuit_poll_interval_steps: 'performance',
  gpu_circuit_temp_c: 'performance',
  gpu_circuit_temp_warn_c: 'performance',
  gpu_circuit_vram_util_pct: 'performance',
  gpu_circuit_trip_on_throttle: 'performance',
  gpu_circuit_trip_on_ecc: 'performance',
  gpu_circuit_device_index: 'performance',
  anima_block_residency: 'performance',
  newbie_block_residency: 'performance',
  newbie_block_residency_min_params: 'performance',
  krea2_block_residency: 'performance',
  krea2_resident_block_count: 'performance',
  flux2_block_residency: 'performance',
  zimage_block_residency: 'performance',
  wan22_block_residency: 'performance',
  ltx23_block_residency: 'performance',
  triton_ops_enabled: 'performance',
  model_fused_qkv: 'performance',
  anima_vram_optimizer: 'performance',
  anima_progressive_full_finetune_enabled: 'performance',
  anima_rematerializable_block_enabled: 'performance',
  anima_cache_build_batch_size: 'performance',
  anima_cache_target_resolution: 'performance',
  newbie_cache_build_batch_size: 'performance',
  newbie_clip_max_token_length: 'performance',
  newbie_gemma_max_token_length: 'performance',
  newbie_caption_length_bucket_size: 'performance',
  // output（产物元数据）
  metadata_note: 'output',
  no_metadata: 'output',
  training_comment: 'output',
  // controlnet / distiller / fewstep
  lllite_skip_output_blocks: 'controlnet',
  allow_tokenizer_only_clip: 'distiller',
  student_steps: 'fewstep',
  teacher_steps: 'fewstep',
  teacher_scheduler: 'fewstep',
  student_scheduler: 'fewstep',
  // 类型特异钉（TYPE_OWNERSHIP_OVERRIDES；键为多类型共享，期望只在对应类型成立，
  // 放在下方 targeted 用例断言，不进全类型扫描表）。
  loss: 'core',
  num_workers: 'core',
  target_dims: 'dataset',
  train_split: 'dataset',
  val_split: 'dataset',
  val_ratio: 'dataset',
  steps: 'distiller',
}

// TYPE_OWNERSHIP_OVERRIDES 先于 GLOBAL 钉生效：这些类型对同键有更早的既有钉，
// 全类型扫描时按类型覆盖期望值。
const PINNED_ROUTING_EXCEPTIONS: Record<string, Record<string, WizardStepId>> = {
  'sdxl-turbo-lora': { guidance_scale: 'fewstep' },
  'anima-few-step-lora': { guidance_scale: 'fewstep' },
  'newbie-few-step-lora': { guidance_scale: 'fewstep' },
  'lab-distiller': { guidance_scale: 'distiller' },
}

// 门控子参数的启用开关：扫描时一并置真，让 visibleWhen 门控的家族子参数露出，
// 从而「每个钉键至少可见一次」的断言覆盖到全部钉键。
const GATE_KEYS: Record<string, unknown> = {
  gpu_circuit_enabled: true,
  quality_evaluation_enabled: true,
  preference_scoring_enabled: true,
  smart_noise_enabled: true,
  lulynx_weight_noise_enabled: true,
  layered_alpha_enabled: true,
  anima_depth_expansion_enabled: true,
  krea2_depth_expansion_enabled: true,
  h3_cfg_preservation_enabled: true,
}

describe('wizard routing audit (2026-08 full-type scan)', () => {
  it('routes every visible instance of a pinned key to its expected step', () => {
    const visibleTypes = TRAINING_TYPES.filter((type: { hidden?: boolean; disabled?: boolean }) => !type.hidden && !type.disabled)
    expect(visibleTypes).toHaveLength(40)
    const seen = new Set<string>()

    for (const type of visibleTypes) {
      const base = createDefaultConfig(type.id)
      const variants: Array<Record<string, unknown>> = [base, { ...base, ...GATE_KEYS }]
      for (const option of adapterOptions(base, type.id)) {
        variants.push(normalizeAdapterEntityMutex({
          ...base,
          ...buildAdapterSelection(base, option),
        }) as Record<string, unknown>)
      }
      for (const config of variants) {
        const projection = buildWizardProjection(type.id, config)
        for (const field of projection.visibleFields) {
          const expected = PINNED_ROUTING_EXCEPTIONS[type.id]?.[field.key] ?? PINNED_ROUTING[field.key]
          if (!expected) continue
          seen.add(field.key)
          const actual = stepForField(projection, field.key)
          expect(actual, `${type.id}: pinned key ${field.key} landed in ${actual}, expected ${expected}`).toBe(expected)
        }
      }
    }

    // 每个钉键都必须在至少一个扫描变体里真实可见——防死钉、防键名拼写漂移。
    const unseen = Object.keys(PINNED_ROUTING).filter((key) => !seen.has(key))
    expect(unseen, `pinned keys never visible in any scanned projection: ${unseen.join(', ')}`).toEqual([])
  })

  it('keeps lycoris_preset in the adapter step (original GOAL-regex victim)', () => {
    // 选中 LyCORIS 家族（lokr）后 lycoris_preset 才可见；防退化基准。
    const base = createDefaultConfig('sdxl-lora')
    const lokr = adapterOptions(base, 'sdxl-lora').find((option) => option.family === 'lokr')
    expect(lokr).toBeTruthy()
    const config = normalizeAdapterEntityMutex({ ...base, ...buildAdapterSelection(base, lokr!) }) as Record<string, unknown>
    expectRoutedTo('sdxl-lora', 'lycoris_preset', 'adapter', config)
  })

  it('keeps remaining GOAL-regex victims out of the goal step', () => {
    // /preset/ 抢键的其余受害面：压缩/量化/显存档位与时间步先验都不是「训练目标」。
    expectRoutedTo('sdxl-lora', 'weight_compression_preset', 'performance')
    expectRoutedTo('flux-lora', 'train_quant_preset', 'performance')
    expectRoutedTo('krea2-lora', 'krea2_vram_preset', 'performance')
    expectRoutedTo('wan22-t2v-a14b-lora', 'wan22_expert_timestep_preset', 'core')
    const goal = buildWizardProjection('sdxl-lora', createDefaultConfig('sdxl-lora')).steps.find((step) => step.id === 'goal')
    for (const step of goal?.fields ?? []) {
      expect(/preset/i.test(step.key), `goal step must not capture preset-named key ${step.key}`).toBe(false)
    }
  })

  it('keeps OUTPUT-regex victims out of the output step', () => {
    // '_output' 抢键：TE 输出缓存属于缓存管线；LLLite 跳块属于 ControlNet 结构。
    expectRoutedTo('sdxl-lora', 'cache_text_encoder_outputs', 'performance')
    expectRoutedTo('sdxl-lora', 'cache_text_encoder_outputs_to_disk', 'performance')
    expectRoutedTo('minimax-h3-lora', 'h3_cache_text_encoder_outputs', 'performance')
    expectRoutedTo('sdxl-controlnet-lllite', 'lllite_skip_output_blocks', 'controlnet')
  })

  it('keeps TI-token and CORE-token victims on their semantic steps', () => {
    // 'token' 抢键把 caption 族扣离 dataset；'batch_size'/'steps'/'epochs' 抢键
    // 把验证调度扣在 core、把热控扣离 performance。
    expectRoutedTo('sdxl-lora', 'keep_tokens', 'dataset')
    expectRoutedTo('sdxl-lora', 'max_token_length', 'dataset')
    expectRoutedTo('sdxl-lora', 'eval_batch_size', 'preview')
    expectRoutedTo('sdxl-lora', 'validate_every_n_steps', 'preview')
    expectRoutedTo('sdxl-lora', 'cooldown_every_n_epochs', 'performance')
    expectRoutedTo('sdxl-lora', 'memory_reclaim_interval_steps', 'performance')
    // 'lora' 抢键：dtype 保持与激活重算是显存参数，不是网络结构。
    expectRoutedTo('minimax-h3-lora', 'h3_preserve_lora_master_dtype', 'performance')
    expectRoutedTo('anima-lora', 'lora_activation_recompute_mode', 'performance')
  })

  it('keeps optimizer/loss family together in the core step', () => {
    expectRoutedTo('sdxl-lora', 'unet_lr', 'core')
    expectRoutedTo('sdxl-lora', 'text_encoder_lr', 'core')
    expectRoutedTo('sdxl-lora', 'min_snr_gamma', 'core')
    expectRoutedTo('sdxl-lora', 'huber_c', 'core')
    expectRoutedTo('sdxl-lora', 'gradient_guard_strategy', 'core')
    // max_grad_norm 在 sdxl-lora 住 expert 面（向导不投影），在 newbie/controlnet 可见。
    expectRoutedTo('newbie-lora', 'max_grad_norm', 'core')
    expectRoutedTo('sd-controlnet', 'max_grad_norm', 'core')
    // turbo-distill-settings 的步数上限与 batch_size/learning_rate 既有钉同批落 fewstep
    // （newbie-lora 的同名键住 training-settings，core 落点不受本钉影响）。
    expectRoutedTo('sdxl-turbo-lora', 'max_train_steps', 'fewstep')
  })

  it('lands model identity/version selectors in the files step', () => {
    expectRoutedTo('flux-lora', 'ae', 'files')
    expectRoutedTo('sd-lora', 'v2', 'files')
    expectRoutedTo('boogu-lora', 'boogu_model_version', 'files')
    expectRoutedTo('wan22-ti2v-lora', 'wan22_model_variant', 'files')
    expectRoutedTo('minimax-h3-lora', 'h3_partition', 'files')
    expectRoutedTo('universal-dit-lora', 'universal_dit_allow_remote_download', 'files')
  })
})
