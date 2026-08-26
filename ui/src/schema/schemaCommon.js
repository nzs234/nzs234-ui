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

// ── DoRA 权重分解叠加规则：按模型家族的能力矩阵（单一事实源）──────────────────
// 不同模型族的训练代码不同，DoRA 可叠加性必须逐管线实证，不允许跨族推断。
//
// SDXL 管线实证结论（backend 源码行号为 2026-08 审计记录）：
//   - 注入优先级链 trainer_prepare_adapter_inject_mixin.py:198-214 是 else-if：
//     LyCORIS 分支(:203)先于 use_dora 分派(:211)，注入后无任何二次包装路径；
//     _inject_lycoris_adapter(trainer_prepare_specialized_adapter_mixin.py:261-332)
//     只消费显式 LyCORISConfig 字段，而 LyCORISConfig(lycoris_types.py:21-74)
//     与第一方 LoKrLayer/LoHaLayer(lycoris_lokr.py / lycoris_loha.py) 全无
//     weight-decompose 代码；triton apply_dora(triton_inject_adapters.py:207)
//     只加速已存在的 DoRALinear 且当前零调用点。
//   - 训练环境里虽装有上游 lycoris_lora 3.4.0（其 wrapper.py:76/kohya.py:59 支持
//     network_args dora_wd → LokrLayer/LoHaLayer 权重分解），但 backend/core 全仓
//     零 import —— 上游能力未接线，属后端缺口而非可用路径。
//   - dora_wd 只有作为顶层配置字段才被消费（config_adapter.py:511-517 /
//     config_adapter_normalizers.py:467-473 / training_route_service.py:334-339：置
//     use_dora=dora_enabled=True、dora_mode='wd'、强制 bypass_mode=False），语义是
//     Weight-Decomposed 别名，不是权重衰减（后者是 dora_magnitude_weight_decay）。
//   - network_args 仅被解析 rs_lora（advanced_optimizer_strategy.py:44-72,132）与
//     train_llm_adapter 等预览键；dora_wd=/wd_on_output=/algo= 零接收者。
//   - 原生 networks.lora 路线三个触发键等价：use_dora / dora_enabled / dora_wd
//     （test_training_route_closure.py:343-360 断言 sdxl+networks.lora+dora_wd 到达
//     native DoRA injector 旗标）。
// 结论（sdxl 行）：仅原生 lora family 可叠加；lokr/loha/locon/glora/glokr/
// ia3/full/diag-oft 一律不可叠加。
//
// ANIMA 管线实证结论（2026-08 第 2 站审计，backend 源码行号同期记录）：
//   - Anima LoRA 与 SDXL 共用同一 LulynxTrainer 注入链（entry_train.py:766-768：
//     仅 ip_adapter/anima_controlnet/controlnet/lllite/flux_lora 走专属训练器），
//     else-if 短路与 SDXL 同构：inject mixin:203 LyCORIS 分支先于 :211 use_dora
//     分派；_inject_lycoris_adapter(trainer_prepare_specialized_adapter_mixin.py:
//     261-332) 构造的 LyCORISConfig 无任何 DoRA/weight-decompose 字段，且运行时
//     LyCORISType(lycoris_types.py:9-18) 无 dora → lokr/loha/locon/glora/glokr/
//     ia3/full/diag-oft 路线上的 dora_wd/use_dora 静默无效。closure 测试已固化该
//     组合（test_training_route_closure.py:705-768 断言 anima lora_type=lokr+
//     dora_wd=true 归一为 network_module=lycoris.locon+use_dora=True），证明它
//     到达 trainer 后被 ：203 短路，而非另有 Anima 专属注入路径。
//   - lora_type=dora 双旗标映射真实到达 native injector：ConfigAdapter
//     (config_adapter.py:382-385) → networks.lora+use_dora+dora_enabled →
//     _inject_dora_adapter(:212) / standard 注入器 enable_dora_layers(:397,:411)
//     → LoRAInjector(dora_enabled=True)（specialized mixin:445）。dora_wd 顶层
//     字段由 training_route_service.py:334-339 与 config_adapter.py:511-517 归一
//     为同一组旗标（Anima 页面别名，非权重衰减）；inject mixin:150-183 的
//     adapter_type 二次映射是 newbie 专属分支，Anima 无第二运行时映射。
//   - Anima 产品路径 cache-first 强制（trainer_execution_dataset_setup.py:101-119：
//     raw online 训练直接 RuntimeError）→ TE 注入恒被跳过（inject mixin:297-299），
//     DoRA 只落在 DiT 侧。DoRA 前向 magnitude 分支是通用实现（lora_linear.py:210）；
//     但 opt-in anima_memory_optimizer=true 的 packed 前向把 use_dora 模块列为
//     不兼容并 fail-closed 报错（anima_native_packed_forward.py:172-209，经
//     anima_native_dit_executable.py:484 生效）。
//   - KronA/CDKA 的 krona_weight_decompose/cdka_weight_decompose 是独立于本 rider
//     的另一条分解入口（specialized mixin:482,488），Anima 页面未暴露（后端
//     anima_lora.py 全无 krona/cdka 字段），不改变本行结论。
// 结论（anima 行）：仅原生 lora family 可叠加；LyCORIS 八算法一律不可叠加。
//
// NEWBIE 管线实证结论（2026-08 第 3 站审计，backend 源码行号同期记录）：
//   - Newbie 无专属训练器：entry_train.py:217-241 select_trainer_key 对
//     newbie-lora 走默认 "lulynx" 分派，与 SDXL/ANIMA 共用同一 LulynxTrainer
//     注入链。else-if 短路同构：inject mixin:203 LyCORIS 分支先于 :211 use_dora
//     分派，:205 lora2_adaptive / :208 ed_lora 居中。
//   - newbie 专属运行时二次映射（inject mixin:150-183）只消费 newbie_adapter_type
//     （由 adapter_type 经 field_alias_map.py:110-111 + conversion_runtime:130-131
//     复制而来）：六种 LyCORIS 算法 → is_lycoris=True+lycoris_algo(:156-159)；
//     lora_fa/vera/hydralora/fera → 同名 *_enabled 旗标(:160-171)；tlora → 改写
//     network_module(:172-175)；dora → use_dora+dora_enabled(:176-179)；lora_plus
//     → lora_plus_enabled(:180-182)。转换层等价实现见 config_adapter_conversion_
//     finalize.py:196-230（model_type=="newbie" 守卫）。该映射不改变 rider 主键
//     语义：dora_enabled/use_dora/dora_wd 三旗标在 default LoRA 路线上照常生效
//     （standard 注入器 inject mixin:397 明确 `use_dora or dora_enabled`），仅当
//     二次映射把输入键变成 LyCORIS/实体赢家时才把 DoRA 挤出注入链。
//   - LyCORIS 路线与 SDXL/ANIMA 同一无 DoRA 入口：_inject_lycoris_adapter
//     (specialized mixin:261-332) 构造的 LyCORISConfig 全无 weight-decompose 字段；
//     统一 LoRAInjector 的 elif materialize 链（lora_injector_inject.py:337-497）
//     把全部实体（fera/hydra/vera/lora_fa/mora/tlora/flexrank/reslora/lora2/
//     tensorring/dokr/gdlokr/krona+cdka）排在最终 else 的 LoRALinear(use_dora)
//     (:498-518) 之前 —— 实体赢家下 dora_enabled 静默失效。
//   - KronA/CDKA/DoKr/GDLoKr 在 newbie 可用且与 rider 正交：enabled 旗标经
//     standard 注入器(specialized mixin:448-469)/DoRA 注入器(:477-498) 原样传入，
//     krona_weight_decompose/cdka_weight_decompose 是独立于本 rider 的另一条分解
//     入口（inject :492），DoKr/GDLoKr 自带 magnitude。前端互斥已保证这些实体
//     与 dora_* 互斥（normalizeAdapterEntityMutex）。
//   - TE 注入按缓存条件跳过（非 Anima 式强制）：inject mixin:300 仅当
//     _has_newbie_cached_training_data()（cache_policy.py:45-53 校验 *_newbie.npz
//     缓存契约）时跳过文本编码器侧；dataset_setup:120-124 还要求 use_cache=true。
//     cache-first 默认开（use_cache/newbie_force_cache_only 默认 true）→ 产品路径
//     DoRA 通常只落 DiT；raw online 时 TE 侧也会注入。无 Anima packed 前向式的
//     DoRA fail-closed 拒绝路径（backend 全仓无 newbie packed forward 实现）。
//   - 已发现并保守处理的幻影选项：adapter_type=glora/glokr 在二次映射两侧均无
//     分支（conversion_finalize.py:201 与 inject mixin:156 都只收六种算法）→
//     静默降级为普通 LoRA 训练。newbie 下拉已将两者置 disabled 保旧草稿回显。
//   - closure 测试对 newbie 覆盖最少（test_training_route_closure.py:1160-1220
//     仅 lokr/flexrank 别名；无 newbie×dora_wd 用例），矩阵结论以源码为准。
// 结论（newbie 行）：仅原生 lora family 可叠加；LyCORIS 六算法一律不可叠加；
// glora/glokr 属幻影选项（后端静默降级），实体注入器走硬互斥不叠 DoRA。
//
// FLUX 管线实证结论（2026-08 第 4 站审计，backend 源码行号同期记录）：
//   - 双路由同构：entry_train.py:217-243 select_trainer_key 对 flux+lora 按
//     flux_trainer_backend 分派——默认 unified → "lulynx"（与 SDXL/ANIMA/NEWBIE
//     同一 LulynxTrainer 注入链）；显式 legacy/flux_lora/preview → FluxLoraTrainer
//     （非 LulynxTrainer 子类，mixins 组装，flux_lora_trainer.py:27-39）。
//   - 统一路由：inject mixin:108-127 flux 守卫——非 networks.lora 直接
//     RuntimeError（is_flux_network_module_supported，flux_preflight.py:32-53 白名单
//     仅 networks.lora/lora_flux 别名），train_text_encoder=true 亦 RuntimeError
//     （:123-127）；else-if 短路与 SDXL 完全同构（:203 LyCORIS 先于 :211 use_dora），
//     注入走 :264-272 transformer.* 前缀（与生态 LoRA key 契约一致）。转换层还会把
//     不支持模块静默改写回 networks.lora（config_adapter_conversion_finalize.py:
//     106-108），但 :113-117 的 requested 原值仍会被 :118 二次拒绝——LyCORIS 在
//     flux 上是 fail-closed，不存在静默降级路径。前端已把 tlora_flux/oft_flux/
//     lycoris.kohya 三个下拉项置 disabled（otherDitSchemas.js:111-115），与后端
//     _FLUX_UNSUPPORTED_NETWORKS 集合一致。
//   - legacy 路由独立消费点（flux_trainer_prepare_mixin.py:97-132）：
//     :102-106 network_module 硬门（仅 networks.lora）；:109-122 直接构造
//     LoRAInjector，dora_enabled = use_dora OR dora_enabled（:115-116），另有
//     dora_variant(:117)/adalora_enabled(:118)/rs_lora_enabled(:121)/pissa(:113-114)；
//     LoRAInjector 构造调用不传 krona/cdka/vera/tlora/lora_fa/hydralora/fera/
//     flexrank/mora/reslora/lora2/tensorring/dokr/gdlokr 任一实体旗标 → 全部按
//     构造默认 False 处理，legacy 路由上 KronA/CDKA 与一切实体注入器不可达；
//     TE 恒冻结（_load_pipeline :71-75 对 vae/text_encoder/text_encoder_2/transformer
//     全部 eval+requires_grad=False），注入只落 transformer（:123），无 TE 注入点。
//   - dora_wd 主键消费点（两路由共享）：entry_train.py:622 在训练器分派（:739）
//     之前无条件执行 ConfigAdapter.from_frontend_dict → finalize_config
//     (conversion_finalize.py:101) → _normalize_lora_alias_values 内 config_adapter.py:
//     511-517 把 dora_wd=true 归一为 use_dora=True+dora_enabled=True+dora_mode='wd'
//     +bypass_mode=False，对所有 model_type 生效（route 层 training_route_service.py:
//     334-339 的同名归一化才是 anima-only，见 :154-155 守卫，但 flux 不依赖它）。
//     因此前端 flux-lora 只定义 dora_wd（无 dora_enabled/use_dora 字段）仍可完整
//     驱动两条路由 —— dora_wd 作为 flux 有意保留的唯一 master 键成立，rider 主键
//     回退逻辑（masterKey=defined 中首个非 use_dora 键）无需 flux 特判。
//   - 显存优化路径无 DoRA 拒绝点：flux_shared_runtime.py / model_acceleration_flux.py
//     全文零 dora 引用；triton fused LoRA/QKV packing 均 fail-soft（prepare mixin
//     :157-191 吞异常降级）。TE 训练请求在 preflight（flux_preflight.py:126-129
//     train_text_encoder/train_t5xxl → error，经 training_config_checks.py:834 合入
//     启动前检查）与 inject mixin:123-127 两处 fail-closed。
// 结论（flux 行）：仅原生 lora family 可叠加（统一路由 use_dora/dora_enabled/
// dora_wd 三键等价；legacy 路由消费归一化后的 use_dora/dora_enabled）；
// LyCORIS/实体注入器不可达（fail-closed 或未传参），KronA/CDKA 无入口。
//
// LTX23/LTX25 管线实证结论（2026-08 第 4 站审计，backend 源码行号同期记录）：
//   - 单一运行时族：contracts/training.py:176-179 把 ltx23-lora/ltx25-lora 都映射为
//     ("ltx23","lora")；arch_capability_registry.py:59-69,119-129 把 ltx25/ltx2 等
//     拼写全部归一到 canonical model_arch="ltx23"。select_trainer_key 无 ltx 特判
//     → 默认 "lulynx"，与 SDXL/ANIMA/NEWBIE 共用同一注入链；method_adapter_
//     contract.py:40 SUPPORTED_FAMILIES 含 ltx23（:131 处 resolve_adapter_method
//     仅产出日志摘要，try/except 包裹，不影响注入分派）。
//   - else-if 短路同构（inject mixin:203/:211）；LyCORISConfig（specialized mixin:
//     261-332）同样无任何 weight-decompose 字段；materialize elif 链实体赢家先于
//     LoRALinear(use_dora)（lora_injector_inject.py:498-518 无 model_arch 守卫，
//     ltx23 与其它族共用同一 else）。_inject_dora_adapter/_inject_standard_lora_
//     adapter 均 arch 无关并原样透传 krona/cdka/dokr/gdlokr 旗标（specialized mixin:
//     477-498），但 ltx 页面不暴露任何算法选择键，这些入口仅剩旧草稿/raw JSON 理论
//     可达且受实体互斥约束。
//   - TE 结构性不存在：model_family.py:414-428 ltx23 行 text_encoder_target_modules=[]
//     （Gemma3/Gemma4 冻结、connectors+cached embeds）、has_dual_text_encoders=False；
//     ltx23_loader.py:529-530 恒以 text_encoder_1=None,text_encoder_2=None 组栈 →
//     inject mixin:302-303 必然走「no text encoder is loaded」跳过分支。DoRA/LoRA
//     只落 DiT（unet_target_modules=_LTX23_UNET_TARGETS，model_family.py:188-195）。
//   - 无 packed 前向 DoRA 拒绝路径：ltx23/ 目录与 training_step_route_ltx23.py 全文
//     零 use_dora/dora 引用；「packed」仅指 latent token 排布（B,S,C=128），与 Anima
//     的 packed module forward 不同物。
//   - 前端 schema（ltx2Schemas.js）adapter 区只有 network_dim/network_alpha/
//     network_dropout/network_alpha_map_json，后端 ltx23_schemas.py:101 network_module
//     为 hidden 默认 networks.lora —— 两侧均无算法下拉，无幻影选项面；rider 因类型
//     schema 未定义任何 DORA_RIDER_KEYS 而 available:false（不渲染），矩阵行翻转仅
//     影响 validator 文案证据态与文档语义。
// 结论（ltx23/ltx25 行）：仅原生 lora family 可叠加；LyCORIS 八算法与实体注入器
// 无 UI 入口（raw JSON 可达但被实体互斥挤出 DoRA）；DoRA 结构性只落 DiT。
//
// SD15 管线实证结论（2026-08 第 5 站审计，backend 源码行号同期记录）：
//   - select_trainer_key（entry_train.py:217-243）对 sd-lora 无特判 → 默认 "lulynx"，
//     与 SDXL/ANIMA/NEWBIE 共用同一 LulynxTrainer 注入链；else-if 短路同构
//     （inject mixin:203 LyCORIS 先于 :211 use_dora）。arch_capability_registry.py:
//     297-306 sd15 行 step_route_mode="generic"，仅训练步路由不同，注入层无差异。
//   - dora_wd 主键消费点与族无关：config_adapter.py:511-517 的归一化对所有
//     model_type 生效（closure 测试 test_training_route_closure.py:343-360 断言的
//     就是这条共享 normalizer），sd15 草稿携带 dora_wd=true 同样到达 native
//     DoRA injector 旗标。
//   - v-parameterization 与 DoRA 正交：全仓 v_parameterization 只被 loss/时间步/
//     噪声侧文件消费（adaptive_loss_weighting / training_step_* / faster_dit_snr），
//     lora_linear/lora_injector* 零引用 —— v-pred 只改损失目标，不改 LoRA/DoRA
//     模块前向，对 DoRA 叠加无约束。
//   - TE 结构性存在且可注入（model_family.py:77-80 _SD15_TE_TARGETS、:247-260
//     has_dual_text_encoders=False）：请求 train_text_encoder 时 DoRA 同时落在
//     UNet 与 TE1，属正常路径（非 anima/newbie 式跳过）。
// 结论（sd15 行）：仅原生 lora family 可叠加；LyCORIS 八算法一律不可叠加。
//
// UNIVERSAL-DIT 管线实证结论（2026-08 第 5 站审计；产品面 product_visible=False /
// launch_ready=False，arch_capability_registry.py:317-327，前端无该训练类型，
// 仅 raw JSON / 后端路由可达）：
//   - target discovery 契约只挑 nn.Linear（target_discovery.py:109,150），probe 的
//     训练冒烟（runtime.py:291-331 finalize_universal_dit_probe → probe_evidence.py:
//     53-123 run_training_probe）在注入完成之后运行：use_dora=True 时 inject_exact
//     → _inject_model 最终 else 分支（lora_injector_inject.py:498-518）创建的就是
//     LoRALinear(use_dora=True)，冒烟逐目标 hook 校验前向有限性 + 梯度存在性 ——
//     use_dora 模块天然计入验证面，inject mixin:337-343 强制 train_smoke_verified。
//   - 导出/合并无 DoRA 盲区：adapter_manifest.py:35 显式收录 .dora_scale/.dora_
//     magnitude 键；merge_export.py:39-117 按DoRALinear._compute_dora_weight 复现
//     完整合并前向。Route-Aware LoRA v1 明确硬拒 DoRA（trainer_adapter_artifact_
//     runtime.py:52-56 fail-closed），不构成静默盲区。
// 结论（universal-dit 行）：仅原生 lora family 可叠加；叠加与否由 probe 契约
// fail-closed 兜底。
//
// KREA2/ZIMAGE/BOOGU/FLUX2/WAN22 管线实证结论（2026-08 第 5 站审计；五族均为
// arch_capability_registry.py:171-260 step_route_mode="always" + cache-first npz
// 契约，但注入全部走共享 LulynxTrainer 链——select_trainer_key 无任何特判）：
//   - 五族 family 目录（krea2/ zimage/ boogu/ wan22/ flux2_*.py）全文零
//     use_dora/dora 引用；专属训练步（training_step_route_*）同样零引用，前向均经
//     nn.Module 子模块调用（如 krea2_layers.py:138-140,240 wq/wk/wv/wo），不存在
//     Anima packed forward 式绕过已包装模块的实现（全仓 packed forward 仅
//     anima_native_dit_executable.py 一处）。
//   - 深度扩层（depth expansion）五族一致要求 full_finetune，LoRA 路线直接
//     ValueError（flux2_depth_expansion_runtime.py:49-50 / krea2 :37-38 / zimage :
//     46-47 / boogu :29-30 / wan22 :49-50）→ DoRA 关心的 LoRA 路线上扩层不可达；
//     扩层本体是整 block 克隆 + 恒等初始化，无 module-level forward。
//   - krea2 block residency 在装载期把冻结 Linear 包成 _Krea2LinearCpuPinnedWrapper
//     （krea2_block_residency.py:103-114，loader 组件 :181-184 调用，先于注入）；
//     该 wrapper 是 nn.Linear 子类（:27）→ 注入器 isinstance 判定照常命中
//     （lora_injector_inject.py:219），DoRA 可正常包装。反向无忧：LoRALinear 基类是
//     nn.Module 而非 nn.Linear（lora_linear.py:42），residency 不会二次包装适配器。
//   - TE 结构性惰性：五族 text_encoder_target_modules=[]（model_family.py:294 krea2
//     / :356 flux2 / :371 boogu / :386 zimage / :401 wan22 umT5 冻结）；loader 虽然
//     装载 text_encoder_1（krea2_loader.py:259 / zimage_loader.py:122 / boogu_loader
//     .py:299 / flux2_loader.py:122 / wan22_loader.py:648），但 inject mixin:297-316
//     走 inject_text_encoder 时目标列表为空 → 匹配零模块。DoRA 结构性只落 DiT。
//   - wan22 A14B 双塔挂载排除（inject mixin:233-236 `_wan22_secondary`，塔体挂载见
//     wan22_loader.py:613,625）对 LyCORIS/LoRA/DoRA 注入统一生效 → magnitude 只落
//     主塔；双塔 depth expansion 被 RuntimeError 拒绝（wan22_depth_expansion_runtime
//     .py:82-86）。
//   - 前端 schema：五族 adapter 区只有 network_dim/alpha/dropout + 分层 alpha，无
//     network_module/lycoris_algo/DORA_RIDER_KEYS 任一键 → rider available:false
//     不渲染（ltx23/ltx25 第 4 站先例）。矩阵行翻转仅影响 validator 文案证据态与
//     文档语义；“补暴露 dora_wd”技术上可行（后端通用链支持），留待下一阶段 UI
//     排版重构统一处理，本站不新增字段面。
// 结论（krea2/zimage/boogu/flux2/wan22 行）：仅原生 lora family 可叠加（结构性
// DiT-only）；LyCORIS 无入口；深度扩层/显存优化器均不构成 DoRA 拒绝面。
//
// 隐藏类型行实证结论（2026-08 第 5 站审计）：
//   - lumina / qwen-image / hunyuan-dit（覆盖 hunyuan-image-lora 兼容别名）：后端
//     launcher/api/services/training_route_catalog.py:82-91 _UNSUPPORTED_SCHEMA_IDS
//     显式拒绝（lumina-lora/lumina2-lora/lumina-finetune/qwen-image-lora/hunyuan-dit-
//     lora/hunyuan-image-lora），TrainingRouteService.resolve 直接返回 is_known=False
//     （training_route_service.py:72-79）→ 训练本身不可启动，DoRA 叠加不可达。
//     前端 schemaIndex 注册仅为旧草稿兼容，与后端拒绝集合一一对应。
//   - concept-edit：_SCHEMA_ROUTE_TABLE 无 'concept-edit' 条目（training_route_catalog
//     .py:21-80 只有 *-ileco/*-addift 旧 id 映射）→ lookup 未命中同样 is_known=False；
//     注册表亦 hidden+disabled（trainingTypeRegistry.js:32）。
//   - yolo：后端 schema 为 registered_placeholder（启动 400，trainingTypeRegistry.js:
//     69-70 注册表注释同证）；前端 YOLO_SECTIONS（otherSchemas.js:200-225）全无适配器
//     字段，训练进程走 entry_yolo.py / core.scorers 边界（schemaIndex.js:168-176），
//     不构造 UnifiedTrainingConfig → 不存在 LoRA/DoRA 注入面。
//   - lab-distiller / aesthetic-scorer：非 LulynxTrainer 进程边界（LabSubprocessRunner
//     / core.scorers，schemaIndex.js:167-182 注释同证），schema 无任何适配器字段 →
//     不存在 DoRA 叠加面。
// 结论（隐藏类型行）：stackable=[] 且 audited=true —— “无可叠加路线”的原因是类型
// 本身不可启动/无注入面，而非算法层拒绝；doraWdVisible 据此隐藏死 schema 上的
// DoRA 开关。
//
// 未知 family 键仍落入保守默认行（audited:false）作为防御性回退；可见训练类型全集
// （VISIBLE_TRAINING_TYPES，当前 40 型）+ 全部隐藏类型至此均有显式矩阵行，无 pending 行。
const DORA_SUPPORT_DEFAULT_ROW = Object.freeze({ stackable: Object.freeze(['lora']), audited: false });

