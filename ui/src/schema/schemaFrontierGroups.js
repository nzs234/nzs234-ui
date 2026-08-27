// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// schemaFrontierGroups.js — 通用前沿/训练增强字段组（anima / sdxl / newbie 共用）
// 所有字段均 默认关闭，无 arch 依赖，可在任意训练类型的 training/frontier/expert section 引用。
import { all, doraEnabled, uiGroup, when } from './schemaCommon.js';

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
  { key: 'progressive_training_enabled', type: 'boolean', label: '启用渐进式 / 分阶段训练', desc: '按优化进度切换训练阶段（阶段 LR/LoRA 模块/课程策略）。建议长周期精调项目使用，短训收益有限。', defaultValue: false },
  { key: 'progressive_phase_schedule', type: 'textarea', label: 'Phase Schedule JSON', desc: 'JSON 数组或 {"phases": [...]}。每个阶段支持 start/end（0~1）、lr_scale、module_policy、difficulty_policy、timestep_policy 等字段；留空使用单阶段兼容默认值。', defaultValue: '', visibleWhen: when('progressive_training_enabled', true) },
  { key: 'progressive_curriculum_seed', type: 'number', label: '课程策略随机种子', desc: '阶段内课程难度选择种子，相同 seed 可复现。推荐范围：固定 42（默认）即可。', defaultValue: 42, min: 0, step: 1, visibleWhen: when('progressive_training_enabled', true) },
];

