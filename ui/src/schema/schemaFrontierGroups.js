// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// schemaFrontierGroups.js — 通用前沿/训练增强字段组（anima / sdxl / newbie 共用）
// 所有字段均 默认关闭，无 arch 依赖，可在任意训练类型的 training/frontier/expert section 引用。
import { all, doraEnabled, when } from './schemaCommon.js';

// P3 training intent is a suggestion profile only. Selecting an intent never
// mutates the draft; the preview panel asks the backend for an explicit diff.
export const S_TRAINING_INTENT_PROFILE = [
  { key: 'training_intent', type: 'select', label: '训练用途', desc: '选择用途后先预览建议；只有点击“应用未设置项”才会写入草稿，已明确修改的字段不会被覆盖。', defaultValue: 'normal', options: [
    { value: 'normal', label: '普通' },
    { value: 'character', label: '角色' },
    { value: 'style', label: '风格' },
    { value: 'clothing', label: '服装' },
    { value: 'object', label: '物体' },
    { value: 'concept', label: '概念' },
    { value: 'action', label: '动作' },
    { value: 'expression', label: '表情' },
    { value: 'local_feature', label: '局部特征' },
    { value: 'global_style', label: '全局风格' },
  ] },
];

// ── Scale Guidance + Quality Loss Pack ────────────────────────────────────────


// P4 progressive / phased training. The first UI pass intentionally uses a
// JSON textarea so it exposes the stable request contract without pretending
// that the visual phase editor already exists.
export const S_PROGRESSIVE_TRAINING = [
  { key: 'progressive_training_enabled', type: 'boolean', label: '启用渐进式 / 分阶段训练', desc: '按 optimizer progress 切换阶段，可控制阶段学习率、LoRA 模块和后续课程策略。', defaultValue: false },
  { key: 'progressive_phase_schedule', type: 'textarea', label: 'Phase Schedule JSON', desc: 'JSON 数组或 {"phases": [...]}。每个阶段支持 start/end（0~1）、lr_scale、module_policy、difficulty_policy、timestep_policy 等字段；留空使用单阶段兼容默认值。', defaultValue: '', visibleWhen: when('progressive_training_enabled', true) },
  { key: 'progressive_curriculum_seed', type: 'number', label: '课程策略随机种子', desc: '用于阶段内课程难度选择；相同 seed、step 和策略会得到确定性结果。', defaultValue: 42, min: 0, step: 1, visibleWhen: when('progressive_training_enabled', true) },
];

