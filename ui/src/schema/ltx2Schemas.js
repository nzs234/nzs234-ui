// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// LTX-2.3/2.5 share one canonical ltx23_* request/runtime contract.
import { when, sec } from './schemaCommon.js';
import {
  S_DIT_PERFORMANCE_EXPERT,
  S_EXECUTION_BACKEND,
  LTX23_OFFLOAD_FIELDS,
  S_SAVE,
  S_LR_DIT,
  S_LR_FT_DIT,
  S_TRAIN,
  S_SPEED_FLOW,
  S_ADV_DIT,
  S_THERMAL,
  S_PEAK_VRAM,
  S_COMPILE_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_QUALITY_OPTIMIZATION_PACK,
  S_DIAGNOSTICS_MONITORING,
  S_TURBOCORE,
  S_WEIGHT_COMPOSER,
  S_PROGRESSIVE_TRAINING,
  S_ADAPTIVE_TRAINING,
} from './schemaFrontierGroups.js';

const LTX2_SHARED_SPEED_KEYS = new Set([
  'acceleration_profile',
  'mixed_precision',
  'sdpa',
]);
const LTX2_LORA_COMPRESSION_KEYS = new Set([
  'weight_compression_preset',
  'weight_compression_enabled',
  'weight_compression_target',
  'weight_compression_format',
  'weight_compression_verify',
]);
const LTX2_LORA_QKV_FIELDS = [
  { key: 'triton_ops_enabled', type: 'boolean', label: '启用 LTX Triton Ops', title: 'triton_ops_enabled', desc: '默认关闭。仅在 QKV 子开关同时开启时尝试 LTX Triton 注入。', defaultValue: false },
  { key: 'triton_ops_inject_qkv', type: 'boolean', label: 'Triton QKV 融合', title: 'triton_ops_inject_qkv', desc: '仅标准视频 attn1；Perturbed、cross 与 audio 路径跳过。与物理打包同开时 Triton 命中优先，未命中由物理路径回退。', defaultValue: false, visibleWhen: when('triton_ops_enabled', true) },
  { key: 'model_fused_qkv', type: 'boolean', label: '物理 QKV/KV 打包', title: 'model_fused_qkv', desc: '模型级物理 QKV/KV 打包；与 Triton QKV 同开时作为未命中路径的回退。默认关闭。', defaultValue: false },
];
const LTX2_SHARED_SPEED_FIELDS = S_SPEED_FLOW.filter((field) => (
  LTX2_SHARED_SPEED_KEYS.has(field.key)
));
const LTX2_LORA_SPEED_FIELDS = S_SPEED_FLOW.filter((field) => (
  LTX2_SHARED_SPEED_KEYS.has(field.key) || LTX2_LORA_COMPRESSION_KEYS.has(field.key)
)).concat([
  { key: 'weight_compression_include_patterns', type: 'string', label: '压缩包含模式', title: 'weight_compression_include_patterns', desc: '可选，逗号分隔；仅压缩匹配的组件或参数。', defaultValue: '', visibleWhen: when('weight_compression_enabled', true) },
  { key: 'weight_compression_exclude_patterns', type: 'string', label: '压缩排除模式', title: 'weight_compression_exclude_patterns', desc: '可选，逗号分隔；匹配的组件或参数不会被压缩。', defaultValue: '', visibleWhen: when('weight_compression_enabled', true) },
  ...LTX2_LORA_QKV_FIELDS,
]);
const LTX2_CHECKPOINT_FIELDS = [
  ...S_DIT_PERFORMANCE_EXPERT.filter((field) => (
    field.key === 'performance_expert_mode' || field.key === 'checkpoint_policy'
  )),
  { key: 'activation_cpu_offload_enabled', type: 'boolean', label: '激活 CPU Offload', title: 'activation_cpu_offload_enabled', desc: '将大激活保存到 pinned CPU 内存，降低反向峰值显存。', defaultValue: false },
  { key: 'activation_cpu_offload_min_tensor_mb', type: 'number', label: 'Offload 最小体积 MB', title: 'activation_cpu_offload_min_tensor_mb', desc: '只卸载达到该体积的激活。', defaultValue: 1.0, min: 0, step: 0.5, visibleWhen: when('activation_cpu_offload_enabled', true) },
  { key: 'activation_cpu_offload_pool_gb', type: 'number', label: 'Offload Pinned 池 GB', title: 'activation_cpu_offload_pool_gb', desc: '激活 Offload 使用的 pinned CPU 内存池。', defaultValue: 1.0, min: 0.1, step: 0.1, visibleWhen: when('activation_cpu_offload_enabled', true) },
];
const LTX2_VIDEO_FIELDS = [
  { key: 'ltx23_target_frames', type: 'number', label: '目标帧数', title: 'ltx23_target_frames', desc: '训练 clip 目标帧数；单图训练保持 1。', defaultValue: 1, min: 1, step: 1 },
  { key: 'ltx23_frame_stride', type: 'number', label: '帧采样步长', title: 'ltx23_frame_stride', desc: '相邻采样帧之间的源视频帧间隔。', defaultValue: 1, min: 1, step: 1 },
];
const LTX2_DEPTH_EXPANSION_FIELDS = [
  { key: 'ltx23_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'ltx23_depth_expansion_enabled', desc: '交错复制 LTX-2.x 双流 block，并以恒等残差初始化新增层（视频+音频输出投影归零，存在的 bias 一并归零）。最终保存完整新底座。', defaultValue: false },
  { key: 'ltx23_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'ltx23_depth_expansion_target_layers', desc: '扩层后的 Transformer block 总数（22B-dev 原生 48）。', defaultValue: 64, min: 2, step: 1, visibleWhen: when('ltx23_depth_expansion_enabled', true) },
  { key: 'ltx23_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'ltx23_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('ltx23_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];
const LTX2_FULL_FINETUNE_EXCLUDED_FIELDS = new Set([
  'lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled',
  'weight_compression_preset', 'weight_compression_verify', 'train_quant_preset',
  'weight_compression_enabled', 'weight_compression_target', 'weight_compression_format',
  'quant_train_mode', 'keep_w8_vram_prefer', 'quant_train_convrot', 'vram_swap_to_ram',
  'lulynx_weight_noise_enabled', 'lulynx_weight_noise_mode', 'lulynx_weight_noise_sigma',
  'lulynx_weight_noise_bound_norm', 'lulynx_weight_noise_log_every', 'merge_export',
  'network_train_unet_only', 'network_train_text_encoder_only',
]);
const S_LAYERED_ALPHA_GENERIC = [
  { key: 'network_alpha_map_json', type: 'textarea', label: '分层 Alpha 映射', title: 'network_alpha_map_json', desc: '按目标模块分别设置 LoRA alpha', defaultValue: '', placeholder: '例:\nattention.qkv=16\nattention.out=8\nfeed_forward.w2=32' },
];

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

export const LTX23_LORA_SECTIONS = dropDuplicateFieldKeys([
  sec('model-settings', 'model', '训练用模型', 'LTX-2.3 视觉-only LoRA；支持单文件或目录，并自动读取 checkpoint metadata。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'ltx23-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'LTX-2.3 模型路径', title: 'pretrained_model_name_or_path', desc: 'LTX-2.3 单文件或模型目录。', defaultValue: '' },
    { key: 'ltx23_text_encoder_path', type: 'file', pickerType: 'model-file', label: 'LTX-2.3 Gemma3 文本编码器', title: 'ltx23_text_encoder_path', desc: '匹配底座的 Gemma3 文本编码器；标准目录可自动解析，自定义布局时覆盖。', defaultValue: '' },
    { key: 'ltx23_video_vae_path', type: 'file', pickerType: 'model-file', label: 'LTX-2.3 视频 VAE', title: 'ltx23_video_vae_path', desc: '匹配底座的视频 VAE；标准目录可自动解析，自定义布局时覆盖。', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/ltx23' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'ltx23-lora' },
    { key: 'ltx23_max_text_length', type: 'number', label: '最大文本长度', title: 'ltx23_max_text_length', desc: '构建 Gemma 文本缓存时的 token 上限；2.3/2.5 共用。', defaultValue: 256, min: 16, max: 1024, step: 1 },
    { key: 'ltx23_timestep_sampling', type: 'select', label: '时间步采样', title: 'ltx23_timestep_sampling', desc: 'flow matching 采样，默认 shift。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigma', label: 'sigma' },
    ] },
    { key: 'ltx23_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'ltx23_discrete_flow_shift', desc: '默认 1.0', defaultValue: 1.0, min: 0.1, step: 0.1 },
    { key: 'ltx23_isolate_modalities', type: 'boolean', label: '隔离模态', title: 'ltx23_isolate_modalities', desc: 'true=视觉-only，关闭 a2v/v2a 交叉。', defaultValue: true },
    { key: 'ltx23_fps', type: 'number', label: 'FPS', title: 'ltx23_fps', desc: 'RoPE 用帧率', defaultValue: 24.0, min: 1, max: 60, step: 1 },
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '图像按单帧或短 clip 进入 cache-first LTX 数据链。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练图片或短视频目录。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '22B 建议先用较小分辨率验证。', defaultValue: '512,512' },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', defaultValue: 2, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '生成并复用版本匹配的 LTX latent/文本条件缓存；2.3 与 2.5 缓存不可混用。', defaultValue: true },
    ...LTX2_VIDEO_FIELDS,
  ]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从已有 save_state 目录恢复训练。', defaultValue: '' },
    ...S_SAVE.filter((field) => !['output_dir', 'output_name'].includes(field.key)),
  ]),
  sec('adapter-settings', 'network', 'LoRA 设置', '22B 建议小 rank；仅视觉 attention 与 FFN。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: 'LoRA alpha', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC,
  ]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间、时间步、噪声与样本难度权重按乘法组合。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('speed-settings', 'speed', '速度优化', '', [...LTX2_LORA_SPEED_FIELDS]),
  sec('compile-settings', 'speed', '编译与执行后端', 'LTX 原生 runtime 的 eager / torch.compile 参数。', [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('ltx23-offload-settings', 'speed', 'LTX-2.x Block Offload', '22B 默认 block_offload，slots=2。', [...LTX23_OFFLOAD_FIELDS]),
  sec('ltx23-activation-offload', 'speed', 'Checkpoint / 激活 Offload', '复用原生 trainer checkpoint policy 与 activation CPU offload。', [...LTX2_CHECKPOINT_FIELDS], { expert: true }),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true }),
]);

const retargetLtx25Sections = (sections, { typeId, outputName, finetune = false }) => (
  dropDuplicateFieldKeys(sections.map((section) => ({
    ...section,
    ...(section.id === 'model-settings' ? {
      title: finetune ? 'LTX-2.5 全参微调' : section.title,
      description: finetune
        ? '训练完整 LTX-2.5 DiT，或扩展深度后只训练新增层。'
        : 'LTX-2.5 视觉-only LoRA；选择官方 split pack 根目录。',
    } : {}),
    fields: section.fields.map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: typeId };
      if (field.key === 'pretrained_model_name_or_path') return { ...field, label: 'LTX-2.5 模型目录', desc: '选择包含 diffusion_models、text_encoders、vae 的官方 split pack 根目录。' };
      if (field.key === 'ltx23_text_encoder_path') return { ...field, label: 'LTX-2.5 Gemma4 文本编码器', desc: '可选覆盖；标准 split pack 会自动解析。' };
      if (field.key === 'ltx23_video_vae_path') return { ...field, label: 'LTX-2.5 视频 VAE', desc: '可选覆盖；推荐 video-vae-conv-bf16。' };
      if (field.key === 'output_dir') return { ...field, defaultValue: './output/ltx25' };
      if (field.key === 'output_name') return { ...field, label: finetune ? '底座输出名称' : field.label, desc: finetune ? '完整 LTX-2.5 底座输出文件名' : field.desc, defaultValue: outputName };
      return field;
    }),
  })))
);

