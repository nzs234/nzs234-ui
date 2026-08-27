// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { SCHEDULER_VALUE_TO_TYPE } from './features/settingsOptions.js';
import { OPT_FIELD_ARG_KEYS } from './features/optimizerParams.js';
import {
  normalizeAdapterEntityMutex,
  SUPPORTED_LYCORIS_ALGOS as UI_LYCORIS_ALGOS
} from './schemaCommon.js';

const STANDARD_SCHEDULERS = [
  'linear',
  'cosine',
  'cosine_with_restarts',
  'polynomial',
  'constant',
  'constant_with_warmup',
  'adafactor',
  'inverse_sqrt',
  'reduce_lr_on_plateau',
  'cosine_with_min_lr',
  'cosine_warmup_with_min_lr',
  'loss_gated_cosine',
  'loss_weighted_annealed_cosine',
  'warmup_stable_decay',
  'piecewise_constant',
  // 后端 SchedulerType（configs_enums.py:112-131）剩余四值；原值透传不做 type 改写。
  'one_cycle',
  'restart_linear',
  'lulynx_exponential_warmup',
  'plugin',
];

// 幻影键（后端零读者，2026-08 SDXL 桶审计 §8.1）：schema 层 hidden 保旧草稿回显，
// 提交层剥除，避免假旋钮的值进入 payload。
const PHANTOM_KEYS = new Set([
  'control_net_lr',
  'weights',
  'sc_trigger_dropout', 'sc_style_dropout', 'sc_quality_dropout',
  'sc_content_dropout', 'sc_modifier_dropout', 'sc_locked_tags',
  // ANIMA 桶（2026-08）：anima_guidance_scale 双端死键（configs_anima.py:79 声明后
  // 全仓零消费者）；schema 层 hidden 保旧草稿回显，这里剥除避免假旋钮值出站。
  'anima_guidance_scale',
  // ── 第 3 站桶（2026-08）：Newbie / SD / FLUX / MiniMax-H3 全参数修正。──────
  // 以下键后端全仓零读者（仅 configs_* mixin 声明），schema 层 hidden 保旧草稿
  // 回显，提交层统一剥除：
  'dora_init_scale', 'dora_use_scalar_magnitude', 'dora_normalize_magnitude',
  'lora2_adaptive_rank_threshold',
  'ed_lora_fusion_alpha',
  'ac_early_stopping_threshold', 'ac_te_freeze_step', 'ac_auto_lr_scale_factor', 'ac_target_loss',
  'compile_cache_prewarm', 'torch_compile_first_step_timeout',
  'apply_t5_attn_mask',
  // ── 第 6 站桶（2026-08）：boogu 三幻影。schema 层 hidden 保旧草稿回显，
  // 提交层剥除（全仓零消费者，见 otherDitSchemas.js B 项注释）：
  //   boogu_task                 写而不读（loader 按版本派生 / cache 按 training_type）
  //   boogu_max_text_length      零消费者（configs_boogu.py:29 唯一出现处）
  //   boogu_control_image_max_pixels 零消费者（Edit ref/VLM 编码路径无读者）
  'boogu_task', 'boogu_max_text_length', 'boogu_control_image_max_pixels',
]);

// 类型域幻影（第 3 站审计 B6）：flux-lora 的 sigmoid_scale / weighting_scheme /
// mode_scale / model_prediction_type。unified FLUX 训练器读裸键
// （flux_trainer_loss_mixin.py:112-117 / flux_train_step.py:36-38），但别名表全局
// 改名 anima_*（field_alias_map.py:37-38,329）且 UnifiedTrainingConfig 无裸字段
// （extra=ignore）→ 任何出站键都到不了消费者；mode_scale 连 FluxFlowConfig 都不
// 接收。注意：这些键在 ANIMA 族经别名/自有键真实消费，绝不可进全局 PHANTOM_KEYS，
// 只按 typeId 剥除。
const FLUX_LORA_DEAD_FLOW_KEYS = new Set([
  'sigmoid_scale', 'weighting_scheme', 'mode_scale', 'model_prediction_type',
]);

const LR_KEYS = new Set(['learning_rate', 'unet_lr', 'text_encoder_lr', 'control_net_lr']);
const LYCORIS_MODULE_ALIASES = new Set(['lycoris.kohya', 'lycoris.locon', 'lycoris']);
const OFT_MODULE_ALIASES = new Set(['networks.oft', 'networks.oft_flux', 'networks.oft-flux', 'oft', 'diag-oft', 'diag_oft']);
// 单一来源：与 lycoris_algo 字段 options 用同一份白名单，避免 UI 能选、提交层却
// 静默兜回 locon 的双源漂移（glora/glokr 后端是一等支持）。
const SUPPORTED_LYCORIS_ALGOS = new Set(UI_LYCORIS_ALGOS);

function argLines(raw) {
  return String(raw || '')
    .trim()
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes('='));
}

function appendCustomArgs(args, rawCustomArgs) {
  const customLines = argLines(rawCustomArgs);
  const autoKeys = new Set(args.map((arg) => arg.split('=')[0]));
  for (const line of customLines) {
    const key = line.split('=')[0];
    if (autoKeys.has(key)) {
      const index = args.findIndex((arg) => arg.startsWith(key + '='));
      if (index >= 0) args[index] = line;
    } else {
      args.push(line);
    }
  }
  return args;
}

