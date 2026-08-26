// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// conceptEditUnifiedSchema.js — 统一概念编辑训练 Schema
//
// 将 iLECO / ADDifT / Multi-ADDifT 收拢为单一侧边栏入口：
//   1. 顶部选择底模类型 (concept_edit_base_model)
//   2. 顶部选择训练方法 (concept_edit_method: ileco/addift)
//   3. 模型路径字段按底模类型动态显示
//   4. 数据集字段按方法类型动态显示
//
// 注意：这是 WebUI 侧预留 schema。后端 schema / route 接好前，入口保持隐藏。
// ================================================================
import { when, all, sec, ditGradientCheckpointingField, doraEnabled } from './schemaCommon.js';
import { animaFlowCoreFields } from './animaSchema.js';
import {
  S_QUALITY_OPTIMIZATION_PACK,
  S_DIAGNOSTICS_MONITORING,
} from './schemaFrontierGroups.js';

import {
  S_SAVE, S_LR, S_PREVIEW, S_QUALITY_EVAL, S_NOISE, S_ADV, S_THERMAL, S_DISTRIBUTED, S_SPEED_FLOW,
} from './schemaFieldGroups.js';
import {
  NATIVE_ADAPTER_TYPES, ADAPTER_INIT_STRATEGY_OPTIONS, ADAPTER_INIT_EXPORT_MODE_OPTIONS,
  LOFTQ_QUANT_TYPE_OPTIONS, LYCORIS_DELTA_ALGOS, nativeLoraInitSelected, loftqInitSelected,
} from './schemaCommon.js';

// 判断函数
const isAnima = (c) => String(c.concept_edit_base_model || '').toLowerCase() === 'anima';
const isSd15 = (c) => String(c.concept_edit_base_model || '').toLowerCase() === 'sd15';
const isAdDifT = (c) => String(c.concept_edit_method || '').toLowerCase() === 'addift';

// ---- 模型路径字段（按底模类型显示）----
const MODEL_FIELDS = [
  { key: 'model_train_type', type: 'hidden', defaultValue: 'concept-edit' },

  // 底模 + 方法选择（始终显示）
  {
    key: 'concept_edit_base_model',
    type: 'select',
    label: '底模架构',
    title: 'concept_edit_base_model',
    desc: '选择要训练的底模架构。不同架构加载不同模型路径字段。',
    defaultValue: 'anima',
    options: [
      { value: 'anima', label: 'Anima (DiT)' },
      { value: 'sdxl', label: 'SDXL' },
      { value: 'sd15', label: 'SD 1.5' },
      { value: 'newbie', label: 'Newbie' },
      { value: 'flux', label: 'FLUX' }
],
  },
  {
    key: 'concept_edit_method',
    type: 'select',
    label: '训练方法',
    title: 'concept_edit_method',
    desc: 'iLECO：提示词差分对比；ADDifT：图像对正负对比。',
    defaultValue: 'ileco',
    options: [
      { value: 'ileco', label: 'iLECO (提示词差分)' },
      { value: 'addift', label: 'ADDifT (图像对对比)' }
],
  },

  // Anima 专属字段
  {
    key: 'anima_auto_scan_folder',
    type: 'action',
    label: '🔍 智能识别 Anima 文件夹',
    desc: '选择 Anima 模型根目录，自动识别并填充 DiT / VAE /',
    buttonLabel: '选择文件夹并识别',
    handler: 'openAnimaFolderScanner',
    visibleWhen: isAnima,
  },
  {
    key: 'pretrained_model_name_or_path',
    type: 'file',
    pickerType: 'model-file',
    label: '底模路径',
    title: 'pretrained_model_name_or_path',
    desc: '底模文件路径',
    defaultValue: '',
  },
  {
    key: 'vae',
    type: 'file',
    pickerType: 'model-file',
    label: 'VAE 路径',
    title: 'vae',
    desc: 'VAE 模型路径。Anima 概念编辑必须提供',
    defaultValue: '',
  },
  {
    key: 'qwen3',
    type: 'file',
    pickerType: 'model-file',
    label: 'Qwen3 文本模型路径',
    title: 'qwen3',
    desc: 'Qwen3 文本模型路径（Anima 必填）',
    defaultValue: '',
    visibleWhen: isAnima,
  },
  {
    key: 'llm_adapter_path',
    type: 'file',
    pickerType: 'model-file',
    label: 'LLM Adapter 路径',
    title: 'llm_adapter_path',
    desc: '单独的 LLM Adapter 权重路径（Anima 可选）',
    defaultValue: '',
    visibleWhen: isAnima,
  },
  {
    key: 't5_tokenizer_path',
    type: 'folder',
    pickerType: 'folder',
    label: 'T5 tokenizer 目录',
    title: 't5_tokenizer_path',
    desc: '可选。留空时回退到项目内置 tokenizer',
    defaultValue: '',
    visibleWhen: isAnima,
  },
  {
    key: 'v2',
    type: 'boolean',
    label: 'SD 2.x 模型',
    title: 'v2',
    desc: '使用 SD 2.x 模型（SD1.5 路线）',
    defaultValue: false,
    visibleWhen: isSd15,
  },
  {
    key: 'network_weights',
    type: 'file',
    pickerType: 'output-model-file',
    label: '继续训练 LoRA',
    title: 'network_weights',
    desc: '从已有的概念编辑 LoRA 继续训练',
    defaultValue: '',
  },
  {
    key: 'resume',
    type: 'folder',
    pickerType: 'output-folder',
    label: '继续训练路径',
    title: 'resume',
    desc: '从某个 save_state 保存的中断状态继续训练',
    defaultValue: '',
  },
  {
    key: 'lora_meta_reader',
    type: 'action',
    label: '📖 LoRA 权重元数据读取',
    desc: '读取现有 LoRA 文件的训练参数元数据，用于参考或复现训练配置。',
    buttonLabel: '选择 LoRA 文件并读取',
    handler: 'openLoraMetaReader',
  }
];

