// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// animaSchema.js — Anima 训练族 Schema(活文件 / 权威来源)
// 这里是 anima-lora / anima-ileco / anima-addift / anima-multi-addift /
// anima-finetune 的唯一权威 schema。未来给 Anima 增删字段只改本文件即可。
//
// 历史包袱说明:旧版本里这些 section 曾混在误命名的 sdxlSchema.js 神文件内,
// 而同名旧 animaSchema.js 是死代码(与 schemaRegistry.js 互相 import 成闭环、
// 无人消费),改它零效果。本次重构已把活代码搬来这里,死代码闭环移除。
//
// 依赖方向(单向无环):schemaCommon → schemaFieldGroups → 本文件 → schemaIndex。
// 公共工具/选项取自 schemaCommon;跨族共享字段组(S_SAVE/S_LR/... )取自 schemaFieldGroups;
// anima 专属常量(S_ANIMA_INFERENCE_ACCEL / animaConcept* )就地定义,不外泄。
// ================================================================
import {
  when, all, sec, ds, flowParams,
  ditGradientCheckpointingField, ditTrainFields,
  NATIVE_ADAPTER_TYPES, ADAPTER_INIT_STRATEGY_OPTIONS, ADAPTER_INIT_EXPORT_MODE_OPTIONS,
  LOFTQ_QUANT_TYPE_OPTIONS, LYCORIS_DELTA_ALGOS,
  nativeLoraInitSelected, loftqInitSelected, pissaInitSelected, doraEnabled,
} from './schemaCommon.js';
import {
  S_SAVE,
  S_CAPTION,
  S_DATA_AUG,
  S_LR,
  S_LR_TARGET,
  S_LR_FT,
  S_LR_DIT,
  S_LR_TARGET_DIT,
  S_LR_FT_DIT,
  S_TRAIN,
  S_PREVIEW,
  S_QUALITY_EVAL,
  S_VALIDATION,
  S_NOISE,
  S_ADV,
  S_ADV_DIT,
  S_THERMAL,
  S_DISTRIBUTED,
  S_SPEED_FLOW,
  S_LULYNX_SDXL,
  S_DIT_PERFORMANCE_EXPERT,
  VRAM_AUTO_ENHANCE_FIELDS,
  ANIMA_BLOCK_RESIDENCY_FIELDS,
  S_CACHED_DATALOADER,
  S_QUANTIZATION,
  S_ANIMA_CONTROLNET,
  cnDataset,
  cnTrainFields,
  cnLR,
  conceptEditIdeaFields,
  S_SAFEGUARD,
  S_WAVELET_LOSS,
  S_EXECUTION_BACKEND,
  S_COMPILE_EXPERT,
  S_MEMORY_OFFLOAD,
  S_MODULE_OFFLOAD_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_QUALITY_OPTIMIZATION_PACK, S_LORA_VARIANTS, S_PERCEPTUAL_ANCHOR_LOSS,
  S_SAMPLING_OPTIMIZATION_RESERVE, S_REPA_RESERVE, S_LAYERSYNC, S_EXPERIMENTAL_PROBES,
  S_DIAGNOSTICS_MONITORING, S_AUTO_CONTROLLER, S_TURBOCORE, S_TURBO_LORA,
  S_NEGATIVE_SEMANTIC_REGULARIZATION, S_DIT_BLOCKSKIP, S_SIGMA_DEPTH_SCHEDULE,
  S_PATTERN_LOSS,
  S_CONCEPT_GEOMETRY, S_IP_ADAPTER, S_DPO, S_SRA2_HASTE,
  S_ADAPTIVE_CACHING, S_SAMPLE_PROBES,
  S_EASYCONTROL, S_PIXEL_SPACE,
  S_WEIGHT_COMPOSER, S_REGION_FOCUS, S_PROGRESSIVE_TRAINING, S_ADAPTIVE_TRAINING,
} from './schemaFrontierGroups.js';

// Anima 预览出图推理加速(DiT 块缓存 skip)。仅 Anima 路线;默认关=精确逐块计算=parity。
// 关时方案/强度字段隐藏不输出 → 后端 sample_cache_seam_backend 默认 'none';enable_inference_accel 为纯 UI gate,
// 由 runConfigBuilder.removeUiOnlyFields 删除不传后端。probe 双开由 sampler.create_sampler_from_trainer 据 backend 自动补。
const S_ANIMA_INFERENCE_ACCEL = [
  { key: 'enable_inference_accel', type: 'boolean', label: '允许推理加速 (预览出图)', desc: '可选地加速预览出图：Spectrum/SmoothCache 会跳过部分', defaultValue: false, visibleWhen: when('enable_preview', true) },
  { key: 'sample_cache_seam_backend', type: 'select', label: '加速方案', desc: '加速方案', defaultValue: 'spectrum', options: [{ value: 'spectrum', label: 'Spectrum (块缓存线性外推)' }, { value: 'smoothcache', label: 'SmoothCache (误差引导缓存)' }], visibleWhen: all(when('enable_preview', true), when('enable_inference_accel', true)) },
  { key: 'sample_cache_seam_window_size', type: 'number', label: 'Spectrum 窗口大小', desc: '线性外推用的历史窗口', defaultValue: 3, min: 2, step: 1, visibleWhen: all(when('enable_preview', true), when('enable_inference_accel', true), when('sample_cache_seam_backend', 'spectrum')) },
  { key: 'sample_smoothcache_error_threshold', type: 'number', label: 'SmoothCache 误差阈值', desc: '块间误差低于该阈值才复用缓存', defaultValue: 0.08, min: 0, step: 0.01, visibleWhen: all(when('enable_preview', true), when('enable_inference_accel', true), when('sample_cache_seam_backend', 'smoothcache')) },
];

// Anima 训练「忠实原生前向」(#147)。默认关 = 旧路径(#132)逐位不变 = parity，仅显式开启才生效。
// 开启后做两处真修复(A/B 实测让 anima 真正收敛:单概念 loss−92%/cos→0.96,多风格 cos→0.955/0.969):
//   ① 时间步喂 t=sigma∈[0,1](rectified flow),不是 sigma*1000;
//   ② cross-attn context 由冻结的 llm_adapter 现跑产出(Qwen3 hidden + T5 ids),不再直接喂 raw Qwen3 hidden,并启用 3D-RoPE 自注意力。
// 文本侧全程冻结(llm_adapter 只跑不训)。仅 anima-lora 缓存优先路线;faithful 自动关闭 block-checkpoint/缓存/reducer seam,
// 缺 t5_input_ids 或同时开了 reducer 等不兼容时自动回退旧路径(后端醒目提示,不报错)。native anima 默认开;后端 config.anima_faithful_forward 直接消费(Pydantic 声明字段,无需白名单)。
const S_ANIMA_FAITHFUL_FORWARD = [
  { key: 'anima_faithful_forward', type: 'boolean', label: '忠实原生前向（native anima）', desc: '用忠实原生 DiT 前向训练（native anima）', defaultValue: true },
];

