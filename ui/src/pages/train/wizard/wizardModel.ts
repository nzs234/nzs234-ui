// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import type { SchemaField, SchemaSection } from '@/schema/schemaIndex'
import {
  ALL_TRAINING_TYPES,
  TRAINING_TYPES,
  getFieldDefinition,
  getSectionsForType,
  isFieldVisible,
} from '@/schema/schemaIndex.js'
import { resolveTrainingInputs, inputGroupLabel } from './trainingInputs'
import { translate } from '@/i18n/useI18n'

export type WizardCategory =
  | 'lora'
  | 'finetune'
  | 'controlnet'
  | 'textual_inversion'
  | 'specialized'
  | 'other'

export type WizardStepId =
  | 'type'
  | 'model'
  | 'adapter'
  | 'files'
  | 'dataset'
  | 'controlnet'
  | 'yolo'
  | 'goal'
  | 'core'
  | 'ti-token'
  | 'fewstep'
  | 'distiller'
  | 'performance'
  | 'preview'
  | 'dataset-intelligence'
  | 'optional'
  | 'output'
  | 'other-settings'
  | 'review'

/** 步骤固定顺序（页面与 wizardStore 共用，避免多处维护漂移）。 */
export const WIZARD_STEP_ORDER: WizardStepId[] = [
  'type',
  'model',
  'adapter',
  'files',
  'dataset',
  'controlnet',
  'yolo',
  'goal',
  'core',
  'ti-token',
  'fewstep',
  'distiller',
  'performance',
  'preview',
  'dataset-intelligence',
  'optional',
  'output',
  'other-settings',
  'review',
]

export type WizardStepStatus =
  | 'locked'
  | 'active'
  | 'complete'
  | 'warning'
  | 'error'
  | 'stale'

export interface WizardValidation {
  errors: string[]
  warnings: string[]
  requiredKeys: string[]
}

export interface WizardFieldGroup {
  id: string
  title: string
  description?: string
  fields: SchemaField[]
  sourceSections: SchemaSection[]
}

export interface WizardStepDefinition {
  id: WizardStepId
  label: string
  description: string
  fields: SchemaField[]
  sourceSections: SchemaSection[]
  fieldSources: Record<string, string[]>
  visible: boolean
}

export interface FieldConflict {
  key: string
  sectionIds: string[]
  winnerSectionId: string
}

export interface WizardProjection {
  category: WizardCategory
  typeLabel: string
  steps: WizardStepDefinition[]
  visibleFields: SchemaField[]
  unmappedFieldKeys: string[]
  duplicateFieldKeys: string[]
  duplicateFieldConflicts: FieldConflict[]
}

export const WIZARD_CATEGORY_LABELS: Record<WizardCategory, string> = {
  lora: 'LoRA / Adapter',
  finetune: 'Full Finetune',
  controlnet: 'ControlNet',
  textual_inversion: 'Textual Inversion',
  specialized: 'Specialized',
  other: 'Other',
}

export const WIZARD_CATEGORY_DESCRIPTIONS: Record<WizardCategory, string> = {
  lora: 'Train a lightweight adapter, ideal for styles, characters, and concepts.',
  finetune: 'Update the model main weights for deeper capability changes.',
  controlnet: 'Train an additional structural or conditioning control branch.',
  textual_inversion: 'Train text embeddings that plug into prompts.',
  specialized: 'Specialized flows such as Turbo, Few-step, and Distiller.',
  // 仅当语言包缺 wizard.category.other_desc 时才会显示的回落文案；
  // YOLO 入口已隐藏，不得再宣传。
  other: 'Aesthetic scoring and other model families.',
}

const CATEGORY_ORDER: WizardCategory[] = ['lora', 'finetune', 'controlnet', 'textual_inversion', 'specialized', 'other']

type BucketId = Exclude<WizardStepId, 'type' | 'model' | 'review'>

/**
 * 显式字段归属覆盖表：优先于所有正则启发式。
 * 命中字段（键名级或 类型+键名 级）直接路由到指定步骤。
 */
