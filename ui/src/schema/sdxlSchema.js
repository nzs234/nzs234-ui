// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// sdxlSchema.js — SDXL 训练族 Schema(活文件 / 权威来源)
// 仅 SDXL:LoRA / iLECO / ADDifT / Multi-ADDifT / Finetune / ControlNet / Textual Inversion。
// (历史上本文件曾是承载所有族的神文件,已按族拆分:anima→animaSchema、长尾→otherSchemas/
//  otherDitSchemas、SECTIONS_MAP 与公共 API→schemaIndex。增删 SDXL 字段只改本文件。)
// 依赖方向(单向无环):schemaCommon → schemaFieldGroups → 本文件 → schemaIndex。
// ================================================================
import {
  when,
  all,
  LOW_VRAM_PROFILE_OPTIONS,
  pissaInitSelected,
  vParameterizationFields,
  ds,
  netLora,
  rectifiedFlowParams,
  sec,
  SAMPLE_SAMPLER_OPTIONS,
} from './schemaCommon.js';
import {
  S_SAVE,
  S_CAPTION_BASIC,
  S_CAPTION_DROPOUT,
  S_CAPTION_VARIANTS,
  S_CAPTION_STRUCTURED,
  S_LR,
  S_LR_TARGET,
  S_LR_FT,
  S_TRAIN,
  S_PREVIEW,
  S_QUALITY_EVAL,
  S_STAGED_RESOLUTION,
  S_SPEED_SDXL,
  S_CACHE_PIPELINE,
  S_LORA_METHOD_MODIFIERS,
  S_DISTRIBUTED,
  S_LULYNX_SDXL,
  S_ADV,
  S_NOISE,
  S_DATA_AUG,
  S_VALIDATION,
  S_THERMAL,
  S_PEAK_VRAM,
  S_LLLITE,
  conceptEditSections,
  finetuneModel,
  cnModel,
  cnDataset,
  cnTrainFields,
  cnLR,
  tiModel,
  tiParams,
  excludeKeys,
  S_EXECUTION_BACKEND,
  S_COMPILE_EXPERT,
  S_MODULE_OFFLOAD_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_QUALITY_OPTIMIZATION_PACK, S_LORA_VARIANTS, S_PERCEPTUAL_ANCHOR_LOSS,
  S_SAMPLING_OPTIMIZATION_RESERVE, S_REPA_RESERVE, S_NEGATIVE_SEMANTIC_REGULARIZATION, S_EXPERIMENTAL_PROBES,
  S_DIAGNOSTICS_MONITORING, S_AUTO_CONTROLLER, S_TURBOCORE,
  S_WEIGHT_COMPOSER, S_REGION_FOCUS, S_PROGRESSIVE_TRAINING, S_ADAPTIVE_TRAINING,
} from './schemaFrontierGroups.js';

// SDXL 系排版重排（九组规范示范）：caption 拆四卡、缓存独立成卡。
const SDXL_CAPTION_SECTIONS = [
  sec('caption-settings', 'dataset', '基础标注', 'Tag 文件、打乱与触发词注入。', [...S_CAPTION_BASIC]),
  sec('caption-dropout-settings', 'dataset', '丢弃与保护策略', 'Caption/Tag dropout 与前缀保护边界（after_separator 语义族）。', [...S_CAPTION_DROPOUT]),
  sec('caption-variants-settings', 'dataset', '多变体与双 Caption', '变体调度、双 Caption 与替换规则之外的变体面。', [...S_CAPTION_VARIANTS]),
  sec('caption-structured-settings', 'dataset', '结构化稳定性', 'OOM 跳批等结构化 caption 训练稳定性开关。', [...S_CAPTION_STRUCTURED]),
];

// finetune：train_text_encoder 显式 master（queue_support 以 not train_text_encoder
// 派生 network_train_unet_only；提交层保持两键一致出站）。
const FT_TRAIN_FIELDS = [
  { key: 'train_text_encoder', type: 'boolean', label: '训练文本编码器', title: 'train_text_encoder', desc: '同时微调 CLIP 文本编码器（运行时默认语义）；关闭则仅训练 U-Net/DiT。触发词理解差、词汇绑定弱时建议开启，TE 学习率另设为 UNet 的 1/2～1/10。', defaultValue: true },
  ...S_TRAIN(10).filter((f) => !['network_train_unet_only', 'network_train_text_encoder_only'].includes(f.key)),
];