// ---- Anima 专用参数 ----
// 概念编辑差分损失不经主链加权/预测目标解析（concept_edit_loss 自管），
// 只挂 flow 采样本体；旧 flowParams 的 model_prediction_type 默认 'raw' 会在
// anima_flow.build_anima_flow_inputs 直接 ValueError（值域 velocity/noise/epsilon/sample）。
const ANIMA_PARAMS_FIELDS = [
  ...animaFlowCoreFields(),
  { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 最大 token 长度', defaultValue: 512, min: 1 },
  { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 最大 token 长度', defaultValue: 512, min: 1 },
  { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '拆分 attention 以节省显存', defaultValue: false },
  { key: 'vae_chunk_size', type: 'number', label: 'VAE 分块大小', title: 'vae_chunk_size', desc: 'VAE 编码/解码分块大小（需为偶数）', defaultValue: '', min: 2 }
];

// ---- 数据集字段（iLECO 用提示词，ADDifT 用图像对，Multi-ADDifT 用目录）----
const DATASET_FIELDS = [
    { key: 'target_prompt', type: 'textarea', label: '目标概念提示词', title: 'target_prompt', desc: '目标概念提示词。iLECO 留空时偏向"擦除原概念"。', defaultValue: '' },
  // ADDifT 图像对
  { key: 'original_image_path', type: 'file', pickerType: 'image-file', label: '原始图像', title: 'original_image_path', desc: 'ADDifT 的原始图像。建议与目标图像内容一一对应。', defaultValue: '', visibleWhen: isAdDifT },
  { key: 'target_image_path', type: 'file', pickerType: 'image-file', label: '目标图像', title: 'target_image_path', desc: 'ADDifT 的目标图像。建议与原始图像分辨率一致。', defaultValue: '', visibleWhen: isAdDifT },
  // 数据集目录（Anima ADDifT 多配对）
  {
    key: 'concept_edit_data_dir',
    type: 'folder',
    pickerType: 'folder',
    label: '概念编辑数据集目录',
    title: 'concept_edit_data_dir',
    desc: '放置成对图像的目录（target_*/original_*',
    defaultValue: './train/concept-edit',
    visibleWhen: (c) => isAdDifT(c) && isAnima(c),
  }
];

// ---- 网络设置 ----
const NETWORK_FIELDS = [
  { key: 'lora_type', type: 'select', label: '适配器类型', title: 'lora_type', desc: '概念编辑建议从普通 LoRA 开始。', defaultValue: 'lora', options: NATIVE_ADAPTER_TYPES },
  { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: '网络维度，概念编辑通常 4~64 即可。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '常用值：等于 network_dim 或更小。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已有 network_weights 自动推断 rank / dim', defaultValue: false },
  { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '最大范数正则化。如果使用，推荐从 1 附近开始', defaultValue: '', min: 0, step: 0.01 },
  { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '额外训练归一化层。概念编辑一般先关闭。', defaultValue: false },
  { key: 'dora_wd', type: 'boolean', label: '启用 DoRA', title: 'dora_wd', desc: 'DoRA 开启后会把权重分成方向与幅度两部分训练。', defaultValue: false, visibleWhen: when('lora_type', 'lora') },
  { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '默认 LoRA / PiSSA / OLoRA。', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: 'auto 导出为可加载 LoRA；raw 保留训练状态用于恢复。', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && nativeLoraInitSelected(c) },
  { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 量化位宽', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: 'rowwise 按输出通道量化，tensorwise 按整层张量量化。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: 'LoKr 分解因子', defaultValue: 8, min: -1, visibleWhen: when('lora_type', 'lokr') },
  { key: 'network_dropout', type: 'number', label: 'Dropout', title: 'network_dropout', desc: 'Dropout 概率', defaultValue: 0, min: 0, step: 0.01, visibleWhen: (c) => ['lora', 'dora', 'lora_plus', 'rs_lora', 'lora_fa', 'vera', 'tlora', 'flexrank', 'hydralora', 'fera', ...LYCORIS_DELTA_ALGOS].includes(c.lora_type) },
  { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数。', defaultValue: '' }
];

// ---- 训练参数 ----
const TRAINING_FIELDS = [
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: 'Anima 建议 1024,1024', defaultValue: '1024,1024' },
  { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: 'iLECO 常见 300~1000；ADDifT 常见 30~150。', defaultValue: 500, min: 1 },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '概念编辑建议从小 batch 开始。ADDifT 一般推荐 1~2。', defaultValue: 1, min: 1, max: 8, step: 1 },
  ditGradientCheckpointingField('DiT'),
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '梯度累加步数', defaultValue: 1, min: 1 },
  { key: 'network_train_unet_only', type: 'boolean', label: '仅训练 U-Net / DiT', title: 'network_train_unet_only', desc: '概念编辑当前只支持 DiT/U-Net 训练路线，建议保持开启。', defaultValue: true },
  { key: 'network_train_text_encoder_only', type: 'boolean', label: '仅训练文本编码器', title: 'network_train_text_encoder_only', desc: '概念编辑不支持单独训练文本编码器，请保持关闭。', defaultValue: false },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '动作/配件类差分常见 500；风格类常见 200。', defaultValue: '', min: 0 },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '动作/配件类差分常见 1000；风格类常见 400。', defaultValue: '', min: 1 },
  { key: 'concept_edit_fixed_timestep_per_batch', type: 'boolean', label: '批内固定时间步', title: 'concept_edit_fixed_timestep_per_batch', desc: '同一 batch 内共享同一个 timestep，减小批内波动。', defaultValue: false },
  { key: 'concept_edit_diff_alt_ratio', type: 'number', label: '差分交替倍率', title: 'concept_edit_diff_alt_ratio', desc: 'ADDifT 交替差分倍率', defaultValue: 1, step: 0.1, visibleWhen: isAdDifT },
  { key: 'concept_edit_use_diff_mask', type: 'boolean', label: '启用差分掩码', title: 'concept_edit_use_diff_mask', desc: 'ADDifT 可按原图/目标图像素差自动生成 mask，减少无关区域干扰。', defaultValue: false, visibleWhen: isAdDifT }
];