function collectVisiblePayload(config, typeId, getSectionsForType, isFieldVisible) {
  const payload = {};
  for (const section of getSectionsForType(typeId)) {
    for (const field of section.fields) {
      if (field.type === 'ui_group') continue;
      if (field.type !== 'hidden' && !isFieldVisible(field, config)) continue;
      const value = config[field.key];
      if (field.type === 'boolean') {
        payload[field.key] = Boolean(value);
        continue;
      }
      if (field.type === 'number' || field.type === 'slider') {
        if (value === '' || value == null) continue;
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          if (parsed === 0 && (field.key === 'network_dropout' || field.key === 'dropout')) continue;
          payload[field.key] = parsed;
        }
        continue;
      }
      if (value === '' || value == null) continue;
      if (LR_KEYS.has(field.key)) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          payload[field.key] = parsed;
          continue;
        }
      }
      payload[field.key] = value;
    }
  }
  payload.model_train_type = typeId;
  return payload;
}

function normalizeScheduler(payload) {
  if (payload.lr_scheduler && SCHEDULER_VALUE_TO_TYPE[payload.lr_scheduler]) {
    payload.lr_scheduler_type = SCHEDULER_VALUE_TO_TYPE[payload.lr_scheduler];
    payload.lr_scheduler = 'constant';
  } else if (payload.lr_scheduler && !STANDARD_SCHEDULERS.includes(payload.lr_scheduler)) {
    payload.lr_scheduler_type = payload.lr_scheduler;
    payload.lr_scheduler = 'constant';
  }
}

function normalizeOptimizerArgs(payload) {
  // frontier_optimizer_candidate / _product_candidate_enabled / _allowlist 三个键
  // 已随门闸从 schema 与后端一起删除。这里不留"兼容旧草稿"的搬运代码：payload 由
  // collectVisiblePayload 严格按 schema section 生成，非 schema 键根本进不来；旧草稿
  // 里的残值也在 mergeConfigPatch 的 `if (!field) continue` 处就被丢掉。写在这里的
  // 迁移分支恒不执行，只会让人以为迁移做过了 —— 真要迁移得落在草稿加载那一层。

  // opt_* 专属字段 → optimizer_args 行（OPT_FIELD_ARG_KEYS 展开）。plugin/generic
  // 路线的第一层 opt_* 字段同样对用户可见（isOpt 含 pytorch_optimizer.* 门控），
  // 值必须折进 optimizer_args，否则是「可见但提交即弃」的假旋钮（2026-08 透传审计
  // 修复）；不在 OPT_FIELD_ARG_KEYS 里的 opt_*（如提示字段）仍被剥除。
  const collectSpecificArgs = () => {
    const specificArgs = [];
    for (const [fieldKey, argName] of Object.entries(OPT_FIELD_ARG_KEYS)) {
      const val = payload[fieldKey];
      if (val != null && val !== '') specificArgs.push(`${argName}=${val}`);
    }
    return specificArgs;
  };
  // opt_* 临时字段统一剥除（尾部清理的提前版）：plugin/generic 早退分支原本
  // 跳过尾部清理，isOpt('…','pytorch_optimizer.x') 点亮的第一层 opt_* 专属字段
  // 会原样漏进出站 payload（后端 extra=ignore 静默丢弃 = 垃圾键）。
  const purgeOptFields = () => {
    for (const key of Object.keys(payload)) {
      if (key.startsWith('opt_')) delete payload[key];
    }
  };

  const rawOptimizerType = String(payload.optimizer_type || '').trim();
  const pluginOptimizerMatch = rawOptimizerType.match(/^PytorchOptimizer[:/](.+)$/i)
    || rawOptimizerType.match(/^pytorch_optimizer\.(.+)$/i);
  if (pluginOptimizerMatch) {
    const pluginOptimizerName = pluginOptimizerMatch[1].trim();
    payload.optimizer_type = 'PytorchOptimizer';
    const lines = argLines(payload.optimizer_args_custom);
    const hasNameArg = lines.some((line) => /^\s*(name|optimizer_name|optimizer)\s*=/.test(line));
    const base = hasNameArg ? lines : ['name=' + pluginOptimizerName, ...lines];
    payload.optimizer_args = [...base, ...collectSpecificArgs()];
    delete payload.prodigy_d0;
    delete payload.prodigy_d_coef;
    delete payload.optimizer_args_custom;
    purgeOptFields();
    return;
  }

  const genericOptimizerMatch = rawOptimizerType.match(/^GenericOptimizer[:/](.+)$/i)
    || rawOptimizerType.match(/^(bitsandbytes\.optim\..+)$/i);
  if (genericOptimizerMatch) {
    const genericOptimizerName = genericOptimizerMatch[1].trim();
    payload.optimizer_type = 'GenericOptimizer';
    const lines = argLines(payload.optimizer_args_custom);
    const hasNameArg = lines.some((line) => /^\s*(name|optimizer_name|optimizer)\s*=/.test(line));
    const base = hasNameArg ? lines : ['name=' + genericOptimizerName, ...lines];
    payload.optimizer_args = [...base, ...collectSpecificArgs()];
    delete payload.prodigy_d0;
    delete payload.prodigy_d_coef;
    delete payload.optimizer_args_custom;
    purgeOptFields();
    return;
  }

  const optimizerKey = String(payload.optimizer_type || '').trim().toLowerCase();
  const isProdigy = optimizerKey === 'prodigy';
  const isProdigyPlus = optimizerKey === 'prodigyplus.prodigyplusschedulefree';
  if (isProdigy || isProdigyPlus) {
    const args = [];
    if (isProdigy) {
      args.push('decouple=True');
      args.push('weight_decay=0.01');
    }
    args.push('use_bias_correction=True');
    const dCoef = String(payload.prodigy_d_coef || '2.0').trim();
    if (dCoef && dCoef !== '0') args.push('d_coef=' + dCoef);
    const d0 = String(payload.prodigy_d0 || '').trim();
    if (d0 && d0 !== '' && d0 !== '0') args.push('d0=' + d0);
    payload.optimizer_args = appendCustomArgs(args, payload.optimizer_args_custom);
  } else if (payload.optimizer_type && ['DAdaptation', 'DAdaptAdam', 'DAdaptLion'].includes(payload.optimizer_type)) {
    // DAdapt 系 UI 旋钮（opt_dadapt_d0 / opt_dadapt_growth_rate，OPT_FIELD_ARG_KEYS
    // 展开）随 decouple 一起折进 optimizer_args：后端 DAdaptation 只从 optimizer_args
    // 读参，此前只发 decouple=True 等于这两个旋钮静默失效（2026-08 透传审计修复）。
    const specificArgs = [];
    for (const [fieldKey, argName] of Object.entries(OPT_FIELD_ARG_KEYS)) {
      const val = payload[fieldKey];
      if (val != null && val !== '') specificArgs.push(`${argName}=${val}`);
    }
    payload.optimizer_args = appendCustomArgs(['decouple=True', ...specificArgs], payload.optimizer_args_custom);
  } else {
    // 收集 opt_* 专属字段组装 args
    const specificArgs = [];
    for (const [fieldKey, argName] of Object.entries(OPT_FIELD_ARG_KEYS)) {
      const val = payload[fieldKey];
      if (val != null && val !== '') specificArgs.push(`${argName}=${val}`);
    }
    const customArgs = argLines(payload.optimizer_args_custom);
    if (specificArgs.length > 0 || customArgs.length > 0) {
      payload.optimizer_args = appendCustomArgs(specificArgs, payload.optimizer_args_custom);
    }
  }
  delete payload.prodigy_d0;
  delete payload.prodigy_d_coef;
  delete payload.optimizer_args_custom;
  // 清理所有 opt_* 临时字段
  purgeOptFields();
}

