// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// schemaCommon.js — 训练类型 Schema 公共工具库
// 跨模型族共享的谓词/选项/字段构造器。各族 schema 文件(animaSchema/sdxlSchema/
// otherSchemas)与字段组库(schemaFieldGroups)都从这里 import。
// 纯数据 + 纯函数,无副作用,可在浏览器与 node 下直接 import。
// ================================================================
import {
  ALL_OPTIMIZERS,
  ALL_SCHEDULERS,
  TARGET_LORA_OPTIMIZERS,
  getOptimizersForTrainingMode,
  schedulerOptions,
} from './features/settingsOptions.js';

export {
  ALL_OPTIMIZERS,
  ALL_SCHEDULERS,
  TARGET_LORA_OPTIMIZERS,
  getOptimizersForTrainingMode,
  schedulerOptions,
};

// ---- 谓词组合器 ----
export function when(key, expected) { return (c) => c[key] === expected; }
export function all(...fns) { return (c) => fns.every((f) => f(c)); }
export function oneOf(key, values) { return (c) => values.includes(c[key]); }
export function optimizerIs(value) { return (c) => String(c.optimizer_type || '').trim().toLowerCase() === String(value || '').trim().toLowerCase(); }
export function adamwFamilyOptimizer(c) { return ['adamw', 'adamw8bit'].includes(String(c.optimizer_type || '').trim().toLowerCase()); }
export function swapEnabled(c) { return c.swap_granularity && c.swap_granularity !== 'off'; }
export function nonResidentBlockMode(key) { return (c) => c[key] && c[key] !== 'resident'; }
export function streamingBlockMode(key) { return when(key, 'streaming_offload'); }
export function fieldValueIn(key, values) { return (c) => values.includes(c[key]); }


// ---- Adapter family capability projection ----
// The backend registry is authoritative.  This small fallback keeps the UI
// useful when opened without a running backend and is intentionally limited to
// visibility metadata, not a second injection implementation.
const FALLBACK_ADAPTER_FAMILIES = Object.freeze({
  lora: { supports_rank: true, supports_alpha: true, supports_dropout: true, supports_dora: true, supports_rslora: true },
  dora: { supports_rank: true, supports_alpha: true, supports_dropout: true, supports_dora: true, supports_rslora: false },
  'rs-lora': { supports_rank: true, supports_alpha: true, supports_dropout: true, supports_dora: false, supports_rslora: true },
  locon: { supports_rank: true, supports_alpha: true, supports_dropout: true },
  loha: { supports_rank: true, supports_alpha: true, supports_dropout: true },
  lokr: { supports_rank: true, supports_alpha: true, supports_dropout: true },
  glora: { supports_rank: true, supports_alpha: true, supports_dropout: true },
  glokr: { supports_rank: true, supports_alpha: true, supports_dropout: true },
  'diag-oft': { supports_rank: true, supports_alpha: false, supports_dropout: false },
  ia3: { supports_rank: false, supports_alpha: false, supports_dropout: false },
  full: { supports_rank: false, supports_alpha: false, supports_dropout: true },
});
let adapterFamilyCapabilities = { ...FALLBACK_ADAPTER_FAMILIES };
// Keep the backend payload separate from the merged view.  The merged view is
// deliberately backed by the local fallback so the schema remains usable
// while the backend is unavailable, whereas consumers that need to decide
// whether a value is backend-authoritative must be able to inspect the raw
// response independently.
let backendAdapterFamilyCapabilities = {};

function cloneCapabilityValue(value) {
  if (Array.isArray(value)) return value.map(cloneCapabilityValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneCapabilityValue(item)]));
  }
  return value;
}

function cloneCapabilityMap(source) {
  const result = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
  for (const [family, capability] of Object.entries(source)) {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue;
    result[family] = cloneCapabilityValue(capability);
  }
  return result;
}

export function normalizeAdapterFamily(value) {
  const raw = String(value || 'lora').trim().toLowerCase();
  const aliases = {
    standard: 'lora', 'networks.lora': 'lora', rs_lora: 'rs-lora', rslora: 'rs-lora',
    oft: 'diag-oft', diag_oft: 'diag-oft', 'networks.oft': 'diag-oft',
    'networks.oft_flux': 'diag-oft', 'networks.oft-flux': 'diag-oft',
    lora_fa: 'lora-fa', 'networks.lora_fa': 'lora-fa', 'networks.lora-fa': 'lora-fa',
    'networks.vera': 'vera',
    'networks.tlora': 'tlora', 'networks.tlora_flux': 'tlora', 'networks.tlora-flux': 'tlora',
    'networks.flexrank_lora': 'flexrank', 'networks.flexrank-lora': 'flexrank',
  };
  return aliases[raw] || aliases[raw.replaceAll('_', '-')] || raw.replaceAll('_', '-');
}

// DoRA has several persisted aliases across schema generations. Visibility
// predicates and submit-time normalization must agree on legacy booleans.
export function doraEnabled(config = {}) {
  return [config.dora_enabled, config.use_dora, config.dora_wd]
    .some((value) => value === true || value === 1 || String(value ?? '').trim().toLowerCase() === 'true');
}

export function resolveAdapterFamily(config = {}) {
  const network = String(config.network_module || '').trim().toLowerCase();
  const algo = String(config.lycoris_algo || '').trim().toLowerCase().replaceAll('_', '-');
  if (network === 'networks.oft' || network === 'networks.oft_flux' || network === 'networks.oft-flux' || network === 'oft' || network === 'diag-oft' || network === 'diag_oft') return 'diag-oft';
  if (network === 'networks.lora_fa' || network === 'networks.lora-fa' || network === 'lora_fa' || network === 'lora-fa') return 'lora-fa';
  if (network === 'networks.vera' || network === 'vera') return 'vera';
  if (network === 'networks.tlora' || network === 'networks.tlora_flux' || network === 'networks.tlora-flux' || network === 'tlora') return 'tlora';
  if (network === 'networks.flexrank_lora' || network === 'networks.flexrank-lora' || network === 'flexrank_lora' || network === 'flexrank-lora' || network === 'flexrank') return 'flexrank';
  if (network.includes('lycoris')) return normalizeAdapterFamily(algo || 'loha');
  if (doraEnabled(config)) return 'dora';
  if (config.rs_lora_enabled === true || config.rs_lora === true || config.use_rslora === true) return 'rs-lora';
  return 'lora';
}

export function applyAdapterFamilyCapabilities(payload = {}) {
  const source = payload?.training_capabilities?.adapter_families || payload?.adapter_families;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  // Preserve the backend spelling and payload shape for capability-aware UI
  // consumers.  Normalization below is only for the schema's merged lookup.
  backendAdapterFamilyCapabilities = cloneCapabilityMap(source);
  const next = {};
  for (const [rawFamily, capability] of Object.entries(source)) {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue;
    next[normalizeAdapterFamily(rawFamily)] = cloneCapabilityValue(capability);
  }
  if (!Object.keys(next).length) return false;
  adapterFamilyCapabilities = { ...FALLBACK_ADAPTER_FAMILIES };
  for (const [family, capability] of Object.entries(next)) {
    adapterFamilyCapabilities[family] = {
      ...(FALLBACK_ADAPTER_FAMILIES[family] || {}),
      ...capability,
    };
  }
  return true;
}