// ---- SDXL LoRA ----
export const SDXL_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL 底模、VAE 与恢复训练。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'sdxl-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'SDXL 底模路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
  ]),
  sec('save-settings', 'model', '保存设置', '输出路径、格式与训练状态。', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据、正则图与分桶。', [...ds('1024,1024', 2048, 32), ...S_STAGED_RESOLUTION]),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  // dim/alpha 上限对齐后端（sdxl_lora.py:102-111 max=1024）；LoRA+/RS-LoRA 自 optimizer 页迁入。
  sec('network-settings', 'network', '网络设置', 'LoRA / LyCORIS 参数。', netLora('networks.lora', 32, 32, 1024, [
    { key: 'tlora_min_rank', type: 'number', label: 'T-LoRA 最小 Rank', title: 'tlora_min_rank', desc: 'T-LoRA 动态 rank 下界。推荐范围：保持 1。', defaultValue: 1, min: 1, visibleWhen: when('network_module', 'networks.tlora') },
    { key: 'tlora_orthogonal_init', type: 'boolean', label: 'T-LoRA 正交初始化', title: 'tlora_orthogonal_init', desc: '对 lora_down 用正交初始化提升早期稳定。建议默认关闭，不稳定时试开。', defaultValue: false, visibleWhen: when('network_module', 'networks.tlora') },
    { key: 'pissa_init', type: 'boolean', label: '启用 PiSSA 初始化', title: 'pissa_init', desc: 'PiSSA 用 SVD 主奇异分量初始化 LoRA，收敛更快更好。建议中大数据集开启；导出兼容性见导出模式选项。', defaultValue: false, visibleWhen: when('network_module', 'networks.lora') },
    { key: 'pissa_method', type: 'select', label: 'PiSSA 分解方式', title: 'pissa_method', desc: 'PiSSA 分解算法：rsvd 随机化快，svd 精确慢。建议保持 rsvd。', defaultValue: 'rsvd', options: ['rsvd', 'svd'], visibleWhen: all(when('network_module', 'networks.lora'), pissaInitSelected) },
    { key: 'pissa_niter', type: 'number', label: 'PiSSA 幂迭代次数', title: 'pissa_niter', desc: 'rSVD 幂迭代次数，越大越准越慢。推荐范围：保持 2。', defaultValue: 2, min: 0, step: 1, visibleWhen: all(when('network_module', 'networks.lora'), pissaInitSelected) },
    { key: 'pissa_oversample', type: 'number', label: 'PiSSA 过采样维度', title: 'pissa_oversample', desc: 'rSVD 过采样维度。推荐范围：保持 8。', defaultValue: 8, min: 0, step: 1, visibleWhen: all(when('network_module', 'networks.lora'), pissaInitSelected) },
    { key: 'pissa_apply_conv2d', type: 'boolean', label: 'PiSSA 作用于 Conv', title: 'pissa_apply_conv2d', desc: 'PiSSA 同样作用于 1x1 Conv。建议网络含 Conv 目标且追求一致时开启。', defaultValue: false, visibleWhen: all(when('network_module', 'networks.lora'), pissaInitSelected) },
    { key: 'pissa_export_mode', type: 'select', label: 'PiSSA 导出模式', title: 'pissa_export_mode', desc: 'PiSSA 模型存为标准 LoRA 的导出方式（底模是否吸收残差）。建议 lora_compatible 保证通用加载。', defaultValue: 'lora_compatible', options: [
      { value: 'lora_compatible', label: 'lora_compatible（无损兼容）' },
      { value: 'approximate', label: 'approximate（快速近似）' },
      { value: 'raw', label: 'raw' },
      { value: 'auto', label: 'auto' },
    ], visibleWhen: all(when('network_module', 'networks.lora'), pissaInitSelected) },
    // T-LoRA rank 调度：后端支持集 constant/linear/cosine/geometric
    // （configs_training_methods.py:442，cosine 已转正；launcher registry sdxl_lora.py 同步）。
    { key: 'tlora_rank_schedule', type: 'select', label: 'T-LoRA Rank 调度', title: 'tlora_rank_schedule', desc: '动态 rank 调度策略（constant/linear/cosine/geometric，后端支持集，cosine 于 configs_training_methods.py:442 加入）。建议 constant 起步；需要中段平滑增减 rank 时试 cosine。', defaultValue: 'constant', options: ['constant', 'linear', 'cosine', 'geometric'], visibleWhen: when('network_module', 'networks.tlora') },
    ...S_LORA_METHOD_MODIFIERS,
  ], ['networks.lora_fa', 'networks.vera', 'networks.tlora', 'networks.flexrank_lora', 'networks.oft'], true, { hideDoraWd: true })),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '学习率、调度器与优化器。', excludeKeys(S_LR_TARGET, ['lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled'])),
  sec('training-settings', 'training', '训练参数', '训练轮数、批量与梯度。', [...S_TRAIN(10)]),
  sec('negative-semantic-regularization', 'frontier', '负面语义正则', '用负面提示词约束 LoRA 在不希望语义上的增量。', [...S_NEGATIVE_SEMANTIC_REGULARIZATION]),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标与相关补偿项。', vParameterizationFields(true)),
  // RF/CFM 是实验目标函数（后端置于 advanced 语义组），从 training 页签移入高级。
  sec('rf-settings', 'advanced', 'Rectified Flow', 'RF / Flow Matching 训练目标与时间步策略。', rectifiedFlowParams()),
  sec('peak-vram-settings', 'speed', '显存峰值控制', '目标等效 batch、启动峰值保护、micro-batch 拆分与显存诊断。', [...S_PEAK_VRAM]),
  sec('block-swap-settings', 'speed', 'SDXL Block Swap（兜底）', '独立的 SDXL U-Net block swap 兜底开关。主要用于显存吃紧时保命，能正常跑就不要开；若同时开启 ≤6GB 低显存优化，则仍会由低显存预设接管 block swap。', [
    { key: 'sdxl_block_swap_enabled', type: 'boolean', label: '启用 SDXL Block Swap', title: 'sdxl_block_swap_enabled', desc: 'SDXL U-Net block swap 兜底开关：显存不足时把部分 U-Net block 移到 CPU。建议低显存档案已覆盖时无需手开。', defaultValue: false },
    { key: 'sdxl_block_swap_output_blocks', type: 'boolean', label: '交换 Output Blocks', title: 'sdxl_block_swap_output_blocks', desc: '交换 U-Net output blocks（推荐第一步尝试，收益/速度比最好）。建议保持 true。', defaultValue: true, visibleWhen: when('sdxl_block_swap_enabled', true) },
    { key: 'sdxl_block_swap_middle_block', type: 'boolean', label: '交换 Middle Block', title: 'sdxl_block_swap_middle_block', desc: '交换 middle block（推荐第二步尝试）。建议保持 true。', defaultValue: true, visibleWhen: when('sdxl_block_swap_enabled', true) },
    { key: 'sdxl_block_swap_offload_after_backward', type: 'boolean', label: '反向后卸载', title: 'sdxl_block_swap_offload_after_backward', desc: '反向传播结束后立即卸载已交换 block：更省显存但更慢。建议显存极限才关。', defaultValue: true, visibleWhen: when('sdxl_block_swap_enabled', true) },
    { key: 'sdxl_block_swap_input_blocks', type: 'boolean', label: '交换 Input Blocks', title: 'sdxl_block_swap_input_blocks', desc: '交换 input blocks（最后再尝试，收益低速度损失大）。建议默认 false。', defaultValue: false, visibleWhen: when('sdxl_block_swap_enabled', true) },
    { key: 'sdxl_block_swap_vram_threshold', type: 'number', label: '显存水线 (%)', title: 'sdxl_block_swap_vram_threshold', desc: 'block swap 的软显存水线（%）：低于该占用提前回收。推荐范围：70（默认）附近；0 尽快卸载。', defaultValue: 70, min: 0, max: 99, step: 1, visibleWhen: when('sdxl_block_swap_enabled', true) },
  ]),

  sec('low-vram-settings', 'speed', 'SDXL/LoRA 低显存档位', '按显存目标自动组合缓存、梯度检查点、文本/图像编码器驻留、阶段分辨率和权重交换。', [
    { key: 'low_vram_profile', type: 'select', label: '低显存档位', title: 'low_vram_profile', desc: '推荐先用 16G 稳定档', defaultValue: 'off', options: LOW_VRAM_PROFILE_OPTIONS },
    { key: 'sdxl_low_vram_optimization', type: 'boolean', label: '启用低显存优化', title: 'sdxl_low_vram_optimization', desc: '一键低显存优化（≤6GB）：组合 block swap/CPU 驻留/降频预览等。建议 6–8G 卡开启。', defaultValue: false },
    { key: 'sdxl_low_vram_resolution_mode', type: 'select', label: '分辨率规划模式', title: 'sdxl_low_vram_resolution_mode', desc: '低显存分辨率模式（是否允许下调基准）。建议 auto。', defaultValue: 'long_edge', options: ['long_edge', 'short_edge'], visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_bucket_reso_steps', type: 'number', label: 'Bucket 步长', title: 'sdxl_low_vram_bucket_reso_steps', desc: '低显存模式桶步长。推荐范围：32。', defaultValue: 32, visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_two_phase_cache', type: 'boolean', label: '两阶段缓存', title: 'sdxl_low_vram_two_phase_cache', desc: '启用两阶段缓存流程。会优先把缓存阶段与正式训练阶段解耦', defaultValue: true, visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_component_cpu_residency', type: 'boolean', label: '组件 CPU 驻留', title: 'sdxl_low_vram_component_cpu_residency', desc: 'VAE/TE 只在上卡需要时临时进驻。建议保持开启（档案默认 true）。', defaultValue: true, visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_fixed_block_swap', type: 'boolean', label: 'U-Net Block Swap', desc: '启用 U-Net block swap（低显存档案组件）。建议保持开启（档案默认 true）。', defaultValue: true, visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_swap_input_blocks', type: 'boolean', label: '交换 Input Blocks', title: 'sdxl_low_vram_swap_input_blocks', desc: '交换 input blocks：显存收益较大但更慢。建议仅仍 OOM 再开。', defaultValue: false, visibleWhen: all(when('sdxl_low_vram_optimization', true), when('sdxl_low_vram_fixed_block_swap', true)) },
    { key: 'sdxl_low_vram_swap_middle_block', type: 'boolean', label: '交换 Middle Block', title: 'sdxl_low_vram_swap_middle_block', desc: '交换 middle block：通常比较划算。建议保持 true。', defaultValue: true, visibleWhen: all(when('sdxl_low_vram_optimization', true), when('sdxl_low_vram_fixed_block_swap', true)) },
    { key: 'sdxl_low_vram_swap_output_blocks', type: 'boolean', label: '交换 Output Blocks', title: 'sdxl_low_vram_swap_output_blocks', desc: '交换 U-Net output blocks。通常建议优先尝试', defaultValue: true, visibleWhen: all(when('sdxl_low_vram_optimization', true), when('sdxl_low_vram_fixed_block_swap', true)) },
    { key: 'sdxl_low_vram_swap_offload_after_backward', type: 'boolean', label: '反向后卸载', title: 'sdxl_low_vram_swap_offload_after_backward', desc: '反向后立即把已交换 block 移回 CPU。更省显存更慢。建议保持 true。', defaultValue: true, visibleWhen: all(when('sdxl_low_vram_optimization', true), when('sdxl_low_vram_fixed_block_swap', true)) },
    { key: 'sdxl_low_vram_swap_vram_threshold', type: 'number', label: '显存水线 (%)', title: 'sdxl_low_vram_swap_vram_threshold', desc: '软显存水线 %：0 表示始终尽快卸载。推荐范围： 0（档案默认）。', defaultValue: 0, min: 0, max: 99, step: 1, visibleWhen: all(when('sdxl_low_vram_optimization', true), when('sdxl_low_vram_fixed_block_swap', true)) },
    { key: 'sdxl_low_vram_preview_policy', type: 'select', label: '预览策略', title: 'sdxl_low_vram_preview_policy', desc: '低显存下预览频率策略（every_4_epochs 等）。建议保持默认节流档。', defaultValue: 'every_4_epochs', options: ['every_2_epochs', 'every_4_epochs', 'disable'], visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_auto_protection', type: 'boolean', label: 'OOM 自动保护', title: 'sdxl_low_vram_auto_protection', desc: '预览 OOM 先降频再自动关闭预览。建议保持开启。', defaultValue: true, visibleWhen: when('sdxl_low_vram_optimization', true) },
    { key: 'sdxl_low_vram_auto_resolution_probe', type: 'boolean', label: '自动分辨率探测', title: 'sdxl_low_vram_auto_resolution_probe', desc: '启动前自动预跑探测显存并必要时下调分辨率。建议保持开启。', defaultValue: true, visibleWhen: when('sdxl_low_vram_optimization', true) },
  ]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '训练中生成预览图。', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('lulynx-settings', 'advanced', 'Lulynx 核心 (SDXL)', 'SafeGuard、EMA、ResourceManager、BlockWeight 分层学习率（唯一 master）、SmartRank。', S_LULYNX_SDXL),
  sec('speed-settings', 'speed', '速度优化', '混合精度、注意力后端与显存交换（缓存已拆至数据页）。', [...S_SPEED_SDXL]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '噪声、种子与其它选项。', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('lora-variants', 'network', 'LoRA 结构变体', '可选 LoRA 结构变体。', [...S_LORA_VARIANTS], { expert: true }),
  sec('quality-pack-settings', 'frontier', '图像质量增强', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK]),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理与感知锚，参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针与诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计、深度诊断与逐层监测。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL 概念编辑(iLECO / ADDifT / Multi-ADDifT) ----
export const SDXL_ILECO_SECTIONS = conceptEditSections({
  typeId: 'sdxl-ileco',
  label: 'SDXL',
  isSdxl: true,
  mode: 'ileco',
  resolution: '1024,1024',
  maxTrainSteps: 500,
});

export const SDXL_ADDIFT_SECTIONS = conceptEditSections({
  typeId: 'sdxl-addift',
  label: 'SDXL',
  isSdxl: true,
  mode: 'addift',
  resolution: '1024,1024',
  maxTrainSteps: 80,
  minTimestep: 500,
  maxTimestep: 1000,
});

export const SDXL_MULTI_ADDIFT_SECTIONS = conceptEditSections({
  typeId: 'sdxl-multi-addift',
  label: 'SDXL',
  isSdxl: true,
  mode: 'multi-addift',
  resolution: '1024,1024',
  maxTrainSteps: 120,
  minTimestep: 500,
  maxTimestep: 1000,
});

// ---- SDXL Finetune ----
export const SDXL_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL 全参微调。', [
    ...finetuneModel('sdxl-finetune', 'SDXL'),
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  // full_finetune 无 LoRA 注入对象：optimizer 页不含 lora_plus/rs_lora（网络修饰）。
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', excludeKeys(S_LR_FT, ['lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled'])),
  sec('training-settings', 'training', '训练参数', '', FT_TRAIN_FIELDS),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标开关。', vParameterizationFields()),
  sec('rf-settings', 'advanced', 'Rectified Flow', 'RF / Flow Matching 训练目标与时间步策略。', rectifiedFlowParams()),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  // lora-variants-ft 整区已删除：full_finetune 不走 LoRA 注入链
  // （entry_train select_trainer_key → LulynxTrainer full_finetune 分支），
  // dokr/hydralora 等实体旗标在全参微调下没有注入对象，属于无效旋钮。
  sec('quality-pack-settings', 'frontier', '图像质量增强', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK]),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理与感知锚，参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针与诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计、深度诊断与逐层监测。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL ControlNet ----
export const SDXL_CN_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL ControlNet。', cnModel('sdxl-controlnet', 'SDXL')),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标开关。', vParameterizationFields()),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '图像质量增强', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK]),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理与感知锚，参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针与诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计、深度诊断与逐层监测。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL Textual Inversion ----
export const SDXL_TI_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL Textual Inversion。', tiModel('sdxl-textual-inversion', 'SDXL')),
  sec('ti-params', 'model', 'Textual Inversion 专用', '', [...tiParams]),
  sec('save-settings', 'model', '保存设置', '', S_SAVE.map((f) => f.key === 'save_model_as' ? { ...f, defaultValue: 'pt' } : f.key === 'output_name' ? { ...f, defaultValue: 'embedding' } : f)),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '图像质量增强', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK]),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理与感知锚，参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针与诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计、深度诊断与逐层监测。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL DreamBooth（后端 sd_dreambooth.py:40-141 + 路由 training_route_catalog.py:56）----