function normalizeLycorisNetworkArgs(payload, typeId) {
  const rawNetworkModule = String(payload.network_module || '').trim().toLowerCase();
  const isOftAlias = OFT_MODULE_ALIASES.has(rawNetworkModule);
  const isLycoris = LYCORIS_MODULE_ALIASES.has(rawNetworkModule) || isOftAlias;

  if (isOftAlias) {
    payload.network_module = 'lycoris.kohya';
    payload.lycoris_algo = 'diag-oft';
  } else if (LYCORIS_MODULE_ALIASES.has(rawNetworkModule)) {
    payload.network_module = 'lycoris.kohya';
  }

  if (!isLycoris || typeId.startsWith('anima')) {
    const customLines = String(payload.network_args_custom || '')
      .trim()
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (customLines.length > 0) {
      payload.network_args = [...(payload.network_args || []), ...customLines];
    }
    delete payload.network_args_custom;
    return;
  }

  const networkArgs = [];
  let algo = String(payload.lycoris_algo || 'locon').trim().toLowerCase().replace(/_/g, '-');
  if (!SUPPORTED_LYCORIS_ALGOS.has(algo)) algo = 'locon';
  payload.lycoris_algo = algo;
  networkArgs.push('algo=' + algo);
  if (payload.conv_dim != null && String(payload.conv_dim) !== '') {
    payload.lycoris_conv_dim = payload.conv_dim;
    networkArgs.push('conv_dim=' + payload.conv_dim);
  }
  if (payload.conv_alpha != null && String(payload.conv_alpha) !== '') {
    payload.lycoris_conv_alpha = payload.conv_alpha;
    networkArgs.push('conv_alpha=' + payload.conv_alpha);
  }
  if (payload.lycoris_preset != null && String(payload.lycoris_preset).trim() !== '') networkArgs.push('preset=' + String(payload.lycoris_preset).trim());
  if (payload.dropout != null && Number(payload.dropout) > 0) {
    payload.network_dropout = payload.dropout;
    networkArgs.push('dropout=' + payload.dropout);
  }
  if (payload.rank_dropout != null && String(payload.rank_dropout) !== '' && Number(payload.rank_dropout) > 0) {
    payload.lokr_rank_dropout = payload.rank_dropout;
    networkArgs.push('rank_dropout=' + payload.rank_dropout);
  }
  if (payload.module_dropout != null && String(payload.module_dropout) !== '' && Number(payload.module_dropout) > 0) {
    payload.lokr_module_dropout = payload.module_dropout;
    networkArgs.push('module_dropout=' + payload.module_dropout);
  }
  if (payload.train_norm != null) {
    payload.lycoris_train_norm = Boolean(payload.train_norm);
    networkArgs.push('train_norm=' + (payload.train_norm ? 'True' : 'False'));
  }
  if (payload.use_tucker) networkArgs.push('use_tucker=True');
  if (payload.use_scalar) networkArgs.push('use_scalar=True');
  if (payload.block_size != null && String(payload.block_size) !== '' && Number(payload.block_size) > 0) networkArgs.push('block_size=' + payload.block_size);
  if (payload.rescaled) networkArgs.push('rescaled=True');
  if (payload.constraint != null && String(payload.constraint) !== '') networkArgs.push('constraint=' + payload.constraint);
  if (payload.rs_lora) networkArgs.push('rs_lora=True');
  if (algo === 'lokr' && payload.lokr_factor != null) {
    payload.lycoris_lokr_factor = payload.lokr_factor;
    networkArgs.push('factor=' + payload.lokr_factor);
  }
  if (algo === 'lokr' && payload.decompose_both) {
    payload.lokr_decompose_both = true;
    networkArgs.push('decompose_both=True');
  }
  if (algo === 'lokr' && payload.full_matrix) {
    payload.lokr_full_matrix = true;
    networkArgs.push('full_matrix=True');
  }
  if (algo === 'lokr' && payload.unbalanced_factorization) {
    payload.lokr_unbalanced_factorization = true;
    networkArgs.push('unbalanced_factorization=True');
  }
  // 后端第一方 LyCORIS 注入器只消费显式配置字段（lokr_*/glora_*/train_norm 等），
  // network_args 仅被解析 rs_lora/train_llm_adapter。dora_wd/wd_on_output/
  // bypass_mode 写进 network_args 是零接收者的惰性输出，且 LyCORIS 注入链先于
  // use_dora 分派（DoRA 在该路线被整体忽略）——这里一律不再生成，UI 键直接清除。
  const customLines = String(payload.network_args_custom || '')
    .trim()
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  payload.network_args = [...networkArgs, ...customLines];

  for (const key of [
    'conv_dim', 'conv_alpha', 'lycoris_preset', 'dropout',
    'rank_dropout', 'module_dropout', 'train_norm', 'use_tucker', 'use_scalar',
    'block_size', 'rescaled', 'constraint', 'rs_lora', 'lokr_factor', 'dora_wd',
    'wd_on_output', 'bypass_mode', 'decompose_both', 'full_matrix',
    'unbalanced_factorization', 'enable_base_weight',
    'network_args_custom',
  ]) {
    delete payload[key];
  }
}