/**
 * Return the backend-provided adapter family capabilities exactly as keyed by
 * /api/config/options.  A fresh copy is returned so callers cannot mutate the
 * schema's capability state.
 */
export function getBackendAdapterFamilyCapabilities() {
  return cloneCapabilityMap(backendAdapterFamilyCapabilities);
}

/**
 * Return the capability view used by schema visibility predicates.  It merges
 * backend capabilities over the local fallback and uses normalized family ids.
 */
export function getAdapterFamilyCapabilities() {
  return cloneCapabilityMap(adapterFamilyCapabilities);
}

export function adapterFamilySupports(feature, fallback = true) {
  return (config) => {
    const family = resolveAdapterFamily(config);
    const capability = adapterFamilyCapabilities[family];
    return capability && typeof capability[feature] === 'boolean'
      ? capability[feature]
      : fallback;
  };
}
export const flowEnabled = when('flow_model', true);
export const LOSS_AWARE_SCHEDULERS = ['loss_gated_cosine', 'loss_weighted_annealed_cosine'];
export const lossAwareScheduler = oneOf('lr_scheduler', LOSS_AWARE_SCHEDULERS);
export const lossWeightedScheduler = when('lr_scheduler', 'loss_weighted_annealed_cosine');

// ---- 选项数组 ----
export const DIT_BLOCK_RESIDENCY_OPTIONS = [
  { value: 'resident', label: '常驻 GPU' },
  { value: 'block_cpu_pinned', label: 'Block CPU pinned（牺牲速度换更少显存使用量）' },
];

export const PCIE_TRANSFER_FORMAT_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'fp8_e4m3', label: 'FP8 E4M3 传输' },
  { value: 'int8_rowwise', label: 'INT8 行缩放传输' },
  { value: 'uint4_rowwise', label: 'UINT4 行缩放传输' },
  { value: 'raw_bf16', label: 'Raw BF16 传输（对照）' },
  { value: 'raw_fp16', label: 'Raw FP16 传输（对照）' },
];

export const LOW_VRAM_PROFILE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'standard_16g', label: '16G 稳定档：缓存 + 检查点' },
  { value: 'low_12g', label: '12G 低显存档：阶段分辨率 + 轻量交换' },
  { value: 'very_low_8g', label: '8G 极限档：CPU 检查点 + 更强交换' },
  { value: 'experimental', label: '研究档：手动验证后使用' },
];

export const ACCELERATION_PROFILE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'safe', label: '稳妥：缓存 + Foreach AdamW' },
  { value: 'balanced', label: '均衡：按模型推荐加速补丁' },
  { value: 'aggressive', label: '激进：启用模型级 compile/fast path 建议' },
  { value: 'low_vram', label: '低显存：缓存到磁盘 + offloaded checkpoint' },
];

export const PCIE_TRANSFER_FORMAT_FIELD = {
  key: 'pcie_transfer_format',
  type: 'select',
  label: 'PCIe 训练传输格式',
  desc: 'CPU-pinned 冻结权重的传输格式。',
  defaultValue: 'off',
  options: PCIE_TRANSFER_FORMAT_OPTIONS,
};

export const sparseSwapFields = (residencyKey) => [
  { key: 'sparse_swap_enabled', type: 'boolean', label: '稀疏交换方案', title: 'sparse_swap_enabled', desc: '仅对 Streaming Offload 生效。', defaultValue: false, visibleWhen: streamingBlockMode(residencyKey) },
  { key: 'sparse_swap_warm_fraction', type: 'number', label: '稀疏交换 Warm 比例', title: 'sparse_swap_warm_fraction', desc: '冷层中允许提前预取的比例', defaultValue: 0.35, min: 0, max: 1, step: 0.05, visibleWhen: all(streamingBlockMode(residencyKey), when('sparse_swap_enabled', true)) },
  { key: 'sparse_swap_budget_mb', type: 'number', label: '稀疏交换 Warm 预算 MB', title: 'sparse_swap_budget_mb', desc: '限制 warm prefetch 的 FP16 等效预算。', defaultValue: 0, min: 0, step: 64, visibleWhen: all(streamingBlockMode(residencyKey), when('sparse_swap_enabled', true)) },
];

export const pcieDeltaCacheField = (residencyKey) => ({
  key: 'pcie_delta_cache_enabled',
  type: 'boolean',
  label: 'PCIe Delta/Cache 候选分析',
  desc: 'observe 输出候选报告',
  defaultValue: false,
  visibleWhen: nonResidentBlockMode(residencyKey),
});

export const pcieDeltaCacheModeFields = (residencyKey) => [
  { key: 'pcie_delta_cache_mode', type: 'select', label: 'PCIe Delta/Cache 模式', title: 'pcie_delta_cache_mode', desc: 'observe 只读观察；cache_v0 手动缓存。', defaultValue: 'observe', options: ['observe', 'cache_v0'], visibleWhen: all(nonResidentBlockMode(residencyKey), when('pcie_delta_cache_enabled', true)) },
  { key: 'pcie_delta_cache_budget_mb', type: 'number', label: 'PCIe Cache v0 预算 MB', title: 'pcie_delta_cache_budget_mb', desc: 'GPU 缓存预算。建议 256MB 起步。0 表示不启用。', defaultValue: 256, min: 0, step: 64, visibleWhen: all(nonResidentBlockMode(residencyKey), when('pcie_delta_cache_enabled', true), when('pcie_delta_cache_mode', 'cache_v0')) },
];

export const VORTEX_RUNTIME_MODE_OPTIONS = [
  { value: 'observe', label: '观察报告' },
  { value: 'planner', label: '规划器报告' },
  { value: 'cache_observe', label: 'Cache 候选观察' },
  { value: 'cache_v0', label: 'Cache v0 手动缓存' },
];

export const VORTEX_LOW_VRAM_PROTECTION_MODE_OPTIONS = [
  { value: 'observe', label: '只观察' },
  { value: 'protect', label: '低显存保护' },
];

