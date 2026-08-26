// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// Centralized catalogs for optimizer / scheduler display settings.
// Keep these lists broad: the settings page uses them to let users decide
// which choices should be visible in training forms. Some entries are aliases
// or custom class paths that are bridged to backend arguments at submit time.

export const BASE_OPTIMIZERS = [
  'AdamW',
  'SingularityAwareAdamW',
  'AdamW8bit',
  // first-party bf16 权重 + fp32 moments/residual 补偿；仅 bf16 参数；default-off
  'AdamWBF16',
  'PagedAdamW8bit',
  'PagedAdamW',
  'PagedAdamW32bit',
  'RAdamScheduleFree',
  'AdamWScheduleFree',
  'SGDScheduleFree',
  'Lion',
  'Lion8bit',
  'PagedLion8bit',
  'SGDNesterov',
  'SGDNesterov8bit',
  'DAdaptation',
  'DAdaptAdamPreprint',
  'DAdaptAdam',
  'DAdaptAdaGrad',
  'DAdaptAdan',
  'DAdaptAdanIP',
  'DAdaptLion',
  'DAdaptSGD',
  'Adafactor',
  'AdaFactor',
  'Prodigy',
  'prodigyplus.ProdigyPlusScheduleFree',
  'pytorch_optimizer.CAME',
  'pytorch_optimizer.StableAdamW',
  'pytorch_optimizer.SCION',
];

// 2026-08 第 3 站审计（B3）：KL-Shampoo / Gluon 曾以裸 optimizer_type 暴露，但后端
// OptimizerType 枚举（configs_enums.py:69-111）无此二值、configs_validators.py:83-190
// 无映射无兜底（else 直通 UnifiedTrainingConfig → ValidationError 启动失败）。两者的
// 唯一实现入口是 frontier provider 的 GenericOptimizer name= 选择器
// （frontier_optimizer_provider.py:176-195），且标记 default_product_exposed=False。
// 以 disabled 项保留回显与出处说明，禁止新选。
const UNMAPPED_FRONTIER_OPTIMIZER_OPTIONS = [
  {
    value: 'KL-Shampoo',
    label: 'KL-Shampoo（未接入：仅 lab 通道）',
    disabled: true,
    disabledReason: '裸 optimizer_type 会被后端枚举校验拒绝；该优化器尚未开放 GenericOptimizer 产品入口。',
    // 可见 disabled 项的 EN 理由通道：渲染层经 resolveDisabledReason 按语言取用。
    disabledReason_en: 'A bare optimizer_type fails backend enum validation; this optimizer has no GenericOptimizer product entry yet.',
  },
  {
    value: 'Gluon',
    label: 'Gluon（未接入：仅 lab 通道）',
    disabled: true,
    disabledReason: '裸 optimizer_type 会被后端枚举校验拒绝；Lulynx Orthogonal Momentum 尚未开放产品入口。',
    disabledReason_en: 'A bare optimizer_type fails backend enum validation; Lulynx Orthogonal Momentum has no product entry yet.',
  },
];

export const CURATED_PYTORCH_OPTIMIZER_NAMES = [
  'CAME',
  'StableAdamW',
  'SCION',
];

// 前沿优化器 release-hold 闸门已整线移除(后端 frontier_product_surface_guard.py /
// frontier_product_candidate_gate.py / frontier_optimizer_product_candidate_enabled
// 均已删除,legacy UI 同步)。这里不再保留 hold 名单 —— 名单一留就会和后端漂移,
// 而且它拦的都是已经能真跑的优化器。

// 已毕业并直接并入 optimizer_type 的前沿优化器。
// 这份名单与 legacy UI 的同名导出必须一致 —— 之前 React 侧漏拆闸门,导致 legacy 能选、
// React 选不到,是真实的用户可见漂移,不是测试问题。
export const VERIFIED_FRONTIER_OPTIMIZERS = [
  'ADOPT',
  'KahanAdamW',
  'KahanAdamW8bit',
  'Muon',
  'AdaMuon',
  'Riemannion',
  'Rose',
  'Aurora',
  'SOAP',
  'MARS',
];