function normalizeListTextareas(payload) {
  // target_modules：后端 recipe 契约只收数组（contracts/training_recipe.py:118
  // _string_list 对字符串按单元素包裹、不切分）——提交层负责把 textarea 切成数组；
  // 空值不出站（空 = 按训练类型的默认目标预设）。
  if (typeof payload.target_modules === 'string') {
    const modules = payload.target_modules.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    if (modules.length > 0) payload.target_modules = modules;
    else delete payload.target_modules;
  }
  if (payload.enable_base_weight) {
    if (payload.base_weights && typeof payload.base_weights === 'string') {
      const lines = payload.base_weights.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
      payload.base_weights = lines.length > 0 ? lines : undefined;
    }
    if (payload.base_weights_multiplier && typeof payload.base_weights_multiplier === 'string') {
      const lines = payload.base_weights_multiplier.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
      payload.base_weights_multiplier = lines.length > 0 ? lines.map(Number).filter((value) => !Number.isNaN(value)) : undefined;
    }
  } else {
    delete payload.base_weights;
    delete payload.base_weights_multiplier;
  }
  delete payload.enable_base_weight;

  if (payload.lr_scheduler_args && typeof payload.lr_scheduler_args === 'string') {
    const lines = argLines(payload.lr_scheduler_args);
    payload.lr_scheduler_args = lines.length > 0 ? lines : undefined;
    if (!payload.lr_scheduler_args) delete payload.lr_scheduler_args;
  }

  if (payload.newbie_target_modules && typeof payload.newbie_target_modules === 'string') {
    const cleaned = payload.newbie_target_modules.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    payload.newbie_target_modules = cleaned || undefined;
  }
}

function _truthyFlag(value) {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'on';
}

function _normalizeAttentionId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'flash' || raw === 'flashattn' || raw === 'flashattention' || raw === 'flashattention2' || raw === 'fa2') {
    return 'flash2';
  }
  if (raw === 'sage' || raw === 'sageattention') return 'sageattn';
  if (raw === 'flex' || raw === 'flexattention') return 'flexattn';
  return raw;
}


// attention backend 只有到运行时才解析得出的取值。后端把它们和 flash2 一样当作
// "意图仍然有效"，因为 auto 完全可能解析成 flash2。
const RUNTIME_RESOLVED_ATTENTION_BACKENDS = new Set(['', 'auto', 'default']);