export const vortexRuntimeFields = (residencyKey, baseVisible = null) => {
  const visible = baseVisible ? all(baseVisible, nonResidentBlockMode(residencyKey)) : nonResidentBlockMode(residencyKey);
  const enabled = all(visible, when('vortex_enabled', true));
  const lowVramEnabled = all(enabled, when('vortex_low_vram_protection_enabled', true));
  return [
    {
      key: 'vortex_enabled',
      type: 'boolean',
      label: 'Vortex 显存管理',
      desc: '开启后只进入显式 Vortex 运行契约',
      defaultValue: false,
      visibleWhen: visible,
    },
    {
      key: 'vortex_mode',
      type: 'select',
      label: 'Vortex 模式',
      desc: 'observe/planner 不改变训练 tensor 路径',
      defaultValue: 'observe',
      options: VORTEX_RUNTIME_MODE_OPTIONS,
      visibleWhen: enabled,
    },
    {
      key: 'vortex_profile',
      type: 'select',
      label: 'Vortex 档位',
      desc: 'standard 默认',
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: 'standard' },
        { value: 'low_vram', label: 'low_vram' },
        { value: 'extreme', label: 'extreme' },
      ],
      visibleWhen: enabled,
    },
    {
      key: 'vortex_strategy',
      type: 'select',
      label: 'Vortex 策略',
      desc: '传给 Vortex 管理器的策略名；通常保持 standard。',
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: 'standard' },
      ],
      visibleWhen: enabled,
    },
    {
      key: 'vortex_budget_mb',
      type: 'number',
      label: 'Vortex Cache 预算 MB',
      desc: 'Vortex Cache 预算 MB',
      defaultValue: 256,
      min: 0,
      step: 64,
      visibleWhen: all(enabled, when('vortex_mode', 'cache_v0')),
    },
    {
      key: 'vortex_low_vram_protection_enabled',
      type: 'boolean',
      label: 'Vortex 低显存保护',
      desc: '开启后允许 Vortex 在低显存压力下收紧',
      defaultValue: false,
      visibleWhen: enabled,
    },
    {
      key: 'vortex_low_vram_protection_mode',
      type: 'select',
      label: '低显存保护模式',
      desc: 'observe 只记录低显存信号',
      defaultValue: 'observe',
      options: VORTEX_LOW_VRAM_PROTECTION_MODE_OPTIONS,
      visibleWhen: lowVramEnabled,
    },
    {
      key: 'vortex_low_vram_min_free_mb',
      type: 'number',
      label: '低显存保底 MB',
      desc: '低于该 free VRAM 水位时触发保护判断。',
      defaultValue: 0,
      min: 0,
      step: 64,
      visibleWhen: lowVramEnabled,
    },
    {
      key: 'vortex_low_vram_prefetch_throttle',
      type: 'boolean',
      label: '低显存时收紧 Prefetch',
      desc: '低显存保护触发时限制预取深度，避免预取队列把显存顶爆。默认开启。',
      defaultValue: true,
      visibleWhen: lowVramEnabled,
    },
  ];
};

export const LORA_RECOMPUTE_OPTIONS = [
  { value: 'auto', label: '自动（DiT 默认开启）' },
  { value: 'on', label: '强制开启' },
  { value: 'off', label: '关闭（用于 A/B）' },
];

export const ADAPTER_INIT_STRATEGY_OPTIONS = ['default', 'pissa', 'olora', 'loftq'];
export const ADAPTER_INIT_EXPORT_MODE_OPTIONS = ['auto', 'raw', 'lora_compatible', 'approximate'];
export const LOFTQ_QUANT_TYPE_OPTIONS = ['rowwise', 'tensorwise'];
export const nativeLoraInitSelected = (c) => String(c.adapter_init_strategy || '').trim().toLowerCase() !== 'default';
export const pissaInitSelected = (c) => c.pissa_init === true || c.pissa_enabled === true || String(c.adapter_init_strategy || '').trim().toLowerCase() === 'pissa';
export const loftqInitSelected = when('adapter_init_strategy', 'loftq');

export const SUPPORTED_LYCORIS_ALGOS = ['locon', 'loha', 'lokr', 'glora', 'glokr', 'ia3', 'full', 'diag-oft'];
export const LYCORIS_DELTA_ALGOS = ['locon', 'loha', 'lokr', 'glora', 'glokr', 'full'];
export const LYCORIS_CONV_ALGOS = ['locon', 'lokr', 'glora'];
export const LYCORIS_NETWORK_MODULES = ['lycoris.kohya', 'lycoris'];
export const LYCORIS_OR_OFT_NETWORK_MODULES = [...LYCORIS_NETWORK_MODULES, 'networks.oft'];
export const lycorisNetworkSelected = fieldValueIn('network_module', LYCORIS_NETWORK_MODULES);
export const nonLycorisNetworkSelected = (c) => !LYCORIS_OR_OFT_NETWORK_MODULES.includes(c.network_module);
// LoRA 方法类型：只包含真正互斥的基础架构类型
// 注意：dora/dokr/hydralora/delta_lora/adalora/reslora 等变体通过独立的 *_enabled 开关控制（见 schemaFrontierGroups.js），
// 不应出现在此列表中，否则会导致下拉框和开关卡片重复暴露
export const LORA_METHOD_TYPES = [
  'lora',       // 标准 LoRA（基础）
  'lora_plus',  // LoRA+ (rsLoRA 的前身，学习率自适应)
  'rs_lora',    // rsLoRA (rank-stabilized LoRA)
  'lora_fa',    // LoRA-FA (frozen-A variant)
  'vera',       // VeRA (vector parameterization)
  'tlora',      // T-LoRA (dynamic rank)
  'flexrank',   // FlexRank LoRA
  'fera',       // FeRA (feature reparameterization)
  'gdlokr',     // GDLoKr (Generalized DoRA + LoKr, 独立架构)
];
export const LYCORIS_METHOD_TYPES = ['locon', 'loha', 'lokr', 'glora', 'glokr', 'ia3', 'full', 'diag-oft', 'oft'];
export const NATIVE_ADAPTER_TYPES = [
  ...LORA_METHOD_TYPES,
  ...LYCORIS_METHOD_TYPES,
];

// ── 适配器实体硬互斥 ─────────────────────────────────────────────────────────
// 与 lora_injector 的 elif materialize 链 + trainer_prepare 独立 injector 路径对齐：
// 同一线性层只能装一种 ΔW 实体；多开时只保留赢家，其余静默失效 → UI/payload 必须归一。
// 优先级（先命中先赢，与 injector 一致）:
//   lora2_adaptive(独立 injector) > fera > hydralora > vera > lora_fa > tlora >
//   flexrank > reslora > lora2_gate > tensorring > dokr > gdlokr > cdka > krona >
//   default LoRA(+dora/adalora 仅挂 default)
const _truthy = (v) => v === true || v === 1 || String(v ?? '').trim().toLowerCase() === 'true';