export const DORA_SUPPORT_BY_MODEL_FAMILY = Object.freeze({
  sdxl: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // ANIMA 行已实证（第 2 站）：与 SDXL 同一注入链、同一 else-if 短路；差异仅在
  // TE 恒跳过（cache-first 强制）与 packed 显存优化器拒绝 DoRA（见上方注释）。
  anima: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // SD15 行已实证（第 5 站）：与 SDXL 同构的通用链；v-parameterization 与 DoRA
  // 正交（loss 侧专属），TE 可正常注入（见上方注释）。
  sd15: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // NEWBIE 行已实证（第 3 站）：与 SDXL/ANIMA 同一注入链、同一 else-if 短路；
  // 差异在 adapter_type 二次映射（不改 rider 主键语义）与按缓存条件的 TE 跳过
  // （非强制，见上方注释）。
  newbie: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // KREA2/ZIMAGE/BOOGU/FLUX2/WAN22 行已实证（第 5 站）：共享 LulynxTrainer 注入
  // 链 + 结构性 DiT-only（TE 目标列表为空）；前端 adapter 区无 DoRA 键，rider 不
  // 渲染（见上方注释）。
  krea2: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  zimage: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  boogu: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  flux2: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  wan22: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // UNIVERSAL-DIT 行已实证（第 5 站）：probe 训练冒烟天然包含 use_dora 模块，
  // train_smoke_verified 门闸 fail-closed；导出/合并路径有 DoRA 支持证据（见上
  // 方注释）。产品面未开放，行仅用于 raw JSON 草稿与文档语义。
  'universal-dit': Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // minimax_h3/adapter_compat.py:14-34 对 use_dora/dora_enabled 直接 ValueError
  // （fail-closed），LyCORIS 同样被拒 —— 该族无任何可叠加路线。
  'minimax-h3': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  // FLUX 行已实证（第 4 站）：统一/legacy 双路由同构仅 networks.lora；dora_wd 经
  // ConfigAdapter 归一化驱动两路由，TE 恒冻结（见上方注释）。
  flux: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // LTX23/LTX25 行已实证（第 4 站）：同一 canonical ltx23 运行时族、通用注入链；
  // TE 结构性不存在（loader 恒 text_encoder_1=None），无 packed DoRA 拒绝路径
  // （见上方注释）。
  ltx23: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  ltx25: Object.freeze({ stackable: Object.freeze(['lora']), audited: true }),
  // 隐藏/不可启动类型行（第 5 站）：后端拒绝整个训练路由或无适配器进程边界，
  // DoRA 叠加不可达（见上方隐藏类型行实证结论）。
  lumina: Object.freeze({ stackable: Object.freeze([]), audited: true }),
  'qwen-image': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  'hunyuan-dit': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  'concept-edit': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  'lab-distiller': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  'aesthetic-scorer': Object.freeze({ stackable: Object.freeze([]), audited: true }),
  yolo: Object.freeze({ stackable: Object.freeze([]), audited: true }),
});