// 权威来源：backend/core/lulynx_trainer/config_adapter_main_runtime_fields.py:274-295
// normalize_runtime_fields() 对 anima_vram_optimizer 有三条分支，前端必须逐条对齐：
//   flash2            → 保留意图 + packed varlen + 最省显存 checkpointing
//   ''/auto/default   → 保留意图，但不预先钉死 packed；由
//                       anima/anima_dit_runtime_guardrails.py:137-157 用运行时真正
//                       解析出的 backend 做最终判定（不是 flash2 就降级并写日志）
//   其它显式 backend  → 安全降级：意图关闭 + packed dense
// 未开启              → 关闭 + dense（对齐后端 elif 分支）
function normalizeAnimaVramOptimizer(payload) {
  const enabled = _truthyFlag(payload.anima_vram_optimizer);
  const backend = _normalizeAttentionId(payload.attention_backend);
  const backendKeepsIntent = backend === 'flash2' || RUNTIME_RESOLVED_ATTENTION_BACKENDS.has(backend);
  if (!enabled || !backendKeepsIntent) {
    payload.anima_vram_optimizer = false;
    payload.anima_packed_attention_backend = 'dense';
    return;
  }
  payload.anima_vram_optimizer = true;
  if (backend !== 'flash2') {
    // backend 尚未定下来：packed 维持保守的 dense，等 runtime guardrail 解析出
    // flash2 时再升级成 flash2_varlen。提交层若在这里抢先钉 flash2_varlen / 强制
    // checkpointing，等于替运行时下了只有它有资格下的判断。
    payload.anima_packed_attention_backend = 'dense';
    return;
  }
  payload.anima_packed_attention_backend = 'flash2_varlen';
  payload.anima_block_checkpointing = true;
  payload.anima_block_checkpointing_mode = 'block';
  payload.anima_block_checkpointing_interval = 1;
}
function normalizeAttention(payload) {
  // Advanced overrides win; no-intent path stays auto so launcher runtime
  // default_attention_backend can apply. Bare schema sdpa=true alone is not intent.
  const flashOn = _truthyFlag(payload.flashattn);
  const sageOn = _truthyFlag(payload.sageattn);
  const xformersOn = _truthyFlag(payload.xformers);
  const memEffOn = _truthyFlag(payload.mem_eff_attn);
  const useSdpaOn = _truthyFlag(payload.use_sdpa);
  const fromMode = _normalizeAttentionId(payload.attn_mode || payload.anima_attn_mode);
  const fromBackend = _normalizeAttentionId(payload.attention_backend);
  let backend = '';

  if (flashOn || fromMode === 'flash2' || fromBackend === 'flash2') {
    backend = 'flash2';
    payload.flashattn = true;
  } else if (sageOn || fromMode === 'sageattn' || fromBackend === 'sageattn') {
    backend = 'sageattn';
    payload.sageattn = true;
  } else if (xformersOn || memEffOn || fromMode === 'xformers' || fromBackend === 'xformers') {
    backend = 'xformers';
    if (xformersOn) payload.xformers = true;
  } else if (useSdpaOn || fromMode === 'sdpa' || fromBackend === 'sdpa') {
    // Explicit advanced/use_sdpa or non-auto backend/mode only — not bare sdpa boolean default.
    if (useSdpaOn || (fromBackend === 'sdpa') || (fromMode === 'sdpa')) {
      backend = 'sdpa';
    }
  } else if (fromBackend && fromBackend !== 'auto') {
    backend = fromBackend;
  } else if (fromMode && fromMode !== 'auto') {
    backend = fromMode;
  }

  if (!backend) backend = 'auto';

  payload.attention_backend = backend;
  if (backend === 'flash2') {
    if (payload.attn_mode !== undefined) payload.attn_mode = 'flash2';
    if (payload.anima_attn_mode !== undefined) payload.anima_attn_mode = 'flash2';
  } else if (backend === 'auto') {
    // Keep empty/auto modes so resolver can follow profile default.
    if (payload.attn_mode === 'sdpa') payload.attn_mode = 'auto';
    if (payload.anima_attn_mode === 'sdpa') payload.anima_attn_mode = 'auto';
  }

  // Only clear conflicting toggles when an explicit non-auto backend was chosen.
  if (backend !== 'auto') {
    if (payload.attention_backend !== 'xformers') payload.xformers = false;
    if (payload.attention_backend !== 'sageattn' && payload.attention_backend !== 'sageattention') payload.sageattn = false;
    if (payload.attention_backend !== 'flash2') payload.flashattn = false;
    if (payload.attention_backend !== 'sdpa') payload.sdpa = false;
  } else {
    // Default path: do not force any boolean on; leave advanced toggles as-is if user set them.
    if (!flashOn) payload.flashattn = false;
    if (!sageOn) payload.sageattn = false;
    if (!xformersOn) payload.xformers = false;
    // Never treat bare sdpa schema default as selected.
    if (!_truthyFlag(payload.sdpa) || (!useSdpaOn && fromBackend !== 'sdpa' && fromMode !== 'sdpa')) {
      payload.sdpa = false;
    }
  }
}

function normalizeAdapterEnabledFlags(payload) {
  // 适配器实体硬互斥：对齐 lora_injector elif + 独立 injector 路径。
  // 含 lora_type→enabled、实体二选一、DoRA/AdaLoRA 仅 default、BlockSkip vs Adaptive Caching、
  // TurboCore CUDA vs Triton optimizer mode。
  normalizeAdapterEntityMutex(payload);
}

function normalizeExecutionCore(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'turbocore_enabled')) {
    delete payload.execution_core;
    return;
  }
  if (payload.turbocore_enabled === true) {
    payload.execution_core = 'turbo';
  } else {
    payload.execution_core = 'standard';
  }
}

function nativeRuntimeArch(payload, typeId) {
  const route = String(typeId || payload.model_train_type || '').trim().toLowerCase().replaceAll('_', '-');
  const explicit = String(payload.concept_edit_base_model || payload.model_type || '').trim().toLowerCase();
  if (route === 'concept-edit' && ['anima', 'newbie', 'sdxl'].includes(explicit)) return explicit;
  if (route.includes('anima')) return 'anima';
  if (route.includes('newbie')) return 'newbie';
  if (route.includes('sdxl')) return 'sdxl';
  if (['anima', 'newbie', 'sdxl'].includes(explicit)) return explicit;
  return '';
}

function normalizeNativeRuntimeProfile(payload, typeId) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'native_runtime_profile')) return;
  const arch = nativeRuntimeArch(payload, typeId);
  const allowed = arch === 'anima'
    ? new Set(['standard', 'aggressive', 'anima_fast', 'anima_low_vram', 'anima_experimental'])
    : arch === 'newbie'
      ? new Set(['standard', 'aggressive', 'anima_fast'])
      : arch === 'sdxl'
        ? new Set(['standard', 'aggressive'])
        : new Set();
  const profile = String(payload.native_runtime_profile || 'standard').trim().toLowerCase();
  if (allowed.size === 0) {
    delete payload.native_runtime_profile;
  } else {
    payload.native_runtime_profile = allowed.has(profile) ? profile : 'standard';
  }
}