const RAW_PYTORCH_OPTIMIZER_NAMES = [
  'LBFGS',
  'SGD',
  'Adam',
  'AdamW',
  'NAdam',
  'RMSprop',
  'A2Grad',
  'APOLLO',
  'ASGD',
  'AccSGD',
  'AdEMAMix',
  'AdaBelief',
  'AdaBound',
  'AdaDelta',
  'AdaFactor',
  'AdaGC',
  'AdaGO',
  'AdaHessian',
  'AdaLOMO',
  'AdaMax',
  'AdaMod',
  'AdaNorm',
  'AdaPNM',
  'AdaShift',
  'AdaSmooth',
  'AdaTAM',
  'Adai',
  'Adalite',
  'AdamC',
  'AdamG',
  'AdamMini',
  'AdamP',
  'AdamS',
  'AdamWSN',
  'Adan',
  'AggMo',
  'Aida',
  'AliG',
  'Alice',
  'BCOS',
  'Amos',
  'Ano',
  'ApolloDQN',
  'AvaGrad',
  'BSAM',
  'CAME',
  'Conda',
  'DAdaptAdaGrad',
  'DAdaptAdam',
  'DAdaptAdan',
  'DAdaptLion',
  'DAdaptSGD',
  'DeMo',
  'DiffGrad',
  'DualAdam',
  'EXAdam',
  'EmoFact',
  'EmoLynx',
  'EmoNavi',
  'FAdam',
  'FOCUS',
  'FTRL',
  'Fira',
  'FlashAdamW',
  'Fromage',
  'GaLore',
  'Grams',
  'Gravity',
  'GrokFastAdamW',
  'Kate',
  'Kron',
  'LARS',
  'LOMO',
  'LoRARite',
  'LaProp',
  'Lamb',
  'Lion',
  'MADGRAD',
  'MSVAG',
  'Nero',
  'NovoGrad',
  'PAdam',
  'PID',
  'PNM',
  'Prodigy',
  'QHAdam',
  'QHM',
  'RACS',
  'RAdam',
  'Ranger',
  'Ranger21',
  'Ranger25',
  'SCION',
  'SCIONLight',
  'SGDP',
  'SGDSaI',
  'SGDW',
  'SM3',
  'SPAM',
  'SPlus',
  'SRMM',
  'SWATS',
  'ScalableShampoo',
  'ScheduleFreeAdamW',
  'ScheduleFreeRAdam',
  'ScheduleFreeSGD',
  'Shampoo',
  'SignSGD',
  'SimplifiedAdEMAMix',
  'SophiaH',
  'StableAdamW',
  'StableSPAM',
  'TAM',
  'Tiger',
  'VSGD',
  'Yogi',
  'SpectralSphere',
];

export const PYTORCH_OPTIMIZER_NAMES = RAW_PYTORCH_OPTIMIZER_NAMES;

function optimizerBaseName(name) {
  const value = String(name || '').trim();
  const dotIndex = value.lastIndexOf('.');
  return (dotIndex === -1 ? value : value.slice(dotIndex + 1)).toLowerCase();
}