// typeId 前缀 → 能力矩阵行键。顺序敏感：长前缀必须排在短前缀之前。
const DORA_MODEL_FAMILY_PREFIX_RULES = Object.freeze([
  ['minimax-h3', 'minimax-h3'],
  ['universal-dit', 'universal-dit'],
  ['universal_dit', 'universal-dit'],
  ['flux2', 'flux2'],
  ['wan22', 'wan22'],
  ['ltx23', 'ltx23'],
  ['ltx25', 'ltx25'],
  ['krea2', 'krea2'],
  ['zimage', 'zimage'],
  ['boogu', 'boogu'],
  ['anima', 'anima'],
  ['newbie', 'newbie'],
  ['sdxl', 'sdxl'],
  ['sd', 'sd15'],
  ['flux', 'flux'],
  ['lumina', 'lumina'],
  ['qwen-image', 'qwen-image'],
  ['hunyuan', 'hunyuan-dit'],
]);

/** 训练类型 id → 模型家族键（能力矩阵行）。 */
export function doraModelFamilyKey(typeId) {
  const raw = String(typeId || '').trim().toLowerCase();
  if (!raw) return '';
  for (const [prefix, key] of DORA_MODEL_FAMILY_PREFIX_RULES) {
    if (raw.startsWith(prefix)) return key;
  }
  return raw;
}