const GLOBAL_OWNERSHIP_OVERRIDES: Record<string, BucketId> = {
  gradient_checkpointing: 'performance',
  checkpoint_policy: 'performance',
  anima_auto_scan_folder: 'files',
  unet_path: 'files',
  transformer_path: 'files',
  h3_transformer_path: 'files',
  teacher_path: 'files',
  teacher_lora_path: 'files',
  teacher_adapter_path: 'files',
  lora_path: 'files',
  annotations: 'dataset',
  image_root: 'dataset',
  yolo_data_config_path: 'dataset',
  dataset_intelligence_enabled: 'dataset-intelligence',
  sample_difficulty_weighting: 'dataset-intelligence',
  // SDXL 桶新增类型（dreambooth / lllite / ip-adapter）与补暴露字段的归属。
  instance_prompt: 'dataset',
  class_prompt: 'dataset',
  num_class_images: 'dataset',
  train_text_encoder: 'core',
  tag_group_shuffle: 'dataset',
  tag_group_separator: 'dataset',
  ip_image_encoder_path: 'files',
  ip_num_tokens: 'controlnet',
  // lycoris_preset 钉进 adapter：GOAL 启发式（/intent|purpose|goal|preset/i）先于
  // adapter 分支命中键名里的 'preset'，把 LyCORIS 家族参数抢进 goal 步。preset 是
  // 选中 LyCORIS 家族后就地可调的结构参数，语义归属 adapter —— 在单一事实源覆盖
  // 表里钉死，而不是收窄 goal 正则（后者会影响其它真正含 preset 的目标键）。
  lycoris_preset: 'adapter',

  // ── 2026-08 全类型路由审计（40 可见类型 × 默认 config + 家族选中 config 两档，
  // 期望桶 = 字段所属 section 语义）。以下按目标步骤分组，修复「正则抢键」与
  // 「无词根命中回落 other-settings」两类错分桶；每行括注 section 语义证据。 ──

  // adapter 步：网络结构参数（schema 的 network-settings / adapter-settings /
  // head-settings 等「网络」页签 section，键名无 ADAPTER_TOKEN 词根才回落错桶）。
  scale_weight_norms: 'adapter', // network-settings：LoRA 权重谱正则
  enable_base_weight: 'adapter', // network-settings：底模权重残差开关
  pissa_init: 'adapter', // network-settings：PiSSA SVD 初始化
  train_norm: 'adapter', // network-settings：Norm 层纳入训练
  bypass_mode: 'adapter', // anima network-settings：旁路注入模式
  layered_alpha_enabled: 'adapter', // layered-alpha-settings：按模块分层 alpha
  alpha_self_attn: 'adapter', // 同上节子参数（启用后才可见）
  alpha_cross_attn: 'adapter',
  alpha_mlp: 'adapter',
  alpha_adaln: 'adapter',
  mora_enabled: 'adapter', // adapter-settings：MoRA 家族卡
  newbie_target_modules: 'adapter', // adapter-settings：目标模块列表
  target_modules: 'adapter', // turbo-network-settings：LyCORIS 目标模块
  hidden_dims: 'adapter', // aesthetic head-settings：融合头结构
  freeze_extractors: 'adapter', // aesthetic head-settings：特征提取器冻结
  include_waifu_score: 'adapter', // aesthetic head-settings：评分头分支

  // files 步：模型/权重文件选择与获取方式（model-settings / lab-model-settings）。
  ae: 'files', // flux model-settings：AE(VAE) 权重路径
  v2: 'files', // sd model-settings：声明 SD 2.x 底模架构
  llm_path: 'files', // lab model-settings：蒸馏教师 LLM 路径
  projector_path: 'files', // lab model-settings：projector 权重路径
  boogu_model_version: 'files', // model-settings：底模版本选择
  flux2_model_version: 'files', // model-settings：底模版本选择
  wan22_model_variant: 'files', // model-settings：变体选择（决定权重结构）
  wan22_noise_stage: 'files', // model-settings：A14B 高/低噪塔（底模配对）
  h3_partition: 'files', // model-settings：模型剪裁变体选择
  universal_dit_allow_remote_download: 'files', // model-settings：底模远程获取
  universal_dit_trust_remote_code: 'files', // model-settings：底模自定义代码

  // dataset 步：caption/数据读取族。TI_TOKEN 的 'token' 与 CORE_TOKEN 的
  // 'resolution'/'frame' 先于 dataset 兜底命中，把这组键抢离数据集步。
  keep_tokens: 'dataset', // caption-settings：caption 保留 token 数
  keep_tokens_separator: 'dataset', // caption-settings：保留分隔符
  max_token_length: 'dataset', // caption-settings：caption 截断长度
  random_triggers: 'dataset', // caption-settings：随机触发词
  random_triggers_position: 'dataset',
  random_triggers_probability: 'dataset',
  nl_dropout_rate: 'dataset', // caption-dropout-settings：自然语言丢弃率
  oom_skip_batch_enabled: 'dataset', // caption-structured-settings：坏批跳过
  oom_skip_batch_max_consecutive: 'dataset',
  albumentations_enabled: 'dataset', // data-aug-settings：在线增强
  dataloader_num_workers: 'dataset', // dataset-settings：数据加载 worker
  enable_mixed_resolution_training: 'dataset', // dataset-settings：混合分辨率（与 enable_bucket 同族）
  resolution_aware_batch_enabled: 'dataset', // data-aug-settings：按分辨率组 batch
  h3_frame_count: 'dataset', // dataset-settings：视频帧数
  h3_fps: 'dataset', // dataset-settings：帧率
  ltx23_frame_stride: 'dataset', // dataset-settings：帧采样步长
  ltx23_target_frames: 'dataset', // dataset-settings：目标帧数
  wan22_frame_stride: 'dataset',
  wan22_target_frames: 'dataset',
  wan22_fps: 'dataset',

  // core 步：优化器/损失/时间步/训练范围（optimizer-settings / training-settings /
  // noise-settings / anima-params / h3-flow-training 等训练页签 section）。
  unet_lr: 'core', // optimizer-settings：UNet 学习率（CORE_TOKEN 只认 lr_ 前缀）
  text_encoder_lr: 'core', // optimizer-settings：TE 学习率（同上）
  min_snr_gamma: 'core', // optimizer-settings：Min-SNR 损失加权
  huber_c: 'core', // optimizer-settings：Huber 损失族参数
  huber_schedule: 'core',
  huber_scale: 'core',
  gradient_guard_strategy: 'core', // optimizer-settings：梯度守护
  max_grad_norm: 'core', // optimizer-settings：梯度裁剪上限
  train_length_mode: 'core', // training-settings：训练长度模式
  v_parameterization: 'core', // v-parameterization-settings：v-pred 训练目标
  loss_type: 'core', // flux-params：损失函数类型（anima 已有 typed 钉先行）
  guidance_scale: 'core', // flux-params：CFG 引导（蒸馏类型已有 typed 钉先行）
  discrete_flow_shift: 'core', // flux-params：Flow Shift（anima typed 钉先行）
  t5xxl_max_token_length: 'core', // flux-params：TE token 截断（同 qwen3/t5_max_token_length 先例）
  flow_model: 'core', // rf-settings：Rectified Flow 目标开关
  masked_loss: 'core', // training-misc：蒙版损失
  alpha_mask: 'core', // training-misc：alpha 通道作 loss mask
  initial_step: 'core', // training-misc：续训起始步
  skip_until_initial_step: 'core', // training-misc：跳过起步步数
  adaptive_noise_scale: 'core', // noise-settings：自适应噪声
  ip_noise_gamma: 'core', // noise-settings：IP 噪声
  ip_noise_gamma_random_strength: 'core', // noise-settings（OPTIONAL_TOKEN 的 random 抢键）
  multires_noise_discount: 'core', // noise-settings：多分辨率噪声
  multires_noise_iterations: 'core',
  immiscible_diffusion_enabled: 'core', // noise-settings：不可混扩散
  p2_weighting_mode: 'core', // noise-settings：P2 加权
  stepped_loss_enabled: 'core', // noise-settings：阶梯损失
  smart_noise_enabled: 'core', // timestep-sampling-settings：logSNR 聚焦噪声
  smart_noise_logsnr_focus: 'core', // 同上节子参数
  smart_noise_focus_strength: 'core',
  smart_noise_focus_spread: 'core',
  lulynx_weight_noise_enabled: 'core', // noise-settings：权重噪声正则
  lulynx_weight_noise_mode: 'core', // 同上节子参数
  lulynx_weight_noise_sigma: 'core',
  lulynx_weight_noise_bound_norm: 'core',
  lulynx_weight_noise_log_every: 'core',
  anima_faithful_forward: 'core', // training-settings：原生前向保真
  anima_faithful_degrade_policy: 'core', // training-settings：降级策略
  flow_uncertainty_weighting_enabled: 'core', // anima-params：流不确定性加权
  newbie_sigma_schedule: 'core', // training-settings：sigma 调度
  anima_text_token_limit: 'core', // 缓存系统：TE 截断（与 qwen3/t5_max_token_length 同族）
  anima_cached_text_token_limit: 'core',
  anima_depth_expansion_enabled: 'core', // depth-expansion-settings：模型扩层训练
  anima_depth_expansion_target_layers: 'core',
  anima_depth_expansion_train_scope: 'core',
  krea2_depth_expansion_enabled: 'core', // model-settings：扩层训练（训练容量参数）
  krea2_depth_expansion_target_layers: 'core',
  krea2_depth_expansion_train_scope: 'core',
  flux2_depth_expansion_enabled: 'core',
  zimage_depth_expansion_enabled: 'core',
  wan22_depth_expansion_enabled: 'core',
  boogu_depth_expansion_enabled: 'core',
  h3_depth_expansion_enabled: 'core',
  krea2_training_mode: 'core', // model-settings：训练模式配方（De-Turbo/Standard 等）
  krea2_text_fusion_mode: 'core', // model-settings：文本塔是否参训（train_text_encoder 同族）
  wan22_expert_timestep_preset: 'core', // model-settings：按塔填时间步先验（GOAL 正则抢键）
  ltx23_discrete_flow_shift: 'core', // ltx23-flow-matching：Flow Shift
  ltx23_isolate_modalities: 'core', // ltx23-flow-matching：只训视觉分支
  wan22_discrete_flow_shift: 'core', // model-settings：Flow Shift（timestep 采样族）
  zimage_discrete_flow_shift: 'core',
  wan22_max_text_length: 'core', // model-settings：umT5 序列上限（TE 截断族）
  zimage_max_text_length: 'core',
  ltx23_max_text_length: 'core',
  h3_audio_loss_weight: 'core', // h3-flow-training：音频损失权重
  h3_audio_sigma_shift: 'core', // h3-flow-training：音频 sigma shift
  h3_cfg_preservation_enabled: 'core', // h3-flow-training：CFG 保持
  h3_cfg_scale: 'core',
  h3_cfg_schedule: 'core',
  h3_condition_noise_clean: 'core', // h3-flow-training：条件噪声清理
  h3_unconditional_prompt: 'core', // h3-flow-training：CFG 空条件提示
  h3_video_only: 'core', // h3-flow-training：只训视频分支
  h3_video_sigma_shift: 'core',

  // preview 步：验证/评估节奏（validation-settings / preview-settings）。
  // CORE_TOKEN 的 batch_size/steps/epochs 抢键把这组验证调度字段扣在 core 步。
  eval_batch_size: 'preview', // validation-settings：验证批大小
  eval_data_dir: 'preview', // validation-settings：验证集目录
  validate_every_n_steps: 'preview', // validation-settings：验证频率
  validate_every_n_epochs: 'preview',
  max_validation_steps: 'preview',
  quality_evaluation_enabled: 'preview', // preview-settings：质量评估
  quality_evaluation_xy_grid: 'preview', // 同上节子参数
  quality_evaluation_num_samples: 'preview',
  quality_evaluation_suite_id: 'preview',
  quality_evaluation_validation_seeds: 'preview',
  quality_evaluation_compare_base: 'preview',
  quality_evaluation_metric_weights: 'preview',
  quality_evaluation_metrics: 'preview',
  quality_evaluation_validation_prompts: 'preview',
  fid_real_image_dir: 'preview', // preview-settings：FID 真实图目录
  preference_scoring_enabled: 'preview', // preview-settings：偏好打分
  preference_models: 'preview',

  // performance 步：显存/加速/缓存/精度/量化/散热（speed 页签各族 section）。
  // GOAL 正则 'preset' 抢键（与 lycoris_preset 同类）：
  weight_compression_preset: 'performance', // speed-settings：权重压缩档位
  train_quant_preset: 'performance', // speed-settings：训练量化档位
  krea2_vram_preset: 'performance', // krea2 offload：显存档位
  // OUTPUT 正则 '_output' 抢键——TE 输出缓存不是「输出与保存」：
  cache_text_encoder_outputs: 'performance', // cache-settings：TE 输出缓存
  cache_text_encoder_outputs_to_disk: 'performance',
  h3_cache_text_encoder_outputs: 'performance', // h3-memory-settings：同上
  h3_cache_max_samples: 'performance', // h3-memory-settings（PREVIEW 'sample' 抢键）
  // 精度/后端（speed-settings，无词根回落 other-settings）：
  full_fp16: 'performance',
  full_bf16: 'performance',
  no_half_vae: 'performance',
  fp8_base: 'performance',
  fp8_base_unet: 'performance',
  sdxl_unet_backend: 'performance', // UNet 注意力后端
  attn_mode: 'performance', // anima/hunyuan：注意力实现（'attn' 不含 'attention' 词根）
  disable_mmap_load_safetensors: 'performance', // 低内存模式相关
  // 显存/offload（speed-settings 与各族 offload-settings）：
  lowram: 'performance',
  pytorch_cuda_expandable_segments: 'performance',
  gradient_release_enabled: 'performance',
  gradient_release_mode: 'performance',
  gradient_release_grad_clip_mode: 'performance',
  gradient_release_downgrade_reason: 'performance',
  memory_reclaim_interval_steps: 'performance', // CORE_TOKEN 'steps' 抢键
  optimizer_state_paging_enabled: 'performance', // CORE_TOKEN 'optimizer' 抢键：优化器状态分页
  vram_smart_sensing_baseline_steps: 'performance',
  vram_smart_sensing_window_steps: 'performance',
  model_to_condition_enabled: 'performance', // ModelToCondition 按需加载协议
  activation_compression_enabled: 'performance', // 激活压缩省显存
  split_attn: 'performance', // 分头 attention 省显存
  vae_chunk_size: 'performance', // VAE 分块省显存
  lora_activation_recompute_mode: 'performance', // ADAPTER_TOKEN 'lora' 抢键：激活重算
  h3_int8_gemm_mode: 'performance', // h3-memory-settings
  h3_load_direct_to_device: 'performance',
  h3_te_layer_streaming: 'performance',
  h3_prune_adaln_on_load: 'performance',
  h3_preserve_lora_master_dtype: 'performance', // ADAPTER_TOKEN 'lora' 抢键：dtype 保持
  // 批处理/缓存管线：
  vae_batch_size: 'performance', // speed-settings：VAE 编码批（CORE_TOKEN 'batch_size' 抢键）
  text_encoder_batch_size: 'performance', // TE 编码批
  persistent_data_loader_workers: 'performance',
  quant_train_mode: 'performance', // speed-settings：量化训练
  quant_requantize_policy: 'performance',
  weight_compression_enabled: 'performance',
  // TurboCore / Lulynx / Vortex（turbocore-settings / cache-runtime-settings）：
  lulynx_optimization_enabled: 'performance',
  lulynx_steady_accel: 'performance',
  performance_expert_mode: 'performance', // 顶栏「高级」开关，住 speed 页签
  enhanced_protection_mode: 'performance',
  vortex_enabled: 'performance', // Vortex 显存管理总开关
  pcie_transfer_format: 'performance',
  newbie_safe_fallback: 'performance', // OOM 安全回退
  // 散热与功耗（thermal-settings，32 类型共用；字段无词根/被 epoch 抢键）：
  cooldown_every_n_epochs: 'performance', // CORE_TOKEN 'epochs' 抢键
  cooldown_minutes: 'performance',
  cooldown_until_temp_c: 'performance',
  cooldown_poll_seconds: 'performance',
  gpu_power_limit_w: 'performance',
  gpu_duty_cycle: 'performance',
  gpu_target_temp_c: 'performance',
  gpu_lock_clocks_mhz: 'performance',
  gpu_circuit_enabled: 'performance', // 功耗保护回路（子参数启用后才可见）
  gpu_circuit_poll_interval_steps: 'performance',
  gpu_circuit_temp_c: 'performance',
  gpu_circuit_temp_warn_c: 'performance',
  gpu_circuit_vram_util_pct: 'performance',
  gpu_circuit_trip_on_throttle: 'performance',
  gpu_circuit_trip_on_ecc: 'performance',
  gpu_circuit_device_index: 'performance',
  // Block residency（各族 offload-settings 的驻留块控制）：
  anima_block_residency: 'performance',
  newbie_block_residency: 'performance',
  newbie_block_residency_min_params: 'performance',
  krea2_block_residency: 'performance',
  krea2_resident_block_count: 'performance',
  flux2_block_residency: 'performance',
  zimage_block_residency: 'performance',
  wan22_block_residency: 'performance',
  ltx23_block_residency: 'performance',
  // 其余 speed 页签散键：
  triton_ops_enabled: 'performance', // ltx：Triton 算子注入
  model_fused_qkv: 'performance', // ltx：QKV/KV 权重合并加载
  anima_vram_optimizer: 'performance', // anima speed-settings：显存优化器
  anima_progressive_full_finetune_enabled: 'performance', // anima speed-settings：渐进解冻省显存
  anima_rematerializable_block_enabled: 'performance', // 重物化块（OPTIONAL_TOKEN 'ema' 抢键）
  anima_cache_build_batch_size: 'performance', // cache-system-settings：缓存构建批
  anima_cache_target_resolution: 'performance',
  newbie_cache_build_batch_size: 'performance', // cache-runtime-settings
  newbie_clip_max_token_length: 'performance', // 缓存路径 TE 截断
  newbie_gemma_max_token_length: 'performance',
  newbie_caption_length_bucket_size: 'performance', // DATASET_TOKEN 'bucket' 抢键：缓存分桶

  // output 步：产物元数据（training-misc 的保存元数据组，OUTPUT 正则不含这些词根）。
  metadata_note: 'output', // turbo 输出：写入 sidecar 的备注
  no_metadata: 'output', // 不在产物写元数据
  training_comment: 'output', // 写入模型元数据的训练备注

  // controlnet 步：LLLite 结构参数（lllite-settings；OUTPUT '_output' 抢键）。
  lllite_skip_output_blocks: 'controlnet',

  // distiller 步：lab 蒸馏运行参数（lab-run-settings；TI_TOKEN 'token' 抢键）。
  allow_tokenizer_only_clip: 'distiller',

  // fewstep 步：蒸馏采样调度（turbo/few-step distill-settings；CORE_TOKEN
  // 'steps'/'scheduler' 抢键把它们扣在 core，与 distill_method 等既有钉分离）。
  student_steps: 'fewstep',
  teacher_steps: 'fewstep',
  teacher_scheduler: 'fewstep',
  student_scheduler: 'fewstep',
}

