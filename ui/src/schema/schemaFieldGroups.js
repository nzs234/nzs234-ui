// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// schemaFieldGroups.js — 训练 Schema 共享字段组 + 跨族 Section 模板
// 这里集中所有被「2 个以上训练族」复用的 S_* 字段数组,以及跨族共享的
// section/field 构造器(概念编辑 / Finetune / ControlNet / Textual Inversion)。
// 各族 schema 文件(animaSchema / sdxlSchema / otherSchemas)从这里 spread 复用。
//
// 命名沿用历史(如 S_SPEED_SDXL / S_LULYNX_SDXL / ANIMA_BLOCK_RESIDENCY_FIELDS)——
// 名字标示语义来源,但它们实际被多个族消费,故归入公共组件库,勿据名误判归属:
//   · S_SPEED_SDXL / S_SPEED_SD15 被共享的 conceptEditSections 同时消费
//   · ANIMA_BLOCK_RESIDENCY_FIELDS 同时被 anima-lora 与 flux-finetune 消费
//   · S_LULYNX_SDXL 被 sdxl / anima / flux-ft / newbie 消费
// 依赖方向:schemaCommon → 本文件 → 各族文件 → schemaIndex(单向,无环)。
// ================================================================
import { OPTIMIZER_SPECIFIC_FIELDS } from './features/optimizerParams.js';
import {
  when, all, oneOf, sec, netLora, getAdapterTypeKey, uiGroup, SAMPLE_SAMPLER_OPTIONS,
  swapEnabled, nonResidentBlockMode,
  schedulerOptions, ALL_SCHEDULERS, ALL_OPTIMIZERS, TARGET_LORA_OPTIMIZERS,
  OPTIMIZER_BACKEND_OPTIONS, OPTIMIZER_BACKEND_OPTIONS_FINETUNE, ADVANCED_OPTIMIZER_STRATEGY_OPTIONS,
  ACCELERATION_PROFILE_OPTIONS, COMPILE_RUNTIME_OPTIONS, WINDOW_ATTENTION_BACKEND_OPTIONS,
  DATA_TRANSFER_PROFILE_MODE_OPTIONS, LOSS_PRECISION_OPTIONS,
  COMPILE_SHAPE_STRATEGY_OPTIONS, COMPILE_TARGET_STRATEGY_OPTIONS,
  CACHED_COLLATE_MODE_OPTIONS, DATA_BACKEND_OPTIONS, CHECKPOINT_POLICY_OPTIONS,
  LORA_RECOMPUTE_OPTIONS, DIT_BLOCK_RESIDENCY_OPTIONS,
  PCIE_TRANSFER_FORMAT_FIELD, sparseSwapFields, pcieDeltaCacheField, pcieDeltaCacheModeFields, vortexRuntimeFields,
  FUSED_PROJECTION_MEMORY_MODE_OPTIONS, BLOCK_SWAP_STRATEGY_OPTIONS,
  SAFEGUARD_GRADIENT_SCAN_OPTIONS, IMAGE_DECODE_BACKEND_OPTIONS,
} from './schemaCommon.js';

// 专家模式且顶栏 TurboCore(CUDA) 关闭时才显示优化器后端 / Lulynx Triton。
// turbocore_enabled 由 optimizerToggle 同步进 config。
const expertAndNotTurboCore = (config) => (
  config.performance_expert_mode === true
  && !config.turbocore_enabled
);

const executionBackendIs = (value) => (config) => (
  String(config.execution_backend || 'optimized').trim().toLowerCase().replaceAll('-', '_') === value
);
const LEGACY_BACKEND_FIELD_HIDDEN = () => false;

// quant_train_mode 已从下拉(dequant/keep_w8)改为布尔开关(开=keep_w8)。
// 兼容老草稿里的字符串值,布尔 true 或 legacy 'keep_w8' 均视为开启。
const isKeepW8Mode = (value) => value === true
  || String(value ?? '').trim().toLowerCase() === 'keep_w8';