/** @type {ReadonlyArray<{ id: string, key: string, label: string }>} */
export const ADAPTER_ENTITY_PRIORITY = Object.freeze([
  { id: 'lora2_adaptive', key: 'lora2_adaptive_enabled', label: 'LoRA2 Adaptive' },
  { id: 'fera', key: 'fera_enabled', label: 'FeRA' },
  { id: 'hydralora', key: 'hydralora_enabled', label: 'HydraLoRA' },
  { id: 'vera', key: 'vera_enabled', label: 'VeRA' },
  { id: 'lora_fa', key: 'lora_fa_enabled', label: 'LoRA-FA' },
  { id: 'tlora', key: 'tlora_enabled', label: 'T-LoRA' },
  { id: 'flexrank', key: 'flexrank_lora_enabled', label: 'FlexRank' },
  { id: 'reslora', key: 'reslora_enabled', label: 'ResLoRA' },
  { id: 'lora2', key: 'lora2_enabled', label: 'LoRA2 Gate' },
  { id: 'tensorring', key: 'tensorring_lora_enabled', label: 'T-LoRA TensorRing' },
  { id: 'dokr', key: 'dokr_enabled', label: 'DoKr' },
  { id: 'gdlokr', key: 'gdlokr_enabled', label: 'GDLoKr' },
  { id: 'cdka', key: 'cdka_enabled', label: 'CDKA' },
  { id: 'krona', key: 'krona_enabled', label: 'KronA' },
]);

/** lora_type / adapter_type 下拉 → 实体 id（空=走 default LoRA 或仅 *_enabled） */
export const LORA_TYPE_ENTITY_ID = Object.freeze({
  gdlokr: 'gdlokr',
  hydralora: 'hydralora',
  hydra_lora: 'hydralora',
  fera: 'fera',
  vera: 'vera',
  lora_fa: 'lora_fa',
  tlora: 'tlora',
  flexrank: 'flexrank',
  // dora / rs_lora / lora_plus 不是换实体：仍 default LoRALinear
});

const ADAPTER_ENTITY_BY_ID = Object.freeze(
  Object.fromEntries(ADAPTER_ENTITY_PRIORITY.map((e) => [e.id, e])),
);

export const ADAPTER_ENTITY_KEYS = Object.freeze(ADAPTER_ENTITY_PRIORITY.map((e) => e.key));

const UNSUPPORTED_FLUX_MODULES = new Set(['networks.tlora_flux', 'networks.tlora-flux']);

/** DoRA/AdaLoRA/rsLoRA 只挂在默认 LoRALinear 上；换实体后应关闭。 */
const DEFAULT_LORA_ONLY_KEYS = Object.freeze([
  'dora_enabled',
  'use_dora',
  'dora_wd',
  'adalora_enabled',
  // delta_lora 是 step 后 BA 包装，非 default 实体时易无效/语义混乱
  'delta_lora_enabled',
  // rsLoRA changes the native LoRALinear scaling path. LoRA+ is optimizer-side
  // and remains valid for specialized layers with classifiable A/B parameters.
  'rs_lora_enabled',
]);

export function getAdapterTypeKey(config = {}) {
  return String(config.lora_type || config.adapter_type || '').trim().toLowerCase().replace(/-/g, '_');
}

/**
 * 解析当前配置下的适配器实体赢家。
 * @returns {{ id: string, key: string|null, label: string, source: 'lora_type'|'network_module'|'enabled_flag'|'default' }}
 */
export function resolveWinningAdapterEntity(config = {}) {
  const networkModule = String(config.network_module || '').trim().toLowerCase();
  const loraType = getAdapterTypeKey(config);

  // Module-driven schemas can retain a stale lora_type from a previous draft.
  // Resolve explicit non-default modules first so the UI and payload agree on
  // the injector that will actually be constructed.
  const moduleEntities = {
    'networks.lora_fa': 'lora_fa',
    'networks.lora-fa': 'lora_fa',
    'networks.vera': 'vera',
    'networks.tlora': 'tlora',
    'networks.tlora_flux': 'tlora',
    'networks.tlora-flux': 'tlora',
    'networks.flexrank_lora': 'flexrank',
    'networks.flexrank-lora': 'flexrank',
  };
  const moduleEntityId = moduleEntities[networkModule];
  if (moduleEntityId) {
    const ent = ADAPTER_ENTITY_BY_ID[moduleEntityId];
    return { id: ent.id, key: ent.key, label: ent.label, source: 'network_module' };
  }
  if (networkModule === 'networks.oft' || networkModule === 'networks.oft_flux' || networkModule === 'networks.oft-flux' || networkModule === 'oft' || networkModule === 'diag-oft' || networkModule === 'diag_oft') {
    return { id: 'lycoris', key: null, label: 'LyCORIS/diag-oft', source: 'network_module' };
  }
  if (networkModule.includes('lycoris')) {
    const algo = normalizeAdapterFamily(config.lycoris_algo || 'loha');
    return { id: 'lycoris', key: null, label: `LyCORIS/${algo}`, source: 'network_module' };
  }

  if (LYCORIS_METHOD_TYPES.includes(loraType) || loraType === 'oft') {
    return { id: 'lycoris', key: null, label: `LyCORIS/${loraType}`, source: 'lora_type' };
  }
  const fromType = LORA_TYPE_ENTITY_ID[loraType];
  if (fromType && ADAPTER_ENTITY_BY_ID[fromType]) {
    const ent = ADAPTER_ENTITY_BY_ID[fromType];
    return { id: ent.id, key: ent.key, label: ent.label, source: 'lora_type' };
  }
  // 独立 injector 优先于 elif 链
  for (const ent of ADAPTER_ENTITY_PRIORITY) {
    if (_truthy(config[ent.key])) {
      return { id: ent.id, key: ent.key, label: ent.label, source: 'enabled_flag' };
    }
  }
  return { id: 'lora', key: null, label: '标准 LoRA', source: 'default' };
}

/**
 * 表单互斥：某实体开关当前关着、但想开时，若已有更高/其它赢家则返回对方 label。
 * 对已激活的赢家返回 ''（可编辑以便关闭）。
 */
export function getAdapterEntityConflict(fieldKey, config = {}) {
  if (!ADAPTER_ENTITY_KEYS.includes(fieldKey) && !DEFAULT_LORA_ONLY_KEYS.includes(fieldKey)) {
    return '';
  }
  // 已开：始终允许关掉（避免 disabled 锁死；提交时仍会按赢家归一）
  if (_truthy(config[fieldKey])) return '';

  const winner = resolveWinningAdapterEntity(config);
  if (fieldKey === winner.key) return '';

  // LyCORIS / 其它实体赢家：禁止再开第二个实体或 default-only 旁路
  if (winner.id === 'lycoris') {
    return winner.label;
  }
  if (ADAPTER_ENTITY_KEYS.includes(fieldKey) && winner.id !== 'lora') {
    return winner.label;
  }
  // dora/adalora/delta：仅 default LoRA 可用
  if (DEFAULT_LORA_ONLY_KEYS.includes(fieldKey) && winner.id !== 'lora') {
    return winner.label;
  }
  return '';
}

/**
 * 构建/提交前：按赢家只保留一个实体 master，并关掉 default-only 旁路。
 * 会写回 gdlokr 等与 lora_type 对齐的 enabled。
 */