// FG-LoRA 训练时选择性层注入 (adapter_target_policy)。默认 'all' 训练所有层=传统 LoRA=parity。
// 'profiled' / 'gradient_selected' / 'cka_selected' 按重要性选择子集层，减少参数量或重分配 rank。
// fg_lora_rank_policy: uniform | coupled_prune | orthogonal_redistribute | fim_profile。
// fg_lora_rank_profile: center_peak/ascending/descending/flat，仅 orthogonal_redistribute 使用。
const S_ADAPTER_TARGET_POLICY = [
  { key: 'adapter_target_policy', type: 'select', label: 'FG-LoRA 选择策略', title: 'adapter_target_policy', desc: 'FG-LoRA 选择策略', defaultValue: 'all', options: [
    { value: 'all', label: 'All (训练所有层，传统 LoRA)' },
    { value: 'profiled', label: 'Profiled (使用预计算 profile)' },
    { value: 'gradient_selected', label: 'Gradient Selected (按梯度选择)' },
    { value: 'cka_selected', label: 'CKA Selected (按相似度选择)' },
  ] },
  { key: 'fg_lora_rank_policy', type: 'select', label: 'Rank 分配策略', title: 'fg_lora_rank_policy', desc: 'Rank 分配策略', defaultValue: 'uniform', options: [
    { value: 'uniform', label: 'uniform（统一 rank）' },
    { value: 'coupled_prune', label: 'coupled_prune（剔除不重要层）' },
    { value: 'orthogonal_redistribute', label: 'orthogonal_redistribute（全层重分配）' },
    { value: 'fim_profile', label: 'fim_profile（FIM 逐层精确 rank）' },
  ], visibleWhen: (c) => c.adapter_target_policy !== 'all' },
  { key: 'fg_lora_rank_profile', type: 'select', label: 'Rank 深度曲线', title: 'fg_lora_rank_profile', desc: 'Rank 深度曲线', defaultValue: 'center_peak', options: [
    { value: 'center_peak', label: 'center_peak（中间层高）' },
    { value: 'ascending', label: 'ascending（深层高）' },
    { value: 'descending', label: 'descending（浅层高）' },
    { value: 'flat', label: 'flat（平坦）' },
  ], visibleWhen: (c) => c.adapter_target_policy !== 'all' && c.fg_lora_rank_policy === 'orthogonal_redistribute' },
  { key: 'fg_lora_rank_min', type: 'number', label: '最小 Rank', title: 'fg_lora_rank_min', desc: '选中层的最小 rank', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.adapter_target_policy !== 'all' },
  { key: 'fg_lora_rank_max', type: 'number', label: '最大 Rank', title: 'fg_lora_rank_max', desc: '选中层的最大 rank。高分数层会接近此值。', defaultValue: 32, min: 1, step: 1, visibleWhen: (c) => c.adapter_target_policy !== 'all' },
  { key: 'adapter_target_policy_fraction', type: 'number', label: '选择层比例', title: 'adapter_target_policy_fraction', desc: '保留多少比例的层（0.', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.adapter_target_policy !== 'all' && c.fg_lora_rank_policy === 'coupled_prune' },
  { key: 'adapter_target_policy_top_k', type: 'number', label: '选择层数量', title: 'adapter_target_policy_top_k', desc: '直接指定保留多少个最重要的层。0 表示使用 fraction 比例。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adapter_target_policy !== 'all' && c.fg_lora_rank_policy === 'coupled_prune' },
  { key: 'adapter_target_policy_min_score', type: 'number', label: '最低分数阈值', title: 'adapter_target_policy_min_score', desc: '层的重要性分数低于此值会被过滤。0 表示不设阈值。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: (c) => c.adapter_target_policy !== 'all' },
  { key: 'fg_lora_rank_conserve_budget', type: 'boolean', label: '保持总 Rank 预算', title: 'fg_lora_rank_conserve_budget', desc: 'orthogonal 重分配时，确保总 rank 数不超过传统', defaultValue: true, visibleWhen: (c) => c.adapter_target_policy !== 'all' && c.fg_lora_rank_policy === 'orthogonal_redistribute' },
  { key: 'fim_scan_tool', type: 'action', label: 'FIM Rank 扫描器（）', desc: '训练前用经验 Fisher 信息扫描各层对任务的敏感度，自动给出"建议层 +', buttonLabel: '打开 FIM 扫描器', handler: 'openFimScanTool', summaryKey: 'fg_lora_rank_map_json', visibleWhen: (c) => c.adapter_target_policy !== 'all' },
  { key: 'fg_lora_rank_map_json', type: 'textarea', label: 'FIM 逐层 Rank 映射', title: 'fg_lora_rank_map_json', desc: '由 FIM 扫描器一键写回的逐层精确 rank 映射（JSON：{完整层路径:', defaultValue: '', visibleWhen: (c) => c.adapter_target_policy !== 'all' && c.fg_lora_rank_policy === 'fim_profile' },
];

// 分层 Alpha —— 按模块类型给不同的 LoRA alpha（截图书签能力的 lulynx 实现）。
// 与 rank 无关：rank 仍走 network_dim / FG-LoRA，这里只覆盖各组的 alpha 缩放。
// 默认关 = 所有组用全局 network_alpha = 传统 LoRA = parity。开启后，留空的组仍回退全局 alpha。
// 后端字段是单个 network_alpha_map_json（JSON {组名: alpha}），由 runConfigBuilder 合成。
const S_LAYERED_ALPHA = [
  { key: 'layered_alpha_enabled', type: 'boolean', label: '分层 Alpha（按模块类型）', title: 'layered_alpha_enabled', desc: '分层 Alpha', defaultValue: false },
  { key: 'alpha_self_attn', type: 'number', label: 'Self Attention Alpha', title: 'alpha_self_attn', desc: '自注意力投影的 alpha', defaultValue: '', min: 1, step: 1, visibleWhen: when('layered_alpha_enabled', true) },
  { key: 'alpha_cross_attn', type: 'number', label: 'Cross Attention Alpha', title: 'alpha_cross_attn', desc: '交叉注意力投影的 alpha', defaultValue: '', min: 1, step: 1, visibleWhen: when('layered_alpha_enabled', true) },
  { key: 'alpha_mlp', type: 'number', label: 'MLP Alpha', title: 'alpha_mlp', desc: 'MLP 层的 alpha', defaultValue: '', min: 1, step: 1, visibleWhen: when('layered_alpha_enabled', true) },
  { key: 'alpha_adaln', type: 'number', label: 'Modulation Alpha', title: 'alpha_adaln', desc: 'AdaLN 调制层的 alpha。', defaultValue: '', min: 1, step: 1, visibleWhen: when('layered_alpha_enabled', true) },
  { key: 'alpha_llm_adapter', type: 'number', label: 'LLM Adapter Alpha', title: 'alpha_llm_adapter', desc: 'LLM Adapter 的 alpha。', defaultValue: '', min: 1, step: 1, visibleWhen: when('layered_alpha_enabled', true) },
];

// Anima 时间步采样策略 (timestep_sampling_strategy)。控制训练时采样哪些时间步。
// 默认 'disabled' 全范围均匀采样=传统训练=parity。'simple' 限制到指定范围，'advanced' 支持分段权重采样。
const S_TIMESTEP_SAMPLING_STRATEGY = [
  { key: 'timestep_sampling_mode', type: 'select', label: '时间步采样模式', desc: '时间步采样模式', defaultValue: 'disabled', options: [
    { value: 'disabled', label: 'Disabled (全范围均匀采样，传统训练)' },
    { value: 'simple', label: 'Simple (范围限制)' },
    { value: 'advanced', label: 'Advanced (分段权重采样)' },
  ] },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '最小时间步', defaultValue: 0, min: 0, max: 1000, step: 1, visibleWhen: (c) => c.timestep_sampling_mode === 'simple' },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '训练时采样的最大时间步（不包含）。', defaultValue: 1000, min: 0, max: 1000, step: 1, visibleWhen: (c) => c.timestep_sampling_mode === 'simple' },
  { key: 'timestep_segments', type: 'textarea', label: '分段配置', title: 'timestep_segments', desc: '时间步分段采样', defaultValue: '', placeholder: '例如: 0:300:0.2, 300:700:0.6, 700:1000:0.2', visibleWhen: (c) => c.timestep_sampling_mode === 'advanced' },
  // ── Anima Flow 时间步分布 (独立于上方的范围过滤) ──
  // 选项必须覆盖后端 anima/anima_flow.py 的全部分支（:131-:169）。原先只给 shift，
  // 导致 qwen_shift/ideogram4_shift/logsnr 三个真实模式选不到，而且下方
  // anima_sigmoid_scale 锚的 'sigmoid'、flow_logit_* 锚的 'logit_normal' 都是死锚。
  { key: 'timestep_sampling', type: 'select', label: '时间步采样分布', title: 'timestep_sampling', desc: '时间步采样策略', defaultValue: 'shift', options: [
    { value: 'shift', label: 'shift（推荐，sigmoid 偏置 + flow shift）' },
    { value: 'sigma', label: 'sigma（传统均匀，torch.rand）' },
    { value: 'uniform', label: 'uniform（均匀 linspace）' },
    { value: 'sigmoid', label: 'sigmoid（sigmoid 压缩）' },
    { value: 'logit_normal', label: 'logit_normal（Flux 风格）' },
    { value: 'flux_shift', label: 'flux_shift（Flux + dynamic shift）' },
    { value: 'qwen_shift', label: 'qwen_shift（Qwen 变体）' },
    { value: 'ideogram4_shift', label: 'ideogram4_shift（Ideogram 4 变体）' },
    { value: 'logsnr', label: 'logsnr（log-SNR 均匀）' },
  ] },
  { key: 'discrete_flow_shift', type: 'number', label: 'Flow Shift', title: 'discrete_flow_shift', desc: 'shift/sigmoid/flux_shift', defaultValue: 3.0, min: 0.1, max: 10.0, step: 0.1, visibleWhen: (c) => ['shift', 'sigmoid', 'flux_shift', 'qwen_shift', 'ideogram4_shift'].includes(c.timestep_sampling) },
  { key: 'anima_sigmoid_scale', type: 'number', label: 'Sigmoid Scale', title: 'anima_sigmoid_scale', desc: 'sigmoid 分布的压缩系数', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => ['sigmoid', 'shift'].includes(c.timestep_sampling) },
  { key: 'anima_weighting_scheme', type: 'select', label: 'Loss 加权方案', title: 'anima_weighting_scheme', desc: 'Loss 加权方案', defaultValue: '', options: [
    { value: '', label: '不加权 (none)' },
    { value: 'sigma_sqrt', label: 'sigma_sqrt（均衡高低噪声）' },
    { value: 'logit_normal', label: 'logit_normal（logit-normal 加权）' },
    { value: 'mode', label: 'mode（单峰）' },
    { value: 'cosmap', label: 'cosmap（余弦映射）' },
  ] },
  { key: 'flow_logit_mean', type: 'number', label: 'Logit Mean', title: 'flow_logit_mean', desc: 'logit_normal 分布的均值参数（logit', defaultValue: 0.0, min: -5.0, max: 5.0, step: 0.1, visibleWhen: (c) => c.timestep_sampling === 'logit_normal' || c.anima_weighting_scheme === 'logit_normal' },
  { key: 'flow_logit_std', type: 'number', label: 'Logit Std', title: 'flow_logit_std', desc: 'logit_normal 分布的标准差参数。', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => c.timestep_sampling === 'logit_normal' || c.anima_weighting_scheme === 'logit_normal' },
  // Smart Noise Scheduler（默认关闭）
  { key: 'smart_noise_enabled', type: 'boolean', label: 'Smart Noise Scheduler', title: 'smart_noise_enabled', desc: 'Smart Noise Scheduler', defaultValue: false },
  { key: 'smart_noise_logsnr_focus', type: 'number', label: 'Smart Noise 焦点 logSNR', title: 'smart_noise_logsnr_focus', desc: 'Smart Noise 焦点 logSNR', defaultValue: 0.0, min: -3.0, max: 3.0, step: 0.1, visibleWhen: (c) => c.smart_noise_enabled },
  { key: 'smart_noise_focus_strength', type: 'number', label: 'Smart Noise 聚焦强度', title: 'smart_noise_focus_strength', desc: 'Smart Noise 聚焦强度', defaultValue: 0.5, min: 0.0, max: 1.0, step: 0.05, visibleWhen: (c) => c.smart_noise_enabled },
  { key: 'smart_noise_focus_spread', type: 'number', label: 'Smart Noise 焦点宽度', title: 'smart_noise_focus_spread', desc: '焦点高斯分布的标准差（logSNR 单位）。', defaultValue: 2.0, min: 0.5, max: 5.0, step: 0.1, visibleWhen: (c) => c.smart_noise_enabled },
  // BP-low (Low-Resolution Backward，默认关闭)
  { key: 'bp_low_enabled', type: 'boolean', label: 'BP-low 低分辨率反传', title: 'bp_low_enabled', desc: '高噪声 timestep 使用低分辨率反传以节省显存（SDXL 约 37%', defaultValue: false },
  { key: 'bp_low_factor', type: 'number', label: 'BP-low 下采样倍数', title: 'bp_low_factor', desc: 'BP-low 下采样倍数', defaultValue: 2, min: 2, max: 4, step: 1, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_noise_threshold', type: 'number', label: 'BP-low 噪声阈值', title: 'bp_low_noise_threshold', desc: '触发低分辨率反传的 sigma 阈值。', defaultValue: 0.5, min: 0.1, max: 0.9, step: 0.05, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_schedule', type: 'select', label: 'BP-low 调度策略', title: 'bp_low_schedule', desc: 'BP-low 调度策略', defaultValue: 'step', options: [
    { value: 'step', label: 'step（阶跃）' },
    { value: 'cosine', label: 'cosine（余弦平滑）' },
  ], visibleWhen: (c) => c.bp_low_enabled },
];