// value 必须与后端 core/contracts/execution_backend.py 的 EXECUTION_BACKENDS 逐字一致，
// 否则 executionBackendIs() 门控的 compile/thunder 子字段会永久隐藏。
export const EXECUTION_BACKEND_OPTIONS = [
  { value: 'optimized', label: '优化运行时（默认）' },
  { value: 'eager', label: 'eager（不做图编译）' },
  { value: 'thunder', label: 'Thunder（推荐的编译后端）' },
  { value: 'torch_compile', label: 'torch.compile' }
];
// torch.compile 子项：UI 用 dynamo_backend（后端 alias → torch_compile_backend），并补 mode。
const TORCH_COMPILE_MODE_OPTIONS = [
  { value: 'default', label: 'default（推荐）' },
  { value: 'reduce-overhead', label: 'reduce-overhead（降启动开销）' },
  { value: 'max-autotune', label: 'max-autotune（稳态最快，首次最慢）' }
];
const torchCompileExtras = () => [
  { key: 'dynamo_backend', type: 'select', label: 'torch.compile 后端', title: 'dynamo_backend', desc: '写入 torch_compile_backend 的 Dynamo 后端。建议保持 inductor 主力选择。', defaultValue: 'inductor', options: ['eager', 'aot_eager', 'inductor', 'cudagraphs'], visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_mode', type: 'select', label: 'torch.compile 模式', title: 'torch_compile_mode', desc: '传给 torch.compile(mode=)：default 均衡；reduce-overhead 降启动开销；max-autotune 稳态最快但首次最慢。建议 default。', defaultValue: 'default', options: TORCH_COMPILE_MODE_OPTIONS, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_dynamic', type: 'boolean', label: 'torch.compile dynamic', title: 'torch_compile_dynamic', desc: '允许动态 shape，牺牲部分优化换稳定。建议 true（更稳）。', defaultValue: false, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_fullgraph', type: 'boolean', label: 'torch.compile fullgraph', title: 'torch_compile_fullgraph', desc: '要求整图无 graph break，失败回退。建议 false 宽容处理。', defaultValue: false, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_scope', type: 'select', label: 'torch.compile 作用域', title: 'torch_compile_scope', desc: '编译作用域：空跟随 runtime；per_block 逐块；full 整图。建议留空。', defaultValue: '', options: [
    { value: '', label: '默认（跟随 runtime）' },
    { value: 'per_block', label: 'per_block' },
    { value: 'full', label: 'full' }
  ], visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_allow_full_with_per_block', type: 'boolean', label: '允许 full+per_block 混用', title: 'torch_compile_allow_full_with_per_block', desc: '高级：full 与 per_block 并存时不拦截。建议 false。', defaultValue: false, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'torch_compile_fallback_enabled', type: 'boolean', label: 'Compile 失败回退', title: 'torch_compile_fallback_enabled', desc: '开启时编译失败回退 eager 并打 warning 日志；关闭后编译失败将直接报错（fail-fast）而非静默回退。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') },
  // 幻影键（2026-08 第 3 站审计 C，跨桶 #5）：configs_training.py:406 声明后无训练期
  // 读者（唯一命中是 benchmark 脚本本地参数）。hidden 保旧草稿回显，提交层剥除。
  { key: 'torch_compile_first_step_timeout', type: 'hidden', defaultValue: 300 },
  { key: 'compile_probe_enabled', type: 'boolean', label: 'Compile Probe', title: 'compile_probe_enabled', desc: '编译前跑短 probe 验证收益，不达标回退。建议保持 true（默认）。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'compile_probe_steps', type: 'number', label: 'Probe 步数', title: 'compile_probe_steps', desc: 'probe 采样步数。推荐范围： 3（默认）。', defaultValue: 3, min: 1, step: 1, visibleWhen: all(executionBackendIs('torch_compile'), when('compile_probe_enabled', true)) },
  { key: 'compile_probe_max_vram_increase_ratio', type: 'number', label: 'Probe 显存涨幅上限', title: 'compile_probe_max_vram_increase_ratio', desc: 'probe 显存涨幅上限（相对基线），超了判失败。推荐范围： 0.15。', defaultValue: 0.15, min: 0, step: 0.01, visibleWhen: all(executionBackendIs('torch_compile'), when('compile_probe_enabled', true)) },
  { key: 'compile_probe_min_speedup_ratio', type: 'number', label: 'Probe 最低加速比', title: 'compile_probe_min_speedup_ratio', desc: '稳态加速低于该比例则回退。推荐范围： 0.03（3%）。', defaultValue: 0.03, min: 0, step: 0.01, visibleWhen: all(executionBackendIs('torch_compile'), when('compile_probe_enabled', true)) },
  { key: 'compile_contract_strict', type: 'boolean', label: 'Compile 严格契约', title: 'compile_contract_strict', desc: '训练前强制路由安全门。建议保持 true（默认）。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'compile_static_shape_drop_last', type: 'boolean', label: '静态 shape 丢弃尾批', title: 'compile_static_shape_drop_last', desc: '静态 shape 下丢弃不完整尾批保证定长。建议保持 true。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'compile_require_cache_first', type: 'boolean', label: '要求 cache-first', title: 'compile_require_cache_first', desc: '静态/full 编译要求 latent/文本已缓存。建议保持 true。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') }
];

export const S_EXECUTION_BACKEND = [
  { key: 'execution_backend', type: 'select', label: '训练执行后端', title: 'execution_backend', desc: '训练执行后端：optimized 免图编译最稳；thunder 为推荐编译后端；torch.compile 备选。建议 optimized 或 thunder。', defaultValue: 'optimized', options: EXECUTION_BACKEND_OPTIONS },
  { key: 'execution_backend_allow_fallback', type: 'boolean', label: '执行后端失败自动回退', title: 'execution_backend_allow_fallback', desc: 'Thunder/torch.compile 不可用或不安全时回退优化运行时。建议保持 true 保证可跑。', defaultValue: true, visibleWhen: oneOf('execution_backend', ['thunder', 'torch_compile']) },
  { key: 'compile_runtime', type: 'select', label: 'Compile 运行策略', title: 'compile_runtime', desc: 'torch.compile 运行策略（off 关闭等）。建议 off 起步，收益验证后再启用具体档。', defaultValue: 'off', options: COMPILE_RUNTIME_OPTIONS, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'compile_cache_enabled', type: 'boolean', label: 'Compile 缓存', title: 'compile_cache_enabled', desc: '跨 run 复用 torch.compile 编译结果。建议开启（默认 true）缩短二次启动。', defaultValue: true, visibleWhen: executionBackendIs('torch_compile') },
  { key: 'compile_cache_root', type: 'string', label: 'Compile 缓存目录', title: 'compile_cache_root', desc: '编译缓存根目录（相对输出或绝对路径）。建议指向快盘。', defaultValue: 'backend/cache/compile', visibleWhen: all(executionBackendIs('torch_compile'), when('compile_cache_enabled', true)) },
  { key: 'compile_cache_reuse', type: 'boolean', label: '复用 Compile 缓存', title: 'compile_cache_reuse', desc: '允许从磁盘复用已有编译缓存。建议保持 true。', defaultValue: true, visibleWhen: all(executionBackendIs('torch_compile'), when('compile_cache_enabled', true)) },
  // 幻影键（2026-08 第 3 站审计 C，跨桶 #5）：configs_performance.py:58 声明后全仓
  // 零读者。hidden 保旧草稿回显，提交层剥除。
  { key: 'compile_cache_prewarm', type: 'hidden', defaultValue: false },
  { key: 'thunder_jit_executors', type: 'select', label: 'Thunder 执行器', title: 'thunder_jit_executors', desc: 'Thunder 执行器组合：nvfuser+sdpa 是推荐组合；torchcompile executor 仅实验。建议唯一可选值即可。', defaultValue: 'nvfuser,sdpa', options: [
    { value: 'nvfuser,sdpa', label: 'nvfuser + sdpa' }
  ], visibleWhen: executionBackendIs('thunder') },
  { key: 'thunder_jit_cache_enabled', type: 'boolean', label: 'Thunder 编译缓存', title: 'thunder_jit_cache_enabled', desc: '按模型/dtype/rank/shape/执行器/RNG 契约隔离缓存。建议保持 true。', defaultValue: true, visibleWhen: executionBackendIs('thunder') },
  { key: 'thunder_jit_cache_root', type: 'string', label: 'Thunder 缓存目录', title: 'thunder_jit_cache_root', desc: 'Thunder 编译缓存根目录。建议指向快盘独立目录。', defaultValue: 'backend/cache/compile', visibleWhen: all(executionBackendIs('thunder'), when('thunder_jit_cache_enabled', true)) },
  { key: 'thunder_jit_warmup_enabled', type: 'boolean', label: 'Thunder 预编译', title: 'thunder_jit_warmup_enabled', desc: '训练前用代表 shape 预编译。建议首训开一次，命中缓存后可关。', defaultValue: false, visibleWhen: executionBackendIs('thunder') },
  { key: 'thunder_jit_progress_enabled', type: 'boolean', label: 'Thunder 编译进度', title: 'thunder_jit_progress_enabled', desc: '显示编译进度/缓存命中/局部回退状态。建议保持 true 便于观察。', defaultValue: true, visibleWhen: executionBackendIs('thunder') },
  { key: 'thunder_jit_enabled', type: 'boolean', label: '旧版 Thunder 开关', title: 'thunder_jit_enabled', desc: '仅保留旧配置迁移。', defaultValue: false, visibleWhen: LEGACY_BACKEND_FIELD_HIDDEN },
  { key: 'torch_compile', type: 'boolean', label: '旧版 torch.compile 开关', title: 'torch_compile', desc: '仅保留旧配置迁移。', defaultValue: false, visibleWhen: LEGACY_BACKEND_FIELD_HIDDEN },
  ...torchCompileExtras()
];

// --- compile expert knobs (peeled from S_DIT_PERFORMANCE_EXPERT; mount via compile-settings) ---
export const S_COMPILE_EXPERT = [
  { key: '__ui_group_compile_expert_collapsed', type: 'ui_group', label: '高级 Compile 策略已收起', desc: '高级 Compile 策略已收起', visibleWhen: when('performance_expert_mode', false) },
  { key: 'compile_shape_strategy', type: 'select', label: 'Compile Shape 策略', title: 'compile_shape_strategy', desc: 'compile 输入 shape 策略：auto 自动。建议 auto。', defaultValue: 'auto', options: COMPILE_SHAPE_STRATEGY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'compile_target_strategy', type: 'select', label: 'Compile Target 策略', title: 'compile_target_strategy', desc: '编译目标策略：auto 按模块能力探测。建议 auto。', defaultValue: 'auto', options: COMPILE_TARGET_STRATEGY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'compile_inductor_tuning', type: 'select', label: 'Inductor 融合调优', title: 'compile_inductor_tuning', desc: 'Inductor 融合调优档位：off 关；max_autotune 更快但首次很慢。建议 off。', defaultValue: 'off', options: ['off', 'epilogue', 'max_autotune', 'aggressive'], visibleWhen: all(when('performance_expert_mode', true), executionBackendIs('torch_compile')) },
  { key: 'compile_anima_full_core_enabled', type: 'boolean', label: 'Anima Full-Core Compile', title: 'compile_anima_full_core_enabled', desc: '把整个 Anima DiT 编译成单图（非逐块），编译久收益大。建议长训实验再开。', defaultValue: false, visibleWhen: all(when('performance_expert_mode', true), executionBackendIs('torch_compile')) }
];

// --- module offload single source (CORE/EXPERT + MEMORY shell for sequential/VAE) ---
export const S_MODULE_OFFLOAD_CORE = [
  // 后端 master 是 module_offload_enabled；子项必须挂在真父键上
  { key: 'module_offload_enabled', type: 'boolean', label: '模块级 Offload', desc: '模块级 Offload 总开关：按比例把冻结 Linear/Conv 常驻 CPU。建议显存不足且块交换不够用时开启。', defaultValue: false },
  { key: 'module_offload_ratio', type: 'number', label: '模块 Offload 比例', desc: '参与 offload 的可管理模块占比 0-100（不是目标显存占比）。推荐范围：30–70 试探。', defaultValue: 0, min: 0, max: 100, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_backbone_ratio', type: 'number', label: '主干覆盖比例', desc: '主干覆盖比例 0-100，留空继承总比例。推荐范围：留空。', defaultValue: '', min: 0, max: 100, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_text_encoder_ratio', type: 'number', label: '文本编码器覆盖比例', desc: 'TE 覆盖比例 0-100，留空继承总比例。推荐范围：留空。', defaultValue: '', min: 0, max: 100, visibleWhen: when('module_offload_enabled', true) }
];

export const S_MODULE_OFFLOAD_EXPERT = [
  ...S_MODULE_OFFLOAD_CORE,
  { key: 'module_offload_enhanced', type: 'boolean', label: '增强模块 Offload', desc: '增强调度版模块 offload。建议 balanced 档不够时再开。', defaultValue: false, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_profile', type: 'select', label: 'Module Offload 配置', desc: '预设档：balanced 平衡；aggressive 更省更慢；conservative 快但省得少；custom 手动。建议 balanced。', defaultValue: 'balanced', options: [
    { value: 'balanced', label: 'Balanced (平衡)' },
    { value: 'aggressive', label: 'Aggressive (激进省显存)' },
    { value: 'conservative', label: 'Conservative (保守快速)' },
    { value: 'custom', label: 'Custom (手动子项)' }
], visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_profile_enabled', type: 'boolean', label: '启用 Offload Profile', desc: '启用预设 offload 配置（否则手动子项）。建议保持 true 走预设。', defaultValue: true, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_min_param_mb', type: 'number', label: 'Offload 最小参数大小（MB）', desc: '只有参数大于此值的模块才 offload，避免小包传输开销。推荐范围： 10 MB（默认）。', defaultValue: 10, min: 1, step: 1, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_include_patterns', type: 'textarea', label: 'Offload 包含模式', desc: '只 offload 名称匹配这些模式（逗号分隔）的模块。建议精确定位大层时使用。', defaultValue: '', visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_exclude_patterns', type: 'textarea', label: 'Offload 排除模式', desc: '排除不参与 offload 的模块名模式。建议保护关键层时使用。', defaultValue: '', visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_prefetch_enabled', type: 'boolean', label: '启用 Offload 预取', desc: '提前预取下一个要用的模块减少等待。建议保持 true（默认）。', defaultValue: true, visibleWhen: when('module_offload_enabled', true) },
  { key: 'module_offload_prefetch_mode', type: 'select', label: 'Offload 预取模式', desc: '预取实现：experimental 是当前唯一支持模式。建议保持。', defaultValue: 'experimental', options: [
    { value: 'experimental', label: 'Experimental (实验性)' }
], visibleWhen: all(when('module_offload_enabled', true), when('module_offload_prefetch_enabled', true)) },
  { key: 'module_offload_verify_state', type: 'boolean', label: '验证 Offload 状态', desc: '每次传输后校验模块状态（明显降速）。建议仅排查数值问题时开。', defaultValue: false, visibleWhen: when('module_offload_enabled', true) }
];

// 极端内存模式：把冻结底座的权威副本放到磁盘 mmap，用 IO 换 RAM。
// 挂在 module_offload_enabled 下，因为落盘层就是搭在模块 offload 上的，
// 单开落盘而不开 module offload 没有任何东西可落。
export const S_EXTREME_MEMORY = [
  { key: 'tiered_residency_spill_enabled', type: 'boolean', label: '极端内存模式（磁盘换内存）', desc: '极端内存模式：冻结底座权威副本放磁盘换 RAM，实测 Anima 约 1.9 倍步时。建议仅在内存不足的机器上作兜底开启。', defaultValue: false, visibleWhen: when('module_offload_enabled', true) },
  { key: 'tiered_residency_spill_root', type: 'text', label: '落盘目录', desc: '落盘目录：强烈建议 NVMe SSD；机械盘/U 盘必负收益。留空用系统临时目录。', defaultValue: '', visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_allow_backbone', type: 'boolean', label: '允许底座落盘', desc: '允许 DiT 主干块真正落盘——省 RAM 大头。关闭时只落 VAE/TE 收效甚微。', defaultValue: false, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_active_eviction', type: 'boolean', label: '主动踢出内存页', desc: '权重拷入显存后立即归还内存页（防写页面文件、护 SSD 寿命的关键开关）。建议开启配套使用。', defaultValue: false, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_page_lookahead', type: 'number', label: '预读提前块数', desc: '提前几块预读内存页（缺页 4KB 同步很贵）。推荐范围：2（默认）～4。', defaultValue: 2, min: 0, max: 8, step: 1, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true), when('tiered_residency_spill_active_eviction', true)) },
  { key: 'tiered_residency_spill_allow_text_encoders', type: 'boolean', label: '允许文本编码器落盘', desc: '文本编码器也参与落盘（读得少代价低）。建议保持 true。', defaultValue: true, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_allow_vae', type: 'boolean', label: '允许 VAE 落盘', desc: 'VAE 参与落盘（只在编解码用到）。建议保持 true。', defaultValue: true, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_prefer_copy', type: 'boolean', label: '强制自写副本（慢盘模型）', desc: '慢盘模型+快盘落盘目录时开场复制到快盘（宁可写一次别每块都读慢盘）。建议该场景才开。', defaultValue: false, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_min_free_gb', type: 'number', label: '磁盘保留空间（GB）', desc: '磁盘至少保留空闲 GB，不足回落内存防写满。推荐范围： 4–16 视盘容量。', defaultValue: 4, min: 0, max: 512, step: 1, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) },
  { key: 'tiered_residency_spill_cleanup', type: 'boolean', label: '训练结束清理落盘文件', desc: '训练结束删除落盘文件（关掉会残留几 GB）。建议保持 true。', defaultValue: true, visibleWhen: all(when('module_offload_enabled', true), when('tiered_residency_spill_enabled', true)) }
];

export const S_MEMORY_OFFLOAD = [
  { key: 'enable_sequential_cpu_offload', type: 'boolean', label: '启用顺序 CPU Offload', desc: '把模型组件逐层顺序卸载到 CPU、用时加载。极省显存但显著变慢。建议仅在无法其他优化时兜底使用。', defaultValue: false },
  ...S_MODULE_OFFLOAD_EXPERT,
  ...S_EXTREME_MEMORY,
  { key: 'cpu_offload_checkpointing_mode', type: 'select', label: 'CPU Offload Checkpointing 模式', desc: '检查点与 CPU offload 的结合模式：auto 自动判定，full 完整卸载。建议 none 起步，OOM 时 auto。', defaultValue: 'none', options: [
    { value: 'none', label: 'None (不结合)' },
    { value: 'auto', label: 'Auto (自动)' },
    { value: 'full', label: 'Full (完整 offload)' }
] },
  { key: 'cpu_offload_checkpointing_pool_gb', type: 'number', label: 'CPU Offload Checkpointing 池大小（GB）', desc: 'CPU 端检查点内存池大小（GB）。推荐范围：4–16，按物理内存的 1/4 内设置。', defaultValue: 4, min: 1, max: 64, step: 1, visibleWhen: (c) => c.cpu_offload_checkpointing_mode && c.cpu_offload_checkpointing_mode !== 'none' },
  { key: 'vae_slicing', type: 'boolean', label: 'VAE 切片', desc: 'VAE 编码/解码用切片降低峰值显存。建议大分辨率且 VAE 阶段 OOM 时开启。', defaultValue: false },
  { key: 'vae_tiling', type: 'boolean', label: 'VAE 分块', desc: 'VAE 分块处理超大图像。建议分辨率超过 VAE 设计尺寸（如 SDXL>2048）时开启。', defaultValue: false }
];

// ================================================================
// 共享字段组 S_*
// ================================================================
export const S_LOSS_AWARE_LR = [
  { key: 'loss_scheduler_ema_alpha', type: 'number', label: 'Loss 平滑系数', title: 'loss_scheduler_ema_alpha', desc: 'Loss 门控调度：用 EMA 平滑原始 loss，避免单 batch 抖动误判相位。推荐范围：0.05–0.2（默认 0.1）。', defaultValue: 0.1, min: 0, max: 1, step: 0.01, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_min_delta', type: 'number', label: '有效下降阈值', title: 'loss_scheduler_min_delta', desc: 'EMA loss 至少下降多少才算「仍在变好」，推进余弦相位。推荐范围： 5e-4（默认）附近。', defaultValue: 0.0005, min: 0, step: 0.00001, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_relative_delta', type: 'number', label: '相对下降阈值', title: 'loss_scheduler_relative_delta', desc: '按最佳 EMA loss 的比例判定有效下降（0-1）。推荐范围： 0.001（默认）。', defaultValue: 0.001, min: 0, max: 1, step: 0.0001, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_patience', type: 'number', label: '平台期等待步数', title: 'loss_scheduler_patience', desc: '连续多少个 optimizer step 无有效下降才继续推进相位。推荐范围： 8（默认）。', defaultValue: 8, min: 1, step: 1, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_cooldown', type: 'number', label: '冷却步数', title: 'loss_scheduler_cooldown', desc: '有效下降后先忽略多少步平台期判断，减少来回抖动。推荐范围： 0–10。', defaultValue: 0, min: 0, step: 1, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_max_hold_steps', type: 'number', label: '最长锁定步数', title: 'loss_scheduler_max_hold_steps', desc: '连续不推进相位的最大步数上限，防永久卡死。推荐范围： 0 不设限或给总步数的 10%。', defaultValue: 0, min: 0, step: 1, visibleWhen: oneOf('lr_scheduler', ['loss_gated_cosine', 'loss_weighted_annealed_cosine']) },
  { key: 'loss_scheduler_late_gamma', type: 'number', label: '后期 Loss 权重曲线', title: 'loss_scheduler_late_gamma', desc: 'Loss 加权退火余弦的后期权重曲线指数。推荐范围： 2.0（默认）。', defaultValue: 2.0, min: 0.01, step: 0.1, visibleWhen: when('lr_scheduler', 'loss_weighted_annealed_cosine') },
  { key: 'loss_scheduler_lock_weight_threshold', type: 'number', label: '锁定权重阈值', title: 'loss_scheduler_lock_weight_threshold', desc: 'Loss 加权退火余弦的锁定权重阈值。推荐范围： 0.7（默认）。', defaultValue: 0.7, min: 0, max: 1, step: 0.05, visibleWhen: when('lr_scheduler', 'loss_weighted_annealed_cosine') },
  { key: 'loss_scheduler_min_advance_ratio', type: 'number', label: '最小推进速度', title: 'loss_scheduler_min_advance_ratio', desc: '最小相位推进速度比例（防长期停滞）。推荐范围： 0.25（默认）。', defaultValue: 0.25, min: 0, max: 1, step: 0.05, visibleWhen: when('lr_scheduler', 'loss_weighted_annealed_cosine') }
];

export const S_DIT_PERFORMANCE_EXPERT = [
  { key: 'performance_expert_mode', type: 'boolean', label: '性能专家模式', title: 'performance_expert_mode', desc: '展开高级性能选项（编译加速、Triton 优化器、交换策略等）。建议新手关闭；调优显存/速度时再开。', defaultValue: false },
  { key: 'acceleration_profile', type: 'select', label: '模型加速档位', title: 'acceleration_profile', desc: '按当前模型族做加速预检与档位建议', defaultValue: 'off', options: ACCELERATION_PROFILE_OPTIONS },
  { key: 'experimental_attention_profile_enabled', type: 'boolean', label: 'Sliding Window Attention', title: 'experimental_attention_profile_enabled', desc: '窗口注意力。auto 会优先尊重启动器/预检解析后的 attention', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'experimental_attention_profile_window', type: 'number', label: '窗口大小', title: 'experimental_attention_profile_window', desc: '窗口注意力的每 token 历史窗口长度（token 数非步数）；0 表示完整注意力。推荐范围： 50–100 起步。', defaultValue: 100, min: 10, visibleWhen: all(when('performance_expert_mode', true), when('experimental_attention_profile_enabled', true)) },
  { key: 'experimental_attention_profile_backend', type: 'select', label: '窗口注意力后端', title: 'experimental_attention_profile_backend', desc: 'auto 优先使用启动器/预检传入的 attention 参数', defaultValue: 'auto', options: WINDOW_ATTENTION_BACKEND_OPTIONS, visibleWhen: all(when('performance_expert_mode', true), when('experimental_attention_profile_enabled', true)) },
  { key: 'experimental_attention_profile_torch_max_tokens', type: 'number', label: 'Torch 回退最大 Token', title: 'experimental_attention_profile_torch_max_tokens', desc: '纯 PyTorch O(n²) 回退路径的序列上限，防止长序列误跑爆显存。推荐范围： 2048（默认）。', defaultValue: 2048, min: 128, visibleWhen: all(when('performance_expert_mode', true), when('experimental_attention_profile_enabled', true), when('experimental_attention_profile_backend', 'torch_fallback')) },
  { key: 'data_transfer_profile_enabled', type: 'boolean', label: '数据传输 Profiling', title: 'data_transfer_profile_enabled', desc: '采样 CPU/GPU tensor 传输耗时（诊断）。建议性能分析期开启。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'data_transfer_profile_mode', type: 'select', label: '传输计时模式', title: 'data_transfer_profile_mode', desc: '传输计时模式：event 用 CUDA events 低同步开销。建议 event。', defaultValue: 'event', options: DATA_TRANSFER_PROFILE_MODE_OPTIONS, visibleWhen: all(when('performance_expert_mode', true), when('data_transfer_profile_enabled', true)) },
  { key: 'data_transfer_profile_window', type: 'number', label: '传输采样窗口', title: 'data_transfer_profile_window', desc: '每累计多少次传输输出一次汇总。推荐范围： 50（默认）。', defaultValue: 50, min: 1, visibleWhen: all(when('performance_expert_mode', true), when('data_transfer_profile_enabled', true)) },
  { key: 'loss_precision', type: 'select', label: 'Loss 精度策略', title: 'loss_precision', desc: 'Loss 计算精度策略：fp32_loss 当前稳定路径。建议 fp32_loss 保持。', defaultValue: 'fp32_loss', options: LOSS_PRECISION_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'cached_collate_mode', type: 'select', label: '缓存数据 Collate', title: 'cached_collate_mode', desc: '缓存数据 Collate 模式（仅影响 Anima/Newbie cache-first 数据集）：auto 自动选择。建议 auto。', defaultValue: 'auto', options: CACHED_COLLATE_MODE_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'data_backend', type: 'select', label: '数据后端', title: 'data_backend', desc: '数据后端：auto/caption 当前都走 CaptionDataset 实现。建议 auto 保持跟随。', defaultValue: 'auto', options: DATA_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'prefetch_factor', type: 'number', label: 'DataLoader 预取批次', title: 'prefetch_factor', desc: '每个 worker 预取的 batch 数。推荐范围：2（默认）即可，IO 慢可升到 4。', defaultValue: 2, min: 1, max: 8, step: 1, visibleWhen: when('performance_expert_mode', true) },
  { key: 'checkpoint_policy', type: 'select', label: 'Checkpoint 策略', title: 'checkpoint_policy', desc: '梯度检查点策略：auto 自动权衡 / full 全量 / offloaded 卸载版 / selective 选择性。建议 auto。', defaultValue: 'auto', options: CHECKPOINT_POLICY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'stochastic_depth_enabled', type: 'boolean', label: '随机深度训练', title: 'stochastic_depth_enabled', desc: '随机深度训练：随机跳过部分 DiT block 提速并正则化。建议速度实验开启观察收敛。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'stochastic_depth_survival_prob', type: 'number', label: '随机深度保留概率', title: 'stochastic_depth_survival_prob', desc: '每层被保留的概率。推荐范围：0.8（默认）；过低伤收敛。', defaultValue: 0.8, min: 0.5, max: 1.0, step: 0.05, visibleWhen: all(when('performance_expert_mode', true), when('stochastic_depth_enabled', true)) },
  { key: 'stochastic_depth_decay', type: 'boolean', label: '随机深度随层衰减', title: 'stochastic_depth_decay', desc: '开启后深层 block 更容易被跳过；关闭则各层用同一保留概率。', defaultValue: true, visibleWhen: all(when('performance_expert_mode', true), when('stochastic_depth_enabled', true)) },
  { key: 'stochastic_depth_min_blocks_kept', type: 'number', label: '最少保留 Block 数', title: 'stochastic_depth_min_blocks_kept', desc: '始终保留前 N 个 block 防网络过浅。推荐范围： 4（默认）。', defaultValue: 4, min: 0, step: 1, visibleWhen: all(when('performance_expert_mode', true), when('stochastic_depth_enabled', true)) }
];

// ── Gradient Release / Optimizer State Paging（显存卫生）──────────────────────
export const S_GRADIENT_RELEASE = [
  { key: 'gradient_release_enabled', type: 'boolean', label: '梯度释放', title: 'gradient_release_enabled', desc: '按参数即时释放梯度降低梯度峰值显存（默认 true）。建议保持开启；个别优化器不兼容会自动回退。', defaultValue: true },
  { key: 'gradient_release_mode', type: 'select', label: '梯度释放模式', title: 'gradient_release_mode', desc: '梯度释放模式：compatible 为当前唯一档位。建议保持 compatible。', defaultValue: 'compatible', options: [
    { value: 'compatible', label: 'compatible' }
  ], visibleWhen: when('gradient_release_enabled', true) },
  { key: 'gradient_release_grad_clip_mode', type: 'select', label: '梯度裁剪模式', title: 'gradient_release_grad_clip_mode', desc: '裁剪档位：exact 精确全局范数（默认，gas=1 约 +183MB）；per_param 近似省显存；report_only 只报告。建议 exact。', defaultValue: 'exact', options: [
    { value: 'exact', label: 'exact（精确，默认）' },
    { value: 'per_param', label: 'per_param（省显存，近似）' },
    { value: 'report_only', label: 'report_only（仅报告）' }
  ], visibleWhen: when('gradient_release_enabled', true) },
  { key: 'gradient_release_downgrade_reason', type: 'string', label: '梯度释放降级原因', title: 'gradient_release_downgrade_reason', desc: '只读：后端自动降级时写入原因（通常为空）。', defaultValue: '', visibleWhen: when('gradient_release_enabled', true) }
];

export const S_OPTIMIZER_STATE_PAGING = [
  { key: 'optimizer_state_paging_enabled', type: 'boolean', label: '优化器状态分页', title: 'optimizer_state_paging_enabled', desc: '大优化器状态张量在 step 间停泊到 CPU。建议 AdamW 大 rank 且显存紧时开启。', defaultValue: false },
  { key: 'optimizer_state_paging_min_tensor_mb', type: 'number', label: '分页最小张量 (MB)', title: 'optimizer_state_paging_min_tensor_mb', desc: '仅分页大于该体积的状态张量。推荐范围：1 MB（默认）以上。', defaultValue: 1.0, min: 0, step: 0.5, visibleWhen: when('optimizer_state_paging_enabled', true) },
  { key: 'optimizer_state_paging_storage_device', type: 'select', label: '状态驻留设备', title: 'optimizer_state_paging_storage_device', desc: '状态驻留设备：cpu 在 step 间释放显存；param 跟随参数设备。建议 cpu。', defaultValue: 'cpu', options: [{ value: 'cpu', label: 'CPU' }, { value: 'param_device', label: '参数设备' }], visibleWhen: when('optimizer_state_paging_enabled', true) },
  { key: 'optimizer_state_paging_storage_dtype', type: 'select', label: '状态驻留精度', title: 'optimizer_state_paging_storage_dtype', desc: 'CPU 驻留副本精度：preserve 原样；bf16/fp8 压缩体积。step 前恢复计算精度。建议 preserve 保稳。', defaultValue: 'preserve', options: [{ value: 'preserve', label: '保持原精度' }, { value: 'bf16', label: 'BF16' }, { value: 'fp16', label: 'FP16' }, { value: 'fp32', label: 'FP32' }], visibleWhen: when('optimizer_state_paging_enabled', true) },
  { key: 'optimizer_state_paging_pin_memory', type: 'boolean', label: '分页 pin_memory', title: 'optimizer_state_paging_pin_memory', desc: '持久 pinned 镜像 + 独立拷贝流加速分页。建议内存充足时开启。', defaultValue: false, visibleWhen: when('optimizer_state_paging_enabled', true) }
];

// AutoProdigy 子项：optimizer_type 选 AutoProdigy 时显示
const autoProdigySelected = (cfg) => {
  const key = String(cfg.optimizer_type || '').trim().toLowerCase();
  return key === 'autoprodigy' || key === 'auto_prodigy';
};
export const S_AUTO_PRODIGY = [
  { key: 'auto_prodigy_profile', type: 'select', label: 'AutoProdigy 档位', title: 'auto_prodigy_profile', desc: 'AutoProdigy 档位：safe 小数据集保守；balanced 默认；aggressive 激进。建议 balanced，不稳退 safe。', defaultValue: 'balanced', options: [
    { value: 'safe', label: 'safe' },
    { value: 'balanced', label: 'balanced' },
    { value: 'aggressive', label: 'aggressive' },
    { value: 'custom', label: 'custom' }
  ], visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_d0', type: 'number', label: 'AutoProdigy d0', title: 'auto_prodigy_d0', desc: 'AutoProdigy 初始步长估计。推荐范围：1e-6（默认）。', defaultValue: 1e-6, min: 0, step: 1e-7, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_d_coef', type: 'number', label: 'AutoProdigy d_coef', title: 'auto_prodigy_d_coef', desc: 'AutoProdigy 步长系数。推荐范围：保持 1.0。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_growth_rate', type: 'number', label: 'AutoProdigy growth_rate', title: 'auto_prodigy_growth_rate', desc: 'AutoProdigy 步长增长上限倍率。推荐范围：保持 1.02。', defaultValue: 1.02, min: 1, step: 0.01, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_max_update_rms_ratio', type: 'number', label: 'AutoProdigy max update RMS', title: 'auto_prodigy_max_update_rms_ratio', desc: '更新 RMS 相对权重 RMS 的上限比例。推荐范围：保持 0.01。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_damping', type: 'number', label: 'AutoProdigy damping', title: 'auto_prodigy_damping', desc: 'AutoProdigy 阻尼系数。推荐范围：保持 1.0。', defaultValue: 1.0, min: 0, step: 0.1, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_beta3', type: 'number', label: 'AutoProdigy beta3', title: 'auto_prodigy_beta3', desc: 'AutoProdigy 第三动量。推荐范围：保持 0.99。', defaultValue: 0.99, min: 0, max: 0.9999, step: 0.01, visibleWhen: autoProdigySelected },
  { key: 'auto_prodigy_safeguard_warmup', type: 'boolean', label: 'AutoProdigy 预热保护', title: 'auto_prodigy_safeguard_warmup', desc: '预热阶段保护自适应步长不被放大。建议保持开启。', defaultValue: true, visibleWhen: autoProdigySelected }
];

export const ANIMA_BLOCK_RESIDENCY_FIELDS = [
  { key: 'lora_activation_recompute_mode', type: 'select', label: 'LoRA 分支重算', title: 'lora_activation_recompute_mode', desc: '原生 DiT LoRA 反传激活重算档位：auto 自动选择。建议 auto。', defaultValue: 'auto', options: LORA_RECOMPUTE_OPTIONS },
  { key: 'anima_block_residency', type: 'select', label: 'Anima Block Offload', title: 'anima_block_residency', desc: '冻结 DiT 权重放 CPU 内存降低显存；resident 优先速度。', defaultValue: 'resident', options: DIT_BLOCK_RESIDENCY_OPTIONS },
  { key: 'anima_block_residency_min_params', type: 'number', label: 'Anima Offload 最小参数量', title: 'anima_block_residency_min_params', desc: 'Anima 只托管达到该参数量的冻结 Linear，0 不过滤。推荐范围： 0。', defaultValue: 0, min: 0, visibleWhen: nonResidentBlockMode('anima_block_residency') },
  // 这里不能挂 requiresAttentionBackend:'flash2'：该门闸读的是
  // attention_backend / attn_mode / anima_attn_mode，而唯二暴露本字段的
  // anima-lora / anima-edit-model 的 schema 里这三个键一个都没有 → 门闸恒不开，
  // 开关永远渲染不出来，收集阶段又按"不可见"丢弃，等于这个后端能力在 UI 上不存在。
  // flash2 约束不靠隐藏开关来保证，而是三层各司其职：
  //   runConfigBuilder.normalizeAnimaVramOptimizer 对显式不兼容 backend 安全降级；
  //   config_adapter_main_runtime_fields.normalize_runtime_fields 做同样判定；
  //   anima_dit_runtime_guardrails 用运行时真正解析出的 backend 做最终裁决。
  { key: 'anima_vram_optimizer', type: 'boolean', label: '显存优化器', title: 'anima_vram_optimizer', desc: 'Anima packed/varlen 显存优化意图。仅在 FlashAttention 2 后端下真正生效；开启后会请求 packed varlen attention 并自动采用最省显存的 checkpointing，运行时若解析出的 attention 后端不是 FlashAttention 2 会自动降级并在日志说明。', defaultValue: false },
  { key: 'anima_block_checkpointing', type: 'boolean', label: 'Anima 梯度检查点（分块重算）', title: 'anima_block_checkpointing', desc: 'Anima 梯度检查点主力：反传时按 DiT block 重算激活，比通用梯度检查点更省显存。建议显存不足优先开这个而不是通用项。', defaultValue: false },
  { key: 'anima_block_checkpointing_mode', type: 'select', label: 'Checkpointing 模式', title: 'anima_block_checkpointing_mode', desc: 'block 整块重算，Anima 上实测更快也更省显存，建议保持。selective 只重算逐元素算子、保留 matmul/SDPA，理论重算更少，但 Anima 实测并不占优（略慢且显存更高），一般不必改。', defaultValue: 'block', options: ['block', 'selective'], visibleWhen: when('anima_block_checkpointing', true) },
  { key: 'anima_block_checkpointing_interval', type: 'number', label: '检查点密度', title: 'anima_block_checkpointing_interval', desc: '每隔几个 DiT block 设一个检查点：1 最省显存（每块都重算）；2 显存翻倍换约 13% 提速。推荐范围：16G 以下 1；16G+ 可试 2。', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: when('anima_block_checkpointing', true) },
  { key: 'anima_block_prefetch', type: 'boolean', label: 'Anima Block 预取', title: 'anima_block_prefetch', desc: 'Anima Block 预取：异步预载后续 block 掩盖换入延迟。建议开了 offload 后配套开启。', defaultValue: false, visibleWhen: nonResidentBlockMode('anima_block_residency') },
  { key: 'anima_block_prefetch_depth', type: 'number', label: 'Anima 预取深度', title: 'anima_block_prefetch_depth', desc: '向前预取的 block 数。推荐范围：1–2；过大占显存。', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: all(nonResidentBlockMode('anima_block_residency'), when('anima_block_prefetch', true)) },
  { key: 'anima_block_prefetch_mode', type: 'select', label: 'Anima 预取模式', title: 'anima_block_prefetch_mode', desc: '预取模式：original 固定深度（默认）；adaptive 自适应。建议 original 起步。', defaultValue: 'original', options: [
    { value: 'original', label: 'original（固定深度）' },
    { value: 'adaptive', label: 'adaptive（自适应）' }
  ], visibleWhen: all(nonResidentBlockMode('anima_block_residency'), when('anima_block_prefetch', true)) },
  { key: 'anima_block_offload_enabled', type: 'boolean', label: 'Anima Block LRU Offload', title: 'anima_block_offload_enabled', desc: 'Anima Block LRU Offload：GPU 上保留 N 个槽位滚动换入换出冻结块。建议显存不足且不想重算时用（与检查点互补）。', defaultValue: false, visibleWhen: nonResidentBlockMode('anima_block_residency') },
  { key: 'anima_block_offload_gpu_slots', type: 'number', label: 'LRU GPU 槽位数', title: 'anima_block_offload_gpu_slots', desc: '同时保留在 GPU 的 block 数（当前+前后窗口）。推荐范围：3（默认）起，每减 1 槽省一块显存。', defaultValue: 3, min: 1, max: 16, step: 1, visibleWhen: all(nonResidentBlockMode('anima_block_residency'), when('anima_block_offload_enabled', true)) },
  { key: 'anima_block_offload_prefetch_depth', type: 'number', label: 'LRU 预取深度', title: 'anima_block_offload_prefetch_depth', desc: '前向/反向各异步预取 N 个 block。推荐范围：1（默认）。', defaultValue: 1, min: 0, max: 8, step: 1, visibleWhen: all(nonResidentBlockMode('anima_block_residency'), when('anima_block_offload_enabled', true)) },
  { ...PCIE_TRANSFER_FORMAT_FIELD, visibleWhen: nonResidentBlockMode('anima_block_residency') },
  ...vortexRuntimeFields('anima_block_residency'),
  pcieDeltaCacheField('anima_block_residency'),
  ...pcieDeltaCacheModeFields('anima_block_residency'),
  { key: 'activation_compression_enabled', type: 'boolean', label: '激活压缩', title: 'activation_compression_enabled', desc: '压缩激活张量降低反传显存（fp16/bf16 无损级，fp8 有损）。建议显存临界时先开 bf16 档。', defaultValue: false },
  { key: 'activation_compression_dtype', type: 'select', label: '激活压缩精度', title: 'activation_compression_dtype', desc: '激活压缩精度：fp16/bf16 较稳；fp8_e4m3 显存减半但有损。建议 bf16 起步。', defaultValue: 'fp16', options: ['fp16', 'bf16', 'fp8_e4m3'], visibleWhen: when('activation_compression_enabled', true) },
  { key: 'activation_compression_min_tensor_mb', type: 'number', label: '激活压缩最小体积 MB', title: 'activation_compression_min_tensor_mb', desc: '只压缩达到该体积（MB）的激活张量，小张量不值得压。推荐范围：1（默认）。', defaultValue: 1.0, min: 0, step: 0.5, visibleWhen: when('activation_compression_enabled', true) },
  { key: 'activation_cpu_offload_enabled', type: 'boolean', label: '激活 CPU Offload', title: 'activation_cpu_offload_enabled', desc: '把大激活搬到 CPU 内存降显存，可与分块检查点组合。建议显存仍不够时的下一档手段。', defaultValue: false },
  { key: 'activation_cpu_offload_min_tensor_mb', type: 'number', label: 'Offload 最小体积 MB', title: 'activation_cpu_offload_min_tensor_mb', desc: '只卸载达到该体积的激活张量。推荐范围：1 MB（默认）以上。', defaultValue: 1.0, min: 0, step: 0.5, visibleWhen: when('activation_cpu_offload_enabled', true) },
  { key: 'activation_cpu_offload_pool_gb', type: 'number', label: 'Offload Pinned 池 GB', title: 'activation_cpu_offload_pool_gb', desc: 'CPU pinned 内存池大小（GB），池内传输走 DMA 更快。推荐范围：1–8。', defaultValue: 1.0, min: 0.1, step: 0.1, visibleWhen: when('activation_cpu_offload_enabled', true) },
  // Progressive full finetune / rematerializable（Anima 专家；default-off）
  { key: 'anima_progressive_full_finetune_enabled', type: 'boolean', label: '渐进式全参解冻', title: 'anima_progressive_full_finetune_enabled', desc: '按 schedule 逐块解冻 DiT 做 full 微调（显存随解冻增长）。建议显存充裕且 LoRA 达瓶颈时再用。', defaultValue: false },
  { key: 'anima_progressive_full_finetune_schedule', type: 'string', label: '渐进解冻 schedule', title: 'anima_progressive_full_finetune_schedule', desc: '例：0:24-27,100:16-27,200:all', defaultValue: '', visibleWhen: when('anima_progressive_full_finetune_enabled', true) },
  { key: 'anima_progressive_full_finetune_default', type: 'string', label: '渐进解冻默认范围', title: 'anima_progressive_full_finetune_default', desc: 'schedule 未命中时的默认 block 范围，如 all。', defaultValue: 'all', visibleWhen: when('anima_progressive_full_finetune_enabled', true) },
  { key: 'anima_rematerializable_block_enabled', type: 'boolean', label: '可重物化 Block', title: 'anima_rematerializable_block_enabled', desc: '可重物化 block 原型（profile-only）。建议仅诊断分析用，不影响常规训练。', defaultValue: false },
  { key: 'anima_rematerializable_block_mode', type: 'select', label: '可重物化模式', title: 'anima_rematerializable_block_mode', desc: '可重物化模式，当前仅 profile_only。建议保持。', defaultValue: 'profile_only', options: [{ value: 'profile_only', label: 'profile_only' }], visibleWhen: when('anima_rematerializable_block_enabled', true) }
];

// Krea-2 block/layer offload 全套（仅 krea2-lora 挂载）
export const KREA2_OFFLOAD_FIELDS = [
  { key: 'krea2_block_residency', type: 'select', label: 'Krea2 Block 驻留', title: 'krea2_block_residency', desc: 'Krea2 Block 驻留', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident（全驻留 GPU）' },
    { value: 'block_offload', label: 'block_offload（自适应卸载）' },
    // 下方 krea2_layer_offload_* 全组以此值为可见性锚点；缺了它那组字段永久隐藏。
    { value: 'layer_offload', label: 'layer_offload（逐层卸载）' }
  ]},
  { key: 'krea2_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'krea2_block_offload_min_param_mb', desc: '小于该体积的 block 不 offload。', defaultValue: 100.0, min: 0, step: 1, visibleWhen: when('krea2_block_residency', 'block_offload') },
  { key: 'krea2_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'krea2_block_offload_gpu_slots', desc: '同时保留在 GPU 的 block 数。', defaultValue: 4, min: 1, max: 32, step: 1, visibleWhen: when('krea2_block_residency', 'block_offload') },
  { key: 'krea2_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'krea2_block_offload_prefetch_depth', desc: '异步预取后续 block 数', defaultValue: 2, min: 0, max: 8, step: 1, visibleWhen: when('krea2_block_residency', 'block_offload') },
  { key: 'krea2_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'krea2_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓冲，加速 H2D。', defaultValue: true, visibleWhen: when('krea2_block_residency', 'block_offload') },
  { key: 'krea2_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'krea2_block_offload_ratio', desc: '参与 block offload 的比例（0–100）。100 表示尽可能多 block 走 offload。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('krea2_block_residency', 'block_offload') },
  { key: 'krea2_resident_block_count', type: 'number', label: '常驻 Block 数', title: 'krea2_resident_block_count', desc: '始终留在 GPU 的 block 数；0=按策略自动。', defaultValue: 0, min: 0, step: 1, visibleWhen: (c) => c.krea2_block_residency !== 'resident' },
  { key: 'krea2_layer_offload_ratio', type: 'number', label: 'Layer Offload 比例 %', title: 'krea2_layer_offload_ratio', desc: '参与 layer offload 的比例。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_min_param_mb', type: 'number', label: 'Layer Offload 最小参数 MB', title: 'krea2_layer_offload_min_param_mb', desc: '小于该体积不 offload', defaultValue: 0.0, min: 0, step: 0.5, visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_prefetch_depth', type: 'number', label: 'Layer Offload 预取深度', title: 'krea2_layer_offload_prefetch_depth', desc: 'layer 路径预取深度', defaultValue: 1, min: 0, max: 8, step: 1, visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_pin_memory', type: 'boolean', label: 'Layer Offload Pin Memory', title: 'krea2_layer_offload_pin_memory', desc: 'layer 路径是否 pin CPU 缓冲。', defaultValue: false, visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_resident_ratio', type: 'number', label: 'Layer 常驻比例 %', title: 'krea2_layer_offload_resident_ratio', desc: '始终驻留 GPU 的层比例', defaultValue: 0, min: 0, max: 100, step: 1, visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_include_patterns', type: 'string', label: 'Layer Offload 包含模式', title: 'krea2_layer_offload_include_patterns', desc: '逗号分隔模块名模式，默认 blocks.*。', defaultValue: 'blocks.*', visibleWhen: when('krea2_block_residency', 'layer_offload') },
  { key: 'krea2_layer_offload_exclude_patterns', type: 'string', label: 'Layer Offload 排除模式', title: 'krea2_layer_offload_exclude_patterns', desc: '逗号分隔排除模式', defaultValue: '', visibleWhen: when('krea2_block_residency', 'layer_offload') }
];

// FLUX.2 Klein block offload（仅 flux2-lora；无 layer_offload / vram_preset）
// 默认 slots=4 / prefetch=3 / pin=true（16G@1024 真机验证）；低显存可降 slots。
export const FLUX2_OFFLOAD_FIELDS = [
  { key: 'flux2_block_residency', type: 'select', label: 'FLUX.2 Block 驻留', title: 'flux2_block_residency', desc: 'FLUX.2 Block 驻留', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident（全驻留 GPU）' },
    { value: 'block_offload', label: 'block_offload（自适应卸载）' }
  ]},
  { key: 'flux2_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'flux2_block_offload_min_param_mb', desc: '小于该体积的 block 不 offload。', defaultValue: 50.0, min: 0, step: 1, visibleWhen: when('flux2_block_residency', 'block_offload') },
  { key: 'flux2_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'flux2_block_offload_gpu_slots', desc: '同时保留在 GPU 的 block 数。', defaultValue: 4, min: 1, max: 32, step: 1, visibleWhen: when('flux2_block_residency', 'block_offload') },
  { key: 'flux2_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'flux2_block_offload_prefetch_depth', desc: '异步预取后续 block 数。默认 3（与 slots=4 配对）。', defaultValue: 3, min: 0, max: 8, step: 1, visibleWhen: when('flux2_block_residency', 'block_offload') },
  { key: 'flux2_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'flux2_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓冲，加速 H2D', defaultValue: true, visibleWhen: when('flux2_block_residency', 'block_offload') },
  { key: 'flux2_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'flux2_block_offload_ratio', desc: '参与 block offload 的比例（0–100）。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('flux2_block_residency', 'block_offload') }
];

// Boogu-Image block offload（默认 resident / Layer Offload OFF，对齐 RunComfy）
// Z-Image block offload (default block_offload for large DiT)
export const ZIMAGE_OFFLOAD_FIELDS = [
  { key: 'zimage_block_residency', type: 'select', label: 'Z-Image Block 驻留', title: 'zimage_block_residency', desc: 'Z-Image Block 驻留', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident（全驻留 GPU）' },
    { value: 'block_offload', label: 'block_offload（自适应卸载）' }
  ]},
  { key: 'zimage_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'zimage_block_offload_min_param_mb', desc: '小于该参数量 block 不 offload。', defaultValue: 50.0, min: 0, step: 1, visibleWhen: when('zimage_block_residency', 'block_offload') },
  { key: 'zimage_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'zimage_block_offload_gpu_slots', desc: '同时驻留在 GPU 的 block 数。', defaultValue: 4, min: 1, max: 32, step: 1, visibleWhen: when('zimage_block_residency', 'block_offload') },
  { key: 'zimage_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'zimage_block_offload_prefetch_depth', desc: '异步预取后续 block 数', defaultValue: 2, min: 0, max: 8, step: 1, visibleWhen: when('zimage_block_residency', 'block_offload') },
  { key: 'zimage_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'zimage_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓存，加速 H2D。', defaultValue: true, visibleWhen: when('zimage_block_residency', 'block_offload') },
  { key: 'zimage_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'zimage_block_offload_ratio', desc: '参与 block offload 的比例（0–100）。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('zimage_block_residency', 'block_offload') }
];

export const WAN22_OFFLOAD_FIELDS = [
  { key: 'wan22_block_residency', type: 'select', label: 'Wan2.2 Block 驻留', title: 'wan22_block_residency', desc: 'Wan2.2 Block 驻留', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident' },
    { value: 'block_offload', label: 'block_offload' }
  ]},
  { key: 'wan22_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'wan22_block_offload_ratio', desc: '参与 offload 的 block 比例（0-100）。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('wan22_block_residency', 'block_offload') },
  { key: 'wan22_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'wan22_block_offload_min_param_mb', desc: '小于该参数量 block 不 offload。', defaultValue: 50.0, min: 0, step: 1, visibleWhen: when('wan22_block_residency', 'block_offload') },
  { key: 'wan22_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'wan22_block_offload_gpu_slots', desc: '同时驻留在 GPU 的 block 数。', defaultValue: 4, min: 1, max: 32, step: 1, visibleWhen: when('wan22_block_residency', 'block_offload') },
  { key: 'wan22_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'wan22_block_offload_prefetch_depth', desc: '异步预取后续 block 数量', defaultValue: 2, min: 0, max: 8, step: 1, visibleWhen: when('wan22_block_residency', 'block_offload') },
  { key: 'wan22_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'wan22_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓存，加速 H2D。', defaultValue: true, visibleWhen: when('wan22_block_residency', 'block_offload') }
];

export const LTX23_OFFLOAD_FIELDS = [
  { key: 'ltx23_block_residency', type: 'select', label: 'LTX-2.3 Block 驻留', title: 'ltx23_block_residency', desc: '22B 建议 block_offload', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident' },
    { value: 'block_offload', label: 'block_offload' }
  ]},
  { key: 'ltx23_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'ltx23_block_offload_ratio', desc: '参与 offload 的 block 比例（0-100%）。推荐范围：100 全部托管或 0 关闭，部分值意义有限。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('ltx23_block_residency', 'block_offload') },
  { key: 'ltx23_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'ltx23_block_offload_min_param_mb', desc: '小于该参数量（MB）的 block 不 offload，避免小包传输开销。推荐范围：50。', defaultValue: 50.0, min: 0, step: 1, visibleWhen: when('ltx23_block_residency', 'block_offload') },
  { key: 'ltx23_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'ltx23_block_offload_gpu_slots', desc: 'GPU 上保留的槽位数，显存越紧给越小。推荐范围：22B 建议 2；显存富余可加到 3–4。', defaultValue: 2, min: 1, max: 32, step: 1, visibleWhen: when('ltx23_block_residency', 'block_offload') },
  { key: 'ltx23_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'ltx23_block_offload_prefetch_depth', desc: '异步预取后续 block 数量。推荐范围：1（默认）。', defaultValue: 1, min: 0, max: 8, step: 1, visibleWhen: when('ltx23_block_residency', 'block_offload') },
  { key: 'ltx23_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'ltx23_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓存加速 H2D 拷贝。建议内存充足保持 true。', defaultValue: true, visibleWhen: when('ltx23_block_residency', 'block_offload') }
];

export const BOOGU_OFFLOAD_FIELDS = [
  // E1（2026-08 第 6 站桶）：默认对齐后端 configs_boogu.py:35 的 block_offload
  // （源码注释：streaming is the honest default——19GiB 常驻 16GB 卡 ≈430s/步 vs
  // 流式 175s）。前端原默认 resident 恒提交，把后端的保守默认顶掉了。
  { key: 'boogu_block_residency', type: 'select', label: 'Boogu Block 驻留', title: 'boogu_block_residency', desc: '默认 block_offload（流式）；显存充裕可切 resident。', defaultValue: 'block_offload', options: [
    { value: 'resident', label: 'resident（全驻留 GPU）' },
    { value: 'block_offload', label: 'block_offload（流式卸载，默认）' }
  ] },
  { key: 'boogu_block_offload_ratio', type: 'number', label: 'Block Offload 比例 %', title: 'boogu_block_offload_ratio', desc: '参与 offload 的 block 比例（0-100）。', defaultValue: 100, min: 0, max: 100, step: 1, visibleWhen: when('boogu_block_residency', 'block_offload') },
  { key: 'boogu_block_offload_min_param_mb', type: 'number', label: 'Block Offload 最小参数 MB', title: 'boogu_block_offload_min_param_mb', desc: '小于该体积的 block 不 offload。', defaultValue: 50.0, min: 0, step: 1, visibleWhen: when('boogu_block_residency', 'block_offload') },
  { key: 'boogu_block_offload_gpu_slots', type: 'number', label: 'Block Offload GPU 槽位', title: 'boogu_block_offload_gpu_slots', desc: '同时保留在 GPU 的 block 数。', defaultValue: 4, min: 1, max: 32, step: 1, visibleWhen: when('boogu_block_residency', 'block_offload') },
  { key: 'boogu_block_offload_prefetch_depth', type: 'number', label: 'Block Offload 预取深度', title: 'boogu_block_offload_prefetch_depth', desc: '异步预取后续 block 数', defaultValue: 2, min: 0, max: 8, step: 1, visibleWhen: when('boogu_block_residency', 'block_offload') },
  { key: 'boogu_block_offload_pin_memory', type: 'boolean', label: 'Block Offload Pin Memory', title: 'boogu_block_offload_pin_memory', desc: 'CPU 侧 pinned 缓冲', defaultValue: true, visibleWhen: when('boogu_block_residency', 'block_offload') }
];

// 缓存 DataLoader 策略（cache-first 路线）
export const S_CACHED_DATALOADER = [
  { key: 'cached_dataloader_auto_policy', type: 'boolean', label: '缓存 DataLoader 自动策略', title: 'cached_dataloader_auto_policy', desc: '缓存路线自动调 workers/prefetch 参数。建议保持开启（默认 true），手工调参被其覆盖。', defaultValue: true },
  { key: 'cached_dataloader_workers', type: 'string', label: '缓存 DataLoader workers', title: 'cached_dataloader_workers', desc: 'auto 或显式整数', defaultValue: 'auto', visibleWhen: when('cached_dataloader_auto_policy', false) },
  { key: 'cached_dataloader_prefetch_factor', type: 'string', label: '缓存 prefetch_factor', title: 'cached_dataloader_prefetch_factor', desc: 'auto 或显式整数', defaultValue: 'auto', visibleWhen: when('cached_dataloader_auto_policy', false) },
  { key: 'cached_dataloader_pin_memory', type: 'string', label: '缓存 pin_memory', title: 'cached_dataloader_pin_memory', desc: 'auto / true / false。', defaultValue: 'auto', visibleWhen: when('cached_dataloader_auto_policy', false) }
];

// 量化 / QLoRA / bitsandbytes
// rank_comp 是量化的附属档：没有量化就没有可回补的残差。
const RANK_COMP_ON = (c) => Boolean((c.quantization_enabled || c.training_quantization_enabled) && c.rank_comp_enabled)

export const S_QUANTIZATION = [
  { key: 'quantization_enabled', type: 'boolean', label: '训练量化 (QLoRA 等)', title: 'quantization_enabled', desc: '对底模启用量化加载（QLoRA 等），大幅降底模显存。建议显存不足以半精度装载时开启。', defaultValue: false },
  // 白名单见后端 quantization/quantization_config.py：{qlora_nf4,int8,fp8}。
  // 真正的 FP4 开关是下方独立字段 bnb_4bit_quant_type，不是这里。
  { key: 'quantization_type', type: 'select', label: '量化类型', title: 'quantization_type', desc: '底模量化后端类型（qlora_nf4 等 QLoRA 家族）。建议 nf4 质量/速度最均衡。', defaultValue: 'qlora_nf4', options: [
    { value: 'qlora_nf4', label: 'qlora_nf4' },
    { value: 'int8', label: 'int8' }
  ], visibleWhen: when('quantization_enabled', true) },
  { key: 'quantization_offload_optimizer_states', type: 'boolean', label: '量化时 offload 优化器状态', title: 'quantization_offload_optimizer_states', desc: '量化训练时把优化器状态也卸到 CPU。建议显存极限时开，略慢。', defaultValue: false, visibleWhen: when('quantization_enabled', true) },
  { key: 'quantization_target_suffixes', type: 'string', label: '量化目标后缀', title: 'quantization_target_suffixes', desc: '逗号分隔模块后缀；空=默认策略', defaultValue: '', visibleWhen: when('quantization_enabled', true) },
  // 覆盖率修正把 anima 从 28.1% 提到 84.2%、newbie 从 0.0% 提到 89.3%。
  // 这一档只给"要接着复现旧 NF4 产物"的人，默认关——旧行为是静默失效不是设计。
  { key: 'quantization_legacy_target_tables', type: 'boolean', label: '沿用旧版量化目标表', title: 'quantization_legacy_target_tables', desc: '沿用覆盖率修正前的旧量化目标表，仅为复现旧产物。建议新训练保持关闭。', defaultValue: false, visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  { key: 'training_quantization_enabled', type: 'boolean', label: '训练量化别名开关', title: 'training_quantization_enabled', desc: '训练量化别名开关（与 quantization_enabled 同义入口）。建议用主开关即可。', defaultValue: false },
  { key: 'training_quantization_type', type: 'select', label: '训练量化类型（别名）', title: 'training_quantization_type', desc: '训练量化类型别名（兼容字段）。建议与主字段保持一致即可，勿单独另设值。', defaultValue: 'qlora_nf4', options: [
    { value: 'qlora_nf4', label: 'qlora_nf4' }
  ], visibleWhen: when('training_quantization_enabled', true) },
  { key: 'bnb_4bit_compute_dtype', type: 'select', label: 'bnb 4bit 计算精度', title: 'bnb_4bit_compute_dtype', desc: 'bnb 计算精度：bfloat16 推荐；float16 旧卡。', defaultValue: 'bfloat16', options: ['bfloat16', 'float16', 'float32'], visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  { key: 'bnb_4bit_quant_type', type: 'select', label: 'bnb 4bit 量化类型', title: 'bnb_4bit_quant_type', desc: 'bitsandbytes 4bit 量化类型：nf4 信息论最优（推荐）；fp4 兼容旧卡。', defaultValue: 'nf4', options: ['nf4', 'fp4'], visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  { key: 'bnb_4bit_use_double_quant', type: 'boolean', label: 'bnb 双重量化', title: 'bnb_4bit_use_double_quant', desc: '二次量化压缩量化常数本身，再省约 0.4 bit/参数。建议保持开启（默认 true）。', defaultValue: true, visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  { key: 'bnb_4bit_quant_storage', type: 'select', label: 'bnb 量化存储类型', title: 'bnb_4bit_quant_storage', desc: '量化权重的存储 dtype。建议 uint8（默认）。', defaultValue: 'uint8', options: ['uint8', 'float16', 'bfloat16'], visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  // 低秩精度回补：4bit 基座存残差 W-up@down，前向由冻结低秩分支补回主奇异方向。
  // 必须配合量化使用（单开无标的），所以整族都挂在量化开关下。
  { key: 'rank_comp_enabled', type: 'boolean', label: '低秩精度回补', title: 'rank_comp_enabled', desc: '低秩精度回补：用冻结低秩分支补回 4bit 量化误差（r16 约 0.4% 主干显存）。建议量化底模质量受损时开启。', defaultValue: false, visibleWhen: (c) => c.quantization_enabled || c.training_quantization_enabled },
  { key: 'rank_comp_rank', type: 'number', label: '回补秩', title: 'rank_comp_rank', desc: '回补秩：越大越准越占显存（r16 削误差约 32%，r64 约 65%）。推荐范围：16–64。', defaultValue: 16, min: 1, step: 1, visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_refine_iters', type: 'number', label: '交替精化轮数', title: 'rank_comp_refine_iters', desc: '低秩↔量化残差交替拟合轮数（2 轮后收益递减）。推荐范围： 2。', defaultValue: 2, min: 0, step: 1, visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_oversample', type: 'number', label: 'rSVD 过采样', title: 'rank_comp_oversample', desc: 'rSVD 过采样列数提高小奇异值精度。推荐范围： 8（默认）。', defaultValue: 8, min: 0, step: 1, visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_niter', type: 'number', label: 'rSVD 幂迭代', title: 'rank_comp_niter', desc: 'rSVD 幂迭代次数。推荐范围： 4（默认）。', defaultValue: 4, min: 0, step: 1, visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_activation_weighted', type: 'boolean', label: '激活加权回补', title: 'rank_comp_activation_weighted', desc: '按通道激活能量加权的分解（最小化输出误差而非权重误差，实测再削约 16 个百分点），需缓存在场否则自动降级。建议量化底模质量受损时开启。', defaultValue: false, visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_calibration_batches', type: 'number', label: '校准样本数', title: 'rank_comp_calibration_batches', desc: '激活加权用多少个缓存样本估通道能量。推荐范围： 8（默认）。', defaultValue: 8, min: 1, step: 1, visibleWhen: (c) => RANK_COMP_ON(c) && c.rank_comp_activation_weighted },
  { key: 'rank_comp_calibration_ridge', type: 'number', label: '校准 ridge', title: 'rank_comp_calibration_ridge', desc: '能量估计 ridge 正则防除零。推荐范围： 1e-3。', defaultValue: 0.001, min: 0, step: 0.001, visibleWhen: (c) => RANK_COMP_ON(c) && c.rank_comp_activation_weighted },
  { key: 'rank_comp_target_suffixes', type: 'string', label: '回补目标后缀', title: 'rank_comp_target_suffixes', desc: '逗号分隔模块后缀；空=沿用该架构的量化目标表', defaultValue: '', visibleWhen: RANK_COMP_ON },
  { key: 'rank_comp_export_sidecar', type: 'boolean', label: '导出回补 sidecar', title: 'rank_comp_export_sidecar', desc: '另存 *.rank_comp.safetensors sidecar（不写入 LoRA，否则加载到未量化基座会画坏）。建议需要分发补偿权重时开启。', defaultValue: false, visibleWhen: RANK_COMP_ON }
];

// UNet 条件适配器字段（仅 SD 系历史路径；Anima 请用 anima-controlnet）
export const S_LLLITE = [
  { key: 'lllite_cond_emb_dim', type: 'number', label: '条件嵌入维 (UNet)', title: 'lllite_cond_emb_dim', desc: 'UNet 条件 embedding 维度（ControlNet-LLLite）。推荐范围：32（默认）。', defaultValue: 32, min: 1, step: 1 },
  { key: 'lllite_mlp_dim', type: 'number', label: 'MLP 瓶颈维 (UNet)', title: 'lllite_mlp_dim', desc: 'LLLite adapter MLP 瓶颈宽度。推荐范围：64（默认）。', defaultValue: 64, min: 1, step: 1 },
  { key: 'lllite_dropout', type: 'number', label: '条件 Dropout (UNet)', title: 'lllite_dropout', desc: 'LLLite 条件路径 dropout。推荐范围：0–0.1，默认 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.01 },
  { key: 'lllite_skip_input_blocks', type: 'boolean', label: '跳过 Input Blocks (UNet)', title: 'lllite_skip_input_blocks', desc: '不向 UNet input blocks 注入 LLLite。建议轻量控制时开启减少参数。', defaultValue: false },
  { key: 'lllite_skip_output_blocks', type: 'boolean', label: '跳过 Output Blocks (UNet)', title: 'lllite_skip_output_blocks', desc: '不向 output blocks 注入（默认跳过，社区惯例）。建议保持 true。', defaultValue: true }
];

// Anima ControlNet 网络字段（DiT 条件适配器；与 EasyControl 不同）
export const S_ANIMA_CONTROLNET = [
  { key: 'anima_controlnet_weights', type: 'file', pickerType: 'model-file', label: '已有 ControlNet 权重', title: 'anima_controlnet_weights', desc: '留空从头训练；可加载社区可读布局的 Anima', defaultValue: '' },
  { key: 'anima_controlnet_cond_emb_dim', type: 'number', label: '条件嵌入维', title: 'anima_controlnet_cond_emb_dim', desc: '共享条件嵌入维度。推荐范围：32（默认）。', defaultValue: 32, min: 1, step: 1 },
  { key: 'anima_controlnet_cond_dim', type: 'number', label: '条件主干宽度', title: 'anima_controlnet_cond_dim', desc: '条件图像编码器中间通道宽。推荐范围：64（默认）。', defaultValue: 64, min: 2, step: 2 },
  { key: 'anima_controlnet_cond_resblocks', type: 'number', label: '条件 ResBlock 数', title: 'anima_controlnet_cond_resblocks', desc: '条件主干残差块数量，0 关闭。推荐范围：1（默认）。', defaultValue: 1, min: 0, step: 1 },
  { key: 'anima_controlnet_use_aspp', type: 'boolean', label: '启用多尺度 ASPP', title: 'anima_controlnet_use_aspp', desc: '多尺度 ASPP 池化，对 depth/分割类全局结构更有益。建议 depth/分割任务开启，线稿类建议关闭。', defaultValue: false },
  { key: 'anima_controlnet_mlp_dim', type: 'number', label: '适配器瓶颈维', title: 'anima_controlnet_mlp_dim', desc: '每层 down/mid/up 与 FiLM 隐宽。推荐范围：64（默认）。', defaultValue: 64, min: 1, step: 1 },
  { key: 'anima_controlnet_target_layers', type: 'select', label: '注入层', title: 'anima_controlnet_target_layers', desc: 'Anima ControlNet 注入到 DiT 的哪些 Linear（self_attn_q 等）。建议默认 self_attn_q 单点起步。', defaultValue: 'self_attn_q', options: [
    { value: 'self_attn_q', label: 'self_attn_q（最轻）' },
    { value: 'self_attn_qkv', label: 'self_attn_qkv' },
    { value: 'self_attn_qkv_cross_q', label: 'self_attn_qkv + cross_q' },
    { value: 'self_attn_q_pre,mlp_fc1_pre', label: 'Q + MLP fc1' }
  ] },
  { key: 'anima_controlnet_dropout', type: 'number', label: '适配器 Dropout', title: 'anima_controlnet_dropout', desc: 'mid 后 dropout。推荐范围：0（默认）。', defaultValue: 0.0, min: 0, max: 1, step: 0.01 },
  { key: 'anima_controlnet_multiplier', type: 'number', label: '适配器倍率', title: 'anima_controlnet_multiplier', desc: '条件残差整体倍率。推荐范围：0.5–1，默认 1。', defaultValue: 1.0, min: 0, step: 0.05 },
  { key: 'anima_controlnet_export_compat', type: 'boolean', label: '导出社区可读布局', title: 'anima_controlnet_export_compat', desc: '默认开启：保存为社区可读 safetensors 键布局。', defaultValue: true }
];

export const VRAM_AUTO_ENHANCE_FIELDS = [
  { key: 'vram_auto_enhance_enabled', type: 'boolean', label: '显存不足自动增强', title: 'vram_auto_enhance_enabled', desc: '显存紧张时自动启用 Block Checkpointing 等增强。建议新手保持开启（默认 true）。', defaultValue: true },
  { key: 'enhanced_protection_mode', type: 'boolean', label: '增强防护模式', title: 'enhanced_protection_mode', desc: '开启后允许自动提升 PCIe 传输格式到 FP8。', defaultValue: false, visibleWhen: when('vram_auto_enhance_enabled', true) },
  // VRAM Smart Sensing：独立 master（后端默认 true）；子项挂 sensing 自身，不绑 auto_enhance
  { key: 'vram_smart_sensing_enabled', type: 'boolean', label: '显存智能感知', title: 'vram_smart_sensing_enabled', desc: '智能感知：建立速度基线，变慢时给出候选优化策略报告。建议新环境首跑开启观察建议。', defaultValue: true },
  { key: 'vram_smart_sensing_baseline_steps', type: 'number', label: '智能感知基线步数', title: 'vram_smart_sensing_baseline_steps', desc: '建立平均速度基线的步数。推荐范围：50（默认）。', defaultValue: 50, min: 5, step: 5, visibleWhen: when('vram_smart_sensing_enabled', true) },
  { key: 'vram_smart_sensing_slowdown_ratio', type: 'number', label: '智能感知变慢阈值', title: 'vram_smart_sensing_slowdown_ratio', desc: '慢于基线多少倍触发提示。推荐范围：1.5（慢 50%）。', defaultValue: 1.5, min: 1.05, step: 0.05, visibleWhen: when('vram_smart_sensing_enabled', true) },
  { key: 'vram_smart_sensing_window_steps', type: 'number', label: '智能感知窗口步数', title: 'vram_smart_sensing_window_steps', desc: '判断变慢的滑动窗口长度。推荐范围：5（默认）。', defaultValue: 5, min: 1, step: 1, visibleWhen: when('vram_smart_sensing_enabled', true) },
  { key: 'vram_smart_sensing_streaming_enabled', type: 'boolean', label: '智能感知流式候选', title: 'vram_smart_sensing_streaming_enabled', desc: '允许把流式 offload 列为候选策略。建议保持开启。', defaultValue: true, visibleWhen: when('vram_smart_sensing_enabled', true) },
  { key: 'vram_smart_sensing_sparse_swap_enabled', type: 'boolean', label: '智能感知稀疏交换候选', title: 'vram_smart_sensing_sparse_swap_enabled', desc: '允许把稀疏交换列为候选策略。建议保持开启。', defaultValue: true, visibleWhen: when('vram_smart_sensing_enabled', true) },
  { key: 'vram_smart_sensing_delta_cache_enabled', type: 'boolean', label: '智能感知 Delta/Cache 候选', title: 'vram_smart_sensing_delta_cache_enabled', desc: '只读识别 PCIe delta/cache 候选，不做分配。建议保持开启获取报告。', defaultValue: false, visibleWhen: when('vram_smart_sensing_enabled', true) }
];

export const S_SAVE = [
  { key: 'output_name', type: 'string', label: '模型保存名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'lulynx_' },
  { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '模型保存文件夹', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output' },
  { key: 'save_model_as', type: 'select', label: '保存格式', title: 'save_model_as', desc: '产物容器格式。safetensors 安全且加载快（推荐）；ckpt 兼容旧工具链。此处是 LoRA/dense 容器选择，不是 Comfy INT8 适配器格式。', defaultValue: 'safetensors', options: ['safetensors', 'pt', 'ckpt'] },
  { key: 'save_precision', type: 'select', label: '保存精度', title: 'save_precision', desc: '保存精度：auto 跟随底模/混合精度；float 最通用。INT8/FP8 压缩底模 dequant 后仍输出高精度。建议 auto。', defaultValue: 'auto', options: [
    { value: 'auto', label: '自动（跟随底座/混合精度）' },
    { value: 'fp16', label: 'fp16' },
    { value: 'bf16', label: 'bf16' },
    { value: 'float', label: 'float' }
  ] },
  { key: 'native_resume_save_precision', type: 'select', label: 'Native Resume 保存精度', title: 'native_resume_save_precision', desc: '原生续训伴生文件精度：float 完整保留 master（默认）。fp16/bf16 省一半体积但续训从舍入值开始。建议 float。', defaultValue: 'float', options: [
    { value: 'float', label: 'FP32（推荐）' },
    { value: 'fp16', label: 'FP16（节省空间）' },
    { value: 'bf16', label: 'BF16（节省空间）' }
  ] },
  { key: 'merge_export', type: 'boolean', label: '保存后导出合并底座', title: 'merge_export', desc: '训练完成后把 LoRA 合并进底模另存 dense 整模（体积大、不可卸载）。建议仅在交付合并版时开启。', defaultValue: false },
  { key: 'export_comfy_int8_base', type: 'boolean', label: '合并/全参后导出 Comfy INT8 底座', title: 'export_comfy_int8_base', desc: '对 dense 整模再量化为 Comfy INT8 包（整模，不是 LoRA）。需开启合并导出或 full_finetune', defaultValue: false },
  { key: 'export_comfy_int8_engine', type: 'select', label: 'Comfy INT8 引擎', title: 'export_comfy_int8_engine', desc: 'Comfy INT8 引擎实现：convrot 真旋转 group-RHT（默认，精度更好）；rowwise 无旋转更快。建议 convrot。', defaultValue: 'convrot', options: [
    { value: 'convrot', label: 'convrot 真旋转' }
  ], visibleWhen: when('export_comfy_int8_base', true) },
  { key: 'export_comfy_int8_groupsize', type: 'number', label: 'ConvRot Group Size', title: 'export_comfy_int8_groupsize', desc: 'ConvRot group size，必须是 4 的幂。推荐范围： 256（默认）。', defaultValue: 256, min: 4, step: 4, visibleWhen: when('export_comfy_int8_base', true) },
  { key: 'thin_svd_export_enabled', type: 'boolean', label: '启用 Thin-SVD 导出', title: 'thin_svd_export_enabled', desc: '保存时对 LoRA 做目标秩 SVD 压缩减小体积。建议默认关闭；RS-LoRA 会自动跳过（数学不等价）。', defaultValue: false },
  { key: 'thin_svd_export_rank', type: 'number', label: 'Thin-SVD 目标 Rank', title: 'thin_svd_export_rank', desc: 'Thin-SVD 目标秩，必须小于原 network_dim；0/留空不压缩。推荐范围：仅存档分发时使用。', defaultValue: 0, min: 0, visibleWhen: when('thin_svd_export_enabled', true) },
  { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', defaultValue: 1, min: 1 },
  { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。', defaultValue: '', min: 1 },
  { key: 'save_state', type: 'boolean', label: '保存训练状态', title: 'save_state', desc: '随 checkpoint 一起保存优化器动量等完整状态（体积约为模型 2–3 倍），供 resume 续训。建议长任务开启，短任务关闭省磁盘。', defaultValue: false },
  { key: 'save_state_on_train_end', type: 'boolean', label: '结束时额外保存状态', title: 'save_state_on_train_end', desc: '训练结束时额外保存一份最终状态。建议需要从终点继续微调时开启。', defaultValue: false },
  { key: 'save_last_n_epochs_state', type: 'number', label: '保留最近 N 个 epoch 状态', title: 'save_last_n_epochs_state', desc: '滚动保留最近 N 份「含优化器状态」的训练状态（体积大）。推荐范围：1。', defaultValue: '', min: 1, visibleWhen: when('save_state', true) },
  { key: 'save_last_n_steps_state', type: 'number', label: '保留最近 N 步状态', title: 'save_last_n_steps_state', desc: '滚动保留最近 N 份按步的训练状态。推荐范围：1。', defaultValue: '', min: 1, visibleWhen: when('save_state', true) },
  { key: 'save_n_epoch_ratio', type: 'number', label: '按比例保存', title: 'save_n_epoch_ratio', desc: '整段训练按比例保存 N 份，均匀铺开时间轴便于挑选。推荐范围：2–4。', defaultValue: '', min: 1 },
  { key: 'save_last_n_epochs', type: 'number', label: '仅保留最近 N 轮模型', title: 'save_last_n_epochs', desc: '滚动只保留最近 N 个按轮保存的模型，防磁盘爆满。推荐范围：1–3。', defaultValue: '', min: 1 },
  { key: 'save_last_n_steps', type: 'number', label: '仅保留最近 N 步模型', title: 'save_last_n_steps', desc: '滚动只保留最近 N 个按步保存的模型。推荐范围：1–3。', defaultValue: '', min: 1 },
  { key: 'log_with', type: 'select', label: '日志模块', title: 'log_with', desc: '训练指标上报渠道。建议 tensorboard（默认）；wandb 需要联网与 API key。', defaultValue: 'tensorboard', options: ['tensorboard', 'wandb'] },
  { key: 'logging_dir', type: 'folder', pickerType: 'folder', label: '日志保存文件夹', title: 'logging_dir', desc: 'TensorBoard 日志目录。建议保持默认或指向独立的 logs 目录，便于多 run 对比。', defaultValue: './logs' },
  { key: 'log_prefix', type: 'string', label: '日志前缀', title: 'log_prefix', desc: '日志前缀', defaultValue: '' },
  { key: 'wandb_run_name', type: 'string', label: 'WandB 运行名称', title: 'wandb_run_name', desc: 'wandb 单次运行显示名称', defaultValue: '', visibleWhen: when('log_with', 'wandb') },
  { key: 'wandb_api_key', type: 'string', label: 'WandB API Key', desc: 'Weights & Biases API key，仅 log_with=wandb 时必填。注意保密，勿提交到仓库。', defaultValue: '', visibleWhen: when('log_with', 'wandb') },
  // 后端 output_caption_fragments.py:103-112；日志开销高时自动降频。
  { key: 'adaptive_step_logging_enabled', type: 'boolean', label: '自适应日志降频', title: 'adaptive_step_logging_enabled', desc: '进度/TensorBoard 写入耗时过高时自动降低日志频率。建议大数据集长训保持开启（默认 true）。', defaultValue: true },
  { key: 'adaptive_step_logging_threshold', type: 'number', label: '日志开销阈值', title: 'adaptive_step_logging_threshold', desc: '日志耗时占单步总耗时的阈值比例。推荐范围：0.01（1%）附近。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: when('adaptive_step_logging_enabled', true) },
];
export const S_CAPTION_BASIC = [
  { key: 'caption_extension', type: 'string', label: 'Tag 文件扩展名', title: 'caption_extension', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', defaultValue: '.txt' },
  { key: 'shuffle_caption', type: 'boolean', label: '随机打乱标签', title: 'shuffle_caption', desc: '每次读取时随机打乱逗号 tag 顺序，防止模型依赖固定位置。建议几乎所有逗号分隔 tag 训练开启（社区惯例）。', defaultValue: false },
  { key: 'shuffle_caption_tags_only', type: 'boolean', label: '仅打乱 Tag 部分', title: 'shuffle_caption_tags_only', desc: '结构化 JSON 标注只打乱 tags 部分，自然语言句子保持原序。建议 JSON 双通道标注时开启。', defaultValue: false },
  { key: 'weighted_captions', type: 'boolean', label: '使用带权重 token', title: 'weighted_captions', desc: '解析 caption 中的 (tag:1.2) 权重语法。建议标注里用了权重语法时开启，否则关闭以免误解析。', defaultValue: false },
  { key: 'keep_tokens', type: 'number', label: '保留前 N 个 token', title: 'keep_tokens', desc: '打乱 tag 时保持前 N 个不动（通常固定触发词）。推荐范围：有 1 个触发词设 1；多触发词设对应数量；0 不保护。', defaultValue: 0, min: 0, max: 255 },
  { key: 'keep_tokens_separator', type: 'string', label: '保留 token 分隔符', title: 'keep_tokens_separator', desc: '受保护前缀的自定义分隔符（如 |||）。建议仅当用特殊前缀结构时填写，留空按逗号处理。', defaultValue: '' },
  // 后端接受域 min=75（launcher schema）；前端校验域必须 ⊆ 后端接受域。
  { key: 'max_token_length', type: 'number', label: '最大 token 长度', title: 'max_token_length', desc: '文本 token 截断上限。CLIP×3=225 为常用值（75 的倍数），后端最小 75。推荐范围：225 或更短以聚焦主体。', defaultValue: 225, min: 75 },
  { key: 'caption_replacements', type: 'textarea', label: 'Caption 替换规则', title: 'caption_replacements', desc: 'caption 替换规则表（原文→新文），启用正则后按正则匹配。建议清洗统一术语时使用，规则勿过多。', defaultValue: '' },
  { key: 'caption_replacements_regex', type: 'boolean', label: '启用正则表达式替换', title: 'caption_replacements_regex', desc: '替换规则用正则而非字面量匹配。建议规则确实需要模式匹配时开启。', defaultValue: false },
  { key: 'random_triggers', type: 'textarea', label: '随机触发词', title: 'random_triggers', desc: '逗号分隔的触发词列表或文件路径', defaultValue: '' },
  { key: 'random_triggers_probability', type: 'number', label: '触发词注入概率', title: 'random_triggers_probability', desc: '注入随机触发词的概率。推荐范围：1.0 总是注入；0 关闭。', defaultValue: 1.0, min: 0, max: 1, step: 0.1 },
  { key: 'random_triggers_position', type: 'select', label: '触发词注入位置', title: 'random_triggers_position', desc: '触发词注入到 caption 的位置（prepend 前置等）。建议 prepend（默认）保证触发词在首位。', defaultValue: 'prepend', options: ['prepend', 'append'] },
];

// Dropout 与保护语义族（output_caption_fragments.py:151-180 后端已消费）。
export const S_CAPTION_DROPOUT = [
  { key: 'caption_dropout_rate', type: 'number', label: '全部标签丢弃概率', title: 'caption_dropout_rate', desc: '整句 caption 以该概率完全置空（无条件学习）。推荐范围：0–0.05；CFG 相关训练才需要。', defaultValue: '', min: 0, step: 0.01 },
  { key: 'caption_dropout_every_n_epochs', type: 'number', label: '每 N 轮丢弃标签', title: 'caption_dropout_every_n_epochs', desc: '每 N 个 epoch 每 N 个 epoch 整批丢弃全部 caption 一个 epoch。推荐范围：保持 0；现代流程改用 caption_dropout_rate。', defaultValue: '', min: 0, max: 100, step: 1 },
  { key: 'caption_tag_dropout_rate', type: 'number', label: '按标签丢弃概率', title: 'caption_tag_dropout_rate', desc: '按 tag 维度随机丢弃的概率，提升鲁棒性。推荐范围：0–0.05；触发词会被 keep_tokens/保护规则豁免。', defaultValue: '', min: 0, step: 0.01 },
  { key: 'nl_dropout_rate', type: 'number', label: 'NL 描述丢弃概率', title: 'nl_dropout_rate', desc: '对结构化 JSON 中 NL 描述的随机丢弃概率。推荐范围：0–0.1。', defaultValue: '', min: 0, max: 1, step: 0.01 },
  { key: 'caption_tag_dropout_targets', type: 'textarea', label: '指定丢弃 Tag 列表', title: 'caption_tag_dropout_targets', desc: '指定要处理的 tag 列表。一行一个，也支持逗号分隔', defaultValue: '' },
  { key: 'caption_tag_dropout_target_mode', type: 'select', label: '指定 Tag 处理方式', title: 'caption_tag_dropout_target_mode', desc: '命中保护外 tag 后的处理方式：drop_all 全部移除；random_n 只随机移除 N 个。建议 drop_all（默认）。', defaultValue: 'drop_all', options: ['drop_all', 'random_n'] },
  { key: 'caption_tag_dropout_target_count', type: 'number', label: '随机丢弃数量', title: 'caption_tag_dropout_target_count', desc: 'random_n 模式下每张图随机丢弃的命中 tag 数。推荐范围：1（默认）。', defaultValue: 1, min: 1, step: 1, visibleWhen: when('caption_tag_dropout_target_mode', 'random_n') },
  uiGroup('prefix_protection', '前缀保护与作用域', '这些键决定 drop/shuffle 的作用边界：可把 keep_tokens 前缀或分隔符头部排除在变动之外（后端 dataset_caption_policy / output_caption_fragments 消费）。'),
  { key: 'caption_tag_mutate_scope', type: 'select', label: 'Tag 变动范围', title: 'caption_tag_mutate_scope', desc: 'tag 变动范围：all 全部可动；after_separator 仅分隔符之后可动（头部前缀始终保留）。建议有结构化前缀时选 after_separator。', defaultValue: 'all', options: [
    { value: 'all', label: '全部' },
    { value: 'after_separator', label: '仅分隔符之后' },
  ] },
  { key: 'caption_tag_scope_separator', type: 'string', label: '变动范围分隔符', title: 'caption_tag_scope_separator', desc: 'after_separator 时按此字符串切分：头部受保护，尾部可变动。默认 |||', defaultValue: '|||', visibleWhen: when('caption_tag_mutate_scope', 'after_separator') },
  { key: 'tag_group_shuffle', type: 'boolean', label: '标签组内打乱', title: 'tag_group_shuffle', desc: '按分隔符分组、只在组内打乱；开启后取代全局 shuffle。可与 after_separator 叠加（仅尾部可变区）', defaultValue: false },
  { key: 'tag_group_separator', type: 'string', label: '分组分隔符', title: 'tag_group_separator', desc: '组内打乱用的边界（默认 |||），可与保护分隔符相同', defaultValue: '|||', visibleWhen: when('tag_group_shuffle', true) },
  { key: 'caption_protect_prefix_from_dropout', type: 'boolean', label: '前缀豁免丢弃', title: 'caption_protect_prefix_from_dropout', desc: '让 dropout/shuffle 不触碰分隔符之前的前缀段。建议使用「前缀|||特征」结构时开启。', defaultValue: false },
];

export const S_CAPTION_VARIANTS = [
  { key: 'caption_variants_enabled', type: 'boolean', label: '多 Caption 变体训练', title: 'caption_variants_enabled', desc: '多 caption 变体训练：同一图按变体文件轮换不同描述。建议需要一图多描述泛化时开启。', defaultValue: false },
  { key: 'caption_variants', type: 'textarea', label: 'Caption 变体定义 (JSON)', title: 'caption_variants', desc: 'JSON 数组，例如 [{"suffix":".', defaultValue: '', visibleWhen: when('caption_variants_enabled', true) },
  { key: 'caption_variant_schedule', type: 'select', label: '变体调度', title: 'caption_variant_schedule', desc: '变体切换调度（alternate 轮换等）。建议 alternate。', defaultValue: 'alternate', options: [
    { value: 'alternate', label: 'alternate（轮换）' },
    { value: 'ratio', label: 'ratio（比例）' },
    { value: 'curriculum', label: 'curriculum（课程）' },
    { value: 'custom', label: 'custom（自定义序列）' }
  ], visibleWhen: when('caption_variants_enabled', true) },
  { key: 'caption_variant_ratio', type: 'string', label: '变体比例 JSON', title: 'caption_variant_ratio', desc: '非主变体的采样占比。推荐范围：0.2–0.5。', defaultValue: '', visibleWhen: all(when('caption_variants_enabled', true), when('caption_variant_schedule', 'ratio')) },
  { key: 'caption_variant_custom_sequence', type: 'string', label: '自定义变体序列', title: 'caption_variant_custom_sequence', desc: 'custom 模式：JSON 数组，索引对应变体，如 [0,0,1,0,1]。', defaultValue: '', visibleWhen: all(when('caption_variants_enabled', true), when('caption_variant_schedule', 'custom')) },
  { key: 'caption_variant_loss_adaptive', type: 'boolean', label: '按 loss 自适应变体比例', title: 'caption_variant_loss_adaptive', desc: '按各变体 loss 动态调整采样比例。建议实验性开启，先跑固定比例基线。', defaultValue: false, visibleWhen: when('caption_variants_enabled', true) },
  { key: 'dual_caption_enabled', type: 'boolean', label: '双 Caption（短/长）', title: 'dual_caption_enabled', desc: '从结构化标注读取 short/long 两路 caption 分别训练。建议两套描述都高质量时开启。', defaultValue: false },
  { key: 'dual_caption_short_key', type: 'string', label: '短 Caption 字段名', title: 'dual_caption_short_key', desc: 'JSON 中短 caption 键名。', defaultValue: 'short', visibleWhen: when('dual_caption_enabled', true) },
  { key: 'dual_caption_long_key', type: 'string', label: '长 Caption 字段名', title: 'dual_caption_long_key', desc: 'JSON 中长 caption 键名。', defaultValue: 'long', visibleWhen: when('dual_caption_enabled', true) },
];

// 结构化 caption (SC) 分桶 dropout：configs_dataset.py 仅声明、smart_caption.py 用
// 自有无前缀字段且无桥接 —— 全仓零读者（2026-08 SDXL 桶审计）。隐藏保留旧草稿，
// 提交层 runConfigBuilder 会剥除，避免假旋钮。
export const S_CAPTION_STRUCTURED = [
  { key: 'sc_trigger_dropout', type: 'hidden', defaultValue: 0.0 },
  { key: 'sc_style_dropout', type: 'hidden', defaultValue: 0.05 },
  { key: 'sc_quality_dropout', type: 'hidden', defaultValue: 0.3 },
  { key: 'sc_content_dropout', type: 'hidden', defaultValue: 0.15 },
  { key: 'sc_modifier_dropout', type: 'hidden', defaultValue: 0.2 },
  { key: 'sc_locked_tags', type: 'hidden', defaultValue: '' },
  { key: 'oom_skip_batch_enabled', type: 'boolean', label: 'OOM 跳批', title: 'oom_skip_batch_enabled', desc: '自动跳过触发 OOM 的 batch 继续训练。建议长训无人值守开启（默认 true）。', defaultValue: true },
  { key: 'oom_skip_batch_max_consecutive', type: 'number', label: 'OOM 最大连续次数', title: 'oom_skip_batch_max_consecutive', desc: '连续 OOM 达到该次数即停止训练防死循环。推荐范围：3（默认）。', defaultValue: 3, min: 1, max: 10, step: 1 }
];

const CAPTION_SOURCE_MIX_FIELDS = [
  { key: 'caption_source_mix_enabled', type: 'boolean', label: '启用 Tag/NL 混合采样', title: 'caption_source_mix_enabled', desc: 'Anima/Newbie 结构化 JSON caption 的 Tag/NL 混合采样开关。建议默认关闭，想混合触发词与自然语言时开。', defaultValue: false, visibleWhen: (c) => String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie') },
  { key: 'caption_source_nl_ratio', type: 'number', label: 'NL 比例', title: 'caption_source_nl_ratio', desc: '输出「触发词 + 自然语言」的采样权重 %。推荐范围：65（默认，NL 为主利于泛化）。', defaultValue: 65, min: 0, max: 100, step: 1, visibleWhen: (c) => (String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie')) && c.caption_source_mix_enabled === true },
  { key: 'caption_source_tag_ratio', type: 'number', label: 'Tag 比例', title: 'caption_source_tag_ratio', desc: '输出「触发词 + Tag」的采样权重 %。推荐范围：20（默认）。', defaultValue: 20, min: 0, max: 100, step: 1, visibleWhen: (c) => (String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie')) && c.caption_source_mix_enabled === true },
  { key: 'caption_source_trigger_only_ratio', type: 'number', label: '仅触发词比例', title: 'caption_source_trigger_only_ratio', desc: '仅输出触发词（不带任何描述）的采样权重 %。推荐范围：10（默认）；四路比例之和应为 100。', defaultValue: 10, min: 0, max: 100, step: 1, visibleWhen: (c) => (String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie')) && c.caption_source_mix_enabled === true },
  { key: 'caption_source_empty_ratio', type: 'number', label: '空文本比例', title: 'caption_source_empty_ratio', desc: '完全空文本采样占比 %。推荐范围：5（默认，保留无条件能力）；过高伤对齐。', defaultValue: 5, min: 0, max: 100, step: 1, visibleWhen: (c) => (String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie')) && c.caption_source_mix_enabled === true },
  { key: 'caption_source_trigger_tokens', type: 'textarea', label: '触发词列表', title: 'caption_source_trigger_tokens', desc: '逗号或换行分隔；留空时优先尝试 JSON 中的 concept /', defaultValue: '', visibleWhen: (c) => (String(c.model_train_type || '').includes('anima') || String(c.model_train_type || '').includes('newbie')) && c.caption_source_mix_enabled === true },
];

// 兼容组合：未拆卡的其他训练族继续用单张 caption 卡。
export const S_CAPTION = [
  ...S_CAPTION_BASIC,
  ...CAPTION_SOURCE_MIX_FIELDS,
  ...S_CAPTION_DROPOUT,
  ...S_CAPTION_VARIANTS,
  ...S_CAPTION_STRUCTURED,
];
export const S_LR = [
  { key: 'learning_rate', type: 'string', label: '总学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '1e-4' },
  { key: 'unet_lr', type: 'string', label: 'U-Net 学习率', title: 'unet_lr', desc: 'U-Net/DiT 主干学习率，覆盖 learning_rate。推荐范围：与主学习率相同（1e-4 量级，LoRA）。', defaultValue: '1e-4' },
  { key: 'text_encoder_lr', type: 'string', label: '文本编码器学习率', title: 'text_encoder_lr', desc: '文本编码器独立学习率。较低值保留预训练语义，同时适配触发词。推荐范围：UNet LR 的 1/2～1/10（后端默认 5e-5），或保持 0 冻结 TE。', defaultValue: '1e-5' },
  { key: 'lr_scheduler', type: 'select', label: '学习率调度器', title: 'lr_scheduler', desc: '学习率随训练进度的变化曲线，影响中后期收敛质量。建议常规 LoRA 选 cosine 或 cosine_with_restarts；不确定时保持默认即可，loss 门控类调度适合想避免余弦过早触底的实验。', defaultValue: 'cosine', options: schedulerOptions(ALL_SCHEDULERS) },
  { key: 'lr_warmup_steps', type: 'number', label: '预热步数', title: 'lr_warmup_steps', desc: '训练开始时学习率从 0 线性升到目标值的步数，避免初期大步长破坏稳定。推荐范围：0–500 步（默认 0 即可不预热；大数据集或高 LR 建议 100 左右）。', defaultValue: 0, min: 0 },
  { key: 'lr_scheduler_num_cycles', type: 'number', label: '重启次数', title: 'lr_scheduler_num_cycles', desc: 'cosine_with_restarts 的重启次数：每个周期结束学习率回升再衰减。推荐范围：1–4（默认 1；多周期可缓解后期僵化）。', defaultValue: 1, min: 1, visibleWhen: when('lr_scheduler', 'cosine_with_restarts') },
  ...S_LOSS_AWARE_LR,
  // (separator for TypeScript parser)
  { key: 'optimizer_type', type: 'select', label: '优化器', title: 'optimizer_type', desc: '优化器决定如何用梯度更新权重，是稳定性与显存的关键。AdamW8bit 最稳妥省显存；Prodigy/AutoProdigy 自适应步长免调 LR；ScheduleFree 系内置衰减。建议默认 AdamW8bit + cosine。', defaultValue: 'AdamW8bit', options: ALL_OPTIMIZERS },
  { key: 'optimizer_backend', type: 'select', label: '优化器后端', title: 'optimizer_backend', desc: 'AdamW 的后端实现档位（torch/foreach/fused/bnb 等），数值等价但速度显存有别。建议保持 auto 让后端择优。', defaultValue: 'auto', options: OPTIMIZER_BACKEND_OPTIONS, visibleWhen: expertAndNotTurboCore },
  { key: 'turbocore_optimizer_mode', type: 'select', label: 'Lulynx Triton 优化器', title: 'turbocore_optimizer_mode', desc: 'Lulynx Triton 优化器档位：off 标准 PyTorch step；auto 自动判定；force 强制且不可用即报错。需关 TurboCore CUDA 总开关才生效。建议 auto 起步。', defaultValue: 'off', options: [
    { value: 'off', label: 'PyTorch 原生 step' },
    { value: 'auto', label: 'Lulynx Triton 自动' },
    { value: 'force', label: 'Lulynx Triton 强制（不可用时直接报错）' }
  ] },
  { key: 'advanced_optimizer_strategy', type: 'select', label: '高级优化策略', title: 'advanced_optimizer_strategy', desc: '高级优化策略入口：auto 自动判定；lora_plus/rs_lora 等在此叠加。建议 auto，不需要特殊策略时无感。', defaultValue: 'auto', options: ADVANCED_OPTIMIZER_STRATEGY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  // 后端独立 master。SDXL 桶排版重排把它们迁到 network 页（S_LORA_METHOD_MODIFIERS
  // + excludeKeys 过滤）；其余族暂留 optimizer 页，归各自桶的站点迁移。
  { key: 'lora_plus_enabled', type: 'boolean', label: 'LoRA+ 参数组', title: 'lora_plus_enabled', desc: 'LoRA+ 给 B 矩阵更高学习率，加快上层适配。推荐搭配 lr 倍率 16 使用；小数据集慎用易过拟合。', defaultValue: false },
  { key: 'lora_plus_lr_ratio', type: 'number', label: 'LoRA+ LR 倍率', title: 'lora_plus_lr_ratio', desc: 'LoRA+ 中 B 相对 A 的学习率倍率。推荐范围：16（论文常用）；1 等价关闭。', defaultValue: 16.0, min: 1, step: 1, visibleWhen: (c) => c.lora_plus_enabled === true || getAdapterTypeKey(c) === 'lora_plus' },
  { key: 'rs_lora_enabled', type: 'boolean', label: 'RS-LoRA 缩放', title: 'rs_lora_enabled', desc: 'RS-LoRA 让 alpha 随 rank 缩放（α/√r），高 rank 更稳。推荐范围：rank ≥64 想提稳时开启；低 rank 收益有限。', defaultValue: false },
  { key: 'min_snr_gamma', type: 'number', label: 'Min-SNR Gamma', desc: '对高信噪比 timestep 降权，均衡各去噪阶段的学习。推荐范围：5（论文推荐值）；轻度 3；小数据集强调细节可用 8；0/留空关闭。', defaultValue: '', min: 0, step: 0.1 },
  // 后端 training_field_optimization_fragments.py:140-142；优化器工厂消费。
  { key: 'weight_decay', type: 'number', label: '权重衰减', title: 'weight_decay', desc: 'AdamW 系 L2 正则强度，抑制权重无限增长。推荐范围：0.01（默认）；Prodigy/DAdaptation 系会自行管理，可设 0。', defaultValue: 0.01, min: 0, max: 1, step: 0.001 },
  { key: 'huber_c', type: 'number', label: 'Huber c / delta', title: 'huber_c', desc: 'huber/smooth_l1/pseudo_huber 的过渡阈值 delta：小于 c 按 L2、大于按 L1。推荐范围：0.1 附近（默认）。', defaultValue: 0.1, min: 0, step: 0.01 },
  { key: 'huber_schedule', type: 'select', label: 'Huber 调度', title: 'huber_schedule', desc: 'Huber 阈值的调度方式：constant 固定；auto 按 batch 分位数自适应。建议 constant 起步，loss 量级漂移明显时用 auto。', defaultValue: 'constant', options: [
    { value: 'constant', label: 'constant' },
    { value: 'exponential', label: 'exponential' },
    { value: 'snr', label: 'snr' },
    { value: 'auto', label: 'auto' }
  ] },
  { key: 'huber_scale', type: 'number', label: 'Huber scale', title: 'huber_scale', desc: 'Huber 损失整体缩放系数。推荐范围：保持 1，与其他权重轴分开调节。', defaultValue: 1.0, min: 0, step: 0.1 },
  { key: 'huber_auto_percentile', type: 'number', label: 'Huber auto 分位', title: 'huber_auto_percentile', desc: 'schedule=auto 时估计 delta 的分位数。推荐范围：0.9（默认）附近。', defaultValue: 0.9, min: 0, max: 1, step: 0.05, visibleWhen: when('huber_schedule', 'auto') },
  { key: 'gradient_guard_strategy', type: 'select', label: '梯度防护策略', title: 'gradient_guard_strategy', desc: '梯度防护策略：none 关闭；agc 按参数范数比例裁剪；centralized/agc_centralized 做集中式范数防护。建议默认 none，出现训练不稳或梯度尖峰时再试 agc。', defaultValue: 'none', options: [
    { value: 'none', label: 'none' },
    { value: 'agc', label: 'agc' },
    { value: 'centralized', label: 'centralized' },
    { value: 'agc_centralized', label: 'agc_centralized' }
  ] },
  { key: 'gradient_guard_agc_clip_factor', type: 'number', label: 'AGC clip 因子', title: 'gradient_guard_agc_clip_factor', desc: 'AGC 把梯度范数限制为参数范数的该比例。推荐范围：0.01（默认）附近，过大失去防护意义。', defaultValue: 0.01, min: 0, step: 0.001, visibleWhen: (c) => ['agc', 'agc_centralized'].includes(String(c.gradient_guard_strategy || 'none')) },
  { key: 'gradient_guard_agc_eps', type: 'number', label: 'AGC eps', title: 'gradient_guard_agc_eps', desc: 'AGC 中参数范数的下限，防止除零。推荐范围：保持默认 1e-3。', defaultValue: 1e-3, min: 0, step: 1e-4, visibleWhen: (c) => ['agc', 'agc_centralized'].includes(String(c.gradient_guard_strategy || 'none')) },
  { key: 'prodigy_d0', type: 'string', label: 'Prodigy d0', desc: 'Prodigy 初始步长估计。推荐范围：1e-6（默认，小值起步最稳）。', defaultValue: '', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
  { key: 'prodigy_d_coef', type: 'string', label: 'Prodigy d_coef', desc: 'Prodigy 步长放大系数。推荐范围：1.0（默认）；>1 更激进易过冲。', defaultValue: '2.0', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
  { key: 'fused_backward_grad_clip_mode', type: 'select', label: 'LOMO 梯度裁剪档位', title: 'fused_backward_grad_clip_mode', desc: 'LOMO/AdaLOMO 单遍反传内更新拿不到全部梯度，此选项选裁剪档位：default 不裁剪最快；full 多一次预反传拿精确范数；per_param 近似裁剪。建议 default。', defaultValue: 'default', options: [
    { value: 'default', label: '默认（单遍反传，不裁剪）' },
    { value: 'full', label: '完整（额外预反传，裁剪生效）' }
  ], visibleWhen: (cfg) => ['lomo', 'adalomo', 'pytorch_optimizer.lomo', 'pytorch_optimizer.adalomo'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
  ...S_AUTO_PRODIGY,
  ...OPTIMIZER_SPECIFIC_FIELDS,
  // (separator for TypeScript parser)
  { key: 'lr_scheduler_type', type: 'string', label: '自定义调度器类', title: 'lr_scheduler_type', desc: '自定义学习率调度器类路径', defaultValue: '' },
  { key: 'lr_scheduler_args', type: 'textarea', label: '自定义调度器参数', title: 'lr_scheduler_args', desc: '传给调度器的额外参数（如 min_lr），每行一个 key=value。不认识调度器的参数会被忽略，建议保持为空除非文档明确要求。', defaultValue: '' },
  { key: 'optimizer_args_custom', type: 'textarea', label: '自定义优化器参数', title: 'optimizer_args_custom', desc: '自定义优化器额外参数（对应后端 optimizer_args），每行一个 key=value。', defaultValue: '' }
];
// LoRA+/RS-LoRA：网络修饰开关（原 optimizer 页迁出，SDXL 桶排版重排）。
// 由各族 network 页按需挂载；lora_plus_lr_ratio 的可见性锚 lora_plus_enabled。
export const S_LORA_METHOD_MODIFIERS = [
  { key: 'lora_plus_enabled', type: 'boolean', label: 'LoRA+ 参数组', title: 'lora_plus_enabled', desc: 'LoRA+ 给 B 矩阵更高学习率，加快上层适配。推荐搭配 lr 倍率 16 使用；小数据集慎用易过拟合。', defaultValue: false },
  { key: 'lora_plus_lr_ratio', type: 'number', label: 'LoRA+ LR 倍率', title: 'lora_plus_lr_ratio', desc: 'LoRA+ 中 B 相对 A 的学习率倍率。推荐范围：16（论文常用）；1 等价关闭。', defaultValue: 16.0, min: 1, step: 1, visibleWhen: (c) => c.lora_plus_enabled === true || getAdapterTypeKey(c) === 'lora_plus' },
  { key: 'rs_lora_enabled', type: 'boolean', label: 'RS-LoRA 缩放', title: 'rs_lora_enabled', desc: 'RS-LoRA 让 alpha 随 rank 缩放（α/√r），高 rank 更稳。推荐范围：rank ≥64 想提稳时开启；低 rank 收益有限。', defaultValue: false },
];

// S_LR_TARGET now filters AnimaFactoredAdamW based on training mode
export const S_LR_TARGET = S_LR.map((field) => {
  if (field.key === 'optimizer_type') {
    return {
      ...field,
      // Use function to get filtered options based on model_train_type
      options: (config) => {
        const trainType = String(config?.model_train_type || '').trim().toLowerCase();
        // AnimaFactoredAdamW only for anima-finetune (full model fine-tuning)
        if (trainType !== 'anima-finetune') {
          return TARGET_LORA_OPTIMIZERS.filter((name) => name !== 'AnimaFactoredAdamW');
        }
        return TARGET_LORA_OPTIMIZERS;
      }
    };
  }
  return field;
});
// 底模微调版:optimizer_backend 选项含 ao_8bit(torchao 仅对大参数全参微调有收益)。
export const S_LR_FT = S_LR.map((field) => field.key === 'optimizer_backend'
  ? { ...field, options: OPTIMIZER_BACKEND_OPTIONS_FINETUNE }
  : field);

// ---- DiT 族变体：共享包过滤/改文案，不改 wire key（SD/SDXL 继续用 S_LR / S_ADV）----
export const excludeKeys = (fields, keys) => {
  const ban = new Set(keys);
  return fields.filter((f) => !ban.has(f.key));
};

export const remapFieldMeta = (fields, byKey) =>
  fields.map((f) => (byKey[f.key] ? { ...f, ...byKey[f.key] } : f));

const DIT_LR_META = {
  learning_rate: {
    desc: '总学习率；若分别设置主干与文本编码器学习率，则以分项为准。',
  },
  unet_lr: {
    label: '主干 / DiT 学习率',
    desc: '主干（DiT / Transformer）学习率；wire key 仍为 unet_lr。',
  },
  text_encoder_lr: {
    label: '文本编码器学习率',
    desc: '文本编码器学习率（无 TE 训练时通常可忽略）。',
  },
};

/** DiT / flow 族 LR：保留 CLI key，展示名去掉 U-Net 语义 */
export const S_LR_DIT = remapFieldMeta(S_LR, DIT_LR_META);
export const S_LR_TARGET_DIT = remapFieldMeta(S_LR_TARGET, DIT_LR_META);
export const S_LR_FT_DIT = remapFieldMeta(S_LR_FT, DIT_LR_META);

export const S_TRAIN = (epochs = 10) => [
  { key: 'train_length_mode', type: 'select', label: '训练长度模式', title: 'train_length_mode', desc: '选择按最大轮数还是最大步数结束训练，两者只生效一个。建议概念简单的小数据集用轮数，大图库或精确控量用步数。', defaultValue: '最大轮数', options: ['最大轮数', '最大步数'] },
  { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', desc: '训练遍历整个数据集的次数上限，决定总训练量。推荐范围：小数据集（<50 张）10–30 轮；大数据集 1–5 轮；与 max_train_steps 二选一设置。', defaultValue: epochs, min: 1, visibleWhen: (c) => !c.train_length_mode || c.train_length_mode === '最大轮数' },
  { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 1000, min: 1, visibleWhen: when('train_length_mode', '最大步数') },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', defaultValue: 1, min: 1, max: 32, step: 1 },
  { key: 'gradient_checkpointing', type: 'boolean', label: '梯度检查点', title: 'gradient_checkpointing', desc: '反传时重算激活以省显存（约换 20–30% 速度）。建议除显存富余外保持开启（默认 true）。', defaultValue: true },
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '累积 N 个 micro-batch 再更新一次参数，等效放大 batch 而不增加峰值显存。推荐范围：1（默认）或 4–8；等效 batch = batch_size × 本值。', defaultValue: 1, min: 1 },
  { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: '梯度累加实现路径：fast 只在真正 optimizer.step 时同步/检查（更快），classic 保留旧逐 micro-batch 检查。建议保持 fast，排查累加相关异常时再切 classic 对照。', defaultValue: 'fast', options: [
    { value: 'fast', label: 'fast' },
    // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
    // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
    { value: 'classic', label: 'classic（逐 microbatch 检查）' }
  ], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
  { key: 'network_train_unet_only', type: 'boolean', label: '仅训练 U-Net / DiT', title: 'network_train_unet_only', desc: '只训练 U-Net/DiT 主干（TE 冻结）。建议概念视觉为主、无需新词绑定时开启（多数 LoRA 场景）。', defaultValue: true },
  { key: 'network_train_text_encoder_only', type: 'boolean', label: '仅训练文本编码器', title: 'network_train_text_encoder_only', desc: '只训练文本编码器（主干冻结）。建议仅做词汇/风格语言绑定时开启。', defaultValue: false }
];

// 第 3 站桶（2026-08，幻影治理 C）：train_length_mode 是 ui-only 键（提交层
// runConfigBuilder 已剥除），中文枚举值驱动显隐属脆弱设计。采用本展开的类型把
// 轮数/步数改为常显双字段：后端两者并存时「先到者停」（training_preflight_checks.
// py:339-343），steps=0 表示按 epoch 推导（configs_base.py:47-48）。可选同时摘除
// network_train_* 双假开关（队列 pop / shim 反转覆盖，training_queue_support.py:252-253）。
export const expandTrainLengthFields = (fields, { dropFakeTeSwitches = false } = {}) => fields
  .filter((f) => !dropFakeTeSwitches || !['network_train_unet_only', 'network_train_text_encoder_only'].includes(f.key))
  .map((f) => {
    if (f.key === 'train_length_mode') return null;
    if (f.key === 'max_train_epochs') return { ...f, visibleWhen: undefined };
    if (f.key === 'max_train_steps') return { ...f, defaultValue: 0, min: 0, visibleWhen: undefined, desc: '按优化器更新步数控制训练长度，与最大轮数同时 >0 时先到者生效。推荐范围：0 表示按 epoch 推导；启用时常用 1000–5000 步。' };
    return f;
  })
  .filter(Boolean);
export const S_PREVIEW = [
  { key: 'enable_preview', type: 'boolean', label: '启用预览图', title: 'enable_preview', desc: '训练中定期出预览图观察收敛方向。建议正式训练开启（每轮 1–2 张足够），显存极限时关闭。', defaultValue: false },
  { key: 'preview_device', type: 'select', label: '预览设备', title: 'preview_device', desc: '预览推理设备：gpu 快但占显存；cpu 不占显存慢。建议 gpu（默认），低显存档案自动处理。', defaultValue: 'gpu', options: ['gpu', 'cpu', 'off'], visibleWhen: when('enable_preview', true) },
  { key: 'ephemeral_preview_pipeline', type: 'boolean', label: '临时预览 Pipeline', title: 'ephemeral_preview_pipeline', desc: '每次预览后销毁 pipeline 释放缓存，避免 VAE 常驻占显存。建议低显存环境开启（默认 true）。', defaultValue: true, visibleWhen: all(when('enable_preview', true), when('preview_device', 'gpu')) },
  { key: 'sample_every', type: 'number', label: '每 N 步采样（后端 sample_every）', title: 'sample_every', desc: '后端主频率键：每 N 步生成预览（与 sample_every_n_steps 同义的主入口）。推荐范围：二选一填写。', defaultValue: 0, min: 0, visibleWhen: when('enable_preview', true) },
  { key: 'sample_every_n_epochs', type: 'number', label: '每 N 轮生成预览', title: 'sample_every_n_epochs', desc: '每 N 轮生成一次预览。推荐范围：1（小数据集）～4；0 关闭按轮采样。', defaultValue: '', min: 1, visibleWhen: when('enable_preview', true) },
  { key: 'sample_every_n_steps', type: 'number', label: '每 N 步生成预览', title: 'sample_every_n_steps', desc: '每 N 步生成一次预览，比按轮更细。推荐范围：200–1000；0 关闭。', defaultValue: '', min: 1, visibleWhen: when('enable_preview', true) },
  { key: 'sample_at_first', type: 'boolean', label: '训练前先生成预览', title: 'sample_at_first', desc: '训练开始前先生成一张预览确认提示词效果。建议新任务首次开启检查模板正确性。', defaultValue: false, visibleWhen: when('enable_preview', true) },
      { key: 'positive_prompts', type: 'textarea', label: '正向提示词', title: 'positive_prompts', desc: '正向提示词', defaultValue: 'masterpiece, best quality, 1girl, solo', visibleWhen: when('enable_preview', true) },
  { key: 'negative_prompts', type: 'textarea', label: '反向提示词', title: 'negative_prompts', desc: '反向提示词', defaultValue: 'lowres, bad anatomy, bad hands, text, error', visibleWhen: when('enable_preview', true) },
  { key: 'sample_prompts', type: 'textarea', label: '采样提示词列表（sample_prompts）', title: 'sample_prompts', desc: '预览提示词列表（每行一条，支持参数后缀）。建议覆盖典型场景+触发词组合各写一条。', defaultValue: 'masterpiece, best quality', visibleWhen: when('enable_preview', true) },
  { key: 'sample_negative', type: 'textarea', label: '采样反向提示词（sample_negative）', title: 'sample_negative', desc: '预览用负向提示词。建议放通用质量词即可，与最终使用场景保持一致。', defaultValue: '', visibleWhen: when('enable_preview', true) },
  { key: 'preview_groups', type: 'preview_groups', label: '预览测试组', title: 'preview_groups', desc: '可添加多组预览，并为每组单独设置 seed、LoRA', defaultValue: [], visibleWhen: when('enable_preview', true) },
  { key: 'sample_width', type: 'number', label: '预览图宽度', title: 'sample_width', desc: '预览图宽度（px，64 倍数）。推荐范围：与训练分辨率一致或减半提速。', defaultValue: 512, min: 64, visibleWhen: when('enable_preview', true) },
  { key: 'sample_height', type: 'number', label: '预览图高度', title: 'sample_height', desc: '预览图高度。推荐范围：与宽度同规则。', defaultValue: 512, min: 64, visibleWhen: when('enable_preview', true) },
  { key: 'sample_cfg', type: 'number', label: 'CFG 系数', title: 'sample_cfg', desc: '预览 CFG 强度。推荐范围：7（默认）附近；LCM 类 1–2。', defaultValue: 7, min: 1, max: 30, visibleWhen: when('enable_preview', true) },
  { key: 'sample_steps', type: 'number', label: '采样步数', title: 'sample_steps', desc: '预览采样步数。推荐范围：24（默认）附近；仅影响预览速度与质量。', defaultValue: 24, min: 1, max: 300, visibleWhen: when('enable_preview', true) },
  { key: 'sample_seed', type: 'number', label: '预览图种子', title: 'sample_seed', desc: '预览随机种子：固定可横向对比不同 step 的效果。推荐范围：固定一个值；0 每次随机。', defaultValue: '', min: 0, visibleWhen: when('enable_preview', true) },
  { key: 'sample_sampler', type: 'select', label: '采样器', title: 'sample_sampler', desc: '预览采样器（canonical 命名，旧名为运行时别名）。建议 euler_a 快速看趋势，karras 系看细节。', defaultValue: 'euler_a', options: SAMPLE_SAMPLER_OPTIONS, visibleWhen: when('enable_preview', true) },
  // 训练中预览求解器（configs_monitoring.py:123-124 / web_training_config.py:141-142）：
  // sde=ER-SDE-Solver-3 带退火随机项（默认）；ode=确定性 Euler。eta 缩放随机项强度，
  // eta=0 时两条路径逐位一致。
  { key: 'sample_algorithm', type: 'select', label: '预览求解器', title: 'sample_algorithm', desc: '训练中预览的求解算法：sde 走 ER-SDE-Solver-3 并带退火随机项（默认）；ode 为确定性 Euler 路径，无随机项。建议 sde（默认）；想排除随机性做逐步对照时切 ode 并把 SDE eta 设 0。', defaultValue: 'sde', options: [
    { value: 'sde', label: 'sde（ER-SDE-Solver-3，默认）' },
    { value: 'ode', label: 'ode（确定性 Euler）' },
  ], visibleWhen: when('enable_preview', true) },
  { key: 'sample_sde_eta', type: 'number', label: 'SDE 随机项强度 (eta)', title: 'sample_sde_eta', desc: '缩放 sde 求解器的随机项强度：1.0 为后端默认；eta=0 时与 ode 路径完全一致（可做 A/B 对照）。推荐范围：0–1；>1 会明显放大预览噪声，仅实验用。', defaultValue: 1.0, min: 0, step: 0.05, visibleWhen: all(when('enable_preview', true), when('sample_algorithm', 'sde')) },
  { key: 'sample_scheduler', type: 'string', label: '采样调度器覆盖（sample_scheduler）', title: 'sample_scheduler', desc: '预览调度器选择。建议留空跟随模型默认。', defaultValue: '', visibleWhen: when('enable_preview', true) }
];

export const S_QUALITY_EVAL = [
  { key: 'quality_evaluation_enabled', type: 'boolean', label: '训练结束质量评估', title: 'quality_evaluation_enabled', desc: '训练结束后跑 FID/CLIP Score 等指标评估。建议重要批次开启做横向比较。', defaultValue: false },
  { key: 'quality_evaluation_xy_grid', type: 'boolean', label: '生成质量评估 XY 网格', title: 'quality_evaluation_xy_grid', desc: '生成 XY 网格图（如权重×种子矩阵）直观对比。建议调参阶段开启。', defaultValue: false, visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_num_samples', type: 'number', label: '评估采样数', title: 'quality_evaluation_num_samples', desc: '评估生成样本数。推荐范围：10–64；越多越稳越慢。', defaultValue: 10, min: 1, max: 64, visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_suite_id', type: 'string', label: '验证套件 ID', title: 'quality_evaluation_suite_id', desc: '评估套件 ID（预设的指标/提示词组合）。建议先用默认套件。', defaultValue: 'default', visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_validation_seeds', type: 'string', label: '固定验证 Seeds', title: 'quality_evaluation_validation_seeds', desc: '评估种子列表，保证可比性。建议固定一组种子复用。', defaultValue: '', visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_compare_base', type: 'boolean', label: '对比基础模型', title: 'quality_evaluation_compare_base', desc: '用 LoRA 权重 0 与 1 的成对样本生成增量证据。建议开启以区分底模贡献。', defaultValue: true, visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_metric_weights', type: 'textarea', label: '多目标指标权重', title: 'quality_evaluation_metric_weights', desc: '多指标合成总分时的权重表。建议留空等权，有明确偏好再调。', defaultValue: '', visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_metrics', type: 'string', label: '评估指标', title: 'quality_evaluation_metrics', desc: '评估指标集合选择（FID/CLIP 等）。建议 FID+CLIP 双指标互补。', defaultValue: 'fid,clip_score', visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'quality_evaluation_validation_prompts', type: 'textarea', label: '评估 / XY 提示词', title: 'quality_evaluation_validation_prompts', desc: '评估用验证提示词集。建议覆盖核心概念+易翻车场景。', defaultValue: '', visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'fid_real_image_dir', type: 'folder', pickerType: 'folder', label: 'FID 真图目录', title: 'fid_real_image_dir', desc: 'FID 计算用的真实参考图目录。建议与训练数据分布一致的独立目录。', defaultValue: '', visibleWhen: when('quality_evaluation_enabled', true) },
  // Preference scorers (PickScore / ImageReward / HPSv2) — default-off product thin seam
  { key: 'preference_scoring_enabled', type: 'boolean', label: '偏好对齐评分', title: 'preference_scoring_enabled', desc: '训练后用 PickScore / ImageReward / HPSv2 对生成图打偏好分。权重较重，默认关；需先开启质量评估。', defaultValue: false, visibleWhen: when('quality_evaluation_enabled', true) },
  { key: 'preference_models', type: 'string', label: '偏好评分模型', title: 'preference_models', desc: '逗号分隔：pickscore,imagereward,hpsv2。空=仅 pickscore。模型缺失时记 skipped，不静默当 0 分成功。', defaultValue: 'pickscore', visibleWhen: when('preference_scoring_enabled', true) }
];

export const S_STAGED_RESOLUTION = [
  { key: 'enable_mixed_resolution_training', type: 'boolean', label: '启用阶段分辨率训练', title: 'enable_mixed_resolution_training', desc: '阶段分辨率训练（仅 SDXL）：低分辨率热身高分辨率收尾。建议长训提质时开启。', defaultValue: false },
  { key: 'staged_resolution_ratio_512', type: 'number', label: '512 阶段占比 (%)', title: 'staged_resolution_ratio_512', desc: '阶段分辨率训练中 512 档样本占比 %（最大边不足时忽略该档）。推荐范围：五档合计 100，512 档给 20 左右。', defaultValue: 20, min: 0, max: 100, step: 1, visibleWhen: when('enable_mixed_resolution_training', true) },
  { key: 'staged_resolution_ratio_768', type: 'number', label: '768 阶段占比 (%)', title: 'staged_resolution_ratio_768', desc: '768 档占比 %（最大边不足时忽略该档）。推荐范围：30 左右。', defaultValue: 30, min: 0, max: 100, step: 1, visibleWhen: when('enable_mixed_resolution_training', true) },
  { key: 'staged_resolution_ratio_1024', type: 'number', label: '1024 阶段占比 (%)', title: 'staged_resolution_ratio_1024', desc: '1024 档占比 %（两种基准管线都会用到）。推荐范围：50 左右为主力档。', defaultValue: 50, min: 0, max: 100, step: 1, visibleWhen: when('enable_mixed_resolution_training', true) },
  { key: 'staged_resolution_ratio_1536', type: 'number', label: '1536 阶段占比 (%)', title: 'staged_resolution_ratio_1536', desc: '1536 档占比 %（仅 2048 基准管线用到）。推荐范围：30 以内。', defaultValue: 30, min: 0, max: 100, step: 1, visibleWhen: when('enable_mixed_resolution_training', true) },
  { key: 'staged_resolution_ratio_2048', type: 'number', label: '2048 阶段占比 (%)', title: 'staged_resolution_ratio_2048', desc: '2048 档占比 %（仅 2048 基准管线用到）。推荐范围：50 以内，显存吃紧再调低。', defaultValue: 50, min: 0, max: 100, step: 1, visibleWhen: when('enable_mixed_resolution_training', true) }
];

// 全局周期 reclaim（optimizer step 边界；0=关）。与 cuda_cache_release_strategy 正交。
// 必须定义在 S_SPEED_* 之前（const 不可后引用）。
export const S_MEMORY_RECLAIM = [
  { key: 'memory_reclaim_interval_steps', type: 'number', label: '周期显存回收间隔', title: 'memory_reclaim_interval_steps', desc: '每 N 个优化步做一次 gc+empty_cache 回收碎片。推荐范围：0 关闭；频繁 OOM 给 50–200，过密拖慢训练。', defaultValue: 0, min: 0 },
  { key: 'memory_reclaim_ipc_collect', type: 'boolean', label: '回收时 IPC collect', title: 'memory_reclaim_ipc_collect', desc: 'reclaim 时尝试 cuda.ipc_collect。默认开启。', defaultValue: true, visibleWhen: (c) => Number(c.memory_reclaim_interval_steps || 0) > 0 },
  { key: 'memory_reclaim_on_circuit_open', type: 'boolean', label: '熔断时强制回收', title: 'memory_reclaim_on_circuit_open', desc: 'GPU 硬件熔断 OPEN 时额外强制 reclaim 一次。默认开启。', defaultValue: true }
];

const TRAINING_VRAM_TIER_GB = [6, 8, 12, 16, 24, 32];
const TRAINING_VRAM_MINIMUM_BY_FAMILY = { anima: 6, krea2: 12, minimax_h3: 8, flux2: 16, sd3: 24, boogu: 16, zimage: 16, wan22: 6, ltx23: 6 };
function trainingVramFamily(config = {}) {
  const route = String(config.model_train_type || config.training_type || config.schema_id || '').trim().toLowerCase().replaceAll('-', '_');
  if (route.includes('minimax') || route.includes('h3')) return 'minimax_h3';
  if (route.includes('krea')) return 'krea2';
  if (route.includes('flux2')) return 'flux2';
  if (route.includes('sd3')) return 'sd3';
  if (route.includes('boogu')) return 'boogu';
  if (route.includes('zimage') || route.includes('z_image')) return 'zimage';
  if (route.includes('wan')) return 'wan22';
  if (route.includes('ltx')) return 'ltx23';
  if (route.includes('anima')) return 'anima';
  return '';
}
export function trainingVramProfileOptions(config = {}) {
  const minimum = TRAINING_VRAM_MINIMUM_BY_FAMILY[trainingVramFamily(config)];
  const unavailable = !minimum;
  const reason = unavailable ? '该模型尚未接入训练显存档位' : `该模型当前最低从 ${minimum} GB 开始，低档没有可信训练证据`;
  return [{ value: 'off', label: '关闭' }, { value: 'auto', label: '自动', disabled: unavailable, disabledReason: reason }, ...TRAINING_VRAM_TIER_GB.map((size) => ({ value: `${size}g`, label: `${size} GB${minimum && size === minimum ? '（当前最低）' : ''}`, disabled: unavailable || size < minimum, disabledReason: reason }))];
}
export const TRAINING_VRAM_PROFILE_FIELD = {
  key: 'training_vram_profile',
  type: 'select',
  label: '训练显存档位',
  title: 'training_vram_profile',
  desc: '向提交端声明目标显存档位；是否兑现由后端按家族与实测证据决定，不代表承诺。建议保守选择实际显存档。',
  defaultValue: 'off',
  options: trainingVramProfileOptions,
};

export const TRAINING_VRAM_PROFILE_HIDDEN_FIELDS = [
  { key: 'training_vram_profile_control', type: 'hidden', defaultValue: 'managed' },
  { key: 'detected_vram_gb', type: 'hidden', defaultValue: 0 },
];

// GPU 硬件熔断（温度/VRAM%/throttle/ECC）；与 duty/cooldown 热管理及 SafeGuard loss 门正交；default-off。
export const S_GPU_CIRCUIT = [
  { key: 'gpu_circuit_enabled', type: 'boolean', label: '启用 GPU 硬件熔断', title: 'gpu_circuit_enabled', desc: '按温度/显存占用/throttle/ECC 建议 STOP（checkpoint 友好）。无 NVML 时自动降级 no-op。', defaultValue: false },
  { key: 'gpu_circuit_poll_interval_steps', type: 'number', label: '熔断轮询间隔(步)', title: 'gpu_circuit_poll_interval_steps', desc: '每 N 步轮询一次 GPU 健康。推荐范围： 10（默认）。', defaultValue: 10, min: 1, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_temp_c', type: 'number', label: '熔断温度(℃)', title: 'gpu_circuit_temp_c', desc: '达到该温度硬熔断（OPEN）。0 关闭温度硬断。推荐范围：过热史机器给 85。', defaultValue: 0, min: 0, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_temp_warn_c', type: 'number', label: '温度警告带(℃)', title: 'gpu_circuit_temp_warn_c', desc: '硬阈之下的警告带温度；0 关闭警告。推荐范围：比硬阈低 5–10℃。', defaultValue: 0, min: 0, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_vram_util_pct', type: 'number', label: '显存占用熔断(%)', title: 'gpu_circuit_vram_util_pct', desc: '显存占用达到该百分比熔断（0 关闭）。推荐范围： 98 防雪崩 OOM。', defaultValue: 0, min: 0, max: 100, step: 1, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_trip_on_throttle', type: 'boolean', label: 'Throttle 时熔断', title: 'gpu_circuit_trip_on_throttle', desc: '检测到 critical throttle 即熔断。建议长期高温环境开启。', defaultValue: true, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_trip_on_ecc', type: 'boolean', label: 'ECC 未纠正时熔断', title: 'gpu_circuit_trip_on_ecc', desc: '检测到 ECC 未纠正错误增量立即熔断。建议数据安全优先时保持 true。', defaultValue: true, visibleWhen: when('gpu_circuit_enabled', true) },
  { key: 'gpu_circuit_device_index', type: 'number', label: '熔断设备索引', title: 'gpu_circuit_device_index', desc: '熔断监控轮询的 GPU 索引（NVML 序号）。推荐范围：单卡保持 0。', defaultValue: 0, min: 0, visibleWhen: when('gpu_circuit_enabled', true) }
];

// 缓存管线（后端语义属数据管线缓存；从速度页拆出独立成卡，SDXL 系排版示范）。
export const S_CACHE_PIPELINE = [
  { key: 'cache_latents', type: 'boolean', label: '缓存 Latent', title: 'cache_latents', desc: '缓存 VAE latent 避免每步重复编码，大幅提速。建议除在线增强需求外保持开启（默认 true）。', defaultValue: true },
  { key: 'cache_latents_to_disk', type: 'boolean', label: '缓存 Latent 到磁盘', title: 'cache_latents_to_disk', desc: 'latent 持久化到磁盘跨 run 复用（首次慢后续快）。建议数据集稳定且磁盘够快时开启；开了就不能用颜色类在线增强。', defaultValue: false },
  { key: 'latent_cache_disk_format', type: 'select', label: 'Latent 缓存格式', title: 'latent_cache_disk_format', desc: 'latent 磁盘缓存容器格式（npz 等）。建议 npz 兼容性最好。', defaultValue: 'npz', options: ['safetensors', 'npz'] },
  { key: 'latent_cache_disk_dtype', type: 'select', label: 'Latent 缓存精度', title: 'latent_cache_disk_dtype', desc: 'latent 落盘精度。fp16 体积减半且质量损失可忽略。建议 fp16。', defaultValue: 'fp16', options: ['auto', 'fp16', 'bf16', 'fp32'], visibleWhen: when('cache_latents_to_disk', true) },
  { key: 'cache_text_encoder_outputs', type: 'boolean', label: '缓存文本编码器输出', title: 'cache_text_encoder_outputs', desc: '缓存文本编码器输出，显著省显存——但 TE 不再参与训练。建议 TE 冻结场景开启；要训 TE 必须关闭。', defaultValue: false },
  { key: 'cache_text_encoder_outputs_to_disk', type: 'boolean', label: '缓存文本编码器输出到磁盘', title: 'cache_text_encoder_outputs_to_disk', desc: 'TE 输出持久化到磁盘跨 run 复用。建议 caption 固定时开启，改动 caption 需重建缓存。', defaultValue: false },
  { key: 'text_encoder_outputs_cache_disk_format', type: 'select', label: '文本缓存格式', title: 'text_encoder_outputs_cache_disk_format', desc: 'TE 输出磁盘缓存格式。建议 npz。', defaultValue: 'npz', options: ['safetensors', 'npz'], visibleWhen: when('cache_text_encoder_outputs_to_disk', true) },
  { key: 'text_encoder_outputs_cache_dtype', type: 'select', label: '文本缓存精度', title: 'text_encoder_outputs_cache_dtype', desc: '内存中 TE 缓存精度。建议 fp16；数值异常时回 float32。', defaultValue: 'fp16', options: ['auto', 'fp16', 'bf16', 'fp32'], visibleWhen: when('cache_text_encoder_outputs_to_disk', true) },
];

const WEIGHT_COMPRESSION_ACTIVE = (c) => {
  const preset = String(c.weight_compression_preset || 'off').trim().toLowerCase();
  return preset !== 'off' || c.weight_compression_enabled === true;
};

export const S_SPEED_SDXL = [
  { key: 'acceleration_profile', type: 'select', label: '模型加速档位', title: 'acceleration_profile', desc: '按当前模型族做加速预检与档位建议', defaultValue: 'off', options: ACCELERATION_PROFILE_OPTIONS },
  TRAINING_VRAM_PROFILE_FIELD,
  ...TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
  // (separator for TypeScript parser)
  { key: 'mixed_precision', type: 'select', label: '混合精度', title: 'mixed_precision', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', defaultValue: 'bf16', options: ['no', 'fp16', 'bf16'] },
  // Attention 默认跟随 launcher runtime（auto）；布尔开关仅高级/专家覆盖，避免 schema 默认 sdpa 污染。
  { key: 'xformers', type: 'boolean', label: '启用 xformers', title: 'xformers', desc: '强制 xformers 内存高效注意力（高级覆盖）。建议默认关闭，旧卡兜底用。', defaultValue: false, requiresAttentionBackend: 'xformers', visibleWhen: when('performance_expert_mode', true) },
  { key: 'sdpa', type: 'boolean', label: '启用 SDPA', title: 'sdpa', desc: '强制 PyTorch SDPA 注意力（高级覆盖）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'sageattn', type: 'boolean', label: '启用 SageAttention', title: 'sageattn', desc: '强制 SageAttention（高级覆盖）。建议默认关闭跟随启动环境，确认库可用后再强制。', defaultValue: false, requiresAttentionBackend: 'sageattn', visibleWhen: when('performance_expert_mode', true) },
  { key: 'experimental_attention_profile_enabled', type: 'boolean', label: 'Sliding Window Attention', title: 'experimental_attention_profile_enabled', desc: '把注意力限制在滑动窗口内以降低长序列开销；关闭时为完整注意力。不是耗时统计开关。', defaultValue: false },
  { key: 'experimental_attention_profile_window', type: 'number', label: '窗口大小 (token)', title: 'experimental_attention_profile_window', desc: '窗口注意力的每 token 历史窗口长度（token 数非步数）；0 表示完整注意力。推荐范围： 50–100 起步。', defaultValue: 50, min: 1, visibleWhen: when('experimental_attention_profile_enabled', true) },
  { key: 'flashattn', type: 'boolean', label: '启用 FlashAttention 2', title: 'flashattn', desc: '强制 FlashAttention 2（高级覆盖）。建议默认关闭跟随环境；长序列提速明显但需库支持。', defaultValue: false, requiresAttentionBackend: 'flash2', visibleWhen: when('performance_expert_mode', true) },
  { key: 'cross_attn_fused_kv', type: 'boolean', label: '启用 Fused K/V', title: 'cross_attn_fused_kv', desc: '启用 SDXL cross-attn 的 fused K/V 投影内核提速。建议验证过稳定性后开启。', defaultValue: false },
  { key: 'fused_projection_memory_mode', type: 'select', label: 'Fused Projection 显存模式', title: 'fused_projection_memory_mode', desc: '融合投影权重的显存模式：keep_original 最兼容。建议 keep_original。', defaultValue: 'keep_original', options: FUSED_PROJECTION_MEMORY_MODE_OPTIONS, visibleWhen: all(when('performance_expert_mode', true), when('cross_attn_fused_kv', true)) },
  { key: 'mem_eff_attn', type: 'boolean', label: '低显存注意力', title: 'mem_eff_attn', desc: '强制省显存 attention（比 xformers 更保守的实现）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'lowram', type: 'boolean', label: '低内存模式', title: 'lowram', desc: '低内存模式：权重直接装进显存避免系统内存镜像。建议小内存机器开，配合 mmap 禁用。', defaultValue: false },
  // 缓存族已拆到独立 cache-settings 卡（数据管线语义），见 S_CACHE_PIPELINE。
  { key: 'te_vae_offload_strategy', type: 'select', label: 'TE/VAE Offload 策略', title: 'te_vae_offload_strategy', desc: 'TE/VAE 在训练生命周期中的上卡策略：phase 分阶段驻留为默认。建议 phase。', defaultValue: 'phase', options: ['phase', 'aggressive', 'resident'] },
  { key: 'cuda_cache_release_strategy', type: 'select', label: 'CUDA 缓存释放策略', title: 'cuda_cache_release_strategy', desc: 'CUDA 缓存释放策略：oom_only 仅在 OOM 恢复时释放（推荐）；aggressive 每步释放拖慢训练；off 关闭。', defaultValue: 'oom_only', options: [
    { value: 'off', label: '关闭' },
    { value: 'oom_only', label: '仅 OOM 恢复' },
    { value: 'phase_boundary', label: '阶段边界' },
    { value: 'after_optimizer', label: '优化器后释放' },
    { value: 'aggressive', label: '激进低显存' }
  ] },
  { key: 'cuda_cache_release_interval', type: 'number', label: '缓存释放间隔', title: 'cuda_cache_release_interval', desc: '允许一次缓存释放的最小间隔（优化 step 数）。推荐范围：1（默认）；调大减少抖动。', defaultValue: 1, min: 1, visibleWhen: (c) => c.cuda_cache_release_strategy && c.cuda_cache_release_strategy !== 'off' },
  ...S_MEMORY_RECLAIM,
  // (separator for TypeScript parser)
  { key: 'model_to_condition_enabled', type: 'boolean', label: 'ModelToCondition', title: 'model_to_condition_enabled', desc: '启用共享条件生成协议（ModelToCondition）。建议相关管线要求时开启。', defaultValue: true },
  { key: 'sdxl_unet_backend', type: 'select', label: 'SDXL U-Net 后端', title: 'sdxl_unet_backend', desc: 'SDXL U-Net 执行后端：diffusers 稳定默认；备选路线性能实验用。建议 diffusers。', defaultValue: 'diffusers', options: ['diffusers', 'native_shadow', 'native_proxy', 'native_skeleton', 'lulynx_native'] },
  { key: 'lulynx_weight_residency', type: 'select', label: 'Layer-level Residency', title: 'lulynx_weight_residency', desc: 'SDXL 冻结底座的层级驻留策略。resident 全常驻最快；非 resident 省 VRAM 换 IO。建议显存充足保持 resident。', defaultValue: 'resident', options: [
    { value: 'resident', label: '常驻 GPU' },
    { value: 'linear_cpu_pinned', label: 'Linear CPU pinned（省显存）' },
    { value: 'linear_conv_cpu_pinned', label: 'Linear + Conv2d CPU pinned（最省显存）' }
  ], visibleWhen: when('sdxl_unet_backend', 'lulynx_native') },
  { key: 'lulynx_weight_residency_min_params', type: 'number', label: 'Residency 最小参数量', title: 'lulynx_weight_residency_min_params', desc: '只托管参数量达标的 Linear/Conv2d。推荐范围：0 默认。', defaultValue: 0, min: 0, visibleWhen: all(when('sdxl_unet_backend', 'lulynx_native'), (c) => c.lulynx_weight_residency && c.lulynx_weight_residency !== 'resident') },
  { ...PCIE_TRANSFER_FORMAT_FIELD, visibleWhen: all(when('sdxl_unet_backend', 'lulynx_native'), (c) => c.lulynx_weight_residency && c.lulynx_weight_residency !== 'resident') },
  ...vortexRuntimeFields('lulynx_weight_residency', when('sdxl_unet_backend', 'lulynx_native')),
  { ...pcieDeltaCacheField('lulynx_weight_residency'), visibleWhen: all(when('sdxl_unet_backend', 'lulynx_native'), (c) => c.lulynx_weight_residency && c.lulynx_weight_residency !== 'resident') },
  ...pcieDeltaCacheModeFields('lulynx_weight_residency'),
  { key: 'lulynx_precision_swap_enabled', type: 'boolean', label: 'Lulynx Precision Swap', title: 'lulynx_precision_swap_enabled', desc: 'Lulynx 精准交换规划兼容层：按层调度换入换出。建议与其他交换方案二选一，勿叠加。', defaultValue: false },
  { key: 'lulynx_precision_swap_strategy', type: 'select', label: 'Precision Swap 策略', title: 'lulynx_precision_swap_strategy', desc: '精准交换的策略名。建议保持默认 standard。', defaultValue: 'balanced', options: ['balanced', 'aggressive', 'off'], visibleWhen: when('lulynx_precision_swap_enabled', true) },
  // 通用 block 交换数量（performance_fragments:183-187；swap_granularity 的数量兜底）。
  { key: 'blocks_to_swap', type: 'number', label: 'Block 交换数量', title: 'blocks_to_swap', desc: '将 N 个 U-Net/DiT block 卸载到 CPU（0=关闭）。推荐范围：DiT 28–48 层模型从 8–16 起步，每加一档省约一层显存换一点速度。', defaultValue: 0, min: 0, max: 28, step: 1 },
  { key: 'full_fp16', type: 'boolean', label: '完全 FP16', title: 'full_fp16', desc: '完全 FP16 训练（含主权重），省显存但易溢出出 NaN。建议仅老卡且明确需要时开，日常保持关闭。', defaultValue: false },
  { key: 'full_bf16', type: 'boolean', label: '完全 BF16', title: 'full_bf16', desc: '完全 BF16 训练（含主权重），比 fp16 稳但略损精度。建议 30 系以上显卡且显存吃紧时才开。', defaultValue: false },
  // 冻结底座压缩（training_field_performance_fragments.py:118-158；configs_performance 消费）。
  { key: 'weight_compression_preset', type: 'select', label: '权重压缩预设', title: 'weight_compression_preset', desc: '一键压缩预设（自动挑格式/目标/校验）。建议不确定时从预设起步再手动细化。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'stable_backbone_int8', label: '骨干 INT8（运行时压缩）' },
    { value: 'aggressive_backbone_uint4', label: '骨干 UINT4（更省显存，需 torchao）' },
    { value: 'experimental_float8', label: '主干 FP8（RTX 40 系）' },
    { value: 'text_encoder_int8', label: '文本编码器 INT8（需文本编码器冻结）' },
    { value: 'both_int8', label: '主干+文本编码器 INT8' }
  ] },
  { key: 'weight_compression_enabled', type: 'boolean', label: '手动启用权重压缩', title: 'weight_compression_enabled', desc: '手动启用权重压缩（不走预设时的高级入口）。建议直接选上方预设即可，此项留给精确控制场景。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'weight_compression_target', type: 'select', label: '压缩目标', title: 'weight_compression_target', desc: '压缩目标范围：backbone 仅主干 / text_encoder 仅 TE / both 全部。建议 backbone 优先保 TE 精度。', defaultValue: 'none', options: [
    { value: 'none', label: 'none' },
    { value: 'backbone', label: 'backbone（主干）' },
    { value: 'text_encoder', label: 'text_encoder' },
    { value: 'both', label: 'both' }
  ], visibleWhen: (c) => WEIGHT_COMPRESSION_ACTIVE(c) && c.performance_expert_mode === true },
  { key: 'weight_compression_format', type: 'select', label: '压缩格式', title: 'weight_compression_format', desc: '压缩格式：fp8_e4m3 原生稳定路径（推荐）；torchao/quanto 需要对应运行库支持。', defaultValue: 'fp8_e4m3', options: [
    { value: 'fp8_e4m3', label: 'fp8_e4m3' },
    { value: 'torchao_int8', label: 'torchao_int8' },
    { value: 'torchao_uint4', label: 'torchao_uint4' },
    { value: 'torchao_float8', label: 'torchao_float8' },
    { value: 'quanto_int8', label: 'quanto_int8' },
    { value: 'quanto_float8', label: 'quanto_float8' }
  ], visibleWhen: (c) => WEIGHT_COMPRESSION_ACTIVE(c) && c.performance_expert_mode === true },
  { key: 'weight_compression_verify', type: 'boolean', label: '压缩能力探测', title: 'weight_compression_verify', desc: '压缩后做数值校验（重建误差抽查）。建议首次对某底模启用压缩时开启。', defaultValue: true, visibleWhen: (c) => WEIGHT_COMPRESSION_ACTIVE(c) && c.performance_expert_mode === true },
  // SDPA 后端策略（performance_fragments:110-117；attention_runtime_profile.py 消费）。
  { key: 'sdpa_backend_policy', type: 'select', label: 'SDPA 后端策略', title: 'sdpa_backend_policy', desc: 'SDPA 内部后端策略（cutlass/flash/mem_efficient），仅当解析为 SDPA 时生效。建议 cutlass 默认。', defaultValue: 'cutlass', options: [
    { value: 'cutlass', label: 'cutlass（EffiAttn）' },
    { value: 'flash', label: 'flash' },
    { value: 'cudnn', label: 'cudnn' },
    { value: 'math', label: 'math' },
    { value: 'auto', label: 'auto' }
  ], visibleWhen: when('performance_expert_mode', true) },
  // 旧 FP8 加载路径；新配置推荐用上方权重压缩预设。
  { key: 'fp8_base', type: 'boolean', label: '基础模型 FP8（旧）', title: 'fp8_base', desc: '以 FP8 加载冻结基座省一半底模显存。旧入口：新配置建议改用「权重压缩预设」。推荐范围：24G 下训 SDXL 大 rank 或 Anima 时开启。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'no_half_vae', type: 'boolean', label: '不使用半精度 VAE', title: 'no_half_vae', desc: '强制 VAE 用 FP32，修复某些 VAE 半精度发灰/NaN。建议出图异常时开启排查。', defaultValue: false },
  { key: 'persistent_data_loader_workers', type: 'boolean', label: '保持数据加载器', title: 'persistent_data_loader_workers', desc: 'epoch 间保留 worker 进程避免重启开销。建议数据集较大时保持开启（默认 true）。', defaultValue: true },
  { key: 'vae_batch_size', type: 'number', label: 'VAE 编码批量', title: 'vae_batch_size', desc: 'VAE 缓存编码批量；0 自动。推荐范围：4–16，OOM 时减半。', defaultValue: '', min: 1 },
  { key: 'vram_swap_to_ram', type: 'boolean', label: 'VRAM Swap to RAM', title: 'vram_swap_to_ram', desc: '让原生 LoRA/LoRA-FA/T-LoRA/VeRA 的可训权重驻留内存按需上卡。建议优化器状态爆显存时试验。', defaultValue: false },
  { key: 'cpu_offload_checkpointing', type: 'boolean', label: 'CPU 卸载检查点', title: 'cpu_offload_checkpointing', desc: '梯度检查点时把部分张量卸载到 CPU，进一步省显存但更慢。建议极端显存场景才开。', defaultValue: false },
  { key: 'swap_granularity', type: 'select', label: '显存交换模式', title: 'swap_granularity', desc: '显存交换模式总开关：选择按 block 还是 layer 粒度把冻结权重在 CPU/GPU 间搬运。建议显存不足先试 block 粒度档位。', defaultValue: 'off', options: ['off', 'auto', 'block', 'merged_block', 'layer'] },
  { key: 'swap_ratio', type: 'slider', label: '显存交换比例', title: 'swap_ratio', desc: '按 block 总数比例决定交换多少（0–1）。推荐范围：0.3–0.5 起步试探，配合水线自动调节。', defaultValue: 0, min: 0, max: 1, step: 0.05, visibleWhen: swapEnabled },
  { key: 'swap_count', type: 'number', label: '显存交换数量', title: 'swap_count', desc: '绝对交换数量，大于 0 时优先于比例。推荐范围： 0 用比例控制，精确控卡时才给具体数。', defaultValue: 0, min: 0, visibleWhen: swapEnabled },
  { key: 'block_merge_size', type: 'number', label: '合并 Block 大小', title: 'block_merge_size', desc: 'merged_block 模式下每组包含的相邻 block 数（不跨组边界）。推荐范围：2（默认）。', defaultValue: 2, min: 2, visibleWhen: when('swap_granularity', 'merged_block') },
  { key: 'block_swap_strategy', type: 'select', label: 'BlockSwap 搬运策略', title: 'block_swap_strategy', desc: 'BlockSwap 搬运策略：auto 由后端按家族解析最优路径。建议保持 auto。', defaultValue: 'auto', options: BLOCK_SWAP_STRATEGY_OPTIONS, visibleWhen: all(swapEnabled, when('performance_expert_mode', true)) },
    ...S_GRADIENT_RELEASE,
  ...S_OPTIMIZER_STATE_PAGING,
  // (separator for TypeScript parser)
  { key: 'pytorch_cuda_expandable_segments', type: 'boolean', label: '显存碎片优化', title: 'pytorch_cuda_expandable_segments', desc: '训练前设置 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True 减少碎片 OOM。建议保持开启（默认 true）。', defaultValue: true }
];
export const S_SPEED_FLOW = [
  { key: 'acceleration_profile', type: 'select', label: '模型加速档位', title: 'acceleration_profile', desc: '按当前模型族做加速预检与档位建议', defaultValue: 'off', options: ACCELERATION_PROFILE_OPTIONS },
  TRAINING_VRAM_PROFILE_FIELD,
  ...TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
  // (separator for TypeScript parser)
  { key: 'mixed_precision', type: 'select', label: '混合精度', title: 'mixed_precision', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', defaultValue: 'bf16', options: ['no', 'fp16', 'bf16'] },
  { key: 'low_vram_autotune_mode', type: 'select', label: 'Triton 低显存调优模式', title: 'low_vram_autotune_mode', desc: 'Triton 低显存自动调优档位。建议默认 off 保持标准行为，显存临界时改 auto。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'conservative', label: '低显存保守模式' }
  ] },
  { key: 'weight_compression_preset', type: 'select', label: '权重压缩预设', title: 'weight_compression_preset', desc: '一键压缩预设（自动挑格式/目标/校验）。建议不确定时从预设起步再手动细化。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'stable_backbone_int8', label: '骨干 INT8（运行时压缩，非 Comfy 导出）' },
    { value: 'experimental_float8', label: '主干 FP8（RTX 40 系）' },
    { value: 'text_encoder_int8', label: '文本编码器 INT8' },
    { value: 'both_int8', label: '主干+文本编码器 INT8' }
  ] },
  { key: 'train_quant_preset', type: 'select', label: '训练量化快捷', title: 'train_quant_preset', desc: '产品糖：映射到 weight_compression_preset。推荐 stable_backbone_int8；off=不改。与 keep_w8 互斥。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'stable_backbone_int8', label: '冻结骨干 INT8' }
  ] },
  { key: 'dit_low_vram_profile', type: 'select', label: 'DiT 低显存档案', title: 'dit_low_vram_profile', desc: 'DiT 低显存档案：映射到既有 block residency/module_offload 组合，不是第三套 offload。建议 off 起步，不足再选档。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭（不改 knobs）' },
    { value: 'balanced', label: '均衡' },
    { value: 'aggressive', label: '激进' }
  ] },
  { key: 'weight_compression_enabled', type: 'boolean', label: '手动启用权重压缩', title: 'weight_compression_enabled', desc: '手动启用权重压缩（不走预设时的高级入口）。建议直接选上方预设即可，此项留给精确控制场景。', defaultValue: false },
  { key: 'weight_compression_target', type: 'select', label: '压缩目标', title: 'weight_compression_target', desc: '压缩目标范围：backbone 仅主干 / text_encoder 仅 TE / both 全部。建议 backbone 优先保 TE 精度。', defaultValue: 'none', options: [
    { value: 'none', label: 'none' },
    { value: 'backbone', label: 'backbone（主干）' },
    { value: 'text_encoder', label: 'text_encoder' },
    { value: 'both', label: 'both' }
  ], visibleWhen: (c) => {
    const preset = String(c.weight_compression_preset || 'off').trim().toLowerCase();
    return preset !== 'off' || c.weight_compression_enabled === true;
  } },
  { key: 'weight_compression_format', type: 'select', label: '压缩格式', title: 'weight_compression_format', desc: '压缩格式：fp8_e4m3 原生稳定路径（推荐）；torchao/quanto 需要对应运行库支持。', defaultValue: 'fp8_e4m3', options: [
    { value: 'fp8_e4m3', label: 'fp8_e4m3' },
    { value: 'torchao_int8', label: 'torchao_int8' },
    { value: 'torchao_uint4', label: 'torchao_uint4' },
    { value: 'torchao_float8', label: 'torchao_float8' },
    { value: 'quanto_int8', label: 'quanto_int8' },
    { value: 'quanto_float8', label: 'quanto_float8' }
  ], visibleWhen: (c) => {
    const preset = String(c.weight_compression_preset || 'off').trim().toLowerCase();
    return preset !== 'off' || c.weight_compression_enabled === true;
  } },
  { key: 'weight_compression_verify', type: 'boolean', label: '压缩能力探测', title: 'weight_compression_verify', desc: '压缩后做数值校验（重建误差抽查）。建议首次对某底模启用压缩时开启。', defaultValue: true, visibleWhen: (c) => {
    const preset = String(c.weight_compression_preset || 'off').trim().toLowerCase();
    return preset !== 'off' || c.weight_compression_enabled === true;
  } },
  // keep_w8 训时路径（与 weight_compression 底座压缩不同；非 lulynx 顶部加速）
  { key: 'quant_train_mode', type: 'boolean', label: '保持 INT8 冻结训练', title: 'quant_train_mode', desc: '关闭（默认）=正常训练：若加载的是量化模型，先反量化再训。开启=主干权重保持 INT8 冻结、仅训高精度 LoRA（省显存，仅对量化模型包有意义）。与 vendor keep_storage（部分 FP8）互斥。', defaultValue: false },
  { key: 'keep_w8_vram_prefer', type: 'boolean', label: 'keep_w8 显存优先', title: 'keep_w8_vram_prefer', desc: '降低训练步峰值显存，训练步通常变慢约 20%–40% 或更多。需先开启「保持 INT8 冻结训练」。', defaultValue: false, visibleWhen: (c) => isKeepW8Mode(c.quant_train_mode) },
  { key: 'quant_train_convrot', type: 'boolean', label: 'keep_w8 ConvRot 真旋转', title: 'quant_train_convrot', desc: 'keep_w8 时对匹配层做真 group-RHT 旋转（与 Comfy convrot 导出一致）。建议需要导出兼容时开启。', defaultValue: false, visibleWhen: (c) => isKeepW8Mode(c.quant_train_mode) },
  { key: 'layer_precision_policy', type: 'select', label: '分层精度策略', title: 'layer_precision_policy', desc: '分层精度策略：保护输入输出/时间调制/Norm 等敏感层。建议 sensitive_bf16 默认。', defaultValue: 'sensitive_bf16', options: ['sensitive_bf16', 'off'] },
  { key: 'layer_precision_default', type: 'select', label: '普通层默认精度', title: 'layer_precision_default', desc: '普通候选层默认格式。建议 int8_convrot 平衡档。', defaultValue: 'int8_convrot', options: ['int8_convrot', 'int8_rowwise', 'fp8_scaled', 'bf16'] },
  { key: 'layer_precision_sensitivity_mode', type: 'select', label: '层敏感度评估', title: 'layer_precision_sensitivity_mode', desc: '层敏感度评估方式：weight 有界重建误差 / activation_geometry 能量聚合 / off。建议 off 起步。', defaultValue: 'off', options: ['off', 'weight', 'activation_geometry'] },
  { key: 'layer_precision_activation_geometry_path', type: 'file', pickerType: 'model-file', label: '激活几何 Artifact', title: 'layer_precision_activation_geometry_path', desc: '只读取聚合 E[x²] 的 native safetensors。', defaultValue: '', visibleWhen: when('layer_precision_sensitivity_mode', 'activation_geometry') },
  { key: 'layer_precision_rules_json', type: 'textarea', label: '分层精度规则 JSON', title: 'layer_precision_rules_json', desc: '按 family/glob/block 分配精度。', defaultValue: '', visibleWhen: when('performance_expert_mode', true) },
  { key: 'layer_precision_overrides_json', type: 'textarea', label: '分层精度强制覆盖 JSON', title: 'layer_precision_overrides_json', desc: '只用于经过 A/B 签字的精确覆盖。', defaultValue: '', visibleWhen: when('performance_expert_mode', true) },
  { key: 'quant_requantize_policy', type: 'select', label: '量化模型再次量化', title: 'quant_requantize_policy', desc: '对已量化模型的再量化策略：avoid 退避防二次量化噪声（默认）。建议 avoid。', defaultValue: 'avoid', options: ['avoid', 'allow'] },
  { key: 'tuneqdm_enabled', type: 'boolean', label: 'TuneQDM 可训练量化 scale', title: 'tuneqdm_enabled', desc: '实验性（ECCV 2024 TuneQDM）：INT8 权重保持冻结，仅把反量化 scale 当作可训练参数；可与 LoRA 叠加，也可单独使用。需先开启「保持 INT8 冻结训练」（keep_w8 底座），否则自动跳过。训练出的 scale 会随 checkpoint 存为 .tuneqdm_scales.safetensors 附属文件。合成验证通过，真机短训质量尚未签字。', defaultValue: false, visibleWhen: (c) => isKeepW8Mode(c.quant_train_mode) },
  { key: 'tuneqdm_warmup_steps', type: 'number', label: 'TuneQDM scale 升温步数', title: 'tuneqdm_warmup_steps', desc: 'scale 参数组 LR 线性升温暖步（0→1 乘子），防初期抖动破坏量化底座；0 不升温。推荐范围： 500（默认）。', defaultValue: 500, min: 0, step: 1, visibleWhen: (c) => isKeepW8Mode(c.quant_train_mode) && c.tuneqdm_enabled === true },
  { key: 'fp8_base', type: 'boolean', label: '基础模型使用 FP8（旧）', title: 'fp8_base', desc: '以 FP8 加载冻结基座省一半底模显存。旧入口：新配置建议改用「权重压缩预设」。推荐范围：24G 下训 SDXL 大 rank 或 Anima 时开启。', defaultValue: false },
  { key: 'sdpa', type: 'boolean', label: '启用 SDPA', title: 'sdpa', desc: '强制 PyTorch SDPA 注意力（高级覆盖）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'sageattn', type: 'boolean', label: '启用 SageAttention', title: 'sageattn', desc: '强制 SageAttention（高级覆盖）。建议默认关闭跟随启动环境，确认库可用后再强制。', defaultValue: false, requiresAttentionBackend: 'sageattn', visibleWhen: when('performance_expert_mode', true) },
  { key: 'experimental_attention_profile_enabled', type: 'boolean', label: 'Sliding Window Attention', title: 'experimental_attention_profile_enabled', desc: '把注意力限制在滑动窗口内以降低长序列开销；关闭时为完整注意力。不是耗时统计开关。', defaultValue: false },
  { key: 'experimental_attention_profile_window', type: 'number', label: '窗口大小 (token)', title: 'experimental_attention_profile_window', desc: '窗口注意力的每 token 历史窗口长度（token 数非步数）；0 表示完整注意力。推荐范围： 50–100 起步。', defaultValue: 50, min: 1, visibleWhen: when('experimental_attention_profile_enabled', true) },
  { key: 'flashattn', type: 'boolean', label: '启用 FlashAttention 2', title: 'flashattn', desc: '强制 FlashAttention 2（高级覆盖）。建议默认关闭跟随环境；长序列提速明显但需库支持。', defaultValue: false, requiresAttentionBackend: 'flash2', visibleWhen: when('performance_expert_mode', true) },
  { key: 'mem_eff_attn', type: 'boolean', label: '低显存注意力', title: 'mem_eff_attn', desc: '强制省显存 attention（比 xformers 更保守的实现）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'lowram', type: 'boolean', label: '低内存模式', title: 'lowram', desc: '低内存模式：权重直接装进显存避免系统内存镜像。建议小内存机器开，配合 mmap 禁用。', defaultValue: false },
  { key: 'cache_latents', type: 'boolean', label: '缓存 Latent', title: 'cache_latents', desc: '缓存 VAE latent 避免每步重复编码，大幅提速。建议除在线增强需求外保持开启（默认 true）。', defaultValue: true },
  { key: 'cache_latents_to_disk', type: 'boolean', label: '缓存 Latent 到磁盘', title: 'cache_latents_to_disk', desc: 'latent 持久化到磁盘跨 run 复用（首次慢后续快）。建议数据集稳定且磁盘够快时开启；开了就不能用颜色类在线增强。', defaultValue: false },
  { key: 'latent_cache_disk_format', type: 'select', label: 'Latent 缓存格式', title: 'latent_cache_disk_format', desc: 'latent 磁盘缓存容器格式（npz 等）。建议 npz 兼容性最好。', defaultValue: 'npz', options: ['safetensors', 'npz'] },
  { key: 'latent_cache_disk_dtype', type: 'select', label: 'Latent 缓存精度', title: 'latent_cache_disk_dtype', desc: 'latent 落盘精度。fp16 体积减半且质量损失可忽略。建议 fp16。', defaultValue: 'fp16', options: ['auto', 'fp16', 'bf16', 'fp32'], visibleWhen: when('cache_latents_to_disk', true) },
  { key: 'cache_text_encoder_outputs', type: 'boolean', label: '缓存文本编码器输出', title: 'cache_text_encoder_outputs', desc: '缓存文本编码器输出，显著省显存——但 TE 不再参与训练。建议 TE 冻结场景开启；要训 TE 必须关闭。', defaultValue: false },
  { key: 'cache_text_encoder_outputs_to_disk', type: 'boolean', label: '缓存文本编码器输出到磁盘', title: 'cache_text_encoder_outputs_to_disk', desc: 'TE 输出持久化到磁盘跨 run 复用。建议 caption 固定时开启，改动 caption 需重建缓存。', defaultValue: false },
  { key: 'text_encoder_outputs_cache_disk_format', type: 'select', label: '文本缓存格式', title: 'text_encoder_outputs_cache_disk_format', desc: 'TE 输出磁盘缓存格式。建议 npz。', defaultValue: 'npz', options: ['safetensors', 'npz'], visibleWhen: when('cache_text_encoder_outputs_to_disk', true) },
  { key: 'text_encoder_outputs_cache_dtype', type: 'select', label: '文本缓存精度', title: 'text_encoder_outputs_cache_dtype', desc: '内存中 TE 缓存精度。建议 fp16；数值异常时回 float32。', defaultValue: 'fp16', options: ['auto', 'fp16', 'bf16', 'fp32'], visibleWhen: when('cache_text_encoder_outputs_to_disk', true) },
  { key: 'blocks_to_swap', type: 'number', label: 'Block 交换数', title: 'blocks_to_swap', desc: '将 N 个 U-Net/DiT block 卸载到 CPU（0=关闭）。推荐范围：DiT 28–48 层模型从 8–16 起步，每加一档省约一层显存换一点速度。', defaultValue: '', min: 1 },
  { key: 'fp8_base_unet', type: 'boolean', label: '仅 U-Net FP8', title: 'fp8_base_unet', desc: '仅对 U-Net/DiT 用 FP8（TE 保持高精度）。建议文本绑定重要时选此项而非全模型 FP8。', defaultValue: false },
  { key: 'text_encoder_batch_size', type: 'number', label: '文本编码器缓存批量', title: 'text_encoder_batch_size', desc: 'TE 缓存编码批量。推荐范围：1–8，显存紧张减半。', defaultValue: '', min: 1 },
  { key: 'disable_mmap_load_safetensors', type: 'boolean', label: '禁用 mmap 加载', title: 'disable_mmap_load_safetensors', desc: '禁用 safetensors mmap 加载（改常规读入）。mmap 与低内存模式冲突时开启。', defaultValue: false },
  { key: 'full_fp16', type: 'boolean', label: '完全 FP16', title: 'full_fp16', desc: '完全 FP16 训练（含主权重），省显存但易溢出出 NaN。建议仅老卡且明确需要时开，日常保持关闭。', defaultValue: false },
  { key: 'full_bf16', type: 'boolean', label: '完全 BF16', title: 'full_bf16', desc: '完全 BF16 训练（含主权重），比 fp16 稳但略损精度。建议 30 系以上显卡且显存吃紧时才开。', defaultValue: false },
  { key: 'no_half_vae', type: 'boolean', label: '不使用半精度 VAE', title: 'no_half_vae', desc: '强制 VAE 用 FP32，修复某些 VAE 半精度发灰/NaN。建议出图异常时开启排查。', defaultValue: false },
  { key: 'persistent_data_loader_workers', type: 'boolean', label: '保持数据加载器', title: 'persistent_data_loader_workers', desc: 'epoch 间保留 worker 进程避免重启开销。建议数据集较大时保持开启（默认 true）。', defaultValue: true },
  { key: 'vae_batch_size', type: 'number', label: 'VAE 编码批量', title: 'vae_batch_size', desc: 'VAE 缓存编码批量；0 自动。推荐范围：4–16，OOM 时减半。', defaultValue: '', min: 1 },
  { key: 'vram_swap_to_ram', type: 'boolean', label: 'VRAM Swap to RAM', title: 'vram_swap_to_ram', desc: '让原生 LoRA/LoRA-FA/T-LoRA/VeRA 的可训权重驻留内存按需上卡。建议优化器状态爆显存时试验。', defaultValue: false },
  { key: 'cpu_offload_checkpointing', type: 'boolean', label: 'CPU 卸载检查点', title: 'cpu_offload_checkpointing', desc: '梯度检查点时把部分张量卸载到 CPU，进一步省显存但更慢。建议极端显存场景才开。', defaultValue: false },
  ...S_GRADIENT_RELEASE,
  ...S_OPTIMIZER_STATE_PAGING,
  ...S_MEMORY_RECLAIM,
  // (separator for TypeScript parser)
  { key: 'pytorch_cuda_expandable_segments', type: 'boolean', label: '显存碎片优化', title: 'pytorch_cuda_expandable_segments', desc: '训练前设置 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True 减少碎片 OOM。建议保持开启（默认 true）。', defaultValue: true }
];
export const S_DISTRIBUTED = [
  { key: 'enable_distributed_training', type: 'boolean', label: '启用分布式训练', title: 'enable_distributed_training', desc: '启用 DDP 多卡并行。建议单卡能放下时不开启；开启后 batch 为每卡数值。', defaultValue: false },
  { key: 'num_processes', type: 'number', label: '进程数', title: 'num_processes', desc: '本机启动的训练进程数，留空按所选 GPU 数推断。推荐范围：等于 GPU 数。', defaultValue: '', min: 1, visibleWhen: when('enable_distributed_training', true) },
  { key: 'num_machines', type: 'number', label: '机器数', title: 'num_machines', desc: '参与训练的机器总数。推荐范围：单机保持 1。', defaultValue: 1, min: 1, visibleWhen: when('enable_distributed_training', true) },
  { key: 'machine_rank', type: 'number', label: '当前机器编号', title: 'machine_rank', desc: '当前机器编号（主节点为 0）。推荐范围：单机保持 0，多机各设不同编号。', defaultValue: 0, min: 0, visibleWhen: when('enable_distributed_training', true) },
  { key: 'main_process_ip', type: 'string', label: '主节点 IP', title: 'main_process_ip', desc: '主节点 IP 地址。多机训练时必填', defaultValue: '', visibleWhen: when('enable_distributed_training', true) },
  { key: 'main_process_port', type: 'number', label: '主节点端口', title: 'main_process_port', desc: '主节点 rendezvous 端口。推荐范围：默认 29500，冲突时改任意空闲端口。', defaultValue: 29500, min: 1, max: 65535, visibleWhen: when('enable_distributed_training', true) },
  { key: 'nccl_socket_ifname', type: 'string', label: 'NCCL 网卡名', title: 'nccl_socket_ifname', desc: '可选。NCCL 使用的网卡名，例如 Ethernet', defaultValue: '', visibleWhen: when('enable_distributed_training', true) },
  { key: 'gloo_socket_ifname', type: 'string', label: 'Gloo 网卡名', title: 'gloo_socket_ifname', desc: '可选。Gloo 使用的网卡名，例如 Ethernet', defaultValue: '', visibleWhen: when('enable_distributed_training', true) },
  // 同步/SSH 细节属于专家面：单机与共享盘多卡用不到，折叠进 expert。
  { key: 'sync_config_from_main', type: 'boolean', label: '从主节点同步配置', title: 'sync_config_from_main', desc: 'worker 从主节点同步训练配置，避免两边不一致。建议保持开启。', defaultValue: true, visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_config_keys_from_main', type: 'string', label: '同步配置键', title: 'sync_config_keys_from_main', desc: '要从主节点同步的顶层配置键，逗号分隔。* = 同步全部', defaultValue: '*', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_missing_assets_from_main', type: 'boolean', label: '从主节点补齐资源', title: 'sync_missing_assets_from_main', desc: 'worker 按需从主节点拉缺失模型/数据。建议共享存储不可用时保持开启。', defaultValue: true, visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_asset_keys', type: 'string', label: '补齐资源键', title: 'sync_asset_keys', desc: '要从主节点补齐的资源键，逗号分隔', defaultValue: 'pretrained_model_name_or_path,train_data_dir,reg_data_dir,vae,resume', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_main_repo_dir', type: 'string', label: '主节点项目根目录', title: 'sync_main_repo_dir', desc: '优先填写 worker 可直接访问的共享路径/UNC 路径', defaultValue: '', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_main_toml', type: 'string', label: '主节点 TOML 路径', title: 'sync_main_toml', desc: '主节点用于同步的 TOML 路径', defaultValue: './config/autosave/distributed-main-latest.toml', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_ssh_user', type: 'string', label: 'SSH 用户名', title: 'sync_ssh_user', desc: '远程同步时使用的 SSH 用户名', defaultValue: '', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_ssh_port', type: 'number', label: 'SSH 端口', title: 'sync_ssh_port', desc: '远程同步 SSH 端口。推荐范围：保持默认 22，服务器特殊配置时再改。', defaultValue: 22, min: 1, max: 65535, visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_use_password_auth', type: 'boolean', label: 'SSH 密码认证', title: 'sync_use_password_auth', desc: '远程同步用密码认证（否则走密钥）。建议优先密钥，密码方式留意泄露风险。', defaultValue: false, visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true)) },
  { key: 'sync_ssh_password', type: 'string', label: 'SSH 密码', title: 'sync_ssh_password', desc: '远程同步密码。更推荐改用环境变量或共享路径', defaultValue: '', visibleWhen: all(when('enable_distributed_training', true), when('performance_expert_mode', true), when('sync_use_password_auth', true)) },
  { key: 'clear_dataset_npz_before_train', type: 'boolean', label: '训练前清除缓存', title: 'clear_dataset_npz_before_train', desc: 'worker 训练前清空旧 .npz 缓存强制重建。建议仅在数据变更后开一次，平时关闭。', defaultValue: false, visibleWhen: when('enable_distributed_training', true) },
  { key: 'ddp_timeout', type: 'number', label: 'DDP 超时', title: 'ddp_timeout', desc: 'DDP 集合通信超时秒数；0 用后端默认。推荐范围：慢盘/大模型启动慢时 1800 以上。', defaultValue: '', min: 0, visibleWhen: when('enable_distributed_training', true) },
  { key: 'ddp_gradient_as_bucket_view', type: 'boolean', desc: 'DDP 用 bucket view 复用梯度内存，更快更省。建议保持开启（后端默认 true）。', label: 'DDP Bucket View', defaultValue: false, visibleWhen: when('enable_distributed_training', true) },
  { key: 'ddp_static_graph', type: 'boolean', label: 'DDP Static Graph', desc: '声明静态计算图以加速 DDP。仅当图确定不变（无条件分支训练路径）时开启。', defaultValue: false, visibleWhen: when('enable_distributed_training', true) }
];

export const S_LULYNX_SDXL = [
  { key: 'lulynx_experimental_core_enabled', type: 'boolean', label: '启用 Lulynx 核心', title: 'lulynx_experimental_core_enabled', desc: '启用 Lulynx 核心组件集中管理（SafeGuard/EMA/ResourceManager）。建议需要其中任一能力时开启。', defaultValue: false },
  { key: 'lulynx_resource_manager_enabled', type: 'boolean', label: '启用 ResourceManager', title: 'lulynx_resource_manager_enabled', desc: '监控显存占用按节奏清理缓存防碎片累积。建议碎片性 OOM 时开启。', defaultValue: false, visibleWhen: when('lulynx_experimental_core_enabled', true) },
  { key: 'lulynx_resource_log_interval', type: 'number', label: '资源日志间隔', title: 'lulynx_resource_log_interval', desc: '资源日志间隔步数。推荐范围： 25（默认）。', defaultValue: 25, min: 1, visibleWhen: all(when('lulynx_experimental_core_enabled', true), when('lulynx_resource_manager_enabled', true)) },
  // ── BlockWeight 唯一 master（双入口归一，2026-08 SDXL 桶审计 §1.4#1）──────────
  // enable_block_weights 与 lulynx_block_weight_enabled 曾同时映射 bw_enable
  // （config_adapter_training_shared.py:175-178 先到先得、键序敏感）。现在：
  //   · 可见 master 只有 enable_block_weights（本卡）；
  //   · lulynx_block_weight_enabled / lulynx_down/mid/up_lr_weight /
  //     lulynx_block_lr_zero_threshold 转 hidden 旧草稿兼容别名，
  //     提交层 runConfigBuilder 折叠进 down/mid/up_lr_weight 后剥除。
  { key: 'enable_block_weights', type: 'boolean', label: '启用分层学习率 (BlockWeight)', title: 'enable_block_weights', desc: '按 U-Net 编码器/中部/解码器分层设置学习率权重（down/mid/up 三段 JSON）。仅 networks.* 模块生效。建议默认关闭，分区过拟/欠拟时用。', defaultValue: false },
  // 可见性接受任一 master（含旧草稿的 lulynx 别名），否则迁移前草稿的权重串会在
  // 收集阶段被当不可见字段丢掉。
  { key: 'down_lr_weight', type: 'string', label: 'Encoder 分层权重 (12层)', title: 'down_lr_weight', desc: 'U-Net 下段（encoder）逐层 LR 权重表。建议 0–1 之间；低于阈值的 block 视为置零。', defaultValue: '1,1,1,1,1,1,1,1,1,1,1,1', visibleWhen: (c) => c.enable_block_weights === true || c.lulynx_block_weight_enabled === true },
  { key: 'mid_lr_weight', type: 'string', label: 'Mid 分层权重 (1层)', title: 'mid_lr_weight', desc: 'U-Net 中部 LR 权重。建议 0–1。', defaultValue: '1', visibleWhen: (c) => c.enable_block_weights === true || c.lulynx_block_weight_enabled === true },
  { key: 'up_lr_weight', type: 'string', label: 'Decoder 分层权重 (12层)', title: 'up_lr_weight', desc: 'U-Net 上段（decoder）逐层 LR 权重表。建议 0–1。', defaultValue: '1,1,1,1,1,1,1,1,1,1,1,1', visibleWhen: (c) => c.enable_block_weights === true || c.lulynx_block_weight_enabled === true },
  { key: 'block_lr_zero_threshold', type: 'number', label: '分层置零阈值', title: 'block_lr_zero_threshold', desc: '权重低于该阈值时该 block 完全置零（跳过训练）。推荐范围： 0 默认；想真正关掉某段给 0.01。', defaultValue: 0, step: 0.01, visibleWhen: (c) => c.enable_block_weights === true || c.lulynx_block_weight_enabled === true },
  { key: 'lulynx_block_weight_enabled', type: 'hidden', defaultValue: false },
  { key: 'lulynx_down_lr_weight', type: 'hidden', defaultValue: '' },
  { key: 'lulynx_mid_lr_weight', type: 'hidden', defaultValue: '' },
  { key: 'lulynx_up_lr_weight', type: 'hidden', defaultValue: '' },
  { key: 'lulynx_block_lr_zero_threshold', type: 'hidden', defaultValue: 0 },
  { key: 'lulynx_smart_rank_enabled', type: 'boolean', label: '启用 SmartRank (keep_ratio 裁剪)', title: 'lulynx_smart_rank_enabled', desc: 'SmartRank：周期性压缩低能量 rank 通道瘦身。建议过拟合或文件过大时试。', defaultValue: false, visibleWhen: when('lulynx_experimental_core_enabled', true) },
  { key: 'lulynx_smart_rank_keep_ratio', type: 'number', label: '保留 Rank 比例', title: 'lulynx_smart_rank_keep_ratio', desc: '保留 rank 通道比例（0.75=裁最弱 25%）。推荐范围：0.75–0.9。', defaultValue: 0.75, min: 0.05, max: 1, step: 0.01, visibleWhen: all(when('lulynx_experimental_core_enabled', true), when('lulynx_smart_rank_enabled', true)) }
];

export const S_SPEED_SD15 = [
  TRAINING_VRAM_PROFILE_FIELD,
  ...TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
  { key: 'acceleration_profile', type: 'select', label: '模型加速档位', title: 'acceleration_profile', desc: '按当前模型族做加速预检与档位建议', defaultValue: 'off', options: ACCELERATION_PROFILE_OPTIONS },
  // (separator for TypeScript parser)
  { key: 'mixed_precision', type: 'select', label: '混合精度', title: 'mixed_precision', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', defaultValue: 'bf16', options: ['no', 'fp16', 'bf16'] },
  { key: 'xformers', type: 'boolean', label: '启用 xformers', title: 'xformers', desc: '强制 xformers 内存高效注意力（高级覆盖）。建议默认关闭，旧卡兜底用。', defaultValue: false, requiresAttentionBackend: 'xformers', visibleWhen: when('performance_expert_mode', true) },
  { key: 'sdpa', type: 'boolean', label: '启用 SDPA', title: 'sdpa', desc: '强制 PyTorch SDPA 注意力（高级覆盖）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'mem_eff_attn', type: 'boolean', label: '低显存注意力', title: 'mem_eff_attn', desc: '强制省显存 attention（比 xformers 更保守的实现）。建议默认关闭。', defaultValue: false, visibleWhen: when('performance_expert_mode', true) },
  { key: 'cache_latents', type: 'boolean', label: '缓存 Latent', title: 'cache_latents', desc: '缓存 VAE latent 避免每步重复编码，大幅提速。建议除在线增强需求外保持开启（默认 true）。', defaultValue: true },
  { key: 'cache_latents_to_disk', type: 'boolean', label: '缓存 Latent 到磁盘', title: 'cache_latents_to_disk', desc: 'latent 持久化到磁盘跨 run 复用（首次慢后续快）。建议数据集稳定且磁盘够快时开启；开了就不能用颜色类在线增强。', defaultValue: false },
  { key: 'latent_cache_disk_format', type: 'select', label: 'Latent 缓存格式', title: 'latent_cache_disk_format', desc: 'latent 磁盘缓存容器格式（npz 等）。建议 npz 兼容性最好。', defaultValue: 'npz', options: ['safetensors', 'npz'] },
  { key: 'latent_cache_disk_dtype', type: 'select', label: 'Latent 缓存精度', title: 'latent_cache_disk_dtype', desc: 'latent 落盘精度。fp16 体积减半且质量损失可忽略。建议 fp16。', defaultValue: 'fp16', options: ['auto', 'fp16', 'bf16', 'fp32'], visibleWhen: when('cache_latents_to_disk', true) },
  { key: 'full_fp16', type: 'boolean', label: '完全 FP16', title: 'full_fp16', desc: '完全 FP16 训练（含主权重），省显存但易溢出出 NaN。建议仅老卡且明确需要时开，日常保持关闭。', defaultValue: false },
  { key: 'full_bf16', type: 'boolean', label: '完全 BF16', title: 'full_bf16', desc: '完全 BF16 训练（含主权重），比 fp16 稳但略损精度。建议 30 系以上显卡且显存吃紧时才开。', defaultValue: false },
  { key: 'no_half_vae', type: 'boolean', label: '不使用半精度 VAE', title: 'no_half_vae', desc: '强制 VAE 用 FP32，修复某些 VAE 半精度发灰/NaN。建议出图异常时开启排查。', defaultValue: false },
  { key: 'persistent_data_loader_workers', type: 'boolean', label: '保持数据加载器', title: 'persistent_data_loader_workers', desc: 'epoch 间保留 worker 进程避免重启开销。建议数据集较大时保持开启（默认 true）。', defaultValue: true },
  { key: 'vae_batch_size', type: 'number', label: 'VAE 编码批量', title: 'vae_batch_size', desc: 'VAE 缓存编码批量；0 自动。推荐范围：4–16，OOM 时减半。', defaultValue: '', min: 1 },
  { key: 'vram_swap_to_ram', type: 'boolean', label: 'VRAM Swap to RAM', title: 'vram_swap_to_ram', desc: '让原生 LoRA/LoRA-FA/T-LoRA/VeRA 的可训权重驻留内存按需上卡。建议优化器状态爆显存时试验。', defaultValue: false },
  { key: 'cpu_offload_checkpointing', type: 'boolean', label: 'CPU 卸载检查点', title: 'cpu_offload_checkpointing', desc: '梯度检查点时把部分张量卸载到 CPU，进一步省显存但更慢。建议极端显存场景才开。', defaultValue: false },
  { key: 'swap_granularity', type: 'select', label: '显存交换模式', title: 'swap_granularity', desc: '显存交换模式总开关：选择按 block 还是 layer 粒度把冻结权重在 CPU/GPU 间搬运。建议显存不足先试 block 粒度档位。', defaultValue: 'off', options: ['off', 'auto', 'block', 'merged_block', 'layer'] },
  { key: 'swap_ratio', type: 'slider', label: '显存交换比例', title: 'swap_ratio', desc: '按 block 总数比例决定交换多少（0–1）。推荐范围：0.3–0.5 起步试探，配合水线自动调节。', defaultValue: 0, min: 0, max: 1, step: 0.05, visibleWhen: swapEnabled },
  { key: 'swap_count', type: 'number', label: '显存交换数量', title: 'swap_count', desc: '绝对交换数量，大于 0 时优先于比例。推荐范围： 0 用比例控制，精确控卡时才给具体数。', defaultValue: 0, min: 0, visibleWhen: swapEnabled },
  { key: 'block_merge_size', type: 'number', label: '合并 Block 大小', title: 'block_merge_size', desc: 'merged_block 模式下每组包含的相邻 block 数（不跨组边界）。推荐范围：2（默认）。', defaultValue: 2, min: 2, visibleWhen: when('swap_granularity', 'merged_block') },
  { key: 'block_swap_strategy', type: 'select', label: 'BlockSwap 搬运策略', title: 'block_swap_strategy', desc: 'BlockSwap 搬运策略：auto 由后端按家族解析最优路径。建议保持 auto。', defaultValue: 'auto', options: BLOCK_SWAP_STRATEGY_OPTIONS, visibleWhen: all(swapEnabled, when('performance_expert_mode', true)) },
    ...S_GRADIENT_RELEASE,
  ...S_OPTIMIZER_STATE_PAGING,
  ...S_MEMORY_RECLAIM,
  // (separator for TypeScript parser)
  { key: 'pytorch_cuda_expandable_segments', type: 'boolean', label: '显存碎片优化', title: 'pytorch_cuda_expandable_segments', desc: '训练前设置 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True 减少碎片 OOM。建议保持开启（默认 true）。', defaultValue: true }
];
// SafeGuard + Wavelet 从 S_ADV 抽出，供 Anima 组合与共享组复用，避免双份漂移。
export const S_SAFEGUARD = [
  { key: 'safeguard_enabled', type: 'boolean', label: '启用 SafeGuard', title: 'safeguard_enabled', desc: 'SafeGuard：拦截 NaN/Inf 与异常 loss spike 保护训练。建议长训无人值守开启。', defaultValue: false },
  { key: 'safeguard_nan_check_interval', type: 'number', label: 'NaN 检查间隔', title: 'safeguard_nan_check_interval', desc: '每 N 步检查一次 NaN/Inf。推荐范围： 1（默认）最及时。', defaultValue: 1, min: 1, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_safe_state_interval', type: 'number', label: '安全快照间隔', title: 'safeguard_safe_state_interval', desc: '每 N 步保存可回滚安全快照（含动量，拖速）。推荐范围： 100（默认）平衡。', defaultValue: 100, min: 1, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_max_nan_count', type: 'number', label: '最大 NaN 次数', title: 'safeguard_max_nan_count', desc: '连续 NaN 达该次数停止训练。推荐范围： 3（默认）。', defaultValue: 3, min: 1, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_loss_spike_threshold', type: 'number', label: 'Loss Spike 阈值', title: 'safeguard_loss_spike_threshold', desc: 'loss 超过滚动均值多少倍判 spike 并跳过该 step。推荐范围： 5（默认）。', defaultValue: 5.0, min: 1, step: 0.1, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_loss_window_size', type: 'number', label: 'Loss 窗口大小', title: 'safeguard_loss_window_size', desc: 'spike 判定滚动窗口大小。推荐范围： 20（默认）。', defaultValue: 20, min: 2, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_auto_reduce_lr', type: 'boolean', label: '自动降低学习率', title: 'safeguard_auto_reduce_lr', desc: '触发保护时自动降学习率。建议反复轻微 spike 时开启。', defaultValue: false, visibleWhen: when('safeguard_enabled', true) },
  { key: 'safeguard_lr_reduction_factor', type: 'number', label: '降学习率倍率', title: 'safeguard_lr_reduction_factor', desc: '自动降 LR 的倍率。推荐范围： 0.5（默认）减半。', defaultValue: 0.5, min: 0.01, max: 1, step: 0.01, visibleWhen: all(when('safeguard_enabled', true), when('safeguard_auto_reduce_lr', true)) }
];

export const S_WAVELET_LOSS = [
  { key: 'wavelet_loss_enabled', type: 'boolean', label: '启用 Wavelet Loss', title: 'wavelet_loss_enabled', desc: '像素空间之外叠加多尺度小波损失，稳结构提细节。建议大分辨率训练试验。', defaultValue: false },
  { key: 'wavelet_loss_weight', type: 'number', label: 'Wavelet Loss 权重', title: 'wavelet_loss_weight', desc: 'Wavelet 总权重。推荐范围：从很小值开始，例如 0.02–0.1。', defaultValue: 0.05, min: 0, step: 0.01, visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_levels', type: 'number', label: 'Wavelet 层数', title: 'wavelet_loss_levels', desc: '小波分解层数，越高越偏大结构。推荐范围：1–4。', defaultValue: 1, min: 1, max: 4, step: 1, visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_approx_weight', type: 'number', label: 'Wavelet 低频权重', title: 'wavelet_loss_approx_weight', desc: '额外约束最低频 LL 分量。推荐范围：保持 0；仅大尺度结构需要额外约束时再给小值。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_high_freq_weight', type: 'number', label: 'Wavelet 高频权重', title: 'wavelet_loss_high_freq_weight', desc: '高频子带权重。推荐范围： 2（默认）。', defaultValue: 2.0, min: 0, step: 0.1, visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_base_loss', type: 'select', label: 'Wavelet 基础损失', title: 'wavelet_loss_base_loss', desc: '小波域基础损失类型。建议 l2 默认。', defaultValue: 'l2', options: [
    { value: 'l2', label: 'l2' },
    { value: 'l1', label: 'l1' }
  ], visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_detail_boost', type: 'number', label: 'Wavelet 细节增强', title: 'wavelet_loss_detail_boost', desc: '细节阶段的高频额外加权；0 关闭。推荐范围： 0 起步。', defaultValue: 0.0, min: 0, step: 0.05, visibleWhen: when('wavelet_loss_enabled', true) },
  { key: 'wavelet_loss_sigma_gate', type: 'number', label: 'Wavelet σ 门控', title: 'wavelet_loss_sigma_gate', desc: 'σ 低于该值时高频加权全开。推荐范围： 0.5（默认）。', defaultValue: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: when('wavelet_loss_enabled', true) }
];

export const S_ADV = [
  { key: 'goal_forecast_tool', type: 'action', label: '训练达标预测（Copilot 只读预测器）', desc: '读取已训练 run 的 loss / 验证 loss / L2 时序', buttonLabel: '📈 打开达标预测', handler: 'openGoalForecastTool' },
  { key: 'copilot_tool', type: 'action', label: '自动训练 Copilot（全自动闭环编排）', desc: '一次授权无人值守：设定目标阈值（loss / 验证 loss / L2）+', buttonLabel: '🤖 自动训练 Copilot', handler: 'openCopilotTool' },
  // Runtime 权威：默认空 / auto 跟随 launcher；显式非空才算覆盖。
  { key: 'execution_profile_id', type: 'string', label: '执行环境 Profile（高级）', title: 'execution_profile_id', desc: '留空则跟随启动器当前/上次 runtime。', defaultValue: '' },
  { key: 'attention_backend', type: 'select', label: 'Attention 后端（高级）', title: 'attention_backend', desc: '强制指定注意力后端（auto 跟随环境）。建议 auto；排查算子兼容性时再显式指定。', defaultValue: 'auto', options: [
    { value: 'auto', label: '自动（跟随启动环境）' },
    { value: 'sdpa', label: 'SDPA' },
    { value: 'xformers', label: 'xFormers' },
    { value: 'sageattn', label: 'SageAttention' },
    { value: 'flash2', label: 'FlashAttention 2' },
    { value: 'flexattn', label: 'FlexAttention' },
    { value: 'torch', label: 'Torch' }
  ] },
  { key: 'gpu_ids', type: 'string', label: '指定显卡', title: 'gpu_ids', desc: '指定参与训练的 GPU 编号，多卡用逗号分隔（如 0,1）。', defaultValue: '' },
  { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 1337 },
  // 与后端 preflight 一致（training_config_checks.py:287-298）：SDXL 且 >1 发 experimental 警告。
  { key: 'clip_skip', type: 'slider', label: 'CLIP 跳层', title: 'clip_skip', desc: 'CLIP 特征取倒数第 N 层，改变文本条件风格。推荐范围：SD1.5 社区常用 2，SDXL 保持 1（>1 属实验行为，预检会告警）。', defaultValue: 1, min: 0, max: 12, step: 1 },
  { key: 'masked_loss', type: 'boolean', label: '启用蒙版损失', title: 'masked_loss', desc: '只在被遮罩区域计算 loss（配合 mask 图）。建议有区域标注且只想学主体时开启。', defaultValue: false },
  { key: 'alpha_mask', type: 'boolean', label: '读取 Alpha 通道作为 Mask', title: 'alpha_mask', desc: '读取 PNG alpha 通道作为 loss mask。建议透明背景素材且只想学前景时开启。', defaultValue: false },
  { key: 'training_comment', type: 'textarea', label: '训练备注', title: 'training_comment', desc: '写入模型元数据的训练备注', defaultValue: '' },
  { key: 'ui_custom_params', type: 'textarea', label: '自定义 TOML 覆盖', title: 'ui_custom_params', desc: '危险：会直接覆盖界面中的参数', defaultValue: '' },
  { key: 'no_metadata', type: 'boolean', label: '不写入元数据', title: 'no_metadata', desc: '不在产物写入训练元数据（提示词等）。建议发布敏感包时开启，一般保持关闭以便追溯。', defaultValue: false },
  { key: 'initial_epoch', type: 'number', label: '起始 epoch', title: 'initial_epoch', desc: '续训时的起始 epoch 编号，推荐范围：保持默认 1；仅 resume 场景为对齐编号才改，且只影响日志/保存命名计数、不跳过训练。', defaultValue: '', min: 1 },
  { key: 'initial_step', type: 'number', label: '起始 step', title: 'initial_step', desc: '续训时的起始 step 编号并覆盖 initial_epoch。推荐范围：普通训练保持 0；配合 skip_until_initial_step 才会真正跳过前面的步数。', defaultValue: '', min: 0 },
  { key: 'skip_until_initial_step', type: 'boolean', label: '跳过前面步数', title: 'skip_until_initial_step', desc: '开启后 dataloader 会真正丢弃 initial_step 之前的样本，而不是仅改计数。建议仅在断点续训对齐进度时开启。', defaultValue: false },
  { key: 'ema_enabled', type: 'boolean', label: '启用 EMA', title: 'ema_enabled', desc: 'EMA 指数滑动平均：额外维护一份平滑参数，保存时可写出 EMA 权重通常更稳；显存多一份参数副本。建议长训实验开启对比。', defaultValue: false },
  { key: 'ema_decay', type: 'number', label: 'EMA 衰减率', title: 'ema_decay', desc: 'EMA 衰减率，越接近 1 越平滑但响应越慢。推荐范围：0.998–0.9995（默认 0.999）。', defaultValue: 0.999, min: 0, max: 0.99999, step: 0.0001, visibleWhen: when('ema_enabled', true) },
  { key: 'ema_update_every', type: 'number', label: 'EMA 更新间隔', title: 'ema_update_every', desc: '每 N 个优化步更新一次 EMA。推荐范围： 1（默认）。', defaultValue: 1, min: 1, visibleWhen: when('ema_enabled', true) },
  { key: 'ema_update_after_step', type: 'number', label: 'EMA 起始步', title: 'ema_update_after_step', desc: '从第几个优化 step 才开始更新 EMA，跳过前期噪声。推荐范围： 0 立即开始或数百步热身。', defaultValue: 0, min: 0, visibleWhen: when('ema_enabled', true) },
  ...S_SAFEGUARD,
  ...S_WAVELET_LOSS
];

/** DiT 高级：去掉 CLIP 跳层（SD/SDXL 仍用完整 S_ADV） */
export const S_ADV_DIT = excludeKeys(S_ADV, ['clip_skip']);

export const S_WEIGHT_NOISE = [
  { key: 'lulynx_weight_noise_enabled', type: 'boolean', label: 'LoRA 权重噪声', title: 'lulynx_weight_noise_enabled', desc: 'LoRA 权重噪声：每个优化步向权重注入扰动作正则。建议过拟合抑制试验用。', defaultValue: false },
  { key: 'lulynx_weight_noise_mode', type: 'select', label: '权重噪声模式', title: 'lulynx_weight_noise_mode', desc: '噪声注入模式 relative/absolute。建议 relative 对规模稳健。', defaultValue: 'relative', options: [
    { value: 'relative', label: 'relative（按权重 RMS）' },
    { value: 'absolute', label: 'absolute（固定 σ）' }
  ], visibleWhen: when('lulynx_weight_noise_enabled', true) },
  { key: 'lulynx_weight_noise_sigma', type: 'number', label: '权重噪声 σ', title: 'lulynx_weight_noise_sigma', desc: '噪声强度：relative 模式为相对 RMS 倍率。推荐范围： 0.0125（默认）附近。', defaultValue: 0.0125, min: 0, step: 0.0005, visibleWhen: when('lulynx_weight_noise_enabled', true) },
  { key: 'lulynx_weight_noise_bound_norm', type: 'boolean', label: '权重噪声保范数', title: 'lulynx_weight_noise_bound_norm', desc: '加噪后把范数缩回原值抑制长期漂移。建议开启配合长训。', defaultValue: false, visibleWhen: when('lulynx_weight_noise_enabled', true) },
  { key: 'lulynx_weight_noise_log_every', type: 'number', label: '权重噪声日志间隔', title: 'lulynx_weight_noise_log_every', desc: '每 N 步写一次指标；0 关闭。推荐范围： 50。', defaultValue: 50, min: 0, step: 1, visibleWhen: when('lulynx_weight_noise_enabled', true) }
];

export const S_NOISE = [
  { key: 'noise_offset', type: 'number', label: '噪声偏移', title: 'noise_offset', desc: '在噪声上叠加常数偏移，改善纯黑/纯白等极端明暗的生成。推荐范围：0.05–0.08（甜区），明暗极端的数据可用 0.1；默认 0 关闭。', defaultValue: '', step: 0.01 },
  { key: 'noise_offset_random_strength', type: 'boolean', label: '噪声偏移随机强度', title: 'noise_offset_random_strength', desc: '噪声偏移强度在 0 到设定值间随机取值，增加多样性。建议常规训练关闭；明暗跨度大的数据集可开。', defaultValue: false },
  { key: 'multires_noise_iterations', type: 'number', label: '多分辨率噪声迭代', title: 'multires_noise_iterations', desc: '多分辨率金字塔噪声的迭代层数，让不同尺度噪声更平滑。推荐范围：6–10（配 discount 使用），0 关闭。', defaultValue: '',step: 1 },
  { key: 'multires_noise_discount', type: 'number', label: '多分辨率噪声衰减', title: 'multires_noise_discount', desc: '金字塔噪声各层的衰减率，越低高频占比越小。推荐范围：0.3–0.8（默认 0.3 附近）。', defaultValue: '', step: 0.01 },
  { key: 'ip_noise_gamma', type: 'number', label: '输入扰动噪声', title: 'ip_noise_gamma', desc: '向条件输入注入扰动作为正则，抑制过拟合。推荐范围：0.1 起步小步试探；默认留空关闭。', defaultValue: '', step: 0.01 },
  { key: 'ip_noise_gamma_random_strength', type: 'boolean', label: '扰动噪声随机强度', title: 'ip_noise_gamma_random_strength', desc: '扰动强度在 0 到 gamma 之间随机。建议常规训练关闭，仅实验对比用。', defaultValue: false },
  { key: 'adaptive_noise_scale', type: 'number', label: '自适应噪声缩放', title: 'adaptive_noise_scale', desc: '按 latent 平均绝对值动态追加 noise_offset，亮图正偏移暗图负偏移。推荐范围：noise_offset 的 10%–50%（如 0.01），需先开 noise_offset。', defaultValue: '', step: 0.01 },
  { key: 'perlin_noise_offset_enabled', type: 'boolean', label: 'Perlin 噪声偏移', title: 'perlin_noise_offset_enabled', desc: '用 Perlin 场替代均匀 noise_offset，产生空间相关噪声正则。建议与 noise_offset 二选一对比。', defaultValue: false },
  { key: 'perlin_noise_offset_strength', type: 'number', label: 'Perlin 偏移强度', title: 'perlin_noise_offset_strength', desc: 'Perlin 场叠加强度。推荐范围： 0.1（默认）附近，同 noise_offset 量级。', defaultValue: 0.1, min: 0, step: 0.01, visibleWhen: when('perlin_noise_offset_enabled', true) },
  { key: 'perlin_noise_offset_scale', type: 'number', label: 'Perlin 频率尺度', title: 'perlin_noise_offset_scale', desc: 'Perlin 场频率尺度，越大纹理越细。推荐范围： 4（默认）附近。', defaultValue: 4.0, min: 0.1, step: 0.1, visibleWhen: when('perlin_noise_offset_enabled', true) },
  { key: 'immiscible_diffusion_enabled', type: 'boolean', label: 'Immiscible Diffusion', title: 'immiscible_diffusion_enabled', desc: 'minibatch 内按度量重排噪声-数据配对，降低噪声与目标互渗。建议数据集小、收敛慢时试验；默认关闭。', defaultValue: false },
  { key: 'immiscible_metric', type: 'select', label: 'Immiscible 度量', title: 'immiscible_metric', desc: '配对距离度量：l2 经典实现，cosine 更接近 flow OT 配对。建议保持默认 lulynx_greedy 对应度量，改动需 A/B 对比。', defaultValue: 'l2', options: [
    { value: 'l2', label: 'l2' },
    { value: 'cosine', label: 'cosine' }
  ], visibleWhen: when('immiscible_diffusion_enabled', true) },
  { key: 'immiscible_assignment_mode', type: 'select', label: 'Immiscible 配对方案', title: 'immiscible_assignment_mode', desc: '配对算法：standard 全局最优 Hungarian（更准更慢）；lulynx_greedy 兼容现有逐行贪心。建议 greedy 起步。', defaultValue: 'lulynx_greedy', options: [
    { value: 'standard', label: '标准（全局最优）' },
    { value: 'lulynx_greedy', label: 'lulynx 优化（贪心）' }
  ], visibleWhen: (c) => c.immiscible_diffusion_enabled && String(c.immiscible_metric || 'l2') === 'l2' },
  { key: 'p2_weighting_mode', type: 'select', label: 'P2 / lulynx 感知加权模式', title: 'p2_weighting_mode', desc: '感知加权模式：p2=(k+SNR)^-γ 论文加权；lulynx_structure/detail 为本仓工程权重；off 恒等。建议默认 off，构图/细节失衡时再试 p2。', defaultValue: 'off', options: [
    { value: 'off', label: '关闭' },
    { value: 'p2', label: '标准 P2' },
    { value: 'lulynx_structure', label: 'lulynx 结构增强' },
    { value: 'lulynx_detail', label: 'lulynx 细节增强' }
  ] },
  { key: 'p2_weighting_strength', type: 'number', label: 'P2 加权强度', title: 'p2_weighting_strength', desc: 'P2 加权强度 γ。推荐范围：0.5–1 起步；0 恒等；收益需同条件 A/B 验证。', defaultValue: 0, min: 0, max: 2, step: 0.05, visibleWhen: (c) => String(c.p2_weighting_mode || 'off') !== 'off' },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '训练允许的最小 timestep（截断低噪段）。推荐范围：留空全范围。', defaultValue: '', min: 0 },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '训练允许的最大 timestep（截断高噪段）。推荐范围：留空全范围；只想学细节时下调。', defaultValue: '', min: 1 },
  { key: 'stepped_loss_enabled', type: 'boolean', label: '分步损失调度', title: 'stepped_loss_enabled', desc: '分步损失调度：按 step 切换 loss 类型/权重表。建议课程式实验使用。', defaultValue: false },
  { key: 'stepped_loss_schedule', type: 'textarea', label: '分步损失 JSON', title: 'stepped_loss_schedule', desc: '分步损失的阶段表定义。建议从简单两段开始验证。', defaultValue: '', visibleWhen: when('stepped_loss_enabled', true) },
  ...S_WEIGHT_NOISE
];
export const S_DATA_AUG = [
  { key: 'color_aug', type: 'boolean', label: '颜色增强', title: 'color_aug', desc: '随机颜色扰动增强。建议与 cache_latents_to_disk 互斥考量（颜色增强不能磁盘缓存）；风格色敏感时关闭。', defaultValue: false },
  { key: 'flip_aug', type: 'boolean', label: '翻转增强', title: 'flip_aug', desc: '随机水平翻转增强，双倍扩充视角。建议对称题材（人物/物体）开启；文字/方向敏感内容关闭。', defaultValue: false },
  { key: 'random_crop', type: 'boolean', label: '随机裁剪', title: 'random_crop', desc: '随机裁剪数据增强。建议构图多样性需求时开；主体易被裁掉时关。', defaultValue: false },
  { key: 'albumentations_enabled', type: 'boolean', label: 'Albumentations 管道', title: 'albumentations_enabled', desc: '启用自定义 albumentations 增强 JSON 管道。建议熟悉该库后再用，配置错误会中断训练。', defaultValue: false },
  { key: 'albumentations_pipeline', type: 'textarea', label: 'Albumentations JSON', title: 'albumentations_pipeline', desc: 'albumentations 增强 JSON 定义。建议从官方示例抄起，逐个增强验证。', defaultValue: '', visibleWhen: when('albumentations_enabled', true) },
  { key: 'albumentations_mask_replay', type: 'boolean', label: 'Mask 同步变换', title: 'albumentations_mask_replay', desc: '对 loss mask 应用相同空间变换。默认开启。', defaultValue: true, visibleWhen: when('albumentations_enabled', true) },
  { key: 'resolution_aware_batch_enabled', type: 'boolean', label: '分辨率感知批量', title: 'resolution_aware_batch_enabled', desc: '分辨率感知批量：小图自动放大 batch、大图缩小稳显存。建议混合分辨率数据集开启。', defaultValue: false },
  { key: 'resolution_aware_batch_base_resolution', type: 'number', label: '基准分辨率', title: 'resolution_aware_batch_base_resolution', desc: '使用原 batch 值的基准分辨率（px）。推荐范围：设为常用训练分辨率（如 1024）。', defaultValue: 1024, min: 64, step: 64, visibleWhen: when('resolution_aware_batch_enabled', true) },
  { key: 'resolution_aware_batch_max_factor', type: 'number', label: '最大批量倍率', title: 'resolution_aware_batch_max_factor', desc: '小图时 batch 最大放大倍数。推荐范围： 2–4。', defaultValue: 4.0, min: 1, step: 0.5, visibleWhen: when('resolution_aware_batch_enabled', true) },
  { key: 'resolution_aware_batch_min_factor', type: 'number', label: '最小批量倍率', title: 'resolution_aware_batch_min_factor', desc: '大图时 batch 最小缩小倍数。推荐范围： 0.25–0.5。', defaultValue: 0.25, min: 0.05, max: 1, step: 0.05, visibleWhen: when('resolution_aware_batch_enabled', true) }
];
export const S_VALIDATION = [
  { key: 'eval_data_dir', type: 'folder', pickerType: 'folder', label: '自定义验证集路径', title: 'eval_data_dir', desc: '独立验证集目录。填了这里就不会从训练集切图', defaultValue: '' },
  { key: 'eval_batch_size', type: 'number', label: '验证批量大小', title: 'eval_batch_size', desc: '验证批大小；0/留空沿用训练 batch。推荐范围：与训练一致或减半，防验证 OOM。', defaultValue: '', min: 0 },
  { key: 'validation_split', type: 'number', label: '验证集比例', title: 'validation_split', desc: '从训练集切出的验证比例。推荐范围：0.05–0.2（<0.05 后端会提示）；0 关闭验证。', defaultValue: 0, min: 0, max: 1, step: 0.01 },
  { key: 'validation_seed', type: 'number', label: '验证集种子', title: 'validation_seed', desc: '验证集切分的随机种子，保证每次切分一致。推荐范围：固定一个任意值便于横向比较。', defaultValue: '' },
  { key: 'validate_every_n_steps', type: 'number', label: '每 N 步验证', title: 'validate_every_n_steps', desc: '每 N 步跑一次验证，过密拖慢训练。推荐范围：500–2000。', defaultValue: '', min: 1 },
  { key: 'validate_every_n_epochs', type: 'number', label: '每 N 轮验证', title: 'validate_every_n_epochs', desc: '每 N 轮跑一次验证。推荐范围：1–5，与保存节奏一致。', defaultValue: '', min: 1 },
  { key: 'max_validation_steps', type: 'number', label: '最大验证步数', title: 'max_validation_steps', desc: '每次验证最多处理的批次上限，控制验证耗时。推荐范围：20–100；0/留空不设限。', defaultValue: '', min: 1 }
];

export const S_THERMAL = [
  { key: 'cooldown_every_n_epochs', type: 'number', label: '每 N 轮冷却', title: 'cooldown_every_n_epochs', desc: '每 N 轮插入冷却期让 GPU 降温。推荐范围：2–5；配合温度目标使用。', defaultValue: '', min: 1 },
  { key: 'cooldown_minutes', type: 'number', label: '冷却分钟数', title: 'cooldown_minutes', desc: '每次冷却至少暂停的分钟数。推荐范围：5–15，视散热条件。', defaultValue: '', min: 0, step: 0.5 },
  { key: 'cooldown_until_temp_c', type: 'number', label: '冷却目标温度(℃)', title: 'cooldown_until_temp_c', desc: '温度降到该值以下才继续训练。推荐范围：60–70℃，视显卡健康目标。', defaultValue: '', min: 1 },
  { key: 'cooldown_poll_seconds', type: 'number', label: '温度轮询间隔(秒)', title: 'cooldown_poll_seconds', desc: '冷却期温度轮询间隔秒。推荐范围：15（默认）附近。', defaultValue: 15, min: 1 },
  { key: 'gpu_power_limit_w', type: 'number', label: 'GPU 功率墙(W)', title: 'gpu_power_limit_w', desc: '训练前设置功率墙瓦数。推荐范围：额定值的 70–90%，换温度余量。', defaultValue: '', min: 1 },
  { key: 'gpu_duty_cycle', type: 'number', label: 'GPU 占空比', title: 'gpu_duty_cycle', desc: '每个优化步后按比例插入空闲降温（0.2 = 20% 占空比让渡）。推荐范围：0.2–0.5 过热环境。', defaultValue: '', min: 0.2, max: 1, step: 0.05 },
  { key: 'gpu_target_temp_c', type: 'number', label: 'GPU 目标温度(℃)', title: 'gpu_target_temp_c', desc: '温度闭环目标：超过则自动降低有效占空比。推荐范围：70℃ 附近。', defaultValue: '', min: 1 },
  { key: 'gpu_lock_clocks_mhz', type: 'number', label: 'GPU 锁频上限(MHz)', title: 'gpu_lock_clocks_mhz', desc: '训练前用 nvidia-smi 锁核心频率上限（需管理员权限）。推荐范围：过热环境锁到基准的 80–90%。', defaultValue: '', min: 1 },
  ...S_GPU_CIRCUIT
];

export const S_PEAK_VRAM = [
  { key: 'peak_vram_control_enabled', type: 'boolean', label: '启用显存峰值控制', title: 'peak_vram_control_enabled', desc: '显存峰值控制总开关：micro-batch 拆分/启动保护等子项的父开关。建议 OOM 驱动场景才开。', defaultValue: false },
  { key: 'peak_vram_target_effective_batch', type: 'number', label: '目标等效 Batch', title: 'peak_vram_target_effective_batch', desc: '目标等效 batch（供拆分器参考）；0 自动。推荐范围： 0。', defaultValue: 0, min: 0, visibleWhen: when('peak_vram_control_enabled', true) },
  { key: 'peak_vram_startup_guard_enabled', type: 'boolean', label: '启动峰值保护', title: 'peak_vram_startup_guard_enabled', desc: '启动阶段峰值保护（首个优化循环前最易 OOM）。建议大模型首训开启观察。', defaultValue: false, visibleWhen: when('peak_vram_control_enabled', true) },
  { key: 'peak_vram_startup_guard_mode', type: 'select', label: '保护强度', title: 'peak_vram_startup_guard_mode', desc: '保护强度：auto 自动估计档位。建议 auto。', defaultValue: 'auto', options: ['auto', 'balanced', 'aggressive'], visibleWhen: all(when('peak_vram_control_enabled', true), when('peak_vram_startup_guard_enabled', true)) },
  { key: 'peak_vram_startup_guard_steps', type: 'number', label: '保护持续步数', title: 'peak_vram_startup_guard_steps', desc: '保护持续的优化步数。推荐范围：24（默认）附近。', defaultValue: 24, min: 0, visibleWhen: all(when('peak_vram_control_enabled', true), when('peak_vram_startup_guard_enabled', true)) },
  { key: 'peak_vram_micro_batch_enabled', type: 'boolean', label: 'Micro-Batch 拆分', title: 'peak_vram_micro_batch_enabled', desc: '把 batch 拆成多个 micro-batch 执行降峰值。建议 batch>1 且 OOM 时开启。', defaultValue: false, visibleWhen: when('peak_vram_control_enabled', true) },
  { key: 'peak_vram_micro_batch_size', type: 'number', label: 'Micro-Batch 大小', title: 'peak_vram_micro_batch_size', desc: '每个 micro-batch 的大小。推荐范围：1–2，越小越省越慢。', defaultValue: 1, min: 1, visibleWhen: all(when('peak_vram_control_enabled', true), when('peak_vram_micro_batch_enabled', true)) },
  { key: 'peak_vram_diagnostics_enabled', type: 'boolean', label: '显存诊断', title: 'peak_vram_diagnostics_enabled', desc: '启用轻量显存诊断。仅用于排查问题或测速定位，默认不建议常开', defaultValue: false, visibleWhen: when('peak_vram_control_enabled', true) },
  { key: 'peak_vram_diagnostics_interval', type: 'number', label: '诊断间隔 (步)', title: 'peak_vram_diagnostics_interval', desc: '每 N 步输出一次显存诊断。推荐范围：排查期 25，稳定后关闭。', defaultValue: 25, min: 1, visibleWhen: all(when('peak_vram_control_enabled', true), when('peak_vram_diagnostics_enabled', true)) },
  { key: 'peak_vram_auto_protection_enabled', type: 'boolean', label: '动态显存自动保护', title: 'peak_vram_auto_protection_enabled', desc: '动态显存自动保护：检测逼近上限自动降载。建议无人值守长训开启。', defaultValue: false, visibleWhen: when('peak_vram_control_enabled', true) }
];

// ================================================================
// 跨族 Section / 字段模板(被 2 个以上训练族复用)
// ================================================================
// ---- 概念编辑 iLECO / ADDifT / Multi-ADDifT(SD1.5 + SDXL 共用)----
export const conceptEditModelFields = (typeId, label, isSdxl = false) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: `${label} 底模路径`, title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
  { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
  { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
  { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
  ...(isSdxl ? [] : [{ key: 'v2', type: 'boolean', label: 'SD 2.x 模型', title: 'v2', desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。', defaultValue: false }]),
  { key: 'clip_skip', type: 'slider', label: 'CLIP 跳层', title: 'clip_skip', desc: 'CLIP 特征取倒数第 N 层，改变文本条件风格。推荐范围：SD1.5 社区常用 2，SDXL 保持 1（>1 属实验行为，预检会告警）。', defaultValue: 1, min: 0, max: 12, step: 1 }
];

export const conceptEditIdeaFields = (mode) => {
  const fields = [
    { key: 'concept_edit_method', type: 'hidden', defaultValue: (mode === 'multi-addift' ? 'addift' : mode) },
        { key: 'target_prompt', type: 'textarea', label: '目标概念提示词', title: 'target_prompt', desc: '目标概念提示词。iLECO 留空时表示偏向“擦除原概念”。', defaultValue: '' }
];

  if (mode === 'addift') {
    fields.push(
      { key: 'original_image_path', type: 'file', pickerType: 'image-file', label: '原始图像', title: 'original_image_path', desc: 'ADDifT 的原始图像。建议与目标图像内容尽量一一对应。', defaultValue: '' },
      { key: 'target_image_path', type: 'file', pickerType: 'image-file', label: '目标图像', title: 'target_image_path', desc: 'ADDifT 的目标图像。建议与原始图像分辨率一致。', defaultValue: '' },
    );
  }

  if (mode === 'multi-addift') {
    fields.push(
      { key: 'concept_edit_data_dir', type: 'folder', pickerType: 'folder', label: '概念编辑数据集目录', title: 'concept_edit_data_dir', desc: '概念编辑数据目录。结构与训练数据集一致。', defaultValue: './train/concept-edit' },
          );
  }

  return fields;
};

export const conceptEditTrainingFields = (defaults = {}) => [
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: defaults.resolution || '1024,1024' },
  { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: defaults.maxTrainSteps || 500, min: 1 },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', defaultValue: defaults.batchSize || 1, min: 1, max: 8, step: 1 },
  { key: 'gradient_checkpointing', type: 'boolean', label: '梯度检查点', title: 'gradient_checkpointing', desc: '反传时重算激活以省显存（约换 20–30% 速度）。建议除显存富余外保持开启（默认 true）。', defaultValue: true },
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '累积 N 个 micro-batch 再更新一次参数，等效放大 batch 而不增加峰值显存。推荐范围：1（默认）或 4–8；等效 batch = batch_size × 本值。', defaultValue: 1, min: 1 },
  { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: '梯度累加实现路径：fast 只在真正 optimizer.step 时同步/检查（更快），classic 保留旧逐 micro-batch 检查。建议保持 fast，排查累加相关异常时再切 classic 对照。', defaultValue: 'fast', options: [
    { value: 'fast', label: 'fast' },
    // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
    // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
    { value: 'classic', label: 'classic（逐 microbatch 检查）' }
  ], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
  { key: 'network_train_unet_only', type: 'boolean', label: '仅训练 U-Net / DiT', title: 'network_train_unet_only', desc: '只训练 U-Net/DiT 主干（TE 冻结）。建议概念视觉为主、无需新词绑定时开启（多数 LoRA 场景）。', defaultValue: true },
  { key: 'network_train_text_encoder_only', type: 'boolean', label: '仅训练文本编码器', title: 'network_train_text_encoder_only', desc: '只训练文本编码器（主干冻结）。建议仅做词汇/风格语言绑定时开启。', defaultValue: false },
  { key: 'min_timestep', type: 'number', label: '最小时间步', title: 'min_timestep', desc: '训练允许的最小 timestep（截断低噪段）。推荐范围：留空全范围。', defaultValue: defaults.minTimestep ?? '' , min: 0 },
  { key: 'max_timestep', type: 'number', label: '最大时间步', title: 'max_timestep', desc: '训练允许的最大 timestep（截断高噪段）。推荐范围：留空全范围；只想学细节时下调。', defaultValue: defaults.maxTimestep ?? '', min: 1 },
  { key: 'concept_edit_fixed_timestep_per_batch', type: 'boolean', label: '批内固定时间步', title: 'concept_edit_fixed_timestep_per_batch', desc: '同一 batch 固定时间步（减少方差）。建议实验性开启。', defaultValue: false },
  { key: 'concept_edit_diff_alt_ratio', type: 'number', label: '差分交替倍率', title: 'concept_edit_diff_alt_ratio', desc: '差分/交替样本比例。推荐范围： 0.2–0.5 试探。', defaultValue: 1, step: 0.1, visibleWhen: (c) => ['addift', 'multi-addift'].includes(String(c.concept_edit_method || c.concept_edit_mode || '').toLowerCase()) },
  { key: 'concept_edit_use_diff_mask', type: 'boolean', label: '启用差分掩码', title: 'concept_edit_use_diff_mask', desc: '编辑区域使用差分 mask 约束改动范围。建议只想改局部时开启。', defaultValue: false, visibleWhen: (c) => ['addift', 'multi-addift'].includes(String(c.concept_edit_method || c.concept_edit_mode || '').toLowerCase()) }
];

export const conceptEditSections = ({ typeId, label, isSdxl = false, mode, resolution, maxTrainSteps, minTimestep = '', maxTimestep = '' }) => [
  sec('model-settings', 'model', '训练用模型', `${label} 概念编辑底模与恢复训练。`, conceptEditModelFields(typeId, label, isSdxl)),
  sec('save-settings', 'model', '保存设置', '输出路径、格式与训练状态。', [...S_SAVE]),
  sec('concept-settings', 'dataset', '概念编辑输入', '这里定义原始概念、目标概念，以及 ADDifT / Multi-ADDifT 需要的图像或配对目录。', conceptEditIdeaFields(mode)),
  sec('network-settings', 'network', '网络设置', '概念编辑首版先复用现有 LoRA / LyCORIS 网络参数。', netLora('networks.lora', isSdxl ? 32 : 16, isSdxl ? 32 : 16, isSdxl ? 512 : 256, [], ['networks.flexrank_lora'])),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '概念编辑建议优先从 AdamW / Prodigy 一类稳定路线开始。', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '概念编辑首版优先按 step 控制训练时长，不走普通 LoRA 的数据集 epoch 语义。', conceptEditTrainingFields({ resolution, maxTrainSteps, minTimestep, maxTimestep })),
  sec('preview-settings', 'preview', '预览图设置', '可选。概念编辑首版也可以沿用普通训练预览。', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('speed-settings', 'speed', '速度优化', '混合精度、缓存与注意力后端。', [...(isSdxl ? S_SPEED_SDXL : S_SPEED_SD15)]),
  // min_timestep / max_timestep 与上面 training-settings 的 conceptEditTrainingFields 重叠；
  // S_NOISE 里那份默认值是空串，且渲染顺序在后，会把 ADDifT 传进来的 minTimestep=500 盖成空串
  // （createDefaultConfig 是无条件覆盖，最后渲染的赢）。概念编辑的时间步范围归 training-settings 管。
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与辅助损失设置。',
    S_NOISE.filter((f) => !['min_timestep', 'max_timestep'].includes(f.key))),
  sec('advanced-settings', 'advanced', '其他设置', '其它参数。', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '冷却/占空/功率墙，以及可选 GPU 硬件熔断（温度/VRAM/throttle/ECC）。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '首版概念编辑暂不建议多机多卡；这里仍保留通用入口。', [...S_DISTRIBUTED])
];

// ---- DreamBooth / Finetune 模型字段(SD DreamBooth + SDXL Finetune 共用)----
export const finetuneModel = (typeId, label) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: `${label} 底模路径`, desc: '底模文件路径', defaultValue: '' },
  { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
  { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' }
];

// ---- ControlNet 模型/数据/训练/学习率字段(SD / SDXL / FLUX ControlNet 共用)----
export const cnModel = (typeId, label, extra = []) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: `${label} 底模路径`, desc: '底模文件路径', defaultValue: '' },
  { key: 'controlnet_model_name_or_path', type: 'file', pickerType: 'model-file', label: '已有 ControlNet 模型路径', title: 'controlnet_model_name_or_path', desc: '留空从头训练', defaultValue: '' },
  { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
  { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
  ...extra
];
export const cnDataset = (reso, bucketMax, bucketStep) => [
  { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练数据集路径', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
  { key: 'conditioning_data_dir', type: 'folder', pickerType: 'folder', label: '条件图数据集路径', title: 'conditioning_data_dir', desc: '条件图数据集路径；留空时后端自动发现 *_control 兄弟文件兜底', defaultValue: '' },
  // ControlNet 走 LulynxTrainer prior 保留路径（data_fragments DATASET_FIELDS 同款）。
  { key: 'reg_data_dir', type: 'folder', pickerType: 'folder', label: '正则化数据集路径', title: 'reg_data_dir', desc: '先验保留（prior preservation）的正则图目录，配合 prior_loss_weight 使用。建议仅在防灾难遗忘需求下提供类别图。', defaultValue: '' },
  { key: 'prior_loss_weight', type: 'number', label: '先验损失权重', title: 'prior_loss_weight', desc: '先验损失权重：正则项相对主损失的比例。推荐范围：1.0（默认）或 0.5–1；仅提供了正则集时生效。', defaultValue: 1, min: 0, step: 0.1 },
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: reso },
  { key: 'enable_bucket', type: 'boolean', label: '启用分桶', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
  { key: 'min_bucket_reso', type: 'number', label: '桶最小分辨率', title: 'min_bucket_reso', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', defaultValue: 256 },
  { key: 'max_bucket_reso', type: 'number', label: '桶最大分辨率', title: 'max_bucket_reso', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', defaultValue: bucketMax },
  { key: 'bucket_reso_steps', type: 'number', label: '桶划分单位', title: 'bucket_reso_steps', desc: '桶分辨率的划分步进（px）。推荐范围：64（标准）；低显存模式可 32；DiT 路线见 enable_bucket 说明。', defaultValue: bucketStep },
  { key: 'image_decode_backend', type: 'select', label: '图片解码后端', title: 'image_decode_backend', desc: '图片解码后端：pil 最兼容；pil_lru 按 mtime/大小缓存已解码 RGB。建议大数据集 SSD 上 pil_lru。', defaultValue: 'pil', options: IMAGE_DECODE_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'data_backend', type: 'select', label: '数据后端', title: 'data_backend', desc: '数据后端：auto/caption 当前都走 CaptionDataset 实现。建议 auto 保持跟随。', defaultValue: 'auto', options: DATA_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'image_decode_cache_size', type: 'number', label: '图片解码缓存张数', title: 'image_decode_cache_size', desc: '每个 worker 的解码 LRU 容量（张数），0 关闭。推荐范围： 64–256 按内存。', defaultValue: 0, min: 0, visibleWhen: all(when('performance_expert_mode', true), oneOf('image_decode_backend', ['auto', 'pil_lru'])) }
];
export const cnTrainFields = [
  { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', desc: '训练遍历整个数据集的次数上限，决定总训练量。推荐范围：小数据集（<50 张）10–30 轮；大数据集 1–5 轮；与 max_train_steps 二选一设置。', defaultValue: 10, min: 1 },
  { key: 'train_batch_size', type: 'slider', label: '批量大小', title: 'train_batch_size', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', defaultValue: 1, min: 1, max: 32, step: 1 },
  { key: 'gradient_checkpointing', type: 'boolean', label: '梯度检查点', title: 'gradient_checkpointing', desc: '反传时重算激活以省显存（约换 20–30% 速度）。建议除显存富余外保持开启（默认 true）。', defaultValue: true },
  { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累加步数', title: 'gradient_accumulation_steps', desc: '累积 N 个 micro-batch 再更新一次参数，等效放大 batch 而不增加峰值显存。推荐范围：1（默认）或 4–8；等效 batch = batch_size × 本值。', defaultValue: 1, min: 1 },
  { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: '梯度累加实现路径：fast 只在真正 optimizer.step 时同步/检查（更快），classic 保留旧逐 micro-batch 检查。建议保持 fast，排查累加相关异常时再切 classic 对照。', defaultValue: 'fast', options: [
    { value: 'fast', label: 'fast' },
    // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
    // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
    { value: 'classic', label: 'classic（逐 microbatch 检查）' }
  ], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
  { key: 'max_grad_norm', type: 'number', label: '梯度裁剪上限', title: 'max_grad_norm', desc: '梯度裁剪的全局范数上限，防止个别 step 梯度爆炸。推荐范围：保持默认 1.0；LoRA 一般无需改动，全参微调也常用 1.0。', defaultValue: 1.0, min: 0, step: 0.1 }
];
export const cnLR = [
  { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '1e-4' },
  // control_net_lr：configs_performance 声明+恒等别名，全仓零读者（ControlNetTrainer
  // 用全局 learning_rate）。hidden 保旧草稿，提交层剥除。
  { key: 'control_net_lr', type: 'hidden', defaultValue: '' },
  { key: 'lr_scheduler', type: 'select', label: '学习率调度器', title: 'lr_scheduler', desc: '学习率随训练进度的变化曲线，影响中后期收敛质量。建议常规 LoRA 选 cosine 或 cosine_with_restarts；不确定时保持默认即可，loss 门控类调度适合想避免余弦过早触底的实验。', defaultValue: 'cosine', options: schedulerOptions(ALL_SCHEDULERS) },
  { key: 'lr_warmup_steps', type: 'number', label: '预热步数', title: 'lr_warmup_steps', desc: '训练开始时学习率从 0 线性升到目标值的步数，避免初期大步长破坏稳定。推荐范围：0–500 步（默认 0 即可不预热；大数据集或高 LR 建议 100 左右）。', defaultValue: 0, min: 0 },
  ...S_LOSS_AWARE_LR,
  { key: 'weight_decay', type: 'number', label: '权重衰减', title: 'weight_decay', desc: 'AdamW 系 L2 正则强度，抑制权重无限增长。推荐范围：0.01（默认）；Prodigy/DAdaptation 系会自行管理，可设 0。', defaultValue: 0.01, min: 0, max: 1, step: 0.001 },
  // (separator for TypeScript parser)
  { key: 'optimizer_type', type: 'select', label: '优化器', title: 'optimizer_type', desc: '优化器决定如何用梯度更新权重，是稳定性与显存的关键。AdamW8bit 最稳妥省显存；Prodigy/AutoProdigy 自适应步长免调 LR；ScheduleFree 系内置衰减。建议默认 AdamW8bit + cosine。', defaultValue: 'AdamW8bit', options: ALL_OPTIMIZERS }
];

// ---- Textual Inversion 模型/参数字段(SD + SDXL TI 共用)----
export const tiModel = (typeId, label, extra = []) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: `${label} 底模路径`, desc: '底模文件路径', defaultValue: '' },
  // weights（初始 embedding 权重）：全仓零读者零别名 —— TextualInversionTrainer 只用
  // ti_init_token 初始化（textual_inversion.py:295-314）。可见入口是假旋钮，转 hidden
  // 保旧草稿；提交层剥除。
  { key: 'weights', type: 'hidden', defaultValue: '' },
  { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
  { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
  ...extra
];
export const tiParams = [
  { key: 'token_string', type: 'string', label: 'Token 字符串', title: 'token_string', desc: 'tokenizer 中不存在的新 token。', defaultValue: '' },
  { key: 'init_word', type: 'string', label: '初始化词', title: 'init_word', desc: '初始化词', defaultValue: '' },
  { key: 'num_vectors_per_token', type: 'number', label: '每 token 向量数', title: 'num_vectors_per_token', desc: '每个占位符 token 学习的向量数（TI 容量）。推荐范围：1–4；越大越难收敛。', defaultValue: 1, min: 1 }
];