// Anima 族分桶修正（2026-08 ANIMA 桶）：分组 LR 与 Flow/时间步参数同属一张卡，
// 却被 token 启发式拆进 3 个步——anima_llm_adapter_lr 因 'adapter' 命中 adapter 步、
// 其余分组 LR 落 other-settings、discrete_flow_shift/sigmoid_scale/weighting_scheme
// 落 optional 而 timestep_sampling 命中 'timestep' 落 core。这里统一钉进 core。
const ANIMA_CORE_OVERRIDES: Record<string, BucketId> = {
  anima_self_attn_lr: 'core',
  anima_cross_attn_lr: 'core',
  anima_mlp_lr: 'core',
  anima_mod_lr: 'core',
  anima_llm_adapter_lr: 'core',
  timestep_sampling: 'core',
  discrete_flow_shift: 'core',
  anima_sigmoid_scale: 'core',
  sigmoid_scale: 'core',
  anima_weighting_scheme: 'core',
  weighting_scheme: 'core',
  mode_scale: 'core',
  anima_model_prediction_type: 'core',
  loss_type: 'core',
  flow_logit_mean: 'core',
  flow_logit_std: 'core',
  qwen3_max_token_length: 'core',
  t5_max_token_length: 'core',
}

const TYPE_OWNERSHIP_OVERRIDES: Record<string, Record<string, BucketId>> = {
  'anima-lora': ANIMA_CORE_OVERRIDES,
  'anima-finetune': ANIMA_CORE_OVERRIDES,
  'anima-controlnet': ANIMA_CORE_OVERRIDES,
  'aesthetic-scorer': {
    dropout: 'core',
    batch_size: 'core',
    epochs: 'core',
    learning_rate: 'core',
    device: 'core',
    cls_loss_weight: 'core',
    cls_pos_weight: 'core',
    // 2026-08 路由审计补钉：训练页签的 loss/worker 与数据集页签的切分键。
    loss: 'core', // training-settings：损失配置
    num_workers: 'core', // training-settings：加载进程数
    target_dims: 'dataset', // dataset-settings：回归目标维度
    train_split: 'dataset', // dataset-settings：训练切分
    val_split: 'dataset', // dataset-settings：验证切分
    val_ratio: 'dataset', // dataset-settings：验证占比
  },
  yolo: {
    batch: 'yolo',
    class_names: 'yolo',
    imgsz: 'yolo',
    epochs: 'yolo',
    device: 'yolo',
    seed: 'yolo',
  },
  'lab-distiller': {
    batch_size: 'distiller',
    learning_rate: 'distiller',
    distill_method: 'distiller',
    distillation_loss_weight: 'distiller',
    guidance_scale: 'distiller',
    seed: 'distiller',
    dtype: 'distiller',
    dry_run: 'distiller',
    // 路由审计补钉：lab-run-settings 的蒸馏步数被 CORE_TOKEN 'steps' 扣在 core，
    // 与本类型既有钉（batch_size/learning_rate→distiller）同批。
    steps: 'distiller',
  },
  'sdxl-turbo-lora': {
    batch_size: 'fewstep',
    learning_rate: 'fewstep',
    distill_method: 'fewstep',
    distillation_loss_weight: 'fewstep',
    guidance_scale: 'fewstep',
    lcm_target_stride: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    teacher_lora_scope: 'fewstep',
    dry_run: 'fewstep',
    // 路由审计补钉：turbo-distill-settings 的训练步数上限与 batch_size/learning_rate
    // 既有钉同批（CORE_TOKEN 'max_train' 抢回 core 步）。
    max_train_steps: 'fewstep',
  },
  // Lab 探针契约页真实存在的键才进 fewstep 步。曾为它路由 batch_size /
  // learning_rate / distillation_loss_weight / teacher_lora_scope —— 这四个键在
  // schema 与 lab contract（contracts/tools.py DitFewStepLoraRequest）里都不存在，
  // 属死覆盖项，已清理。
  'anima-few-step-lora': {
    distill_method: 'fewstep',
    few_step_objective: 'fewstep',
    guidance_scale: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    dry_run: 'fewstep',
  },
  // Lab 探针契约页真实存在的键才进 fewstep 步。曾为它路由 batch_size /
  // learning_rate / distillation_loss_weight / teacher_lora_scope —— 这四个键在
  // schema 与 lab contract（contracts/tools.py DitFewStepLoraRequest）里都不存在，
  // 属死覆盖项，已清理（与 anima-few-step-lora 同批对齐，2026-08 第 3 站）。
  'newbie-few-step-lora': {
    distill_method: 'fewstep',
    few_step_objective: 'fewstep',
    guidance_scale: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    dry_run: 'fewstep',
  },
  // universal-dit-lora：network_module 恒为隐藏 networks.lora，无算法卡可选面；
  // rank/alpha/dropout 钉进 core 与学习率同屏，避免 specialized 类别下出现
  // 「不需要单独选择适配器」文案却挂着三个网络字段的矛盾空步。
  'universal-dit-lora': {
    network_dim: 'core',
    network_alpha: 'core',
    network_dropout: 'core',
  },
}