function normalizeTurboCoreProfile(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'turbocore_profile')) return;
  const profile = String(payload.turbocore_profile || 'basic').trim().toLowerCase();
  payload.turbocore_profile = profile === 'fast' ? 'fast' : 'basic';
}

function normalizeTheoryVariantAliases(payload) {
  const p2Aliases = { standard: 'p2', structure: 'lulynx_structure', detail: 'lulynx_detail' };
  if (payload.p2_weighting_mode && p2Aliases[payload.p2_weighting_mode]) {
    payload.p2_weighting_mode = p2Aliases[payload.p2_weighting_mode];
  }
  const doraAliases = {
    standard: 'classic',
    default: 'classic',
    dora: 'classic',
    set: 'lulynx_stopgrad_dora',
    set_dora: 'lulynx_stopgrad_dora',
    setdora: 'lulynx_stopgrad_dora',
    stabilized: 'lulynx_stopgrad_dora',
    lulynx_set_dora: 'lulynx_stopgrad_dora',
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'dora_variant')) {
    const dora = String(payload.dora_variant || 'classic').trim().toLowerCase();
    payload.dora_variant = doraAliases[dora] || (dora === 'lulynx_stopgrad_dora' ? dora : 'classic');
  }
  // dora_mode 旧值收敛（后端复核 2026-08）：运行时 DoRALinear._normalize_mode
  // （lulynx/dora_layer.py:103-119）只区分 full/style/structure；wd 是 full 的
  // 别名，split/merged 属未知值（告警后兜回 full）。提交前统一到真实支持域；
  // dora_wd=true 时下游互斥仍会按后端 config_adapter.py:516 的 setdefault 语义
  // 写回 dora_mode='wd'，与服务器侧行为逐字一致。
  if (Object.prototype.hasOwnProperty.call(payload, 'dora_mode')) {
    const rawMode = String(payload.dora_mode || 'full').trim().toLowerCase().replaceAll('-', '_');
    const doraModeAliases = { wd: 'full', weight_decomposed: 'full', split: 'full', merged: 'full' };
    payload.dora_mode = ['full', 'style', 'structure'].includes(rawMode) ? rawMode : (doraModeAliases[rawMode] || 'full');
  }
  if (payload.dp_dmd_variant) {
    payload.dp_dmd_variant = String(payload.dp_dmd_variant).trim().toLowerCase() === 'standard'
      ? 'standard'
      : 'lulynx_optimized';
  }
  if (payload.svd_grad_proj_enabled != null || payload.svd_grad_proj_rank != null) {
    payload.lulynx_svd_gradient_filter_enabled = Boolean(
      payload.lulynx_svd_gradient_filter_enabled ?? payload.svd_grad_proj_enabled
    );
    if (payload.lulynx_svd_gradient_filter_rank == null && payload.svd_grad_proj_rank != null) {
      payload.lulynx_svd_gradient_filter_rank = Number(payload.svd_grad_proj_rank);
    }
    if (payload.lulynx_svd_gradient_filter_update_interval == null && payload.svd_grad_proj_update_interval != null) {
      payload.lulynx_svd_gradient_filter_update_interval = Number(payload.svd_grad_proj_update_interval);
    }
    if (payload.lulynx_svd_gradient_filter_scale == null && payload.svd_grad_proj_scale != null) {
      payload.lulynx_svd_gradient_filter_scale = Number(payload.svd_grad_proj_scale);
    }
    if (payload.lulynx_svd_gradient_filter_warmup_steps == null && payload.svd_grad_proj_warmup_steps != null) {
      payload.lulynx_svd_gradient_filter_warmup_steps = Number(payload.svd_grad_proj_warmup_steps);
    }
    delete payload.svd_grad_proj_enabled;
    delete payload.svd_grad_proj_rank;
    delete payload.svd_grad_proj_update_interval;
    delete payload.svd_grad_proj_scale;
    delete payload.svd_grad_proj_warmup_steps;
    delete payload.svd_grad_proj_target;
  }
}

// B7（第 3 站审计）：MiniMax-H3 swap>0 时后端硬性要求 unsloth checkpointing
// （configs_h3.py:105-109 ValueError）。UI 只 disable 非 unsloth 选项但不改值，
// 「先选 selective 再把 swap 调 >0」的草稿仍会带病提交 → 提交层联动复位。
function normalizeMiniMaxH3SwapCheckpoint(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'h3_blocks_to_swap')) return;
  if (Number(payload.h3_blocks_to_swap || 0) <= 0) return;
  if (payload.h3_checkpoint_mode && payload.h3_checkpoint_mode !== 'unsloth') {
    payload.h3_checkpoint_mode = 'unsloth';
  }
}