function doraSupportRowForType(typeId) {
  const row = DORA_SUPPORT_BY_MODEL_FAMILY[doraModelFamilyKey(typeId)];
  return row || DORA_SUPPORT_DEFAULT_ROW;
}

/** 该训练类型下可叠加 DoRA 的基础算法 family 列表（副本）。 */
export function doraStackableFamiliesForType(typeId) {
  const stackable = doraSupportRowForType(typeId).stackable;
  return Array.isArray(stackable) ? [...stackable] : [];
}

/** 该训练类型的 DoRA 叠加结论是否已经过后端管线实证（false = pending 保守值）。 */
export function doraSupportAuditedForType(typeId) {
  return Boolean(doraSupportRowForType(typeId).audited);
}

/** 当前配置选中的基础算法 family（用于判断 DoRA 能否叠加）。 */
export function baseAlgoFamilyForDora(config = {}) {
  return resolveAdapterFamily(config);
}

/**
 * DoRA 权重分解开关在当前配置下是否可见。
 * LyCORIS/networks.oft 模块路线在任何模型族都不可叠加（注入链短路），直接隐藏；
 * 其余按类型对应矩阵行判定（草稿缺 model_train_type 时落入保守默认行）。
 */
export function doraWdVisible(config = {}) {
  if (!nonLycorisNetworkSelected(config)) return false;
  const typeId = String(config.model_train_type || '').trim();
  if (!typeId) return true;
  return doraStackableFamiliesForType(typeId).length > 0;
}

const OFT_MODULE_SPELLINGS = new Set([
  'networks.oft', 'networks.oft_flux', 'networks.oft-flux', 'oft', 'diag-oft', 'diag_oft',
]);