const MODEL_KEYS = new Set([
  'pretrained_model_name_or_path',
  'model_path',
  'base_model_path',
  'vae',
  'vae_path',
  'qwen3',
  'llm_adapter_path',
  'network_weights',
  'teacher_model_path',
  'teacher_adapter_path',
  'text_encoder_path',
  'clip_l',
  't5xxl',
  'output_model_path',
])

const DATASET_KEYS = new Set([
  'train_data_dir',
  'dataset_dir',
  'dataset_path',
  'train_dataset',
  'validation_data_dir',
  'reg_data_dir',
  'conditioning_data_dir',
  'instance_data_dir',
  'class_data_dir',
  'data_root',
  'caption_extension',
  'caption_file_ext',
  'repeats',
  'resolution',
  'bucket_reso_steps',
  'enable_bucket',
  'random_crop',
  'center_crop',
  'color_aug',
  'flip_aug',
])

const GOAL_KEYS = new Set([
  'training_intent',
  'training_goal',
  'training_preset',
  'intent_profile',
  'profile',
  // dataset_intelligence_enabled / sample_difficulty_weighting 曾列在这里，
  // 但 GLOBAL_OWNERSHIP_OVERRIDES 先行把它们路由到 dataset-intelligence，
  // 这两条是永远不可达的死分支——归属单一事实源在 overrides 表。
])