// B（第 6 站桶）：krea2_vram_preset=aggressive 的槽位覆写此前被前端 always-submit
// 的 standard 档默认值短路——后端只在「用户未显式设置」时才按预设覆写
// slots/prefetch/pin（configs.py:341-347 的 model_fields_set 判断），而前端在
// residency=block_offload 下恒显式提交 4/2/true ⇒ 选 aggressive 后三键仍是
// standard 档。提交层对齐预设语义：aggressive 且三键仍是「未触碰的注入默认」时
// 不出站，让后端预设真正生效；用户显式改过的值照常透传——含「改回 standard 档
// 数值」的意图，此时剥除会让预设覆写掉用户要的 4/2/true。
// 「未触碰」判定走调用方注入的 explicitKeys（TrainPage/WizardPage 的
// markExplicit 通道）：草稿是纯值袋子，schema 默认值与用户手填的默认值同形，
// 只有编辑来源能区分二者。
function normalizeKrea2VramPreset(payload, explicitKeys) {
  if (String(payload.krea2_vram_preset || '').trim().toLowerCase() !== 'aggressive') return;
  const standardDefaults = {
    krea2_block_offload_gpu_slots: 4,
    krea2_block_offload_prefetch_depth: 2,
    krea2_block_offload_pin_memory: true,
  };
  for (const [key, value] of Object.entries(standardDefaults)) {
    if (payload[key] !== value) continue;
    if (explicitKeys && explicitKeys.has(key)) continue;
    delete payload[key];
  }
}

function removeUiOnlyFields(payload) {  // F-purge: evo legacy draft key wan22_tower_choice -> configs wan22_noise_stage
  if (payload && payload.wan22_tower_choice != null && (payload.wan22_noise_stage == null || payload.wan22_noise_stage === '')) {
    payload.wan22_noise_stage = payload.wan22_tower_choice;
  }
  if (payload) delete payload.wan22_tower_choice;

  if (payload && payload.ui_custom_params != null && String(payload.ui_custom_params).trim() && !payload.custom_toml) {
    payload.custom_toml = payload.ui_custom_params;
  }
  if (payload) delete payload.ui_custom_params;
  if (payload) delete payload.lulynx_experimental_core_enabled;

  // ── BlockWeight 双 master 归一（schemaFieldGroups.S_LULYNX_SDXL 注释同源）──────
  // lulynx_* 是旧草稿兼容别名：非空即视为迁移前用户数据，覆盖标准键后剥除，
  // 保证 payload 只剩 enable_block_weights + down/mid/up_lr_weight 一套表示。
  // 新配置里 lulynx_* 恒为空默认，不会干扰标准键。
  const blockWeightOn = payload.enable_block_weights === true
    || payload.lulynx_block_weight_enabled === true;
  if (payload.lulynx_down_lr_weight) payload.down_lr_weight = payload.lulynx_down_lr_weight;
  if (payload.lulynx_mid_lr_weight) payload.mid_lr_weight = payload.lulynx_mid_lr_weight;
  if (payload.lulynx_up_lr_weight) payload.up_lr_weight = payload.lulynx_up_lr_weight;
  if (payload.lulynx_block_lr_zero_threshold) {
    payload.block_lr_zero_threshold = payload.lulynx_block_lr_zero_threshold;
  }
  delete payload.lulynx_block_weight_enabled;
  delete payload.lulynx_down_lr_weight;
  delete payload.lulynx_mid_lr_weight;
  delete payload.lulynx_up_lr_weight;
  delete payload.lulynx_block_lr_zero_threshold;

  if (!blockWeightOn) {
    delete payload.down_lr_weight;
    delete payload.mid_lr_weight;
    delete payload.up_lr_weight;
    delete payload.block_lr_zero_threshold;
  }
  // BlockWeight 激活键出站（2026-08 透传审计修复）：后端训练器硬门在
  // bw_enable（trainer/trainer_prepare_block_weight_mixin.py:37
  // getattr(self.config,'bw_enable',False)），而 bw_enable 只能由 payload 的
  // enable_block_weights / lulynx_block_weight_enabled 折算
  // （config_adapter_training_shared.py:175-178、training_route_service.py:387
  // copy_first）——这两个 UI 键又被本函数剥除，导致分层学习率配好权重也永远
  // 静默失效。提交层直接写后端规范键 bw_enable（configs_monitoring.py:392）。
  if (blockWeightOn) payload.bw_enable = true;
  delete payload.enable_block_weights;
  delete payload.train_length_mode;
  delete payload.enable_inference_accel;

  // sdxl_fixed_block_swap 死守卫修复：后端 preflight/route-contract 读的是
  // sdxl_fixed_block_swap（training_config_checks.py:192 / route contract），而真实
  // 配置字段是 sdxl_low_vram_fixed_block_swap 且无别名桥接 —— 守卫永远读到空。
  // 提交层补写镜像，让既有守卫真正生效（UnifiedTrainingConfig extra=allow 接受）。
  if (payload.sdxl_low_vram_optimization === true) {
    payload.sdxl_fixed_block_swap = payload.sdxl_low_vram_fixed_block_swap !== false;
  } else {
    delete payload.sdxl_fixed_block_swap;
  }

  // finetune train_text_encoder 显式 master：queue_support.py 以
  // network_train_unet_only = not train_text_encoder 派生；两键必须一致出站，
  // 避免三方默认打架（schema False / shim True / 前端隐式）。
  if (Object.prototype.hasOwnProperty.call(payload, 'train_text_encoder')) {
    payload.network_train_unet_only = !payload.train_text_encoder;
    payload.network_train_text_encoder_only = false;
  }

  for (const key of PHANTOM_KEYS) delete payload[key];

  const initStrategy = String(payload.adapter_init_strategy || payload.init_lora_weights || 'default').trim().toLowerCase();
  const pissaStrategy = initStrategy === 'pissa' || Boolean(payload.pissa_init) || Boolean(payload.pissa_enabled);
  if (pissaStrategy) {
    payload.adapter_init_strategy = 'pissa';
    payload.pissa_init = true;
    payload.pissa_enabled = true;
    // UI 历史键 → 后端 master 键。中文导出 label→枚举的映射已上移到草稿层
    // （configStore.LEGACY_VALUE_MIGRATIONS），schema 选项本身也已枚举化，
    // 这里不再保留第二份映射。
    if (payload.pissa_method && !payload.pissa_svd_algo) {
      payload.pissa_svd_algo = payload.pissa_method;
    }
    if (payload.pissa_niter != null && payload.pissa_niter !== '' && (payload.pissa_init_iters == null || payload.pissa_init_iters === '')) {
      payload.pissa_init_iters = payload.pissa_niter;
    }
  }
  if (!pissaStrategy) {
    delete payload.pissa_method;
    delete payload.pissa_niter;
    delete payload.pissa_init_iters;
    delete payload.pissa_svd_algo;
    delete payload.pissa_oversample;
    delete payload.pissa_apply_conv2d;
    delete payload.pissa_export_mode;
    delete payload.pissa_cache_mode;
    delete payload.pissa_enabled;
  }
  if (!payload.adapter_init_strategy || payload.adapter_init_strategy === 'default') {
    delete payload.adapter_init_export_mode;
    delete payload.loftq_bits;
    delete payload.loftq_quant_type;
  } else if (payload.adapter_init_strategy !== 'loftq') {
    delete payload.loftq_bits;
    delete payload.loftq_quant_type;
  }
  if (!payload.lr_scheduler_type || !payload.lr_scheduler_type.trim()) delete payload.lr_scheduler_type;
  if (payload.huber_schedule === '') delete payload.huber_schedule;
}