// P5 observational controllers. Metrics and hard-sample mining emit resumable
// events and suggestions only; neither controller mutates the training policy.
export const S_ADAPTIVE_TRAINING = [
  { key: 'adaptive_training_enabled', type: 'boolean', label: '启用自适应训练控制', desc: '关闭时保持经典固定训练，不创建控制器；开启后可选择建议或受约束自动调整。', defaultValue: false },
  { key: 'adaptive_rank_enabled', type: 'boolean', label: '启用模块级自适应 Rank', desc: '按模块敏感度在固定总预算内分配 Rank；关闭时保持现有统一 Rank。', defaultValue: false },
  { key: 'adaptive_rank_mode', type: 'select', label: 'Rank 分配策略', desc: '模块级动态 rank 策略：静态注入前分配；动态按梯度证据周期迁移并保留优化器状态。建议 off 起步。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'auto_static', label: '静态自动分配' },
    { value: 'dynamic', label: '训练中动态分配' },
  ], visibleWhen: when('adaptive_rank_enabled', true) },
  { key: 'adaptive_rank_total_budget', type: 'number', label: 'Rank 总预算', desc: '所有模块 rank 总和上限；0 按当前预算。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_min_rank', type: 'number', desc: '单个模块 rank 下限。推荐范围： 1–4。', label: '模块最小 Rank', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_max_rank', type: 'number', desc: '单个模块 rank 上限。推荐范围：不超过 network_dim。', label: '模块最大 Rank', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_locked_modules_json', type: 'textarea', label: '锁定模块 JSON', desc: '可选。锁定指定模块 Rank，不参与预算重分配。支持模块名数组或模块到 Rank 的映射。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_probe_window', type: 'number', label: 'Rank 探测窗口', desc: '累计多少次梯度观测形成稳定敏感度。推荐范围： 32（默认）。', defaultValue: 32, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_ema_decay', type: 'number', label: '敏感度 EMA 衰减', desc: '敏感度 EMA 衰减，高平滑低灵敏。推荐范围： 0.9（默认）。', defaultValue: 0.9, min: 0, max: 0.9999, step: 0.01, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_warmup_steps', type: 'number', label: 'Rank 调整预热步数', desc: '预热内只采样不迁移。推荐范围： 0 或短预热。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_reallocation_interval', type: 'number', label: 'Rank 重分配间隔', desc: '动态模式重评估间隔步数。推荐范围： 100（默认）。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_min_delta', type: 'number', label: 'Rank 最小变更量', desc: '小于该差值不迁移 rank，减少形状抖动。推荐范围： 1。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode === 'dynamic' },
  { key: 'adaptive_rank_profile_json', type: 'textarea', label: 'Rank 敏感度 Profile JSON', desc: '静态自动分配可选的离线 profile；动态模式留空则使用训练中采集的敏感度。该能力仍处于实验验证阶段，需同参数 A/B 后再作为推荐配置。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_rank_profile_path', type: 'file', pickerType: 'text-file', label: 'Rank Profile 文件', desc: '可选离线敏感度 profile 文件；显式 JSON 与文件只需提供一种。', defaultValue: '', visibleWhen: (c) => c.adaptive_rank_enabled && c.adaptive_rank_mode !== 'off' },
  { key: 'adaptive_training_strategy', type: 'select', label: '训练策略', desc: '经典固定不创建 controller；建议模式只记录动作；受限自动仅调整学习率/区域权重；完整自动才允许 Rank/模块冻结接口。', defaultValue: 'fixed', options: [
    { value: 'fixed', label: '经典固定' },
    { value: 'suggest', label: '自适应建议' },
    { value: 'auto_limited', label: '受限自动调整' },
    { value: 'auto_full', label: '完整自动调整' },
  ], visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_objective', type: 'select', desc: '控制器优化目标（balanced 平衡等）。建议 balanced。', label: '优化目标', defaultValue: 'balanced', options: [
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
  { key: 'adaptive_training_metrics_enabled', type: 'boolean', label: '采集训练指标', desc: '记录 loss/区域 loss/梯度范数等指标事件流。建议保持开启（默认 true）。', defaultValue: true, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_metrics_interval', type: 'number', label: '指标采样间隔', desc: '指标事件采样间隔步数。推荐范围： 1（默认）。', defaultValue: 1, min: 1, step: 1, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_training_interval_steps', type: 'number', label: '控制调整间隔', desc: '控制器评估动作的最小间隔步数。推荐范围： 50（默认）。', defaultValue: 50, min: 1, max: 100000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_minimum_evidence', type: 'number', label: '最小证据数', desc: '产生动作前需要的最少证据数。推荐范围： 3（默认）。', defaultValue: 3, min: 1, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_patience', type: 'number', label: '下降耐心', desc: '质量分连续下降多少次触发收敛修正。推荐范围： 2（默认）。', defaultValue: 2, min: 1, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_max_actions', type: 'number', desc: '单次训练最多执行的动作数。推荐范围： 8（默认）。', label: '最大调整次数', defaultValue: 8, min: 0, max: 1000, step: 1, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_learning_rate_min', type: 'number', desc: '自动 LR 的下限钳制。推荐范围： 1e-8（默认）。', label: '学习率下限', defaultValue: 0.00000001, min: 0, step: 0.00000001, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_learning_rate_max', type: 'number', desc: '自动 LR 的上限钳制。推荐范围： 1.0（默认）。', label: '学习率上限', defaultValue: 1, min: 0.00000001, step: 0.000001, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_learning_rate_step', type: 'number', label: '学习率调整比例', desc: '下降时乘的比例（0.01–1）。推荐范围： 0.8 温和收缩。', defaultValue: 0.8, min: 0.01, max: 1, step: 0.01, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('learning_rate') },
  { key: 'adaptive_training_region_weight_min', type: 'number', desc: '区域权重下限。推荐范围： 0.1。', label: '区域权重下限', defaultValue: 0.1, min: 0, max: 64, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_region_weight_max', type: 'number', desc: '区域权重上限。推荐范围： 4。', label: '区域权重上限', defaultValue: 4, min: 0.01, max: 64, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_region_weight_step', type: 'number', desc: '区域权重每次调整步长。推荐范围： 0.1。', label: '区域权重步长', defaultValue: 0.1, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_adjustments?.includes('region_weight') },
  { key: 'adaptive_training_locked_items', type: 'multiSelect', label: '用户锁定项', desc: '锁定后控制器不会修改这些项。建议把已手调满意的项锁住。', defaultValue: [], options: [
    { value: 'learning_rate', label: '学习率' },
    { value: 'region_weight', label: '区域权重' },
    { value: 'rank', label: 'Rank' },
    { value: 'module_freeze', label: '模块冻结/解冻' },
    { value: 'overfit_protection', label: '过拟合保护' },
  ], visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_rollback_on_decline', type: 'boolean', label: '质量下降时允许撤销', desc: '验证分下降时撤销最近可逆动作。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.adaptive_training_enabled && c.adaptive_training_strategy !== 'fixed' },
  { key: 'adaptive_training_event_history', type: 'number', label: '事件历史长度', desc: '内存/resume 中保留的事件条数。推荐范围： 256（默认）。', defaultValue: 256, min: 16, max: 4096, step: 16, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_sample_mining_enabled', type: 'boolean', label: '启用困难样本建议', desc: '按样本 loss 的 EMA 生成困难样本建议。', defaultValue: false, visibleWhen: when('adaptive_training_enabled', true) },
  { key: 'adaptive_sample_mining_interval', type: 'number', label: '困难样本采样间隔', desc: '汇总样本 loss 的间隔步数。推荐范围： 10（默认）。', defaultValue: 10, min: 1, max: 10000, step: 1, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_ema_decay', type: 'number', desc: '困难度 EMA 衰减。推荐范围： 0.9。', label: '困难度 EMA 衰减', defaultValue: 0.9, min: 0, max: 0.9999, step: 0.01, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_top_fraction', type: 'number', desc: '标记为困难样本的比例上限。推荐范围： 0.25。', label: '困难样本比例', defaultValue: 0.25, min: 0.01, max: 1, step: 0.01, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_report_limit', type: 'number', desc: '建议报告列表长度上限。推荐范围： 32。', label: '建议列表上限', defaultValue: 32, min: 1, max: 256, step: 1, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'adaptive_sample_mining_max_samples', type: 'number', desc: '样本状态容量（条）。推荐范围： 2048。', label: '样本状态容量', defaultValue: 2048, min: 16, max: 100000, step: 16, visibleWhen: all(when('adaptive_training_enabled', true), when('adaptive_sample_mining_enabled', true)) },
  { key: 'loss_state_enabled', type: 'boolean', label: '启用逐图 Loss 状态机', desc: '逐图 Loss 状态机：跨 epoch 跟踪每个样本状态并合入难度权重。建议排查坏图时开启。', defaultValue: false },
  { key: 'loss_state_fusion_mode', type: 'select', desc: '状态结果与权重的融合模式（loss 主导等）。建议 loss 默认。', label: 'Loss 状态融合模式', defaultValue: 'loss', options: [
    { value: 'loss', label: '仅 Loss' },
    { value: 'loss+aesthetic', label: 'Loss + 审美分位' },
  ], visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_aesthetic_weight', type: 'number', desc: '审美分融合强度。推荐范围： 0 关闭起步。', label: '审美融合强度', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.loss_state_enabled && c.loss_state_fusion_mode === 'loss+aesthetic' },
  { key: 'loss_state_num_bins', type: 'number', desc: '时间步分桶数。推荐范围： 32（默认）。', label: '时间步分桶数', defaultValue: 32, min: 2, max: 256, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_healthy_quantile', type: 'number', desc: '健康残差分位线。推荐范围： 0.4。', label: '健康残差分位', defaultValue: 0.4, min: 0, max: 1, step: 0.05, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_watching_rise_epochs', type: 'number', desc: '观察确认所需 epoch 数。推荐范围： 1。', label: '观察确认 Epoch', defaultValue: 1, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lrugged_votes', type: 'number', desc: '退化确认票数。推荐范围： 3。', label: '退化确认票数', defaultValue: 3, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_plateau_slope', type: 'number', desc: '判定饱和的斜率阈值。推荐范围： 0.001。', label: '饱和斜率阈值', defaultValue: 0.001, min: 0, max: 1, step: 0.0001, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_warmup_window', type: 'number', desc: '升温窗口长度。推荐范围： 3。', label: '升温窗口', defaultValue: 3, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lost_votes', type: 'number', desc: '卡死追加票数。推荐范围： 2。', label: '卡死追加票数', defaultValue: 2, min: 1, max: 32, step: 1, visibleWhen: when('loss_state_enabled', true) },
  { key: 'loss_state_lrugged_hits', type: 'number', desc: '平坦高位阈值（残差高位占比）。推荐范围： 0.9。', label: '平坦高位阈值', defaultValue: 0.9, min: 0, max: 1, step: 0.05, visibleWhen: when('loss_state_enabled', true) },
];

// Region-focus product recipe layered on semantic region spatial weights (default-off).
// Full semantic mask editor still lives in the classic UI; this exposes the focus knobs.
export const S_REGION_FOCUS = [
  { key: 'region_focus_enabled', type: 'boolean', label: '区域聚焦配方', desc: '在语义区域权重上叠加聚焦强度×步程衰减。开启时后端会强制启用语义区域加权。', defaultValue: false },
  { key: 'region_focus_strength', type: 'number', label: '聚焦强度', desc: '区域权重相对 1.0 偏差的放大强度；1=按表原样。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_decay', type: 'boolean', label: '聚焦随进度衰减', desc: '聚焦强度随训练进度线性衰减到 floor。建议保持 true（默认）后期稳住整体。', defaultValue: true, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_floor', type: 'number', label: '聚焦衰减地板', desc: '进度末尾的强度倍率下限。推荐范围： 0.25。', defaultValue: 0.25, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_decay },
  { key: 'region_focus_coverage_balance', type: 'boolean', label: '低覆盖率再平衡', desc: '目标区域像素占比过低时提高该区域 loss 权重（不删步）。建议小主体大数据集开启。', defaultValue: false, visibleWhen: (c) => c.region_focus_enabled },
  { key: 'region_focus_coverage_target', type: 'number', label: '覆盖率目标', desc: '低于该像素占比启动 boost。推荐范围： 0.05（默认）附近。', defaultValue: 0.05, min: 0.001, max: 1, step: 0.01, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_coverage_balance },
  { key: 'region_focus_coverage_max_boost', type: 'number', label: '覆盖率 boost 上限', desc: '低覆盖 boost 上限倍率。推荐范围： 2（默认）。', defaultValue: 2.0, min: 1, max: 8, step: 0.1, visibleWhen: (c) => c.region_focus_enabled && c.region_focus_coverage_balance },
];

// P2 unified per-sample WeightComposer. Every axis is opt-in and the runtime
// normalizes the composed product to mean 1, avoiding an accidental global LR scale change.
export const S_WEIGHT_COMPOSER = [
  { key: 'timestep_weighting_enabled', type: 'boolean', label: '启用时间步权重', desc: '按扩散时间步调整样本 loss，可与区域/噪声/难度权重相乘。建议明确想偏重结构或细节时开启。', defaultValue: false },
  { key: 'timestep_weighting_mode', type: 'select', label: '时间步侧重', desc: '时间步侧重方向（低噪偏细节/高噪偏结构；标定 LUT 离线自标定）。建议 uniform 起步。', defaultValue: 'uniform', options: [
    { value: 'uniform', label: '均匀（不倾斜）' },
    { value: 'low', label: '低时间步' },
    { value: 'high', label: '高时间步' },
    { value: 'middle', label: '中间时间步' },
    { value: 'extremes', label: '两端时间步' },
    { value: 'lut', label: '标定表 (LUT)' },
  ], visibleWhen: (c) => c.timestep_weighting_enabled },
  { key: 'timestep_weighting_strength', type: 'number', label: '时间步权重强度', desc: '时间步权重强度：0 恒等，1 标准倾斜，上限 4。推荐范围：组合多轴时 0.25–1。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode !== 'uniform' },
  { key: 'timestep_weighting_lut_path', type: 'file', pickerType: 'text-file', label: '时间步标定表路径', desc: 'lulynx.timestep-lut.v1 JSON/npz；缺表时 fail-soft 回均匀。', defaultValue: '', visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode === 'lut' },
  { key: 'timestep_weighting_lut_id', type: 'string', label: '时间步标定表 ID', desc: '可选资产 id；path 优先。', defaultValue: '', visibleWhen: (c) => c.timestep_weighting_enabled && c.timestep_weighting_mode === 'lut' },
  { key: 'noise_weighting_enabled', type: 'boolean', label: '启用噪声强度权重', desc: '优先使用 sigma；DDPM 路线自动从 alpha_cumprod 推导噪声强度。', defaultValue: false },
  { key: 'noise_weighting_mode', type: 'select', label: '噪声侧重', desc: '噪声侧重轴：低噪声偏细节、高噪声偏结构。建议 uniform 起步，观察出图短板再倾斜。', defaultValue: 'uniform', options: [
    { value: 'uniform', label: '均匀（不倾斜）' },
    { value: 'low', label: '低噪声 / 细节' },
    { value: 'high', label: '高噪声 / 结构' },
    { value: 'middle', label: '中等噪声' },
    { value: 'extremes', label: '噪声两端' },
  ], visibleWhen: (c) => c.noise_weighting_enabled },
  { key: 'noise_weighting_strength', type: 'number', label: '噪声权重强度', desc: '噪声权重强度：0 不改变，1 标准倾斜，上限 4。推荐范围：组合多轴时 0.25–1。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.noise_weighting_enabled && c.noise_weighting_mode !== 'uniform' },
  { key: 'sample_difficulty_weighting_enabled', type: 'boolean', label: '启用样本难度权重', desc: '用数据集难度权重或 batch loss 自动强调难/简单样本。建议默认关闭，确认权重来源可靠后开。', defaultValue: false },
  { key: 'sample_difficulty_weighting_mode', type: 'select', desc: '难度来源策略（provided 用数据集自带 / auto 按 loss）。建议 provided 优先。', label: '样本难度策略', defaultValue: 'provided', options: [
    { value: 'provided', label: '使用数据集权重' },
    { value: 'hard', label: '强调困难样本' },
    { value: 'easy', label: '强调简单样本' },
  ], visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_metadata_path', type: 'file', pickerType: 'text-file', label: '样本难度元数据', desc: '可选 JSON 文件。留空时自动读取 <train_data_dir>/sample_difficulty.json；显式路径会覆盖自动路径。', defaultValue: '', visibleWhen: (c) => c.sample_difficulty_weighting_enabled && c.sample_difficulty_weighting_mode === 'provided' },
  { key: 'sample_difficulty_weighting_strength', type: 'number', label: '难度权重强度', desc: '难度加权强度：0 不改变，1 标准倾斜。推荐范围：组合多轴时从 0.25–1 开始。', defaultValue: 1.0, min: 0, max: 4, step: 0.05, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_weighting_min', type: 'number', desc: '难度权重下限。推荐范围：0.25（默认）。', label: '样本权重下限', defaultValue: 0.25, min: 0, max: 16, step: 0.05, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
  { key: 'sample_difficulty_weighting_max', type: 'number', desc: '难度权重上限。推荐范围：4（默认）。', label: '样本权重上限', defaultValue: 4.0, min: 0.01, max: 64, step: 0.1, visibleWhen: (c) => c.sample_difficulty_weighting_enabled },
];

// dataset_intelligence_* 属于数据集侧(离线 Manifest 驱动采样/权重),不是权重合成器的
// opt-in 轴。原先混在 S_WEIGHT_COMPOSER 里 —— 而且只有 React 侧混进去了,legacy 从来
// 没有过这批字段 —— 既让"统一权重组合"多出第 4 个开关,也让用户在权重面板里找数据集设置。
// 现在由 schemaIndex 挂进各族已有的 dataset-settings section,不另立新组。
export const S_DATASET_INTELLIGENCE = [
  { key: 'dataset_intelligence_enabled', type: 'boolean', label: '启用数据集智能 Manifest', desc: '离线统一分析质量/Caption/难度/区域覆盖与概念稀有度并生成 Manifest，训练期只读 Manifest 不再加载检测模型。建议正式训练前开启做一次体检。', defaultValue: false },
  { key: 'dataset_intelligence_manifest_path', type: 'file', pickerType: 'text-file', label: '数据智能 Manifest', desc: '标准 lulynx.dataset_intelligence_manifest.v1 JSON。留空不会阻断经典训练。', defaultValue: '', visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_sampling_mode', type: 'select', desc: 'Manifest 驱动的采样策略（fixed 顺序 / 课程等）。建议 fixed 起步，验证 Manifest 质量后再切课程。', label: '数据采样策略', defaultValue: 'fixed', options: [
    { value: 'fixed', label: '固定采样' },
    { value: 'curriculum', label: '课程学习：简单 → 普通 → 困难' },
  ], visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_seed', type: 'number', label: '采样 Seed', desc: '采样计划种子：相同 Manifest+epoch+seed 得到相同计划。推荐范围：固定以便复现。', defaultValue: 0, min: 0, step: 1, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_min_weight', type: 'number', label: '数据样本权重下限', desc: '样本权重下限（防过度抑制难例）。推荐范围：0.25（默认）。', defaultValue: 0.25, min: 0, max: 64, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_max_weight', type: 'number', label: '数据样本权重上限', desc: '样本权重上限（防难例主导）。推荐范围：4（默认）。', defaultValue: 4.0, min: 0.01, max: 64, step: 0.1, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_curriculum_easy_end', type: 'number', label: '简单阶段终点', desc: '课程式训练：进度达到该比例前偏向简单样本。推荐范围：0.33（默认）。', defaultValue: 0.33, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dataset_intelligence_enabled && c.dataset_intelligence_sampling_mode === 'curriculum' },
  { key: 'dataset_intelligence_curriculum_normal_end', type: 'number', label: '普通阶段终点', desc: '达到该比例后逐步开放困难样本；不得小于简单阶段终点。推荐范围：0.66（默认）。', defaultValue: 0.66, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dataset_intelligence_enabled && c.dataset_intelligence_sampling_mode === 'curriculum' },
  { key: 'dataset_intelligence_region_balance_strength', type: 'number', desc: '按区域覆盖率平衡采样，缓解背景区主导。推荐范围：0 关闭；0.5–2 试探。', label: '区域覆盖率平衡', defaultValue: 0.0, min: 0, max: 4, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_concept_rarity_strength', type: 'number', desc: '按概念稀有度平衡采样权重，缓解高频概念淹没稀有概念。推荐范围：0 关闭；0.5–2 渐进试探。', label: '概念稀有度平衡', defaultValue: 0.0, min: 0, max: 4, step: 0.05, visibleWhen: when('dataset_intelligence_enabled', true) },
  { key: 'dataset_intelligence_target_caption_language', type: 'select', desc: 'Manifest caption 的目标语言（auto 跟随数据）。建议 auto；统一语言评测时显式指定。', label: 'Caption 目标语言', defaultValue: 'auto', options: [
    { value: 'auto', label: '保持原语言 / 自动' },
    { value: 'zh', label: '中文' },
    { value: 'latin', label: '拉丁字母语言' },
  ], visibleWhen: when('dataset_intelligence_enabled', true) },
];
export const S_QUALITY_OPTIMIZATION_PACK = [
  { key: 'scale_guidance_mode', type: 'select', label: 'Scale Guidance 模式', desc: '一键引导训练侧重不同尺度（off 关闭）。建议 off 起步按需选档。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭 (默认)' },
    { value: 'detail', label: '注重细节 (detail)' },
    { value: 'style', label: '注重风格 (style)' },
    { value: 'composition', label: '注重构图 (composition)' },
  ] },
  { key: 'lineart_preservation_enabled', type: 'boolean', label: '启用线稿保护损失', desc: '线稿保护损失：Sobel 提取 latent 边缘并加权保护。建议插画/线稿概念开启。', defaultValue: false },
  { key: 'lineart_preservation_weight', type: 'number', label: '线稿损失权重', desc: '线稿损失权重。推荐范围：0.05–0.2。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_edge_weight', type: 'number', label: '边缘权重因子', desc: '边缘区域相对整体的放大倍数。推荐范围： 3.0（默认）。', defaultValue: 3.0, min: 1, max: 10, step: 0.5, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_min_t', type: 'number', label: '最小 sigma (线稿)', desc: 'sigma 窗口下界。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'lineart_preservation_max_t', type: 'number', label: '最大 sigma (线稿)', desc: 'sigma 窗口上界。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lineart_preservation_enabled },
  { key: 'dct_frequency_enabled', type: 'boolean', label: '启用 DCT 频域损失', desc: 'DCT 频域损失：对高频分量加权，抑制网纹/噪点。建议纹理发飘时试。', defaultValue: false },
  { key: 'dct_frequency_weight', type: 'number', label: 'DCT 损失权重', desc: 'DCT 损失相对主损失权重。推荐范围：0.05–0.15。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_high_weight', type: 'number', label: '高频权重因子', desc: '高频相对低频的权重倍数。推荐范围： 2.0（默认）。', defaultValue: 2.0, min: 1, max: 5, step: 0.5, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_low_cutoff', type: 'number', label: '低频 cutoff 比例', desc: '前多少比例算低频 cutoff。推荐范围： 0.3（默认）。', defaultValue: 0.3, min: 0.1, max: 0.5, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_min_t', type: 'number', label: '最小 sigma (DCT)', desc: 'sigma 窗口下界（0 全范围）。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'dct_frequency_max_t', type: 'number', label: '最大 sigma (DCT)', desc: 'sigma 窗口上界（1 全范围）。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.dct_frequency_enabled },
  { key: 'gram_texture_enabled', type: 'boolean', label: '启用 Gram 纹理损失', desc: 'Gram 纹理损失：捕捉纹理统计特征防网状伪影。建议风格纹理任务开启。', defaultValue: false },
  { key: 'gram_texture_weight', type: 'number', label: 'Gram 损失权重', desc: 'Gram 损失权重。推荐范围：0.03–0.1。', defaultValue: 0.05, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_normalize', type: 'boolean', label: '归一化 Gram 矩阵', desc: '除以 C×H×W 使损失与尺寸无关。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_min_t', type: 'number', label: '最小 sigma (Gram)', desc: 'sigma 窗口下界（0 全范围）。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.gram_texture_enabled },
  { key: 'gram_texture_max_t', type: 'number', label: '最大 sigma (Gram)', desc: 'sigma 窗口上界（1 全范围）。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.gram_texture_enabled },

  // ── 困难样本挖掘 ────────────────────────────────────────────────────────────
  { key: 'hard_negative_mining_enabled', type: 'boolean', label: '启用困难样本挖掘 (Hard Negative Mining)', desc: '只回传 loss 最高的 top-k% 样本梯度，聚焦难例。建议难例拖累整体时开启。', defaultValue: false },
  { key: 'hard_negative_mining_ratio', type: 'number', label: '困难样本保留比例', desc: '保留 top-k% 困难样本比例。推荐范围：0.5（保留 50%，默认）。', defaultValue: 0.5, min: 0.1, max: 1.0, step: 0.05, visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_warmup_steps', type: 'number', label: 'Warmup 步数', desc: '前 N 步不启用让训练先稳定。推荐范围： 100。', defaultValue: 100, min: 0, step: 10, visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_mode', type: 'select', label: '挖掘模式', desc: '挖掘模式：topk 按比例 / threshold 按阈值。建议 topk。', defaultValue: 'topk', options: [
    { value: 'topk', label: 'Top-K 模式' },
    { value: 'threshold', label: 'Threshold 模式' },
  ], visibleWhen: (c) => c.hard_negative_mining_enabled },
  { key: 'hard_negative_mining_threshold_multiplier', type: 'number', label: 'Threshold 系数', desc: 'threshold 模式的阈值系数（threshold = mean × k）。推荐范围： 1.2。', defaultValue: 1.2, min: 1.0, max: 3.0, step: 0.1, visibleWhen: (c) => c.hard_negative_mining_enabled && c.hard_negative_mining_mode === 'threshold' },

  // ── 多尺度 DiT 监督 ───────────────────────────────────────────────────────
  { key: 'multi_scale_supervision_enabled', type: 'boolean', label: '启用多尺度 DiT 监督 (Multi-Scale Supervision)', desc: '在 DiT 中间层（4/8/12）做 student-teacher 特征监督。建议深层语义丢失时试验。', defaultValue: false },
  { key: 'multi_scale_supervision_weight', type: 'number', label: '多尺度损失权重', desc: '多尺度监督权重。推荐范围：0.1–0.3。', defaultValue: 0.1, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_layers', type: 'text', label: '监督层列表', desc: '要监督的 DiT 层，逗号分隔 (如 "4,8,12")。', defaultValue: '4,8,12', visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_loss_type', type: 'select', label: '特征损失类型', desc: '中间层特征损失类型。建议 mse 起步。', defaultValue: 'mse', options: [
    { value: 'mse', label: 'MSE (均方误差)' },
    { value: 'cosine', label: 'Cosine (余弦距离)' },
  ], visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_min_t', type: 'number', label: '最小 sigma (多尺度)', desc: '只在指定 σ 范围内应用监督的下界。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },
  { key: 'multi_scale_max_t', type: 'number', label: '最大 sigma (多尺度)', desc: '监督 σ 上界。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_scale_supervision_enabled },

  // ── LPIPS Latent 感知损失 ─────────────────────────────────────────────────
  { key: 'lpips_latent_enabled', type: 'boolean', label: '启用 LPIPS Latent 感知损失', desc: '在 latent 域用 DiT 中间特征做感知相似度（类 LPIPS）。建议细节保真需求时开启。', defaultValue: false },
  { key: 'lpips_latent_weight', type: 'number', label: 'LPIPS Latent 损失权重', desc: 'LPIPS latent 权重。推荐范围：0.05–0.15。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_feature_layers', type: 'text', label: '特征层列表', desc: '使用哪些 DiT 层特征，逗号分隔 (如 "4,8,12")。', defaultValue: '4,8,12', visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_feature_weight', type: 'text', label: '各层权重', desc: '各层权重，逗号分隔 (如 "1.', defaultValue: '1.0,1.0,1.0', visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_normalize_features', type: 'boolean', label: '归一化特征', desc: '对特征做 L2 归一化更看方向不看幅度。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_min_t', type: 'number', label: '最小 sigma (LPIPS)', desc: 'sigma 窗口下界。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lpips_latent_enabled },
  { key: 'lpips_latent_max_t', type: 'number', label: '最大 sigma (LPIPS)', desc: 'sigma 窗口上界。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lpips_latent_enabled },

  // ── 对比学习 Latent 一致性 ────────────────────────────────────────────────
  { key: 'contrastive_latent_enabled', type: 'boolean', label: '启用对比学习 Latent 一致性', desc: '对比式 latent 一致性：同一 clean latent 不同噪声对的表征拉近。建议实验性开启。', defaultValue: false },
  { key: 'contrastive_latent_weight', type: 'number', label: '对比学习损失权重', desc: '对比损失权重。推荐范围：0.05–0.2。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_noise_pairs', type: 'number', label: '对比对数', desc: '每个样本构造的对比对数。推荐范围：1–5。', defaultValue: 1, min: 1, max: 5, step: 1, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_temperature', type: 'number', label: '对比学习温度', desc: '温度系数（保留参数，当前实现未使用）。推荐范围：保持默认。', defaultValue: 0.07, min: 0.01, max: 0.2, step: 0.01, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_min_t', type: 'number', label: '最小 sigma (对比)', desc: '限制在中间噪声段的下界（如 0.2）。推荐范围： 0.2。', defaultValue: 0.2, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.contrastive_latent_enabled },
  { key: 'contrastive_latent_max_t', type: 'number', label: '最大 sigma (对比)', desc: '中间噪声段上界（如 0.8）。推荐范围： 0.8。', defaultValue: 0.8, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.contrastive_latent_enabled },
];

// ── LoRA 结构变体 ─────────────────────────────────────────────────────────────
// 分组与向导 adapter 步的三层信息架构一致：基础算法在 network-settings 主区，
// 这里是「实体注入器（硬互斥）」与「叠加增强（DoRA）」两层。
export const S_LORA_VARIANTS = [
  { key: 'adapter_mask_pruning_enabled', type: 'boolean', label: 'Adapter Mask 剪枝', desc: '训练中按 adapter rank 重要性逐步屏蔽低贡献 rank（逻辑剪枝）。建议过拟合或想瘦身时开启。', defaultValue: false },
  { key: 'adapter_mask_pruning_target_ratio', type: 'number', label: 'Mask 剪枝比例', desc: '最终屏蔽的 rank 比例上限（0.5=约保留一半）。推荐范围：0–0.95，默认 0 表示不剪。', defaultValue: 0.5, min: 0, max: 0.95, step: 0.05, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_warmup_steps', type: 'number', label: 'Mask 剪枝预热步数', desc: '预热内只累计重要性不更新 mask。推荐范围： 0 或短预热。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_interval', type: 'number', label: 'Mask 更新间隔', desc: '每隔多少 backward step 更新一次 mask。推荐范围： 100（默认）附近。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_min_rank', type: 'number', label: 'Mask 最小 Rank', desc: '每个 adapter 至少保留的 rank 数。推荐范围： 1–4。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  { key: 'adapter_mask_pruning_ema_decay', type: 'number', label: 'Mask 重要性 EMA', desc: 'weight×grad 重要性分数的 EMA 衰减。推荐范围： 0.9（默认）。', defaultValue: 0.9, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adapter_mask_pruning_enabled },
  uiGroup('entity_injectors', '实体注入器（硬互斥）', '同一线性层只能注入一种 ΔW 实体：同时开启多个时仅优先级最高者生效，其余自动关闭。DoRA 不在此列——它是叠加增强，见下方独立分组。'),
  { key: 'adalora_enabled', type: 'boolean', label: 'AdaLoRA (SVD 自适应预算)', desc: 'AdaLoRA 按 SVD 敏感度动态分配各层 rank 预算。适合异构层重要性差异大的任务；训练稍慢。', defaultValue: false },
  { key: 'adalora_target_rank', type: 'number', label: 'AdaLoRA 目标 rank', desc: 'AdaLoRA 最终目标 rank；0 沿用全局 network_dim。推荐范围： 0 保持一致。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_init_rank', type: 'number', label: 'AdaLoRA 初始 rank', desc: 'AdaLoRA 初始 rank，0 = 1.5× 目标 rank。推荐范围： 0 让其自动。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_total_steps', type: 'number', label: 'AdaLoRA 总步数', desc: '预算调度总步数；0 自动取 max_train_steps。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_mask_interval', type: 'number', label: 'AdaLoRA mask 更新间隔', desc: '每隔多少步更新一次 rank mask。推荐范围：100（默认）附近；过频抖动。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_orth_reg_weight', type: 'number', label: 'AdaLoRA 正交正则权重', desc: '正交正则权重，防 rank collapse。推荐范围：0.5（默认）附近。', defaultValue: 0.5, min: 0, step: 0.1, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_beta1', type: 'number', label: 'AdaLoRA β1', desc: '敏感度 EMA 衰减系数。推荐范围：保持 0.85。', defaultValue: 0.85, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adalora_enabled },
  { key: 'adalora_beta2', type: 'number', label: 'AdaLoRA β2', desc: '不确定性 EMA 衰减系数。推荐范围：保持 0.85。', defaultValue: 0.85, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adalora_enabled },
  { key: 'dokr_enabled', type: 'boolean', label: 'DoKr (DoRA + LoKr)', desc: 'DoKr = LoKr 的 Kronecker 方向 + DoRA 幅度组合。建议想要 LoKr 参数量又嫌其弱时试验。', defaultValue: false },
  { key: 'dokr_factor_in', type: 'number', label: 'DoKr in 因子', desc: 'DoKr in 侧分解因子偏好，0 用默认 8。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_factor_out', type: 'number', label: 'DoKr out 因子', desc: 'DoKr out 侧分解因子偏好，0 用默认 8。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_decompose_factor', type: 'number', label: 'DoKr w2 低秩', desc: 'w2 低秩分解 rank，0 表示完整 w2。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_mode', type: 'select', label: 'DoKr 模式', desc: 'DoKr 训练门控：full 全训；style 仅幅度；structure 仅方向。建议 full 起步。', defaultValue: 'full', options: [{ value: 'full', label: 'full (完整)' }, { value: 'style', label: 'style (magnitude only)' }, { value: 'structure', label: 'structure (方向 only)' }], visibleWhen: (c) => c.dokr_enabled },
  { key: 'dokr_alpha', type: 'number', label: 'DoKr alpha', desc: 'DoKr Kronecker 缩放分子。推荐范围：保持 1.0。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.dokr_enabled },
  // GDLoKr 主入口在 lora_type/adapter_type 下拉；此处仅补子项，不重复 master 开关
  { key: 'gdlokr_factor', type: 'number', label: 'GDLoKr Kronecker 因子', desc: 'GDLoKr 共享 Kronecker 因子，0 自动平衡。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  { key: 'gdlokr_mode', type: 'select', label: 'GDLoKr 模式', desc: 'GDLoKr 广义方向模式选择。建议保持 full 与 DoKr 一致对照。', defaultValue: 'full', options: [{ value: 'full', label: 'full (完整)' }, { value: 'style', label: 'style (magnitude only)' }, { value: 'structure', label: 'structure (方向 only)' }], visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  { key: 'gdlokr_alpha', type: 'number', label: 'GDLoKr alpha', desc: 'GDLoKr 缩放分子。推荐范围：保持 1.0。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.lora_type === 'gdlokr' || c.adapter_type === 'gdlokr' || c.gdlokr_enabled },
  // 区域多 LoRA 的 10 个参数曾经住在这里。它们是 GenerationRequest 的字段，训练配置上
  // 只剩 reader-free 的兼容别名，所以放在训练页等于让用户调一组无人读取的旋钮。现在归
  // 出图页（pages/generate），键名统一为 regional_lora_*，开关是 regions 本身而非布尔。
  { key: 'delta_lora_enabled', type: 'boolean', label: 'Delta-LoRA (ΔBA 动态缩放)', desc: 'Delta-LoRA 把 ΔBA 差异写入冻结底模，增强长训效果。建议默认关闭；长训且验证过稳定性再试。', defaultValue: false },
  { key: 'hydralora_enabled', type: 'boolean', label: 'HydraLoRA (多分支)', desc: 'HydraLoRA 多分支共享 A、多专家 B，配路由。适合多概念混合任务；显存略增。', defaultValue: false },
  { key: 'hydralora_num_experts', type: 'number', label: 'Hydra 专家数', desc: 'HydraLoRA 专家分支数。推荐范围：2–4（默认 4 可减半省显存）。', defaultValue: 4, min: 2, step: 1, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_routing', type: 'select', label: 'Hydra 路由', desc: '专家路由策略。建议保持 top_k。', defaultValue: 'top_k', options: [{ value: 'top_k', label: 'top_k' }, { value: 'soft', label: 'soft' }], visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_top_k', type: 'number', label: 'Hydra top-k', desc: '每个样本激活的专家数。推荐范围：2（默认）以内。', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_sparse_top_k', type: 'boolean', label: 'Hydra 稀疏 top-k', desc: '只计算被选中专家（省算力）。建议开启当 top_k < 专家数时。', defaultValue: false, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'hydralora_balance_loss_weight', type: 'number', label: 'Hydra 平衡损失权重', desc: '分支平衡损失权重，防止路由塌缩到单分支。推荐范围：0.01–0.1；0 关闭。', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.hydralora_enabled },
  { key: 'reslora_enabled', type: 'boolean', label: 'ResLoRA (跨层残差)', desc: 'ResLoRA 在 block 间加残差 shortcut，高 rank 提升质量。推荐范围：rank ≥32 时试验；需配套 alpha* 微调。', defaultValue: false },
  { key: 'reslora_mode', type: 'select', label: 'ResLoRA 模式', desc: 'shortcut 合并模式（block_shortcut 等）。建议保持默认。', defaultValue: 'block_shortcut', options: [
    { value: 'block_shortcut', label: 'block_shortcut' },
    { value: 'input_shortcut', label: 'input_shortcut' },
    { value: 'middle_shortcut', label: 'middle_shortcut' },
  ], visibleWhen: (c) => c.reslora_enabled },
  { key: 'reslora_window', type: 'number', label: 'ResLoRA 窗口', desc: '残差 shortcut 回看的 block 数，1 近似无操作。推荐范围：2（默认）。', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.reslora_enabled },
  { key: 'reslora_alpha_star', type: 'number', label: 'ResLoRA alpha*', desc: 'input/middle shortcut 合并系数。推荐范围：保持 1.0。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.reslora_enabled },
  { key: 'tensorring_lora_enabled', type: 'boolean', label: 'T-LoRA (Tensor-Ring)', desc: 'T-LoRA（Tensor-Ring）单步 fused 分解 W*=W0T+Δ。实验路线，建议小规模验证后再用。', defaultValue: false },
  { key: 'tensorring_trm_rank', type: 'number', label: 'TensorRing TRM rank', desc: 'TRM 变换 rank；0 或 ≤rank 退化为低秩 I+UV 形式。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'tensorring_tr_rank', type: 'number', label: 'TensorRing residual rank', desc: 'TensorRing residual rank，0 关闭该支路。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'tensorring_factor', type: 'number', label: 'TensorRing 因子', desc: '2-mode 分解尺寸 f，0 自动取 in/out 公约数。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.tensorring_lora_enabled },
  { key: 'krona_enabled', type: 'boolean', label: 'KronA (Kronecker 分解)', desc: 'KronA 用 Kronecker 分解 ΔW，参数少于同 rank LoRA。建议显存紧且要保容量时试验。', defaultValue: false },
  { key: 'krona_factor_in', type: 'number', label: 'KronA in 因子', desc: 'KronA in 侧分解因子，0 用默认 4。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_factor_out', type: 'number', label: 'KronA out 因子', desc: 'KronA out 侧分解因子，0 用默认 64。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_allora', type: 'boolean', label: 'KronA 模块级 ALLoRA', desc: 'KronA 模块级 ALLoRA 梯度归一化。建议实验性开启。', defaultValue: false, visibleWhen: (c) => c.krona_enabled },
  { key: 'krona_allora_eta', type: 'number', label: 'KronA ALLoRA eta', desc: 'ALLoRA 梯度缩放强度。推荐范围：保持 2。', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.krona_enabled && c.krona_allora },
  { key: 'krona_weight_decompose', type: 'boolean', label: 'KronA DoRA 分解', desc: '在 KronA 上叠加 DoRA 幅度分解。建议与 dora_enabled 二选一，避免双重分解语义混乱。', defaultValue: false, visibleWhen: (c) => c.krona_enabled },
  { key: 'cdka_enabled', type: 'boolean', label: 'CDKA (Component-Designed Kronecker)', desc: 'CDKA（不对称 Kronecker + alpha 缩放）改进 KronA。建议与 KronA 同场景试验。', defaultValue: false },
  { key: 'cdka_alpha', type: 'number', label: 'CDKA alpha', desc: 'CDKA 缩放分子：scale=alpha/sqrt(in)。推荐范围：16（默认）附近。', defaultValue: 16.0, min: 0, step: 0.5, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_factor_in', type: 'number', label: 'CDKA r2 (in 因子)', desc: 'CDKA in 因子 r2，0 用默认 8。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_factor_out', type: 'number', label: 'CDKA r1 (out 因子)', desc: 'CDKA out 因子 r1，0 用默认 2。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_allora', type: 'boolean', label: 'CDKA 模块级 ALLoRA', desc: 'CDKA 模块级 ALLoRA 归一化。建议实验性使用。', defaultValue: false, visibleWhen: (c) => c.cdka_enabled },
  { key: 'cdka_weight_decompose', type: 'boolean', label: 'CDKA DoRA 分解', desc: 'CDKA 上叠加 DoRA 幅度分解。建议实验性开启并与基线对比。', defaultValue: false, visibleWhen: (c) => c.cdka_enabled },
  { key: 'tc_lora_enabled', type: 'boolean', label: 'TC-LoRA (时间条件)', desc: 'TC-LoRA 用 hypernetwork 以时间条件生成 LoRA 权重。适合去噪过程自适应；训练更重。', defaultValue: false },
  { key: 'tc_lora_hidden_dim', type: 'number', label: 'TC-LoRA hidden', desc: 'hypernetwork 隐层宽度。推荐范围：64–128（默认 128 可减半省显存）。', defaultValue: 128, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_time_embed_dim', type: 'number', label: 'TC-LoRA 时间嵌入维', desc: '时间嵌入宽度。推荐范围：保持 64。', defaultValue: 64, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_generation_mode', type: 'select', label: 'TC-LoRA 生成模式', desc: '生成门控模式，当前运行时仅支持 gated。建议保持 gated。', defaultValue: 'gated', options: [{ value: 'gated', label: 'gated' }], visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_condition_enabled', type: 'boolean', label: 'TC-LoRA 条件编码', desc: '启用 condition-y 编码器（额外条件输入）。建议有控制图输入时才开。', defaultValue: false, visibleWhen: (c) => c.tc_lora_enabled },
  { key: 'tc_lora_cond_channels', type: 'number', label: 'TC-LoRA 条件通道', desc: '条件 latent/control 通道数。推荐范围：与所用条件结构一致，默认 16。', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.tc_lora_enabled && c.tc_lora_condition_enabled },
  { key: 'tc_lora_cond_dim', type: 'number', label: 'TC-LoRA 条件维', desc: '全局条件码宽度。推荐范围：保持 64。', defaultValue: 64, min: 8, step: 8, visibleWhen: (c) => c.tc_lora_enabled && c.tc_lora_condition_enabled },
  { key: 'lora2_adaptive_enabled', type: 'boolean', label: 'LoRA2 Adaptive (自动 Rank 选择)', desc: 'LoRA2 Adaptive：用指数衰减权重自动学习各模块最优 rank。建议容量难拍板时试验。', defaultValue: false },
  { key: 'lora2_adaptive_r_max', type: 'number', label: 'LoRA2 最大 rank', desc: '允许的最大 rank 上限。推荐范围： ≤ network_dim 的 2 倍。', defaultValue: 64, min: 4, max: 512, step: 4, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'lora2_adaptive_nu_init', type: 'number', label: 'LoRA2 nu 初始值', desc: 'nu 初值控制衰减速度。推荐范围： 1.0（默认）。', defaultValue: 1.0, min: 0.1, max: 10.0, step: 0.1, visibleWhen: (c) => c.lora2_adaptive_enabled },
  { key: 'lora2_adaptive_decay_lambda', type: 'number', label: 'LoRA2 衰减系数', desc: '指数衰减系数 λ。推荐范围： 1.0（默认/论文值）。', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => c.lora2_adaptive_enabled },
  // LoRA2 门控家族（lora2，区别于上面的 lora2_adaptive）：此前 25 族中唯一前后端
  // 全断——后端 lora2_enabled/lora2_gate_init 齐全（configs_training_methods.py:75、
  // lora_injector_inject.py:428/436），前端无字段无卡片。补上 master 后向导实体卡
  // （schemaCommon.js:825 已登记）才会物化，gate_init 的可见性随之生效。
  { key: 'lora2_enabled', type: 'boolean', label: 'LoRA2 (门控合成)', desc: 'LoRA2：两条可学习门控支路合成增量（gate_init 控制初值），与 LoRA2 Adaptive 分族互斥。建议实验路线。', defaultValue: false },
  { key: 'lora2_gate_init', type: 'number', label: 'LoRA2 gate 初值', desc: 'LoRA2 门控 nu 初值（FP32 sigmoid 门控，step 0 保持 parity）。推荐范围： 8.0（后端默认）。', defaultValue: 8, min: 0, step: 0.1, visibleWhen: (c) => c.lora2_enabled },
  // 幻影键（2026-08 第 3 站审计 C）：configs_training_methods.py:303 声明后全仓零读者；
  // 注入器只读 r_max/nu_init/decay_lambda。hidden 保旧草稿回显，提交层剥除。
  { key: 'lora2_adaptive_rank_threshold', type: 'hidden', defaultValue: 0.01 },
  { key: 'ed_lora_enabled', type: 'boolean', label: 'ED-LoRA (Embedding Decomposed)', desc: 'ED-LoRA 把文本 embedding 分解为随机+类别分量，强化文本对齐。适合文字驱动强概念任务。', defaultValue: false },
  { key: 'ed_lora_decomp_dim', type: 'number', label: 'ED-LoRA 分解维度', desc: 'Embedding 分解维度。推荐范围：32–256（默认 64）。', defaultValue: 64, min: 32, max: 256, step: 8, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_num_layers', type: 'number', label: 'ED-LoRA 层数', desc: '参与分解的 text encoder 层数。推荐范围：6–24（默认 12）。', defaultValue: 12, min: 6, max: 24, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_alpha', type: 'number', label: 'ED-LoRA Alpha', desc: 'V_class 缩放因子。推荐范围：1.0（默认）。', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_sequence_length', type: 'number', label: 'ED-LoRA 序列长度', desc: 'Token 序列长度，CLIP 标准 77。推荐范围：保持 77 除非模型不同。', defaultValue: 77, min: 1, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  { key: 'ed_lora_num_concepts', type: 'number', label: 'ED-LoRA 概念数', desc: '概念分量数量（多概念预留）。推荐范围：保持 1。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.ed_lora_enabled },
  // merge-time 融合（非训练循环）；挂在 ED-LoRA 旁便于发现
  { key: 'merge_ed_lora_fusion', type: 'boolean', label: 'ED-LoRA 合并融合', desc: '导出/合并时启用梯度下降式权重融合（比直接相加更少对齐损失）。不进训练循环，只影响合并产物。建议多 adapter 合并时开启。', defaultValue: false },
  { key: 'ed_lora_fusion_steps', type: 'number', label: '融合步数', desc: '每次融合的梯度下降步数。推荐范围：30（默认）附近。', defaultValue: 30, min: 1, step: 1, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'ed_lora_fusion_lr', type: 'number', label: '融合学习率', desc: '融合优化器学习率。推荐范围：保持默认 1e-3。', defaultValue: 0.001, min: 0, step: 0.0001, visibleWhen: (c) => c.merge_ed_lora_fusion },
  { key: 'ed_lora_fusion_rank', type: 'number', label: '融合 Rank', desc: '融合产物 rank。推荐范围：4（默认）附近。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.merge_ed_lora_fusion },
  // 幻影键（2026-08 第 3 站审计 C）：fusion 模块只消费 steps/lr/rank
  // （ed_lora_gradient_fusion.py:244-247），alpha 无任何读者。hidden + 提交剥除。
  { key: 'ed_lora_fusion_alpha', type: 'hidden', defaultValue: 1.0 },
  { key: 'vera_enabled', type: 'boolean', label: 'VeRA (向量重参数化)', desc: 'VeRA 用共享随机矩阵+少量可学习向量，参数量远小于 LoRA。建议超轻量适配试验用，效果上限低于 LoRA。', defaultValue: false },
  { key: 'vera_d_initial', type: 'number', label: 'VeRA d 初值', desc: 'VeRA 可学习缩放向量初值。推荐范围：保持 0.1。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.vera_enabled },
  { key: 'vera_prng_key', type: 'number', label: 'VeRA PRNG 种子', desc: 'VeRA 共享随机矩阵的种子；同 seed 才能复现/加载。推荐范围：保持 0 不动。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.vera_enabled },
  { key: 'mora_enabled', type: 'boolean', label: 'MoRA（方阵适配器）', desc: 'MoRA 用 r×r 方阵替代 BA 分解，参数 r²。非 A1111 原生格式，导出为专用矩阵。建议实验性使用。', defaultValue: false },
  uiGroup('dora_variant_frontier', 'DoRA 权重分解（叠加增强）', 'DoRA 不是独立算法：它叠加在原生 networks.lora 路线上，把权重分解为方向与幅度分别训练。LyCORIS 算法与其它实体注入器不支持叠加；向导中由「叠加增强」区的单一开关托管。'),
  { key: 'dora_enabled', type: 'boolean', label: 'DoRA (权重分解)', desc: 'DoRA 把权重分解为方向+幅度联合训练，表达力强于同 rank LoRA 但稍慢。建议在原生 LoRA 基础上叠加使用；与 LyCORIS 族互斥（注入链短路）。', defaultValue: false },
  // dora_mode 真实支持值（后端复核 2026-08）：configs_monitoring.py:100 声明为自由
  // 字符串；运行时 DoRALinear._normalize_mode（lulynx/dora_layer.py:103-119）接受
  // full/style/structure，wd 是 full 的别名，split/merged 未知值告警后兜回 full。
  // 旧别名 wd 保留为 disabled 项以便旧草稿回显。
  { key: 'dora_mode', type: 'select', label: 'DoRA 模式', desc: 'DoRA 训练门控：full 方向+幅度全训；style 仅幅度；structure 仅方向。建议 full 完整体验。', defaultValue: 'full', options: [
    { value: 'full', label: 'full（方向+幅度）' },
    { value: 'style', label: 'style（仅幅度）' },
    { value: 'structure', label: 'structure（仅方向）' },
    { value: 'wd', label: 'wd（旧版别名，等价 full）', disabled: true, disabledReason: '等价于 full，仅为旧草稿兼容保留。' },
  ], visibleWhen: (c) => c.dora_enabled },
  { key: 'dora_variant', type: 'select', label: 'DoRA 方案', desc: 'DoRA 方案：classic 标准；lulynx_stopgrad_dora 为前向等价的 stop-gradient 工程变体。建议 classic。', defaultValue: 'classic', options: [{ value: 'classic', label: '标准 DoRA' }, { value: 'lulynx_stopgrad_dora', label: 'lulynx Stop-Gradient DoRA' }], visibleWhen: doraEnabled },
  // 幻影三键（2026-08 第 3 站审计 C）：仅声明于 configs_monitoring.py:407-409，
  // 全仓零读取（DoRA 注入器不消费）。hidden 保旧草稿回显，提交层剥除。
  { key: 'dora_init_scale', type: 'hidden', defaultValue: 1.0 },
  { key: 'dora_use_scalar_magnitude', type: 'hidden', defaultValue: false },
  { key: 'dora_normalize_magnitude', type: 'hidden', defaultValue: true },
];

// ── σ 深度调度（步内条件深度，非 LR/数据调度；实验）────────────────────────────
export const S_SIGMA_DEPTH_SCHEDULE = [
  { key: 'sigma_depth_schedule_enabled', type: 'boolean', label: 'σ 深度调度', desc: '按 RF σ 调度本步 DiT 计算深度，跳过的 block 走恒等旁路不断梯度。与 Aircon 正交。建议速度实验开启。', defaultValue: false },
  { key: 'sigma_depth_schedule_mode', type: 'select', label: 'σ 深度模式', desc: 'hard_depth 硬上限 / soft_prob 软概率跳过。建议 hard_depth 可预期。', defaultValue: 'hard_depth', options: [{ value: 'hard_depth', label: 'hard_depth' }, { value: 'soft_prob', label: 'soft_prob' }], visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_alpha', type: 'number', label: 'σ 深度 α', desc: 'sigmoid 斜率，越大深度随 σ 变化越陡。推荐范围： 8（默认）。', defaultValue: 8.0, min: 0.1, step: 0.1, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_beta', type: 'number', label: 'σ 深度 β', desc: 'sigmoid 中心（RF σ∈[0,1]）。推荐范围： 0.35。', defaultValue: 0.35, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
  { key: 'sigma_depth_schedule_min_blocks_kept', type: 'number', label: '最少保留 Block', desc: '始终计算的前 N 个 block（护浅层）。推荐范围： 4。', defaultValue: 4, min: 0, step: 1, visibleWhen: (c) => c.sigma_depth_schedule_enabled },
];

// ── DiT BlockSkip 训练时计算裁剪 ──────────────────────────────────────────────
export const S_DIT_BLOCKSKIP = [
  { key: 'dit_compute_reducer_strategy', type: 'select', label: 'DiT BlockSkip', desc: 'DiT BlockSkip：按计划跳过部分 block 计算。建议 none 起步，测速对照再开。', defaultValue: 'none', options: [
    { value: 'none', label: '关闭 (none)' },
    { value: 'blockskip', label: 'BlockSkip' },
  ] },
  { key: 'dit_compute_reducer_skip_ratio', type: 'number', label: 'BlockSkip 比例', desc: '推导跳过频率的比例（0-0.95）。推荐范围： 0.25 以内保守。', defaultValue: 0.25, min: 0, max: 0.95, step: 0.05, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_skip_every', type: 'number', label: '固定跳过间隔', desc: '每 N 个候选 block 跳 1 个（0 关闭）。推荐范围： 0 用比例控制。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_warmup_steps', type: 'number', label: 'BlockSkip 预热步数', desc: '前 N 步完整前向热身。推荐范围： 4。', defaultValue: 4, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
  { key: 'dit_compute_reducer_min_block', type: 'number', label: '最小生效 Block', desc: '小于该索引的前层永不跳过。推荐范围： 1。', defaultValue: 1, min: 0, step: 1, visibleWhen: (c) => c.dit_compute_reducer_strategy === 'blockskip' },
];

// ── 感知锚 / 频域纹理损失 ─────────────────────────────────────────────────────
export const S_PERCEPTUAL_ANCHOR_LOSS = [
  { key: 'lulynx_freq_texture_enabled', type: 'boolean', label: '频域纹理损失', desc: 'latent 频域纹理损失参与 loss 拆分。建议纹理任务精细化时开。', defaultValue: false },
  { key: 'lulynx_freq_texture_weight', type: 'number', label: '频域纹理权重', desc: '频域纹理损失权重。推荐范围： 0 起步小值试探。', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_highpass_sigma', type: 'number', label: '频域纹理高通 σ', desc: '高低频分离的高斯模糊 sigma。推荐范围： 2（默认）。', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_min_t', type: 'number', label: '频域纹理最小 σ', desc: '计入的 raw σ 下界。推荐范围： 0 全程。', defaultValue: 0.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_freq_texture_max_t', type: 'number', label: '频域纹理最大 σ', desc: '计入的 raw σ 上界。推荐范围： 1 全程。', defaultValue: 1.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_freq_texture_enabled },
  { key: 'lulynx_latent_anchor_enabled', type: 'boolean', label: 'Latent 感知锚', desc: 'Latent 感知锚：多尺度梯度匹配做感知约束。建议细节丢失时试。', defaultValue: false },
  { key: 'lulynx_latent_anchor_weight', type: 'number', label: '感知锚权重', desc: '感知锚损失权重。推荐范围： 0 起步小值试探。', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_perceptor', type: 'select', label: '感知锚 Perceptor', desc: '感知特征后端选择。建议 latent_msgrad 默认。', defaultValue: 'latent_msgrad', options: [
    { value: 'latent_msgrad', label: 'latent_msgrad' },
  ], visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_grad_scales', type: 'number', label: '感知锚多尺度层数', desc: '多尺度金字塔深度。推荐范围： 3（默认）。', defaultValue: 3, min: 1, max: 8, step: 1, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_min_t', type: 'number', label: '感知锚最小 σ', desc: '计入的 raw σ 下界。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
  { key: 'lulynx_latent_anchor_max_t', type: 'number', label: '感知锚最大 σ', desc: '计入的 raw σ 上界。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.lulynx_latent_anchor_enabled },
];

// ── 采样与优化储备 ────────────────────────────────────────────────────────────
export const S_SAMPLING_OPTIMIZATION_RESERVE = [
  { key: 'adaptive_loss_weighting_enabled', type: 'boolean', label: '自适应损失加权 (learnable SNR γ)', desc: '可学习 SNR gamma 替代固定 min-SNR。建议实验性开启并与固定 γ=5 对比。', defaultValue: false },
  { key: 'adaptive_loss_weighting_lr', type: 'number', label: '自适应加权学习率', desc: 'gamma 参数的学习率。推荐范围： 1e-3 小步走。', defaultValue: 0.001, min: 0, step: 0.0001, visibleWhen: (c) => c.adaptive_loss_weighting_enabled },
  { key: 'adaptive_loss_weighting_init_gamma', type: 'number', label: '自适应加权初始 γ', desc: '可学习 gamma 初值。推荐范围： 5（min-SNR 推荐值同源）。', defaultValue: 5.0, min: 0, step: 0.1, visibleWhen: (c) => c.adaptive_loss_weighting_enabled },
  { key: 'ant_enabled', type: 'boolean', label: 'ANT 自适应时间步采样', desc: 'ANT 自适应时间步采样：per-σ-bin loss EMA 驱动采样分布。建议收敛不均时试。', defaultValue: false },
  { key: 'ant_num_bins', type: 'number', label: 'ANT σ 分桶数', desc: 'sigma 分桶数量。推荐范围： 50（默认）。', defaultValue: 50, min: 4, step: 1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_warmup_updates', type: 'number', label: 'ANT 预热更新数', desc: '前 N 次 update 返回 uniform 等统计稳定。推荐范围： 30。', defaultValue: 30, min: 0, step: 1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_blend', type: 'number', label: 'ANT 混合比', desc: 'loss-driven 与 uniform 采样混合比（1=纯自适应）。推荐范围： 0.7。', defaultValue: 0.7, min: 0, max: 1, step: 0.1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_temperature', type: 'number', label: 'ANT 温度', desc: '采样权重平坦度：>1 更平 <1 更尖。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0.1, step: 0.1, visibleWhen: (c) => c.ant_enabled },
  { key: 'ant_ema_decay', type: 'number', label: 'ANT EMA 衰减', desc: 'per-bin loss EMA 衰减。推荐范围： 0.95。', defaultValue: 0.95, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.ant_enabled },
  { key: 'bp_low_enabled', type: 'boolean', label: 'BP-low 低分辨率反传', desc: 'BP-low：高噪声 step 降分辨率反传省显存。建议高噪段主导的大分辨率训练试。', defaultValue: false },
  { key: 'bp_low_factor', type: 'number', label: 'BP-low 下采样倍数', desc: '下采样倍数（2=半分辨率）。推荐范围：2–4。', defaultValue: 2, min: 2, max: 4, step: 1, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_noise_threshold', type: 'number', label: 'BP-low 噪声阈值', desc: '仅 σ 高于该值时启用下采样。推荐范围： 0.5。', defaultValue: 0.5, min: 0.1, max: 0.9, step: 0.05, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_scale', type: 'number', label: 'BP-low 时间步量纲', desc: 'σ 量纲：1.0 raw [0,1]；1000 为 legacy 千分制。推荐范围：与所用调度一致。', defaultValue: 1.0, min: 0, step: 1, visibleWhen: (c) => c.bp_low_enabled },
  { key: 'bp_low_schedule', type: 'select', label: 'BP-low 调度', desc: 'step 硬阈值 / cosine 平滑过渡。建议 step 简单可控。', defaultValue: 'step', options: [{ value: 'step', label: 'step' }, { value: 'cosine', label: 'cosine' }], visibleWhen: (c) => c.bp_low_enabled },
  { key: 'distillation_enabled', type: 'boolean', label: '蒸馏 (DP-DMD / AnyFlow)', desc: '少步 student 对齐多步 teacher 的蒸馏路线（DP-DMD/AnyFlow）。显著更慢更吃显存，不是加速开关。建议仅在明确要少步产物时开启。', defaultValue: false },
  { key: 'distillation_mode', type: 'select', label: '蒸馏模式', desc: '蒸馏模式：dp_dmd_turbo 主少步路径；anyflow flow-matching 一致性蒸馏（非加速开关）。建议 dp_dmd_turbo。', defaultValue: 'dp_dmd_turbo', options: [{ value: 'dp_dmd_turbo', label: 'dp_dmd_turbo（推荐少步）' }, { value: 'anyflow', label: 'anyflow（FM 一致性）' }], visibleWhen: (c) => c.distillation_enabled },
  { key: 'dp_dmd_variant', type: 'select', label: 'DP-DMD 实现模式', desc: 'DP-DMD 实现分支：lulynx_optimized 历史 teacher-regression；standard 需要真实双 score provider（缺失即 fail-fast）。建议 lulynx_optimized。', defaultValue: 'lulynx_optimized', options: [{ value: 'lulynx_optimized', label: 'lulynx 优化模式' }, { value: 'standard', label: '标准 DP-DMD' }], visibleWhen: (c) => c.distillation_enabled && String(c.distillation_mode || 'dp_dmd_turbo') === 'dp_dmd_turbo' },
  { key: 'distillation_student_steps', type: 'number', label: 'Student 步数', desc: 'student ODE 步数（常见 1–8）。越少越「少步」也越难对齐。推荐范围： 4 起步。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_teacher_steps', type: 'number', label: 'Teacher 步数', desc: 'teacher ODE 步数（≥ student）。越大越慢越贵。推荐范围： 28（默认）附近。', defaultValue: 28, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_guidance_scale', type: 'number', label: '蒸馏 CFG', desc: 'teacher 目标 bake 的 CFG 强度；≠1 即启用 bake（DP-DMD 家族判定）。推荐范围： 1 保持默认。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_objective', type: 'select', label: '蒸馏目标标识', desc: '与 mode 配对的 objective 记录标识，请与蒸馏模式保持一致。建议不动。', defaultValue: 'dp_dmd_turbo', options: [{ value: 'dp_dmd_turbo', label: 'dp_dmd_turbo' }, { value: 'anyflow', label: 'anyflow' }], visibleWhen: (c) => c.distillation_enabled },
  // AnyFlow 独立键（mode=anyflow 时覆盖/补充 distillation_* 通用步数）
  { key: 'anyflow_student_steps', type: 'number', label: 'AnyFlow student 步数', desc: 'AnyFlow 专用 student 步数，覆盖通用值。推荐范围： 4。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_teacher_steps', type: 'number', label: 'AnyFlow teacher 步数', desc: 'AnyFlow 专用 teacher 步数。推荐范围： 28 附近。', defaultValue: 28, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_cfg_bake', type: 'boolean', label: 'AnyFlow CFG bake', desc: 'AnyFlow 专用 CFG bake 开关。建议实验对照时再开。', defaultValue: false, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'anyflow_x0_endpoint_weight', type: 'number', label: 'AnyFlow x0 端点权重', desc: 'x0-endpoint 匹配权重；0 关闭，不用于加速。推荐范围： 0。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && c.distillation_mode === 'anyflow' },
  { key: 'distillation_prediction_type', type: 'select', label: '蒸馏预测类型', desc: 'student/teacher 对齐的预测目标类型。建议 velocity 与底模一致。', defaultValue: 'velocity', options: [
    { value: 'velocity', label: 'velocity' },
    { value: 'epsilon', label: 'epsilon' },
    { value: 'sample', label: 'sample' },
  ], visibleWhen: (c) => c.distillation_enabled },
  // 内部两步轨迹研究模式（configs_training_methods.py:247-266）：激活复用
  // distillation_enabled ∧ mode=dp_dmd_turbo，没有第二特性开关。
  { key: 'trajectory_variant', type: 'select', label: '轨迹目标变体', desc: '两步轨迹研究目标的形状：two_step 一次跳跃+直通连接器拼接（2 次前向，默认）；sparse 沿模型自身轨迹走 K 个 detached Euler 点、无连接器（K 次前向+K 份激活），监督更密但不是省钱档。建议保持 two_step；想加稠密同轨迹监督时选 sparse 并把 sparse_steps 调到 4–8。', defaultValue: 'two_step', options: [
    { value: 'two_step', label: 'two_step（默认）' },
    { value: 'sparse', label: 'sparse（K 点稠密监督）' },
  ], visibleWhen: (c) => c.distillation_enabled && String(c.distillation_mode || 'dp_dmd_turbo') === 'dp_dmd_turbo' },
  { key: 'trajectory_sparse_steps', type: 'number', label: 'Sparse 轨迹点数', desc: 'trajectory_variant=sparse 时沿轨迹走的欧拉步点数 K（决定前向次数与显存占用）。推荐范围：4（默认）–8；下限 2。', defaultValue: 4, min: 2, step: 1, visibleWhen: (c) => c.distillation_enabled && c.trajectory_variant === 'sparse' },
  { key: 'trajectory_mix_ratio', type: 'slider', label: '轨迹目标混合比', desc: 'micro-batch 中走轨迹目标的比例，其余走标准蒸馏目标。0.0 是有意义设置（纯标准：轨迹通路仍被解析校验但不参与）；与「未设置」在后端 resolver 里是两回事，0 会原样透传。推荐范围：1.0（全量，默认）–0.5 对照实验。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.distillation_enabled && String(c.distillation_mode || 'dp_dmd_turbo') === 'dp_dmd_turbo' },
  { key: 'distillation_diversity_anchor_weight', type: 'number', label: '蒸馏多样性锚权重', desc: '多样性锚损失权重防模式坍缩；0 关闭。推荐范围： 0 起步，坍缩迹象再加 0.01 级。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_fake_critic_weight', type: 'number', label: '蒸馏假 critic 权重', desc: 'fake critic 对抗项权重；0 关闭。推荐范围： 0 保持稳定。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_fake_critic_margin', type: 'number', label: '蒸馏假 critic margin', desc: 'fake critic 的 margin 间隔。推荐范围： 0.05（默认）。', defaultValue: 0.05, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_fake_critic_weight || 0) > 0 },
  { key: 'distillation_softrank_weight', type: 'number', label: 'SoftRank 权重', desc: 'SoftRank 排序正则权重；0 关闭。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled },
  { key: 'distillation_softrank_k', type: 'number', label: 'SoftRank k', desc: 'SoftRank top-k 数量。推荐范围： 4（默认）。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_every_n', type: 'number', label: 'SoftRank 间隔', desc: '每 N 步计算一次 SoftRank。推荐范围： 1。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_softness', type: 'number', label: 'SoftRank 软度', desc: '排序软化系数。推荐范围： 0.25（默认）。', defaultValue: 0.25, min: 0, step: 0.01, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_pool_size', type: 'number', label: 'SoftRank 池大小', desc: 'SoftRank 采样池大小。推荐范围： 128（默认）。', defaultValue: 128, min: 1, step: 1, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  { key: 'distillation_softrank_warmup_ratio', type: 'number', label: 'SoftRank 预热比例', desc: '前该比例步数不做 SoftRank。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.distillation_enabled && Number(c.distillation_softrank_weight || 0) > 0 },
  // TwinFlow RCGM few-step (parallel flags; not distillation_mode)
  { key: 'twinflow_enabled', type: 'boolean', label: 'TwinFlow (RCGM 少步)', desc: 'EMA-of-LoRA teacher + RCGM/real-velocity 少步叙事。步内多前向更慢更吃显存；。勿与 distillation 同开（同开时优先 distillation）。', defaultValue: false },
  { key: 'twinflow_weight', type: 'number', label: 'TwinFlow 权重', desc: 'TwinFlow 辅助损失总闸：>0 才生效（可试 0.5–1.0）。推荐范围：实验路径专用。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_target_step_count', type: 'number', label: '目标少步数', desc: '目标少步数（1–4 叙事元数据，不替换产品采样器）。推荐范围： 2。', defaultValue: 2, min: 1, max: 8, step: 1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_estimate_order', type: 'number', label: 'RCGM 估计阶', desc: 'RCGM 估计阶；≥2 多一次 teacher 前向。推荐范围： 2（默认）。', defaultValue: 2, min: 1, max: 4, step: 1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_delta_t', type: 'number', label: 'RCGM Δt', desc: '递归一致性时间步长 Δt。推荐范围： 0.01（默认）。', defaultValue: 0.01, min: 0, max: 0.5, step: 0.005, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_target_clamp', type: 'number', label: '目标 clamp', desc: 'RCGM 目标绝对值 clamp；0 不夹。推荐范围： 1。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_enhanced_ratio', type: 'number', label: 'CFG 精炼比', desc: 'CFG 精炼比：MVP 默认 0=关省前向。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 2, step: 0.05, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_require_ema', type: 'boolean', label: '要求 EMA teacher', desc: '默认开；关则允许未初始化 shadow 时 skip（不建议）。', defaultValue: true, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_adversarial_enabled', type: 'boolean', label: '对抗分支 (L_adv/L_rectify)', desc: '自对抗分支（EMA 一步 fake + L_adv + rectify）：明显更慢更吃前向，无外挂判别器。建议默认关闭。', defaultValue: false, visibleWhen: (c) => c.twinflow_enabled },
  { key: 'twinflow_adversarial_weight', type: 'number', label: 'L_adv 权重', desc: 'L_adv 权重：需对抗开且 >0 才进 loss。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled && c.twinflow_adversarial_enabled },
  { key: 'twinflow_rectify_weight', type: 'number', label: 'L_rectify 权重', desc: 'L_rectify 对齐权重（real detach）。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.twinflow_enabled && c.twinflow_adversarial_enabled },
  { key: 'dop_enabled', type: 'boolean', label: 'DOP (差异输出保留)', desc: 'DOP 差异输出保留：约束输出不偏离基座，防灾难遗忘。建议概念易被冲掉时开启。', defaultValue: false },
  { key: 'dop_weight', type: 'number', label: 'DOP 权重', desc: 'DOP 正则权重。推荐范围：0.1（默认）；过大压制新概念。', defaultValue: 0.1, step: 0.01, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_target', type: 'select', label: 'DOP 目标', desc: '作用位置：output 最终噪声预测 / features 中间特征。建议 output。', defaultValue: 'output', options: [{ value: 'output', label: 'output' }, { value: 'features', label: 'features' }], visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_start_step', type: 'number', label: 'DOP 起始步', desc: '从此步开始应用 DOP（0=立即）。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_interval', type: 'number', label: 'DOP 间隔', desc: '每 N 步应用一次 DOP（1=每步）。推荐范围： 1。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.dop_enabled },
  { key: 'dop_detach_reference', type: 'boolean', label: 'DOP 分离参考', desc: '对参考侧 detach 防梯度回传基座。安全旋钮建议保持 true。', defaultValue: true, visibleWhen: (c) => c.dop_enabled },
  { key: 'coreset_enabled', type: 'boolean', label: 'Coreset 重要性采样', desc: 'Coreset 按 loss 历史把样本分级 easy/hard/toxic 做重要性采样。建议数据质量参差时开启。', defaultValue: false },
  { key: 'coreset_easy_weight', type: 'number', label: 'Coreset easy 权重', desc: 'easy 样本采样权重。推荐范围： 1 保持参与。', defaultValue: 1.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_hard_weight', type: 'number', label: 'Coreset hard 权重', desc: 'hard 样本采样权重。推荐范围： 1–2 强调困难。', defaultValue: 1.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_toxic_weight', type: 'number', label: 'Coreset toxic 权重', desc: 'toxic 样本权重；0 表示直接跳过。推荐范围： 0 屏蔽异常样本。', defaultValue: 0.0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_classify_after', type: 'number', label: 'Coreset 分类起始步', desc: '累计多少步后开始分级。推荐范围： 500（默认）附近。', defaultValue: 500, min: 0, step: 10, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_auto_classify_after', type: 'number', label: 'Coreset 自动分类间隔', desc: '自动重分级的间隔步数。推荐范围： 50。', defaultValue: 50, min: 0, step: 1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_easy_threshold', type: 'number', label: 'Coreset easy 阈值', desc: 'easy 判定的 loss 阈值。推荐范围： 0.1（默认）附近。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_hard_loss_threshold', type: 'number', label: 'Coreset hard 阈值', desc: 'hard 判定的 loss 阈值倍数。推荐范围： 1.5（默认）。', defaultValue: 1.5, min: 0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_toxic_std_threshold', type: 'number', label: 'Coreset toxic 标准差阈值', desc: 'toxic 判定的标准差倍数。推荐范围： 3（默认）。', defaultValue: 3.0, min: 0, step: 0.1, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_report_enabled', type: 'boolean', label: 'Coreset 报告', desc: '输出分级报告便于审查异常样本。建议保持 true。', defaultValue: true, visibleWhen: (c) => c.coreset_enabled },
  { key: 'coreset_report_top_k', type: 'number', label: 'Coreset 报告 top-k', desc: '报告列出 top-k 样本数。推荐范围： 20。', defaultValue: 20, min: 1, step: 1, visibleWhen: (c) => c.coreset_enabled && c.coreset_report_enabled },
  { key: 'coreset_report_every_n_epochs', type: 'number', label: 'Coreset 报告间隔 epoch', desc: '每 N epoch 写一次报告。推荐范围： 1。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.coreset_enabled && c.coreset_report_enabled },
];

// ── TurboLoRA — 投机采样加速（推理加速储备）────────────────────────────────────
export const S_TURBO_LORA = [
  { key: 'turbo_lora_enabled', type: 'boolean', label: 'TurboLoRA Phase-1 草稿契约', desc: 'TurboLoRA Phase-1 草稿契约：仅初始化草稿网络与 teacher packet，主蒸馏/加速尚未接线。建议仅实验观察日志用。', defaultValue: false },
  { key: 'turbo_lora_draft_steps', type: 'number', label: '草稿步数 K', desc: '每次投机的草稿步数。推荐范围：3–5。', defaultValue: 4, min: 1, max: 8, step: 1, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_hidden_dim', type: 'number', label: '草稿网络宽度', desc: '草稿网络隐宽（默认 512 ≈ 目标 1/2）。推荐范围： 512。', defaultValue: 512, min: 128, max: 1024, step: 128, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_num_layers', type: 'number', label: '草稿网络层数', desc: '草稿 DiT 层数（默认 8）。越小越快。推荐范围： 8。', defaultValue: 8, min: 2, max: 16, step: 2, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_acceptance_threshold_high', type: 'number', label: '接受阈值（高噪声）', desc: '高噪声端接受阈值，越大越宽松。推荐范围： 0.5。', defaultValue: 0.5, min: 0.1, max: 2.0, step: 0.05, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_acceptance_threshold_low', type: 'number', label: '接受阈值（低噪声）', desc: '低噪声端马氏距离接受阈值，越小越严。推荐范围： 0.02。', defaultValue: 0.02, min: 0.005, max: 0.2, step: 0.005, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_distill_cosine_weight', type: 'number', label: '余弦对齐权重', desc: '蒸馏余弦方向项权重（0=纯 MSE）。推荐范围： 0.1。', defaultValue: 0.1, min: 0, max: 1.0, step: 0.05, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_distill_trajectory_ratio', type: 'number', label: '轨迹采样比例', desc: '沿 ODE 轨迹后半程采样的比例。推荐范围： 0.5。', defaultValue: 0.5, min: 0, max: 1.0, step: 0.1, visibleWhen: (c) => c.turbo_lora_enabled },
  { key: 'turbo_lora_draft_checkpoint', type: 'string', label: '草稿网络检查点', desc: '预训练草稿网络路径（留空=随机初始化，训练中自动学习）。', defaultValue: '', visibleWhen: (c) => c.turbo_lora_enabled },
];

// ── REPA / SoftREPA / ReFT / LISA / PCGrad ────────────────────────────────────
export const S_REPA_RESERVE = [
  // 经典 REPA（与 SoftREPA 双入口；文案区分）
  { key: 'repa_enabled', type: 'boolean', label: 'REPA (经典表征对齐)', desc: '外挂视觉编码器对齐 DiT 中间特征。开启后通常更慢、更吃显存。', defaultValue: false },
  { key: 'repa_target_modules', type: 'string', label: 'REPA 目标模块', desc: '逗号分隔模块名。空 + 下方 auto 开 → 后端按族选单层 mid（省 hook 税）。', defaultValue: '', visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_loss_type', type: 'select', label: 'REPA 损失类型', desc: '对齐损失类型：cosine 只看方向（默认）更稳；mse 看幅度。建议 cosine。', defaultValue: 'cosine', options: [
    { value: 'cosine', label: 'cosine' },
    { value: 'mse', label: 'mse' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_loss_weight', type: 'number', label: 'REPA 损失权重', desc: 'REPA 额外对齐 loss 权重；0 近似不生效。推荐范围：从小权重 0.1–0.5 试。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_projection_dim', type: 'number', label: 'REPA 投影维', desc: '对齐前投影维；0 不投影或按后端默认。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_stop_grad_target', type: 'boolean', label: 'REPA 目标 stop-grad', desc: '对齐目标侧不回传梯度。默认开启', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_target_provider', type: 'select', label: 'REPA 目标提供方', desc: 'REPA 对齐目标提供方：dinov2/jina 等视觉编码器；none 且无 target 时 fail-closed（不做伪对齐）。建议有明确目标编码器再选。', defaultValue: 'none', options: [
    { value: 'none', label: 'none（需其它 target）' },
    { value: 'latent_identity', label: 'latent_identity' },
    { value: 'jina_vision', label: 'jina_vision（税更高）' },
    { value: 'dinov2', label: 'dinov2' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_mode', type: 'select', label: 'REPA 对齐模式', desc: 'REPA 对齐模式（absolute 直接对齐 / relational 关系结构）。建议 absolute 起步。', defaultValue: 'absolute', options: [
    { value: 'absolute', label: 'absolute' },
    { value: 'relational', label: 'relational' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_gram_weight', type: 'number', label: 'REPA Gram 权重', desc: 'relational 臂的 Gram 权重；0 回落主权重。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_gram_spatial_norm', type: 'boolean', label: 'REPA Gram 空间归一', desc: 'token L2 归一后再算 Gram。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_patch_size', type: 'number', label: 'REPA DiT patch', desc: 'DiT patch 大小（relational pool 用，anima 通常 2）。推荐范围： 2。', defaultValue: 2, min: 1, step: 1, visibleWhen: (c) => c.repa_enabled && c.repa_mode === 'relational' },
  { key: 'repa_dinov2_model', type: 'string', label: 'DINOv2 hub 名', desc: 'provider=dinov2 时 torch.', defaultValue: 'dinov2_vits14', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'dinov2' },
  { key: 'repa_dinov2_path', type: 'string', label: 'DINOv2 本地路径', desc: '本地 hub 目录；空=尝试下载。默认空。', defaultValue: '', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'dinov2' },
  { key: 'repa_jina_path', type: 'string', label: 'Jina CLIP 路径', desc: '本地 jina-clip 目录或权重', defaultValue: '', visibleWhen: (c) => c.repa_enabled && c.repa_target_provider === 'jina_vision' },
  { key: 'repa_allow_text_fallback', type: 'boolean', label: 'REPA text 回落(legacy)', desc: '允许用 text embedding 冒充对齐目标的 legacy 行为。建议关闭（伪对齐无益）。', defaultValue: false, visibleWhen: (c) => c.repa_enabled },
  // P0 负载可控（仅 repa_enabled 时显示）
  { key: 'repa_encoder_device', type: 'select', label: 'REPA 编码器设备', desc: 'DINOv2/Jina 权重所在设备。推荐范围：默认 cpu 省显存；显存富余时选 cuda 更快。', defaultValue: 'cpu', options: [
    { value: 'cpu', label: 'cpu' },
    { value: 'cuda', label: 'cuda' },
  ], visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_capture_modules_auto', type: 'boolean', label: 'REPA 自动选 capture 层', desc: '目标模块为空时按模型族自动选单层 mid hook。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_capture_max_layers', type: 'number', label: 'REPA 最大 capture 层数', desc: '最多挂几个 DiT hook；loss 只用最后一层。推荐范围： 1（默认）。', defaultValue: 1, min: 0, max: 8, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_token_pool_size', type: 'number', label: 'REPA token 池化边长', desc: '对齐/Gram 前池化到 ≤N×N（16≈256 tokens）。推荐范围： 16。', defaultValue: 16, min: 0, max: 64, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_encode_every_n_steps', type: 'number', label: 'REPA 视觉编码间隔步', desc: '每 N 步才执行 VAE decode+编码器，控制开销；1=每步最贵。推荐范围：4（16G 推荐档）。', defaultValue: 4, min: 1, max: 64, step: 1, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_encoder_image_size', type: 'number', label: 'REPA 编码器输入边长', desc: '编码器输入边长；0 用各自默认（dino≈224/jina≈512）。推荐范围： 0。', defaultValue: 0, min: 0, max: 1024, step: 14, visibleWhen: (c) => c.repa_enabled },
  { key: 'repa_log_memory', type: 'boolean', label: 'REPA 首次打显存日志', desc: '首次真正计算 REPA loss 时打印 shape/pool 显存日志。建议保持 true 便于评估开销。', defaultValue: true, visibleWhen: (c) => c.repa_enabled },
  // SoftREPA
  { key: 'softrepa_enabled', type: 'boolean', label: 'SoftREPA (软表征对齐)', desc: 'SoftREPA：按 schedule 渐进软化的表征对齐。建议与 REPA 二选一对比。', defaultValue: false },
  { key: 'softrepa_schedule', type: 'select', label: 'SoftREPA schedule', desc: '权重随进度调度方式（linear 等）。建议 linear。', defaultValue: 'linear', options: [{ value: 'linear', label: 'linear' }, { value: 'cosine', label: 'cosine' }, { value: 'constant', label: 'constant' }], visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_min_weight', type: 'number', label: 'SoftREPA 最小权重', desc: 'schedule 起始权重。推荐范围： 0 从零渐入。', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_max_weight', type: 'number', label: 'SoftREPA 最大权重', desc: 'schedule 结束权重。推荐范围： ≤1。', defaultValue: 1.0, step: 0.01, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_sigma_min', type: 'number', label: 'SoftREPA sigma 下界', desc: '仅在该 σ 窗口内对齐的下界。推荐范围： 0 全程。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.softrepa_enabled },
  { key: 'softrepa_sigma_max', type: 'number', label: 'SoftREPA sigma 上界', desc: 'σ 窗口上界。推荐范围： 1 全程。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.softrepa_enabled },
  // ReFT
  { key: 'reft_enabled', type: 'boolean', label: 'ReFT', desc: 'ReFT（Representation Fine-Tuning）：干预中间层表征而非权重，参数极少。建议仅作实验性探测使用。', defaultValue: false },
  { key: 'reft_target_modules', type: 'string', label: 'ReFT 目标模块', desc: '逗号分隔；空=后端默认', defaultValue: '', visibleWhen: (c) => c.reft_enabled },
  { key: 'reft_rank', type: 'number', label: 'ReFT Rank', desc: '干预低秩维度。推荐范围：8（默认）附近。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.reft_enabled },
  { key: 'reft_init_scale', type: 'number', label: 'ReFT 初始化缩放', desc: '干预矩阵初始缩放。推荐范围： 0 保证从零介入。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.reft_enabled },
  // LISA
  { key: 'lisa_enabled', type: 'boolean', label: 'LISA 稀疏激活', desc: 'LISA 稀疏激活：周期性只激活部分参数子集训练。建议大 adapter 省显存试验。', defaultValue: false },
  { key: 'lisa_active_ratio', type: 'number', label: 'LISA 激活比例', desc: '每轮激活的参数比例。推荐范围：0.2（默认）附近。', defaultValue: 0.2, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.lisa_enabled },
  { key: 'lisa_interval', type: 'number', label: 'LISA 切换间隔', desc: '每隔 N 步重采样激活集。推荐范围： 1（默认）。', defaultValue: 1, min: 1, step: 1, visibleWhen: (c) => c.lisa_enabled },
  // PCGrad
  { key: 'pcgrad_enabled', type: 'boolean', label: 'PCGrad 多任务梯度', desc: 'PCGrad 把冲突梯度投影到正交方向，多任务/多轴损失时减冲突。建议组合多损失时开。', defaultValue: false },
  { key: 'pcgrad_conflict_threshold', type: 'number', label: 'PCGrad 冲突阈值', desc: '余弦相似度低于该值视为冲突（0=全部投影）。推荐范围： 0。', defaultValue: 0.0, step: 0.01, visibleWhen: (c) => c.pcgrad_enabled },
  { key: 'pcgrad_reduction', type: 'select', label: 'PCGrad 归约', desc: '投影前的梯度归约方式 mean/sum。建议 mean。', defaultValue: 'mean', options: [
    { value: 'mean', label: 'mean' },
    { value: 'sum', label: 'sum' },
  ], visibleWhen: (c) => c.pcgrad_enabled },
];

// LayerSync — mid↔deep self-align, no external encoder
export const S_LAYERSYNC = [
  { key: 'layersync_enabled', type: 'boolean', label: 'LayerSync 层自对齐', desc: 'LayerSync 层自对齐：同网络浅层对齐深层（无外挂编码器）。可能略增激活显存。建议语义漂移明显时试。', defaultValue: false },
  { key: 'layersync_weight', type: 'number', label: 'LayerSync 权重', desc: '辅助对齐权重；>0 才生效。推荐范围：从 0.2 试起。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_student_block', type: 'number', label: 'Student 块索引', desc: 'student 块索引（0-based 较浅层），-1 自动取约 1/3 深度。推荐范围： -1。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_teacher_block', type: 'number', label: 'Teacher 块索引', desc: 'teacher 块索引（须 > student），-1 自动约 2/3 深度。推荐范围： -1。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.layersync_enabled },
  { key: 'layersync_every_n_steps', type: 'number', label: 'LayerSync 间隔步', desc: '每 N 步算一次以控税（1=每步）。推荐范围： 1–4。', defaultValue: 1, min: 1, max: 64, step: 1, visibleWhen: (c) => c.layersync_enabled },
];

// EasyControl v2 + legacy
export const S_EASYCONTROL = [
  { key: 'easycontrol_v2_enabled', type: 'boolean', label: 'EasyControl v2', desc: 'EasyControl v2 双流条件控制（Anima faithful 路线）。建议有控制图需求时开启。', defaultValue: false },
  { key: 'easycontrol_v2_cond_channels', type: 'number', label: '条件通道数', desc: '条件 latent/token 的最后一维，必须与缓存结构一致。推荐范围： 16（默认）。', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_lora_rank', type: 'number', label: '条件 LoRA Rank', desc: '条件分支 LoRA rank。推荐范围：8（默认）附近。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_task_id', type: 'string', label: 'EasyControl 任务 ID', desc: '如 generic / colorize 等任务标识。', defaultValue: 'generic', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_kind', type: 'select', label: '控制类型', desc: '控制类型/条件流形态（reference_latent 参考图 latent 等）。建议 reference_latent 默认。', defaultValue: 'reference_latent', options: [
    { value: 'reference_latent', label: 'reference_latent' },
    { value: 'control_image', label: 'control_image' },
  ], visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_target_family', type: 'string', label: '目标族', desc: '空=从 model_type 推断。', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_cache_dir', type: 'folder', pickerType: 'folder', label: '条件缓存目录', desc: '条件 latent/特征缓存目录。', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_text_cache_dir', type: 'folder', pickerType: 'folder', label: '文本缓存目录', desc: '条件侧文本编码缓存', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_image_dir', type: 'folder', pickerType: 'folder', label: '控制图目录', desc: '控制图像根目录', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_control_suffix', type: 'string', label: '控制图后缀', desc: '配对控制图文件后缀', defaultValue: '', visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_drop_p', type: 'number', label: '条件丢弃概率', desc: '训练时随机丢弃整个条件的概率（CFG 鲁棒性）。推荐范围： 0.1（默认）。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_cond_noise_max', type: 'number', label: '条件噪声上限', desc: '条件 latent 加噪上限；0 不加噪。推荐范围： 0。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_scale', type: 'number', label: 'EasyControl v2 强度', desc: '条件流缩放强度。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.easycontrol_v2_enabled },
  { key: 'easycontrol_v2_match_target_bucket', type: 'boolean', label: '匹配目标 bucket', desc: '把条件图对齐训练 bucket 尺寸。建议条件图比例杂乱时开启。', defaultValue: false, visibleWhen: (c) => c.easycontrol_v2_enabled },
  // legacy EasyControl
  { key: 'easy_control_enabled', type: 'boolean', label: 'EasyControl (legacy)', desc: '旧版 EasyControl 入口。优先用 v2。', defaultValue: false },
  { key: 'easy_control_scale', type: 'number', label: 'Legacy 强度', desc: 'Legacy 控制强度：越高越服从控制图。推荐范围：0.5–1。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.easy_control_enabled },
  { key: 'easy_control_channels', type: 'number', label: 'Legacy 通道数', desc: 'Legacy EasyControl 控制输入通道数（3=RGB）。推荐范围：与条件图一致，默认 3。', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.easy_control_enabled },
];

// Pixel-space 训练（绕过 VAE）
export const S_PIXEL_SPACE = [
  { key: 'pixel_space_enabled', type: 'boolean', label: '像素空间训练', desc: '绕过 VAE 直接在像素空间监督。实验路线，显存消耗大。建议仅特殊研究用途。', defaultValue: false },
  { key: 'pixel_space_input_channels', type: 'number', label: '像素输入通道', desc: '像素输入通道数，通常 3=RGB。推荐范围： 3。', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_loss_type', type: 'select', label: '像素损失类型', desc: '像素损失类型：mse/l1/lpips/hybrid。建议 hybrid 兼顾结构与感知。', defaultValue: 'mse', options: [
    { value: 'mse', label: 'mse' },
    { value: 'l1', label: 'l1' },
    { value: 'lpips', label: 'lpips' },
    { value: 'hybrid', label: 'hybrid' },
  ], visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_loss_weights', type: 'string', label: '像素损失权重 JSON', desc: '如 {"mse":1.0,"lpips":0.0}。', defaultValue: '{"mse":1.0,"lpips":0.0}', visibleWhen: (c) => c.pixel_space_enabled },
  { key: 'pixel_space_augmentation_enabled', type: 'boolean', label: '像素空间增强', desc: '像素侧数据增强（配合像素空间训练）。建议与 pixel_space_enabled 配套使用。', defaultValue: false, visibleWhen: (c) => c.pixel_space_enabled },
];

// ── Negative Semantic Regularization ─────────────────────────────────────────
export const S_NEGATIVE_SEMANTIC_REGULARIZATION = [
  { key: 'negative_semantic_regularization_enabled', type: 'boolean', label: '负面语义正则', desc: '负面语义正则：用负面提示词约束 LoRA-on/off 差异，抑制不想要的语义渗入。建议触发词误触发时试。', defaultValue: false },
  { key: 'negative_semantic_prompt', type: 'textarea', label: '负面语义提示词', desc: '填写希望 LoRA 少学习或少强化的内容，例如 bad hands', defaultValue: '', visibleWhen: (c) => c.negative_semantic_regularization_enabled },
  { key: 'negative_semantic_regularization_weight', type: 'number', label: '负面语义正则权重', desc: '负面语义正则权重。推荐范围：0.05–0.2，默认 0.1。', defaultValue: 0.1, min: 0, max: 2, step: 0.01, visibleWhen: (c) => c.negative_semantic_regularization_enabled },
  { key: 'negative_semantic_regularization_mode', type: 'select', label: '负面语义正则模式', desc: '当前后端实现为 lora_delta（约束负面提示词下的输出差异）。建议保持 lora_delta。', defaultValue: 'lora_delta', options: [{ value: 'lora_delta', label: 'LoRA Delta (lora_delta)' }], visibleWhen: (c) => c.negative_semantic_regularization_enabled },
];

// ── 实验探针 ──────────────────────────────────────────────────────────────────
export const S_EXPERIMENTAL_PROBES = [
  { key: 'lulynx_ln_guard', type: 'boolean', label: 'LNGuard 归一化漂移保护', desc: 'LNGuard：对可学习 Norm 参数施加基线锚定防漂移（无可训 Norm 时安全空转）。建议风格漂移明显时开。', defaultValue: false },
  { key: 'lulynx_ln_lambda', type: 'number', label: 'LNGuard 锚定强度', desc: 'Norm 参数均方漂移权重。推荐范围： 0.01 小锚定。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: (c) => c.lulynx_ln_guard },
  { key: 'fera_enabled', type: 'boolean', label: 'FERA 探测', desc: 'FERA 特征探测分支。建议实验性开启观察。', defaultValue: false },
  { key: 'fera_gate_init', type: 'number', label: 'FERA gate 初值', desc: 'FERA 门控初值（后端默认 1.0，configs_training_methods.py:300；0 会被注入器归一回 1.0）。推荐范围： 1.0。', defaultValue: 1.0, min: 0, step: 0.01, visibleWhen: (c) => c.fera_enabled },
  { key: 'fim_scan_enabled', type: 'boolean', label: 'FIM 扫描', desc: 'Fisher 信息矩阵扫描：估计各层敏感度辅助 rank 分配。建议调 rank 布局前跑一次。', defaultValue: false },
  { key: 'fim_scan_calib_steps', type: 'number', label: 'FIM 校准步数', desc: '反传校准步数。推荐范围： 8（默认）。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_r_min', type: 'number', label: 'FIM 最小 rank', desc: '扫描建议 rank 下界。推荐范围： 8。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_r_max', type: 'number', label: 'FIM 最大 rank', desc: 'rank 上界。推荐范围： 64。', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'fim_scan_suggest_ratio', type: 'number', label: 'FIM 建议层比例', desc: '标记为 suggested 的层占比。推荐范围： 0.5。', defaultValue: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.fim_scan_enabled },
  { key: 'forgetting_probe_enabled', type: 'boolean', label: '遗忘探测', desc: '监测训练中的概念遗忘信号并报告。建议长训多概念开启观察。', defaultValue: false },
  { key: 'forgetting_probe_interval', type: 'number', label: '遗忘探测间隔', desc: '每隔多少优化步探测一次。推荐范围： 50。', defaultValue: 50, min: 1, step: 1, visibleWhen: (c) => c.forgetting_probe_enabled },
  { key: 'forgetting_probe_num_anchors', type: 'number', label: '遗忘探测锚点数', desc: '对比用锚点样本数。推荐范围： 4。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.forgetting_probe_enabled },
  { key: 'grad_cosine_enabled', type: 'boolean', label: '梯度余弦监测', desc: '梯度方向余弦监测（纯诊断）。建议诊断期开。', defaultValue: false },
  { key: 'flexrank_lora_enabled', type: 'boolean', label: 'FlexRank LoRA', desc: 'FlexRank 每步随机采样激活 rank，等效正则。建议过拟合倾向时试验。', defaultValue: false },
  { key: 'fractional_grad_damping_enabled', type: 'boolean', label: '分数梯度阻尼', desc: '分数阶梯度阻尼：对历史梯度做分数阶平滑。实验特性建议默认关闭。', defaultValue: false },
  { key: 'fractional_grad_damping_order', type: 'number', label: '分数梯度阶数', desc: '阻尼阶数 α∈(0,1]，越小越平滑。推荐范围： 0.5。', defaultValue: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.fractional_grad_damping_enabled },
  { key: 'fractional_grad_damping_window', type: 'number', label: '分数梯度窗口', desc: '历史窗口长度。推荐范围： 4（默认）。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.fractional_grad_damping_enabled },
  // SmartRank（后端 smart_rank_*）：与 lulynx_smart_rank_*（实验核心 keep_ratio 裁剪）是不同键
  { key: 'smart_rank_enabled', type: 'boolean', label: 'SmartRank 动态区间', desc: 'SmartRank 动态区间：在 [min,max] 内周期调整有效 rank。建议容量自适应试验。', defaultValue: false },
  { key: 'smart_rank_interval', type: 'number', label: 'SmartRank 间隔', desc: '评估调整间隔步数。推荐范围： 50。', defaultValue: 50, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'smart_rank_min', type: 'number', label: 'SmartRank 最小 rank', desc: '动态 rank 下界。推荐范围： 4。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'smart_rank_max', type: 'number', label: 'SmartRank 最大 rank', desc: '动态 rank 上界。推荐范围：不超过 network_dim×2。', defaultValue: 128, min: 1, step: 1, visibleWhen: (c) => c.smart_rank_enabled },
  { key: 'sfad_enabled', type: 'boolean', label: 'SFAD 频率感知 dropout', desc: 'SFAD 按标签频率调节 dropout：高频 tag 多丢、稀有 tag 保护。建议标签频次极不均时开启。', defaultValue: false },
  { key: 'sfad_frequency_csv', type: 'string', label: 'SFAD 频率 CSV', desc: '标签频率表路径；留空用内置 danbooru_tags。', defaultValue: '', visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_drop_strength', type: 'number', label: 'SFAD 丢弃强度', desc: '频率→丢弃率的指数强度，0 近似均匀。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_trigger_protect', type: 'number', label: 'SFAD 触发词保护', desc: '受保护触发词的丢弃率下限。推荐范围：0–0.3；0 表示永不丢触发词。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.sfad_enabled },
  { key: 'sfad_warmup_steps', type: 'number', label: 'SFAD 预热步', desc: '保护强度缓入步数，0 立即生效。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sfad_enabled },
  { key: 'lulynx_svd_gradient_filter_enabled', type: 'boolean', label: 'lulynx SVD 梯度过滤', desc: '双侧低秩投影重构梯度（优化器状态仍全尺寸，非 GaLore）。建议实验性开启。', defaultValue: false },
  { key: 'lulynx_svd_gradient_filter_rank', type: 'number', label: 'SVD 过滤 rank', desc: '过滤子空间 rank。推荐范围： 64（默认）。', defaultValue: 64, min: 1, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_update_interval', type: 'number', label: 'SVD 基更新间隔', desc: '每 N 步重算投影基。推荐范围： 100。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_scale', type: 'number', label: 'SVD 过滤缩放', desc: '过滤梯度缩放因子。推荐范围： 1 不缩放。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'lulynx_svd_gradient_filter_warmup_steps', type: 'number', label: 'SVD 过滤预热', desc: '前 N 步用全梯度热身。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.lulynx_svd_gradient_filter_enabled },
  { key: 'compression_companion_enabled', type: 'boolean', label: '压缩伴生适配器', desc: '压缩前加载冻结 recovery adapter 补偿精度损失（bake 或 sidepath）。无 path 默认 fail-closed。建议 FP8 底模质量敏感时开启。', defaultValue: false },
  { key: 'compression_companion_path', type: 'string', label: '伴生适配器路径', desc: 'recovery adapter 文件路径。', defaultValue: '', visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_type', type: 'select', label: '伴生适配器类型', desc: '伴生适配器类型标识。建议 lora 默认。', defaultValue: 'lora', options: [
    { value: 'lora', label: 'lora' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_mode', type: 'select', label: '伴生合并模式', desc: '合并模式：merge_into_base 烘焙进底座并重置可训槽；sidepath_frozen 冻结旁路不占训练槽。建议 merge_into_base。', defaultValue: 'merge_into_base', options: [
    { value: 'merge_into_base', label: '烘焙进底座 (merge_into_base)' },
    { value: 'sidepath_frozen', label: '冻结旁路 (sidepath_frozen)' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_scale', type: 'number', label: '伴生缩放', desc: 'merge/sidepath 时的缩放系数。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_auto_bootstrap', type: 'boolean', label: '缺 path 时 Phase-0 自举', desc: '无有效 path 时 prepare 前最多做一次 product-fp8 residual 拟合并写回 path。建议默认关闭按需开。', defaultValue: false, visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'compression_companion_bootstrap_rank', type: 'number', label: '自举 SVD rank', desc: '自举 residual LoRA rank。推荐范围： 4（默认）。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_bootstrap_max_layers', type: 'number', label: '自举层数上限', desc: '自举覆盖层数上限；0 全部相交 Linear。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_bootstrap_output_path', type: 'string', label: '自举输出路径', desc: '空则写入 output_dir/companion_bootstrap.safetensors。', defaultValue: '', visibleWhen: (c) => c.compression_companion_enabled && c.compression_companion_auto_bootstrap },
  { key: 'compression_companion_missing_policy', type: 'select', label: '无 path 策略', desc: '缺 path 时策略：fail 硬失败（默认更安全）；downgrade_t1 关 companion 保留压缩并警告。建议 fail。', defaultValue: 'fail', options: [
    { value: 'fail', label: '硬失败 (fail)' },
    { value: 'downgrade_t1', label: '降级 T1 (downgrade_t1)' },
  ], visibleWhen: (c) => c.compression_companion_enabled },
  { key: 'vram_auto_tier', type: 'select', label: '低显存自动档', desc: '低显存自动档 T1–T3：启发式写入压缩与伴生配置，KPI 是能训不 OOM。建议 off 手动管控；应急选 T1 起步。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'auto', label: '自动 (最高 T2)' },
    { value: 'T0', label: 'T0 稳态' },
    { value: 'T1', label: 'T1 平衡压缩' },
    { value: 'T2', label: 'T2 激进+旁路' },
    { value: 'T3', label: 'T3 极限 (需强制)' },
  ] },
  { key: 'vram_auto_tier_force_extreme', type: 'boolean', label: '允许 T3 极限档', desc: '允许自动档进 T3 极限档（未勾选时钳制在 T2）。建议确认接受明显减速再勾。', defaultValue: false, visibleWhen: (c) => c.vram_auto_tier === 'auto' || c.vram_auto_tier === 'T3' },
  { key: 'multi_aspect_guidance_enabled', type: 'boolean', label: '多维审美引导', desc: '多维审美引导：style/character 等 scorer 加权引导。建议审美向任务开启。', defaultValue: false },
  { key: 'multi_aspect_guidance_weight', type: 'number', label: '多维引导权重', desc: '总引导损失权重。推荐范围： 0 起步小值试探。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_adaptive_weights', type: 'boolean', label: '自适应维度权重', desc: '按维度自适应加权各 scorer。建议保持 true。', defaultValue: true, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_aspect_weights', type: 'string', label: '维度权重 JSON', desc: '例如 {"style":1.0,"character":1.5}。', defaultValue: '', visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_custom_scorers', type: 'string', label: '自定义 scorer JSON', desc: '例如 {"style":"path/to', defaultValue: '', visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_default_scorer', type: 'select', label: '默认 scorer', desc: '未指定自定义 scorer 时使用的默认评分器。建议 latent_style_contras 默认。', defaultValue: 'latent_style_contrast', options: [
    { value: 'latent_style_contrast', label: 'latent_style_contrast' },
    { value: 'clip_text_similarity', label: 'clip_text_similarity' },
  ], visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_min_t', type: 'number', label: '多维引导 σ 下界', desc: '计入引导的 σ 下界。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'multi_aspect_guidance_max_t', type: 'number', label: '多维引导 σ 上界', desc: '计入引导的 σ 上界。推荐范围： 1。', defaultValue: 1.0, min: 0, max: 1, step: 0.05, visibleWhen: (c) => c.multi_aspect_guidance_enabled },
  { key: 'lr_finder_enabled', type: 'boolean', label: 'LR Finder', desc: 'LR Finder：训练前扫描学习率区间找敏感带（工具向）。建议新底模/新规模首跑前用一次。', defaultValue: false },
  { key: 'lr_finder_start_lr', type: 'number', label: 'LR Finder 起始 LR', desc: '扫描起始 LR。推荐范围： 1e-7（默认）。', defaultValue: 1e-7, min: 0, step: 1e-8, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'lr_finder_end_lr', type: 'number', label: 'LR Finder 结束 LR', desc: '扫描结束 LR。推荐范围： 0.1（默认）覆盖到发散区。', defaultValue: 1e-1, min: 0, step: 1e-3, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'lr_finder_num_steps', type: 'number', label: 'LR Finder 步数', desc: '扫描步数，越多曲线越平滑越慢。推荐范围： 100（默认）。', defaultValue: 100, min: 1, step: 1, visibleWhen: (c) => c.lr_finder_enabled },
  { key: 'sds_lora_enabled', type: 'boolean', label: 'SDS-LoRA (无奇异值梯度)', desc: 'SDS-LoRA：双分支产出各向同性梯度 + warmup SVD 重参数化。建议实验性开启。', defaultValue: false },
  { key: 'sds_lora_warmup_steps', type: 'number', label: 'SDS-LoRA warmup', desc: 'SVD 重参数化前的 plain-LoRA 预热步。推荐范围： 10（默认）。', defaultValue: 10, min: 0, step: 1, visibleWhen: (c) => c.sds_lora_enabled },
  { key: 'sds_lora_refresh_phases', type: 'number', label: 'SDS-LoRA QR 刷新阶段', desc: '全程 QR 刷新阶段数。推荐范围： 5（默认）。', defaultValue: 5, min: 1, step: 1, visibleWhen: (c) => c.sds_lora_enabled },
  { key: 'sds_lora_clear_optimizer_state', type: 'boolean', label: 'SDS-LoRA 清空动量', desc: '重参数时清理一次优化器动量防旧动量污染。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.sds_lora_enabled },
];

// ── 诊断与监控 ────────────────────────────────────────────────────────────────
export const S_DIAGNOSTICS_MONITORING = [
  { key: 'advanced_monitoring_enabled', type: 'boolean', label: '高级监控', desc: '训练过程高级监控指标采集。建议排查期开启，平时关省开销。', defaultValue: false },
  { key: 'advanced_stats_enabled', type: 'boolean', label: '高级统计', desc: '额外统计信息输出。建议诊断期开启。', defaultValue: false },
  { key: 'runtime_features_detail', type: 'select', label: '运行时统计输出', desc: '运行时统计输出详细度（off 关闭）。建议 off，排查时选档。', defaultValue: 'off', options: [{ value: 'off', label: '不输出（默认）' }, { value: 'compact', label: '精简' }, { value: 'full', label: '完整' }], visibleWhen: (c) => c.advanced_stats_enabled },
  { key: 'deep_diagnostics_enabled', type: 'boolean', label: '深度诊断', desc: '深度诊断模式（更多日志/探针）。建议仅在排查疑难时开启。', defaultValue: false },
  { key: 'layer_monitor_enabled', type: 'boolean', label: '逐层监测', desc: '逐层激活/梯度监测。建议定位某层异常时开启。', defaultValue: false },
  { key: 'layer_monitor_mode', type: 'select', label: '逐层监测模式', desc: 'sampled 抽样统计轻量；exact 全量准而慢。建议 sampled。', defaultValue: 'sampled', options: [
    { value: 'sampled', label: 'sampled（抽样）' },
    { value: 'exact', label: 'exact（全量）' },
  ], visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_interval', type: 'number', label: '监测间隔（优化步）', desc: '每 N 个优化步采样一次。推荐范围： 3。', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_max_layers', type: 'number', label: '最多监测层数', desc: '每轮最多统计层数，0 不限。推荐范围： 10 控制日志量。', defaultValue: 10, min: 0, step: 1, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_sparsity_epsilon', type: 'number', label: '稀疏阈值 ε', desc: '绝对值低于 ε 计为稀疏元素。推荐范围： 1e-8。', defaultValue: 1e-8, min: 0, step: 1e-9, visibleWhen: (c) => c.layer_monitor_enabled },
  { key: 'layer_monitor_sample_size', type: 'number', label: '抽样元素数', desc: 'sampled 模式每层抽样元素数。推荐范围： 4096。', defaultValue: 4096, min: 64, step: 64, visibleWhen: (c) => c.layer_monitor_enabled && String(c.layer_monitor_mode || 'sampled') === 'sampled' },
  { key: 'step_phase_profile_enabled', type: 'boolean', label: '步阶段 profiling', desc: '训练步各阶段耗时 profiling。建议性能分析期开启。', defaultValue: false },
];

// ── AutoController ────────────────────────────────────────────────────────────
export const S_AUTO_CONTROLLER = [
  { key: 'ac_enabled', type: 'boolean', label: '启用 AutoController', desc: 'AutoController：按训练状态自动调整学习率、早停、TE 冻结等（旧配置 lulynx_auto_controller_* 仍被识别）。建议先跑基线再开，便于归因。', defaultValue: false },
  { key: 'ac_enable_smart_early_stopping', type: 'boolean', label: '智能早停', desc: 'loss 长期不降时自动停止。建议长训无人值守开启防浪费。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_early_stopping_patience', type: 'number', label: '早停耐心值（步数）', desc: '多少步无改善触发早停。推荐范围：5（默认）～20 视噪声水平。', defaultValue: 5, min: 1, step: 1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_early_stopping', true)) },
  // 幻影四键之一（2026-08 第 3 站审计 C）：AutoController 只消费
  // trainer_execution_resume_callbacks.py:66-123 所列键；下面四个 ac_* 仅声明于
  // configs_monitoring.py:459-474，全仓零读者。hidden 保旧草稿回显，提交层剥除。
  { key: 'ac_early_stopping_threshold', type: 'hidden', defaultValue: 0.001 },
  { key: 'ac_enable_smart_lr_decay', type: 'boolean', label: '智能学习率衰减', desc: '平台期自动降低学习率。建议配合早停一起用。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_lr_decay_factor', type: 'number', label: '学习率衰减系数', desc: '触发衰减时 LR 乘的系数。推荐范围：0.5（默认）。', defaultValue: 0.5, min: 0.1, max: 1, step: 0.05, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_lr_decay', true)) },
  { key: 'ac_max_decays', type: 'number', label: '最大衰减次数', desc: 'LR 最多衰减次数。推荐范围： 3。', defaultValue: 3, min: 1, step: 1, visibleWhen: all(when('ac_enabled', true), when('ac_enable_smart_lr_decay', true)) },
  { key: 'ac_enable_auto_te_freeze', type: 'boolean', label: '自动冻结文本编码器', desc: '到指定步数自动冻结文本编码器。建议 TE 收敛后想省显存的长训开启。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_te_freeze_step', type: 'hidden', defaultValue: 0 },
  { key: 'ac_enable_dynamic_loss_scaling', type: 'boolean', label: '动态损失缩放', desc: '按梯度范数动态调整损失缩放。建议 fp16 训练不稳时开启。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_enable_auto_lr_adjustment', type: 'boolean', label: '自动学习率调整', desc: '按 GSNR/loss 目标自动调 LR。建议与手动 LR 二选一对照评估。', defaultValue: false, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_auto_lr_scale_factor', type: 'hidden', defaultValue: 1.0 },
  { key: 'ac_target_gsnr', type: 'number', label: '目标 GSNR', desc: '目标梯度信噪比，驱动 LR 自动调整。推荐范围：5（默认）附近。', defaultValue: 5.0, min: 0, step: 0.5, visibleWhen: all(when('ac_enabled', true), when('ac_enable_auto_lr_adjustment', true)) },
  { key: 'ac_target_loss', type: 'hidden', defaultValue: 0.0 },
  { key: 'ac_warmup_steps', type: 'number', label: 'AutoController 预热步数', desc: '控制器生效前的观察步数。推荐范围：100（默认）附近。', defaultValue: 100, min: 0, step: 10, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_loss_plateau_window', type: 'number', label: '损失平台窗口', desc: '判定平台的滑动窗口步数。推荐范围：50（默认）。', defaultValue: 50, min: 10, step: 10, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_clip_drift_warning', type: 'number', label: 'CLIP 漂移警告阈值', desc: 'CLIP 分数漂移警告阈值。推荐范围： 0.03（默认）。', defaultValue: 0.03, min: 0, step: 0.001, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_clip_drift_danger', type: 'number', label: 'CLIP 漂移危险阈值', desc: 'CLIP 漂移干预阈值（如降 LR）。推荐范围： 0.05（默认）。', defaultValue: 0.05, min: 0, step: 0.001, visibleWhen: when('ac_enabled', true) },
  { key: 'ac_stable_rank_collapse_threshold', type: 'number', label: 'Stable Rank 崩溃阈值', desc: 'Stable Rank 下降比例视为崩溃。推荐范围： 0.3。', defaultValue: 0.3, min: 0, max: 1, step: 0.05, visibleWhen: when('ac_enabled', true) },
];

// ── Pattern Loss（频带损失）──────────────────────────────────────────────────
export const S_PATTERN_LOSS = [
  { key: 'pattern_loss_enabled', type: 'boolean', label: 'Pattern Loss (频带损失)', desc: 'Pattern Loss：按 DWT 频带（LL 低频 / LH·HL·HH 高频）分别施加损失，精细控制结构 vs 细节。建议明确想约束纹理时开启。', defaultValue: false },
  { key: 'pattern_loss_levels', type: 'number', label: 'Pattern Loss 分解层数', desc: 'DWT 分解层数。推荐范围：1（默认）～4，越多越大尺度约束。', defaultValue: 1, min: 1, max: 4, step: 1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_ll_type', type: 'select', label: '低频 (LL) 损失类型', desc: '低频带损失函数类型。建议 l2 保整体结构。', defaultValue: 'l2', options: [{ value: 'l2', label: 'l2' }, { value: 'l1', label: 'l1' }, { value: 'huber', label: 'huber' }], visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_ll_weight', type: 'number', label: '低频 (LL) 权重', desc: '低频带权重。推荐范围：1（默认）；过高会压制高频学习。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_type', type: 'select', label: '高频损失类型', desc: '高频带损失函数类型。建议 huber 对离群纹波稳健。', defaultValue: 'huber', options: [{ value: 'l2', label: 'l2' }, { value: 'l1', label: 'l1' }, { value: 'huber', label: 'huber' }], visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_weight', type: 'number', label: '高频权重', desc: '高频带权重。推荐范围：2（默认）附近，强调细节。', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: (c) => c.pattern_loss_enabled },
  { key: 'pattern_loss_high_huber_c', type: 'number', label: '高频 Huber c', desc: '高频 huber 过渡阈值。推荐范围： 0.1（默认）。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.pattern_loss_enabled && c.pattern_loss_high_type === 'huber' },
];

// ── Concept Geometry（数据集几何采样；不含 legacy h_lora_* 别名）────────────────
export const S_CONCEPT_GEOMETRY = [
  { key: 'concept_geometry_enabled', type: 'boolean', label: 'Concept Geometry', desc: 'Concept Geometry：按概念几何图做采样/加权，控制多概念的相对距离。建议多概念纠缠时试。', defaultValue: false },
  { key: 'concept_geometry_path', type: 'string', label: '几何图路径', desc: '空=训练目录下 concept_geometry.', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_sampler_mode', type: 'select', label: '采样模式', desc: '采样模式：curriculum 课程 / density 密度驱动。建议 density_curriculum 默认。', defaultValue: 'density_curriculum', options: [
    { value: 'curriculum', label: 'curriculum' },
    { value: 'density', label: 'density' },
    { value: 'density_curriculum', label: 'density_curriculum' },
    { value: 'concept_batch', label: 'concept_batch' },
  ], visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_loss_weighting', type: 'boolean', label: '几何损失加权', desc: '用几何密度派生逐样本 loss 权重。建议实验性开启。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_density_power', type: 'number', label: '密度幂次', desc: '密度指数：调节几何密度对采样的影响强度。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_compute_backend', type: 'select', label: '图计算后端', desc: 'auto=智能选择；native=Python；rust=性能优先。', defaultValue: 'auto', options: [
    { value: 'auto', label: 'auto' },
    { value: 'native', label: 'native' },
    { value: 'rust', label: 'rust' },
  ], visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_source_priority', type: 'string', label: '概念来源优先级', desc: '逗号分隔：explicit,folder,nl,identity', defaultValue: 'explicit,folder,nl,identity,tag,stem', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_alias_map', type: 'textarea', label: '别名映射 JSON', desc: 'prep 时概念/标签别名 JSON 文本。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_alias_map_path', type: 'string', label: '别名映射文件', desc: '可选 JSON 文件路径', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_semantic_enabled', type: 'boolean', label: '语义 embedding 增强', desc: 'prep 时用文本 embedding 增强几何结构。建议语义标签丰富时开启。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_embedding_provider', type: 'select', label: 'Embedding 提供方', desc: 'Embedding 提供方：local_path 本地 / auto_download 自动下载 / api。建议 local_path 可控性最好。', defaultValue: 'local_path', options: [
    { value: 'local_path', label: 'local_path' },
    { value: 'auto_download', label: 'auto_download' },
    { value: 'api', label: 'api' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_backend', type: 'select', label: 'Embedding 后端', desc: 'Embedding 推理后端：pytorch / onnx 扩展点。建议 pytorch。', defaultValue: 'pytorch', options: [
    { value: 'pytorch', label: 'pytorch' },
    { value: 'onnx', label: 'onnx' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_model', type: 'string', label: 'Embedding 模型 ID', desc: '如 BAAI/bge-m3', defaultValue: 'BAAI/bge-m3', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_model_path', type: 'string', label: 'Embedding 本地路径', desc: 'local_path 时使用', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_cache_dir', type: 'string', label: 'Embedding 缓存目录', desc: '下载/缓存目录', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_allow_download', type: 'boolean', label: '允许下载 Embedding', desc: '允许联网下载 Embedding 模型。离线环境务必关闭。建议默认 false。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_api_base', type: 'string', label: 'Embedding API Base', desc: 'provider=api 时的 endpoint。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_api_key', type: 'string', label: 'Embedding API Key', desc: 'provider=api 时的密钥。', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_api_model', type: 'string', label: 'Embedding API 模型名', desc: '远程 API 模型名', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled && c.concept_geometry_embedding_provider === 'api' },
  { key: 'concept_geometry_embedding_batch_size', type: 'number', label: 'Embedding 批量', desc: 'Embedding prep 的批大小。推荐范围： 8（默认）。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_embedding_device', type: 'select', label: 'Embedding 设备', desc: 'Embedding 计算设备：cpu/cuda。小模型 cpu 即可。建议 cpu 默认。', defaultValue: 'cpu', options: [
    { value: 'cpu', label: 'cpu' },
    { value: 'cuda', label: 'cuda' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_semantic_enabled },
  { key: 'concept_geometry_translation_enabled', type: 'boolean', label: '标签翻译', desc: 'prep 时可选翻译管线统一 caption 语言。建议多语言混杂数据集才开。', defaultValue: false, visibleWhen: (c) => c.concept_geometry_enabled },
  { key: 'concept_geometry_translation_provider', type: 'select', label: '翻译提供方', desc: '翻译提供方：local_path/api。建议 local_path。', defaultValue: 'local_path', options: [
    { value: 'local_path', label: 'local_path' },
    { value: 'api', label: 'api' },
  ], visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
  { key: 'concept_geometry_translation_model_path', type: 'string', label: '翻译模型路径', desc: 'local_path 时使用', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
  { key: 'concept_geometry_translation_api_base', type: 'string', label: '翻译 API Base', desc: 'provider=api', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_api_key', type: 'string', label: '翻译 API Key', desc: 'provider=api', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_api_model', type: 'string', label: '翻译 API 模型名', desc: '远程模型名', defaultValue: '', visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled && c.concept_geometry_translation_provider === 'api' },
  { key: 'concept_geometry_translation_batch_size', type: 'number', label: '翻译批量', desc: '翻译 prep 批大小。推荐范围： 8。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => c.concept_geometry_enabled && c.concept_geometry_translation_enabled },
];

// ── IP-Adapter 条件注入 ───────────────────────────────────────────────────────
export const S_IP_ADAPTER = [
  { key: 'ip_adapter_enabled', type: 'boolean', label: 'IP-Adapter', desc: 'IP-Adapter 图像条件注入：参考图引导生成。建议有强风格/主体参照需求时开启。', defaultValue: false },
  { key: 'ip_adapter_encoder_dim', type: 'number', label: 'IP-Adapter 编码维', desc: '图像编码器输出维，与所选 encoder 绑定。推荐范围：保持默认值不动。', defaultValue: 1024, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_cond_dim', type: 'number', label: 'IP-Adapter 条件维', desc: '注入主干的条件维（SigLIP 为 1152），必须与编码器匹配。推荐范围：保持默认值不动。', defaultValue: 1152, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_num_image_tokens', type: 'number', label: '图像 token 数', desc: '每图投影 token 数。推荐范围：16（默认）。', defaultValue: 16, min: 1, step: 1, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_scale', type: 'number', label: 'IP-Adapter 缩放', desc: 'IP-Adapter 条件强度 0–1+。推荐范围：0.5–1（默认 1）。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.ip_adapter_enabled },
  { key: 'ip_adapter_cond_mode', type: 'select', label: '条件模式', desc: '条件融合方式（concat 等）。建议 concat 默认。', defaultValue: 'concat', options: [
    { value: 'concat', label: 'concat' },
  ], visibleWhen: (c) => c.ip_adapter_enabled },
];

// ── DPO 偏好对齐 ──────────────────────────────────────────────────────────────
export const S_DPO = [
  { key: 'dpo_enabled', type: 'boolean', label: 'DPO / Flow-DPO', desc: 'DPO/Flow-DPO 偏好对齐：真正生效还需 dpo_weight>0。有 rejected_latents 真 pair 走四路 margin（更慢）；无 pair 走弱代理扰动路径。建议先备好偏好数据。', defaultValue: false },
  { key: 'dpo_weight', type: 'number', label: 'DPO 权重', desc: 'DPO 损失总闸权重（weight>0 才生效）。推荐范围： 0.1–0.5 起步。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_beta', type: 'number', label: 'DPO β', desc: '偏好温度/强度 β。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_pair_mode', type: 'string', label: 'Pair 模式', desc: 'auto=有 rejected_latents 走 Flow-DPO 否则弱代理；flow=强制真 pair（无则 skip）；proxy=强制弱代理。', defaultValue: 'auto', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_cache_dir', type: 'string', label: 'Rejected latent 缓存目录', desc: '按 stem 加载 lose 侧 clean latent 侧车；空=不从盘加载。需与 preferred 同 spatial。', defaultValue: '', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_filename_template', type: 'string', label: 'Rejected 文件名模板', desc: '须含 {stem}。默认 {stem}_rejected_anima.npz。', defaultValue: '{stem}_rejected_anima.npz', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_field', type: 'string', label: 'Rejected batch 字段', desc: 'batch 中真 pair clean latent 键名。', defaultValue: 'rejected_latents', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_latent_required', type: 'boolean', label: 'Rejected 侧车必填', desc: '开启后缺 rejected 文件直接报错而非静默跳过。建议严格流程开启。', defaultValue: false, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_error_reduction', type: 'string', label: '误差归约', desc: 'Flow-DPO 预测误差 sum 或 mean。', defaultValue: 'sum', visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_anchor_alpha', type: 'number', label: 'Anchor α', desc: 'policy≈ref 的全局 MSE 正则；0 关。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_logprob_scale', type: 'number', label: 'DPO logprob 尺度', desc: '弱代理路径的 σ_dpo² 尺度。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_rejected_perturb', type: 'number', label: 'Rejected 扰动幅度', desc: '自构造 rejected 目标的扰动幅度。推荐范围： 0.1（默认）。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.dpo_enabled },
  { key: 'dpo_preference_pair_field', type: 'string', label: 'Rejected target 字段', desc: '弱代理：batch 中显式 rejected velocity target 字段；空=自构造。与真 pair latent 不同。', defaultValue: '', visibleWhen: (c) => c.dpo_enabled },
];

// ── SRA2-HASTE 表征对齐储备 ───────────────────────────────────────────────────
export const S_SRA2_HASTE = [
  { key: 'sra2_haste_enabled', type: 'boolean', label: 'SRA2-HASTE', desc: 'SRA2-HASTE 中间层表征对齐 + HASTE 自适应调度。建议与 REPA 族二选一。', defaultValue: false },
  { key: 'sra2_haste_capture_layers', type: 'string', label: '捕获层后缀', desc: '逗号分隔的 module-name 后缀。', defaultValue: '', visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_loss_type', type: 'select', label: '对齐损失类型', desc: '对齐损失类型：cosine/l2/l1。建议 cosine。', defaultValue: 'cosine', options: [
    { value: 'cosine', label: 'cosine' },
    { value: 'l2', label: 'l2' },
    { value: 'l1', label: 'l1' },
  ], visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_base_weight', type: 'number', label: '基础权重', desc: '对齐损失基础权重。推荐范围： 1（默认）。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_start_step', type: 'number', label: '起始步', desc: '从此优化步开始生效。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_stop_step', type: 'number', label: '结束步', desc: '-1 不提前结束；≥0 到此停。推荐范围： -1。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_decay_start_step', type: 'number', label: '衰减起始步', desc: '开始衰减的步数；-1 不衰减。推荐范围： -1。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_decay_end_step', type: 'number', label: '衰减结束步', desc: '衰减到 min_weight 的终点步。推荐范围： -1 配合上项。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_min_weight', type: 'number', label: '最小权重', desc: '衰减下限权重。推荐范围： 0。', defaultValue: 0.0, min: 0, step: 0.01, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_plateau_patience', type: 'number', label: '平台耐心', desc: '平台早停耐心；0 关闭。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_min_relative_improvement', type: 'number', label: '最小相对改进', desc: '判定改进的最小相对阈值。推荐范围： 0。', defaultValue: 0.0, min: 0, step: 0.001, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_normalize_targets', type: 'boolean', label: '归一化 target', desc: '对齐前归一化 target。建议保持 true（默认）。', defaultValue: true, visibleWhen: (c) => c.sra2_haste_enabled },
  { key: 'sra2_haste_stop_grad_target', type: 'boolean', label: 'target 停梯度', desc: 'target 侧 stop-gradient。建议保持 true。', defaultValue: true, visibleWhen: (c) => c.sra2_haste_enabled },
];

// ── Adaptive Caching（Vortex Aircon 智能块跳过）────────────────────────────────
export const S_ADAPTIVE_CACHING = [
  { key: 'adaptive_caching_enabled', type: 'boolean', label: 'Adaptive Caching', desc: 'Aircon：按 block 变化率跳过部分计算。与 sigma 深度调度正交。建议追求速度且容忍近似时试验。', defaultValue: false },
  { key: 'adaptive_caching_threshold_base', type: 'number', label: '阈值基线', desc: '变化率基线阈值，越高越少跳过。推荐范围：0.1（默认）附近微调。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_threshold_decay', type: 'number', label: '阈值衰减', desc: '随时间步衰减阈值（高 σ 更宽松）。推荐范围： 0.5。', defaultValue: 0.5, min: 0, step: 0.05, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_ema_momentum', type: 'number', label: 'EMA 动量', desc: '变化率 EMA 平滑（Aircon）。推荐范围： 0.9。', defaultValue: 0.9, min: 0, max: 0.999, step: 0.01, visibleWhen: (c) => c.adaptive_caching_enabled },
  { key: 'adaptive_caching_min_blocks_computed', type: 'number', label: '最少计算 block 数', desc: '每步至少完整计算的 block 数（稳定护栏）。推荐范围：4（默认）。', defaultValue: 4, min: 1, step: 1, visibleWhen: (c) => c.adaptive_caching_enabled },
];

// ── 预览采样探针（FSG / T-GATE / Spectrum / SmoothCache probe）────────────────
// 与产品入口 sample_cache_seam_* 并存；探针默认关，apply/skip 才真正改行为。
export const S_SAMPLE_PROBES = [
  { key: 'spd_enabled', type: 'boolean', label: 'SPD 多分辨率预览采样', desc: 'SPD 多分辨率预览采样：只影响预览/推理 sampler，不进训练 loss。建议默认关闭。', defaultValue: false },
  { key: 'spd_scale_factors', type: 'string', label: 'SPD 分辨率层级', desc: '逗号分隔缩放比例，例如 0.5,1.0。', defaultValue: '0.5,1.0', visibleWhen: (c) => c.spd_enabled },
  { key: 'spd_steps_per_level', type: 'string', label: 'SPD 每层步数', desc: '逗号分隔；留空时按预览总步数自动分配。', defaultValue: '', visibleWhen: (c) => c.spd_enabled },
  { key: 'spd_resize_mode', type: 'select', label: 'SPD Resize 模式', desc: 'SPD latent 多分辨率插值方式。建议 bilinear 默认。', defaultValue: 'bilinear', options: ['nearest', 'bilinear', 'bicubic'], visibleWhen: (c) => c.spd_enabled },
  { key: 'sample_fsg_probe', type: 'boolean', label: 'FSG 探针', desc: 'FSG 频带引导探针。建议诊断期开。', defaultValue: false },
  { key: 'sample_fsg_band_start', type: 'number', label: 'FSG 频带起点', desc: 'σ 频带起点。推荐范围： 0.45。', defaultValue: 0.45, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_band_end', type: 'number', label: 'FSG 频带终点', desc: 'σ 频带终点。推荐范围： 0.85。', defaultValue: 0.85, min: 0, max: 1, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_k', type: 'number', label: 'FSG k', desc: 'FSG 阶/组数。推荐范围： 3（默认）。', defaultValue: 3, min: 1, step: 1, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_d_sigma', type: 'number', label: 'FSG d_sigma', desc: 'σ 扰动步长。推荐范围： 0.1（默认）。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_gamma', type: 'number', label: 'FSG gamma', desc: '引导强度；0 关闭。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_fsg_apply', type: 'boolean', label: 'FSG 真正应用', desc: '关=仅探针记录；开=真正修改采样轨迹。建议先 probe 后 apply。', defaultValue: false, visibleWhen: (c) => c.sample_fsg_probe },
  { key: 'sample_tgate_probe', type: 'boolean', label: 'T-GATE 探针', desc: 'T-GATE 交叉注意力复用探针。建议诊断期开。', defaultValue: false },
  { key: 'sample_tgate_start_step', type: 'number', label: 'T-GATE 起始步', desc: '从此采样步开始考虑复用。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_tgate_min_block', type: 'number', label: 'T-GATE 最小 block', desc: '小于该索引的 block 不跳过（护浅层）。推荐范围： 0。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_tgate_skip', type: 'boolean', label: 'T-GATE 真正跳过', desc: '真正复用交叉注意力输出跳算。关=默认路径。建议验证 probe 后再开。', defaultValue: false, visibleWhen: (c) => c.sample_tgate_probe },
  { key: 'sample_spectrum_probe', type: 'boolean', label: 'Spectrum 探针', desc: 'Spectrum 块缓存外推探针（与预览加速 seam 独立的诊断）。建议诊断期开。', defaultValue: false },
  { key: 'sample_spectrum_window_size', type: 'number', label: 'Spectrum 窗口', desc: 'Spectrum 历史窗口大小。推荐范围： 2（默认）。', defaultValue: 2.0, min: 1, step: 0.5, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_flex_window', type: 'number', label: 'Spectrum 柔性窗口', desc: '柔性窗口系数。推荐范围： 0.25（默认）。', defaultValue: 0.25, min: 0, step: 0.05, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_warmup_steps', type: 'number', label: 'Spectrum 预热步', desc: '预热步数内不做外推。推荐范围： 6。', defaultValue: 6, min: 0, step: 1, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_spectrum_stop_caching_step', type: 'number', label: 'Spectrum 停缓存步', desc: '-1 不提前停；≥0 从该步停缓存。推荐范围： -1。', defaultValue: -1, min: -1, step: 1, visibleWhen: (c) => c.sample_spectrum_probe },
  { key: 'sample_smoothcache_probe', type: 'boolean', label: 'SmoothCache 探针', desc: 'SmoothCache 误差引导探针（诊断）。建议诊断期开。', defaultValue: false },
  { key: 'sample_smoothcache_warmup_steps', type: 'number', label: 'SmoothCache 预热步', desc: '预热内不跳过任何计算。推荐范围： 2。', defaultValue: 2, min: 0, step: 1, visibleWhen: (c) => c.sample_smoothcache_probe },
];

// ── TurboCore ─────────────────────────────────────────────────────────────────
// turbocore_enabled 是本段的主开关。旧注释说「主开关在顶栏」指的是 launcher web UI
// 的 AppFooter TurboCore 芯片（backend/launcher/web），本 UI 没有那个控件，
// 所以这里必须自带主开关，否则 turbocore_* 高级参数全都无法生效。
// 不暴露 turbocore_update_shadow_* / turbocore_native_update_* 诊断族。
const nativeRuntimeArch = (config) => {
  const route = String(config?.model_train_type || config?.training_type || config?.schema_id || '')
    .trim().toLowerCase().replaceAll('_', '-');
  const explicit = String(config?.concept_edit_base_model || config?.model_type || '').trim().toLowerCase();
  if (route === 'concept-edit' && ['anima', 'newbie', 'sdxl'].includes(explicit)) return explicit;
  if (route.includes('anima')) return 'anima';
  if (route.includes('newbie')) return 'newbie';
  if (route.includes('sdxl')) return 'sdxl';
  if (['anima', 'newbie', 'sdxl'].includes(explicit)) return explicit;
  return '';
};
const supportsSteadyAccel = (config) => ['anima', 'newbie'].includes(nativeRuntimeArch(config));
const supportsNativeRuntimeProfile = (config) => ['anima', 'newbie', 'sdxl'].includes(nativeRuntimeArch(config));
const nativeRuntimeProfileOptions = (config) => {
  const base = [
    { value: 'standard', label: 'standard（标准）' },
    { value: 'aggressive', label: 'aggressive（激进加速）' },
  ];
  const arch = nativeRuntimeArch(config);
  if (arch === 'newbie') return [...base, { value: 'anima_fast', label: 'anima_fast（Newbie/Anima 快速）' }];
  if (arch !== 'anima') return base;
  return [
    ...base,
    { value: 'anima_fast', label: 'anima_fast（Anima 快速）' },
    { value: 'anima_low_vram', label: 'anima_low_vram（Anima 低显存）' },
    { value: 'anima_experimental', label: 'anima_experimental（Anima 实验性）' },
  ];
};
export const S_TURBOCORE = [
  { key: 'turbocore_enabled', type: 'boolean', label: 'TurboCore 优化器加速（主开关）', title: 'turbocore_enabled', desc: '开启后优化器 step 走 CUDA/Triton 加速内核；关闭=标准 PyTorch 路径。开启时「优化器后端」隐藏，Lulynx Triton 优化器自动置 off。', defaultValue: false },
  { key: 'lulynx_optimization_enabled', type: 'boolean', label: 'Lulynx 优化', title: 'lulynx_optimization_enabled', desc: '系统级调度优化包：BlockSwap auto→pipeline、异步 D2H、stream-ordered 预取、TREAD/DiffCR 跳算等联动。建议追求吞吐时开启并观察稳定性。', defaultValue: false },
  { key: 'lulynx_steady_accel', type: 'select', label: 'Lulynx 稳态加速包', title: 'lulynx_steady_accel', desc: 'Anima/Newbie 稳态算子加速包（Triton inject + TC-FMT + fused RoPE）。auto 按家族能力判定。建议 auto。', defaultValue: 'auto', options: [
    { value: 'auto', label: 'auto（自动推荐）' },
    { value: 'on', label: 'on（强制开启）' },
    { value: 'off', label: 'off（关闭）' },
  ], visibleWhen: supportsSteadyAccel },
  { key: 'turbocore_data_pipeline_enabled', type: 'boolean', label: 'TurboCore Rust 数据管线', title: 'turbocore_data_pipeline_enabled', desc: 'caption DataLoader 走 Rust 解码管线降 CPU/IO 瓶颈，不依赖 TurboCore 优化器开关。建议 IO 瓶颈时开启。', defaultValue: false },
  { key: 'native_runtime_profile', type: 'select', label: '原生运行时 Profile', title: 'native_runtime_profile', desc: '原生运行时加速档位：SDXL 支持 aggressive；Anima/Newbie 另有 DiT 快速档。低显存与实验档仅 Anima 适用。建议 standard。', defaultValue: 'standard', options: nativeRuntimeProfileOptions, visibleWhen: all(when('performance_expert_mode', true), supportsNativeRuntimeProfile) },
  { key: 'turbocore_mode', type: 'select', label: 'TurboCore 模式（开发者选项）', desc: '需先开启上面的 TurboCore 主开关。', defaultValue: 'off', options: [
    { value: 'off', label: 'off（关闭）' },
    { value: 'profile', label: 'profile（性能分析）' },
    { value: 'native_experimental', label: 'native_experimental（加速）' },
  ], visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_tuned_kernel_disable', type: 'boolean', label: '禁用自动调优内核', desc: '关闭 TurboCore 自动调优内核的全局开关。建议默认 false 保持启用。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_profile', type: 'select', label: 'TurboCore 性能档位', desc: 'TurboCore 性能档位：basic 基础；fast 自动联动 Vortex Aircon 与 fused optimizer。建议 basic 稳妥起步。', defaultValue: 'basic', options: [
    { value: 'basic', label: 'Basic (基础)' },
    { value: 'fast', label: 'Fast (快速，联动 Vortex Aircon)' },
  ], visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_allow_fallback', type: 'boolean', label: '允许回退到 PyTorch', desc: '优化内核不可用时自动回退，建议保持开启。', defaultValue: true, visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_strict', type: 'boolean', label: '严格模式', desc: '优化内核失败时报错而非静默回退，便于调试。建议调试期开，日常关。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_workspace_mb', type: 'number', label: 'Workspace 大小 (MB)', desc: 'kernel workspace 上限 MB，0 自动分配。推荐范围： 0。', defaultValue: 0, min: 0, step: 64, visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_prefetch_depth', type: 'number', label: '预取深度', desc: '预取队列深度，默认 2：加深隐藏延迟但占显存。推荐范围：2–4。', defaultValue: 2, min: 1, max: 8, step: 1, visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_features', type: 'textarea', label: '启用功能列表', desc: '额外启用的优化功能（逗号分隔），留空=使用 profile 默认。', defaultValue: '', visibleWhen: when('performance_expert_mode', true) },
  { key: 'turbocore_disable', type: 'textarea', label: '禁用功能列表', desc: '要禁用的优化功能（逗号分隔），用于排查兼容性问题。', defaultValue: '', visibleWhen: when('performance_expert_mode', true) },
];