const OUTPUT_KEYS = new Set([
  'output_dir',
  'output_name',
  'output_path',
  'save_model_as',
  'save_every_n_steps',
  'save_every_n_epochs',
  'save_last_n_models',
  'save_state',
  'resume',
  'resume_from_checkpoint',
])

const ADAPTER_EXACT_KEYS = new Set([
  'network_module',
  'network_dim',
  'network_alpha',
  'network_dropout',
  'lora_type',
  'adapter_type',
  'lycoris_algo',
  'lokr_factor',
  'glokr_factor',
  'decompose_both',
  'full_matrix',
  'unbalanced_factorization',
  'conv_dim',
  'conv_alpha',
  'rank_dropout',
  'module_dropout',
  'dropout',
  'dora_wd',
  'adapter_init_strategy',
  'adapter_init_export_mode',
  'loftq_bits',
  'loftq_quant_type',
  'dim_from_weights',
  // Kronecker 家族子参数（LoKr 副产物）：选中对应家族卡后就地调节。
  'dokr_factor_in',
  'dokr_factor_out',
  'dokr_decompose_factor',
  'dokr_mode',
  'dokr_alpha',
  'gdlokr_factor',
  'gdlokr_mode',
  'gdlokr_alpha',
  'tensorring_factor',
  // TensorRing TRM/residual rank（2026-08 全算法参数审计）：键名不含 ADAPTER_TOKEN
  // 词根（tensorring 无 lora/lokr 字样），靠精确表钉进 adapter 步。
  'tensorring_trm_rank',
  'tensorring_tr_rank',
  'krona_factor_in',
  'krona_factor_out',
  'cdka_factor_in',
  'cdka_factor_out',
])