// ── 家族解析单一实现 ─────────────────────────────────────────────────────────
// 以基础算法为准：DoRA 是叠加增强而非独立 family（后端 NetworkType.DORA 只是
// networks.lora 的枚举别名，configs_enums.py:35-42），dora-enabled 草稿一律解析
// 到它的宿主 family。向导选中态（adapterModel.winnerFamily）与 expert 字段能力
// 显隐（adapterFamilySupports）共用本函数，杜绝两套语义并存。
export function resolveAdapterFamily(config = {}) {
  const networkModule = String(config.network_module || '').trim().toLowerCase();
  const winner = resolveWinningAdapterEntity(config);
  if (winner.id === 'lycoris') {
    let algo;
    if (OFT_MODULE_SPELLINGS.has(networkModule)) {
      algo = 'diag-oft';
    } else if (networkModule.includes('lycoris')) {
      algo = config.lycoris_algo || 'loha';
    } else {
      // lora_type 驱动的 LyCORIS（Anima/Newbie 选择器）；残留的旧 module 不作数。
      algo = getAdapterTypeKey(config) || config.lycoris_algo || 'loha';
    }
    return normalizeAdapterFamily(algo);
  }
  if (winner.id !== 'lora') return normalizeAdapterFamily(winner.id);
  const loraType = getAdapterTypeKey(config);
  if (config.rs_lora_enabled === true || config.rs_lora === true || config.use_rslora === true) return 'rs-lora';
  if (config.lora_plus_enabled === true || loraType === 'lora_plus') return 'lora-plus';
  // Legacy drafts may persist lora_type='dora'; the rider flags are what matter.
  return loraType === 'dora' ? 'lora' : normalizeAdapterFamily(loraType || 'lora');
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
export const LOSS_AWARE_SCHEDULERS = ['loss_gated_cosine', 'loss_weighted_annealed_cosine'];
export const lossAwareScheduler = oneOf('lr_scheduler', LOSS_AWARE_SCHEDULERS);
export const lossWeightedScheduler = when('lr_scheduler', 'loss_weighted_annealed_cosine');

// ---- 选项数组 ----
// ================================================================
// 字段分组规范（全参数修正系列 A1，SDXL 桶先行，后续桶照此归位）：
// 按后端语义九组归位 section.tab / 卡片：
//   1 网络结构(network)     network_module/dim/alpha/算法与实体注入器
//   2 优化器(optimizer)     optimizer_type/backend/opt_* 参数面板/AutoController
//   3 学习率调度(optimizer) lr_scheduler/warmup/num_cycles/Loss 门控族
//   4 精度与显存(speed)     mixed_precision/full_fp16/offload/swap/block-swap
//   5 缓存(dataset)         cache_latents/cache_text_encoder_outputs 及盘上格式
//   6 数据集(dataset)       分桶/resolution/reg_data_dir/caption 全族
//   7 采样预览(preview)     sample_*/quality_evaluation/validation
//   8 保存(model)           save_*/log_*（save-settings 归 model 页签为历史布局）
//   9 高级专家(advanced)    noise/seed/distributed/rf 等实验目标函数
// 新字段先问"后端在哪个 mixin 消费"，再按上表选 tab；不要按 UI 顺手程度放置。
// ================================================================
export const FIELD_GROUP_SPEC = Object.freeze([
  'network-structure', 'optimizer', 'lr-schedule', 'precision-vram',
  'cache', 'dataset', 'sampling-preview', 'save', 'advanced-expert',
]);

// 预览采样器：以 launcher schema(training_field_optimization_fragments.py:220-224)
// 的 canonical 七值为准；kohya 风格旧名经 sampler_capabilities.py 别名表仍可解析，
// 保 disabled 项供旧草稿回显（值原样透传）。
export const SAMPLE_SAMPLER_OPTIONS = [
  { value: 'euler_a', label: 'euler_a' },
  { value: 'euler', label: 'euler' },
  { value: 'ddim', label: 'ddim' },
  { value: 'dpm++_2m', label: 'dpm++_2m' },
  { value: 'dpm++_2m_sde', label: 'dpm++_2m_sde' },
  { value: 'dpm++_sde', label: 'dpm++_sde' },
  { value: 'uni_pc', label: 'uni_pc' },
  { value: 'pndm', label: 'pndm（旧名，运行时别名解析）', disabled: true, disabledReason: '已改用 canonical 命名；旧草稿兼容保留。' },
  { value: 'lms', label: 'lms（旧名，运行时别名解析）', disabled: true, disabledReason: '已改用 canonical 命名；旧草稿兼容保留。' },
  { value: 'heun', label: 'heun（旧名，运行时别名解析）', disabled: true, disabledReason: '已改用 canonical 命名；旧草稿兼容保留。' },
  { value: 'dpm_2', label: 'dpm_2（旧名，运行时别名解析）', disabled: true, disabledReason: '已改用 canonical 命名；旧草稿兼容保留。' },
  { value: 'dpm_2_a', label: 'dpm_2_a（旧名，运行时别名解析）', disabled: true, disabledReason: '已改用 canonical 命名；旧草稿兼容保留。' },
  { value: 'dpmsolver', label: 'dpmsolver（= dpm++_2m 别名）', disabled: true, disabledReason: '请改用 dpm++_2m。' },
  { value: 'dpmsolver++', label: 'dpmsolver++（= dpm++_2m 别名）', disabled: true, disabledReason: '请改用 dpm++_2m。' },
];

export const DIT_BLOCK_RESIDENCY_OPTIONS = [
  { value: 'resident', label: '常驻 GPU' },
  // 2026-08 第 3 站审计（B4/E2）：streaming_offload 是后端合法驻留档
  // （config_adapter_conversion_runtime.py:343-344 / newbie_block_residency.py:29 /
  // anima_block_residency.py:36 三处口径一致），且 prefetch/sparse_swap 只在该档
  // 生效。原先 UI 缺该档导致 prefetch 组在 block_cpu_pinned 下可见却恒空转。
  { value: 'streaming_offload', label: 'Streaming Offload（平衡档：冷块按需流式换入）' },
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
  desc: 'CPU-pinned 冻结权重的 PCIe 传输格式（off 关闭）。建议 off 起步，带宽瓶颈实测后再选格式。',
  defaultValue: 'off',
  options: PCIE_TRANSFER_FORMAT_OPTIONS,
};

export const sparseSwapFields = (residencyKey) => [
  { key: 'sparse_swap_enabled', type: 'boolean', label: '稀疏交换方案', title: 'sparse_swap_enabled', desc: '稀疏交换：只搬大张量的冷分块而非整层。建议整层交换粒度过粗时开启。', defaultValue: false, visibleWhen: streamingBlockMode(residencyKey) },
  { key: 'sparse_swap_warm_fraction', type: 'number', label: '稀疏交换 Warm 比例', title: 'sparse_swap_warm_fraction', desc: '冷层中允许提前预取的比例', defaultValue: 0.35, min: 0, max: 1, step: 0.05, visibleWhen: all(streamingBlockMode(residencyKey), when('sparse_swap_enabled', true)) },
  { key: 'sparse_swap_budget_mb', type: 'number', label: '稀疏交换 Warm 预算 MB', title: 'sparse_swap_budget_mb', desc: '稀疏交换的显存预算（MB）。推荐范围：256–1024 按空闲显存设定。', defaultValue: 0, min: 0, step: 64, visibleWhen: all(streamingBlockMode(residencyKey), when('sparse_swap_enabled', true)) },
];

export const pcieDeltaCacheField = (residencyKey) => ({
  key: 'pcie_delta_cache_enabled',
  type: 'boolean',
  label: 'PCIe Delta/Cache 候选分析',
  desc: 'PCIe Delta/Cache 候选分析：observe 输出候选报告不改变行为。建议诊断期开启。',
  defaultValue: false,
  visibleWhen: nonResidentBlockMode(residencyKey),
});

export const pcieDeltaCacheModeFields = (residencyKey) => [
  { key: 'pcie_delta_cache_mode', type: 'select', label: 'PCIe Delta/Cache 模式', title: 'pcie_delta_cache_mode', desc: 'observe 只读观察；cache_v0 手动启用缓存。建议 observe 先看报告。', defaultValue: 'observe', options: ['observe', 'cache_v0'], visibleWhen: all(nonResidentBlockMode(residencyKey), when('pcie_delta_cache_enabled', true)) },
  { key: 'pcie_delta_cache_budget_mb', type: 'number', label: 'PCIe Cache v0 预算 MB', title: 'pcie_delta_cache_budget_mb', desc: 'GPU 缓存预算 MB；0 表示不启用。推荐范围：256 起步，按空闲显存上调。', defaultValue: 256, min: 0, step: 64, visibleWhen: all(nonResidentBlockMode(residencyKey), when('pcie_delta_cache_enabled', true), when('pcie_delta_cache_mode', 'cache_v0')) },
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
      desc: 'Vortex 显存管理器总开关。建议默认关闭，需要其规划能力时再开。',
      defaultValue: false,
      visibleWhen: visible,
    },
    {
      key: 'vortex_mode',
      type: 'select',
      label: 'Vortex 模式',
      desc: 'Vortex 模式：observe/planner 只记录不改训练路径。建议 observe 先看信号。',
      defaultValue: 'observe',
      options: VORTEX_RUNTIME_MODE_OPTIONS,
      visibleWhen: enabled,
    },
    {
      key: 'vortex_profile',
      type: 'select',
      label: 'Vortex 档位',
      desc: 'Vortex 档位。建议 standard 默认。',
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
      desc: '传给 Vortex 管理器的策略名。建议保持 standard 默认。',
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
      desc: 'Vortex Cache 预算（MB）。推荐范围：256 起步按余量上调。',
      defaultValue: 256,
      min: 0,
      step: 64,
      visibleWhen: all(enabled, when('vortex_mode', 'cache_v0')),
    },
    {
      key: 'vortex_low_vram_protection_enabled',
      type: 'boolean',
      label: 'Vortex 低显存保护',
      desc: '低于水位触发 Vortex 保护判断。建议与 free 水线配套使用。',
      defaultValue: false,
      visibleWhen: enabled,
    },
    {
      key: 'vortex_low_vram_protection_mode',
      type: 'select',
      label: '低显存保护模式',
      desc: '保护模式：observe 只记录。建议 observe。',
      defaultValue: 'observe',
      options: VORTEX_LOW_VRAM_PROTECTION_MODE_OPTIONS,
      visibleWhen: lowVramEnabled,
    },
    {
      key: 'vortex_low_vram_min_free_mb',
      type: 'number',
      label: '低显存保底 MB',
      desc: '触发保护的最低空闲显存（MB）。推荐范围：512–2048 按卡设定。',
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
// T-LoRA master 键用后端真名 t_lora_enabled（configs_training_methods.py:439）；
// 旧 UI 内部键 tlora_enabled 不是 trainer 配置字段也无别名，pydantic 静默丢弃。
const _truthy = (v) => v === true || v === 1 || String(v ?? '').trim().toLowerCase() === 'true';

/** @type {ReadonlyArray<{ id: string, key: string, label: string }>} */
export const ADAPTER_ENTITY_PRIORITY = Object.freeze([
  { id: 'lora2_adaptive', key: 'lora2_adaptive_enabled', label: 'LoRA2 Adaptive' },
  { id: 'fera', key: 'fera_enabled', label: 'FeRA' },
  { id: 'hydralora', key: 'hydralora_enabled', label: 'HydraLoRA' },
  { id: 'vera', key: 'vera_enabled', label: 'VeRA' },
  { id: 'lora_fa', key: 'lora_fa_enabled', label: 'LoRA-FA' },
  { id: 'tlora', key: 't_lora_enabled', label: 'T-LoRA' },
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
  if (loraType === 'tlora') payload.t_lora_enabled = true;
  // tlora_enabled 是本表改名前的 UI 内部键：旧草稿/旧提交的残值一律剥除，
  // 避免死键继续随 payload 出站。
  delete payload.tlora_enabled;
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
      // its schema has no native t_lora_enabled master to materialize.
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
    // DoRA 子旋钮残值：dora_mode 是 dora_enabled 的从属 select，离开 default
    // LoRA 路线后一并清掉（delete 而非写 false，避免给下拉塞越界布尔值）；
    // bypass_mode 残值同理归零（后端在 dora_wd 路线上本就强制 False，
    // config_adapter.py:517）。
    if ('dora_mode' in payload) delete payload.dora_mode;
    if (_truthy(payload.bypass_mode)) payload.bypass_mode = false;
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
  { value: 'pipeline', label: 'Pipeline（流水线重叠）' },
  { value: 'sync', label: '同步（保守/调试）' },
  { value: 'async', label: '异步预取' },
];

// ---- DiT 检查点字段构造器 ----
export const ditGradientCheckpointingField = (family, defaultValue = true) => ({
  key: 'gradient_checkpointing',
  type: 'boolean',
  label: `${family} 通用检查点`,
  desc: `${family} 通用检查点：反传时重算激活以省显存（约换 20–30% 速度）；主路径看加速页 DiT Block Checkpointing，建议显存不足时优先用分块检查点而不是本开关。`,
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
    { key: 'v_parameterization', type: 'boolean', label: 'V 参数化', title: 'v_parameterization', desc: 'v-prediction 模式：模型预测 v=noise−latent 而非噪声本身，部分 SD2.x/512 底模需要。建议跟随底模说明，不确定时关闭。', defaultValue: false },
  ];
  if (includeVPredOptions) {
    fields.push(
      { key: 'zero_terminal_snr', type: 'boolean', label: '零终端 SNR', title: 'zero_terminal_snr', desc: '把 SNR 曲线终端置零，改善 v-pred 亮部/暗部对比度。建议仅 v-pred 训练配合使用，eps 训练不要开。', defaultValue: true, visibleWhen: when('v_parameterization', true) },
      { key: 'scale_v_pred_loss_like_noise_pred', type: 'boolean', label: '缩放 v-pred 损失', title: 'scale_v_pred_loss_like_noise_pred', desc: '把 v-pred 损失缩放到 noise-pred 量纲，统一不同预测目标的损失尺度。建议 v-pred 训练保持开启（默认 true）。', defaultValue: true, visibleWhen: when('v_parameterization', true) },
    );
  }
  return fields;
};

// bucket_selection_mode 选项卫生：后端 BucketManager（dataset_bucketing.py:114-120,140-141）
// 把十个历史取值归为四个行为等价组——aspect / {area,pixel,pixels} /
// {larger,ceil,no_downscale} / {smaller,floor,no_upscale}。下拉只保留每组规范名，
// 同义别名标 disabled 保旧草稿回显与提交兼容（值原样透传，后端按同组处理）。
export const BUCKET_SELECTION_MODE_OPTIONS = [
  { value: 'aspect', label: 'aspect（宽高比匹配，默认）' },
  { value: 'area', label: 'area（面积匹配）' },
  { value: 'pixel', label: 'pixel（= area 别名）', disabled: true, disabledReason: '与 area 行为完全一致，请改用 area。' },
  { value: 'pixels', label: 'pixels（= area 别名）', disabled: true, disabledReason: '与 area 行为完全一致，请改用 area。' },
  { value: 'no_downscale', label: 'no_downscale（桶不小于原图）' },
  { value: 'larger', label: 'larger（= no_downscale 别名）', disabled: true, disabledReason: '与 no_downscale 行为完全一致，请改用 no_downscale。' },
  { value: 'ceil', label: 'ceil（= no_downscale 别名）', disabled: true, disabledReason: '与 no_downscale 行为完全一致，请改用 no_downscale。' },
  { value: 'no_upscale', label: 'no_upscale（桶不大于原图）' },
  { value: 'smaller', label: 'smaller（= no_upscale 别名）', disabled: true, disabledReason: '与 no_upscale 行为完全一致，请改用 no_upscale。' },
  { value: 'floor', label: 'floor（= no_upscale 别名）', disabled: true, disabledReason: '与 no_upscale 行为完全一致，请改用 no_upscale。' },
];

// ---- 数据集字段构造器 ----
export const ds = (reso, bucketMax = 2048, bucketStep = 64, extra = []) => [
  { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练数据集路径', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
  { key: 'reg_data_dir', type: 'folder', pickerType: 'folder', label: '正则化数据集路径', title: 'reg_data_dir', desc: '先验保留（prior preservation）的正则图目录，配合 prior_loss_weight 使用。建议仅在防灾难遗忘需求下提供类别图。', defaultValue: '' },
  { key: 'prior_loss_weight', type: 'number', label: '先验损失权重', title: 'prior_loss_weight', desc: '先验损失权重：正则项相对主损失的比例。推荐范围：1.0（默认）或 0.5–1；仅提供了正则集时生效。', defaultValue: 1, min: 0, step: 0.1 },
  { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', importantDesc: '训练分辨率', defaultValue: reso },
  { key: 'enable_bucket', type: 'boolean', label: '启用分桶', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
  { key: 'min_bucket_reso', type: 'number', label: '桶最小分辨率', title: 'min_bucket_reso', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', defaultValue: 256 },
  { key: 'max_bucket_reso', type: 'number', label: '桶最大分辨率', title: 'max_bucket_reso', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', defaultValue: bucketMax },
  { key: 'bucket_reso_steps', type: 'number', label: '桶划分单位', title: 'bucket_reso_steps', desc: '桶分辨率的划分步进（px）。推荐范围：64（标准）；低显存模式可 32；DiT 路线见 enable_bucket 说明。', defaultValue: bucketStep },
  { key: 'bucket_no_upscale', type: 'boolean', label: '桶不放大图片', title: 'bucket_no_upscale', desc: '桶内不放大小于目标分辨率的图（只缩大图）。建议小图多时开启避免放大模糊；追求统一尺寸时关闭。', defaultValue: false },
  { key: 'bucket_selection_mode', type: 'select', label: '分桶策略', title: 'bucket_selection_mode', desc: '分桶策略：aspect 宽高比匹配（默认）；area 面积匹配；no_downscale/no_upscale 为旧行为别名（行为等价规范名）。建议保持 aspect。', defaultValue: 'aspect', options: BUCKET_SELECTION_MODE_OPTIONS },
  // 与 bucket_selection_mode 无关：后端 dataset_bucketing.py 只要这里解析出非空桶表就
  // 优先采用。原先锚在幽灵值 'custom_only' 上（options 里没有），字段永久不可见。
  { key: 'bucket_custom_resos', type: 'textarea', label: '自定义桶列表', title: 'bucket_custom_resos', desc: '一行一个，支持 1024x1024。留空则按上面的分桶策略自动生成；一旦填了内容，后端会优先使用这里的桶表，「分桶策略」将不再生效。', defaultValue: '', visibleWhen: when('enable_bucket', true) },
  { key: 'image_decode_backend', type: 'select', label: '图片解码后端', title: 'image_decode_backend', desc: '图片解码后端：pil 最兼容；pil_lru 按 mtime/大小缓存已解码 RGB。建议大数据集 SSD 上 pil_lru。', defaultValue: 'pil', options: IMAGE_DECODE_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'data_backend', type: 'select', label: '数据后端', title: 'data_backend', desc: '数据后端：auto/caption 当前都走 CaptionDataset 实现。建议 auto 保持跟随。', defaultValue: 'auto', options: DATA_BACKEND_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
  { key: 'image_decode_cache_size', type: 'number', label: '图片解码缓存张数', title: 'image_decode_cache_size', desc: '每个 worker 的解码 LRU 容量（张数），0 关闭。推荐范围： 64–256 按内存。', defaultValue: 0, min: 0, visibleWhen: all(when('performance_expert_mode', true), oneOf('image_decode_backend', ['auto', 'pil_lru'])) },
  ...extra,
];

// ---- UI 分组占位字段 ----
// 第一参数必须是显式稳定 id：旧实现从标题折叠生成 key，纯中文标题会全部折叠成
// 同一个 `__ui_group_`，多组之间互相碰撞（React key 复用/折叠态共享）。id 用
// ascii 短横线命名，i18n EN 包按 `__ui_group_<id>` 补 label/desc。
export const uiGroup = (id, title, desc = '', visibleWhen = null) => ({
  key: `__ui_group_${id}`,
  type: 'ui_group',
  label: title,
  desc,
  defaultValue: '',
  visibleWhen: visibleWhen || undefined,
});

// ---- LoRA / LyCORIS 网络字段构造器 ----
// opts.hideDoraWd：该类型已通过 S_LORA_VARIANTS.dora_enabled 提供 DoRA master 时，
// 把本区的 dora_wd 降级为 hidden 兼容别名（Anima 先例：animaSchema.js:455-457）。
// 只定义 dora_wd 的类型（sd/flux 等）不传该选项，dora_wd 仍是有意保留的唯一 master
// ——此时文案必须按 master 语义描述（第 4 站 FLUX 审计核实：flux 页无「LoRA 结构
// 变体」区，旧别名文案与事实矛盾；后端 config_adapter.py:511-517 会把 dora_wd
// 归一为 use_dora/dora_enabled 路由旗标）。
const DORA_WD_DESC_MASTER = '叠加在标准 LoRA 路线上的权重分解增强（方向+幅度），比标准 LoRA 表达力强但稍慢。本类型的 DoRA 主入口就是这个开关（向导中的「叠加 DoRA」开关读写它），后端会将其归一为 use_dora/dora_enabled 训练旗标并强制 bypass_mode=False。建议小数据集或需要更强概念绑定（如角色脸）时开启。';
const DORA_WD_DESC_ALIAS = '叠加在标准 LoRA 路线上的权重分解增强（方向+幅度），比标准 LoRA 表达力强但稍慢。本类型的 DoRA 主入口在「LoRA 结构变体」区的 dora_enabled，此处仅为旧草稿兼容别名，后端同样会归一为 use_dora/dora_enabled 并强制 bypass_mode=False。建议改用主开关，保持此项关闭以免双开混淆。';
export const netLora = (mod, dim = 32, alpha = 32, maxDim = 512, extra = [], extraModules = [], includeLycoris = true, opts = {}) => [
  { key: 'network_module', type: 'select', label: '训练网络模块', title: 'network_module', desc: '训练网络模块决定适配器实现路线。建议 networks.lora（兼容性最好）；lora_fa/vera/tlora/flexrank 为实验变体；lycoris.kohya 是旧入口。', defaultValue: mod, options: [mod, ...extraModules, ...(includeLycoris && !mod.includes('lycoris') ? ['lycoris.kohya'] : [])] },
  { key: 'network_dim', type: 'slider', label: '网络维度', title: 'network_dim', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: dim, min: 1, max: maxDim, step: 1, visibleWhen: adapterFamilySupports('supports_rank') },
  { key: 'network_alpha', type: 'slider', label: '网络 Alpha', title: 'network_alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: alpha, min: 1, max: maxDim, step: 1, visibleWhen: adapterFamilySupports('supports_alpha') },
  { key: 'network_dropout', type: 'number', label: '网络 Dropout', title: 'network_dropout', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: all(nonLycorisNetworkSelected, adapterFamilySupports('supports_dropout')) },
  { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 采样激活 rank 下界；上界沿用 network_dim。推荐范围：dim 的 25%–50%。', defaultValue: 1, min: 1, step: 1, visibleWhen: when('network_module', 'networks.flexrank_lora') },
  { key: 'dim_from_weights', type: 'boolean', label: '从权重推断 Dim', title: 'dim_from_weights', desc: '从已加载的 network_weights 自动推断 rank/dim，忽略手填值。建议续训旧 LoRA 且不确定原参数时开启。', defaultValue: false, visibleWhen: adapterFamilySupports('supports_rank') },
  { key: 'scale_weight_norms', type: 'number', label: '最大范数正则化', title: 'scale_weight_norms', desc: '对 LoRA 权重做最大范数约束（Spectral Norm 正则），抑制过拟合。推荐范围：1（社区惯例值）；留空/0 关闭。', defaultValue: '', min: 0, step: 0.01 },
  // includeLycoris=false 的族（flux-lora：后端白名单只接 networks.lora，
  // flux_preflight + inject mixin 双重 RuntimeError）不再携带 LyCORIS 死结构：
  // 这些字段的 visibleWhen 锚在 lycorisNetworkSelected 上永不可见，纯属死 schema
  // 重量（2026-08 第 3 站审计 F 项）。
  ...(includeLycoris ? [
    uiGroup('lycoris_structure', 'LyCORIS 基础结构', '这里放算法类型、卷积维度、preset 这类决定网络骨架的参数。普通 LoRA 路线可直接忽略。', lycorisNetworkSelected),
    { key: 'lycoris_algo', type: 'select', label: 'LyCORIS 算法', title: 'lycoris_algo', desc: 'LyCORIS 具体算法（LoCon/LoHa/LoKr/IA3/Diag-Oft 等后端原生集）。按容量/速度需求选择，建议 LoCon 起步。', defaultValue: 'locon', options: SUPPORTED_LYCORIS_ALGOS, visibleWhen: lycorisNetworkSelected },
    { key: 'conv_dim', type: 'number', label: '卷积维度', title: 'conv_dim', desc: 'Conv 层的 rank（作用卷积投影）。推荐范围：与 network_dim 相同或减半；仅影响含 Conv 的目标层。', defaultValue: 4, min: 1, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_CONV_ALGOS.includes(c.lycoris_algo) },
    { key: 'conv_alpha', type: 'number', label: '卷积 Alpha', title: 'conv_alpha', desc: 'Conv 层缩放系数。推荐范围：与 conv_dim 对齐（=dim 或 dim/2）。', defaultValue: 1, min: 1, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_CONV_ALGOS.includes(c.lycoris_algo) },
    { key: 'lycoris_preset', type: 'string', label: 'LyCORIS Preset', title: 'lycoris_preset', desc: '传给 LyCORIS 库的 preset。', defaultValue: '', visibleWhen: lycorisNetworkSelected },
    uiGroup('lycoris_regularization', '正则化与稳定性', 'LyCORIS 专用 dropout / 正则项。大多数训练保持默认即可。', lycorisNetworkSelected),
    { key: 'dropout', type: 'number', label: 'LyCORIS Dropout', desc: 'LyCORIS 主 dropout 概率。推荐范围：0–0.1，默认 0。', defaultValue: 0, min: 0, max: 1, step: 0.01, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && LYCORIS_DELTA_ALGOS.includes(c.lycoris_algo) },
    { key: 'rank_dropout', type: 'number', label: 'LoKr Rank Dropout', title: 'rank_dropout', desc: '按 rank/输出维度随机丢弃的概率（LoKr 等变体）。推荐范围：0 默认；≤0.1 试验。', defaultValue: '', min: 0, max: 1, step: 0.01, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'module_dropout', type: 'number', label: 'LoKr Module Dropout', title: 'module_dropout', desc: '按整个模块随机丢弃的概率。推荐范围：0 默认；≤0.1 试验，过大明显伤收敛。', defaultValue: '', min: 0, max: 1, step: 0.01, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'train_norm', type: 'boolean', label: '训练 Norm 层', title: 'train_norm', desc: '额外把归一化层（LayerNorm/RMSNorm）纳入训练。建议角色一致性微调时试验，常规保持关闭。', defaultValue: false, visibleWhen: (c) => LYCORIS_NETWORK_MODULES.includes(c.network_module) && c.lycoris_algo !== 'ia3' },
  ] : []),
  uiGroup('dora_variant_common', 'DoRA 权重分解（叠加增强）', 'DoRA 不是独立算法，而是叠加在标准 LoRA 路线上的增强：把权重分解为方向与幅度分别训练。后端注入链中 LyCORIS 分支先于 DoRA 分派，因此 LyCORIS 算法路线上的叠加开关不会生效。', doraWdVisible),
  { key: 'dora_wd', type: opts.hideDoraWd ? 'hidden' : 'boolean', label: '启用 DoRA 权重分解', title: 'dora_wd', desc: opts.hideDoraWd ? DORA_WD_DESC_ALIAS : DORA_WD_DESC_MASTER, defaultValue: false, visibleWhen: opts.hideDoraWd ? undefined : doraWdVisible },
  { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：default 标准 LoRA；pissa/olora/loftq 特殊初始化（仍走请求管线，不加新入口）。建议 default，需要快速收敛换 pissa。', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), (c) => !doraEnabled(c)) },
  { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: '特殊初始化产物的导出方式：auto 在最终保存时转成可直接加载到原底模的 LoRA。建议 auto。', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), nativeLoraInitSelected) },
  { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 量化位宽（fake-quant 初始化，不是持久 4bit 底座）。推荐范围：4（默认）或 8。', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('network_module', 'networks.lora'), loftqInitSelected) },
  { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: '量化粒度：rowwise 按输出通道，tensorwise 整张量。建议 rowwise（默认，精度更好）。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('network_module', 'networks.lora'), loftqInitSelected) },
  ...(includeLycoris ? [
    uiGroup('lokr_params', 'LoKr 专属参数', '这组只会在 LoKr 下出现，包含 Kronecker 分解方式、双侧分解和 full matrix 等更重口味的结构控制。', all(lycorisNetworkSelected, when('lycoris_algo', 'lokr'))),
    { key: 'lokr_factor', type: 'number', label: 'LoKr 系数', title: 'lokr_factor', desc: 'LoKr Kronecker 分解因子：越大越省参数越弱表达。-1 表示无穷大因子（最省）。推荐范围：4（常用起点）～8；-1 极限压缩。', defaultValue: -1, min: -1, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'decompose_both', type: 'boolean', label: 'LoKr 双侧分解', title: 'decompose_both', desc: 'LoKr 额外分解较小侧矩阵，进一步省参数但更慢。建议默认关闭，参数预算极紧时开。', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'full_matrix', type: 'boolean', label: 'LoKr Full Matrix', title: 'full_matrix', desc: '强制 LoKr 走完整矩阵路径（放弃分解收益换稳定）。建议排查 LoKr 数值问题时临时开启。', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'unbalanced_factorization', type: 'boolean', label: 'LoKr 非均衡分解', title: 'unbalanced_factorization', desc: 'LoKr 分解时交换较大侧，改变参数分布形态。建议默认关闭；属实验开关。', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    // 后端 sdxl_lora.py:192-211 声明、config_adapter 归一层消费；仅 lycoris.kohya+lokr 生效。
    { key: 'lokr_no_materialize_forward', type: 'boolean', label: 'LoKr 免实体化前向', title: 'lokr_no_materialize_forward', desc: '前向直接用 Kronecker 因子计算而不实体化整块权重，省显存可能更慢。建议显存紧张且用 LoKr 时试验。', defaultValue: false, visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr')) },
    { key: 'lokr_no_materialize_strategy', type: 'select', label: '免实体化前向实现', title: 'lokr_no_materialize_strategy', desc: '免实体化前向的实现选择：auto 按启发式选路，legacy 旧行为。建议 auto。', defaultValue: 'legacy', options: ['auto', 'legacy', 'matmul'], visibleWhen: all(lycorisNetworkSelected, when('lycoris_algo', 'lokr'), when('lokr_no_materialize_forward', true)) },
  ] : []),
  { key: 'enable_base_weight', type: 'boolean', label: '启用基础权重', title: 'enable_base_weight', desc: '差异炼丹：叠加一个基础权重参照网络。建议实验性玩法，常规训练关闭。', defaultValue: false },
  { key: 'base_weights', type: 'textarea', label: '基础权重路径', title: 'base_weights', desc: '合并入底模的 LoRA 路径，一行一个路径', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'base_weights_multiplier', type: 'textarea', label: '基础权重比例', title: 'base_weights_multiplier', desc: '合并入底模的 LoRA 权重，一行一个数字', defaultValue: '', visibleWhen: when('enable_base_weight', true) },
  { key: 'network_args_custom', type: 'textarea', label: '自定义 network_args', title: 'network_args_custom', desc: '自定义 network_args，每行一个参数', defaultValue: '' },
  ...extra,
];

// ---- flow / rectified-flow 参数构造器 ----
// defaults.tsExtra: 额外的 timestep_sampling 选项(如 anima 路线支持的 'logit_normal',
// SD3 论文消融中优于 uniform);仅在传入时追加,其他训练族不受影响。
export const flowParams = (defaults = {}) => [
  { key: 'timestep_sampling', type: 'select', label: '时间步采样', title: 'timestep_sampling', desc: '扩散时间步采样分布（shift/logit_normal/uniform 等）。建议 shift（默认）对多数 flow 模型最佳。', defaultValue: defaults.ts || 'sigmoid', options: ['sigma', 'uniform', 'sigmoid', 'shift', 'flux_shift', ...(defaults.tsExtra || [])] },
  ...((defaults.tsExtra || []).includes('logit_normal') ? [
    { key: 'flow_logit_mean', type: 'number', label: 'Logit Mean', title: 'flow_logit_mean', desc: 'logit-normal 均值：正偏高频段采样。推荐范围： 0 居中，偏细节给负值。', defaultValue: 0.0, step: 0.01, visibleWhen: when('timestep_sampling', 'logit_normal') },
    { key: 'flow_logit_std', type: 'number', label: 'Logit Std', title: 'flow_logit_std', desc: 'logit-normal 标准差（>0）。越小越集中于均值段。推荐范围： 1。', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: when('timestep_sampling', 'logit_normal') },
  ] : []),
  { key: 'sigmoid_scale', type: 'number', label: 'sigmoid 缩放', title: 'sigmoid_scale', desc: 'sigmoid 缩放系数', defaultValue: defaults.ss || 1.0, step: 0.001 },
  { key: 'model_prediction_type', type: 'select', label: '模型预测类型', title: 'model_prediction_type', desc: '模型预测类型', defaultValue: defaults.mp || 'raw', options: ['raw', 'additive', 'sigma_scaled'] },
  // 2026-08 ANIMA 桶：原先这里的四个 sdxl_flow_* 死重量已拆出。它们锚在
  // flow_model 上，而所有挂载 flowParams 的族（anima/newbie/krea/zimage/boogu/
  // 概念编辑）都没有 flow_model 键 → 恒隐藏、永不收集，只是每个 DiT 族白背四键。
  { key: 'discrete_flow_shift', type: 'number', label: '离散流位移', title: 'discrete_flow_shift', desc: '离散流采样的 shift 参数：越大越偏向高噪声段。推荐范围：常用 3–4，以模型族默认为准。', defaultValue: defaults.dfs || 1.0, step: 0.001 },
  { key: 'guidance_scale', type: 'number', label: 'CFG 引导缩放', title: 'guidance_scale', desc: 'CFG/Guidance 强度（LCM-LoRA 类低值）。推荐范围：LCM 1.0–2.0 起测；常规蒸馏按教师设定。', defaultValue: defaults.gs || 1.0, step: 0.01 },
  // 2026-08 第 3 站审计（B1）：sigma_sqrt 在 FLUX unified 运行时会直接
  // ValueError（flux_lora_utils.py:220-223 合法集 none/uniform/logit_normal/
  // mode/cosine/cosmap），cosine 缺失；anima 已改用自有 anima_weighting_scheme
  // （anima_flow.py:266-277 的 sigma_sqrt 与本组无关），故共享组对齐 runtime 集。
  { key: 'weighting_scheme', type: 'select', label: '权重策略', title: 'weighting_scheme', desc: '损失加权策略', defaultValue: defaults.ws || 'none', options: ['logit_normal', 'mode', 'cosine', 'cosmap', 'none'] },
  { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数（EDM2 mode weighting）。推荐范围：留空关闭。', defaultValue: '', step: 0.01 },
  { key: 'loss_type', type: 'select', label: '损失函数类型', title: 'loss_type', desc: '损失函数类型（l2/l1/huber 等），决定对离群样本的敏感度。建议保持 l2 默认；标签噪声大时试 huber。', defaultValue: defaults.lt || 'l2', options: ['l1', 'l2', 'huber', 'smooth_l1'] },
];

export const rectifiedFlowParams = () => [
  { key: 'flow_model', type: 'boolean', label: '启用 Rectified Flow', title: 'flow_model', desc: '启用 Rectified Flow / Flow Matching 目标。建议仅在 flow 类底模上开启，UNet 经典底模不要开。', defaultValue: false },
  { key: 'flow_use_ot', type: 'boolean', label: 'RF 最优传输配对', title: 'flow_use_ot', desc: '按 cosine 最优传输重排 latent 配对。建议小 batch 收敛慢时试验。', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'flow_timestep_distribution', type: 'select', label: 'RF 时间步分布', title: 'flow_timestep_distribution', desc: 'RF 时间步采样分布（logit_normal 默认等）。建议 logit_normal。', defaultValue: 'logit_normal', options: ['logit_normal', 'uniform'], visibleWhen: when('flow_model', true) },
  { key: 'flow_logit_mean', type: 'number', label: 'RF Logit Mean', desc: 'logit-normal 均值：正偏高频段采样。推荐范围： 0 居中，偏细节给负值。', defaultValue: 0.0, step: 0.01, visibleWhen: all(when('flow_model', true), when('flow_timestep_distribution', 'logit_normal')) },
  { key: 'flow_logit_std', type: 'number', label: 'RF Logit Std', desc: 'logit-normal 标准差（>0）。越小越集中于均值段。推荐范围： 1。', defaultValue: 1.0, min: 0.001, step: 0.01, visibleWhen: all(when('flow_model', true), when('flow_timestep_distribution', 'logit_normal')) },
  { key: 'flow_uniform_shift', type: 'boolean', label: 'RF 分辨率偏移', title: 'flow_uniform_shift', desc: '按像素数动态偏移 RF 时间步。建议多分辨率混合训练开启。', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'flow_uniform_base_pixels', type: 'number', label: 'RF 基准像素数', title: 'flow_uniform_base_pixels', desc: '分辨率偏移的基准像素数（1024²=1048576）。推荐范围：与主分辨率面积一致。', defaultValue: 1048576, min: 1, step: 1, visibleWhen: all(when('flow_model', true), when('flow_uniform_shift', true)) },
  { key: 'flow_uniform_static_ratio', type: 'number', label: 'RF 固定偏移比率', title: 'flow_uniform_static_ratio', desc: '固定偏移比率，填写后覆盖动态偏移；留空禁用。推荐范围：留空走动态。', defaultValue: '', min: 0.001, step: 0.001, visibleWhen: when('flow_model', true) },
  { key: 'contrastive_flow_matching', type: 'boolean', label: '对比 Flow Matching', title: 'contrastive_flow_matching', desc: '启用 CFM 辅助项。需要同时开启 Rectified Flow', defaultValue: false, visibleWhen: when('flow_model', true) },
  { key: 'cfm_lambda', type: 'number', label: 'CFM 权重', title: 'cfm_lambda', desc: '对比 Flow Matching 辅助损失权重。推荐范围： 0.05（默认）小权重起步。', defaultValue: 0.05, min: 0, step: 0.001, visibleWhen: all(when('flow_model', true), when('contrastive_flow_matching', true)) },
];

// ---- section 工厂 ----
// opts.hidden（第 6 站桶）：整节下架开关。语义 = 「数据定义保留、运行面摘除」：
// schemaIndex.getSectionsForType 会过滤 hidden 节，字段不渲染、不进默认值、
// 不进 payload；比逐字段 type:'hidden' 干净（后者仍会照常提交值），比直接删除
// 利于后端接通采样管线后一键恢复。用于七族 preview/quality 永久 no-op 组。
export const sec = (id, tab, title, desc, fields, opts = {}) => ({
  id, tab, title, description: desc, fields,
  expert: !!opts.expert,
  ...(opts.hidden ? { hidden: true } : {}),
});
