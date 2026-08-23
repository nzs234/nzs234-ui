// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// otherDitSchemas.js — FLUX / Lumina / Qwen-Image / HunyuanDiT / Newbie 等 DiT 训练族
// (anima 自成一档在 animaSchema.js;sdxl 在 sdxlSchema.js)。增删这些族的字段只改本文件。
// 族内私有 helper(placeholderWarningField / qwenImageSections / hunyuanDitSections /
// NEWBIE_BLOCK_RESIDENCY_FIELDS)就地定义、不外泄;按依赖顺序排列(const 不提升)。
// 依赖方向(单向无环):schemaCommon → schemaFieldGroups → 本文件 → schemaIndex。
// ================================================================
import {
  when,
  all,
  adamwFamilyOptimizer,
  swapEnabled,
  nonResidentBlockMode,
  DIT_BLOCK_RESIDENCY_OPTIONS,
  PCIE_TRANSFER_FORMAT_FIELD,
  sparseSwapFields,
  pcieDeltaCacheField,
  pcieDeltaCacheModeFields,
  vortexRuntimeFields,
  LORA_RECOMPUTE_OPTIONS,
  NATIVE_ADAPTER_TYPES,
  OPTIMIZER_BACKEND_OPTIONS,
  ADVANCED_OPTIMIZER_STRATEGY_OPTIONS,
  BLOCK_SWAP_STRATEGY_OPTIONS,
  ditGradientCheckpointingField,
  ds,
  netLora,
  flowParams,
  sec,
  ALL_SCHEDULERS,
  TARGET_LORA_OPTIMIZERS,
  schedulerOptions,
} from './schemaCommon.js';
import {
  S_LOSS_AWARE_LR,
  S_DIT_PERFORMANCE_EXPERT,
  S_EXECUTION_BACKEND,
  VRAM_AUTO_ENHANCE_FIELDS,
  KREA2_OFFLOAD_FIELDS,
  FLUX2_OFFLOAD_FIELDS,
  BOOGU_OFFLOAD_FIELDS,
  ZIMAGE_OFFLOAD_FIELDS,
  WAN22_OFFLOAD_FIELDS,
  S_SAVE,
  S_CAPTION,
  S_LR,
  S_LR_TARGET,
  S_LR_FT,
  S_LR_DIT,
  S_LR_TARGET_DIT,
  S_LR_FT_DIT,
  S_TRAIN,
  S_PREVIEW,
  S_QUALITY_EVAL,
  S_SPEED_FLOW,
  S_DISTRIBUTED,
  S_LULYNX_SDXL,
  S_ADV,
  S_ADV_DIT,
  S_NOISE,
  S_DATA_AUG,
  S_VALIDATION,
  S_THERMAL,
  S_MEMORY_RECLAIM,
  S_PEAK_VRAM,
  cnDataset,
  cnTrainFields,
  cnLR,
  S_COMPILE_EXPERT,
  S_MODULE_OFFLOAD_CORE,
  S_MODULE_OFFLOAD_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_QUALITY_OPTIMIZATION_PACK, S_LORA_VARIANTS, S_PERCEPTUAL_ANCHOR_LOSS,
  S_SAMPLING_OPTIMIZATION_RESERVE, S_REPA_RESERVE, S_EXPERIMENTAL_PROBES,
  S_DIAGNOSTICS_MONITORING, S_AUTO_CONTROLLER, S_TURBOCORE, S_DIT_BLOCKSKIP, S_SIGMA_DEPTH_SCHEDULE,
  S_NEGATIVE_SEMANTIC_REGULARIZATION,
  S_WEIGHT_COMPOSER, S_REGION_FOCUS, S_PROGRESSIVE_TRAINING, S_ADAPTIVE_TRAINING,
} from './schemaFrontierGroups.js';

// 分层 Alpha（通用 DiT 版）—— 按目标模块分别设置 LoRA alpha。后端字段 network_alpha_map_json。
// 非 anima 架构无固定模块类型分组，故用文本框：每行「模块后缀=alpha」或 JSON {后缀: alpha}。
// 例：qkv=16\nout=8  或  {"qkv":16,"out":8}。留空 = 全局 network_alpha = 传统 LoRA = parity。
const S_LAYERED_ALPHA_GENERIC = [
  { key: 'network_alpha_map_json', type: 'textarea', label: '分层 Alpha 映射', title: 'network_alpha_map_json', desc: '按目标模块分别设置 LoRA alpha', defaultValue: '', placeholder: '例:\nattention.qkv=16\nattention.out=8\nfeed_forward.w2=32' }
];