// 这些家族子参数住在 expert 的 lora-variants section（fera_gate_init 住 frontier 的
// experimental-probes）；向导选中家族卡后需要就地暴露（visibleWhen 已保证仅选中该
// 家族时可见），故从 expert/frontier 跳过中按键白名单豁免。清单覆盖后端
// adapter_family_registry 各家族的全部可调子参数（不含选择键与 hidden 幻影键）。
const WIZARD_ADAPTER_FAMILY_PARAM_KEYS = new Set([
  'dokr_factor_in',
  'dokr_factor_out',
  'dokr_decompose_factor',
  'dokr_mode',
  'dokr_alpha',
  'gdlokr_factor',
  'gdlokr_mode',
  'gdlokr_alpha',
  'tensorring_factor',
  'krona_factor_in',
  'krona_factor_out',
  'cdka_factor_in',
  'cdka_factor_out',
  // Kronecker 之外的实体注入器家族子参数（2026-08 全算法参数审计）。
  'vera_d_initial',
  'vera_prng_key',
  'fera_gate_init',
  'reslora_mode',
  'reslora_window',
  'reslora_alpha_star',
  'hydralora_num_experts',
  'hydralora_routing',
  'hydralora_top_k',
  'hydralora_sparse_top_k',
  'lora2_adaptive_r_max',
  'lora2_adaptive_nu_init',
  'lora2_adaptive_decay_lambda',
  'lora2_gate_init',
  'tensorring_trm_rank',
  'tensorring_tr_rank',
  'cdka_alpha',
  'cdka_allora',
  'cdka_weight_decompose',
  'krona_allora',
  'krona_allora_eta',
  'krona_weight_decompose',
])

const ADAPTER_TOKEN = /(lora|lokr|glora|lycoris|adapter|network_|dora|vera|tlora|flexrank|hydra|fera|gdlokr|reslora|dokr|cdka|krona)/i
const CORE_TOKEN = /(learning_rate|lr_|train_(batch|steps|epoch)|max_train|gradient_accumulation|optimizer|scheduler|batch_size|epoch|steps|warmup|weight_decay|clip_grad|noise_offset|resolution|frame|timestep|prior_loss)/i
const PERFORMANCE_TOKEN = /(accelerat|compile|cache|offload|swap|gradient_checkpoint|checkpoint|memory|vram|turbocore|precision|dtype|attention)/i
const PREVIEW_TOKEN = /(preview|validation|sample)/i
const DATASET_INTELLIGENCE_TOKEN = /(dataset_intelligence|sample_difficulty|difficulty_weighting)/i
const CONTROLNET_TOKEN = /(controlnet|control_net|conditioning|cond_)/i
const TI_TOKEN = /(ti_|placeholder|num_vectors|inversion|token)/i
const OPTIONAL_TOKEN = /(augment|caption|regulariz|ema|safet|logging|tensorboard|wandb|random|seed)/i

const FEW_STEP_TYPES = new Set(['sdxl-turbo-lora', 'anima-few-step-lora', 'newbie-few-step-lora'])