export const SDXL_DB_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL DreamBooth 主体概念微调。', [
    ...finetuneModel('sdxl-dreambooth', 'SDXL'),
    { key: 'base_model_path', type: 'file', pickerType: 'model-file', label: 'Base 模型路径（可选）', title: 'base_model_path', desc: '部分管线需要显式 base；留空跟随底模路径', defaultValue: '' },
    { key: 'instance_prompt', type: 'string', label: '实例提示词', title: 'instance_prompt', desc: '实例提示词：训练图的主 caption 模板，通常含触发词。建议所有概念统一格式，触发词放首位。', defaultValue: 'sks subject' },
    { key: 'class_prompt', type: 'string', label: '类别提示词', title: 'class_prompt', desc: '类别提示词（如 photo of a person），用于生成正则图的 caption。建议与实例词构成「类别 + 触发词」对照。', defaultValue: 'a subject' },
    // 后端 sdxl 版 schema 未声明 num_class_images，但 dreambooth_prior_setup.py:42
    // 运行时读取（默认 100）；随入口一并补暴露。
    { key: 'num_class_images', type: 'number', label: '类别图像生成数', title: 'num_class_images', desc: '为类别提示词预生成的图像数量（0=不生成）。推荐范围：100–200 与训练图同量级；运行时默认 100。', defaultValue: 100, min: 0, step: 1 },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '实例图像、正则图与分辨率。', ds('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', 'LoRA 化训练', 'DreamBooth 可选走 LoRA 路线以省显存。', [
    { key: 'use_lora', type: 'boolean', label: '启用 LoRA 训练', title: 'use_lora', desc: '开启后按 LoRA 微调（queue_support 会把 lora_rank 重映射为 network_dim）', defaultValue: false },
    { key: 'network_dim', type: 'number', label: '网络维度', title: 'network_dim', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 32, min: 1, max: 1024, step: 1, visibleWhen: when('use_lora', true) },
    { key: 'network_alpha', type: 'number', label: '网络 Alpha', title: 'network_alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1, max: 1024, step: 1, visibleWhen: when('use_lora', true) },
  ]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', excludeKeys(S_LR_FT, ['lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled'])),
  sec('training-settings', 'training', '训练参数', '', FT_TRAIN_FIELDS),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
  sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计与深度诊断。', [...S_DIAGNOSTICS_MONITORING]),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL ControlNet-LLLite（后端 controlnet_schemas.py LLLITE_FIELDS + lllite_trainer.py:106-116）----
// S_LLLITE 孤儿组已与后端逐键一致，直接接线。
export const SDXL_LLLITE_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL ControlNet-LLLite（轻量条件适配器）。', cnModel('sdxl-controlnet-lllite', 'SDXL')),
  sec('lllite-settings', 'network', 'LLLite 适配器参数', 'UNet 条件适配器结构参数（逐键对齐 lllite_trainer 读取）。', [...S_LLLITE]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标开关。', vParameterizationFields()),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
  sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计与深度诊断。', [...S_DIAGNOSTICS_MONITORING]),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];

// ---- SDXL IP-Adapter（后端 ip_adapter_schemas.py：ip_image_encoder_path/ip_num_tokens）----
// 旧 S_IP_ADAPTER 孤儿组键名（ip_adapter_*）与后端 schema 不一致，此处以后端真值重建；
// 旧组仍被 anima-lora 挂载，归 ANIMA 站处理，本站不动。
export const SDXL_IP_ADAPTER_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SDXL IP-Adapter 图像条件注入训练。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'sdxl-ip-adapter' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'SDXL 底模路径', desc: '底模文件路径', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '已有 IP-Adapter 权重', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
  ]),
  sec('ip-adapter-settings', 'network', 'IP-Adapter 参数', '图像编码器与注入 token 数（后端 ip_adapter_trainer.py:90,110 消费）。', [
    { key: 'ip_image_encoder_path', type: 'string', label: '图像编码器', title: 'ip_image_encoder_path', desc: 'CLIP 视觉编码器路径或 HF id；留空时后端有兜底但会提示', defaultValue: 'openai/clip-vit-large-patch14' },
    { key: 'ip_num_tokens', type: 'number', label: '注入 Token 数', title: 'ip_num_tokens', desc: 'IP-Adapter 注入 UNet 的 token 数量。推荐范围：16（SDXL 默认）。', defaultValue: 16, min: 1, max: 64, step: 1 },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('1024,1024', 2048, 32)),
  ...SDXL_CAPTION_SECTIONS,
  sec('cache-settings', 'dataset', '缓存管线', 'Latent / 文本编码器输出缓存与盘上格式（数据管线语义）。', [...S_CACHE_PIPELINE]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', excludeKeys(S_LR, ['lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled'])),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SDXL]),
  sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控、统计与深度诊断。', [...S_DIAGNOSTICS_MONITORING]),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true }),
];
