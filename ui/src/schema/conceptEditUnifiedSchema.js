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
    desc: '概念编辑参照的基模型路径。建议与训练底模同源。',
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
    desc: '概念编辑的具体实现方法选择。建议默认方法起步。',
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
    desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。',
    defaultValue: false,
    visibleWhen: isSd15,
  },
  {
    key: 'network_weights',
    type: 'file',
    pickerType: 'output-model-file',
    label: '继续训练 LoRA',
    title: 'network_weights',
    desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。',
    defaultValue: '',
  },
  {
    key: 'resume',
    type: 'folder',
    pickerType: 'output-folder',
    label: '继续训练路径',
    title: 'resume',
    desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。',
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
  { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 编码 token 上限。推荐范围：512（默认）以内，更长更慢更占缓存。', defaultValue: 512, min: 1 },
  { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 编码 token 上限。推荐范围：512（默认）；长描述任务可到 768 但缓存翻倍。', defaultValue: 512, min: 1 },
  { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '按 head 拆分 attention 计算省显存。建议显存临界时开，速度略降。', defaultValue: false },
  { key: 'vae_chunk_size', type: 'number', label: 'VAE 分块大小', title: 'vae_chunk_size', desc: 'VAE 解码分块大小，越小越省显存。推荐范围：2（默认）附近。', defaultValue: '', min: 2 }
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
    desc: '概念编辑数据目录。结构与训练数据集一致。',
    defaultValue: './train/concept-edit',
    visibleWhen: (c) => isAdDifT(c) && isAnima(c),
  }
];

// ---- 网络设置 ----
const NETWORK_FIELDS = [
  { key: 'lora_type', type: 'select', label: '适配器类型', title: 'lora_type', desc: '适配器类型主入口：LoRA 是基础路线。DoRA/HydraLoRA 等变体在「LoRA 结构变体」卡以独立旗标托管，勿在此重复选。建议 lora。', defaultValue: 'lora', options: NATIVE_ADAPTER_TYPES },
  { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已加载的 network_weights 自动推断 rank/dim，忽略手填值。建议续训旧 LoRA 且不确定原参数时开启。', defaultValue: false },
  { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '对 LoRA 权重做最大范数约束（Spectral Norm 正则），抑制过拟合。推荐范围：1（社区惯例值）；留空/0 关闭。', defaultValue: '', min: 0, step: 0.01 },
  { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '额外把归一化层（LayerNorm/RMSNorm）纳入训练。建议角色一致性微调时试验，常规保持关闭。', defaultValue: false },
  { key: 'dora_wd', type: 'boolean', label: '启用 DoRA', title: 'dora_wd', desc: '叠加在标准 LoRA 路线上的权重分解增强（方向+幅度），比标准 LoRA 表达力强但稍慢。本类型的 DoRA 主入口就是这个开关（向导中的「叠加 DoRA」开关读写它），后端会将其归一为 use_dora/dora_enabled 并强制 bypass_mode=False。推荐范围：小数据集或需要更强概念绑定（如角色脸）时开启。', defaultValue: false, visibleWhen: when('lora_type', 'lora') },
  { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：default 标准 LoRA；pissa/olora/loftq 特殊初始化（仍走请求管线，不加新入口）。建议 default，需要快速收敛换 pissa。', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: '特殊初始化产物的导出方式：auto 在最终保存时转成可直接加载到原底模的 LoRA。建议 auto。', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && nativeLoraInitSelected(c) },
  { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 量化位宽（fake-quant 初始化，不是持久 4bit 底座）。推荐范围：4（默认）或 8。', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: '量化粒度：rowwise 按输出通道，tensorwise 整张量。建议 rowwise（默认，精度更好）。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: 'LoKr Kronecker 分解因子：越大越省参数越弱表达。-1 表示无穷大因子（最省）。推荐范围：4（常用起点）～8；-1 极限压缩。', defaultValue: 8, min: -1, visibleWhen: when('lora_type', 'lokr') },
  { key: 'network_dropout', type: 'number', label: 'Dropout', title: 'network_dropout', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: (c) => ['lora', 'dora', 'lora_plus', 'rs_lora', 'lora_fa', 'vera', 'tlora', 'flexrank', 'hydralora', 'fera', ...LYCORIS_DELTA_ALGOS].includes(c.lora_type) },
  { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数。', defaultValue: '' }
];

// ---- 训练参数 ----
const TRAINING_FIELDS = [
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
  { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 500, min: 1 },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', defaultValue: 1, min: 1, max: 8, step: 1 },
  ditGradientCheckpointingField('DiT'),
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '累积 N 个 micro-batch 再更新一次参数，等效放大 batch 而不增加峰值显存。推荐范围：1（默认）或 4–8；等效 batch = batch_size × 本值。', defaultValue: 1, min: 1 },
  { key: 'network_train_unet_only', type: 'boolean', label: '仅训练 U-Net / DiT', title: 'network_train_unet_only', desc: '只训练 U-Net/DiT 主干（TE 冻结）。建议概念视觉为主、无需新词绑定时开启（多数 LoRA 场景）。', defaultValue: true },
  { key: 'network_train_text_encoder_only', type: 'boolean', label: '仅训练文本编码器', title: 'network_train_text_encoder_only', desc: '只训练文本编码器（主干冻结）。建议仅做词汇/风格语言绑定时开启。', defaultValue: false },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '训练允许的最小 timestep（截断低噪段）。推荐范围：留空全范围。', defaultValue: '', min: 0 },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '训练允许的最大 timestep（截断高噪段）。推荐范围：留空全范围；只想学细节时下调。', defaultValue: '', min: 1 },
  { key: 'concept_edit_fixed_timestep_per_batch', type: 'boolean', label: '批内固定时间步', title: 'concept_edit_fixed_timestep_per_batch', desc: '同一 batch 固定时间步（减少方差）。建议实验性开启。', defaultValue: false },
  { key: 'concept_edit_diff_alt_ratio', type: 'number', label: '差分交替倍率', title: 'concept_edit_diff_alt_ratio', desc: '差分/交替样本比例。推荐范围： 0.2–0.5 试探。', defaultValue: 1, step: 0.1, visibleWhen: isAdDifT },
  { key: 'concept_edit_use_diff_mask', type: 'boolean', label: '启用差分掩码', title: 'concept_edit_use_diff_mask', desc: '编辑区域使用差分 mask 约束改动范围。建议只想改局部时开启。', defaultValue: false, visibleWhen: isAdDifT }
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