export function normalizeAdapterEntityMutex(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;

  const loraType = getAdapterTypeKey(payload);
  // 下拉实体 → 强制 master
  const typeEntity = LORA_TYPE_ENTITY_ID[loraType];
  if (typeEntity && ADAPTER_ENTITY_BY_ID[typeEntity]) {
    const key = ADAPTER_ENTITY_BY_ID[typeEntity].key;
    payload[key] = true;
  }

  // lora_type 侧的常见映射（与 newbie prepare 对齐）
  if (loraType === 'vera') payload.vera_enabled = true;
  if (loraType === 'lora_fa') payload.lora_fa_enabled = true;
  if (loraType === 'tlora') payload.tlora_enabled = true;
  if (loraType === 'flexrank') payload.flexrank_lora_enabled = true;
  if (loraType === 'fera') payload.fera_enabled = true;
  if (loraType === 'hydralora' || loraType === 'hydra_lora') payload.hydralora_enabled = true;
  if (loraType === 'gdlokr') payload.gdlokr_enabled = true;
  if (loraType === 'dora') {
    payload.dora_enabled = true;
    payload.use_dora = true;
  }
  if (loraType === 'rs_lora') payload.rs_lora_enabled = true;
  if (loraType === 'lora_plus') payload.lora_plus_enabled = true;

  // Canonicalize all shipped DoRA aliases before resolving the entity winner.
  // dora_wd specifically denotes the weight-decomposed route, so it must not
  // inherit a simultaneously visible dora_mode=full default.
  if (doraEnabled(payload)) {
    payload.dora_enabled = true;
    payload.use_dora = true;
    if (_truthy(payload.dora_wd)) {
      payload.dora_mode = 'wd';
      payload.bypass_mode = false;
    }
  }

  const winner = resolveWinningAdapterEntity(payload);
  const unsupportedFluxModule = UNSUPPORTED_FLUX_MODULES.has(String(payload.network_module || '').trim().toLowerCase());
  for (const ent of ADAPTER_ENTITY_PRIORITY) {
    if (unsupportedFluxModule) {
      // The disabled FLUX T-LoRA option is retained for draft diagnostics, but
      // its schema has no native tlora_enabled master to materialize.
      if (Object.prototype.hasOwnProperty.call(payload, ent.key)) payload[ent.key] = false;
      continue;
    }
    if (winner.id === 'lycoris' || winner.id === 'lora') {
      if (ADAPTER_ENTITY_KEYS.includes(ent.key)) payload[ent.key] = false;
      continue;
    }
    payload[ent.key] = ent.id === winner.id;
  }
  if (winner.id !== 'lora') {
    for (const k of DEFAULT_LORA_ONLY_KEYS) {
      if (payload[k]) payload[k] = false;
    }
  }

  // 块跳过：固定 BlockSkip 与 Adaptive Caching 原理上双重跳过 → 固定优先
  const reducer = String(payload.dit_compute_reducer_strategy || 'none').trim().toLowerCase();
  if (reducer === 'blockskip' && _truthy(payload.adaptive_caching_enabled)) {
    payload.adaptive_caching_enabled = false;
  }

  // 顶栏 TurboCore CUDA vs Triton optimizer step 互斥：TurboCore 开则 Triton mode 置 off
  if (_truthy(payload.turbocore_enabled)) {
    const mode = String(payload.turbocore_optimizer_mode || 'off').trim().toLowerCase();
    if (mode && mode !== 'off') payload.turbocore_optimizer_mode = 'off';
  }

  return payload;
}

export const WINDOW_ATTENTION_BACKEND_OPTIONS = [
  { value: 'auto', label: '自动（优先启动器/预检解析）' },
  { value: 'flex', label: 'FlexAttention' },
  { value: 'sdpa_masked', label: 'SDPA Masked' },
  { value: 'torch_fallback', label: 'Torch Fallback（小序列调试）' },
];

export const LOSS_PRECISION_OPTIONS = [
  { value: 'fp32_loss', label: 'FP32 Loss（默认）' },
  { value: 'mixed_loss', label: 'Mixed Loss' },
];

export const COMPILE_RUNTIME_OPTIONS = [
  { value: 'auto', label: '自动收敛（显式参数优先）' },
  { value: 'off', label: '关闭' },
  { value: 'compile', label: 'torch.compile' },
  { value: 'compile_cache', label: 'torch.compile + 本地缓存' },
  { value: 'cudagraph', label: 'CUDAGraph 后端' },
  { value: 'compile_cudagraph', label: 'Compile + CUDAGraph + 缓存' },
];

export const COMPILE_SHAPE_STRATEGY_OPTIONS = [
  { value: 'auto', label: '自动（按路由探测）' },
  { value: 'fixed_pad', label: 'Fixed Pad（固定视觉 token）' },
  { value: 'token_flatten', label: 'Token Flatten（原生 token bucket）' },
  { value: 'native', label: 'Native（同 token_flatten）' },
];

export const COMPILE_TARGET_STRATEGY_OPTIONS = [
  { value: 'auto', label: '自动（按模块探测）' },
  { value: 'block', label: 'Block（整块编译）' },
  { value: 'inner_forward', label: 'Inner Forward（优先稳定内核路径）' },
];

export const SAFEGUARD_GRADIENT_SCAN_OPTIONS = [
  { value: 'batched', label: 'Batched（推荐）' },
  { value: 'foreach', label: 'Foreach' },
  { value: 'legacy', label: 'Legacy（逐参数）' },
  { value: 'off', label: '关闭梯度范数扫描' },
];

export const FUSED_PROJECTION_MEMORY_MODE_OPTIONS = [
  { value: 'keep_original', label: '保留原始层' },
  { value: 'drop_original', label: '删除原始层' },
  { value: 'materialize_on_save', label: '保存时补回' },
];

export const OPTIMIZER_BACKEND_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'torch_adamw', label: 'PyTorch AdamW' },
  { value: 'foreach_adamw', label: 'PyTorch Foreach AdamW' },
  { value: 'torch_fused', label: 'PyTorch Fused AdamW' },
  { value: 'bnb_8bit', label: 'bitsandbytes 8-bit AdamW' },
  { value: 'compiled_step', label: 'torch.compile 包装任意优化器' },
  { value: 'apex', label: 'Apex FusedAdam（可选依赖）' },
  { value: 'lulynx_fused', label: 'Lulynx FusedAdamW（兼容后端）' },
];

// 底模微调专用扩展集:ao_8bit 仅对大参数全参微调有收益(LoRA 小参数拓扑上
// 实测比 bnb 慢 7.6×),因此只在 finetune schema 暴露。
export const OPTIMIZER_BACKEND_OPTIONS_FINETUNE = [
  ...OPTIMIZER_BACKEND_OPTIONS.slice(0, 5),
  { value: 'ao_8bit', label: 'torchao 8-bit AdamW（大参数全参微调场景，需 Triton）' },
  ...OPTIMIZER_BACKEND_OPTIONS.slice(5),
];