function fieldBucket(field: SchemaField, typeId: string, category: WizardCategory): BucketId {
  const key = field.key
  const typed = TYPE_OWNERSHIP_OVERRIDES[typeId]?.[key]
  if (typed) return typed
  const global = GLOBAL_OWNERSHIP_OVERRIDES[key]
  if (global) return global
  if (MODEL_KEYS.has(key) || /(^|_)(model|vae|clip|text_encoder|qwen|t5|teacher|unet|transformer).*path/i.test(key)) return 'files'
  if (DATASET_KEYS.has(key) || /dataset|caption|bucket|augment|instance_data|class_data/i.test(key)) return 'dataset'
  if (GOAL_KEYS.has(key) || /intent|purpose|goal|preset/i.test(key)) return 'goal'
  if (OUTPUT_KEYS.has(key) || /(^|_)(output|save|resume)/i.test(key)) return 'output'
  if (DATASET_INTELLIGENCE_TOKEN.test(key)) return 'dataset-intelligence'
  if (ADAPTER_EXACT_KEYS.has(key) || ADAPTER_TOKEN.test(key)) return 'adapter'
  if (CORE_TOKEN.test(key)) return 'core'
  if (PREVIEW_TOKEN.test(key)) return 'preview'
  if (PERFORMANCE_TOKEN.test(key)) return 'performance'
  if (CONTROLNET_TOKEN.test(key)) return category === 'controlnet' ? 'controlnet' : 'optional'
  if (TI_TOKEN.test(key)) return category === 'textual_inversion' ? 'ti-token' : 'optional'
  if (OPTIONAL_TOKEN.test(key)) return 'optional'
  // 专项类型未归类的字段进入对应条件步骤
  if (FEW_STEP_TYPES.has(typeId)) return 'fewstep'
  if (typeId === 'lab-distiller') return 'distiller'
  if (typeId === 'yolo') return 'yolo'
  if (category === 'controlnet') return 'controlnet'
  if (category === 'textual_inversion') return 'ti-token'
  return 'other-settings'
}

export function categoryForTrainingType(typeId: string): WizardCategory {
  const meta = ALL_TRAINING_TYPES.find((type) => type.id === typeId)
  const group = String(meta?.group || '').toLowerCase()
  if (group === 'finetune' || /finetune|dreambooth/.test(typeId)) return 'finetune'
  if (group.includes('controlnet') || typeId.includes('controlnet')) return 'controlnet'
  if (group.includes('textual') || typeId.includes('textual-inversion')) return 'textual_inversion'
  // 实验训练（universal-dit-lora）：与专项流程同属 specialized，不混入新手 LoRA 卡列表。
  if (group.includes('实验') || /experiment/.test(group)) return 'specialized'
  if (group.includes('专项') || /turbo|few-step|distiller/.test(typeId)) return 'specialized'
  if (group === 'lora' || typeId.endsWith('-lora')) return 'lora'
  return 'other'
}

export function visibleTypesForCategory(category: WizardCategory) {
  return TRAINING_TYPES.filter((type) => !type.hidden && !type.disabled && categoryForTrainingType(type.id) === category)
}

export function wizardCategories() {
  return CATEGORY_ORDER.filter((category) => visibleTypesForCategory(category).length > 0)
}

function canonicalFields(typeId: string, config: Record<string, unknown>) {
  const sections = getSectionsForType(typeId)
  const entries = new Map<string, Array<{ field: SchemaField; section: SchemaSection }>>()
  for (const section of sections) {
    // Advanced/frontier fields remain available in expert mode. The wizard keeps
    // them out of the beginner path so the first screen stays focused — except
    // adapter family sub-params, which must be tunable right after picking the
    // family card (their own visibleWhen gates display to that selection).
    // advanced 页签仍整体跳过；frontier 页签与 expert section 同等待遇：
    // fera_gate_init 住在 frontier 的 experimental-probes，白名单按键豁免。
    if (section.tab === 'advanced' || section.tab === 'frontier' || (section as SchemaSection & { expert?: boolean }).expert) {
      if (section.tab !== 'advanced') {
        for (const field of section.fields || []) {
          if (!WIZARD_ADAPTER_FAMILY_PARAM_KEYS.has(field.key)) continue
          if (field.type === 'hidden' || field.type === 'ui_group') continue
          if (!isFieldVisible(field, config)) continue
          const list = entries.get(field.key) || []
          list.push({ field, section })
          entries.set(field.key, list)
        }
      }
      continue
    }
    for (const field of section.fields || []) {
      if (field.type === 'hidden' || field.type === 'ui_group') continue
      if (!isFieldVisible(field, config)) continue
      const list = entries.get(field.key) || []
      list.push({ field, section })
      entries.set(field.key, list)
    }
  }
  const fields: SchemaField[] = []
  const fieldSources = new Map<string, SchemaSection[]>()
  const conflicts: FieldConflict[] = []
  for (const [key, candidates] of entries) {
    const canonical = getFieldDefinition(key, typeId)
    const visibleCanonical = canonical && isFieldVisible(canonical, config) ? canonical : undefined
    const winner = visibleCanonical || candidates[candidates.length - 1].field
    fields.push(winner)
    const sourceSections = candidates.map((candidate) => candidate.section)
    fieldSources.set(key, sourceSections)
    if (candidates.length > 1) {
      const winnerSource = candidates.find((candidate) => candidate.field === winner) ?? candidates[candidates.length - 1]
      conflicts.push({
        key,
        sectionIds: sourceSections.map((section) => section.id),
        winnerSectionId: winnerSource.section.id,
      })
    }
  }
  return { fields, fieldSources, conflicts }
}