// 分层 Alpha：把 anima 的 5 个按组 alpha 字段 + 开关合成为后端单个
// network_alpha_map_json（JSON {组名: alpha}）。只收录非空的组；enabled 关或
// 无任何非空组 -> 不写 network_alpha_map_json -> 后端用全局 network_alpha = parity。
const LAYERED_ALPHA_GROUP_KEYS = [
  ['alpha_self_attn', 'self_attn'],
  ['alpha_cross_attn', 'cross_attn'],
  ['alpha_mlp', 'mlp'],
  ['alpha_adaln', 'adaln_modulation'],
  ['alpha_llm_adapter', 'llm_adapter'],
];
function normalizeLayeredAlpha(payload) {
  const hasGroupedAlphaControls = Object.prototype.hasOwnProperty.call(payload, 'layered_alpha_enabled')
    || LAYERED_ALPHA_GROUP_KEYS.some(([fieldKey]) => Object.prototype.hasOwnProperty.call(payload, fieldKey));
  if (!hasGroupedAlphaControls) return;

  const enabled = Boolean(payload.layered_alpha_enabled);
  delete payload.layered_alpha_enabled;
  const groupAlpha = {};
  for (const [fieldKey, groupName] of LAYERED_ALPHA_GROUP_KEYS) {
    const raw = payload[fieldKey];
    delete payload[fieldKey];
    if (!enabled || raw === '' || raw == null) continue;
    const value = Number(raw);
    if (!Number.isNaN(value) && value > 0) groupAlpha[groupName] = value;
  }
  if (enabled && Object.keys(groupAlpha).length > 0) {
    payload.network_alpha_map_json = JSON.stringify(groupAlpha);
  } else {
    delete payload.network_alpha_map_json;
  }
}

function normalizeUniversalDitRoute(payload) {
  if (payload.universal_dit_enabled) {
    // Universal DiT is an internal architecture override for the existing
    // LoRA route, not a new training type or a separate UI entry.
    payload.model_type = 'universal_dit';
  }
}

export function buildRunConfigFromSections(config, typeId, hooks) {
  const { getSectionsForType, isFieldVisible } = hooks;
  // explicitKeys：调用方注入的「用户显式编辑过」键集（可省略，见
  // normalizeKrea2VramPreset）。
  const explicitKeys = hooks && hooks.explicitKeys;
  const resolvedTypeId = typeId || config.model_train_type || 'sdxl-lora';
  const payload = collectVisiblePayload(config, resolvedTypeId, getSectionsForType, isFieldVisible);
  for (const key of ['semantic_region_weighting_enabled', 'semantic_segmentation_provider', 'semantic_segmentation_model_path']) {
    if (key in config) payload[key] = config[key];
  }
  normalizeExecutionCore(payload);
  normalizeNativeRuntimeProfile(payload, resolvedTypeId);
  normalizeTurboCoreProfile(payload);
  normalizeTheoryVariantAliases(payload);
  normalizeScheduler(payload);
  normalizeOptimizerArgs(payload);
  normalizeLycorisNetworkArgs(payload, resolvedTypeId);
  normalizeListTextareas(payload);
  normalizeAdapterEnabledFlags(payload);
  removeUiOnlyFields(payload);
  // 类型域剥除放在全局 PHANTOM 之后：两处都命中时结果一致，顺序仅影响可读性。
  if (resolvedTypeId === 'flux-lora') {
    for (const key of FLUX_LORA_DEAD_FLOW_KEYS) delete payload[key];
  }
  if (resolvedTypeId.startsWith('krea2')) normalizeKrea2VramPreset(payload, explicitKeys);
  normalizeMiniMaxH3SwapCheckpoint(payload);
  normalizeAttention(payload);
  normalizeAnimaVramOptimizer(payload);
  normalizeLayeredAlpha(payload);
  normalizeUniversalDitRoute(payload);
  return payload;
}