export const ADVANCED_OPTIMIZER_STRATEGY_OPTIONS = [
  { value: 'auto', label: '自动（尊重已有配置）' },
  { value: 'off', label: '关闭新策略选择' },
  { value: 'profile_only', label: '仅记录 Profile' },
  { value: 'lora_plus', label: 'LoRA+（现有参数组）' },
  { value: 'rs_lora', label: 'RS-LoRA' },
  { value: 'lulynx_svd_gradient_filter', label: 'lulynx SVD 梯度过滤（全形状，非 GaLore）' },
];

export const DATA_TRANSFER_PROFILE_MODE_OPTIONS = [
  { value: 'event', label: 'Event（推荐，延迟同步）' },
  { value: 'sync', label: 'Sync（精确调试，会变慢）' },
  { value: 'off', label: '关闭' },
];

export const IMAGE_DECODE_BACKEND_OPTIONS = [
  { value: 'pil', label: 'PIL（默认/最兼容）' },
  { value: 'auto', label: '自动（有缓存大小时启用 PIL LRU）' },
  { value: 'pil_lru', label: 'PIL LRU 缓存' },
  { value: 'torchvision_cpu', label: 'torchvision CPU（不占训练显存）' },
];

export const DATA_BACKEND_OPTIONS = [
  { value: 'auto', label: '自动（当前保持 CaptionDataset）' },
  { value: 'caption', label: 'CaptionDataset（当前稳定路径）' },
  { value: 'raw', label: 'Raw/Caption 别名（归一到 CaptionDataset）' },
  { value: 'webdataset', label: 'WebDataset（探测/Profile）' },
  { value: 'dali', label: 'DALI（预留/Profile）' },
];

export const CACHED_COLLATE_MODE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'pad_sequence', label: 'PyTorch pad_sequence' },
  { value: 'legacy', label: 'Legacy 预分配' },
];

export const CHECKPOINT_POLICY_OPTIONS = [
  { value: 'auto', label: '自动（尊重现有检查点开关）' },
  { value: 'off', label: '关闭' },
  { value: 'full', label: 'Full checkpointing' },
  { value: 'offloaded', label: 'CPU offloaded checkpointing' },
  { value: 'selective', label: 'Selective recompute（Anima；其它架构回退）' },
];

export const BLOCK_SWAP_STRATEGY_OPTIONS = [
  { value: 'auto', label: '自动（尊重后端解析）' },
  { value: 'sync', label: '同步（保守/调试）' },
  { value: 'async', label: '异步预取' },
];

// ---- DiT 检查点字段构造器 ----
export const ditGradientCheckpointingField = (family, defaultValue = true) => ({
  key: 'gradient_checkpointing',
  type: 'boolean',
  label: `${family} 通用检查点`,
  desc: `${family} 通用检查点；主路径看加速页 DiT Block Checkpointing`,
  defaultValue,
});

export const ditTrainFields = (fields, family) => fields.map((field) => (
  field.key === 'gradient_checkpointing'
    ? ditGradientCheckpointingField(family, field.defaultValue ?? true)
    : field
));

// ---- V 参数化字段构造器(SDXL / SD1.5 共用) ----
export const vParameterizationFields = (includeVPredOptions = false) => {
  const fields = [
    { key: 'v_parameterization', type: 'boolean', label: 'V 参数化', title: 'v_parameterization', desc: 'v-parameterization 学习（训练', defaultValue: false },
  ];
  if (includeVPredOptions) {
    fields.push(
      { key: 'zero_terminal_snr', type: 'boolean', label: '零终端 SNR', title: 'zero_terminal_snr', desc: 'Zero Terminal SNR（v-pred 模型训练推荐开启）', defaultValue: true, visibleWhen: when('v_parameterization', true) },
      { key: 'scale_v_pred_loss_like_noise_pred', type: 'boolean', label: '缩放 v-pred 损失', title: 'scale_v_pred_loss_like_noise_pred', desc: '缩放 v-prediction 损失（v-pred', defaultValue: true, visibleWhen: when('v_parameterization', true) },
    );
  }
  return fields;
};