// P5 observational controllers. Metrics and hard-sample mining emit resumable
// events and suggestions only; neither controller mutates the training policy.
export const S_ADAPTIVE_TRAINING = [
  { key: 'adaptive_training_enabled', type: 'boolean', label: '启用自适应训练控制', desc: '关闭时保持经典固定训练，不创建控制器；开启后可选择建议或受约束自动调整。', defaultValue: false },
  { key: 'adaptive_rank_enabled', type: 'boolean', label: '启用模块级自适应 Rank', desc: '按模块敏感度在固定总预算内分配 Rank；关闭时保持现有统一 Rank。', defaultValue: false },
  { key: 'adaptive_rank_mode', type: 'select', label: 'Rank 分配策略', desc: '静态模式在注入前分配；动态模式按梯度/更新证据周期性迁移并保留优化器状态。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'auto_static', label: '静态自动分配' },
    { value: 'dynamic', label: '训练中动态分配' },
  ], visibleWhen: when('adaptive_rank_enabled', true) },
  { key: 'adaptive_rank_total_budget', type: 'number', label: 'Rank 总预算', desc: '所有模块 Rank 总和上限；0 表示按当前 Rank 预算运行。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_min_rank', type: 'number', label: '模块最小 Rank', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_max_rank', type: 'number', label: '模块最大 Rank', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_locked_modules_json', type: 'textarea', label: '锁定模块 JSON', desc: '可选。锁定指定模块 Rank，不参与预算重分配。支持模块名数组或模块到 Rank 的映射。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_probe_window', type: 'number', label: 'Rank 探测窗口', desc: '累计多少次梯度/更新观测后形成稳定敏感度。', defaultValue: 32, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_ema_decay', type: 'number', label: '敏感度 EMA 衰减', desc: '越高越平滑，越低越快速响应近期变化。', defaultValue: 0.9, min: 0, max: 0.9999, step: 0.01, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_warmup_steps', type: 'number', label: 'Rank 调整预热步数', desc: '预热完成前只采样敏感度，不迁移 Rank。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_reallocation_interval', type: 'number', label: 'Rank 重分配间隔', desc: '动态模式每隔多少 optimizer step 重新评估。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_min_delta', type: 'number', label: 'Rank 最小变更量', desc: '小于该 Rank 差值时不迁移，减少频繁形状变化。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_profile_json', type: 'textarea', label: 'Rank 敏感度 Profile JSON', desc: '静态自动分配可选的离线 profile；动态模式留空则使用训练中采集的敏感度。该能力仍处于实验验证阶段，需同参数 A/B 后再作为推荐配置。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_profile_path', type: 'file', pickerType: 'text-file', label: 'Rank Profile 文件', desc: '可选离线敏感度 profile 文件；显式 JSON 与文件只需提供一种。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_training_strategy', type: 'select', label: '训练策略', desc: '经典固定不创建 controller；建议模式只记录动作；受限自动仅调整学习率/区域权重；完整自动才允许 Rank/模块冻结接口。', defaultValue: 'fixed', options: [
    { value: 'fixed', label: '经典固定' },
    { value: 'suggest', label: '自适应建议' },
    { value: 'auto_limited', label: '受限自动调整' },
    { value: 'auto_full', label: '完整自动调整' },
  ], visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_objective', type: 'select', label: '优化目标', defaultValue: 'balanced', options: [
    { value: 'target_region', label: '目标区域优先' },
    { value: 'balanced', label: '平衡' },
    { value: 'generalization', label: '最大化泛化' },
    { value: 'pollution_minimization', label: '最小化污染' },
  ], visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_adjustments', type: 'multiSelect', label: '自动调整项', desc: '建议模式也会记录建议；自动模式会先经过证据门槛、上下界和锁定项检查。', defaultValue: [], options: [
    { value: 'learning_rate', label: '学习率' },
    { value: 'region_weight', label: '区域权重' },
    { value: 'rank', label: 'Rank' },
    { value: 'module_freeze', label: '模块冻结/解冻' },
    { value: 'overfit_protection', label: '过拟合保护' },
  ], visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_metrics_enabled', type: 'boolean', label: '采集训练指标', desc: '记录 loss、区域 loss、梯度范数、适配器更新范数和参数范数。', defaultValue: true, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_metrics_interval', type: 'number', label: '指标采样间隔', desc: '每隔多少个 optimizer step 记录一次事件。', defaultValue: 1, min: 1, step: 1, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_interval_steps', type: 'number', label: '控制调整间隔', desc: '控制器只在该间隔评估动作，避免每步改变策略。', defaultValue: 50, min: 1, max: 100000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_minimum_evidence', type: 'number', label: '最小证据数', desc: '收到足够 RewardReport/telemetry 证据前不产生动作。', defaultValue: 3, min: 1, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_patience', type: 'number', label: '下降耐心', desc: '连续多少次质量分下降后才触发收敛修正。', defaultValue: 2, min: 1, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_max_actions', type: 'number', label: '最大调整次数', defaultValue: 8, min: 0, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_learning_rate_min', type: 'number', label: '学习率下限', defaultValue: 0.00000001, min: 0, step: 0.00000001, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_learning_rate_max', type: 'number', label: '学习率上限', defaultValue: 1, min: 0.00000001, step: 0.000001, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_learning_rate_step', type: 'number', label: '学习率调整比例', desc: '下降时乘以该比例，范围 0.01~1。', defaultValue: 0.8, min: 0.01, max: 1, step: 0.01, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_region_weight_min', type: 'number', label: '区域权重下限', defaultValue: 0.1, min: 0, max: 64, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_region_weight_max', type: 'number', label: '区域权重上限', defaultValue: 4, min: 0.01, max: 64, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_region_weight_step', type: 'number', label: '区域权重步长', defaultValue: 0.1, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_locked_items', type: 'multiSelect', label: '用户锁定项', desc: '锁定项不会被控制器修改。', defaultValue: [], options: [
    { value: 'learning_rate', label: '学习率' },
    { value: 'region_weight', label: '区域权重' },
    { value: 'rank', label: 'Rank' },
    { value: 'module_freeze', label: '模块冻结/解冻' },
    { value: 'overfit_protection', label: '过拟合保护' },
  ], visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_rollback_on_decline', type: 'boolean', label: '质量下降时允许撤销', desc: '保留最近可逆动作的旧值，并在验证分数下降时支持回滚。', defaultValue: true, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_event_history', type: 'number', label: '事件历史长度', desc: '内存与 resume 状态中保留的最近事件数量。', defaultValue: 256, min: 16, max: 4096, step: 16, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_sample_mining_enabled', type: 'boolean', label: '启用困难样本建议', desc: '按样本 loss 的 EMA 生成困难样本建议。', defaultValue: false, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_sample_mining_interval', type: 'number', label: '困难样本采样间隔', desc: '每隔多少个 optimizer step 汇总一次样本 loss。', defaultValue: 10, min: 1, max: 10000, step: 1, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_ema_decay', type: 'number', label: '困难度 EMA 衰减', defaultValue: 0.9, min: 0, max: 0.9999, step: 0.01, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_top_fraction', type: 'number', label: '困难样本比例', defaultValue: 0.25, min: 0.01, max: 1, step: 0.01, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_report_limit', type: 'number', label: '建议列表上限', defaultValue: 32, min: 1, max: 256, step: 1, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_max_samples', type: 'number', label: '样本状态容量', defaultValue: 2048, min: 16, max: 100000, step: 16, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'loss_state_enabled', type: 'boolean', label: '启用逐图 Loss 状态机', desc: '跨 epoch 跟踪每个样本的 loss 状态，并将判定结果合入样本难度权重。', defaultValue: false },
  { key: 'loss_state_fusion_mode', type: 'select', label: 'Loss 状态融合模式', defaultValue: 'loss', options: [
    { value: 'loss', label: '仅 Loss' },
    { value: 'loss+aesthetic', label: 'Loss + 审美分位' },
  ], visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_aesthetic_weight', type: 'number', label: '审美融合强度', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.loss_state_enabled && c.loss_state_fusion_mode === 'loss+aesthetic' },
  { key: 'loss_state_num_bins', type: 'number', label: '时间步分桶数', defaultValue: 32, min: 2, max: 256, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_healthy_quantile', type: 'number', label: '健康残差分位', defaultValue: 0.4, min: 0, max: 1, step: 0.05, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_watching_rise_epochs', type: 'number', label: '观察确认 Epoch', defaultValue: 1, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lrugged_votes', type: 'number', label: '退化确认票数', defaultValue: 3, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_plateau_slope', type: 'number', label: '饱和斜率阈值', defaultValue: 0.001, min: 0, max: 1, step: 0.0001, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_warmup_window', type: 'number', label: '升温窗口', defaultValue: 3, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lost_votes', type: 'number', label: '卡死追加票数', defaultValue: 2, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lrugged_hits', type: 'number', label: '平坦高位阈值', defaultValue: 0.9, min: 0, max: 1, step: 0.05, visibleWhen: when('loss_state_enabled', true) },
];

// Region-focus product recipe layered on semantic region spatial weights (default-off).
// Full semantic mask editor still lives in the classic UI; this exposes the focus knobs.
export const S_REGION_FOCUS = [
  { key: 'region_focus_enabled', type: 'boolean', label: '区域聚焦配方', desc: '在语义区域权重上叠加聚焦强度×步程衰减。开启时后端会强制启用语义区域加权。', defaultValue: false },
  { key: 'region_focus_strength', type: 'number', label: '聚焦强度', desc: '放大区域权重相对 1.0 的偏差；1=按表原样，>1 更聚焦。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_decay', type: 'boolean', label: '聚焦随进度衰减', desc: '训练进度 0→1 时强度线性收到 floor。', defaultValue: true, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_floor', type: 'number', label: '聚焦衰减地板', desc: '进度末尾的强度倍率（相对 strength）。', defaultValue: 0.25, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_decay },
  { key: 'region_focus_coverage_balance', type: 'boolean', label: '低覆盖率再平衡', desc: '目标区域像素占比过低时提高该区域 loss 权重（不删步）。', defaultValue: false, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_coverage_target', type: 'number', label: '覆盖率目标', desc: '低于该像素占比时启动 boost。', defaultValue: 0.05, min: 0.001, max: 1, step: 0.01, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_coverage_balance },
  { key: 'region_focus_coverage_max_boost', type: 'number', label: '覆盖率 boost 上限', desc: '低覆盖 boost 上限倍率。', defaultValue: 2.0, min: 1, max: 8, step: 0.1, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_coverage_balance },
];

// P2 unified per-sample WeightComposer. Every axis is opt-in and the runtime
// normalizes the composed product to mean 1, avoiding an accidental global LR scale change.
export const S_WEIGHT_COMPOSER = [
  { key: 'timestep_weighting_enabled', type: 'boolean', label: '启用时间步权重', desc: '按扩散时间步调整每个样本的 loss；可与语义区域、噪声和样本难度权重相乘。', defaultValue: false },
  { key: 'timestep_weighting_mode', type: 'select', label: '时间步侧重', desc: '低/高表示模型实际收到的归一化 timestep 两端；标定表为离线自标定 LUT。', defaultValue: 'uniform', options: [
    { value: 'uniform', label: '均匀（不倾斜）' },
    { value: 'low', label: '低时间步' },
    { value: 'high', label: '高时间步' },
    { value: 'middle', label: '中间时间步' },
    { value: 'extremes', label: '两端时间步' },
    { value: 'lut', label: '标定表 (LUT)' },
  ], visibleWhen: (c) => c.timestep_weighting_enabled },
  { key: 'timestep_weighting_strength', type: 'number', label: '时间步权重强度', desc: '0=不改变；1=标准倾斜；组合多个轴时建议从 0.25–1.0 开始。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode !== 'uniform' },
  { key: 'timestep_weighting_lut_path', type: 'file', pickerType: 'text-file', label: '时间步标定表路径', desc: 'lulynx.timestep-lut.v1 JSON/npz；缺表时 fail-soft 回均匀。', defaultValue: '', visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode === 'lut' },
  { key: 'timestep_weighting_lut_id', type: 'string', label: '时间步标定表 ID', desc: '可选资产 id；path 优先。', defaultValue: '', visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode === 'lut' },
  { key: 'noise_weighting_enabled', type: 'boolean', label: '启用噪声强度权重', desc: '优先使用 sigma；DDPM 路线自动从 alpha_cumprod 推导噪声强度。', defaultValue: false },
  { key: 'noise_weighting_mode', type: 'select', label: '噪声侧重', desc: '低噪声通常偏细节，高噪声通常偏结构；具体含义仍取决于模型目标。', defaultValue: 'uniform', options: [
    { value: 'uniform', label: '均匀（不倾斜）' },
    { value: 'low', label: '低噪声 / 细节' },
    { value: 'high', label: '高噪声 / 结构' },
    { value: 'middle', label: '中等噪声' },
    { value: 'extremes', label: '噪声两端' },
  ], visibleWhen: (c) => c.noise_weighting_enabled },
  { key: 'noise_weighting_strength', type: 'number', label: '噪声权重强度', desc: '0=不改变；1=标准倾斜。与时间步权重同时启用时两者会相乘。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.noise_weighting_enabled && c.noise_weighting_mode !== 'uniform' },
  { key: 'sample_difficulty_weighting_enabled', type: 'boolean', label: '启用样本难度权重', desc: '使用数据集提供的难度权重，或按当前 batch 的 detached loss 自动强调困难/简单样本。', defaultValue: false },
  { key: 'sample_difficulty_weighting_mode', type: 'select', label: '样本难度策略', defaultValue: 'provided', options: [
    { value: 'provided', label: '使用数据集权重' },
    { value: 'hard', label: '强调困难样本' },
    { value: 'easy', label: '强调简单样本' },
  ], visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_metadata_path', type: 'file', pickerType: 'text-file', label: '样本难度元数据', desc: '可选 JSON 文件。留空时自动读取 <train_data_dir>/sample_difficulty.json；显式路径会覆盖自动路径。', defaultValue: '', visibleWhen: (c) => c.sample_difficulty_weighting_enabled && c.sample_difficulty_weighting_mode === 'provided' },
  { key: 'sample_difficulty_weighting_strength', type: 'number', label: '难度权重强度', desc: '0=不改变；provided 模式下对输入权重做线性混合。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_weighting_min', type: 'number', label: '样本权重下限', defaultValue: 0.25, min: 0, max: 16, step: 0.05, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_weighting_max', type: 'number', label: '样本权重上限', defaultValue: 4.0, min: 0.01, max: 64, step: 0.1, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
];

// dataset_intelligence_* 属于数据集侧(离线 Manifest 驱动采样/权重),不是权重合成器的
// opt-in 轴。原先混在 S_WEIGHT_COMPOSER 里 —— 而且只有 React 侧混进去了,legacy 从来
// 没有过这批字段 —— 既让"统一权重组合"多出第 4 个开关,也让用户在权重面板里找数据集设置。
// 现在由 schemaIndex 挂进各族已有的 dataset-settings section,不另立新组。
export const S_DATASET_INTELLIGENCE = [
  { key: 'dataset_intelligence_enabled', type: 'boolean', label: '启用数据集智能 Manifest', desc: '离线统一质量、Caption、难度、区域覆盖率和概念稀有度；训练期只读取 Manifest，不加载检测模型。', defaultValue: false },
  { key: 'dataset_intelligence_manifest_path', type: 'file', pickerType: 'text-file', label: '数据智能 Manifest', desc: '标准 lulynx.dataset_intelligence_manifest.v1 JSON。留空不会阻断经典训练。', defaultValue: '', visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_sampling_mode', type: 'select', label: '数据采样策略', defaultValue: 'fixed', options: [
    { value: 'fixed', label: '固定采样' },
    { value: 'curriculum', label: '课程学习：简单 → 普通 → 困难' },
  ], visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_seed', type: 'number', label: '采样 Seed', desc: '相同 Manifest、epoch 和 seed 生成相同采样计划。', defaultValue: 0, min: 0, step: 1, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_min_weight', type: 'number', label: '数据样本权重下限', desc: 'Manifest 样本权重与课程阶段权重的最终下限。', defaultValue: 0.25, min: 0, max: 64, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_max_weight', type: 'number', label: '数据样本权重上限', desc: 'Manifest 样本权重与课程阶段权重的最终上限。', defaultValue: 4.0, min: 0.01, max: 64, step: 0.1, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_curriculum_easy_end', type: 'number', label: '简单阶段终点', desc: '训练进度达到该比例前优先简单样本。', defaultValue: 0.33, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dataset_intelligence_enabled && c.dataset_intelligence_sampling_mode === 'curriculum' },
  { key: 'dataset_intelligence_curriculum_normal_end', type: 'number', label: '普通阶段终点', desc: '达到该比例后逐步开放困难样本。不得小于简单阶段终点。', defaultValue: 0.66, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dataset_intelligence_enabled && c.dataset_intelligence_sampling_mode === 'curriculum' },
  { key: 'dataset_intelligence_region_balance_strength', type: 'number', label: '区域覆盖率平衡', defaultValue: 0.0, min: 0, max: 4, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_concept_rarity_strength', type: 'number', label: '概念稀有度平衡', defaultValue: 0.0, min: 0, max: 4, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_target_caption_language', type: 'select', label: 'Caption 目标语言', defaultValue: 'auto', options: [
    { value: 'auto', label: '保持原语言 / 自动' },
    { value: 'zh', label: '中文' },
    { value: 'latin', label: '拉丁字母语言' },
  ], visibleWhen: when('dataset_intelligence_enabled', true) },
];
export const S_QUALITY_OPTIMIZATION_PACK = [
  { key: 'scale_guidance_mode', type: 'select', label: 'Scale Guidance 模式', desc: '一键引导训练侧重不同尺度', defaultValue: 'off', options: [
    { value: 'off', label: '关闭 (默认)' },
    { value: 'detail', label: '注重细节 (detail)' },
    { value: 'style', label: '注重风格 (style)' },
    { value: 'composition', label: '注重构图 (composition)' },
  ] },
  { key: 'lineart_preservation_enabled', type: 'boolean', label: '启用线稿保护损失', desc: 'Sobel 边缘检测提取 latent 线稿特征', defaultValue: false },
  { key: 'lineart_preservation_weight', type: 'number', label: '线稿损失权重', desc: '相对主损失权重，推荐 0.05-0.2。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_edge_weight', type: 'number', label: '边缘权重因子', desc: '边缘区域相对整体的权重放大倍数，默认 3.0。', defaultValue: 3.0, min: 1, max: 10, step: 0.5, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_min_t', type: 'number', label: '最小 sigma (线稿)', desc: 'sigma 窗口下界，0=全范围。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_max_t', type: 'number', label: '最大 sigma (线稿)', desc: 'sigma 窗口上界，1=全范围。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'dct_frequency_enabled', type: 'boolean', label: '启用 DCT 频域损失', desc: '其它选项。DCT 分解频率，对高频分量施加更高权重。', defaultValue: false },
  { key: 'dct_frequency_weight', type: 'number', label: 'DCT 损失权重', desc: '推荐 0.05-0.15', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_high_weight', type: 'number', label: '高频权重因子', desc: '高频相对低频的权重倍数，默认 2.0。', defaultValue: 2.0, min: 1, max: 5, step: 0.5, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_low_cutoff', type: 'number', label: '低频 cutoff 比例', desc: '前多少比例算低频，默认 0.3', defaultValue: 0.3, min: 0.1, max: 0.5, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_min_t', type: 'number', label: '最小 sigma (DCT)', desc: 'sigma 窗口下界，0=全范围。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_max_t', type: 'number', label: '最大 sigma (DCT)', desc: 'sigma 窗口上界，1=全范围。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'gram_texture_enabled', type: 'boolean', label: '启用 Gram 纹理损失', desc: 'Gram 矩阵捕捉纹理统计特征，防止网状纹理/风格不稳定。', defaultValue: false },
  { key: 'gram_texture_weight', type: 'number', label: 'Gram 损失权重', desc: '推荐 0.03-0.1', defaultValue: 0.05, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_normalize', type: 'boolean', label: '归一化 Gram 矩阵', desc: '除以 C*H*W 使损失与尺寸无关。', defaultValue: true, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_min_t', type: 'number', label: '最小 sigma (Gram)', desc: 'sigma 窗口下界，0=全范围。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_max_t', type: 'number', label: '最大 sigma (Gram)', desc: 'sigma 窗口上界，1=全范围。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.gram_texture_enabled },

  // ── 困难样本挖掘 ────────────────────────────────────────────────────────────
  { key: 'hard_negative_mining_enabled', type: 'boolean', label: '启用困难样本挖掘 (Hard Negative Mining)', desc: '只回传 loss 最高的 top-k% 样本梯度', defaultValue: false },
  { key: 'hard_negative_mining_ratio', type: 'number', label: '困难样本保留比例', desc: '保留 top-k% 的困难样本。推荐 0.5 (保留 50%)。', defaultValue: 0.5, min: 0.1, max: 1.0, step: 0.05, visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_warmup_steps', type: 'number', label: 'Warmup 步数', desc: '前 N 步不启用困难样本挖掘，让模型先稳定训练。', defaultValue: 100, min: 0, step: 10, visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_mode', type: 'select', label: '挖掘模式', desc: '挖掘模式', defaultValue: 'topk', options: [
    { value: 'topk', label: 'Top-K 模式' },
    { value: 'threshold', label: 'Threshold 模式' },
  ], visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_threshold_multiplier', type: 'number', label: 'Threshold 系数', desc: 'Threshold 模式的阈值系数 (threshold =', defaultValue: 1.2, min: 1.0, max: 3.0, step: 0.1, visibleWhen: (c) => c.hard_negative_mining_enabled && c.hard_negative_mining_mode === 'threshold' },

  // ── 多尺度 DiT 监督 ───────────────────────────────────────────────────────
  { key: 'multi_scale_supervision_enabled', type: 'boolean', label: '启用多尺度 DiT 监督 (Multi-Scale Supervision)', desc: '在 DiT 中间层 (4/8/12) 上做 student-teacher', defaultValue: false },
  { key: 'multi_scale_supervision_weight', type: 'number', label: '多尺度损失权重', desc: '相对主损失权重。推荐 0.1-0.3。', defaultValue: 0.1, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_layers', type: 'text', label: '监督层列表', desc: '要监督的 DiT 层，逗号分隔 (如 "4,8,12")。', defaultValue: '4,8,12', visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_loss_type', type: 'select', label: '特征损失类型', desc: '特征损失类型', defaultValue: 'mse', options: [
    { value: 'mse', label: 'MSE (均方误差)' },
    { value: 'cosine', label: 'Cosine (余弦距离)' },
  ], visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_min_t', type: 'number', label: '最小 sigma (多尺度)', desc: 'sigma 窗口下界，0=全范围。只在指定范围内应用多尺度监督。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_max_t', type: 'number', label: '最大 sigma (多尺度)', desc: 'sigma 窗口上界，1=全范围。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },

  // ── LPIPS Latent 感知损失 ─────────────────────────────────────────────────
  { key: 'lpips_latent_enabled', type: 'boolean', label: '启用 LPIPS Latent 感知损失', desc: '利用 DiT 中间层特征计算感知相似度，类似 LPIPS 但在 latent', defaultValue: false },
  { key: 'lpips_latent_weight', type: 'number', label: 'LPIPS Latent 损失权重', desc: '相对主损失权重。推荐 0.05-0.15。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_feature_layers', type: 'text', label: '特征层列表', desc: '使用哪些 DiT 层特征，逗号分隔 (如 "4,8,12")。', defaultValue: '4,8,12', visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_feature_weight', type: 'text', label: '各层权重', desc: '各层权重，逗号分隔 (如 "1.', defaultValue: '1.0,1.0,1.0', visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_normalize_features', type: 'boolean', label: '归一化特征', desc: '是否归一化特征 (L2 norm)。归一化后损失更关注方向而非幅度。', defaultValue: true, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_min_t', type: 'number', label: '最小 sigma (LPIPS)', desc: 'sigma 窗口下界，0=全范围。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_max_t', type: 'number', label: '最大 sigma (LPIPS)', desc: 'sigma 窗口上界，1=全范围。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lpips_latent_enabled },

  // ── 对比学习 Latent 一致性 ────────────────────────────────────────────────
  { key: 'contrastive_latent_enabled', type: 'boolean', label: '启用对比学习 Latent 一致性', desc: '对比学习风格的一致性损失：同一 clean latent', defaultValue: false },
  { key: 'contrastive_latent_weight', type: 'number', label: '对比学习损失权重', desc: '相对主损失权重。推荐 0.05-0.2。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_noise_pairs', type: 'number', label: '对比对数', desc: '对比对数', defaultValue: 1, min: 1, max: 5, step: 1, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_temperature', type: 'number', label: '对比学习温度', desc: '对比学习温度系数 (保留，当前简化实现未使用)。', defaultValue: 0.07, min: 0.01, max: 0.2, step: 0.01, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_min_t', type: 'number', label: '最小 sigma (对比)', desc: 'sigma 窗口下界。限制在中间噪声段 (如 0.2-0.8)。', defaultValue: 0.2, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_max_t', type: 'number', label: '最大 sigma (对比)', desc: 'sigma 窗口上界。限制在中间噪声段。', defaultValue: 0.8, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.contrastive_latent_enabled },
];

// ── LoRA 结构变体 ─────────────────────────────────────────────────────────────
export const S_LORA_VARIANTS = [
  { key: 'adapter_mask_pruning_enabled', type: 'boolean', label: 'Adapter Mask 剪枝', desc: '训练中按 adapter rank 重要性更新稳定', defaultValue: false },
  { key: 'adapter_mask_pruning_target_ratio', type: 'number', label: 'Mask 剪枝比例', desc: '最终逻辑屏蔽的 rank 比例。0.5 表示约保留一半 rank。', defaultValue: 0.5, min: 0, max: 0.95, step: 0.05, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_warmup_steps', type: 'number', label: 'Mask 剪枝预热步数', desc: '预热期间只累计重要性，不更新 mask。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_interval', type: 'number', label: 'Mask 更新间隔', desc: '每隔多少 backward step 更新一次 rank mask。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_min_rank', type: 'number', label: 'Mask 最小 Rank', desc: '每个 adapter 至少保留的 rank 数。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_ema_decay', type: 'number', label: 'Mask 重要性 EMA', desc: 'weight*grad 重要性分数的 EMA 衰减。', defaultValue: 0.9, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adalora_enabled', type: 'boolean', label: 'AdaLoRA (SVD 自适应预算)', desc: 'SVD 分解 ΔW=P@Λ@Q，动态分配参数预算到重要层。', defaultValue: false },
  { key: 'adalora_target_rank', type: 'number', label: 'AdaLoRA 目标 rank', desc: '最终目标 rank (0=使用全局 rank)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_init_rank', type: 'number', label: 'AdaLoRA 初始 rank', desc: '初始 rank (0=1.5×目标 rank)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_total_steps', type: 'number', label: 'AdaLoRA 总步数', desc: '预算调度总步数；0=自动取 max_train_steps。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_mask_interval', type: 'number', label: 'AdaLoRA mask 更新间隔', desc: '每隔多少步更新 rank mask。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_orth_reg_weight', type: 'number', label: 'AdaLoRA 正交正则权重', desc: '正交正则化权重，防止 rank collapse。', defaultValue: 0.5, min: 0, step: 0.1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_beta1', type: 'number', label: 'AdaLoRA β1', desc: '敏感度 EMA 衰减', defaultValue: 0.85, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_beta2', type: 'number', label: 'AdaLoRA β2', desc: '不确定性 EMA 衰减', defaultValue: 0.85, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adalora_enabled },
  { key: 'dokr_enabled', type: 'boolean', label: 'DoKr (DoRA + LoKr)', desc: 'LoKr Kronecker 方向 + DoRA magnitude', defaultValue: false },
  { key: 'dokr_factor_in', type: 'number', label: 'DoKr in 因子', desc: 'LoKr in 侧分解因子偏好 (0=默认 8)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_factor_out', type: 'number', label: 'DoKr out 因子', desc: 'LoKr out 侧分解因子偏好 (0=默认 8)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_decompose_factor', type: 'number', label: 'DoKr w2 低秩', desc: 'w2 低秩分解 rank (0=完整 w2)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_mode', type: 'select', label: 'DoKr 模式', desc: 'DoKr 模式', defaultValue: 'full', options: [{ value: 'full', label: 'full (完整)' }, { value: 'style', label: 'style (magnitude only)' }, { value: 'structure', label: 'structure (方向 only)' }], visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_alpha', type: 'number', label: 'DoKr alpha', desc: 'Kronecker scale 分子 (默认 1.0)。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.dokr_enabled },
  // GDLoKr 主入口在 lora_type/adapter_type 下拉；此处仅补子项，不重复 master 开关
  { key: 'gdlokr_factor', type: 'number', label: 'GDLoKr Kronecker 因子', desc: '共享 Kronecker 因子 (0=自动平衡)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  { key: 'gdlokr_mode', type: 'select', label: 'GDLoKr 模式', desc: 'GDLoKr 模式', defaultValue: 'full', options: [{ value: 'full', label: 'full (完整)' }, { value: 'style', label: 'style (magnitude only)' }, { value: 'structure', label: 'structure (方向 only)' }], visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  { key: 'gdlokr_alpha', type: 'number', label: 'GDLoKr alpha', desc: 'generalized-direction 缩放分子 (默认', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  // 区域多 LoRA 的 10 个参数曾经住在这里。它们是 GenerationRequest 的字段，训练配置上
  // 只剩 reader-free 的兼容别名，所以放在训练页等于让用户调一组无人读取的旋钮。现在归
  // 出图页（pages/generate），键名统一为 regional_lora_*，开关是 regions 本身而非布尔。
  { key: 'delta_lora_enabled', type: 'boolean', label: 'Delta-LoRA (ΔBA 动态缩放)', desc: 'ΔBA 动态缩放 LoRA 更新，提升表达力。', defaultValue: false },
  { key: 'dora_enabled', type: 'boolean', label: 'DoRA (权重分解)', desc: '分解权重为方向+幅度，比标准 LoRA 表达力强但稍慢。', defaultValue: false },
  { key: 'dora_mode', type: 'select', label: 'DoRA 模式', desc: '实现模式。full=完整分解', defaultValue: 'full', options: [{ value: 'full', label: 'full' }, { value: 'wd', label: 'wd (legacy/full)' }, { value: 'split', label: 'split' }, { value: 'merged', label: 'merged' }], visibleWhen: (c) => c.dora_enabled },
  { key: 'dora_variant', type: 'select', label: 'DoRA 方案', desc: 'classic=标准 DoRA；lulynx_stopgrad_dora=前向值相同的 stop-gradient 工程变体。', defaultValue: 'classic', options: [{ value: 'classic', label: '标准 DoRA' }, { value: 'lulynx_stopgrad_dora', label: 'lulynx Stop-Gradient DoRA' }], visibleWhen: doraEnabled },
  { key: 'dora_init_scale', type: 'number', label: 'DoRA 初始化缩放', desc: 'magnitude 初始化缩放', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.dora_enabled },
  { key: 'dora_use_scalar_magnitude', type: 'boolean', label: 'DoRA 标量 magnitude', desc: '用标量 magnitude 代替向量。', defaultValue: false, visibleWhen: (c) => c.dora_enabled },
  { key: 'dora_normalize_magnitude', type: 'boolean', label: 'DoRA 归一化 magnitude', desc: '对 magnitude 做归一化。', defaultValue: true, visibleWhen: (c) => c.dora_enabled },
  { key: 'hydralora_enabled', type: 'boolean', label: 'HydraLoRA (多分支)', desc: '多分支 LoRA + 分支平衡损失。', defaultValue: false },
  { key: 'hydralora_num_experts', type: 'number', label: 'Hydra 专家数', desc: '多分支专家数量', defaultValue: 4, min: 2, step: 1, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_routing', type: 'select', label: 'Hydra 路由', desc: '专家路由策略', defaultValue: 'top_k', options: [{ value: 'top_k', label: 'top_k' }, { value: 'soft', label: 'soft' }], visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_top_k', type: 'number', label: 'Hydra top-k', desc: '每次激活的专家数', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_sparse_top_k', type: 'boolean', label: 'Hydra 稀疏 top-k', desc: '仅计算选中专家。', defaultValue: false, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_balance_loss_weight', type: 'number', label: 'Hydra 平衡损失权重', desc: '分支平衡损失权重', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'reslora_enabled', type: 'boolean', label: 'ResLoRA (跨层残差)', desc: '跨 block 残差 shortcut。', defaultValue: false },
  { key: 'reslora_mode', type: 'select', label: 'ResLoRA 模式', desc: 'shortcut 合并模式', defaultValue: 'block_shortcut', options: [
    { value: 'block_shortcut', label: 'block_shortcut' },
    { value: 'input_shortcut', label: 'input_shortcut' },
    { value: 'middle_shortcut', label: 'middle_shortcut' },
  ], visibleWhen: (c) => c.reslora_enabled },
  { key: 'reslora_window', type: 'number', label: 'ResLoRA 窗口', desc: '残差 shortcut 回看的 block 数 (1=近似 no-op)。', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.reslora_enabled },
  { key: 'reslora_alpha_star', type: 'number', label: 'ResLoRA alpha*', desc: 'input/middle shortcut 合并系数。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.reslora_enabled },
  { key: 'tensorring_lora_enabled', type: 'boolean', label: 'T-LoRA (Tensor-Ring)', desc: 'Tensor-Ring 分解 W*=W₀T+Δ，单步 fused', defaultValue: false },
  { key: 'tensorring_trm_rank', type: 'number', label: 'TensorRing TRM rank', desc: 'TRM 变换 rank (0/≤rank → 低秩 I+UVᵀ', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'tensorring_tr_rank', type: 'number', label: 'TensorRing residual rank', desc: 'TensorRing residual rank', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'tensorring_factor', type: 'number', label: 'TensorRing 因子', desc: '2-mode 分解尺寸 f (0=自动选 in&out 公约数)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'krona_enabled', type: 'boolean', label: 'KronA (Kronecker 分解)', desc: 'ΔW=scale·kron(w1,w2)，参数比 LoRA 少。', defaultValue: false },
  { key: 'krona_factor_in', type: 'number', label: 'KronA in 因子', desc: 'in 侧分解因子 (0=默认 4)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_factor_out', type: 'number', label: 'KronA out 因子', desc: 'out 侧分解因子 (0=默认 64)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_allora', type: 'boolean', label: 'KronA 模块级 ALLoRA', desc: 'per-output-channel 梯度归一化。', defaultValue: false, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_allora_eta', type: 'number', label: 'KronA ALLoRA eta', desc: 'ALLoRA 梯度缩放强度', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.krona_enabled && c.krona_allora },
  { key: 'krona_weight_decompose', type: 'boolean', label: 'KronA DoRA 分解', desc: '在 KronA 上叠加 DoRA magnitude', defaultValue: false, visibleWhen: (c) => c.krona_enabled },
  { key: 'cdka_enabled', type: 'boolean', label: 'CDKA (Component-Designed Kronecker)', desc: 'KronA 改进，不对称分解 + alpha 缩放。', defaultValue: false },
  { key: 'cdka_alpha', type: 'number', label: 'CDKA alpha', desc: '缩放 = alpha/sqrt(in_n) (0→scale=1.0)。', defaultValue: 16.0, min: 0, step: 0.5, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_factor_in', type: 'number', label: 'CDKA r2 (in 因子)', desc: 'r2 (0=默认 8)', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_factor_out', type: 'number', label: 'CDKA r1 (out 因子)', desc: 'r1 (0=默认 2)', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_allora', type: 'boolean', label: 'CDKA 模块级 ALLoRA', desc: 'per-output-channel 梯度归一化。', defaultValue: false, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_weight_decompose', type: 'boolean', label: 'CDKA DoRA 分解', desc: '在 CDKA 上叠加 DoRA magnitude 分解。', defaultValue: false, visibleWhen: (c) => c.cdka_enabled },
  { key: 'tc_lora_enabled', type: 'boolean', label: 'TC-LoRA (时间条件)', desc: '时间条件 LoRA hypernetwork。', defaultValue: false },
  { key: 'tc_lora_hidden_dim', type: 'number', label: 'TC-LoRA hidden', desc: '共享 hypernetwork 隐层宽度。', defaultValue: 128, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_time_embed_dim', type: 'number', label: 'TC-LoRA 时间嵌入维', desc: 'timestep embedding 宽度。', defaultValue: 64, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_generation_mode', type: 'select', label: 'TC-LoRA 生成模式', desc: '当前运行时仅支持 gated', defaultValue: 'gated', options: [{ value: 'gated', label: 'gated' }], visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_condition_enabled', type: 'boolean', label: 'TC-LoRA 条件编码', desc: '启用 condition-y 编码器。', defaultValue: false, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_cond_channels', type: 'number', label: 'TC-LoRA 条件通道', desc: '条件 latent/control 通道数。', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.tc_lora_enabled && c.tc_lora_condition_enabled },
  { key: 'tc_lora_cond_dim', type: 'number', label: 'TC-LoRA 条件维', desc: '送入 hypernetwork 的全局条件码宽度。', defaultValue: 64, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled && c.tc_lora_condition_enabled },
  { key: 'lora2_adaptive_enabled', type: 'boolean', label: 'LoRA2 Adaptive (自动 Rank 选择)', desc: '指数衰减权重自动学习最优 rank。', defaultValue: false },
  { key: 'lora2_adaptive_r_max', type: 'number', label: 'LoRA2 最大 rank', desc: '最大 rank (实际有效 rank 自动学习)。', defaultValue: 64, min: 4, max: 512, step: 4, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'lora2_adaptive_nu_init', type: 'number', label: 'LoRA2 nu 初始值', desc: 'nu 初始值 (控制衰减速度，推荐 1.0)。', defaultValue: 1.0, min: 0.1, max: 10.0, step: 0.1, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'lora2_adaptive_decay_lambda', type: 'number', label: 'LoRA2 衰减系数', desc: '指数衰减系数 λ (推荐 1.0)。', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'lora2_adaptive_rank_threshold', type: 'number', label: 'LoRA2 有效 rank 阈值', desc: '计算有效 rank 时的权重阈值。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'ed_lora_enabled', type: 'boolean', label: 'ED-LoRA (Embedding Decomposed)', desc: 'Text embedding 分解为 V=V_rand+V_class', defaultValue: false },
  { key: 'ed_lora_decomp_dim', type: 'number', label: 'ED-LoRA 分解维度', desc: 'Embedding 分解维度 (推荐 64)。', defaultValue: 64, min: 32, max: 256, step: 8, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_num_layers', type: 'number', label: 'ED-LoRA 层数', desc: 'Text encoder transformer 层数', defaultValue: 12, min: 6, max: 24, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_alpha', type: 'number', label: 'ED-LoRA Alpha', desc: 'V_class 缩放因子 (推荐 1.0)。', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_sequence_length', type: 'number', label: 'ED-LoRA 序列长度', desc: 'Token 序列长度（CLIP 标准 77）。', defaultValue: 77, min: 1, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_num_concepts', type: 'number', label: 'ED-LoRA 概念数', desc: '概念数量（多概念预留）', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  // merge-time 融合（非训练循环）；挂在 ED-LoRA 旁便于发现
  { key: 'merge_ed_lora_fusion', type: 'boolean', label: 'ED-LoRA 合并融合', desc: '导出/合并路径启用梯度下降式权重融合。不进训练循环，', defaultValue: false },
  { key: 'ed_lora_fusion_steps', type: 'number', label: '融合步数', desc: '每次 merge 的梯度下降步数。', defaultValue: 30, min: 1, step: 1, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'ed_lora_fusion_lr', type: 'number', label: '融合学习率', desc: '融合优化器学习率', defaultValue: 0.001, min: 0, step: 0.0001, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'ed_lora_fusion_rank', type: 'number', label: '融合 Rank', desc: '合并后 adapter rank。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'ed_lora_fusion_alpha', type: 'number', label: '融合 Alpha', desc: '合并后 adapter alpha（scale=alpha/rank）。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'vera_enabled', type: 'boolean', label: 'VeRA (向量重参数化)', desc: '共享随机矩阵 + 可学习向量，参数量远小于 LoRA。', defaultValue: false },
  { key: 'vera_d_initial', type: 'number', label: 'VeRA d 初值', desc: '可学习缩放向量 d 的初始化值', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.vera_enabled },
  { key: 'vera_prng_key', type: 'number', label: 'VeRA PRNG 种子', desc: '共享随机矩阵的 PRNG 种子', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.vera_enabled },
  { key: 'mora_enabled', type: 'boolean', label: 'MoRA（方阵适配器）', desc: '用 r×r 方阵 + 非学习 compress/decompress 替代 BA。参数量 r²；非 A1111 原生 LoRA 格式，导出为 mora_matrix 或 materialize。与 DoRA/AdaLoRA 互斥。', defaultValue: false },
];

// ── σ 深度调度（步内条件深度，非 LR/数据调度；实验）────────────────────────────
export const S_SIGMA_DEPTH_SCHEDULE = [
  { key: 'sigma_depth_schedule_enabled', type: 'boolean', label: 'σ 深度调度', desc: '按当前样本 RF σ 调度本步 DiT 计算深度；跳过的 block 走 identity 残差旁路（不断 grad）。与 Vortex Aircon 正交。', defaultValue: false },
  { key: 'sigma_depth_schedule_mode', type: 'select', label: 'σ 深度模式', desc: 'hard_depth=按 σ 决定最大深度；soft_prob=深度边界后软概率跳过。', defaultValue: 'hard_depth', options: [{ value: 'hard_depth', label: 'hard_depth' }, { value: 'soft_prob', label: 'soft_prob' }], visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_alpha', type: 'number', label: 'σ 深度 α', desc: 'sigmoid 斜率；越大深度随 σ 变化越陡。', defaultValue: 8.0, min: 0.1, step: 0.1, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_beta', type: 'number', label: 'σ 深度 β', desc: 'sigmoid 中心（RF σ ∈ [0,1]）。', defaultValue: 0.35, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_min_blocks_kept', type: 'number', label: '最少保留 Block', desc: '始终计算前 N 个 block，保护浅层稳定性。', defaultValue: 4, min: 0, step: 1, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
];

// ── DiT BlockSkip 训练时计算裁剪 ──────────────────────────────────────────────
export const S_DIT_BLOCKSKIP = [
  { key: 'dit_compute_reducer_strategy', type: 'select', label: 'DiT BlockSkip', desc: '按计划跳过部分 DiT block 计算', defaultValue: 'none', options: [
    { value: 'none', label: '关闭 (none)' },
    { value: 'blockskip', label: 'BlockSkip' },
  ] },
  { key: 'dit_compute_reducer_skip_ratio', type: 'number', label: 'BlockSkip 比例', desc: '按比例推导跳过频率', defaultValue: 0.25, min: 0, max: 0.95, step: 0.05, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_skip_every', type: 'number', label: '固定跳过间隔', desc: '每 N 个候选 block 跳过 1 个。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_warmup_steps', type: 'number', label: 'BlockSkip 预热步数', desc: '前 N 个训练 step 不启用 blockskip，只做完整前向。', defaultValue: 4, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_min_block', type: 'number', label: '最小生效 Block', desc: '小于该索引的前层 block 永不跳过，用来保护浅层稳定性。', defaultValue: 1, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
];

// ── 感知锚 / 频域纹理损失 ─────────────────────────────────────────────────────
export const S_PERCEPTUAL_ANCHOR_LOSS = [
  { key: 'lulynx_freq_texture_enabled', type: 'boolean', label: '频域纹理损失', desc: 'latent 频域纹理损失，参与 loss 拆分', defaultValue: false },
  { key: 'lulynx_freq_texture_weight', type: 'number', label: '频域纹理权重', desc: '损失权重', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_highpass_sigma', type: 'number', label: '频域纹理高通 σ', desc: '高斯模糊 sigma，用于高低频分离。', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_min_t', type: 'number', label: '频域纹理最小 σ', desc: '仅 raw σ≥该值时计入', defaultValue: 0.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_max_t', type: 'number', label: '频域纹理最大 σ', desc: '仅 raw σ≤该值时计入', defaultValue: 1.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_latent_anchor_enabled', type: 'boolean', label: 'Latent 感知锚', desc: 'Latent 感知锚', defaultValue: false },
  { key: 'lulynx_latent_anchor_weight', type: 'number', label: '感知锚权重', desc: '损失权重', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_perceptor', type: 'select', label: '感知锚 Perceptor', desc: 'latent 感知锚特征后端', defaultValue: 'latent_msgrad', options: [
    { value: 'latent_msgrad', label: 'latent_msgrad' },
  ], visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_grad_scales', type: 'number', label: '感知锚多尺度层数', desc: '多尺度梯度匹配金字塔深度', defaultValue: 3, min: 1, max: 8, step: 1, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_min_t', type: 'number', label: '感知锚最小 σ', desc: '仅在 raw σ≥该值时计入', defaultValue: 0.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_max_t', type: 'number', label: '感知锚最大 σ', desc: '仅在 raw σ≤该值时计入', defaultValue: 1.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
];

// ── 采样与优化储备 ────────────────────────────────────────────────────────────
export const S_SAMPLING_OPTIMIZATION_RESERVE = [
  { key: 'adaptive_loss_weighting_enabled', type: 'boolean', label: '自适应损失加权 (learnable SNR γ)', desc: '可学习 SNR gamma 替代固定 min-SNR。', defaultValue: false },
  { key: 'adaptive_loss_weighting_lr', type: 'number', label: '自适应加权学习率', desc: '自适应损失加权参数的学习率', defaultValue: 0.001, min: 0, step: 0.0001, visibleWhen: (c) => c.adaptive_loss_weighting_enabled },
  { key: 'adaptive_loss_weighting_init_gamma', type: 'number', label: '自适应加权初始 γ', desc: 'learnable SNR gamma 初值。', defaultValue: 5.0, min: 0, step: 0.1, visibleWhen: (c) => c.adaptive_loss_weighting_enabled },
  { key: 'ant_enabled', type: 'boolean', label: 'ANT 自适应时间步采样', desc: 'per-σ-bin loss EMA → loss-driven 采样', defaultValue: false },
  { key: 'ant_num_bins', type: 'number', label: 'ANT σ 分桶数', desc: 'sigma 分桶数量', defaultValue: 50, min: 4, step: 1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_warmup_updates', type: 'number', label: 'ANT 预热更新数', desc: '前 N 次 update 返回 uniform（统计未稳）。', defaultValue: 30, min: 0, step: 1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_blend', type: 'number', label: 'ANT 混合比', desc: 'loss-driven 与 uniform 混合 (1=纯', defaultValue: 0.7, min: 0, max: 1, step: 0.1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_temperature', type: 'number', label: 'ANT 温度', desc: '采样权重平坦度 (>1 更平, <1 更尖)。', defaultValue: 1.0, min: 0.1, step: 0.1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_ema_decay', type: 'number', label: 'ANT EMA 衰减', desc: 'per-σ-bin loss EMA 衰减率。', defaultValue: 0.95, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.ant_enabled },
  { key: 'bp_low_enabled', type: 'boolean', label: 'BP-low 低分辨率反传', desc: '高噪声 step 降采样 loss 省显存。', defaultValue: false },
  { key: 'bp_low_factor', type: 'number', label: 'BP-low 下采样倍数', desc: '下采样倍数。2=半分辨率', defaultValue: 2, min: 2, max: 4, step: 1, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_noise_threshold', type: 'number', label: 'BP-low 噪声阈值', desc: '仅 sigma 高于该阈值时下采样。', defaultValue: 0.5, min: 0.1, max: 0.9, step: 0.05, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_scale', type: 'number', label: 'BP-low 时间步量纲', desc: '1.0=raw σ∈[0,1]；1000.0=legacy σ·1000。', defaultValue: 1.0, min: 0, step: 1, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_schedule', type: 'select', label: 'BP-low 调度', desc: 'step=硬阈值；cosine=平滑过渡。', defaultValue: 'step', options: [{ value: 'step', label: 'step' }, { value: 'cosine', label: 'cosine' }], visibleWhen: (c) => c.bp_low_enabled },
  { key: 'distillation_enabled', type: 'boolean', label: '蒸馏 (DP-DMD / AnyFlow)', desc: '少步 student 对齐多步 teacher。会显著变慢且更吃显存，不是 lulynx 加速开关。当前只有短周期执行证据，不代表质量、收敛或 16GB 发布可用性。', defaultValue: false },
  { key: 'distillation_mode', type: 'select', label: '蒸馏模式', desc: 'dp_dmd_turbo=主少步路径；anyflow=flow-matching 一致性蒸馏（非加速开关）。', defaultValue: 'dp_dmd_turbo', options: [{ value: 'dp_dmd_turbo', label: 'dp_dmd_turbo（推荐少步）' }, { value: 'anyflow', label: 'anyflow（FM 一致性）' }], visibleWhen: (c) => c.distillation_enabled },
  { key: 'dp_dmd_variant', type: 'select', label: 'DP-DMD 实现模式', desc: 'lulynx_optimized=历史 teacher-regression；standard=需要真实双 score provider，缺失时后端 fail-fast。', defaultValue: 'lulynx_optimized', options: [{ value: 'lulynx_optimized', label: 'lulynx 优化模式' }, { value: 'standard', label: '标准 DP-DMD' }], visibleWhen: (c) => c.distillation_enabled && String(c.distillation_mode || 'dp_dmd_turbo') === 'dp_dmd_turbo' },
  { key: 'distillation_student_steps', type: 'number', label: 'Student 步数', desc: 'student ODE 步数（常见 1–8）。步数越少越「少步叙事」，越难对齐。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_teacher_steps', type: 'number', label: 'Teacher 步数', desc: 'teacher ODE 步数（≥ student）。teacher 越大越慢、越贵。', defaultValue: 28, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_guidance_scale', type: 'number', label: '蒸馏 CFG', desc: 'teacher target bake 的 CFG 强度（非推理加速）。DP-DMD 家族据此推导是否 bake：≠1.0 即开启；AnyFlow 用它下面的独立 CFG bake 开关。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_objective', type: 'select', label: '蒸馏目标标识', desc: '与 mode 对齐的 objective 记录用；请与蒸馏模式保持一致。', defaultValue: 'dp_dmd_turbo', options: [{ value: 'dp_dmd_turbo', label: 'dp_dmd_turbo' }, { value: 'anyflow', label: 'anyflow' }], visibleWhen: (c) => c.distillation_enabled },
  // AnyFlow 独立键（mode=anyflow 时覆盖/补充 distillation_* 通用步数）
  { key: 'anyflow_student_steps', type: 'number', label: 'AnyFlow student 步数', desc: 'AnyFlow 专用 student ODE 步数；覆盖通用 student 时以本字段为准。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_teacher_steps', type: 'number', label: 'AnyFlow teacher 步数', desc: 'AnyFlow 专用 teacher ODE 步数；越大越慢。', defaultValue: 28, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_cfg_bake', type: 'boolean', label: 'AnyFlow CFG bake', desc: 'AnyFlow 专用 CFG bake。', defaultValue: false, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_x0_endpoint_weight', type: 'number', label: 'AnyFlow x0 端点权重', desc: 'x0-endpoint match 权重；0=关闭。不用于加速。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'distillation_prediction_type', type: 'select', label: '蒸馏预测类型', desc: 'student/teacher 对齐的预测目标类型。', defaultValue: 'velocity', options: [
    { value: 'velocity', label: 'velocity' },
    { value: 'epsilon', label: 'epsilon' },
    { value: 'sample', label: 'sample' },
  ], visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_diversity_anchor_weight', type: 'number', label: '蒸馏多样性锚权重', desc: '多样性锚损失权重；0=关闭', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_fake_critic_weight', type: 'number', label: '蒸馏假 critic 权重', desc: 'fake critic 对抗项权重；0=关闭。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_fake_critic_margin', type: 'number', label: '蒸馏假 critic margin', desc: 'fake critic 的 margin。', defaultValue: 0.05, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_fake_critic_weight || 0) > 0 },
  { key: 'distillation_softrank_weight', type: 'number', label: 'SoftRank 权重', desc: '蒸馏 SoftRank 正则权重；0=关闭。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_softrank_k', type: 'number', label: 'SoftRank k', desc: 'SoftRank top-k', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_every_n', type: 'number', label: 'SoftRank 间隔', desc: '每 N 步计算一次 SoftRank。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_softness', type: 'number', label: 'SoftRank 软度', desc: 'SoftRank 软化系数', defaultValue: 0.25, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_pool_size', type: 'number', label: 'SoftRank 池大小', desc: 'SoftRank 采样池大小', defaultValue: 128, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_warmup_ratio', type: 'number', label: 'SoftRank 预热比例', desc: '训练前该比例步数不做 SoftRank。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  // TwinFlow RCGM few-step (parallel flags; not distillation_mode)
  { key: 'twinflow_enabled', type: 'boolean', label: 'TwinFlow (RCGM 少步)', desc: 'EMA-of-LoRA teacher + RCGM/real-velocity 少步叙事。步内多前向更慢更吃显存；。勿与 distillation 同开（同开时优先 distillation）。', defaultValue: false },
  { key: 'twinflow_weight', type: 'number', label: 'TwinFlow 权重', desc: 'aux 权重；真正生效需 weight>0（可试 0.5–1.0）。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_target_step_count', type: 'number', label: '目标少步数', desc: '1–4 叙事元数据；本包不替换产品采样器。', defaultValue: 2, min: 1, max: 8, step: 1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_estimate_order', type: 'number', label: 'RCGM 估计阶', desc: '≥2 会多一次 teacher 前向。默认 2。', defaultValue: 2, min: 1, max: 4, step: 1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_delta_t', type: 'number', label: 'RCGM Δt', desc: '递归一致性时间步长。', defaultValue: 0.01, min: 0, max: 0.5, step: 0.005, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_target_clamp', type: 'number', label: '目标 clamp', desc: 'RCGM 目标 abs clamp；0=不夹。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_enhanced_ratio', type: 'number', label: 'CFG 精炼比', desc: 'MVP 默认 0=关（省前向）。>0 预留。', defaultValue: 0.0, min: 0, max: 2, step: 0.05, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_require_ema', type: 'boolean', label: '要求 EMA teacher', desc: '默认开；关则允许未初始化 shadow 时 skip（不建议）。', defaultValue: true, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_adversarial_enabled', type: 'boolean', label: '对抗分支 (L_adv/L_rectify)', desc: '自对抗：EMA 一步 fake + 负时间语义 L_adv + 实/伪 rectify。显著更慢更吃前向；无外挂 discriminator；。', defaultValue: false, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_adversarial_weight', type: 'number', label: 'L_adv 权重', desc: 'fake→noise 速度 MSE 权重；需 adversarial 开且 >0 才进 loss。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled && c.twinflow_adversarial_enabled },
  { key: 'twinflow_rectify_weight', type: 'number', label: 'L_rectify 权重', desc: 'fake 轨迹对齐 real pred（real detach）权重。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled && c.twinflow_adversarial_enabled },
  { key: 'dop_enabled', type: 'boolean', label: 'DOP (差异输出保留)', desc: '保留基座输出差异，防灾难遗忘。', defaultValue: false },
  { key: 'dop_weight', type: 'number', label: 'DOP 权重', desc: 'DOP 正则权重', defaultValue: 0.1, step: 0.01, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_target', type: 'select', label: 'DOP 目标', desc: 'output=最终噪声预测；features=中间特征。', defaultValue: 'output', options: [{ value: 'output', label: 'output' }, { value: 'features', label: 'features' }], visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_start_step', type: 'number', label: 'DOP 起始步', desc: '从此优化步开始应用 DOP (0=立即)。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_interval', type: 'number', label: 'DOP 间隔', desc: '每 N 步应用一次 DOP (1=每步)。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_detach_reference', type: 'boolean', label: 'DOP 分离参考', desc: 'detach 参考输出（安全旋钮）。', defaultValue: true, visibleWhen: (c) => c.dop_enabled },
  { key: 'coreset_enabled', type: 'boolean', label: 'Coreset 重要性采样', desc: '基于损失历史的样本重要性采样 (easy/hard/toxic', defaultValue: false },
  { key: 'coreset_easy_weight', type: 'number', label: 'Coreset easy 权重', desc: '简单样本权重', defaultValue: 1.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_hard_weight', type: 'number', label: 'Coreset hard 权重', desc: '困难样本权重', defaultValue: 1.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_toxic_weight', type: 'number', label: 'Coreset toxic 权重', desc: '有毒/异常样本权重 (0=跳过)。', defaultValue: 0.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_classify_after', type: 'number', label: 'Coreset 分类起始步', desc: '累计多少步后开始分级', defaultValue: 500, min: 0, step: 10, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_auto_classify_after', type: 'number', label: 'Coreset 自动分类间隔', desc: '自动重分级间隔（步）；与 classify_after 配合。', defaultValue: 50, min: 0, step: 1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_easy_threshold', type: 'number', label: 'Coreset easy 阈值', desc: 'easy 分级阈值', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_hard_loss_threshold', type: 'number', label: 'Coreset hard 阈值', desc: 'hard 分级 loss 阈值', defaultValue: 1.5, min: 0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_toxic_std_threshold', type: 'number', label: 'Coreset toxic 标准差阈值', desc: 'toxic 分级标准差倍数', defaultValue: 3.0, min: 0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_report_enabled', type: 'boolean', label: 'Coreset 报告', desc: '输出 coreset 分级报告', defaultValue: true, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_report_top_k', type: 'number', label: 'Coreset 报告 top-k', desc: '报告中列出的 top-k 样本数。', defaultValue: 20, min: 1, step: 1, visibleWhen: (c) => c.coreset_enabled && c.coreset_report_enabled },
  { key: 'coreset_report_every_n_epochs', type: 'number', label: 'Coreset 报告间隔 epoch', desc: '每 N 个 epoch 写一次报告。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.coreset_enabled && c.coreset_report_enabled },
];

// ── TurboLoRA — 投机采样加速（推理加速储备）────────────────────────────────────
export const S_TURBO_LORA = [
  { key: 'turbo_lora_enabled', type: 'boolean', label: 'TurboLoRA Phase-1 草稿契约', desc: '实验性：只初始化 Anima velocity 草稿网络与 detached teacher packet；主训练蒸馏、trajectory replay 和推理加速尚未启用。', defaultValue: false },
  { key: 'turbo_lora_draft_steps', type: 'number', label: '草稿步数 K', desc: '每次投机的步数（推荐 3-5）', defaultValue: 4, min: 1, max: 8, step: 1, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_hidden_dim', type: 'number', label: '草稿网络宽度', desc: '草稿 DiT 隐层维度（越小越快，默认 512 ≈ 目标模型 1', defaultValue: 512, min: 128, max: 1024, step: 128, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_num_layers', type: 'number', label: '草稿网络层数', desc: '草稿 DiT Transformer 层数（默认 8）。', defaultValue: 8, min: 2, max: 16, step: 2, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_acceptance_threshold_high', type: 'number', label: '接受阈值（高噪声）', desc: '高噪声端（t=1）马氏距离接受阈值，越大越宽松。', defaultValue: 0.5, min: 0.1, max: 2.0, step: 0.05, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_acceptance_threshold_low', type: 'number', label: '接受阈值（低噪声）', desc: '低噪声端（t=0）马氏距离接受阈值，越小越严格。', defaultValue: 0.02, min: 0.005, max: 0.2, step: 0.005, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_distill_cosine_weight', type: 'number', label: '余弦对齐权重', desc: '蒸馏损失中余弦方向对齐项权重（0=纯MSE）。', defaultValue: 0.1, min: 0, max: 1.0, step: 0.05, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_distill_trajectory_ratio', type: 'number', label: '轨迹采样比例', desc: '蒸馏步骤中沿ODE轨迹采样的比例（后半程）。', defaultValue: 0.5, min: 0, max: 1.0, step: 0.1, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_checkpoint', type: 'string', label: '草稿网络检查点', desc: '预训练草稿网络路径（留空=随机初始化，训练中自动学习）。', defaultValue: '', visibleWhen: (c) => c.turbo_lora_enabled },
];

// ── REPA / SoftREPA / ReFT / LISA / PCGrad ────────────────────────────────────
export const S_REPA_RESERVE = [
  // 经典 REPA（与 SoftREPA 双入口；文案区分）
  { key: 'repa_enabled', type: 'boolean', label: 'REPA (经典表征对齐)', desc: '外挂视觉编码器对齐 DiT 中间特征。开启后通常更慢、更吃显存。', defaultValue: false },
  { key: 'repa_target_modules', type: 'string', label: 'REPA 目标模块', desc: '逗号分隔模块名。空 + 下方 auto 开 → 后端按族选单层 mid（省 hook 税）。', defaultValue: '', visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_loss_type', type: 'select', label: 'REPA 损失类型', desc: 'cosine / mse 等', defaultValue: 'cosine', options: [
    { value: 'cosine', label: 'cosine' },
    { value: 'mse', label: 'mse' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_loss_weight', type: 'number', label: 'REPA 损失权重', desc: '额外对齐 loss 权重；0≈不生效。建议从小权重试。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_projection_dim', type: 'number', label: 'REPA 投影维', desc: '0=不投影或按后端默认', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_stop_grad_target', type: 'boolean', label: 'REPA 目标 stop-grad', desc: '对齐目标侧不回传梯度。默认开启', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_target_provider', type: 'select', label: 'REPA 目标提供方', desc: '须选有效 provider；none 且无 target 时 fail-closed（不做伪 REPA）。dinov2/jina 更吃资源。', defaultValue: 'none', options: [
    { value: 'none', label: 'none（需其它 target）' },
    { value: 'latent_identity', label: 'latent_identity' },
    { value: 'jina_vision', label: 'jina_vision（税更高）' },
    { value: 'dinov2', label: 'dinov2' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_mode', type: 'select', label: 'REPA 对齐模式', desc: 'REPA 对齐模式', defaultValue: 'absolute', options: [
    { value: 'absolute', label: 'absolute' },
    { value: 'relational', label: 'relational' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_gram_weight', type: 'number', label: 'REPA Gram 权重', desc: 'relational 臂权重；0=回落 repa_loss_weight。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_gram_spatial_norm', type: 'boolean', label: 'REPA Gram 空间归一', desc: 'token L2 后再算 Gram。默认开。', defaultValue: true, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_patch_size', type: 'number', label: 'REPA DiT patch', desc: 'relational 可选 pool 用；anima 通常 2。', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_dinov2_model', type: 'string', label: 'DINOv2 hub 名', desc: 'provider=dinov2 时 torch.', defaultValue: 'dinov2_vits14', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'dinov2' },
  { key: 'repa_dinov2_path', type: 'string', label: 'DINOv2 本地路径', desc: '本地 hub 目录；空=尝试下载。默认空。', defaultValue: '', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'dinov2' },
  { key: 'repa_jina_path', type: 'string', label: 'Jina CLIP 路径', desc: '本地 jina-clip 目录或权重', defaultValue: '', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'jina_vision' },
  { key: 'repa_allow_text_fallback', type: 'boolean', label: 'REPA text 回落(legacy)', desc: '允许用 text embedding 冒充对齐（伪', defaultValue: false, visibleWhen: (c) => c.repa_enabled },
  // P0 负载可控（仅 repa_enabled 时显示）
  { key: 'repa_encoder_device', type: 'select', label: 'REPA 编码器设备', desc: 'DINOv2/Jina 权重所在设备。', defaultValue: 'cpu', options: [
    { value: 'cpu', label: 'cpu' },
    { value: 'cuda', label: 'cuda' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_capture_modules_auto', type: 'boolean', label: 'REPA 自动选 capture 层', desc: '目标模块为空时按模型族自动选单层 mid。', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_capture_max_layers', type: 'number', label: 'REPA 最大 capture 层数', desc: '最多装几个 DiT hook；loss 只用最后一层。默认 1。', defaultValue: 1, min: 0, max: 8, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_token_pool_size', type: 'number', label: 'REPA token 池化边长', desc: '对齐/Gram 前池化到 ≤N×N（16≈256', defaultValue: 16, min: 0, max: 64, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_encode_every_n_steps', type: 'number', label: 'REPA 视觉编码间隔步', desc: '每 N 步才 VAE decode + 编码器。默认 4 控 16G 税；1=每步最贵。', defaultValue: 4, min: 1, max: 64, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_encoder_image_size', type: 'number', label: 'REPA 编码器输入边长', desc: '0=编码器默认（dino≈224 / jina≈512）', defaultValue: 0, min: 0, max: 1024, step: 14, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_log_memory', type: 'boolean', label: 'REPA 首次打显存日志', desc: '第一次真正算 REPA loss 时打 shape / pool /', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  // SoftREPA
  { key: 'softrepa_enabled', type: 'boolean', label: 'SoftREPA (软表征对齐)', desc: 'REPA 软化版，按 schedule', defaultValue: false },
  { key: 'softrepa_schedule', type: 'select', label: 'SoftREPA schedule', desc: '权重随训练进度的调度方式', defaultValue: 'linear', options: [{ value: 'linear', label: 'linear' }, { value: 'cosine', label: 'cosine' }, { value: 'constant', label: 'constant' }], visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_min_weight', type: 'number', label: 'SoftREPA 最小权重', desc: 'schedule 起始权重', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_max_weight', type: 'number', label: 'SoftREPA 最大权重', desc: 'schedule 结束权重', defaultValue: 1.0, step: 0.01, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_sigma_min', type: 'number', label: 'SoftREPA sigma 下界', desc: '仅在该 sigma 窗口内对齐', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_sigma_max', type: 'number', label: 'SoftREPA sigma 上界', desc: '仅在该 sigma 窗口内对齐', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.softrepa_enabled },
  // ReFT
  { key: 'reft_enabled', type: 'boolean', label: 'ReFT', desc: 'Representation Fine-Tuning', defaultValue: false },
  { key: 'reft_target_modules', type: 'string', label: 'ReFT 目标模块', desc: '逗号分隔；空=后端默认', defaultValue: '', visibleWhen: (c) => c.reft_enabled },
  { key: 'reft_rank', type: 'number', label: 'ReFT Rank', desc: '干预低秩维度', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.reft_enabled },
  { key: 'reft_init_scale', type: 'number', label: 'ReFT 初始化缩放', desc: '干预矩阵初始缩放', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.reft_enabled },
  // LISA
  { key: 'lisa_enabled', type: 'boolean', label: 'LISA 稀疏激活', desc: '按比例稀疏激活参数子集。', defaultValue: false },
  { key: 'lisa_active_ratio', type: 'number', label: 'LISA 激活比例', desc: '每轮激活的参数比例', defaultValue: 0.2, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lisa_enabled },
  { key: 'lisa_interval', type: 'number', label: 'LISA 切换间隔', desc: '每隔 N 步重采样激活集', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.lisa_enabled },
  // PCGrad
  { key: 'pcgrad_enabled', type: 'boolean', label: 'PCGrad 多任务梯度', desc: '冲突梯度投影。', defaultValue: false },
  { key: 'pcgrad_conflict_threshold', type: 'number', label: 'PCGrad 冲突阈值', desc: '余弦相似度低于该值视为冲突', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.pcgrad_enabled },
  { key: 'pcgrad_reduction', type: 'select', label: 'PCGrad 归约', desc: 'mean / sum', defaultValue: 'mean', options: [
    { value: 'mean', label: 'mean' },
    { value: 'sum', label: 'sum' },
  ], visibleWhen: (c) => c.pcgrad_enabled },
];

// LayerSync — mid↔deep self-align, no external encoder
export const S_LAYERSYNC = [
  { key: 'layersync_enabled', type: 'boolean', label: 'LayerSync 层自对齐', desc: '同网络中间层对齐更深层（无外挂编码器）。可能略增激活显存；。', defaultValue: false },
  { key: 'layersync_weight', type: 'number', label: 'LayerSync 权重', desc: 'aux 权重；真正生效需 weight>0（建议试 0.2）。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_student_block', type: 'number', label: 'Student 块索引', desc: '0-based 较弱/中间层。-1=自动约 1/3 深度。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_teacher_block', type: 'number', label: 'Teacher 块索引', desc: '0-based 更深层（须 > student）。-1=自动约 2/3 深度。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_every_n_steps', type: 'number', label: 'LayerSync 间隔步', desc: '每 N 步算一次以控税。默认 1=每步。', defaultValue: 1, min: 1, max: 64, step: 1, visibleWhen: (c) => c.layersync_enabled },
];

// EasyControl v2 + legacy
export const S_EASYCONTROL = [
  { key: 'easycontrol_v2_enabled', type: 'boolean', label: 'EasyControl v2', desc: '双流条件控制（Anima faithful', defaultValue: false },
  { key: 'easycontrol_v2_cond_channels', type: 'number', label: '条件通道数', desc: '条件 latent/token 的最后一维；必须与缓存结构一致。', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_lora_rank', type: 'number', label: '条件 LoRA Rank', desc: 'EasyControl v2 条件分支的 LoRA rank。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_task_id', type: 'string', label: 'EasyControl 任务 ID', desc: '如 generic / colorize 等任务标识。', defaultValue: 'generic', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_kind', type: 'select', label: '控制类型', desc: '条件流形态', defaultValue: 'reference_latent', options: [
    { value: 'reference_latent', label: 'reference_latent' },
    { value: 'control_image', label: 'control_image' },
  ], visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_target_family', type: 'string', label: '目标族', desc: '空=从 model_type 推断。', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_cache_dir', type: 'folder', pickerType: 'folder', label: '条件缓存目录', desc: '条件 latent/特征缓存目录。', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_text_cache_dir', type: 'folder', pickerType: 'folder', label: '文本缓存目录', desc: '条件侧文本编码缓存', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_image_dir', type: 'folder', pickerType: 'folder', label: '控制图目录', desc: '控制图像根目录', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_suffix', type: 'string', label: '控制图后缀', desc: '配对控制图文件后缀', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_drop_p', type: 'number', label: '条件丢弃概率', desc: '训练时随机丢条件', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_noise_max', type: 'number', label: '条件噪声上限', desc: '条件 latent 加噪上限；0=不加。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_scale', type: 'number', label: 'EasyControl v2 强度', desc: '条件流缩放', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_match_target_bucket', type: 'boolean', label: '匹配目标 bucket', desc: '条件图对齐训练 bucket', defaultValue: false, visibleWhen: (c) => c.easycontrol_v2_enabled },
  // legacy EasyControl
  { key: 'easy_control_enabled', type: 'boolean', label: 'EasyControl (legacy)', desc: '旧版 EasyControl 入口。优先用 v2。', defaultValue: false },
  { key: 'easy_control_scale', type: 'number', label: 'Legacy 强度', desc: 'legacy 控制强度', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.easy_control_enabled },
  { key: 'easy_control_channels', type: 'number', label: 'Legacy 通道数', desc: '控制输入通道', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.easy_control_enabled },
];

// Pixel-space 训练（绕过 VAE）
export const S_PIXEL_SPACE = [
  { key: 'pixel_space_enabled', type: 'boolean', label: '像素空间训练', desc: '绕过 VAE 直接在像素空间监督。', defaultValue: false },
  { key: 'pixel_space_input_channels', type: 'number', label: '像素输入通道', desc: '通常 3=RGB', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_loss_type', type: 'select', label: '像素损失类型', desc: 'mse / l1 / lpips / hybrid。', defaultValue: 'mse', options: [
    { value: 'mse', label: 'mse' },
    { value: 'l1', label: 'l1' },
    { value: 'lpips', label: 'lpips' },
    { value: 'hybrid', label: 'hybrid' },
  ], visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_loss_weights', type: 'string', label: '像素损失权重 JSON', desc: '如 {"mse":1.0,"lpips":0.0}。', defaultValue: '{"mse":1.0,"lpips":0.0}', visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_augmentation_enabled', type: 'boolean', label: '像素空间增强', desc: '像素侧数据增强。', defaultValue: false, visibleWhen: (c) => c.pixel_space_enabled },
];

// ── Negative Semantic Regularization ─────────────────────────────────────────
export const S_NEGATIVE_SEMANTIC_REGULARIZATION = [
  { key: 'negative_semantic_regularization_enabled', type: 'boolean', label: '负面语义正则', desc: '训练时用负面提示词做 LoRA-on / LoRA-off 差异约束', defaultValue: false },
  { key: 'negative_semantic_prompt', type: 'textarea', label: '负面语义提示词', desc: '填写希望 LoRA 少学习或少强化的内容，例如 bad hands', defaultValue: '', visibleWhen: (c) => c.negative_semantic_regularization_enabled },
  { key: 'negative_semantic_regularization_weight', type: 'number', label: '负面语义正则权重', desc: '额外 loss 权重', defaultValue: 0.1, min: 0, max: 2, step: 0.01, visibleWhen: (c) => c.negative_semantic_regularization_enabled },
  { key: 'negative_semantic_regularization_mode', type: 'select', label: '负面语义正则模式', desc: '当前后端实现为 lora_delta：约束负面提示词下', defaultValue: 'lora_delta', options: [{ value: 'lora_delta', label: 'LoRA Delta (lora_delta)' }], visibleWhen: (c) => c.negative_semantic_regularization_enabled },
];

// ── 实验探针 ──────────────────────────────────────────────────────────────────
export const S_EXPERIMENTAL_PROBES = [
  { key: 'lulynx_ln_guard', type: 'boolean', label: 'LNGuard 归一化漂移保护', desc: '对训练中可学习的 LayerNorm/RMSNorm 缩放与偏置施加基线锚定；没有可训练 Norm 参数时安全 no-op。默认关闭。', defaultValue: false },
  { key: 'lulynx_ln_lambda', type: 'number', label: 'LNGuard 锚定强度', desc: 'LayerNorm/RMSNorm 参数偏离训练起点时的均方漂移权重。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: (c) => c.lulynx_ln_guard },
  { key: 'fera_enabled', type: 'boolean', label: 'FERA 探测', desc: '特征探测。', defaultValue: false },
  { key: 'fera_gate_init', type: 'number', label: 'FERA gate 初值', desc: 'FERA 门控初始化值', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.fera_enabled },
  { key: 'fim_scan_enabled', type: 'boolean', label: 'FIM 扫描', desc: 'Fisher 信息矩阵扫描', defaultValue: false },
  { key: 'fim_scan_calib_steps', type: 'number', label: 'FIM 校准步数', desc: '反向传播校准步数', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_r_min', type: 'number', label: 'FIM 最小 rank', desc: 'rank 下界', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_r_max', type: 'number', label: 'FIM 最大 rank', desc: 'rank 上界', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_suggest_ratio', type: 'number', label: 'FIM 建议层比例', desc: '标记 suggested 的层占比。', defaultValue: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'forgetting_probe_enabled', type: 'boolean', label: '遗忘探测', desc: '监测训练中的概念遗忘。', defaultValue: false },
  { key: 'forgetting_probe_interval', type: 'number', label: '遗忘探测间隔', desc: '每隔多少优化步探测一次', defaultValue: 50, min: 1, step: 1, visibleWhen: (c) => c.forgetting_probe_enabled },
  { key: 'forgetting_probe_num_anchors', type: 'number', label: '遗忘探测锚点数', desc: '用于对比的锚点样本数', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.forgetting_probe_enabled },
  { key: 'grad_cosine_enabled', type: 'boolean', label: '梯度余弦监测', desc: '梯度方向余弦监测（诊断）。', defaultValue: false },
  { key: 'flexrank_lora_enabled', type: 'boolean', label: 'FlexRank LoRA', desc: '弹性 rank LoRA（）。', defaultValue: false },
  { key: 'fractional_grad_damping_enabled', type: 'boolean', label: '分数梯度阻尼', desc: '分数阶梯度阻尼（）。', defaultValue: false },
  { key: 'fractional_grad_damping_order', type: 'number', label: '分数梯度阶数', desc: '分数阶阻尼阶数 α∈(0,1]', defaultValue: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.fractional_grad_damping_enabled },
  { key: 'fractional_grad_damping_window', type: 'number', label: '分数梯度窗口', desc: '阻尼历史窗口长度', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.fractional_grad_damping_enabled },
  // SmartRank（后端 smart_rank_*）：与 lulynx_smart_rank_*（实验核心 keep_ratio 裁剪）是不同键
  { key: 'smart_rank_enabled', type: 'boolean', label: 'SmartRank 动态区间', desc: '按间隔在 [min,max] 内调整有效 rank。', defaultValue: false },
  { key: 'smart_rank_interval', type: 'number', label: 'SmartRank 间隔', desc: '每隔多少步评估/调整 rank', defaultValue: 50, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'smart_rank_min', type: 'number', label: 'SmartRank 最小 rank', desc: '动态 rank 下界', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'smart_rank_max', type: 'number', label: 'SmartRank 最大 rank', desc: '动态 rank 上界', defaultValue: 128, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'sfad_enabled', type: 'boolean', label: 'SFAD 频率感知 dropout', desc: '按标签频率调节 caption tag dropout', defaultValue: false },
  { key: 'sfad_frequency_csv', type: 'string', label: 'SFAD 频率 CSV', desc: '标签频率表路径；留空用内置 danbooru_tags。', defaultValue: '', visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_drop_strength', type: 'number', label: 'SFAD 丢弃强度', desc: '频率指数；0≈均匀采样。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_trigger_protect', type: 'number', label: 'SFAD 触发词保护', desc: '受保护触发词的 drop-rate 底（0=永不丢）。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_warmup_steps', type: 'number', label: 'SFAD 预热步', desc: '触发词保护缓入的步数；0=立即', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sfad_enabled },
  { key: 'lulynx_svd_gradient_filter_enabled', type: 'boolean', label: 'lulynx SVD 梯度过滤', desc: '双侧低秩投影后重构全形状梯度；基础优化器状态仍为全尺寸，不是 GaLore。', defaultValue: false },
  { key: 'lulynx_svd_gradient_filter_rank', type: 'number', label: 'SVD 过滤 rank', desc: '梯度过滤子空间 rank', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_update_interval', type: 'number', label: 'SVD 基更新间隔', desc: '每 N 步重算投影基', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_scale', type: 'number', label: 'SVD 过滤缩放', desc: '过滤梯度缩放因子', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_warmup_steps', type: 'number', label: 'SVD 过滤预热', desc: '前 N 步用全梯度再启用过滤', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'compression_companion_enabled', type: 'boolean', label: '压缩伴生适配器', desc: '压缩前加载冻结 recovery adapter（bake 或 sidepath）；无 path 默认 fail-closed。', defaultValue: false },
  { key: 'compression_companion_path', type: 'string', label: '伴生适配器路径', desc: 'recovery adapter 文件路径。', defaultValue: '', visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_type', type: 'select', label: '伴生适配器类型', desc: '适配器类型标识', defaultValue: 'lora', options: [
    { value: 'lora', label: 'lora' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_mode', type: 'select', label: '伴生合并模式', desc: 'merge_into_base=烘焙进底座后重置可训槽；sidepath_frozen=冻结旁路叠加，不占训练槽。', defaultValue: 'merge_into_base', options: [
    { value: 'merge_into_base', label: '烘焙进底座 (merge_into_base)' },
    { value: 'sidepath_frozen', label: '冻结旁路 (sidepath_frozen)' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_scale', type: 'number', label: '伴生缩放', desc: 'merge/sidepath 时的缩放系数', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_auto_bootstrap', type: 'boolean', label: '缺 path 时 Phase-0 自举', desc: '无有效 path 时 prepare 前最多一次 product-fp8 residual 拟合并写回 path（default-off）。', defaultValue: false, visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_bootstrap_rank', type: 'number', label: '自举 SVD rank', desc: 'Phase-0 residual LoRA rank。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_bootstrap_max_layers', type: 'number', label: '自举层数上限', desc: '0=不截断（全相交 Linear）；>0 按 residual 取最大层。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_bootstrap_output_path', type: 'string', label: '自举输出路径', desc: '空则写入 output_dir/companion_bootstrap.safetensors。', defaultValue: '', visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_missing_policy', type: 'select', label: '无 path 策略', desc: 'fail=硬失败（默认，更安全）；downgrade_t1=关 companion 保留压缩并警告，不宣称已恢复精度。', defaultValue: 'fail', options: [
    { value: 'fail', label: '硬失败 (fail)' },
    { value: 'downgrade_t1', label: '降级 T1 (downgrade_t1)' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'vram_auto_tier', type: 'select', label: '低显存自动档', desc: '按显存/架构启发式写入压缩与伴生 knobs；T3 需强制。KPI=能训不 OOM。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'auto', label: '自动 (最高 T2)' },
    { value: 'T0', label: 'T0 稳态' },
    { value: 'T1', label: 'T1 平衡压缩' },
    { value: 'T2', label: 'T2 激进+旁路' },
    { value: 'T3', label: 'T3 极限 (需强制)' },
  ] },
  { key: 'vram_auto_tier_force_extreme', type: 'boolean', label: '允许 T3 极限档', desc: '未勾选时 auto/T3 会钳到 T2。', defaultValue: false, visibleWhen: (c) => c.vram_auto_tier === 'auto' || c.vram_auto_tier === 'T3' },
  { key: 'multi_aspect_guidance_enabled', type: 'boolean', label: '多维审美引导', desc: '按 style/character 等多维 scorer 引导', defaultValue: false },
  { key: 'multi_aspect_guidance_weight', type: 'number', label: '多维引导权重', desc: '总引导损失权重', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_adaptive_weights', type: 'boolean', label: '自适应维度权重', desc: '按维度自适应加权', defaultValue: true, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_aspect_weights', type: 'string', label: '维度权重 JSON', desc: '例如 {"style":1.0,"character":1.5}。', defaultValue: '', visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_custom_scorers', type: 'string', label: '自定义 scorer JSON', desc: '例如 {"style":"path/to', defaultValue: '', visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_default_scorer', type: 'select', label: '默认 scorer', desc: '未指定自定义 scorer 时使用。', defaultValue: 'latent_style_contrast', options: [
    { value: 'latent_style_contrast', label: 'latent_style_contrast' },
    { value: 'clip_text_similarity', label: 'clip_text_similarity' },
  ], visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_min_t', type: 'number', label: '多维引导 σ 下界', desc: '仅 raw σ≥该值时计入', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_max_t', type: 'number', label: '多维引导 σ 上界', desc: '仅 raw σ≤该值时计入', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'lr_finder_enabled', type: 'boolean', label: 'LR Finder', desc: '训练前扫学习率区间（工具向，）', defaultValue: false },
  { key: 'lr_finder_start_lr', type: 'number', label: 'LR Finder 起始 LR', desc: '扫描起始学习率', defaultValue: 1e-7, min: 0, step: 1e-8, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'lr_finder_end_lr', type: 'number', label: 'LR Finder 结束 LR', desc: '扫描结束学习率', defaultValue: 1e-1, min: 0, step: 1e-3, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'lr_finder_num_steps', type: 'number', label: 'LR Finder 步数', desc: '扫描步数', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'sds_lora_enabled', type: 'boolean', label: 'SDS-LoRA (无奇异值梯度)', desc: '双分支产出各向同性梯度，warmup SVD 重参数化。', defaultValue: false },
  { key: 'sds_lora_warmup_steps', type: 'number', label: 'SDS-LoRA warmup', desc: 'SVD 重参数前的 plain-LoRA 预热步。', defaultValue: 10, min: 0, step: 1, visibleWhen: (c) => c.sds_lora_enabled },
  { key: 'sds_lora_refresh_phases', type: 'number', label: 'SDS-LoRA QR 刷新阶段', desc: '全训练过程中 QR 刷新阶段数', defaultValue: 5, min: 1, step: 1, visibleWhen: (c) => c.sds_lora_enabled },
  { key: 'sds_lora_clear_optimizer_state', type: 'boolean', label: 'SDS-LoRA 清空动量', desc: '重参数时清理一次 optimizer momentum。', defaultValue: true, visibleWhen: (c) => c.sds_lora_enabled },
];

// ── 诊断与监控 ────────────────────────────────────────────────────────────────
export const S_DIAGNOSTICS_MONITORING = [
  { key: 'advanced_monitoring_enabled', type: 'boolean', label: '高级监控', desc: '训练过程高级监控（详细指标）。', defaultValue: false },
  { key: 'advanced_stats_enabled', type: 'boolean', label: '高级统计', desc: '额外训练统计。', defaultValue: false },
  { key: 'runtime_features_detail', type: 'select', label: '运行时统计输出', desc: '运行时统计输出', defaultValue: 'off', options: [{ value: 'off', label: '不输出（默认）' }, { value: 'compact', label: '精简' }, { value: 'full', label: '完整' }], visibleWhen: (c) => c.advanced_stats_enabled },
  { key: 'deep_diagnostics_enabled', type: 'boolean', label: '深度诊断', desc: '深度诊断模式（更多日志/探针）。', defaultValue: false },
  { key: 'layer_monitor_enabled', type: 'boolean', label: '逐层监测', desc: '逐层激活/梯度监测。', defaultValue: false },
  { key: 'layer_monitor_mode', type: 'select', label: '逐层监测模式', desc: 'sampled=抽样统计（更轻）；exact=全量统计（更准更慢）。', defaultValue: 'sampled', options: [
    { value: 'sampled', label: 'sampled（抽样）' },
    { value: 'exact', label: 'exact（全量）' },
  ], visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_interval', type: 'number', label: '监测间隔（优化步）', desc: '每 N 个优化步采样一次', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_max_layers', type: 'number', label: '最多监测层数', desc: '每轮最多统计多少层；0 表示不限制。', defaultValue: 10, min: 0, step: 1, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_sparsity_epsilon', type: 'number', label: '稀疏阈值 ε', desc: '绝对值低于此值的元素计为稀疏', defaultValue: 1e-8, min: 0, step: 1e-9, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_sample_size', type: 'number', label: '抽样元素数', desc: 'sampled 模式下每层最多抽样元素数。', defaultValue: 4096, min: 64, step: 64, visibleWhen: (c) => c.layer_monitor_enabled && String(c.layer_monitor_mode || 'sampled') === 'sampled' },
  { key: 'step_phase_profile_enabled', type: 'boolean', label: '步阶段 profiling', desc: '训练步各阶段耗时 profiling。', defaultValue: false },
];

// ── AutoController ────────────────────────────────────────────────────────────
export const S_AUTO_CONTROLLER = [
  { key: 'ac_enabled', type: 'boolean', label: '启用 AutoController', desc: '根据训练状态自动调整学习率、早停、TE 冻结等。旧配置中的 lulynx_auto_controller_* 仍会被后端识别。', defaultValue: false },
  { key: 'ac_enable_smart_early_stopping', type: 'boolean', label: '智能早停', desc: '损失长期不下降时自动停止训练', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_early_stopping_patience', type: 'number', label: '早停耐心值（步数）', desc: '多少步内无改善就触发早停', defaultValue: 5, min: 1, step: 1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_early_stopping', true)) },
  { key: 'ac_early_stopping_threshold', type: 'number', label: '早停阈值', desc: '损失改善小于此值视为无改善', defaultValue: 0.001, min: 0, step: 0.0001, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_early_stopping', true)) },
  { key: 'ac_enable_smart_lr_decay', type: 'boolean', label: '智能学习率衰减', desc: '损失平台期自动降低学习率', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_lr_decay_factor', type: 'number', label: '学习率衰减系数', desc: '触发衰减时学习率乘以此系数', defaultValue: 0.5, min: 0.1, max: 1, step: 0.05, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_lr_decay', true)) },
  { key: 'ac_max_decays', type: 'number', label: '最大衰减次数', desc: '学习率最多衰减多少次', defaultValue: 3, min: 1, step: 1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_lr_decay', true)) },
  { key: 'ac_enable_auto_te_freeze', type: 'boolean', label: '自动冻结文本编码器', desc: '训练到指定步数后自动冻结 TE', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_te_freeze_step', type: 'number', label: 'TE 冻结步数', desc: '在此步数后冻结文本编码器', defaultValue: 0, min: 0, step: 1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_auto_te_freeze', true)) },
  { key: 'ac_enable_dynamic_loss_scaling', type: 'boolean', label: '动态损失缩放', desc: '根据梯度范数动态调整损失缩放', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_enable_auto_lr_adjustment', type: 'boolean', label: '自动学习率调整', desc: '根据目标 GSNR/损失自动调整学习率。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_auto_lr_scale_factor', type: 'number', label: '自动学习率缩放因子', desc: '自动调整的学习率缩放系数', defaultValue: 1.0, min: 0.1, max: 10, step: 0.1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_auto_lr_adjustment', true)) },
  { key: 'ac_target_gsnr', type: 'number', label: '目标 GSNR', desc: '目标梯度信噪比', defaultValue: 5.0, min: 0, step: 0.5, visibleWhen: all(when('ac_enabled', true), when('ac_enable_auto_lr_adjustment', true)) },
  { key: 'ac_target_loss', type: 'number', label: '目标损失', desc: '期望目标损失值（0 不设目标）', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: all(when('ac_enabled', true), when('ac_enable_auto_lr_adjustment', true)) },
  { key: 'ac_warmup_steps', type: 'number', label: 'AutoController 预热步数', desc: '多少步后开始生效', defaultValue: 100, min: 0, step: 10, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_loss_plateau_window', type: 'number', label: '损失平台窗口', desc: '判断损失平台的滑动窗口大小（步数）。', defaultValue: 50, min: 10, step: 10, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_clip_drift_warning', type: 'number', label: 'CLIP 漂移警告阈值', desc: 'CLIP 漂移超过此值发出警告', defaultValue: 0.03, min: 0, step: 0.001, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_clip_drift_danger', type: 'number', label: 'CLIP 漂移危险阈值', desc: 'CLIP 漂移超过此值触发干预', defaultValue: 0.05, min: 0, step: 0.001, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_stable_rank_collapse_threshold', type: 'number', label: 'Stable Rank 崩溃阈值', desc: 'Stable Rank 下降超过此比例视为崩溃。', defaultValue: 0.3, min: 0, max: 1, step: 0.05, visibleWhen: when('ac_enabled', true) },
];

// ── Pattern Loss（频带损失）──────────────────────────────────────────────────
export const S_PATTERN_LOSS = [
  { key: 'pattern_loss_enabled', type: 'boolean', label: 'Pattern Loss (频带损失)', desc: '按 DWT 频带分别施加 loss（低频/高频）。', defaultValue: false },
  { key: 'pattern_loss_levels', type: 'number', label: 'Pattern Loss 分解层数', desc: 'DWT 分解层数', defaultValue: 1, min: 1, max: 4, step: 1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_ll_type', type: 'select', label: '低频 (LL) 损失类型', desc: '低频带损失函数', defaultValue: 'l2', options: [{ value: 'l2', label: 'l2' }, { value: 'l1', label: 'l1' }, { value: 'huber', label: 'huber' }], visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_ll_weight', type: 'number', label: '低频 (LL) 权重', desc: '低频带权重', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_type', type: 'select', label: '高频损失类型', desc: 'LH/HL/HH 高频带损失函数。', defaultValue: 'huber', options: [{ value: 'l2', label: 'l2' }, { value: 'l1', label: 'l1' }, { value: 'huber', label: 'huber' }], visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_weight', type: 'number', label: '高频权重', desc: '高频带权重', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_huber_c', type: 'number', label: '高频 Huber c', desc: '高频 huber 的 delta。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.pattern_loss_enabled && c.pattern_loss_high_type === 'huber' },
];

// ── Concept Geometry（数据集几何采样；不含 legacy h_lora_* 别名）────────────────
export const S_CONCEPT_GEOMETRY = [
  { key: 'concept_geometry_enabled', type: 'boolean', label: 'Concept Geometry', desc: '按概念几何图做采样/加权', defaultValue: false },
  { key: 'concept_geometry_path', type: 'string', label: '几何图路径', desc: '空=训练目录下 concept_geometry.', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_sampler_mode', type: 'select', label: '采样模式', desc: 'curriculum / density /', defaultValue: 'density_curriculum', options: [
    { value: 'curriculum', label: 'curriculum' },
    { value: 'density', label: 'density' },
    { value: 'density_curriculum', label: 'density_curriculum' },
    { value: 'concept_batch', label: 'concept_batch' },
  ], visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_loss_weighting', type: 'boolean', label: '几何损失加权', desc: '用几何密度派生 per-sample loss 权重。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_density_power', type: 'number', label: '密度幂次', desc: '采样/加权用的密度指数', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_compute_backend', type: 'select', label: '图计算后端', desc: 'auto=智能选择；native=Python；rust=性能优先。', defaultValue: 'auto', options: [
    { value: 'auto', label: 'auto' },
    { value: 'native', label: 'native' },
    { value: 'rust', label: 'rust' },
  ], visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_source_priority', type: 'string', label: '概念来源优先级', desc: '逗号分隔：explicit,folder,nl,identity', defaultValue: 'explicit,folder,nl,identity,tag,stem', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_alias_map', type: 'textarea', label: '别名映射 JSON', desc: 'prep 时概念/标签别名 JSON 文本。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_alias_map_path', type: 'string', label: '别名映射文件', desc: '可选 JSON 文件路径', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_semantic_enabled', type: 'boolean', label: '语义 embedding 增强', desc: 'prep 时用文本 embedding 增强几何。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_embedding_provider', type: 'select', label: 'Embedding 提供方', desc: 'local_path / auto_download / api。', defaultValue: 'local_path', options: [
    { value: 'local_path', label: 'local_path' },
    { value: 'auto_download', label: 'auto_download' },
    { value: 'api', label: 'api' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_backend', type: 'select', label: 'Embedding 后端', desc: 'pytorch / onnx（扩展点）。', defaultValue: 'pytorch', options: [
    { value: 'pytorch', label: 'pytorch' },
    { value: 'onnx', label: 'onnx' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_model', type: 'string', label: 'Embedding 模型 ID', desc: '如 BAAI/bge-m3', defaultValue: 'BAAI/bge-m3', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_model_path', type: 'string', label: 'Embedding 本地路径', desc: 'local_path 时使用', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_cache_dir', type: 'string', label: 'Embedding 缓存目录', desc: '下载/缓存目录', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_allow_download', type: 'boolean', label: '允许下载 Embedding', desc: '允许从网络拉取模型。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_api_base', type: 'string', label: 'Embedding API Base', desc: 'provider=api 时的 endpoint。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_api_key', type: 'string', label: 'Embedding API Key', desc: 'provider=api 时的密钥。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_api_model', type: 'string', label: 'Embedding API 模型名', desc: '远程 API 模型名', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_batch_size', type: 'number', label: 'Embedding 批量', desc: 'prep 批大小', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_device', type: 'select', label: 'Embedding 设备', desc: 'cpu / cuda', defaultValue: 'cpu', options: [
    { value: 'cpu', label: 'cpu' },
    { value: 'cuda', label: 'cuda' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_translation_enabled', type: 'boolean', label: '标签翻译', desc: 'prep 时可选翻译管线。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_translation_provider', type: 'select', label: '翻译提供方', desc: 'local_path / api。', defaultValue: 'local_path', options: [
    { value: 'local_path', label: 'local_path' },
    { value: 'api', label: 'api' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
  { key: 'concept_geometry_translation_model_path', type: 'string', label: '翻译模型路径', desc: 'local_path 时使用', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
  { key: 'concept_geometry_translation_api_base', type: 'string', label: '翻译 API Base', desc: 'provider=api', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_api_key', type: 'string', label: '翻译 API Key', desc: 'provider=api', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_api_model', type: 'string', label: '翻译 API 模型名', desc: '远程模型名', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_batch_size', type: 'number', label: '翻译批量', desc: 'prep 批大小', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
];

// ── IP-Adapter 条件注入 ───────────────────────────────────────────────────────
export const S_IP_ADAPTER = [
  { key: 'ip_adapter_enabled', type: 'boolean', label: 'IP-Adapter', desc: '图像条件注入（参考图引导）。', defaultValue: false },
  { key: 'ip_adapter_encoder_dim', type: 'number', label: 'IP-Adapter 编码维', desc: '图像编码器输出维', defaultValue: 1024, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_cond_dim', type: 'number', label: 'IP-Adapter 条件维', desc: '注入到主干的条件维', defaultValue: 1152, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_num_image_tokens', type: 'number', label: '图像 token 数', desc: '每图投影 token 数', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_scale', type: 'number', label: 'IP-Adapter 缩放', desc: '条件强度', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_cond_mode', type: 'select', label: '条件模式', desc: '条件融合方式', defaultValue: 'concat', options: [
    { value: 'concat', label: 'concat' },
  ], visibleWhen: (c) => c.ip_adapter_enabled },
];

// ── DPO 偏好对齐 ──────────────────────────────────────────────────────────────
export const S_DPO = [
  { key: 'dpo_enabled', type: 'boolean', label: 'DPO / Flow-DPO', desc: '偏好对齐。真正生效还需 dpo_weight>0。有 rejected_latents 真 pair 时走 Flow-DPO 四路 margin（同 noise/σ，更慢）；无 pair 时 velocity 弱代理（非完整产品）。非顶部加速。', defaultValue: false },
  { key: 'dpo_weight', type: 'number', label: 'DPO 权重', desc: 'DPO 损失总权重；后端以 weight>0 为门闩（仅开开关不够）。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_beta', type: 'number', label: 'DPO β', desc: '偏好温度/强度', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_pair_mode', type: 'string', label: 'Pair 模式', desc: 'auto=有 rejected_latents 走 Flow-DPO 否则弱代理；flow=强制真 pair（无则 skip）；proxy=强制弱代理。', defaultValue: 'auto', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_cache_dir', type: 'string', label: 'Rejected latent 缓存目录', desc: '按 stem 加载 lose 侧 clean latent 侧车；空=不从盘加载。需与 preferred 同 spatial。', defaultValue: '', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_filename_template', type: 'string', label: 'Rejected 文件名模板', desc: '须含 {stem}。默认 {stem}_rejected_anima.npz。', defaultValue: '{stem}_rejected_anima.npz', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_field', type: 'string', label: 'Rejected batch 字段', desc: 'batch 中真 pair clean latent 键名。', defaultValue: 'rejected_latents', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_required', type: 'boolean', label: 'Rejected 侧车必填', desc: '开且缺文件则 dataset 报错。', defaultValue: false, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_error_reduction', type: 'string', label: '误差归约', desc: 'Flow-DPO 预测误差 sum 或 mean。', defaultValue: 'sum', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_anchor_alpha', type: 'number', label: 'Anchor α', desc: 'policy≈ref 全局 MSE 正则；0=关。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_logprob_scale', type: 'number', label: 'DPO logprob 尺度', desc: '弱代理路径：velocity Gaussian 密度中的 σ_dpo²。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_perturb', type: 'number', label: 'Rejected 扰动幅度', desc: '弱代理：自构造 rejected target 的扰动强度。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_preference_pair_field', type: 'string', label: 'Rejected target 字段', desc: '弱代理：batch 中显式 rejected velocity target 字段；空=自构造。与真 pair latent 不同。', defaultValue: '', visibleWhen: (c) => c.dpo_enabled },
];

// ── SRA2-HASTE 表征对齐储备 ───────────────────────────────────────────────────
export const S_SRA2_HASTE = [
  { key: 'sra2_haste_enabled', type: 'boolean', label: 'SRA2-HASTE', desc: '中间层表征对齐（HASTE 调度）。', defaultValue: false },
  { key: 'sra2_haste_capture_layers', type: 'string', label: '捕获层后缀', desc: '逗号分隔的 module-name 后缀。', defaultValue: '', visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_loss_type', type: 'select', label: '对齐损失类型', desc: 'cosine / l2 / l1。', defaultValue: 'cosine', options: [
    { value: 'cosine', label: 'cosine' },
    { value: 'l2', label: 'l2' },
    { value: 'l1', label: 'l1' },
  ], visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_base_weight', type: 'number', label: '基础权重', desc: '对齐损失基础权重', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_start_step', type: 'number', label: '起始步', desc: '从此优化步开始', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_stop_step', type: 'number', label: '结束步', desc: '-1=不提前结束', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_decay_start_step', type: 'number', label: '衰减起始步', desc: '-1=不衰减', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_decay_end_step', type: 'number', label: '衰减结束步', desc: '衰减到 min_weight 的终点。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_min_weight', type: 'number', label: '最小权重', desc: '衰减后的下限', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_plateau_patience', type: 'number', label: '平台耐心', desc: '0=关闭平台早停', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_min_relative_improvement', type: 'number', label: '最小相对改进', desc: '平台判定阈值', defaultValue: 0.0, min: 0, step: 0.001, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_normalize_targets', type: 'boolean', label: '归一化 target', desc: '对齐前对 target 做归一化。', defaultValue: true, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_stop_grad_target', type: 'boolean', label: 'target 停梯度', desc: '对 target 侧 stop-grad。', defaultValue: true, visibleWhen: (c) => c.sra2_haste_enabled },
];

// ── Adaptive Caching（Vortex Aircon 智能块跳过）────────────────────────────────
export const S_ADAPTIVE_CACHING = [
  { key: 'adaptive_caching_enabled', type: 'boolean', label: 'Adaptive Caching', desc: '训练时按变化率智能跳过部分 block（Aircon）。', defaultValue: false },
  { key: 'adaptive_caching_threshold_base', type: 'number', label: '阈值基线', desc: '变化率基线阈值（会随进度/梯度调制）。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_threshold_decay', type: 'number', label: '阈值衰减', desc: '时间步衰减（高 σ 更宽松）', defaultValue: 0.5, min: 0, step: 0.05, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_ema_momentum', type: 'number', label: 'EMA 动量', desc: '变化率 EMA 平滑', defaultValue: 0.9, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_min_blocks_computed', type: 'number', label: '最少计算 block 数', desc: '每步至少完整计算的 block 数（稳定护栏）。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.adaptive_caching_enabled },
];

// ── 预览采样探针（FSG / T-GATE / Spectrum / SmoothCache probe）────────────────
// 与产品入口 sample_cache_seam_* 并存；探针默认关，apply/skip 才真正改行为。
export const S_SAMPLE_PROBES = [
  { key: 'spd_enabled', type: 'boolean', label: 'SPD 多分辨率预览采样', desc: '仅影响训练预览/推理 sampler，不进入训练 loss；默认关闭。', defaultValue: false },
  { key: 'spd_scale_factors', type: 'string', label: 'SPD 分辨率层级', desc: '逗号分隔缩放比例，例如 0.5,1.0。', defaultValue: '0.5,1.0', visibleWhen: (c) => c.spd_enabled },
  { key: 'spd_steps_per_level', type: 'string', label: 'SPD 每层步数', desc: '逗号分隔；留空时按预览总步数自动分配。', defaultValue: '', visibleWhen: (c) => c.spd_enabled },
  { key: 'spd_resize_mode', type: 'select', label: 'SPD Resize 模式', desc: 'latent 多分辨率插值方式。', defaultValue: 'bilinear', options: ['nearest', 'bilinear', 'bicubic'], visibleWhen: (c) => c.spd_enabled },
  { key: 'sample_fsg_probe', type: 'boolean', label: 'FSG 探针', desc: '频带引导探针。', defaultValue: false },
  { key: 'sample_fsg_band_start', type: 'number', label: 'FSG 频带起点', desc: 'σ 频带起点', defaultValue: 0.45, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_band_end', type: 'number', label: 'FSG 频带终点', desc: 'σ 频带终点', defaultValue: 0.85, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_k', type: 'number', label: 'FSG k', desc: 'FSG 阶/组数', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_d_sigma', type: 'number', label: 'FSG d_sigma', desc: 'σ 扰动步长', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_gamma', type: 'number', label: 'FSG gamma', desc: '引导强度', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_apply', type: 'boolean', label: 'FSG 真正应用', desc: '关=只探针；开=改采样轨迹', defaultValue: false, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_tgate_probe', type: 'boolean', label: 'T-GATE 探针', desc: '交叉注意力复用探针。', defaultValue: false },
  { key: 'sample_tgate_start_step', type: 'number', label: 'T-GATE 起始步', desc: '从此采样步开始考虑复用', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_tgate_min_block', type: 'number', label: 'T-GATE 最小 block', desc: '小于该索引的 block 不跳过。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_tgate_skip', type: 'boolean', label: 'T-GATE 真正跳过', desc: '关=默认路径；开=真实 cross-attn 复用。', defaultValue: false, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_spectrum_probe', type: 'boolean', label: 'Spectrum 探针', desc: '块缓存线性外推探针（与预览加速 seam 独立）。', defaultValue: false },
  { key: 'sample_spectrum_window_size', type: 'number', label: 'Spectrum 窗口', desc: '历史窗口大小', defaultValue: 2.0, min: 1, step: 0.5, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_flex_window', type: 'number', label: 'Spectrum 柔性窗口', desc: '柔性窗口系数', defaultValue: 0.25, min: 0, step: 0.05, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_warmup_steps', type: 'number', label: 'Spectrum 预热步', desc: '预热采样步数', defaultValue: 6, min: 0, step: 1, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_stop_caching_step', type: 'number', label: 'Spectrum 停缓存步', desc: '-1=不提前停', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_smoothcache_probe', type: 'boolean', label: 'SmoothCache 探针', desc: '误差引导缓存探针。', defaultValue: false },
  { key: 'sample_smoothcache_warmup_steps', type: 'number', label: 'SmoothCache 预热步', desc: '预热采样步数，预热内不跳过', defaultValue: 2, min: 0, step: 1, visibleWhen: (c) => c.sample_smoothcache_probe },
];

// ── TurboCore ─────────────────────────────────────────────────────────────────
// 主开关在顶栏（turbocore_enabled）；本页为高级参数。不重复暴露大开关。
// 不暴露 turbocore_update_shadow_* / turbocore_native_update_* 诊断族。
export const S_TURBOCORE = [
  { key: 'turbocore_enabled', type: 'hidden', defaultValue: false },
  { key: 'turbocore_mode', type: 'select', label: 'TurboCore 模式（开发者选项）', desc: '由顶栏启用 TurboCore 后生效。', defaultValue: 'off', options: [
    { value: 'off', label: 'off（关闭）' },
    { value: 'profile', label: 'profile（性能分析）' },
    { value: 'native_experimental', label: 'native_experimental（加速）' },
  ] },
  { key: 'turbocore_tuned_kernel_disable', type: 'boolean', label: '禁用自动调优内核', desc: '关闭 TurboCore 自动调优内核（全局开关）', defaultValue: false },
  { key: 'turbocore_profile', type: 'select', label: 'TurboCore 性能档位', desc: 'basic=基础;balanced=平衡', defaultValue: 'basic', options: [
    { value: 'basic', label: 'Basic (基础)' },
    { value: 'balanced', label: 'Balanced (平衡)' },
    { value: 'aggressive', label: 'Aggressive (激进)' },
  ] },
  { key: 'turbocore_allow_fallback', type: 'boolean', label: '允许回退到 PyTorch', desc: '优化内核不可用时自动回退，建议保持开启。', defaultValue: true },
  { key: 'turbocore_strict', type: 'boolean', label: '严格模式', desc: '优化内核失败时报错而非回退，用于调试。', defaultValue: false },
  { key: 'turbocore_workspace_mb', type: 'number', label: 'Workspace 大小 (MB)', desc: '0 = 自动分配', defaultValue: 0, min: 0, step: 64 },
  { key: 'turbocore_prefetch_depth', type: 'number', label: '预取深度', desc: '预取队列深度，默认 2，增加可隐藏延迟但增加显存。', defaultValue: 2, min: 1, max: 8, step: 1 },
  { key: 'turbocore_features', type: 'textarea', label: '启用功能列表', desc: '额外启用的优化功能（逗号分隔），留空=使用 profile 默认。', defaultValue: '' },
  { key: 'turbocore_disable', type: 'textarea', label: '禁用功能列表', desc: '要禁用的优化功能（逗号分隔），用于排查兼容性问题。', defaultValue: '' },
];