export const CONCEPT_EDIT_UNIFIED_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', '底模架构与方法选择。选择底模后，对应模型路径字段将自动显示。', MODEL_FIELDS),
  sec('anima-params', 'model', 'Anima 专用参数', 'Anima DiT 特有的 flow/noise/attention 配置。仅在选择 Anima 底模时显示。', ANIMA_PARAMS_FIELDS.map((f) => ({ ...f, visibleWhen: f.visibleWhen ? (c) => isAnima(c) && f.visibleWhen(c) : isAnima }))),
  sec('save-settings', 'model', '保存设置', '输出路径、格式与训练状态。', [...S_SAVE]),
  sec('concept-settings', 'dataset', '概念编辑输入', '原始概念与目标概念。iLECO 只需提示词；ADDifT 可额外提供图像对。', DATASET_FIELDS),
  sec('network-settings', 'network', '网络设置', '概念编辑支持原生 LoRA / DoRA / T-LoRA / LoKr 等变体。', NETWORK_FIELDS),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '概念编辑建议从稳定路线（AdamW / Prodigy）开始。', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '训练步数、分辨率与时间步控制。概念编辑优先按 step 控制时长。', TRAINING_FIELDS),
  sec('preview-settings', 'preview', '预览图设置', '可选。概念编辑也可以沿用普通训练预览。', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '混合精度、缓存与注意力后端。', [...S_SPEED_FLOW]),
  // min_timestep / max_timestep 与上面 training-settings 的 conceptEditTrainingFields 重叠；
  // S_NOISE 里那份默认值是空串，且渲染顺序在后，会把 ADDifT 的 500/1000 默认值盖成空串
  // （createDefaultConfig 是无条件覆盖，最后渲染的赢）。概念编辑的时间步范围归 training-settings 管。
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与辅助损失设置。',
    S_NOISE.filter((f) => !['min_timestep', 'max_timestep'].includes(f.key))),
  sec('advanced-settings', 'advanced', '其他设置', '其它参数。', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '概念编辑首版暂不建议多机多卡；这里仍保留通用入口。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];