// ---- 数据集字段构造器 ----
export const ds = (reso, bucketMax = 2048, bucketStep = 64, extra = []) => [
  { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练数据集路径', title: 'train_data_dir', desc: '训练数据集路径', defaultValue: './output/lulynx' },
  { key: 'reg_data_dir', type: 'folder', pickerType: 'folder', label: '正则化数据集路径', title: 'reg_data_dir', desc: '正则化数据集路径。默认留空，不使用正则化图像。', defaultValue: '' },
  { key: 'prior_loss_weight', type: 'number', label: '先验损失权重', title: 'prior_loss_weight', desc: '正则化 - 先验损失权重', defaultValue: 1, min: 0, step: 0.1 },
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练图片分辨率，宽x高。支持非正方形，但必须是 64 倍数。', importantDesc: '训练分辨率', defaultValue: reso },
  { key: 'enable_bucket', type: 'boolean', label: '启用分桶', title: 'enable_bucket', desc: 'SDXL/SD15 等 UNet 路径：arb 分桶全支持。DiT cache-first（Anima/Newbie 等）多半不改已缓存分辨率，主要影响 online/rebuild。视频族不保证。', defaultValue: true },
  { key: 'min_bucket_reso', type: 'number', label: '桶最小分辨率', title: 'min_bucket_reso', desc: 'arb 桶最小边。仅在分桶真正生效的路径上有意义。', defaultValue: 256 },
  { key: 'max_bucket_reso', type: 'number', label: '桶最大分辨率', title: 'max_bucket_reso', desc: 'arb 桶最大边。cache-first 回放通常沿用构建时分辨率。', defaultValue: bucketMax },
  { key: 'bucket_reso_steps', type: 'number', label: '桶划分单位', title: 'bucket_reso_steps', desc: '桶分辨率步进。UNet 全支持；DiT 见 enable_bucket 说明。', defaultValue: bucketStep },
  { key: 'bucket_no_upscale', type: 'boolean', label: '桶不放大图片', title: 'bucket_no_upscale', desc: 'arb 桶不放大图片', defaultValue: false },
  { key: 'bucket_selection_mode', type: 'select', label: '分桶策略', title: 'bucket_selection_mode', desc: 'aspect 默认宽高比匹配；area/pixel 面积匹配；larger/ceil 不缩小；smaller/floor 不放大', defaultValue: 'aspect', options: ['aspect', 'area', 'pixel', 'pixels', 'larger', 'ceil', 'no_downscale', 'smaller', 'floor', 'no_upscale'] },
  // 与 bucket_selection_mode 无关：后端 dataset_bucketing.py 只要这里解析出非空桶表就
  // 优先采用。原先锚在幽灵值 'custom_only' 上（options 里没有），字段永久不可见。
  { key: 'bucket_custom_resos', type: 'textarea', label: '自定义桶列表', title: 'bucket_custom_resos', desc: '一行一个，支持 1024x1024。留空则按上面的分桶策略自动生成；一旦填了内容，后端会优先使用这里的桶表，「分桶策略」将不再生效。', defaultValue: '', visibleWhen: when('enable_bucket', true) },
  { key: 'image_decode_backend', type: 'select', label: '图片解码后端', title: 'image_decode_backend', desc: 'pil 最兼容；pil_lru 会按文件 mtime/大小缓存已解码 RGB', defaultValue: 'pil', options: IMAGE_DECODE_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'data_backend', type: 'select', label: '数据后端', title: 'data_backend', desc: 'auto/caption 当前继续走 CaptionDataset', defaultValue: 'auto', options: DATA_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'image_decode_cache_size', type: 'number', label: '图片解码缓存张数', title: 'image_decode_cache_size', desc: '每个 DataLoader worker 的 PIL 解码 LRU', defaultValue: 0, min: 0, visibleWhen: all(when('performance_expert_mode', true), oneOf('image_decode_backend', ['auto', 'pil_lru'])) },
  ...extra,
];

// ---- UI 分组占位字段 ----
export const uiGroup = (title, desc = '', visibleWhen = null) => ({
  key: `__ui_group_${title.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
  type: 'ui_group',
  label: title,
  desc,
  defaultValue: '',
  visibleWhen: visibleWhen || undefined,
});

// ---- LoRA / LyCORIS 网络字段构造器 ----
export const netLora = (mod, dim = 32, alpha = 32, maxDim = 512, extra = [], extraModules = [], includeLycoris = true) => [
  { key: 'network_module', type: 'select', label: '训练网络模块', title: 'network_module', desc: '训练网络模块', defaultValue: mod, options: [mod, ...extraModules, ...(includeLycoris && !mod.includes('lycoris') ? ['lycoris.kohya'] : [])] },
  { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: '网络维度', defaultValue: dim, min: 1, max: maxDim, step: 1, visibleWhen: adapterFamilySupports('supports_rank') },
  { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '网络 Alpha', defaultValue: alpha, min: 1, max: maxDim, step: 1, visibleWhen: adapterFamilySupports('supports_alpha') },
  { key: 'network_dropout', type: 'number', label: '网络 Dropout', title: 'network_dropout', desc: '网络 Dropout', defaultValue: 0, min: 0, step: 0.01, visibleWhen: all(nonLycorisNetworkSelected, adapterFamilySupports('supports_dropout')) },
  { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 每步随机采样激活 rank 的下界', defaultValue: 1, min: 1, step: 1, visibleWhen: when('network_module', 'networks.flexrank_lora') },
  { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已有 network_weights 自动推断 rank / dim', defaultValue: false, visibleWhen: adapterFamilySupports('supports_rank') },
  { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '最大范数正则化。如果使用，推荐为 1', defaultValue: '', min: 0, step: 0.01 },
  uiGroup('LyCORIS 基础结构', '这里放算法类型、卷积维度、preset 这类决定网络骨架的参数。普通 LoRA 路线可直接忽略。', lycorisNetworkSelected),
  { key: 'lycoris_algo', type: 'select', label: 'LyCORIS 算法', title: 'lycoris_algo', desc: '后端原生支持：LoCon / LoHa / LoKr / IA3 /', defaultValue: 'locon', options: SUPPORTED_LYCORIS_ALGOS, visibleWhen: lycorisNetworkSelected },
  { key: 'conv_dim', type: 'number', label: '卷积维度', title: 'conv_dim', desc: '卷积维度', defaultValue: 4, min: 1, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_CONV_ALGOS.includes(c.lycoris_algo) },
  { key: 'conv_alpha', type: 'number', label: '卷积 Alpha', title: 'conv_alpha', desc: '卷积 Alpha', defaultValue: 1, min: 1, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_CONV_ALGOS.includes(c.lycoris_algo) },
  { key: 'lycoris_preset', type: 'string', label: 'LyCORIS Preset', title: 'lycoris_preset', desc: '传给 LyCORIS 库的 preset。', defaultValue: '', visibleWhen: lycorisNetworkSelected },
  uiGroup('正则化与稳定性', 'LyCORIS 专用 dropout / 正则项。大多数训练保持默认即可。', lycorisNetworkSelected),
  { key: 'dropout', type: 'number', label: 'LyCORIS Dropout', desc: 'LyCORIS 主 dropout 概率。', defaultValue: 0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_DELTA_ALGOS.includes(c.lycoris_algo) },
  { key: 'rank_dropout', type: 'number', label: 'LoKr Rank Dropout', title: 'rank_dropout', desc: 'LoKr 专用：按 rank/输出维度随机丢弃的概率。', defaultValue: '', min: 0, max: 1, step: 0.01, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'module_dropout', type: 'number', label: 'LoKr Module Dropout', title: 'module_dropout', desc: 'LoKr 专用：按整个模块随机丢弃的概率。', defaultValue: '', min: 0, max: 1, step: 0.01, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '额外训练归一化层（LayerNorm/RMSNorm 等）的可学习缩放/偏置', defaultValue: false, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && c.lycoris_algo !== 'ia3' },
  uiGroup('DoRA 与兼容选项', 'DoRA 当前接在原生 LoRA 路线；LyCORIS 结构请直接选择上方算法。', when('network_module', 'networks.lora')),
  { key: 'dora_wd', type: 'boolean', label: '启用 DoRA', title: 'dora_wd', desc: '在原生 LoRA 路线下启用 DoRA。', defaultValue: false, visibleWhen: when('network_module', 'networks.lora') },
  { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：默认 LoRA / PiSSA /', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), (c) => !doraEnabled(c)) },
  { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: 'auto 会在最终保存时导出成可加载到原始底模的 LoRA', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), nativeLoraInitSelected) },
  { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 首版使用 fake-quant/dequant 权重残差初始化', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('network_module', 'networks.lora'), loftqInitSelected) },
  { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: 'rowwise 按输出通道量化，tensorwise 按整层张量量化。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), loftqInitSelected) },
  uiGroup('LoKr 专属参数', '这组只会在 LoKr 下出现，包含 Kronecker 分解方式、双侧分解和 full matrix 等更重口味的结构控制。', all(lycorisNetworkSelected, when('lycoris_algo', 'lokr'))),
  { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: '常用 4~无穷（填写 -1 为无穷）', defaultValue: -1, min: -1, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'decompose_both', type: 'boolean', label: 'LoKr 双侧分解', title: 'decompose_both', desc: 'LoKr 额外分解较小那一侧矩阵。', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'full_matrix', type: 'boolean', label: 'LoKr Full Matrix', title: 'full_matrix', desc: 'LoKr 强制走 full matrix 路线', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'unbalanced_factorization', type: 'boolean', label: 'LoKr 非均衡分解', title: 'unbalanced_factorization', desc: 'LoKr 在分解维度时交换较大的那一侧，改变', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
  { key: 'enable_base_weight', type: 'boolean', label: '启用基础权重', title: 'enable_base_weight', desc: '启用基础权重（差异炼丹）', defaultValue: false },
  { key: 'base_weights', type: 'textarea', label: '基础权重路径', title: 'base_weights', desc: '合并入底模的 LoRA 路径，一行一个路径', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'base_weights_multiplier', type: 'textarea', label: '基础权重比例', title: 'base_weights_multiplier', desc: '合并入底模的 LoRA 权重，一行一个数字', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数', defaultValue: '' },
  ...extra,
];

// ---- flow / rectified-flow 参数构造器 ----
// defaults.tsExtra: 额外的 timestep_sampling 选项(如 anima 路线支持的 'logit_normal',
// SD3 论文消融中优于 uniform);仅在传入时追加,其他训练族不受影响。
export const flowParams = (defaults = {}) => [
  { key: 'timestep_sampling', type: 'select', label: '时间步采样', title: 'timestep_sampling', desc: '时间步采样策略', defaultValue: defaults.ts || 'sigmoid', options: ['sigma', 'uniform', 'sigmoid', 'shift', 'flux_shift', ...(defaults.tsExtra || [])] },
  ...((defaults.tsExtra || []).includes('logit_normal') ? [
    { key: 'flow_logit_mean', type: 'number', label: 'Logit Mean', title: 'flow_logit_mean', desc: 'logit_normal 时间步采样均值（SD3 推荐 0）', defaultValue: 0.0, step: 0.01, visibleWhen: when('timestep_sampling', 'logit_normal') },
    { key: 'flow_logit_std', type: 'number', label: 'Logit Std', title: 'flow_logit_std', desc: 'logit_normal 时间步采样标准差（SD3 推荐 1）', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: when('timestep_sampling', 'logit_normal') },
  ] : []),
  { key: 'sigmoid_scale', type: 'number', label: 'sigmoid 缩放', title: 'sigmoid_scale', desc: 'sigmoid 缩放系数', defaultValue: defaults.ss || 1.0, step: 0.001 },
  { key: 'model_prediction_type', type: 'select', label: '模型预测类型', title: 'model_prediction_type', desc: '模型预测类型', defaultValue: defaults.mp || 'raw', options: ['raw', 'additive', 'sigma_scaled'] },
  { key: 'sdxl_model_prediction_type', type: 'select', label: 'Flow 预测目标', title: 'sdxl_model_prediction_type', desc: 'SDXL/SD1.5 Flow 路径的模型预测目标。', defaultValue: 'epsilon', options: ['epsilon', 'velocity', 'sample'], visibleWhen: flowEnabled },
  { key: 'sdxl_flow_weighting_scheme', type: 'select', label: 'Flow Loss 权重', title: 'sdxl_flow_weighting_scheme', desc: 'Flow loss 的 sigma 权重策略。', defaultValue: 'none', options: ['none', 'sigma_sqrt', 'cosmap', 'logit_normal'], visibleWhen: flowEnabled },
  { key: 'sdxl_flow_shift', type: 'number', label: 'Flow 离散偏移', title: 'sdxl_flow_shift', desc: '离散 flow shift，1.0 表示不偏移。', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: flowEnabled },
  { key: 'sdxl_sigmoid_scale', type: 'number', label: 'Flow Sigmoid Scale', title: 'sdxl_sigmoid_scale', desc: 'sigmoid 时间步采样缩放', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: all(flowEnabled, when('timestep_sampling', 'sigmoid')) },
  { key: 'discrete_flow_shift', type: 'number', label: '离散流位移', title: 'discrete_flow_shift', desc: '离散流位移值', defaultValue: defaults.dfs || 1.0, step: 0.001 },
  { key: 'guidance_scale', type: 'number', label: 'CFG 引导缩放', title: 'guidance_scale', desc: 'CFG 引导缩放', defaultValue: defaults.gs || 1.0, step: 0.01 },
  { key: 'weighting_scheme', type: 'select', label: '权重策略', title: 'weighting_scheme', desc: '损失加权策略', defaultValue: defaults.ws || 'none', options: ['sigma_sqrt', 'logit_normal', 'mode', 'cosmap', 'none'] },
  { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数', defaultValue: '', step: 0.01 },
  { key: 'loss_type', type: 'select', label: '损失函数类型', title: 'loss_type', desc: '损失函数类型', defaultValue: defaults.lt || 'l2', options: ['l1', 'l2', 'huber', 'smooth_l1'] },
];

export const rectifiedFlowParams = () => [
  { key: 'flow_model', type: 'boolean', label: '启用 Rectified Flow', title: 'flow_model', desc: '启用 RF / Flow Matching', defaultValue: false },
  { key: 'flow_use_ot', type: 'boolean', label: 'RF 最优传输配对', title: 'flow_use_ot', desc: '按 cosine OT 重新配对 latent', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'flow_timestep_distribution', type: 'select', label: 'RF 时间步分布', title: 'flow_timestep_distribution', desc: 'RF 时间步采样分布', defaultValue: 'logit_normal', options: ['logit_normal', 'uniform'], visibleWhen: when('flow_model', true) },
  { key: 'flow_logit_mean', type: 'number', label: 'RF Logit Mean', desc: 'logit-normal 时间步采样均值', defaultValue: 0.0, step: 0.01, visibleWhen: all(when('flow_model', true), when('flow_timestep_distribution', 'logit_normal')) },
  { key: 'flow_logit_std', type: 'number', label: 'RF Logit Std', desc: 'logit-normal 时间步采样标准差，必须大于 0', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: all(when('flow_model', true), when('flow_timestep_distribution', 'logit_normal')) },
  { key: 'flow_uniform_shift', type: 'boolean', label: 'RF 分辨率偏移', title: 'flow_uniform_shift', desc: '按图像像素数动态偏移 RF 时间步', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'flow_uniform_base_pixels', type: 'number', label: 'RF 基准像素数', title: 'flow_uniform_base_pixels', desc: '分辨率偏移的基准像素数。1024x1024 = 1048576', defaultValue: 1048576, min: 1, step: 1, visibleWhen: all(when('flow_model', true), when('flow_uniform_shift', true)) },
  { key: 'flow_uniform_static_ratio', type: 'number', label: 'RF 固定偏移比率', title: 'flow_uniform_static_ratio', desc: '填写后覆盖分辨率动态偏移。留空则不使用固定比率', defaultValue: '', min: 0.001, step: 0.001, visibleWhen: when('flow_model', true) },
  { key: 'contrastive_flow_matching', type: 'boolean', label: '对比 Flow Matching', title: 'contrastive_flow_matching', desc: '启用 CFM 辅助项。需要同时开启 Rectified Flow', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'cfm_lambda', type: 'number', label: 'CFM 权重', title: 'cfm_lambda', desc: '对比 Flow Matching 权重', defaultValue: 0.05, min: 0, step: 0.001, visibleWhen: all(when('flow_model', true), when('contrastive_flow_matching', true)) },
];

// ---- section 工厂 ----
export const sec = (id, tab, title, desc, fields, opts = {}) => ({ id, tab, title, description: desc, fields, expert: !!opts.expert });