export function buildWizardProjection(typeId: string, config: Record<string, unknown>): WizardProjection {
  const meta = ALL_TRAINING_TYPES.find((type) => type.id === typeId)
  const category = categoryForTrainingType(typeId)
  const { fields, fieldSources, conflicts } = canonicalFields(typeId, config)
  const buckets = new Map<string, SchemaField[]>()
  const sourceBuckets = new Map<string, SchemaSection[]>()
  const bucketFieldSources = new Map<string, Record<string, string[]>>()
  const semanticBuckets = new Set<BucketId>([
    'files', 'dataset', 'goal', 'adapter', 'core', 'optional', 'output',
    'controlnet', 'ti-token', 'yolo', 'fewstep', 'distiller', 'performance', 'preview', 'dataset-intelligence',
  ])
  for (const field of fields) {
    const bucket = fieldBucket(field, typeId, category)
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket)!.push(field)
    const sections = fieldSources.get(field.key) || []
    const source = sourceBuckets.get(bucket) || []
    for (const section of sections) if (!source.some((item) => item.id === section.id)) source.push(section)
    sourceBuckets.set(bucket, source)
    const byKey = bucketFieldSources.get(bucket) || {}
    byKey[field.key] = sections.map((section) => section.id)
    bucketFieldSources.set(bucket, byKey)
  }

  const fewStepType = FEW_STEP_TYPES.has(typeId)
  const base: Array<[WizardStepId, string, string]> = [
    ['type', '训练类型', '选择 LoRA、Full Finetune 或其它训练入口。'],
    ['model', '模型与训练方案', '选择具体模型族和训练变体。'],
    ['adapter', category === 'lora' ? '适配器方法' : '训练结构', '只显示当前训练类型支持的结构选项。'],
    ['files', '模型文件', '选择底模、编码器、教师模型或其它所需文件。'],
    ['dataset', '数据集', '选择训练数据并配置数据读取方式。'],
    ['controlnet', 'ControlNet 条件输入', '设置控制分支的条件输入与条件图参数。'],
    ['yolo', 'YOLO 数据与类别', '设置检测数据、类别名称与训练规模。'],
    ['goal', '训练目标', '选择目标和推荐配置，建议值仍可手动修改。'],
    ['core', '核心训练参数', '设置学习率、批次、步数和优化器等主要参数。'],
    ['ti-token', 'Textual Inversion Token', '设置词向量数量与占位 token。'],
    ['fewstep', 'Few-step 专项参数', '蒸馏目标、引导与 sigma 调度等专项设置。'],
    ['distiller', 'Distiller 专项参数', '蒸馏损失与教师输入等专项设置。'],
    ['performance', '性能与加速', '显存、加速、缓存与精度相关设置。'],
    ['preview', '预览与验证', '训练中预览与验证设置。'],
    ['dataset-intelligence', '数据集智能分析', '数据难度加权与智能分析设置。'],
    ['optional', '可选能力', '按需开启增强、日志与正则化等设置。'],
    ['output', '输出与保存', '设置输出目录、文件名和 checkpoint 策略。'],
    ['other-settings', '其它设置', '当前训练类型的其它可见 schema 设置。'],
    ['review', '检查并开始', '检查最终配置，运行预检后启动训练。'],
  ]
  const steps = base.map(([id, label, description]) => {
    const hasFields = (buckets.get(id)?.length ?? 0) > 0
    let visible: boolean
    if (id === 'type' || id === 'model' || id === 'review' || id === 'files' || id === 'dataset' || id === 'output') {
      visible = true
    } else if (id === 'adapter') {
      visible = category === 'lora' || hasFields
    } else if (id === 'controlnet' || id === 'ti-token') {
      visible = (category === 'controlnet' || category === 'textual_inversion') && hasFields
    } else if (id === 'yolo') {
      visible = typeId === 'yolo' && hasFields
    } else if (id === 'fewstep') {
      visible = fewStepType && hasFields
    } else if (id === 'distiller') {
      visible = typeId === 'lab-distiller' && hasFields
    } else {
      visible = hasFields
    }
    return {
      id,
      label,
      description,
      fields: buckets.get(id) || [],
      sourceSections: sourceBuckets.get(id) || [],
      fieldSources: bucketFieldSources.get(id) || {},
      visible,
    } as WizardStepDefinition
  })

  return {
    category,
    typeLabel: meta?.label || typeId,
    steps: steps.filter((step) => step.visible),
    visibleFields: fields,
    // Every visible field has a bucket. The report still exposes the fallback
    // bucket so coverage tooling can distinguish semantic ownership from the
    // explicit "other settings" safety net.
    unmappedFieldKeys: fields.filter((field) => !semanticBuckets.has(fieldBucket(field, typeId, category))).map((field) => field.key),
    duplicateFieldKeys: conflicts.map((conflict) => conflict.key),
    duplicateFieldConflicts: conflicts,
  }
}

export function requiredKeysForStep(step: WizardStepId, fields: SchemaField[]): string[] {
  if (step === 'files') {
    return fields
      .filter((field) => MODEL_KEYS.has(field.key) && /pretrained|model_path|base_model|train_model|unet|transformer|h3|teacher/i.test(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  if (step === 'dataset') {
    return fields
      .filter((field) => ['train_data_dir', 'dataset_path', 'dataset_dir', 'train_dataset', 'dataset_yaml', 'yolo_data_config_path', 'annotations', 'image_root'].includes(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  if (step === 'output') {
    return fields
      .filter((field) => ['output_dir', 'output_path', 'save_to'].includes(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  return []
}

export function validateWizardStep(step: WizardStepDefinition, config: Record<string, unknown>, typeId?: string): WizardValidation {
  const errors: string[] = []
  let requiredKeys = requiredKeysForStep(step.id, step.fields)
  if (typeId) {
    const inputs = resolveTrainingInputs(typeId, config)
    const groups = step.id === 'files'
      ? inputs.model
      : step.id === 'dataset'
        ? inputs.dataset
        : step.id === 'output'
          ? inputs.output
          : []
    requiredKeys = groups.filter((group) => group.required).flatMap((group) => group.keys)
    for (const group of groups) {
      if (!group.required) continue
      if (group.anyOf) {
        const hasAny = group.keys.some((key) => String(config[key] ?? '').trim().length > 0)
        if (!hasAny) errors.push(translate('wizard.error.group_anyof_empty', { group: inputGroupLabel(group) }))
      } else {
        for (const key of group.keys) {
          if (!String(config[key] ?? '').trim()) errors.push(translate('wizard.error.field_required', { key }))
        }
      }
    }
  } else {
    const missing = requiredKeys
      .filter((key) => !String(config[key] ?? '').trim())
      .map((key) => translate('wizard.error.field_required', { key }))
    errors.push(...missing)
  }
  return { errors, warnings: [], requiredKeys }
}

export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === '' || value === null || value === undefined) return '--'
  return String(value)
}