export const LTX25_LORA_SECTIONS = retargetLtx25Sections(LTX23_LORA_SECTIONS, {
  typeId: 'ltx25-lora',
  outputName: 'ltx25-lora',
});

const isLtxFullFinetuneExcludedField = (key) => (
  LTX2_FULL_FINETUNE_EXCLUDED_FIELDS.has(key)
  || key === 'train_quant_preset'
  || ['weight_compression_', 'quant_train_', 'keep_w8_', 'fp8_base', 'tuneqdm_']
    .some((prefix) => key.startsWith(prefix))
);

export const LTX23_FT_SECTIONS = dropDuplicateFieldKeys(LTX23_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings'
      ? S_LR_FT_DIT
      : section.id === 'speed-settings'
        ? LTX2_SHARED_SPEED_FIELDS
        : section.fields;
    const fields = sourceFields
      .filter((field) => !isLtxFullFinetuneExcludedField(field.key))
      .map((field) => {
        if (field.key === 'model_train_type') return { ...field, defaultValue: 'ltx23-finetune' };
        if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 LTX-2.3 底座输出文件名', defaultValue: 'ltx23-expanded' };
        return field;
      });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'LTX-2.3 全参微调', description: '训练完整 LTX-2.3 DiT，或扩展深度后只训练新增层。', fields: [...fields, ...LTX2_DEPTH_EXPANSION_FIELDS] };
  }));

export const LTX25_FT_SECTIONS = retargetLtx25Sections(LTX23_FT_SECTIONS, {
  typeId: 'ltx25-finetune',
  outputName: 'ltx25-expanded',
  finetune: true,
});