function dedupeKeepOrder(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function invertKeepFirst(mapping) {
  const result = {};
  for (const [value, type] of Object.entries(mapping)) {
    if (!Object.hasOwn(result, type)) {
      result[type] = value;
    }
  }
  return result;
}

const BASE_OPTIMIZER_BASE_NAMES = new Set(BASE_OPTIMIZERS.map(optimizerBaseName));

export const ALL_OPTIMIZERS = dedupeKeepOrder([
  ...BASE_OPTIMIZERS,
  ...VERIFIED_FRONTIER_OPTIMIZERS,
  'LulynxEmoSensOptimizer',
  'EmoSens',
  ...CURATED_PYTORCH_OPTIMIZER_NAMES
    .filter((name) => !BASE_OPTIMIZER_BASE_NAMES.has(name.toLowerCase()))
    .map((name) => `pytorch_optimizer.${name}`),
  ...PYTORCH_OPTIMIZER_NAMES
    .filter((name) => !BASE_OPTIMIZER_BASE_NAMES.has(name.toLowerCase()))
    .map((name) => `pytorch_optimizer.${name}`),
]).concat(UNMAPPED_FRONTIER_OPTIMIZER_OPTIONS);

const TARGET_LORA_OPTIMIZERS_BASE = dedupeKeepOrder([
  ...ALL_OPTIMIZERS,
  'Automagic++',
  'AutoProdigy',
  'KahanAdamW',
  'KahanAdamW8bit',
  'bitsandbytes.optim.AdEMAMix8bit',
  'bitsandbytes.optim.PagedAdEMAMix8bit',
  'PytorchOptimizer',
  'GenericOptimizer',
  'AnimaFactoredAdamW',
]);

// Export as function to support filtering based on training mode
export function getOptimizersForTrainingMode(modelTrainType) {
  const trainType = String(modelTrainType || '').trim().toLowerCase();

  // AnimaFactoredAdamW is only for full model fine-tuning (anima-finetune)
  // For LoRA training, it's counterproductive (slower with no memory benefit)
  if (trainType !== 'anima-finetune') {
    return TARGET_LORA_OPTIMIZERS_BASE.filter((name) => name !== 'AnimaFactoredAdamW');
  }

  return TARGET_LORA_OPTIMIZERS_BASE;
}

// Legacy export for backward compatibility (returns all optimizers)
export const TARGET_LORA_OPTIMIZERS = TARGET_LORA_OPTIMIZERS_BASE;

export const BUILTIN_SCHEDULERS = [
  'linear',
  'cosine',
  'cosine_with_restarts',
  'polynomial',
  'constant',
  'constant_with_warmup',
  'adafactor',
  'inverse_sqrt',
  // 每一项都必须在后端 configs_enums.py 的 SchedulerType 里存在，否则选中即
  // ValidationError（reduce_lr_on_plateau / cosine_warmup_with_min_lr 曾是这样的死值）。
  // 2026-08 SDXL 桶审计：补齐 SchedulerType(configs_enums.py:112-131) 剩余四值。
  'one_cycle',
  'restart_linear',
  'lulynx_exponential_warmup',
  'plugin',
  'cosine_with_min_lr',
  'loss_gated_cosine',
  'loss_weighted_annealed_cosine',
  'warmup_stable_decay',
  'piecewise_constant',
];

export const SCHEDULER_LABELS = Object.freeze({
  linear: '线性衰减',
  cosine: '余弦退火',
  cosine_with_restarts: '余弦重启',
  polynomial: '多项式衰减',
  constant: '恒定学习率',
  constant_with_warmup: '预热后恒定',
  adafactor: 'Adafactor 内置调度',
  inverse_sqrt: '反平方根衰减',
  one_cycle: 'One-Cycle 单周期',
  restart_linear: '线性重启',
  lulynx_exponential_warmup: '指数预热（REX）',
  plugin: '插件调度器',
  cosine_with_min_lr: '带最小值余弦',
  loss_gated_cosine: 'Loss 门控余弦',
  loss_weighted_annealed_cosine: 'Loss 加权退火余弦',
  warmup_stable_decay: '预热-稳定-衰减',
  piecewise_constant: '分段恒定',
});

export function schedulerOption(value) {
  const raw = value && typeof value === 'object'
    ? String(value.value ?? '').trim()
    : String(value || '').trim();
  const fallbackLabel = value && typeof value === 'object'
    ? String(value.label ?? raw)
    : raw;
  return { value: raw, label: SCHEDULER_LABELS[raw] || fallbackLabel };
}

export function schedulerOptions(values) {
  return (Array.isArray(values) ? values : []).map(schedulerOption).filter((option) => option.value);
}

export const CUSTOM_SCHEDULERS = [
  'torch.optim.lr_scheduler.CosineAnnealingLR',
  'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts',
  'torch.optim.lr_scheduler.OneCycleLR',
  'torch.optim.lr_scheduler.StepLR',
  'torch.optim.lr_scheduler.MultiStepLR',
  'torch.optim.lr_scheduler.CyclicLR',
  'pytorch_optimizer.CosineAnnealingWarmupRestarts',
  'pytorch_optimizer.REXScheduler',
  'pytorch_optimizer.CosineScheduler',
  'pytorch_optimizer.LinearScheduler',
  'pytorch_optimizer.PolyScheduler',
  'pytorch_optimizer.ProportionScheduler',
  'pytorch_optimizer.get_chebyshev_schedule',
  'pytorch_optimizer.get_wsd_schedule',
  // Backward-compatible display aliases kept for existing saved UI settings.
  'cosine_annealing',
  'cosine_annealing_with_warmup',
  'cosine_annealing_warm_restarts',
  'rex',
];

export const ALL_SCHEDULERS = dedupeKeepOrder([
  ...BUILTIN_SCHEDULERS,
  ...CUSTOM_SCHEDULERS,
]);

export const SCHEDULER_VALUE_TO_TYPE = Object.freeze({
  'torch.optim.lr_scheduler.CosineAnnealingLR': 'torch.optim.lr_scheduler.CosineAnnealingLR',
  'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts': 'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts',
  'torch.optim.lr_scheduler.OneCycleLR': 'torch.optim.lr_scheduler.OneCycleLR',
  'torch.optim.lr_scheduler.StepLR': 'torch.optim.lr_scheduler.StepLR',
  'torch.optim.lr_scheduler.MultiStepLR': 'torch.optim.lr_scheduler.MultiStepLR',
  'torch.optim.lr_scheduler.CyclicLR': 'torch.optim.lr_scheduler.CyclicLR',
  'pytorch_optimizer.CosineAnnealingWarmupRestarts': 'pytorch_optimizer.CosineAnnealingWarmupRestarts',
  'pytorch_optimizer.REXScheduler': 'pytorch_optimizer.REXScheduler',
  'pytorch_optimizer.CosineScheduler': 'pytorch_optimizer.CosineScheduler',
  'pytorch_optimizer.LinearScheduler': 'pytorch_optimizer.LinearScheduler',
  'pytorch_optimizer.PolyScheduler': 'pytorch_optimizer.PolyScheduler',
  'pytorch_optimizer.ProportionScheduler': 'pytorch_optimizer.ProportionScheduler',
  'pytorch_optimizer.get_chebyshev_schedule': 'pytorch_optimizer.get_chebyshev_schedule',
  'pytorch_optimizer.get_wsd_schedule': 'pytorch_optimizer.get_wsd_schedule',
  cosine_annealing: 'torch.optim.lr_scheduler.CosineAnnealingLR',
  cosine_annealing_with_warmup: 'pytorch_optimizer.CosineAnnealingWarmupRestarts',
  cosine_annealing_warm_restarts: 'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts',
  rex: 'pytorch_optimizer.REXScheduler',
});

export const SCHEDULER_TYPE_TO_VALUE = Object.freeze({
  ...invertKeepFirst(SCHEDULER_VALUE_TO_TYPE),
  'torch.optim.lr_scheduler.CosineAnnealingLR': 'cosine_annealing',
  'pytorch_optimizer.CosineAnnealingWarmupRestarts': 'cosine_annealing_with_warmup',
  'torch.optim.lr_scheduler.CosineAnnealingWarmRestarts': 'cosine_annealing_warm_restarts',
  'pytorch_optimizer.REXScheduler': 'rex',
});