// ---- FLUX LoRA ----
export const FLUX_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 模型路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 文本编码器路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 文本编码器路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有的 LoRA 模型上继续训练，填写路径', defaultValue: '' },

    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从某个 save_state 保存的中断状态继续训练，选择 save-state 目录', defaultValue: '' }
]),
  sec('flux-params', 'model', 'FLUX 专用参数', '时间步采样、CFG、损失函数等。', [
    ...flowParams({ ts: 'sigmoid', gs: 1.0 }),
    { key: 't5xxl_max_token_length', type: 'number', label: 'T5XXL 最大 token', title: 't5xxl_max_token_length', desc: 'T5-XXL 最大 token 长度', defaultValue: '', min: 1 },
    { key: 'apply_t5_attn_mask', type: 'boolean', label: '应用 T5 注意力掩码', title: 'apply_t5_attn_mask', desc: '应用 T5 注意力掩码以更好处理变长文本', defaultValue: true },
    { key: 'train_t5xxl', type: 'boolean', label: '训练T5XXL（不推荐）', title: 'train_t5xxl', desc: '训练 T5-XXL 文本编码器（不推荐，显存开销极大）', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', 'LoRA。', netLora('networks.lora_flux', 4, 16, 256, [], [
    { value: 'networks.tlora_flux', label: 'T-LoRA (FLUX)', disabled: true, disabledReason: 'FLUX T-LoRA 暂未接入后端训练器' },
    { value: 'networks.oft_flux', label: 'OFT (FLUX)', disabled: true, disabledReason: 'FLUX OFT 暂未接入后端训练器' },
    { value: 'lycoris.kohya', label: 'LyCORIS', disabled: true, disabledReason: 'FLUX LyCORIS 暂未接入后端训练器' }
], false)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  // 与其它 DiT 主路径对齐：高级模式下露出先锋 tab（画质包 + 诊断）
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Lumina LoRA ----
export const LUMINA_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Lumina 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'lumina-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Lumina 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 模型路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'gemma2', type: 'file', pickerType: 'model-file', label: 'Gemma2 模型路径', title: 'gemma2', desc: 'Gemma2 文本模型路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有的 LoRA 模型上继续训练，填写路径', defaultValue: '' },

    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从某个 save_state 保存的中断状态继续训练，选择 save-state 目录', defaultValue: '' }
]),
  sec('lumina-params', 'model', 'Lumina 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 6.0 }),
    { key: 'gemma2_max_token_length', type: 'number', label: 'Gemma2 最大 token', title: 'gemma2_max_token_length', desc: 'Gemma2 最大 token 长度', defaultValue: '', min: 1 },
    { key: 'use_sage_attn', type: 'boolean', label: '启用 Sage Attention', title: 'use_sage_attn', desc: '启用 Sage Attention 加速', defaultValue: false },
        { key: 'system_prompt', type: 'string', label: '系统提示词', title: 'system_prompt', desc: 'Lumina 系统提示词', defaultValue: '' },
    { key: 'sample_batch_size', type: 'number', label: '预览图采样批量', title: 'sample_batch_size', desc: '预览图采样批量大小', defaultValue: '', min: 1 }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_lumina', 4, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- DiT 占位/通用 helper ----
const placeholderWarningField = (familyName) => ({
  key: 'route_status_note',
  type: 'textarea',
  label: '链路状态',
  desc: `${familyName} 轻量入口，暂不能直接训练`,
  defaultValue: `${familyName} 当前只是轻量选择入口，训练核心尚未深度接入。`,
});

const qwenImageSections = (typeId = 'qwen-image-lora') => [
  sec('model-settings', 'model', '训练用模型', 'Qwen Image 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Qwen Image DiT 路径', title: 'pretrained_model_name_or_path', desc: 'Qwen Image 底模或 transformer 权重路径', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'Qwen Image VAE 路径', title: 'vae', desc: 'VAE 路径，可留空等待后续接入', defaultValue: '' },
    { key: 'text_encoder', type: 'file', pickerType: 'model-file', label: '文本编码器路径', title: 'text_encoder', desc: 'Qwen Image 文本编码器路径，可留空等待后续接入', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 上继续训练，当前为占位字段', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从中断状态继续训练，当前为占位字段', defaultValue: '' }
]),
  sec('qwen-image-params', 'model', 'Qwen Image 参数', '', [
    placeholderWarningField('Qwen Image'),
    ...flowParams({ ts: 'shift', dfs: 3.0 })
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_qwen_image', 16, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- Qwen Image LoRA ----
export const QWEN_IMAGE_LORA_SECTIONS = qwenImageSections();

// ---- HunyuanDiT helper ----
const hunyuanDitSections = (typeId = 'hunyuan-dit-lora') => [
  sec('model-settings', 'model', '训练用模型', 'HunyuanDiT 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'HunyuanDiT 模型路径', title: 'pretrained_model_name_or_path', desc: '底模或 DiT 权重路径', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径，可留空等待后续接入', defaultValue: '' },
    { key: 'text_encoder', type: 'file', pickerType: 'model-file', label: '文本编码器路径', title: 'text_encoder', desc: '文本编码器路径，可留空等待后续接入', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 上继续训练，当前为占位字段', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从中断状态继续训练，当前为占位字段', defaultValue: '' }
]),
  sec('hunyuan-params', 'model', 'HunyuanDiT 参数', '', [
    placeholderWarningField('HunyuanDiT'),
    ...flowParams({ ts: 'sigma', dfs: 5.0 }),
    { key: 'attn_mode', type: 'select', label: 'Attention 实现', title: 'attn_mode', desc: '默认自动：跟随启动器 runtime 的默认', defaultValue: '', attentionBackendOptions: true, options: [
      { value: '', label: '自动（跟随启动环境）' },
      { value: 'torch', label: 'Torch' },
      { value: 'sdpa', label: 'SDPA' },
      { value: 'xformers', label: 'xFormers' },
      { value: 'flash', label: 'FlashAttention 2' },
      { value: 'sageattn', label: 'SageAttention' }
] },
    { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数', defaultValue: '', step: 0.01 },
    { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '拆分 attention 以节省显存', defaultValue: false },
    { key: 'text_encoder_cpu', type: 'boolean', label: '文本编码器用 CPU', title: 'text_encoder_cpu', desc: '将文本编码器放在 CPU 上以节省显存', defaultValue: false },
    { key: 'vae_chunk_size', type: 'number', label: 'VAE 解码分块', title: 'vae_chunk_size', desc: 'VAE 解码时的分块大小，更小值更省显存', defaultValue: '', min: 1 }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_hunyuan_dit', 16, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_TARGET_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- HunyuanDiT LoRA ----
export const HUNYUAN_DIT_LORA_SECTIONS = hunyuanDitSections();

export const HUNYUAN_IMAGE_COMPAT_SECTIONS = hunyuanDitSections('hunyuan-image-lora');

const krea2WeightCompressionRequested = (config) => {
  const preset = String(config?.weight_compression_preset || 'off').trim().toLowerCase();
  const enabled = config?.weight_compression_enabled;
  return preset !== 'off' || enabled === true || enabled === 'true' || enabled === 1;
};

const KREA2_SPEED_FLOW_FIELDS = (() => {
  const fields = [];
  for (const field of S_SPEED_FLOW) {
    if (field.key === 'weight_compression_preset') {
      fields.push(
        {
          key: 'weight_compression_preset',
          type: 'select',
          label: '冻结主干量化',
          desc: '冻结基座权重压缩预设',
          defaultValue: 'off',
          options: [
            { value: 'off', label: '关闭' },
            { value: 'stable_backbone_int8', label: '骨干 INT8（运行时压缩，非 Comfy 导出）' },
            { value: 'experimental_float8', label: '主干 FP8（torchao / RTX 40 系优先）' },
            { value: 'text_encoder_int8', label: '文本编码器 INT8' },
            { value: 'both_int8', label: '主干+文本编码器 INT8' }
],
        },
        {
          key: 'weight_compression_verify',
          type: 'boolean',
          label: '压缩能力探测',
          desc: '启动前探测当前运行时是否真的支持所选压缩后端。',
          defaultValue: true,
          visibleWhen: krea2WeightCompressionRequested,
        },
      );
      continue;
    }
    if (field.key === 'fp8_base' || field.key === 'fp8_base_unet') continue;
    fields.push(field);
  }
  return fields;
})();

// ---- FLUX Finetune ----
export const FLUX_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX 全参微调。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-finetune' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 文本编码器路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 文本编码器路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从某个 save_state 保存的中断状态继续训练，选择 save-state 目录', defaultValue: '' }
]),
  sec('flux-params', 'model', 'FLUX 专用参数', '', [
    ...flowParams({ ts: 'sigma', mp: 'sigma_scaled', dfs: 3.0, gs: 3.5 }),
    { key: 't5xxl_max_token_length', type: 'number', label: 'T5XXL 最大 token', title: 't5xxl_max_token_length', desc: 'T5-XXL 最大 token 长度', defaultValue: '', min: 1 },
    { key: 'apply_t5_attn_mask', type: 'boolean', label: '应用 T5 注意力掩码', title: 'apply_t5_attn_mask', desc: '应用 T5 注意力掩码以更好处理变长文本', defaultValue: false },
    { key: 'mem_eff_save', type: 'boolean', label: '省内存保存', title: 'mem_eff_save', desc: '使用更省内存的保存方式', defaultValue: false },
    { key: 'blockwise_fused_optimizers', type: 'boolean', label: 'Blockwise fused optimizer', desc: '使用分块融合优化器，全参微调时可大幅省显存', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_FT_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...VRAM_AUTO_ENHANCE_FIELDS, ...S_DIT_PERFORMANCE_EXPERT, ...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('lulynx-settings', 'advanced', 'Lulynx 核心', 'SafeGuard、EMA、ResourceManager、SmartRank、AutoController。', S_LULYNX_SDXL),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Lumina Finetune ----
export const LUMINA_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Lumina 全参微调。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'lumina-finetune' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Lumina 模型路径', title: 'pretrained_model_name_or_path', desc: 'Lumina 模型路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AE 路径', defaultValue: '' },
    { key: 'gemma2', type: 'file', pickerType: 'model-file', label: 'Gemma2 路径', title: 'gemma2', desc: 'Gemma2 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '继续训练路径', defaultValue: '' }
]),
  sec('lumina-params', 'model', 'Lumina 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 6.0 }),
    { key: 'gemma2_max_token_length', type: 'number', label: 'Gemma2 最大 token', title: 'gemma2_max_token_length', desc: 'Gemma2 最大 token', defaultValue: '', min: 1 },
    { key: 'use_sage_attn', type: 'boolean', label: '启用 Sage Attention', title: 'use_sage_attn', desc: '启用 Sage Attention', defaultValue: false },
        { key: 'sample_batch_size', type: 'number', label: '预览图采样批量', title: 'sample_batch_size', desc: '预览图采样批量大小', defaultValue: '', min: 1 },
    { key: 'mem_eff_save', type: 'boolean', label: '省内存保存', title: 'mem_eff_save', desc: '使用更省内存的保存方式', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_FT_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- FLUX ControlNet ----
export const FLUX_CN_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX ControlNet。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-controlnet' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: 'FLUX 模型路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AE 路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 路径', defaultValue: '' },
    { key: 'controlnet_model_name_or_path', type: 'file', pickerType: 'model-file', label: '已有 ControlNet 路径', title: 'controlnet_model_name_or_path', desc: '已有 ControlNet 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '继续训练路径', defaultValue: '' }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Newbie 块常驻 helper ----
const NEWBIE_BLOCK_RESIDENCY_FIELDS = [
  { key: 'lora_activation_recompute_mode', type: 'select', label: 'LoRA 分支重算', title: 'lora_activation_recompute_mode', desc: '降低原生 DiT LoRA 反传激活峰值。', defaultValue: 'auto', options: LORA_RECOMPUTE_OPTIONS },
  { key: 'newbie_block_residency', type: 'select', label: 'Newbie Block Offload', title: 'newbie_block_residency', desc: '控制原生 Newbie 冻结 DiT 权重的驻留策略。', defaultValue: 'block_cpu_pinned', options: DIT_BLOCK_RESIDENCY_OPTIONS },
  { key: 'newbie_block_residency_min_params', type: 'number', label: 'Newbie Offload 最小参数量', title: 'newbie_block_residency_min_params', desc: '只托管参数量达到该阈值的冻结 Linear。0 表示不过滤。', defaultValue: 0, min: 0, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  { key: 'newbie_block_checkpointing', type: 'boolean', label: 'Newbie 梯度检查点（分块重算）', title: 'newbie_block_checkpointing', desc: 'Newbie 的梯度检查点主力：反传时按 DiT block 重算激活以降低显存峰值。比通用梯度检查点更省显存。', defaultValue: false, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  { key: 'newbie_block_checkpointing_mode', type: 'select', label: 'Newbie Checkpointing 模式', title: 'newbie_block_checkpointing_mode', desc: 'block 整块重算；selective 可选（与 Anima 对齐）。', defaultValue: 'block', options: [
    { value: 'block', label: 'block（整块重算）' },
    { value: 'selective', label: 'selective' }
], visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_checkpointing', true)) },
  { key: 'newbie_block_checkpointing_interval', type: 'number', label: 'Newbie Checkpointing 间隔', title: 'newbie_block_checkpointing_interval', desc: '每 N 个 DiT block 设一个检查点（1=全部）。N>1 少重算、多占激活显存。', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_checkpointing', true)) },
  { key: 'newbie_block_prefetch', type: 'boolean', label: 'Newbie Block 预取', title: 'newbie_block_prefetch', desc: 'Newbie Block 预取', defaultValue: false, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  { key: 'newbie_block_prefetch_depth', type: 'number', label: 'Newbie 预取深度', title: 'newbie_block_prefetch_depth', desc: '向前预取几个 block', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_prefetch', true)) },
  { key: 'newbie_block_prefetch_mode', type: 'select', label: 'Newbie 预取模式', title: 'newbie_block_prefetch_mode', desc: 'original=固定深度（默认）；adaptive=自适应深度。', defaultValue: 'original', options: [
    { value: 'original', label: 'original（固定深度）' },
    { value: 'adaptive', label: 'adaptive（自适应）' }
], visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_prefetch', true)) },
  { ...PCIE_TRANSFER_FORMAT_FIELD, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  ...vortexRuntimeFields('newbie_block_residency'),
  pcieDeltaCacheField('newbie_block_residency'),
  ...pcieDeltaCacheModeFields('newbie_block_residency')
];

// ---- Newbie LoRA (实验) ----
export const NEWBIE_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Newbie 基座模型与可选组件路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'newbie-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Newbie 基座模型目录', title: 'pretrained_model_name_or_path', desc: '必填，要求完整本地目录', defaultValue: '' },
    { key: 'transformer_path', type: 'folder', pickerType: 'folder', label: 'Transformer 目录', title: 'transformer_path', desc: '单独指定 transformer 目录（可选）', defaultValue: '' },
    { key: 'gemma_model_path', type: 'folder', pickerType: 'folder', label: 'Gemma 文本编码器目录', title: 'gemma_model_path', desc: '单独指定 Gemma 文本编码器目录（可选）', defaultValue: '' },
    { key: 'clip_model_path', type: 'folder', pickerType: 'folder', label: 'Jina CLIP 目录', title: 'clip_model_path', desc: '单独指定 Jina CLIP 目录（可选）', defaultValue: '' },
    { key: 'vae_path', type: 'folder', pickerType: 'folder', label: 'VAE 目录', title: 'vae_path', desc: '单独指定 VAE 目录（可选）', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'folder', label: '继续训练路径', title: 'resume', desc: '从已有 checkpoint / save_state 路径继续训练（可选）', defaultValue: '' }
]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率，宽x高。当前建议 1024 起步', defaultValue: '1024,1024' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', title: 'dataloader_num_workers', desc: 'DataLoader 工作线程数', defaultValue: 4, min: 0 },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', title: 'min_bucket_reso', desc: 'bucket 最小边（cache-first 回放通常沿用缓存分辨率）', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', title: 'max_bucket_reso', desc: 'bucket 最大边（cache-first 回放通常沿用缓存分辨率）', defaultValue: 2048, min: 64 },
    { key: 'bucket_reso_steps', type: 'number', label: 'Bucket 步长', title: 'bucket_reso_steps', desc: 'bucket 分辨率步进（仅在分桶真正生效时有意义）', defaultValue: 64, min: 1 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', desc: '回退读取的 caption 扩展名', defaultValue: '.txt' }
]),
  sec('save-settings', 'model', '训练与保存', '训练参数与输出设置。', [
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '输出目录', defaultValue: './output/newbie' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出名称', defaultValue: 'newbie-lora' },
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', desc: '每 N 步保存一次。0 表示仅在训练结束时保存', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', desc: '每 N 个 epoch 保存一次。0 表示每个 epoch 都保存', defaultValue: 0, min: 0 },
    { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', desc: '最大训练 epoch', defaultValue: 50, min: 1 },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '最大训练步数。0 表示按 epoch 推导', defaultValue: 0, min: 0 },
    { key: 'train_batch_size', type: 'number', label: '批量大小', title: 'train_batch_size', desc: '单卡 batch size', defaultValue: 1, min: 1 },
    { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累积', title: 'gradient_accumulation_steps', desc: '每 N 次 microbatch 才执行一次', defaultValue: 1, min: 1 },
    { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: 'fast（默认）：仅在 optimizer.', defaultValue: 'fast', options: [
      { value: 'fast', label: 'fast' },
      // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
      // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
      { value: 'classic', label: 'classic（逐 microbatch 检查）' }
], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
    ditGradientCheckpointingField('Newbie'),
    { key: 'mixed_precision', type: 'select', label: '训练精度', title: 'mixed_precision', desc: '训练精度', defaultValue: 'bf16', options: ['bf16', 'fp16', 'fp32'] },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子', defaultValue: 42 }
]),
  sec('optimizer-settings', 'training', '优化器与学习率', '', [
    { key: 'optimizer_type', type: 'select', label: '优化器', title: 'optimizer_type', desc: 'Newbie 优化器设置', defaultValue: 'AdamW8bit', options: TARGET_LORA_OPTIMIZERS },
    { key: 'optimizer_backend', type: 'select', label: 'AdamW 后端', title: 'optimizer_backend', desc: 'AdamW 后端档位；compiled_step 可包装 step', defaultValue: 'auto', options: OPTIMIZER_BACKEND_OPTIONS, visibleWhen: all(when('performance_expert_mode', true), adamwFamilyOptimizer) },
    { key: 'advanced_optimizer_strategy', type: 'select', label: '高级优化策略', title: 'advanced_optimizer_strategy', desc: '默认 auto 不改变训练', defaultValue: 'auto', options: ADVANCED_OPTIMIZER_STRATEGY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
    { key: 'optimizer_args_custom', type: 'textarea', label: '自定义 optimizer_args', title: 'optimizer_args_custom', desc: '自定义优化器参数，每行一个 key=value。', defaultValue: '' },
    { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '学习率', defaultValue: '0.0001' },
    { key: 'weight_decay', type: 'number', label: '权重衰减', title: 'weight_decay', desc: '权重衰减', defaultValue: 0.01, min: 0, step: 0.0001 },
    { key: 'lr_scheduler', type: 'select', label: '学习率调度器', title: 'lr_scheduler', desc: 'Newbie 学习率调度器', defaultValue: 'cosine', options: schedulerOptions(ALL_SCHEDULERS) },
    { key: 'lr_warmup_steps', type: 'number', label: 'Warmup 步数', title: 'lr_warmup_steps', desc: 'warmup 步数', defaultValue: 100, min: 0 },
    { key: 'lr_scheduler_num_cycles', type: 'number', label: '重启次数', title: 'lr_scheduler_num_cycles', desc: 'cosine_with_restarts 的重启次数', defaultValue: 1, min: 1, visibleWhen: when('lr_scheduler', 'cosine_with_restarts') },
    { key: 'lr_scheduler_type', type: 'string', label: '自定义调度器类', title: 'lr_scheduler_type', desc: '自定义学习率调度器类路径', defaultValue: '' },
    { key: 'lr_scheduler_args', type: 'textarea', label: '自定义调度器参数', title: 'lr_scheduler_args', desc: '自定义学习率调度器参数，一行一个 key=value', defaultValue: '' },
    ...S_LOSS_AWARE_LR,
    { key: 'prodigy_d0', type: 'string', label: 'Prodigy d0', desc: 'Prodigy / ProdigyPlus', defaultValue: '', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
    { key: 'prodigy_d_coef', type: 'string', label: 'Prodigy d_coef', desc: 'Prodigy / ProdigyPlus d 系数，影响自适应学习率大小', defaultValue: '2.0', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
    { key: 'max_grad_norm', type: 'number', label: '梯度裁剪', title: 'max_grad_norm', desc: '梯度裁剪', defaultValue: 1.0, min: 0, step: 0.01 }
]),
  sec('negative-semantic-regularization', 'frontier', '负面语义正则', '用负面提示词约束 LoRA 在不希望语义上的增量。', [...S_NEGATIVE_SEMANTIC_REGULARIZATION]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('peak-vram-settings', 'speed', '显存峰值控制', '目标等效 batch、启动峰值保护、micro-batch 拆分与显存诊断。', [...S_PEAK_VRAM]),

  sec('adapter-settings', 'network', '适配器设置', 'LoRA / LoKr 适配器参数。', [
    { key: 'adapter_type', type: 'select', label: '适配器类型', title: 'adapter_type', desc: 'Newbie 适配器类型，会映射到原生 LoRA', defaultValue: 'lora', options: NATIVE_ADAPTER_TYPES },
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA / LoKr rank', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA / LoKr alpha', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', desc: 'LoRA dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 每步随机采样激活 rank 的下界', defaultValue: 1, min: 1, visibleWhen: when('adapter_type', 'flexrank') },
    { key: 'newbie_target_modules', type: 'textarea', label: '目标模块列表', title: 'newbie_target_modules', desc: '目标模块列表，一行一个', defaultValue: 'attention.qkv\nattention.out\nfeed_forward.w2\ntime_text_embed.1\nclip_text_pooled_proj.1' },
    { key: 'lokr_rank', type: 'number', label: 'LoKr Rank', desc: 'LoKr rank', defaultValue: 32, min: 1, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_alpha', type: 'number', label: 'LoKr Alpha', desc: 'LoKr alpha', defaultValue: 32, min: 1, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_factor', type: 'number', label: 'LoKr Factor', desc: 'LoKr factor。-1 表示自动', defaultValue: -1, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_dropout', type: 'number', label: 'LoKr Dropout', desc: 'LoKr dropout', defaultValue: 0.05, min: 0, step: 0.01, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_rank_dropout', type: 'number', label: 'LoKr Rank Dropout', desc: 'LoKr rank dropout', defaultValue: 0, min: 0, step: 0.01, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_module_dropout', type: 'number', label: 'LoKr Module Dropout', desc: 'LoKr module dropout', defaultValue: 0, min: 0, step: 0.01, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_train_norm', type: 'boolean', label: 'LoKr 训练 Norm', title: 'lokr_train_norm', desc: 'LoKr 同时训练模型中的归一化层可学习参数（如 LayerNorm', defaultValue: false, visibleWhen: when('adapter_type', 'lokr') },
    ...S_LAYERED_ALPHA_GENERIC,
    ...S_LORA_VARIANTS
]),
  sec('cache-runtime-settings', 'speed', '缓存与运行时', '缓存流程控制与显存管理。', [
    { key: 'use_cache', type: 'boolean', label: '启用缓存流程', title: 'use_cache', desc: '启用缓存流程', defaultValue: true },
    { key: 'newbie_force_cache_only', type: 'boolean', label: '仅缓存完备样本参与训练', title: 'newbie_force_cache_only', desc: '只使用缓存完备样本进入正式训练', defaultValue: true },
    { key: 'newbie_rebuild_cache', type: 'boolean', label: '强制重建缓存', title: 'newbie_rebuild_cache', desc: '强制重建已有缓存', defaultValue: false },
    { key: 'newbie_cache_build_batch_size', type: 'number', label: '缓存构建批大小', title: 'newbie_cache_build_batch_size', desc: '首轮缓存构建时每批编码的图像数', defaultValue: 8, min: 1 },
    { key: 'newbie_cache_build_prefetch', type: 'boolean', label: '缓存构建 CPU 预取', title: 'newbie_cache_build_prefetch', desc: '首轮缓存构建时在 CPU 线程预解码下一批图像，与 GPU', defaultValue: false },
    { key: 'gemma3_prompt', type: 'textarea', label: 'Gemma3 系统提示词', title: 'gemma3_prompt', desc: 'Gemma3 系统提示词。默认与官方模板对齐', defaultValue: 'You are an assistant designed to generate high-quality anime images with the highest degree of image-text alignment based on textual prompts. <Prompt Start>' },
    { key: 'newbie_gemma_max_token_length', type: 'number', label: 'Gemma 最大 Token', title: 'newbie_gemma_max_token_length', desc: 'Gemma 最大 token 长度', defaultValue: 512, min: 32 },
    { key: 'newbie_clip_max_token_length', type: 'number', label: 'CLIP 最大 Token', title: 'newbie_clip_max_token_length', desc: 'CLIP 最大 token 长度', defaultValue: 2048, min: 32 },
    { key: 'newbie_caption_length_bucket_size', type: 'number', label: 'Caption Bucket 大小', title: 'newbie_caption_length_bucket_size', desc: 'caption 长度 bucket 大小。', defaultValue: 0, min: 0 },
    ...VRAM_AUTO_ENHANCE_FIELDS,
    ...NEWBIE_BLOCK_RESIDENCY_FIELDS,
    { key: 'swap_granularity', type: 'select', label: '显存交换模式', title: 'swap_granularity', desc: '显存交换模式', defaultValue: 'off', options: ['off', 'auto', 'block', 'merged_block', 'layer'] },
    { key: 'swap_ratio', type: 'slider', label: '显存交换比例', title: 'swap_ratio', desc: '按原始 block/layer 总数计算交换比例。', defaultValue: 0, min: 0, max: 1, step: 0.05, visibleWhen: swapEnabled },
    { key: 'swap_count', type: 'number', label: '显存交换数量', title: 'swap_count', desc: '高级：绝对交换数量。大于 0 时优先于比例。', defaultValue: 0, min: 0, visibleWhen: swapEnabled },
    { key: 'block_merge_size', type: 'number', label: '合并 Block 大小', title: 'block_merge_size', desc: 'merged_block 模式下每组包含的 block 数。', defaultValue: 2, min: 2, visibleWhen: when('swap_granularity', 'merged_block') },
    { key: 'block_swap_strategy', type: 'select', label: 'BlockSwap 搬运策略', title: 'block_swap_strategy', desc: 'auto 使用后端解析', defaultValue: 'auto', options: BLOCK_SWAP_STRATEGY_OPTIONS, visibleWhen: all(swapEnabled, when('performance_expert_mode', true)) },
    { key: 'blocks_to_swap', type: 'number', label: 'CPU 交换 Block 数', title: 'blocks_to_swap', desc: 'CPU 交换 Block 数', defaultValue: 0, min: 0 },
    { key: 'newbie_auto_swap_release', type: 'boolean', label: '自动 Swap 释放', desc: '显存占用持续偏低时逐步减少 blocks_to_swap，回收训练速度。', defaultValue: false },
    { key: 'cpu_offload_checkpointing', type: 'boolean', label: 'CPU 卸载检查点', title: 'cpu_offload_checkpointing', desc: 'checkpointing 时把部分张量卸载到 CPU', defaultValue: false },
    ...S_MEMORY_RECLAIM,
    { key: 'pytorch_cuda_expandable_segments', type: 'boolean', label: '显存碎片优化', title: 'pytorch_cuda_expandable_segments', desc: '启用 PyTorch CUDA', defaultValue: true },
    { key: 'newbie_safe_fallback', type: 'boolean', label: 'OOM 安全回退', title: 'newbie_safe_fallback', desc: 'OOM 时自动尝试更保守的 Newbie 安全回退', defaultValue: true },
    { key: 'trust_remote_code', type: 'boolean', label: '允许远程代码', title: 'trust_remote_code', desc: '允许 transformers / diffusers 加载远程自定义代码', defaultValue: false },
    ...S_DIT_PERFORMANCE_EXPERT
  ]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('lulynx-settings', 'advanced', 'Lulynx 核心 (Newbie)', 'SafeGuard、EMA、ResourceManager、SmartRank、AutoController。', S_LULYNX_SDXL),
  sec('log-settings', 'model', '日志设置', '', [
    { key: 'log_with', type: 'select', label: '日志模块', title: 'log_with', desc: '日志模块', defaultValue: 'tensorboard', options: ['tensorboard', 'wandb'] },
    { key: 'logging_dir', type: 'folder', pickerType: 'folder', label: '日志保存文件夹', title: 'logging_dir', desc: '日志保存文件夹', defaultValue: './logs' },
    { key: 'log_prefix', type: 'string', label: '日志前缀', title: 'log_prefix', desc: '日志前缀', defaultValue: '' },
    { key: 'wandb_api_key', type: 'string', label: 'WandB API Key', desc: 'wandb 的 api 密钥', defaultValue: '', visibleWhen: when('log_with', 'wandb') }
]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 Newbie 的共享噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('dit-blockskip-training', 'frontier', 'DiT BlockSkip 训练裁剪', '训练时按固定计划跳过部分 Newbie DiT block 计算。开启后只走 blockskip，', [...S_DIT_BLOCKSKIP], { expert: true }),
  sec('sigma-depth-schedule', 'frontier', 'σ 深度调度', '按当前样本 RF σ 调度本步 DiT 计算深度；identity 跳过不断 grad。', [...S_SIGMA_DEPTH_SCHEDULE], { expert: true }),
  sec('quality-pack-settings', 'frontier', '图像质量优化', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK]),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理 + 感知锚, 参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针/诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控/统计/深度诊断/逐层监测。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '高级功能。根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true })
];

// ---- Krea-2 LoRA (Turbo / Raw) ----
export const KREA2_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Krea-2 模型路径（Turbo 或 Raw：可选模型目录，也可直接选单个 .safetensors 文件）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'krea2-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'Krea-2 模型路径', title: 'pretrained_model_name_or_path', desc: '可填模型目录或直接选单个 .safetensors 文件；选单文件时 TE/VAE 会从同目录的 text_encoder/、vae/ 子目录或兄弟 Krea-2 目录树自动解析，找不到时退用 CLIP/sdxl-vae 兜底（可能影响训练质量）', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/krea2' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'krea2-lora' },
    { key: 'use_cache', type: 'boolean', label: '启用缓存流程', title: 'use_cache', desc: '优先复用 Krea-2 latent 与文本编码缓存，避免训练时常驻 VAE/文本编码器。', defaultValue: true },
    {
      key: 'krea2_training_mode',
      type: 'select',
      label: '训练模式',
      desc: 'Krea2 训练模式',
      defaultValue: 'de_turbo',
      options: [
        { value: 'de_turbo', label: 'De-Turbo（Turbo 推荐；Raw 会自动改 standard）' },
        { value: 'frozen_delta', label: 'Frozen Delta（冻底模 / 偏保 Turbo 快推）' },
        { value: 'sigma_selective', label: 'Sigma Selective（只训高噪声区间）' },
        { value: 'standard', label: 'Standard（Raw 推荐 / 标准 RF）' }
],
    },
    {
      key: 'krea2_vram_preset',
      type: 'select',
      label: '显存预设',
      desc: '控制 Krea-2 block offload 的默认 GP',
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: 'Standard（默认平衡 / 4 GPU slots）' },
        { value: 'aggressive', label: 'Aggressive（更省显存 / 3 GPU slots）' }
],
    },
    {
      key: 'krea2_text_fusion_mode',
      type: 'select',
      label: '文本融合模式',
      desc: '决定缓存与 DiT 装载：fusion_frozen 缓存 txtfusion 后输出（默认，塔不参训）；fusion_trainable 缓存 12 层原始 stack 并装回 343M txtfusion 塔参训。两种模式的缓存互不兼容，切换需重建缓存',
      defaultValue: 'fusion_frozen',
      options: [
        { value: 'fusion_frozen', label: 'Fusion Frozen（默认；缓存融合后文本，塔冻结）' },
        { value: 'fusion_trainable', label: 'Fusion Trainable（缓存 12 层 stack，塔参训）' }
],
    },
    {
      key: 'krea2_sigma_selective_threshold',
      type: 'number',
      label: 'Sigma Selective 阈值',
      desc: 'sigma_selective 模式下的最低 sigma 值，范围',
      defaultValue: 0.5,
      min: 0.1,
      max: 0.95,
      step: 0.05,
      visibleWhen: (c) => c.krea2_training_mode === 'sigma_selective',
    }
]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '推荐 512,512（显存友好）或 768,768', defaultValue: '512,512' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 4, min: 0 }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'Krea-2 LoRA 参数。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...KREA2_SPEED_FLOW_FIELDS]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('krea2-offload-settings', 'speed', 'Krea2 Block/Layer Offload', 'resident / block_offload / layer_offload 与预取、槽位。vram_preset 会覆盖默认 slots。', [...KREA2_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 Krea-2 的共享噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

const KREA2_DEPTH_EXPANSION_FIELDS = [
  { key: 'krea2_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'krea2_depth_expansion_enabled', desc: '交错复制 Krea-2 block，并以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'krea2_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'krea2_depth_expansion_target_layers', desc: '扩层后的 Transformer block 总数。', defaultValue: 40, min: 2, step: 1, visibleWhen: when('krea2_depth_expansion_enabled', true) },
  { key: 'krea2_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'krea2_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('krea2_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

const KREA2_FT_EXCLUDED_FIELDS = new Set([
  'lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled',
  'weight_compression_preset', 'weight_compression_verify', 'train_quant_preset',
  'weight_compression_enabled', 'weight_compression_target', 'weight_compression_format',
  'quant_train_mode', 'keep_w8_vram_prefer', 'quant_train_convrot',
  'layer_precision_policy', 'layer_precision_default', 'layer_precision_sensitivity_mode',
  'layer_precision_activation_geometry_path',
  'layer_precision_rules_json', 'layer_precision_overrides_json', 'quant_requantize_policy',
  'vram_swap_to_ram',
  'lulynx_weight_noise_enabled', 'lulynx_weight_noise_mode', 'lulynx_weight_noise_sigma',
  'lulynx_weight_noise_bound_norm', 'lulynx_weight_noise_log_every', 'merge_export',
  'network_train_unet_only', 'network_train_text_encoder_only',
]);

// krea2-finetune 派生自 KREA2_LORA_SECTIONS，若不处理会把 krea2-lora 的三条历史
// 重复（save_every_n_steps / save_every_n_epochs / train_batch_size）带进新类型，
// 撞 webui_duplicate_field_key_smoke 的重复总量基线。跨 section 按 key 去重：
// 两份定义的默认值相同，保留首份不改变 createDefaultConfig 的生效结果。
const dropDuplicateFieldKeys = (sections) => {
  const seen = new Set();
  return sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => {
      if (!field?.key) return true;
      if (seen.has(field.key)) return false;
      seen.add(field.key);
      return true;
    }),
  }));
};

export const KREA2_FT_SECTIONS = dropDuplicateFieldKeys(KREA2_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'krea2-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Krea-2 底座输出文件名', defaultValue: 'krea2-expanded' };
      if (field.key === 'krea2_training_mode') {
        return { ...field, options: field.options.filter((option) => option.value !== 'frozen_delta') };
      }
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Krea-2 全参微调', description: '训练完整 Krea-2 DiT，或扩展深度后只训练新增层。', fields: [...fields, ...KREA2_DEPTH_EXPANSION_FIELDS] };
  }));

// ---- FLUX.2 Klein LoRA ----
// 分模型默认：slots=4 / prefetch=3 / pin=true（与 krea2 4/2 字段分离）
// 不挂：krea2_training_mode / vram_preset / layer_offload / de_turbo
export const FLUX2_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX.2 Klein 模型路径（完整本地目录，含 transformer + text_encoder + vae + scheduler）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux2-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'FLUX.2 模型目录', title: 'pretrained_model_name_or_path', desc: '完整本地目录，含 transformer/、text_encoder/', defaultValue: '' },
    {
      key: 'flux2_model_version',
      type: 'select',
      label: '模型版本',
      desc: '当前产品默认 klein-base-9b。',
      defaultValue: 'klein-base-9b',
      options: [
        { value: 'klein-base-9b', label: 'klein-base-9b（推荐）' }
      ]
    },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/flux2' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'flux2-lora' }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。cache 文件后缀 *_flux2.npz。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '推荐 1024,1024；显存紧张可用 512,512', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1536, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '启用后优先读 latent/TE 缓存（*_flux2.', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'FLUX.2 Klein LoRA 参数。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('flux2-offload-settings', 'speed', 'FLUX.2 Block Offload', 'resident / block_offload 与预取、槽位。默认 slots=4、prefetch=3、pin=true。无 layer_offload。', [...FLUX2_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 FLUX.2 RF 噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

// ---- Boogu-Image Base LoRA（RunComfy 产品默认）----
// rank/α 32/32 · LR 1e-4 · steps 2500 · buckets 512+768+1024 · Layer offload OFF
// cache 后缀 *_boogu.npz；指令 TE dim=4096；支持 BF16 与官方 Base/Edit-fp8（torchao dequant）
// ---- Z-Image Base LoRA ----
export const ZIMAGE_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练与模型', 'Z-Image 模型路径：diffusers 本地目录（含 transformer + text_encoder + vae + scheduler）。默认 Base 包。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'zimage-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Z-Image 模型目录', title: 'pretrained_model_name_or_path', desc: 'diffusers 目录，含 transformer/', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/zimage' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'zimage-lora' },
    { key: 'zimage_max_text_length', type: 'number', label: '最大文本长度', title: 'zimage_max_text_length', desc: 'Qwen3 TE 序列长度，默认 512。', defaultValue: 512, min: 64, max: 2048 },
    { key: 'zimage_timestep_sampling', type: 'select', label: '时间步采样', title: 'zimage_timestep_sampling', desc: 'flow matching 采样；默认 shift。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigmoid', label: 'sigmoid' }
    ] },
    { key: 'zimage_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'zimage_discrete_flow_shift', desc: 'discrete flow shift，默认 2.0。', defaultValue: 2.0, min: 0.1, step: 0.1 }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练图片与分辨率。首版支持 live 编码；cache 后缀规划 *_zimage.npz。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '推荐 1024,1024；显存紧张可试 512,512', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1536, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '首版 live 编码可用；缓存契约后续补齐 *_zimage.npz。', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 网络', 'Z-Image LoRA 默认 rank/alpha 16。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('zimage-offload-settings', 'speed', 'Z-Image Block Offload', 'resident / block_offload 与预取槽位。默认 slots=4、prefetch=2、pin=true。', [...ZIMAGE_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级参数', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调参。', [...S_TURBOCORE], { expert: true })
];

const WAN22_A14B_OFFLOAD_FIELDS = WAN22_OFFLOAD_FIELDS.map((field) => {
  if (field.key === 'wan22_block_offload_gpu_slots') {
    return { ...field, defaultValue: 2, desc: 'A14B 每次只加载 high/low 中所选单塔；显存安全基线同时驻留 2 个 block。' };
  }
  if (field.key === 'wan22_block_offload_prefetch_depth') {
    return { ...field, defaultValue: 1, desc: 'A14B 显存安全基线只异步预取后续 1 个 block。' };
  }
  return field;
});

export const WAN22_TI2V_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Wan2.2 TI2V-5B 官方目录（config.json + diffusion shards + Wan2.2_VAE.pth + umT5）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'wan22-ti2v-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Wan2.2 模型目录', title: 'pretrained_model_name_or_path', desc: 'TI2V-5B 目录', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/wan22' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'wan22-ti2v-lora' },
    { key: 'wan22_model_variant', type: 'select', label: '变体', title: 'wan22_model_variant', desc: 'TI2V-5B；A14B 训练时每次只加载 high/low 中所选单塔', defaultValue: 'ti2v-5b', options: [
      { value: 'ti2v-5b', label: 'TI2V-5B' },
      { value: 't2v-a14b', label: 'T2V-A14B' }
    ] },
    { key: 'wan22_noise_stage', type: 'select', label: 'A14B 噪声塔', title: 'wan22_noise_stage', desc: '仅 t2v-a14b：high/low 单塔', defaultValue: 'high', options: [
      { value: 'high', label: 'high_noise' },
      { value: 'low', label: 'low_noise' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_expert_timestep_preset', type: 'select', label: '按塔限定时间步', title: 'wan22_expert_timestep_preset', desc: '默认关。开启后按后端的噪声塔 σ 边界填时间步先验（high→[875,1000)，low→[0,875)）。只写你没填的字段：手填过范围或分段权重时本预设不生效。', defaultValue: 'off', options: [
      { value: 'off', label: '关闭（默认）' },
      { value: 'auto', label: 'auto（跟随所选塔）' },
      { value: 'high', label: '强制 high 区间' },
      { value: 'low', label: '强制 low 区间' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_max_text_length', type: 'number', label: '最大文本长度', title: 'wan22_max_text_length', desc: 'umT5 序列长度，默认 512。', defaultValue: 512, min: 64, max: 1024 },
    { key: 'wan22_timestep_sampling', type: 'select', label: '时间步采样', title: 'wan22_timestep_sampling', desc: 'flow matching 采样，默认 shift。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigmoid', label: 'sigmoid' }
    ] },
    { key: 'wan22_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'wan22_discrete_flow_shift', desc: 'TI2V/I2V 倾向 5.0；T2V 常见 12.0。', defaultValue: 5.0, min: 0.1, step: 0.1 }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '首版支持图像当 1 帧（F=1）或短 clip 潜空间；推荐合成/缓存 text embeds。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录（1-frame MVP）', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '建议 704,704 或更小试跑', defaultValue: '704,704' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 2, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用 Wan2.2 cache-first', title: 'use_cache', desc: '默认读取兼容的 *_wan22.npz latent/文本条件缓存，避免训练时常驻 VAE/文本编码器。', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 设置', 'Wan2.2 LoRA 默认 rank/alpha 16；目标 attn1/attn2 + FFN。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('wan22-offload-settings', 'speed', 'Wan2.2 Block Offload', 'resident / block_offload；5B 建议 slots=4。', [...WAN22_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

export const WAN22_T2V_A14B_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Wan2.2 T2V-A14B 目录包含 high/low noise 权重；单次训练只加载所选单塔，不会同时加载两套 DiT。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'wan22-t2v-a14b-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Wan2.2 A14B 模型目录', title: 'pretrained_model_name_or_path', desc: 'T2V-A14B 根目录', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/wan22-a14b' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'wan22-t2v-a14b-lora' },
    { key: 'wan22_model_variant', type: 'select', label: '变体', title: 'wan22_model_variant', desc: 'A14B 目录含 high/low 两套权重；训练时只挂载所选单塔', defaultValue: 't2v-a14b', options: [
      { value: 'ti2v-5b', label: 'TI2V-5B' },
      { value: 't2v-a14b', label: 'T2V-A14B' }
    ] },
    { key: 'wan22_noise_stage', type: 'select', label: 'A14B 噪声塔', title: 'wan22_noise_stage', desc: '仅 t2v-a14b：high/low 单塔', defaultValue: 'high', options: [
      { value: 'high', label: 'high_noise' },
      { value: 'low', label: 'low_noise' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_expert_timestep_preset', type: 'select', label: '按塔限定时间步', title: 'wan22_expert_timestep_preset', desc: '默认关。开启后按后端的噪声塔 σ 边界填时间步先验（high→[875,1000)，low→[0,875)）。只写你没填的字段：手填过范围或分段权重时本预设不生效。', defaultValue: 'off', options: [
      { value: 'off', label: '关闭（默认）' },
      { value: 'auto', label: 'auto（跟随所选塔）' },
      { value: 'high', label: '强制 high 区间' },
      { value: 'low', label: '强制 low 区间' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_max_text_length', type: 'number', label: '最大文本长度', title: 'wan22_max_text_length', desc: 'umT5 序列长度，默认 512。', defaultValue: 512, min: 64, max: 1024 },
    { key: 'wan22_timestep_sampling', type: 'select', label: '时间步采样', title: 'wan22_timestep_sampling', desc: 'flow matching 采样，默认 shift。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigmoid', label: 'sigmoid' }
    ] },
    { key: 'wan22_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'wan22_discrete_flow_shift', desc: 'TI2V/I2V 倾向 5.0；T2V 常见 12.0。', defaultValue: 12.0, min: 0.1, step: 0.1 }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '首版支持图像当 1 帧（F=1）或短 clip 潜空间；推荐合成/缓存 text embeds。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录（1-frame MVP）', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '建议 704,704 或更小试跑', defaultValue: '704,704' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 2, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用 Wan2.2 cache-first', title: 'use_cache', desc: '默认读取兼容的 *_wan22.npz latent/文本条件缓存，避免训练时常驻 VAE/文本编码器。', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 设置', 'Wan2.2 LoRA 默认 rank/alpha 16；目标 attn1/attn2 + FFN。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('wan22-offload-settings', 'speed', 'Wan2.2 Block Offload', 'A14B 单塔显存安全基线：slots=2 / prefetch=1；16GB/24GB 可训练性仍待真实训练证据确认。', [...WAN22_A14B_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

export const BOOGU_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Boogu-Image Base 完整本地目录（transformer + mllm + vae + processor + scheduler）。支持 BF16 与官方 Base-fp8（自动识别；FP8 为 torchao 包，加载时 dequant 到训练 dtype，常驻 VRAM≈BF16）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'boogu-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Boogu 模型目录', title: 'pretrained_model_name_or_path', desc: '完整本地目录：transformer/、mllm/、processor/', defaultValue: '' },
    {
      key: 'boogu_model_version',
      type: 'select',
      label: '模型版本',
      desc: '当前产品默认 Base 0.',
      defaultValue: 'base-0.1',
      options: [
        { value: 'base-0.1', label: 'base-0.1（推荐）' }
      ]
    },
    {
      key: 'boogu_task',
      type: 'select',
      label: '任务',
      desc: 'Base 阶段仅 t2i',
      defaultValue: 't2i',
      options: [
        { value: 't2i', label: 't2i（文生图）' }
      ]
    },
    { key: 'boogu_load_mllm', type: 'boolean', label: '加载 MLLM', title: 'boogu_load_mllm', desc: '默认关闭以复用文本缓存；仅在构建缓存或实时文本编码时开启，会显著增加内存/显存占用。', defaultValue: false },
    { key: 'boogu_max_text_length', type: 'number', label: '最大文本长度', title: 'boogu_max_text_length', desc: '指令 TE pad 上限（token）。', defaultValue: 1024, min: 64, max: 4096 },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/boogu' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'boogu-lora' }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '自然语言 instruction caption。cache 后缀 *_boogu.npz。推荐 buckets 覆盖 512/768/1024。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片目录', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '推荐 1024,1024；bucket 会覆盖 512/768/1024 档。', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 512, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '推荐开启：读 latent/指令 TE 缓存', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '默认按轮保存（每轮一次）。RunComfy 参考基线是每 250 步保留约 4 份，需要的话把「每 N 步保存」改成 250。', [
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'RunComfy 默认 rank/α 32/32。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', 'RunComfy 默认 LR 1e-4 + AdamW8Bit。', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '默认按最大步数 2500（RunComfy full）；探针可用 100–250。', [
    { key: 'train_length_mode', type: 'select', label: '训练长度模式', title: 'train_length_mode', desc: 'Boogu 产品默认按步数', defaultValue: '最大步数', options: ['最大轮数', '最大步数'] },
    { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', defaultValue: 10, min: 1, visibleWhen: (c) => !c.train_length_mode || c.train_length_mode === '最大轮数' },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: 'RunComfy full=2500；100–250。', defaultValue: 2500, min: 1, visibleWhen: when('train_length_mode', '最大步数') },
    ...S_TRAIN(10).filter((f) => !['train_length_mode', 'max_train_epochs', 'max_train_steps'].includes(f.key))
]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('boogu-offload-settings', 'speed', 'Boogu Block Offload', '默认 resident（OFF）。OOM 再开 block_offload。', [...BOOGU_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

export const BOOGU_EDIT_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Boogu-Image Edit LoRA：与 Base 同 DiT 族；需 Edit 权重目录。双路：VLM 图文指令 + VAE ref_latents。支持 BF16 Edit 与官方 Edit-fp8（自动识别；加载 dequant）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'boogu-edit-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Boogu Edit 模型目录', title: 'pretrained_model_name_or_path', desc: 'Edit 权重根目录（layout 同 Base：transformer/', defaultValue: '' },
    {
      key: 'boogu_model_version',
      type: 'select',
      label: '模型版本',
      desc: 'Edit profile；权重未到齐时可先选占位。',
      defaultValue: 'edit-0.1',
      options: [
        { value: 'edit-0.1', label: 'edit-0.1' },
        { value: 'base-0.1', label: 'base-0.1（仅通路探测，非产品）' }
],
    },
    {
      key: 'boogu_task',
      type: 'select',
      label: '任务',
      desc: 'Edit 固定 edit：TI2I system prompt',
      defaultValue: 'edit',
      options: [
        { value: 'edit', label: 'edit（图文编辑）' }
],
    },
    { key: 'boogu_load_mllm', type: 'boolean', label: '加载 MLLM', title: 'boogu_load_mllm', desc: '默认关闭以复用文本缓存；仅在构建缓存或实时文本编码时开启，会显著增加内存/显存占用。', defaultValue: false },
    { key: 'boogu_max_text_length', type: 'number', label: '最大文本长度', title: 'boogu_max_text_length', desc: '指令 TE pad 上限', defaultValue: 1024, min: 64, max: 4096 },
    { key: 'boogu_control_image_max_pixels', type: 'number', label: '控制图最大像素', title: 'boogu_control_image_max_pixels', desc: 'VAE ref 编码前 cap，默认约 1MP', defaultValue: 1048576, min: 65536 },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/boogu-edit' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'boogu-edit-lora' }
]),
  sec('dataset-settings', 'dataset', '数据集设置', 'Edit：目标图 + caption；ref 图进 cache 的 ref_latents（与 Base *_boogu.npz 命名空间隔离推荐分目录）。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '目标图目录；建议与 Base cache 分目录', defaultValue: './output/lulynx-edit' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '推荐 1024,1024', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: 'DiT cache-first 路径：分桶多为 partial。已缓存 latent/TE 回放通常不改分辨率；主要影响 online/rebuild。勿当 UNet 全 arb。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', defaultValue: 512, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: 'Edit cache 含 ref_latents', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '默认按轮保存（每轮一次）。RunComfy 基线是每 250 步保留约 4 份，需要的话把「每 N 步保存」改成 250。', [
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', '默认 rank/α 32/32。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '默认 LR 1e-4 + AdamW8Bit。', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '默认按最大步数 2500。', [
    { key: 'train_length_mode', type: 'select', label: '训练长度模式', title: 'train_length_mode', desc: 'Boogu 产品默认按步数', defaultValue: '最大步数', options: ['最大轮数', '最大步数'] },
    { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', defaultValue: 10, min: 1, visibleWhen: (c) => !c.train_length_mode || c.train_length_mode === '最大轮数' },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: 'full=2500；100–250。', defaultValue: 2500, min: 1, visibleWhen: when('train_length_mode', '最大步数') },
    ...S_TRAIN(10).filter((f) => !['train_length_mode', 'max_train_epochs', 'max_train_steps'].includes(f.key))
]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('boogu-offload-settings', 'speed', 'Boogu Block Offload', '默认 resident（OFF）；OOM 再开 block_offload。', [...BOOGU_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监控', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

const BOOGU_DEPTH_EXPANSION_FIELDS = [
  { key: 'boogu_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'boogu_depth_expansion_enabled', desc: '交错复制 Boogu 单流 block，并以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'boogu_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'boogu_depth_expansion_target_layers', desc: '扩层后的单流 Transformer block 总数（Base 原生 32）。', defaultValue: 40, min: 2, step: 1, visibleWhen: when('boogu_depth_expansion_enabled', true) },
  { key: 'boogu_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'boogu_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('boogu_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// boogu-finetune 派生自 BOOGU_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重，
// 避免撞 webui_duplicate_field_key_smoke 的重复总量基线。
export const BOOGU_FT_SECTIONS = dropDuplicateFieldKeys(BOOGU_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'boogu-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Boogu 底座输出文件名', defaultValue: 'boogu-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Boogu 全参微调', description: '训练完整 Boogu-Image DiT，或扩展深度后只训练新增单流层。需要 BF16/FP16 稠密底座（官方 FP8 包加载时自动 dequant）。', fields: [...fields, ...BOOGU_DEPTH_EXPANSION_FIELDS] };
  }));

const FLUX2_DEPTH_EXPANSION_FIELDS = [
  { key: 'flux2_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'flux2_depth_expansion_enabled', desc: '交错复制 FLUX.2 单流 block（并行块，注意力/MLP 融合输出投影归零），以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'flux2_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'flux2_depth_expansion_target_layers', desc: '扩层后的单流 Transformer block 总数（Klein-9B 原生 48；双流 8 层不参与扩层）。', defaultValue: 60, min: 2, step: 1, visibleWhen: when('flux2_depth_expansion_enabled', true) },
  { key: 'flux2_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'flux2_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('flux2_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// flux2-finetune 派生自 FLUX2_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const FLUX2_FT_SECTIONS = dropDuplicateFieldKeys(FLUX2_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'flux2-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 FLUX.2 底座输出文件名', defaultValue: 'flux2-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'FLUX.2 全参微调', description: '训练完整 FLUX.2 Klein DiT，或扩展深度后只训练新增单流层。需要未旋转的稠密底座（ConvRot INT8 包仅支持冻结底座 LoRA）。', fields: [...fields, ...FLUX2_DEPTH_EXPANSION_FIELDS] };
  }));

const ZIMAGE_DEPTH_EXPANSION_FIELDS = [
  { key: 'zimage_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'zimage_depth_expansion_enabled', desc: '交错复制 Z-Image 主干 layers block（attention 输出投影与 FFN w2 归零），以恒等残差初始化新增层。refiner 层不参与扩层。最终保存完整新底座。', defaultValue: false },
  { key: 'zimage_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'zimage_depth_expansion_target_layers', desc: '扩层后的主干 Transformer block 总数（Z-Image 6B 原生 30）。', defaultValue: 38, min: 2, step: 1, visibleWhen: when('zimage_depth_expansion_enabled', true) },
  { key: 'zimage_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'zimage_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('zimage_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// zimage-finetune 派生自 ZIMAGE_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const ZIMAGE_FT_SECTIONS = dropDuplicateFieldKeys(ZIMAGE_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'zimage-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Z-Image 底座输出文件名', defaultValue: 'zimage-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Z-Image 全参微调', description: '训练完整 Z-Image DiT，或扩展深度后只训练新增主干层。', fields: [...fields, ...ZIMAGE_DEPTH_EXPANSION_FIELDS] };
  }));

const WAN22_DEPTH_EXPANSION_FIELDS = [
  { key: 'wan22_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'wan22_depth_expansion_enabled', desc: '交错复制 Wan2.2 TI2V-5B block（自注意/交叉注意/FFN 三个输出投影归零），以恒等残差初始化新增层。仅支持 TI2V-5B 单塔；A14B 双塔不支持。最终保存完整新底座。', defaultValue: false },
  { key: 'wan22_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'wan22_depth_expansion_target_layers', desc: '扩层后的 Transformer block 总数（TI2V-5B 原生 30）。', defaultValue: 38, min: 2, step: 1, visibleWhen: when('wan22_depth_expansion_enabled', true) },
  { key: 'wan22_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'wan22_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('wan22_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// wan22-finetune 派生自 WAN22_TI2V_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const WAN22_FT_SECTIONS = dropDuplicateFieldKeys(WAN22_TI2V_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'wan22-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Wan2.2 底座输出文件名', defaultValue: 'wan22-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Wan2.2 全参微调', description: '训练完整 Wan2.2 TI2V-5B DiT，或扩展深度后只训练新增层。扩层仅支持 TI2V-5B 单塔。', fields: [...fields, ...WAN22_DEPTH_EXPANSION_FIELDS] };
  }));