// Anima 专属：JLT EMA 特征自蒸馏（非通用，仅 anima 路线）
const S_ANIMA_JLT_EMA = [
  { key: 'anima_ema_feat_align_enabled', type: 'boolean', label: 'JLT EMA 特征自蒸馏', desc: 'EMA-of-LoRA 影子 + 特征自蒸馏对齐。', defaultValue: false },
  { key: 'anima_ema_feat_align_weight', type: 'number', label: 'EMA 特征对齐权重', desc: '对齐损失权重', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.anima_ema_feat_align_enabled },
  { key: 'anima_ema_feat_align_teacher_layers', type: 'string', label: 'EMA Teacher 层', desc: '逗号分隔的 teacher 层索引，如 "9"。', defaultValue: '', visibleWhen: (c) => c.anima_ema_feat_align_enabled },
  { key: 'anima_ema_feat_align_student_layers', type: 'string', label: 'EMA Student 层', desc: '逗号分隔的 student 层索引，如 "4"', defaultValue: '', visibleWhen: (c) => c.anima_ema_feat_align_enabled },
  { key: 'anima_ema_feat_align_decay', type: 'number', label: 'EMA 衰减', desc: 'EMA-of-LoRA 影子衰减率。', defaultValue: 0.9999, min: 0, max: 0.99999, step: 0.0001, visibleWhen: (c) => c.anima_ema_feat_align_enabled },
];


// ── Phase C: 缓存系统配置（统一：内存/磁盘/格式/引擎）──
const _diskEnabled = (c) => c.cache_latents_to_disk || c.cache_text_encoder_outputs_to_disk;
const _losslessOff = (c) => _diskEnabled(c) && (c.lossless_cache_replacement_mode === 'off' || !c.lossless_cache_replacement_mode);
const _losslessOn  = (c) => _diskEnabled(c) && c.lossless_cache_replacement_mode && c.lossless_cache_replacement_mode !== 'off';
const S_CACHE_SYSTEM = [
  // ── 内存缓存开关 ──
  { key: 'cache_latents', type: 'boolean', label: '启用 Latent 内存缓存', desc: '缓存 VAE 编码后的 latent 张量', defaultValue: true },
  { key: 'cache_text_encoder_outputs', type: 'boolean', label: '启用文本编码器输出缓存', desc: '缓存文本编码器（Qwen3/T5）的输出。', defaultValue: false },
  // ── 磁盘持久化 ──
  { key: 'cache_latents_to_disk', type: 'boolean', label: 'Latent 缓存到磁盘', desc: '将 latent 缓存持久化到磁盘，跨训练 run', defaultValue: false },
  { key: 'cache_text_encoder_outputs_to_disk', type: 'boolean', label: '文本编码器输出缓存到磁盘', desc: '将文本编码器输出缓存到磁盘。适合长文本或大数据集。', defaultValue: false },
  // ── 缓存引擎后端（任一磁盘缓存开启时显示）──
  { key: 'lossless_cache_replacement_mode', type: 'select', label: '磁盘缓存引擎', desc: '布局/引擎：默认 off=每文件 per_file（npz/safetensors，原版路径）；anima_lynx_manifest_probe=整片 shard（少文件，HDD 友好，实验）；LXFS/SQLite 仅研究。已有 per_file 缓存不会静默删改，缺 shard 时 prepare 旁路生成或 fallback 读源。', defaultValue: 'off', options: [
    { value: 'off', label: '原版 per_file（npz / safetensors / pt）' },
    { value: 'anima_lynx_manifest_probe', label: 'LYNX 整片 shard（HDD / 实验）' },
    { value: 'anima_lxfs_probe', label: 'LXFS 扁片 sidecar（实验）' },
    { value: 'anima_sqlite_bin_probe', label: 'SQLite manifest 索引（实验）' },
  ], visibleWhen: _diskEnabled },
  // ── 原版分支：格式与精度（引擎=原版时显示）──
  { key: 'latent_cache_disk_format', type: 'select', label: 'Latent 磁盘格式', desc: 'Latent 缓存文件格式', defaultValue: 'npz', options: [
    { value: 'npz', label: 'NPZ (NumPy 压缩)' },
    { value: 'safetensors', label: 'SafeTensors' },
    { value: 'pt', label: 'PyTorch (.pt)' },
  ], visibleWhen: (c) => _losslessOff(c) && c.cache_latents_to_disk },
  { key: 'latent_cache_disk_dtype', type: 'select', label: 'Latent 磁盘精度', desc: 'Latent 缓存精度', defaultValue: 'float16', options: [
    { value: 'float16', label: 'Float16 (半精度)' },
    { value: 'bfloat16', label: 'BFloat16' },
    { value: 'float32', label: 'Float32 (全精度)' },
  ], visibleWhen: (c) => _losslessOff(c) && c.cache_latents_to_disk },
  { key: 'text_encoder_outputs_cache_disk_format', type: 'select', label: '文本编码器输出磁盘格式', desc: '文本编码器输出缓存文件格式', defaultValue: 'npz', options: [
    { value: 'npz', label: 'NPZ (NumPy 压缩)' },
    { value: 'safetensors', label: 'SafeTensors' },
    { value: 'pt', label: 'PyTorch (.pt)' },
  ], visibleWhen: (c) => _losslessOff(c) && c.cache_text_encoder_outputs_to_disk },
  { key: 'text_encoder_outputs_cache_disk_dtype', type: 'select', label: '文本编码器输出磁盘精度', desc: '文本编码器输出缓存精度', defaultValue: 'float16', options: [
    { value: 'float16', label: 'Float16 (半精度)' },
    { value: 'bfloat16', label: 'BFloat16' },
    { value: 'float32', label: 'Float32 (全精度)' },
  ], visibleWhen: (c) => _losslessOff(c) && c.cache_text_encoder_outputs_to_disk },
  { key: 'disable_mmap_load_safetensors', type: 'boolean', label: '禁用 mmap 加载', desc: '禁用 mmap 方式加载 safetensors', defaultValue: false, visibleWhen: (c) => _losslessOff(c) && c.latent_cache_disk_format === 'safetensors' },
  // ── Lossless 引擎分支（引擎!=原版时显示）──
  { key: 'lossless_cache_replacement_codecs', type: 'select', label: '压缩编码', desc: '默认单 codec lz4fast（速度优先）。zstd1=压缩率优先，raw=不压缩，fast-cache=多 codec 研究矩阵，显式选择才会试探。', defaultValue: 'lz4fast', options: [{ value: 'lz4fast', label: 'lz4fast（默认）' }, { value: 'zstd1', label: 'zstd1（压缩率优先）' }, { value: 'raw', label: 'raw' }, { value: 'fast-cache', label: 'fast-cache（多 codec 研究）' }], visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_prefetch_depth', type: 'number', label: '预取深度', desc: 'prefetch_thread 预取队列深度。', defaultValue: 2, min: 1, step: 1, visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_read_mode', type: 'select', label: '读取模式', desc: 'prefetch_thread=后台线程预取（默认）', defaultValue: 'prefetch_thread', options: [{ value: 'prefetch_thread', label: 'prefetch_thread' }, { value: 'sync', label: 'sync' }], visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_fallback_to_raw', type: 'boolean', label: '损坏自动回退', desc: 'sidecar 缺失/损坏时回退原版 npz', defaultValue: true, visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_strict', type: 'boolean', label: '读取时校验 CRC32', desc: '验证 shard 字节完整性；fingerprint 不匹配时自动重建缓存', defaultValue: true, visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_decoded_payload_cache', type: 'boolean', label: '解码载荷驻留内存', desc: '将解码后的 latent 载荷驻留在 CPU 内存，减少重复磁盘 IO', defaultValue: false, visibleWhen: _losslessOn },
  { key: 'lossless_cache_replacement_decoded_payload_cache_max_bytes', type: 'number', label: '内存载荷池上限 (bytes)', desc: '0 = 不限制；设置上限可防止 OOM。', defaultValue: 0, min: 0, step: 536870912, visibleWhen: (c) => _losslessOn(c) && c.lossless_cache_replacement_decoded_payload_cache },
];

// ── Phase C: Anima 高级配置 ──
const S_ANIMA_ADVANCED = [
  // 模块族勾选：关掉 = 真正不注入 LoRA（与下方「分组 LR」不同；LR=0 仍可能注入）。
  // 默认全开 + llm_adapter 仍走独立门闩，保持与历史默认 target 集一致。
  { key: 'anima_train_self_attn', type: 'boolean', label: '训练 Self-Attention', desc: '是否把 Self-Attn（q/k/v/out）注入 LoRA。关闭后该族完全不参与训练（不是把学习率设为 0）。', defaultValue: true },
  { key: 'anima_train_cross_attn', type: 'boolean', label: '训练 Cross-Attention', desc: '是否把 Cross-Attn 注入 LoRA。关 = 不注入，与「Cross-Attn 学习率」可叠加理解。', defaultValue: true },
  { key: 'anima_train_mlp', type: 'boolean', label: '训练 MLP', desc: '是否把 MLP（layer1/layer2）注入 LoRA。', defaultValue: true },
  { key: 'anima_train_adaln', type: 'boolean', label: '训练 AdaLN Modulation', desc: '是否把 adaln_modulation_* 注入 LoRA。常用于角色/风格层权重。', defaultValue: true },
  { key: 'anima_lora_target_groups', type: 'text', label: 'LoRA 目标模块族（高级）', desc: '可选：逗号分隔覆盖勾选，如 self_attn,cross_attn,mlp,adaln_modulation。留空则用上方勾选；全默认 = 历史全集。', defaultValue: '' },
  { key: 'anima_self_attn_lr', type: 'number', label: 'Self-Attention 学习率', desc: 'Anima DiT Self-Attention 层的独立学习率。', defaultValue: 0, min: 0, step: 1e-6 },
  { key: 'anima_cross_attn_lr', type: 'number', label: 'Cross-Attention 学习率', desc: 'Anima DiT Cross-Attention', defaultValue: 0, min: 0, step: 1e-6 },
  { key: 'anima_mlp_lr', type: 'number', label: 'MLP 学习率', desc: 'Anima DiT MLP（前馈网络）层的独立学习率。', defaultValue: 0, min: 0, step: 1e-6 },
  { key: 'anima_mod_lr', type: 'number', label: 'Modulation 学习率', desc: 'Anima DiT Modulation', defaultValue: 0, min: 0, step: 1e-6 },
  { key: 'anima_llm_adapter_lr', type: 'number', label: 'LLM Adapter 学习率', desc: 'Anima LLM Adapter 的独立学习率。', defaultValue: 0, min: 0, step: 1e-6 },
  { key: 'anima_train_llm_adapter', type: 'boolean', label: '训练 LLM Adapter', desc: '是否训练 Anima LLM Adapter。开启后额外注入 llm_adapter 目标。', defaultValue: false },
  { key: 'anima_fixed_text_tokens', type: 'number', label: '固定文本 Token 长度', desc: '固定文本 Token 长度', defaultValue: 0, min: 0, step: 64 },
  { key: 'anima_fixed_qwen3_tokens', type: 'number', label: '固定 Qwen3 Token 长度', desc: '0 = 动态长度；仅约束 Qwen3 hidden states。', defaultValue: 0, min: 0, step: 64 },
  { key: 'anima_fixed_t5_tokens', type: 'number', label: '固定 T5 Token 长度', desc: '0 = 动态长度；仅约束 T5 token ids。', defaultValue: 0, min: 0, step: 64 },
  { key: 'anima_fixed_visual_tokens', type: 'number', label: '固定视觉 Token 长度', desc: '0 = 保持缓存大小（默认）', defaultValue: 0, min: 0, step: 64 },
  { key: 'anima_fused_qkv', type: 'boolean', label: '融合 QKV 投影', desc: '融合 Anima DiT Self-Attention 的 Q/K/V', defaultValue: false },
];


// ---- Anima 概念编辑(iLECO / ADDifT / Multi-ADDifT)字段与 section 模板 ----
const animaConceptEditModelFields = (typeId) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  {
    key: 'anima_auto_scan_folder',
    type: 'action',
    label: '智能识别模型文件夹',
    desc: '选择 Anima 模型根目录，自动识别并填充 DiT / VAE /',
    buttonLabel: '选择文件夹并识别',
    handler: 'openAnimaFolderScanner',
  },
  { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Anima DiT 权重路径', title: 'pretrained_model_name_or_path', desc: 'Anima 主 DiT 权重；支持 BF16 与 Bedovyy/Comfy INT8（int8rowwise/int8convrot）。INT8 包训练前会 dequant 成 dense，训练显存≈BF16（省磁盘，非 keep-I8，非 Comfy 原生加速）', defaultValue: '' },
  { key: 'vae', type: 'file', pickerType: 'model-file', label: 'Qwen Image VAE 路径', title: 'vae', desc: 'Anima 概念编辑需要的 VAE 路径', defaultValue: '' },
  { key: 'qwen3', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'Qwen3 文本模型路径', title: 'qwen3', desc: 'Qwen3 文本模型路径。可填写单文件或本地模型目录', defaultValue: '' },
  { key: 'llm_adapter_path', type: 'file', pickerType: 'model-file', label: 'LLM Adapter 路径', title: 'llm_adapter_path', desc: '单独的 LLM Adapter 权重路径（可选）', defaultValue: '' },
  { key: 't5_tokenizer_path', type: 'folder', pickerType: 'folder', label: 'T5 tokenizer 目录', title: 't5_tokenizer_path', desc: '可选。留空时回退到项目内置 tokenizer', defaultValue: '' },
  { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有的概念编辑 LoRA / DoRA / T-LoRA 模型继续训练', defaultValue: '' },
  { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从某个 save_state 保存的中断状态继续训练，选择 save-state 目录', defaultValue: '' },
  {
    key: 'lora_meta_reader',
    type: 'action',
    label: 'LoRA 权重元数据读取',
    desc: '读取现有 LoRA 文件的训练参数元数据（network_dim',
    buttonLabel: '选择 LoRA 文件并读取',
    handler: 'openLoraMetaReader',
  },
];

const animaConceptEditNetworkFields = [
  { key: 'lora_type', type: 'select', label: '适配器类型', title: 'lora_type', desc: 'Anima 概念编辑当前支持原生 LoRA / DoRA / LoRA+ /', defaultValue: 'lora', options: NATIVE_ADAPTER_TYPES },
  { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: '网络维度，常用 4~64。概念编辑通常不需要太大 rank。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '常用值：等于 network_dim 或更小。', defaultValue: 16, min: 1, max: 256, step: 1 },
  { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已有 network_weights 自动推断 rank / dim', defaultValue: false },
  { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '最大范数正则化。如果使用，推荐从 1 附近开始', defaultValue: '', min: 0, step: 0.01 },
  { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '额外训练带可学习参数的归一化层', defaultValue: false },
  { key: 'dora_wd', type: 'boolean', label: '启用 DoRA', title: 'dora_wd', desc: '仅在 Anima 原生 LoRA 路线下生效。', defaultValue: false, visibleWhen: when('lora_type', 'lora') },
  { key: 'bypass_mode', type: 'boolean', label: 'Bypass Mode', title: 'bypass_mode', desc: 'Bypass Mode', defaultValue: false, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：默认 LoRA / PiSSA /', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: 'auto 会在最终保存时导出成可加载到原始底模的 LoRA', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && nativeLoraInitSelected(c) },
  { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 首版使用 fake-quant/dequant 权重残差初始化', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: 'rowwise 按输出通道量化，tensorwise 按整层张量量化。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
  { key: 'network_dropout', type: 'number', label: 'Dropout', title: 'network_dropout', desc: '原生 LoRA / LoRA-FA / VeRA / T-LoRA /', defaultValue: 0, min: 0, step: 0.01, visibleWhen: (c) => ['lora', 'dora', 'lora_plus', 'rs_lora', 'lora_fa', 'vera', 'tlora', 'flexrank', 'hydralora', 'fera', 'gdlokr', ...LYCORIS_DELTA_ALGOS].includes(c.lora_type) },
  { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 每步随机采样激活 rank 的下界', defaultValue: 1, min: 1, visibleWhen: when('lora_type', 'flexrank') },
  { key: 'tlora_min_rank', type: 'number', label: 'T-LoRA 最小 Rank', title: 'tlora_min_rank', desc: 'T-LoRA 最小动态 rank', defaultValue: 1, min: 1, visibleWhen: when('lora_type', 'tlora') },
  { key: 'tlora_rank_schedule', type: 'select', label: 'T-LoRA Rank 调度', title: 'tlora_rank_schedule', desc: 'T-LoRA 动态 rank 调度策略', defaultValue: 'cosine', options: ['cosine', 'linear'], visibleWhen: when('lora_type', 'tlora') },
  { key: 'tlora_orthogonal_init', type: 'boolean', label: 'T-LoRA 正交初始化', title: 'tlora_orthogonal_init', desc: '对 lora_down 使用正交初始化（）', defaultValue: false, visibleWhen: when('lora_type', 'tlora') },
  { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: 'LoKr 分解因子', defaultValue: 8, min: -1, visibleWhen: when('lora_type', 'lokr') },
  { key: 'pissa_init', type: 'boolean', label: '启用 PiSSA 初始化', title: 'pissa_init', desc: '产品入口：开启后映射', defaultValue: false, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'pissa_enabled', type: 'boolean', label: 'PiSSA 后端 master', title: 'pissa_enabled', desc: '后端 injector 主开关', defaultValue: false, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
  { key: 'pissa_method', type: 'select', label: 'PiSSA 分解方式', title: 'pissa_method', desc: '推荐保持 rSVD 默认值', defaultValue: 'rsvd', options: ['rsvd', 'svd'], visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_niter', type: 'number', label: 'PiSSA 幂迭代次数', title: 'pissa_niter', desc: 'PiSSA rSVD 幂迭代次数（高级参数）', defaultValue: 2, min: 0, step: 1, visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_init_iters', type: 'number', label: 'PiSSA 初始化迭代', title: 'pissa_init_iters', desc: '后端 pissa_init_iters', defaultValue: 1, min: 0, step: 1, visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_svd_algo', type: 'select', label: 'PiSSA SVD 算法', title: 'pissa_svd_algo', desc: 'rsvd / svd', defaultValue: 'rsvd', options: ['rsvd', 'svd'], visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_oversample', type: 'number', label: 'PiSSA 过采样维度', title: 'pissa_oversample', desc: 'PiSSA rSVD 过采样维度（高级参数）', defaultValue: 8, min: 0, step: 1, visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_apply_conv2d', type: 'boolean', label: 'PiSSA 作用于 Conv', title: 'pissa_apply_conv2d', desc: 'PiSSA 额外作用于 1x1 Conv（）', defaultValue: false, visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_export_mode', type: 'select', label: 'PiSSA 导出模式', title: 'pissa_export_mode', desc: 'PiSSA 模型保存为标准 LoRA 时的导出方式', defaultValue: 'lora_compatible', options: [
    { value: 'lora_compatible', label: 'lora_compatible（无损兼容）' },
    { value: 'approximate', label: 'approximate（快速近似）' },
    { value: 'raw', label: 'raw' },
    { value: 'auto', label: 'auto' },
  ], visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'pissa_cache_mode', type: 'select', label: 'PiSSA 缓存模式', title: 'pissa_cache_mode', desc: 'INIT_LORA 等；对齐后端 PissaCacheMode。', defaultValue: 'INIT_LORA', options: [
    { value: 'INIT_LORA', label: 'INIT_LORA' },
    { value: 'NONE', label: 'NONE' },
  ], visibleWhen: all(when('lora_type', 'lora'), pissaInitSelected) },
  { key: 'enable_base_weight', type: 'boolean', label: '启用基础权重', title: 'enable_base_weight', desc: '启用基础权重（差异炼丹）', defaultValue: false },
  { key: 'base_weights', type: 'textarea', label: '基础权重路径', title: 'base_weights', desc: '合并入底模的 LoRA 路径，一行一个路径', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'base_weights_multiplier', type: 'textarea', label: '基础权重比例', title: 'base_weights_multiplier', desc: '合并入底模的 LoRA 权重，一行一个数字', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数。', defaultValue: '' },
];

const animaConceptEditTrainingFields = (defaults = {}) => [
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: 'Anima 概念编辑首版先按固定分辨率处理，建议保持', defaultValue: defaults.resolution || '1024,1024' },
  { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: 'Anima 概念编辑首版优先按 step 控制训练长度。', defaultValue: defaults.maxTrainSteps || 500, min: 1 },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '概念编辑建议从小 batch 开始。', defaultValue: defaults.batchSize || 1, min: 1, max: 8, step: 1 },
  ditGradientCheckpointingField('Anima'),
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '每 N 次 microbatch 才执行一次', defaultValue: 1, min: 1 },
  { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: 'fast（默认）：仅在 optimizer.', defaultValue: 'fast', options: [
    { value: 'fast', label: 'fast' },
    // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
    // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
    { value: 'classic', label: 'classic（逐 microbatch 检查）' }
  ], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
  { key: 'network_train_unet_only', type: 'boolean', label: '仅训练 DiT', title: 'network_train_unet_only', desc: 'Anima 概念编辑当前只支持 DiT-only 路线。', defaultValue: true },
  { key: 'network_train_text_encoder_only', type: 'boolean', label: '仅训练文本编码器', title: 'network_train_text_encoder_only', desc: 'Anima 概念编辑当前不支持单独训练文本编码器。请保持关闭。', defaultValue: false },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '动作/配件类差分常见 500；风格类常见 200。', defaultValue: defaults.minTimestep ?? '', min: 0 },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '动作/配件类差分常见 1000；风格类常见 400。', defaultValue: defaults.maxTimestep ?? '', min: 1 },
  { key: 'concept_edit_fixed_timestep_per_batch', type: 'boolean', label: '批内固定时间步', title: 'concept_edit_fixed_timestep_per_batch', desc: '同一 batch 内共享同一个 timestep', defaultValue: false },
  { key: 'concept_edit_diff_alt_ratio', type: 'number', label: '差分交替倍率', title: 'concept_edit_diff_alt_ratio', desc: 'ADDifT 交替差分倍率', defaultValue: 1, step: 0.1, visibleWhen: (c) => ['addift', 'multi-addift'].includes(String(c.concept_edit_method || c.concept_edit_mode || '').toLowerCase()) },
  { key: 'concept_edit_use_diff_mask', type: 'boolean', label: '启用差分掩码', title: 'concept_edit_use_diff_mask', desc: 'ADDifT / Multi-ADDifT 可按原图', defaultValue: false, visibleWhen: (c) => ['addift', 'multi-addift'].includes(String(c.concept_edit_method || c.concept_edit_mode || '').toLowerCase()) },
];

const animaConceptEditSections = ({ typeId, mode, maxTrainSteps, minTimestep = '', maxTimestep = '' }) => [
  sec('model-settings', 'model', '训练用模型', 'Anima 概念编辑底模、Qwen3/T5 组件与恢复训练。', animaConceptEditModelFields(typeId)),
  sec('anima-params', 'model', 'Anima 专用参数', 'Anima 概念编辑会沿用自身的 flow/noise/prompt 编码链路。', [
    ...flowParams({ ts: 'shift', dfs: 3.0, tsExtra: ['logit_normal'] }),
    { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 最大 token 长度', defaultValue: 512, min: 1 },
    { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 最大 token 长度', defaultValue: 512, min: 1 },
    { key: 'attn_mode', type: 'select', label: 'Attention 实现', title: 'attn_mode', desc: '默认自动：跟随启动器 runtime 的默认', defaultValue: '', attentionBackendOptions: true, options: [
      { value: '', label: '自动（跟随启动环境）' },
      { value: 'torch', label: 'Torch' },
      { value: 'sdpa', label: 'SDPA' },
      { value: 'xformers', label: 'xFormers' },
      { value: 'sageattn', label: 'SageAttention' },
      { value: 'flash', label: 'FlashAttention 2' },
    ] },
    { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '拆分 attention 以节省显存。', defaultValue: false },
    { key: 'vae_chunk_size', type: 'number', label: 'VAE 分块大小', title: 'vae_chunk_size', desc: 'VAE 编码/解码分块大小（需为偶数）', defaultValue: '', min: 2 },
  ]),
  sec('save-settings', 'model', '保存设置', '输出路径、格式与训练状态。', [...S_SAVE]),
  sec('concept-settings', 'dataset', '概念编辑输入', '这里定义原始概念、目标概念，以及 ADDifT / Multi-ADDifT 需要的图像或配对目录。', conceptEditIdeaFields(mode)),
  sec('network-settings', 'network', '网络设置', 'Anima 概念编辑支持原生 LoRA / DoRA / VeRA / T-LoRA / LoKr。', animaConceptEditNetworkFields),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '学习率、调度器与优化器。概念编辑建议先从稳定路线开始。', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', 'Anima 概念编辑首版优先按 step 控制训练时长。', animaConceptEditTrainingFields({ resolution: '1024,1024', maxTrainSteps, minTimestep, maxTimestep })),
  sec('preview-settings', 'preview', '预览图设置', '可选。Anima 概念编辑也可以沿用普通训练预览。', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '混合精度、缓存与注意力后端。', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  // min_timestep / max_timestep 与上面 training-settings 的 animaConceptEditTrainingFields 重叠；
  // S_NOISE 里那份默认值是空串，且渲染顺序在后，会把 ADDifT 传进来的 minTimestep=500 盖成空串
  // （createDefaultConfig 是无条件覆盖，最后渲染的赢）。概念编辑的时间步范围归 training-settings 管。
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与辅助损失设置。',
    S_NOISE.filter((f) => !['min_timestep', 'max_timestep'].includes(f.key))),
  sec('advanced-settings', 'advanced', '其他设置', '噪声、种子与其它选项。', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', 'Anima 概念编辑首版不建议多机多卡；这里仍保留通用入口。', [...S_DISTRIBUTED]),
];

// ---- Anima LoRA ----
// Anima LoRA 推荐 AdamW：optimizer_backend=auto 会解析为单内核 fused 发射，消除
// bnb AdamW8bit 逐参数微内核在优化器阶段造成的 GPU 空泡（参考实测步时约降 25%）。
// 仅覆盖 anima-lora 的默认值与文案，公共 S_LR_TARGET（sdxl 等共享）保持不变。
const S_LR_ANIMA_LORA = S_LR_TARGET_DIT.map((field) => field.key === 'optimizer_type'
  ? { ...field, defaultValue: 'AdamW', desc: `${field.desc}。Anima LoRA 推荐 AdamW` }
  : field);

export const ANIMA_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Anima 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'anima-lora' },
    {
      key: 'anima_auto_scan_folder',
      type: 'action',
      label: '智能识别模型文件夹',
      desc: '选择 Anima 模型根目录，自动识别并填充 DiT / VAE /',
      buttonLabel: '选择文件夹并识别',
      handler: 'openAnimaFolderScanner',
    },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Anima DiT 权重路径', title: 'pretrained_model_name_or_path', desc: 'Anima 主 DiT 权重；支持 BF16 与 Bedovyy/Comfy INT8（int8rowwise/int8convrot）。INT8 包训练前会 dequant 成 dense，训练显存≈BF16（省磁盘，非 keep-I8，非 Comfy 原生加速）', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'Qwen Image VAE 路径', title: 'vae', desc: 'Qwen Image VAE 路径', defaultValue: '' },
    { key: 'qwen3', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'Qwen3 文本模型路径', title: 'qwen3', desc: 'Qwen3 文本模型文件或本地模型目录', defaultValue: '' },
    { key: 'llm_adapter_path', type: 'file', pickerType: 'model-file', label: 'LLM Adapter 路径', title: 'llm_adapter_path', desc: 'LLM Adapter 路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有的 LoRA 模型上继续训练，填写路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从某个 save_state 保存的中断状态继续训练，选择 save-state 目录', defaultValue: '' },
  ]),
  sec('anima-params', 'model', 'Anima 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 3.0, tsExtra: ['logit_normal'] }),
    { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 最大 token 长度', defaultValue: 512, min: 1 },
    { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数', defaultValue: '', step: 0.01 },
    { key: 'flow_uncertainty_weighting_enabled', type: 'boolean', label: 'EDM2 自适应损失权重', title: 'flow_uncertainty_weighting_enabled', desc: '学习一个按 sigma 的不确定度 u(σ)，损失变为 loss', defaultValue: false },
    { key: 'flow_uncertainty_weighting_lr', type: 'number', label: 'EDM2 学习率', title: 'flow_uncertainty_weighting_lr', desc: 'EDM2 不确定度参数的学习率', defaultValue: 0.01, min: 0, max: 1, step: 0.001, visibleWhen: (c) => c.flow_uncertainty_weighting_enabled },
    { key: 'flow_uncertainty_weighting_channels', type: 'number', label: 'EDM2 通道数', title: 'flow_uncertainty_weighting_channels', desc: 'EDM2 Fourier 特征库大小。', defaultValue: 128, min: 32, max: 512, step: 32, visibleWhen: (c) => c.flow_uncertainty_weighting_enabled },
    { key: 'anima_guidance_scale', type: 'number', label: 'CFG 引导强度', title: 'anima_guidance_scale', desc: 'Classifier-Free Guidance 强度。', defaultValue: 1.0, min: 1, max: 10, step: 0.1 },
    { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 最大 token 长度', defaultValue: 512, min: 1 },
    { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '拆分 attention 以节省显存', defaultValue: false },
    { key: 'vae_chunk_size', type: 'number', label: 'VAE 分块大小', title: 'vae_chunk_size', desc: 'VAE 解码时的分块大小，更小值更省显存', defaultValue: '', min: 2 },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', 'LoRA / T-LoRA / LoKr 模式。', [
    { key: 'lora_type', type: 'select', label: '适配器类型', title: 'lora_type', desc: 'LoRA 是基础路线', defaultValue: 'lora', options: NATIVE_ADAPTER_TYPES },
    { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: '网络维度', defaultValue: 16, min: 1, max: 256, step: 1 },
    { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '网络 Alpha', defaultValue: 16, min: 1, max: 256, step: 1 },
    { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已有 network_weights 自动推断 rank / dim', defaultValue: false },
    { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '最大范数正则化。如果使用，推荐为 1', defaultValue: '', min: 0, step: 0.01 },
    { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '训练 Norm 层', defaultValue: false },
    { key: 'anima_train_llm_adapter', type: 'boolean', label: '训练 LLM Adapter', title: 'anima_train_llm_adapter', desc: '普通 Anima LoRA 更接近低显存参考路径', defaultValue: false },
    { key: 'dora_wd', type: 'boolean', label: '启用 DoRA', title: 'dora_wd', desc: '仅在 Anima 原生 LoRA 路线下生效。', defaultValue: false, visibleWhen: when('lora_type', 'lora') },
    { key: 'bypass_mode', type: 'boolean', label: 'Bypass Mode', title: 'bypass_mode', desc: 'Bypass Mode', defaultValue: false, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
    { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：默认 LoRA / PiSSA /', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && !doraEnabled(c) },
    { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: 'auto 会在最终保存时导出成可加载到原始底模的 LoRA', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: (c) => c.lora_type === 'lora' && nativeLoraInitSelected(c) },
    { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 首版使用 fake-quant/dequant 权重残差初始化', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
    { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: 'rowwise 按输出通道量化，tensorwise 按整层张量量化。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('lora_type', 'lora'), loftqInitSelected) },
    { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: 'LoKr 系数，常用 4~无穷（-1 为无穷）', defaultValue: 8, min: -1, visibleWhen: when('lora_type', 'lokr') },
    { key: 'network_dropout', type: 'number', label: 'Dropout', desc: 'Dropout 概率', defaultValue: 0, min: 0, step: 0.01, visibleWhen: (c) => ['lora', 'dora', 'lora_plus', 'rs_lora', 'lora_fa', 'vera', 'tlora', 'flexrank', 'hydralora', 'fera', 'gdlokr', ...LYCORIS_DELTA_ALGOS].includes(c.lora_type) },
    { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 每步随机采样激活 rank 的下界', defaultValue: 1, min: 1, visibleWhen: when('lora_type', 'flexrank') },
    { key: 'tlora_min_rank', type: 'number', label: 'T-LoRA 最小 Rank', title: 'tlora_min_rank', desc: 'T-LoRA 最小动态 rank', defaultValue: 1, min: 1, visibleWhen: when('lora_type', 'tlora') },
    { key: 'tlora_rank_schedule', type: 'select', label: 'T-LoRA Rank 调度', title: 'tlora_rank_schedule', desc: 'T-LoRA 动态 rank 调度策略', defaultValue: 'cosine', options: ['cosine', 'linear'], visibleWhen: when('lora_type', 'tlora') },
    { key: 'tlora_orthogonal_init', type: 'boolean', label: 'T-LoRA 正交初始化', title: 'tlora_orthogonal_init', desc: '对 lora_down 使用正交初始化（）', defaultValue: false, visibleWhen: when('lora_type', 'tlora') },
    { key: 'pissa_init', type: 'boolean', label: '启用 PiSSA 初始化', title: 'pissa_init', desc: '启用 PiSSA 初始化（，仅 LoRA 类型下生效）', defaultValue: false, visibleWhen: when('lora_type', 'lora') },
    { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数。', defaultValue: '' },
    ...S_LORA_VARIANTS,
  ]),
  sec('fg-lora-settings', 'network', 'FG-LoRA / 选择性注入', '选择性训练重要的层，减少参数量或重分配 rank。默认 all=训练所有层。', [...S_ADAPTER_TARGET_POLICY]),
  sec('layered-alpha-settings', 'network', '分层 Alpha', '按模块类型分别设置 LoRA alpha。关闭= 全局统一 = 传统 LoRA。', [...S_LAYERED_ALPHA]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_ANIMA_LORA]),
  sec('training-settings', 'training', '训练参数', '', [...ditTrainFields(S_TRAIN(10), 'Anima'), ...S_ANIMA_FAITHFUL_FORWARD]),
  sec('negative-semantic-regularization', 'frontier', '负面语义正则', '用负面提示词约束 LoRA 在不希望语义上的增量。', [...S_NEGATIVE_SEMANTIC_REGULARIZATION]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL, ...S_ANIMA_INFERENCE_ACCEL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...VRAM_AUTO_ENHANCE_FIELDS, ...ANIMA_BLOCK_RESIDENCY_FIELDS, ...S_DIT_PERFORMANCE_EXPERT, ...S_SPEED_FLOW.filter((f) => !new Set([
    'cache_latents', 'cache_latents_to_disk', 'latent_cache_disk_format', 'latent_cache_disk_dtype',
    'cache_text_encoder_outputs', 'cache_text_encoder_outputs_to_disk',
    'text_encoder_outputs_cache_disk_format', 'text_encoder_outputs_cache_disk_dtype',
    'disable_mmap_load_safetensors', 'torch_compile', 'dynamo_backend',
    // 与上面 S_DIT_PERFORMANCE_EXPERT 重叠；不排除会在同一段里渲染两次，
    // 且 flow 版的 window 默认值会盖掉 expert 版。
    'acceleration_profile',
    'experimental_attention_profile_enabled', 'experimental_attention_profile_window',
  ]).has(f.key))]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  // min_timestep / max_timestep 归下面的 timestep-sampling-settings 管（那份带 timestep_sampling_mode
  // 门控，是后端真正读得到的一套）。S_NOISE 里那份是空串且渲染在前，留着只会在 UI 上重复出现两次。
  sec('noise-settings', 'training', '噪声设置', '噪声偏移与多分辨率噪声。',
    S_NOISE.filter((f) => !['min_timestep', 'max_timestep'].includes(f.key))),
  sec('timestep-sampling-settings', 'training', '时间步采样策略', '控制训练时采样哪些时间步。可用于集中训练特定噪声阶段。', [...S_TIMESTEP_SAMPLING_STRATEGY]),
  // 画质：质量包 + Pattern + 感知锚/频域 + Wavelet（从 safeguard 拆入质量叙事）
  sec('quality-pack-settings', 'frontier', '图像质量与感知损失', '线稿/DCT/Gram/困难样本/多尺度监督 + Pattern Loss + 感知锚/频域纹理 + Wavelet。', [...S_QUALITY_OPTIMIZATION_PACK, ...S_PATTERN_LOSS, ...S_PERCEPTUAL_ANCHOR_LOSS, ...S_WAVELET_LOSS]),
  // 块跳过：固定 BlockSkip + Adaptive Caching 同组
  sec('dit-block-skip', 'frontier', 'DiT 块跳过', '固定计划 BlockSkip 与 Adaptive Caching（Aircon）智能跳过。', [...S_DIT_BLOCKSKIP, ...S_ADAPTIVE_CACHING], { expert: true }),
  // σ 深度调度：按 RF σ 条件化本步 DiT 深度（非 LR/数据调度；与 Aircon 正交）
  sec('sigma-depth-schedule', 'frontier', 'σ 深度调度', '按当前样本 RF σ 调度本步 DiT 计算深度；identity 跳过不断 grad。', [...S_SIGMA_DEPTH_SCHEDULE], { expert: true }),
  // 采样与优化：tab 从 optimizer 挪到 training
  sec('sampling-optimization', 'training', '采样与优化', 'ANT / BP-low / 蒸馏(DP-DMD·AnyFlow) / TwinFlow(RCGM) / DOP / Coreset 等。蒸馏与 TwinFlow 会变慢更吃显存，', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('concept-geometry-settings', 'training', 'Concept Geometry', '概念几何采样与 prep 侧 embedding/翻译。可配合几何图或预处理流水线。', [...S_CONCEPT_GEOMETRY], { expert: true }),
  sec('ip-adapter-settings', 'network', 'IP-Adapter', '图像条件注入。', [...S_IP_ADAPTER], { expert: true }),
  sec('easycontrol-settings', 'network', 'EasyControl', 'v2 双流条件 + legacy EasyControl。', [...S_EASYCONTROL], { expert: true }),
  sec('pixel-space-settings', 'training', '像素空间训练', '绕过 VAE 的像素监督。', [...S_PIXEL_SPACE], { expert: true }),
  sec('dpo-settings', 'training', 'DPO 偏好对齐', 'Diffusion-DPO。需 dpo_weight>0 才进 loss。无真 pair 时自构造 rejected（弱代理）。', [...S_DPO], { expert: true }),
  // 表征对齐：经典 REPA + SoftREPA + ReFT/LISA/PCGrad + JLT + SRA2
  sec('representation-alignment', 'frontier', '表征对齐', 'REPA / LayerSync / JLT EMA / SRA2。全部REPA 税高；LayerSync 无外挂但可能略增激活显存，非顶部加速。', [...S_REPA_RESERVE, ...S_LAYERSYNC, ...S_ANIMA_JLT_EMA, ...S_SRA2_HASTE], { expert: true }),
  sec('experimental-probes', 'frontier', '实验探测', '探针/诊断开关。', [...S_EXPERIMENTAL_PROBES, ...S_SAMPLE_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控/统计/深度诊断/逐层监测/profiling。', [...S_DIAGNOSTICS_MONITORING]),
  sec('autocontroller-settings', 'optimizer', 'AutoController (自动控制器)', '高级功能。根据训练状态自动调整学习率、早停、TE 冻结等。适合长时间无人值守训练。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('lulynx-settings', 'frontier', 'Lulynx 核心 (Anima)', 'SafeGuard、EMA、ResourceManager、SmartRank、AutoController。', S_LULYNX_SDXL.filter((f) => !new Set([
    'lulynx_ema_enabled', 'lulynx_ema_decay',
    'lulynx_safeguard_enabled', 'lulynx_safeguard_nan_check_interval', 'lulynx_safeguard_gradient_scan_mode',
    'lulynx_safeguard_max_nan_count', 'lulynx_safeguard_loss_spike_threshold',
    'lulynx_safeguard_loss_window_size', 'lulynx_safeguard_auto_reduce_lr', 'lulynx_safeguard_lr_reduction_factor',
    'lulynx_auto_controller_enabled', 'lulynx_auto_check_every', 'lulynx_auto_early_stop_patience',
  ]).has(f.key))),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', '由顶栏 TurboCore 开关启用（）。本页为高级参数：工作空间、预取深度、模式/profile 等；调优结果可缓存复用。', [...S_TURBOCORE], { expert: true }),
  sec('memory-offload-settings', 'speed', '内存与 Offload',
    '顺序 CPU offload、module_offload 完整面、checkpointing pool 与 VAE slice/tile；含极端内存模式（磁盘换内存，给小内存机器）。',
    [...S_MEMORY_OFFLOAD], { expert: true }),
    sec('quantization-settings', 'speed', '量化 / QLoRA', '底模量化加载与 bnb 4bit。', [...S_QUANTIZATION], { expert: true }),
  sec('turbo-lora-settings', 'speed', 'TurboLoRA Phase-1', '当前仅提供 default-off 草稿初始化与 detached teacher packet CPU 契约；主训练蒸馏、trajectory replay、推理加速和收益结论等待 GPU A/B。', [...S_TURBO_LORA], { expert: true }),
  sec('cache-system-settings', 'speed', '缓存系统', '训练缓存配置：latent/文本编码器输出的磁盘格式、精度与存储位置。', [...S_CACHE_SYSTEM, ...S_CACHED_DATALOADER]),
  sec('anima-advanced-settings', 'model', 'Anima 高级配置', 'Anima 分组学习率、LoRA 目标模块与其他高级选项。仅在需要精细控制时调整。', [...S_ANIMA_ADVANCED], { expert: true }),
  sec('training-misc-settings', 'training', '其他训练选项', '随机种子、蒙版损失、训练备注与断点续训偏移。', [
    { key: 'goal_forecast_tool', type: 'action', label: '训练达标预测（Copilot 只读预测器）', desc: '读取已训练 run 的 loss / 验证 loss / L2 时序', buttonLabel: ' 打开达标预测', handler: 'openGoalForecastTool' },
    { key: 'copilot_tool', type: 'action', label: '自动训练 Copilot（全自动闭环编排）', desc: '一次授权无人值守：设定目标阈值（loss / 验证 loss / L2）+', buttonLabel: ' 自动训练 Copilot', handler: 'openCopilotTool' },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子', defaultValue: 1337 },
    { key: 'masked_loss', type: 'boolean', label: '启用蒙版损失', title: 'masked_loss', desc: '启用蒙版损失', defaultValue: false },
    { key: 'alpha_mask', type: 'boolean', label: '读取 Alpha 通道作为 Mask', title: 'alpha_mask', desc: '读取训练图像的 alpha 通道作为 loss mask', defaultValue: false },
    { key: 'anima_mixed_loss_mask_policy', type: 'select', label: '同 batch 缺失 Mask 时', title: 'anima_mixed_loss_mask_policy', desc: '仅在同一 batch 同时出现有 Mask 与无 Mask 样本时生效', defaultValue: 'full_sample', options: [
      { value: 'full_sample', label: '无 Mask 样本全部区域参与计算' },
      { value: 'drop_batch', label: '丢弃整个 batch' },
      { value: 'exclude_unmasked', label: '无 Mask 样本不贡献蒙版损失' },
    ], visibleWhen: (c) => c.masked_loss || c.alpha_mask },
    { key: 'training_comment', type: 'textarea', label: '训练备注', title: 'training_comment', desc: '写入模型元数据的训练备注', defaultValue: '' },
    { key: 'no_metadata', type: 'boolean', label: '不写入元数据', title: 'no_metadata', desc: '不向输出模型写入完整训练元数据', defaultValue: false },
    { key: 'initial_epoch', type: 'number', label: '起始 epoch', title: 'initial_epoch', desc: '从指定 epoch 编号开始计数', defaultValue: '', min: 1 },
    { key: 'initial_step', type: 'number', label: '起始 step', title: 'initial_step', desc: '从指定 step 编号开始计数，会覆盖 initial_epoch', defaultValue: '', min: 0 },
    { key: 'skip_until_initial_step', type: 'boolean', label: '跳过前面步数', title: 'skip_until_initial_step', desc: '配合 initial_step 使用，真正跳过前面的训练步数', defaultValue: false },
  ]),
  sec('ema-settings', 'optimizer', 'EMA（指数滑动平均）', 'EMA 副本与更新策略。启用后保存时额外写出 EMA 权重。', [
    { key: 'ema_enabled', type: 'boolean', label: '启用 EMA', title: 'ema_enabled', desc: '启用 EMA（指数滑动平均）。会额外复制一份参数，保存时写出 EMA 权重', defaultValue: false },
    { key: 'ema_decay', type: 'number', label: 'EMA 衰减率', title: 'ema_decay', desc: 'EMA 衰减率。越接近 1 越平滑', defaultValue: 0.999, min: 0, max: 0.99999, step: 0.0001, visibleWhen: (c) => c.ema_enabled },
    { key: 'ema_update_every', type: 'number', label: 'EMA 更新间隔', title: 'ema_update_every', desc: '每 N 个优化 step 更新一次 EMA', defaultValue: 1, min: 1, visibleWhen: (c) => c.ema_enabled },
    { key: 'ema_update_after_step', type: 'number', label: 'EMA 起始步', title: 'ema_update_after_step', desc: '从第几个优化 step 开始更新 EMA', defaultValue: 0, min: 0, visibleWhen: (c) => c.ema_enabled },
  ]),
  // Wavelet 已并入 quality-optimization；此处仅 SafeGuard
  sec('safeguard-settings', 'frontier', 'SafeGuard', 'NaN/Spike 拦截。', [...S_SAFEGUARD]),
  sec('system-settings', 'advanced', '系统设置', '指定 GPU 与自定义 TOML 覆盖。', [
    { key: 'gpu_ids', type: 'string', label: '指定显卡', title: 'gpu_ids', desc: '指定参与训练的 GPU 编号，多卡用逗号分隔（如 0,1）。', defaultValue: '' },
    { key: 'ui_custom_params', type: 'textarea', label: '自定义 TOML 覆盖', title: 'ui_custom_params', desc: '危险：会直接覆盖界面中的参数', defaultValue: '' },
  ]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
];

const S_ANIMA_EDIT_MODEL_RUNTIME = [
  { key: 'schema_id', type: 'hidden', defaultValue: 'anima-lora' },
  { key: 'model_type', type: 'hidden', defaultValue: 'anima' },
  { key: 'training_type', type: 'hidden', defaultValue: 'lora' },
  { key: 'edit_training_enabled', type: 'hidden', defaultValue: true },
  { key: 'edit_training_mode', type: 'hidden', defaultValue: 'edit_lora' },
  { key: 'edit_source_path_policy', type: 'hidden', defaultValue: 'auto' },
  { key: 'edit_target_path_policy', type: 'hidden', defaultValue: 'auto' },
  { key: 'edit_mask_policy', type: 'hidden', defaultValue: 'optional' },
  { key: 'edit_instruction_field', type: 'string', label: '指令字段', title: 'edit_instruction_field', desc: '配对编辑样本中的编辑指令字段名。默认 instruction。', defaultValue: 'instruction' },
  { key: 'edit_source_prompt_field', type: 'string', label: '原图 Prompt 字段', title: 'edit_source_prompt_field', desc: '可选。源图提示词字段名', defaultValue: 'source_prompt' },
  { key: 'edit_target_prompt_field', type: 'string', label: '目标 Prompt 字段', title: 'edit_target_prompt_field', desc: '可选。目标图提示词字段名', defaultValue: 'target_prompt' },
  { key: 'edit_injection_strategy', type: 'select', label: '参考注入策略', title: 'edit_injection_strategy', desc: 'latent_residual / masked_residual', defaultValue: 'latent_residual', options: [
    { value: 'latent_residual', label: 'Latent Residual' },
    { value: 'masked_residual', label: 'Masked Residual' },
    { value: 'none', label: 'None' },
  ] },
  { key: 'edit_reference_strength', type: 'slider', label: '参考强度', title: 'edit_reference_strength', desc: '源图 latent 对当前 noisy latent', defaultValue: 0.25, min: 0, max: 1, step: 0.01 },
  { key: 'edit_reference_field', type: 'string', label: '参考 Latent 字段', title: 'edit_reference_field', desc: '训练 batch 中作为源图参考 latent 的字段名。', defaultValue: 'source_latents' },
  { key: 'edit_timestep_schedule', type: 'select', label: '时间步调度', title: 'edit_timestep_schedule', desc: '控制参考注入在不同噪声阶段的强度。', defaultValue: 'early_lock', options: [
    { value: 'early_lock', label: 'Early Lock' },
    { value: 'mid_edit', label: 'Mid Edit' },
    { value: 'mask_preserve', label: 'Mask Preserve' },
    { value: 'off', label: 'Off' },
  ] },
  { key: 'edit_loss_plan', type: 'select', label: '编辑 Loss 方案', title: 'edit_loss_plan', desc: '当前后端稳定方案为 target。', defaultValue: 'target', options: [{ value: 'target', label: 'Target' }] },
  { key: 'edit_mask_field', type: 'string', label: '编辑 Mask 字段', title: 'edit_mask_field', desc: '可选。修改区域 mask 字段名。', defaultValue: 'edit_mask' },
  { key: 'edit_preserve_mask_field', type: 'string', label: '保留 Mask 字段', title: 'edit_preserve_mask_field', desc: '可选。需要保持区域的 mask 字段名。', defaultValue: 'preserve_mask' },
  { key: 'edit_mask_weight', type: 'number', label: '编辑区权重', title: 'edit_mask_weight', desc: '有 edit_mask 时用于提高或降低编辑区域 loss', defaultValue: 1.0, min: 0, step: 0.1 },
  { key: 'edit_preserve_weight', type: 'number', label: '保留区权重', title: 'edit_preserve_weight', desc: '有 preserve_mask 时额外约束保留区域。', defaultValue: 0.0, min: 0, step: 0.05 },
];

function animaEditModelSection(section) {
  if (section.id !== 'model-settings') return section;
  return {
    ...section,
    fields: section.fields.map((field) => (
      field.key === 'model_train_type'
        ? { ...field, defaultValue: 'anima-edit-model' }
        : field
    )),
  };
}

export const ANIMA_EDIT_MODEL_SECTIONS = (() => {
  const sections = ANIMA_LORA_SECTIONS.map(animaEditModelSection);
  const insertAfter = sections.findIndex((section) => section.id === 'caption-settings');
  const editSection = sec('edit-model-settings', 'dataset', 'Edit 训练', '配对源图/目标图/指令训练参数。底层复用 Anima LoRA 训练通道。', [...S_ANIMA_EDIT_MODEL_RUNTIME]);
  if (insertAfter < 0) return [editSection, ...sections];
  return [
    ...sections.slice(0, insertAfter + 1),
    editSection,
    ...sections.slice(insertAfter + 1),
  ];
})();

export const ANIMA_ILECO_SECTIONS = animaConceptEditSections({
  typeId: 'anima-ileco',
  mode: 'ileco',
  maxTrainSteps: 500,
});

export const ANIMA_ADDIFT_SECTIONS = animaConceptEditSections({
  typeId: 'anima-addift',
  mode: 'addift',
  maxTrainSteps: 80,
  minTimestep: 500,
  maxTimestep: 1000,
});

export const ANIMA_MULTI_ADDIFT_SECTIONS = animaConceptEditSections({
  typeId: 'anima-multi-addift',
  mode: 'multi-addift',
  maxTrainSteps: 120,
  minTimestep: 500,
  maxTimestep: 1000,
});

// ---- Anima Finetune ----
export const ANIMA_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Anima 全参微调。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'anima-finetune' },
    {
      key: 'anima_auto_scan_folder',
      type: 'action',
      label: '智能识别模型文件夹',
      desc: '选择 Anima 模型根目录，自动识别并填充 DiT / VAE /',
      buttonLabel: '选择文件夹并识别',
      handler: 'openAnimaFolderScanner',
    },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Anima DiT 路径', title: 'pretrained_model_name_or_path', desc: 'Anima 主 DiT 权重；支持 BF16 与 Bedovyy/Comfy INT8（int8rowwise/int8convrot）。INT8 包训练前会 dequant 成 dense，训练显存≈BF16（省磁盘，非 keep-I8，非 Comfy 原生加速）', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'Qwen Image VAE 路径', title: 'vae', desc: 'Qwen Image VAE 路径', defaultValue: '' },
    { key: 'qwen3', type: 'file', pickerType: 'model-file', label: 'Qwen3 文本模型路径', title: 'qwen3', desc: 'Qwen3 文本模型路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '继续训练路径', defaultValue: '' },
  ]),
  sec('anima-params', 'model', 'Anima 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 3.0, tsExtra: ['logit_normal'] }),
    { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 最大 token', defaultValue: 512, min: 1 },
    { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数', defaultValue: '', step: 0.01 },
    { key: 'flow_uncertainty_weighting_enabled', type: 'boolean', label: 'EDM2 自适应损失权重', title: 'flow_uncertainty_weighting_enabled', desc: '学习一个按 sigma 的不确定度 u(σ)，损失变为 loss', defaultValue: false },
    { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 最大 token', defaultValue: 512, min: 1 },
    { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '拆分 attention', defaultValue: false },
  ]),
  sec('depth-expansion-settings', 'model', '模型扩层', '以恒等残差块扩展 DiT 深度，最终保存完整的新底座。', [
    { key: 'anima_depth_expansion_enabled', type: 'boolean', label: '启用模型扩层', title: 'anima_depth_expansion_enabled', desc: '训练加载时交错复制相邻层，并将新层输出投影归零。仅支持 Anima 全参微调。', defaultValue: false },
    { key: 'anima_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'anima_depth_expansion_target_layers', desc: '必须大于底座实际层数；Anima Base 28 层可设置为 40。', defaultValue: 40, min: 2, step: 1, visibleWhen: when('anima_depth_expansion_enabled', true) },
    { key: 'anima_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'anima_depth_expansion_train_scope', desc: '只训练新层最接近标准 Depth Up-Scaling；外围模块包括输入、时间嵌入和最终输出层。', defaultValue: 'new_layers', options: [
      { value: 'new_layers', label: '只训练新层' },
      { value: 'new_layers_periphery', label: '新层 + 外围模块' },
      { value: 'all', label: '训练全部层' },
    ], visibleWhen: when('anima_depth_expansion_enabled', true) },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_FT_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
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
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

// ---- Anima ControlNet（DiT 条件适配器；与 EasyControl / UNet ControlNet 不同）----
export const ANIMA_CN_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Anima ControlNet：冻结 DiT，只训条件适配器。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'anima-controlnet' },
    {
      key: 'anima_auto_scan_folder',
      type: 'action',
      label: '智能识别模型文件夹',
      desc: '选择 Anima 模型根目录，自动识别并填充 DiT / VAE /',
      buttonLabel: '选择文件夹并识别',
      handler: 'openAnimaFolderScanner',
    },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Anima DiT 权重路径', title: 'pretrained_model_name_or_path', desc: 'Anima 主 DiT 权重；支持 BF16 与 Bedovyy/Comfy INT8（int8rowwise/int8convrot）。INT8 包训练前会 dequant 成 dense，训练显存≈BF16（省磁盘，非 keep-I8，非 Comfy 原生加速）', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'Qwen Image VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
    { key: 'qwen3', type: 'file', pickerType: 'model-file', label: 'Qwen3 文本模型路径', title: 'qwen3', desc: 'Qwen3 路径', defaultValue: '' },
    { key: 't5_tokenizer_path', type: 'file', pickerType: 'model-file', label: 'T5 Tokenizer 路径', title: 't5_tokenizer_path', desc: 'T5 tokenizer 路径', defaultValue: '' },
    { key: 'llm_adapter_path', type: 'file', pickerType: 'model-file', label: 'LLM Adapter 路径', title: 'llm_adapter_path', desc: 'LLM Adapter 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '继续训练路径', defaultValue: '' },
  ]),
  sec('anima-params', 'model', 'Anima 专用参数', '时间步与文本长度等 Anima RF 参数。', [
    ...flowParams({ ts: 'shift', dfs: 3.0, tsExtra: ['logit_normal'] }),
    { key: 'qwen3_max_token_length', type: 'number', label: 'Qwen3 最大 token', title: 'qwen3_max_token_length', desc: 'Qwen3 最大 token', defaultValue: 512, min: 1 },
    { key: 't5_max_token_length', type: 'number', label: 'T5 最大 token', title: 't5_max_token_length', desc: 'T5 最大 token', defaultValue: 512, min: 1 },
  ]),
  sec('controlnet-network-settings', 'network', 'ControlNet 网络', '共享条件主干 + 每层 Linear 残差适配器。默认导出社区可读布局。与 EasyControl 不同产品。', [...S_ANIMA_CONTROLNET]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练图 + 配对条件图。', cnDataset('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '建议学习率 1e-4。', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields, ...ditTrainFields([], 'Anima')]),
  sec('preview-settings', 'preview', '预览图设置', '首版预览采样器未接线时后端会自动关闭 sample_every。', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...VRAM_AUTO_ENHANCE_FIELDS, ...S_SPEED_FLOW.filter((f) => !new Set([
    'torch_compile', 'dynamo_backend',
  ]).has(f.key))]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];
