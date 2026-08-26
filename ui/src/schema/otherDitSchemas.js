// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// otherDitSchemas.js — FLUX / Lumina / Qwen-Image / HunyuanDiT / Newbie 等 DiT 训练族
// (anima 自成一档在 animaSchema.js;sdxl 在 sdxlSchema.js)。增删这些族的字段只改本文件。
// 族内私有 helper(placeholderWarningField / qwenImageSections / hunyuanDitSections /
// NEWBIE_BLOCK_RESIDENCY_FIELDS)就地定义、不外泄;按依赖顺序排列(const 不提升)。
// 依赖方向(单向无环):schemaCommon → schemaFieldGroups → 本文件 → schemaIndex。
// ================================================================
import {
  when,
  all,
  adamwFamilyOptimizer,
  swapEnabled,
  nonResidentBlockMode,
  streamingBlockMode,
  DIT_BLOCK_RESIDENCY_OPTIONS,
  PCIE_TRANSFER_FORMAT_FIELD,
  sparseSwapFields,
  pcieDeltaCacheField,
  pcieDeltaCacheModeFields,
  vortexRuntimeFields,
  LORA_RECOMPUTE_OPTIONS,
  NATIVE_ADAPTER_TYPES,
  OPTIMIZER_BACKEND_OPTIONS,
  ADVANCED_OPTIMIZER_STRATEGY_OPTIONS,
  BLOCK_SWAP_STRATEGY_OPTIONS,
  ADAPTER_INIT_STRATEGY_OPTIONS,
  ADAPTER_INIT_EXPORT_MODE_OPTIONS,
  LOFTQ_QUANT_TYPE_OPTIONS,
  nativeLoraInitSelected,
  loftqInitSelected,
  ditGradientCheckpointingField,
  ds,
  netLora,
  flowParams,
  sec,
  ALL_SCHEDULERS,
  TARGET_LORA_OPTIMIZERS,
  schedulerOptions,
} from './schemaCommon.js';
import {
  S_LOSS_AWARE_LR,
  S_DIT_PERFORMANCE_EXPERT,
  S_EXECUTION_BACKEND,
  VRAM_AUTO_ENHANCE_FIELDS,
  KREA2_OFFLOAD_FIELDS,
  FLUX2_OFFLOAD_FIELDS,
  BOOGU_OFFLOAD_FIELDS,
  ZIMAGE_OFFLOAD_FIELDS,
  WAN22_OFFLOAD_FIELDS,
  S_SAVE,
  S_CAPTION,
  S_LR,
  S_LR_TARGET,
  S_LR_FT,
  S_LR_DIT,
  S_LR_TARGET_DIT,
  S_LR_FT_DIT,
  S_TRAIN,
  expandTrainLengthFields,
  S_PREVIEW,
  S_QUALITY_EVAL,
  S_SPEED_FLOW,
  S_DISTRIBUTED,
  S_LULYNX_SDXL,
  S_ADV,
  S_ADV_DIT,
  S_NOISE,
  S_DATA_AUG,
  S_VALIDATION,
  S_THERMAL,
  S_MEMORY_RECLAIM,
  S_PEAK_VRAM,
  cnDataset,
  cnTrainFields,
  cnLR,
  S_COMPILE_EXPERT,
  S_MODULE_OFFLOAD_CORE,
  S_MODULE_OFFLOAD_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_QUALITY_OPTIMIZATION_PACK, S_LORA_VARIANTS, S_PERCEPTUAL_ANCHOR_LOSS,
  S_SAMPLING_OPTIMIZATION_RESERVE, S_REPA_RESERVE, S_EXPERIMENTAL_PROBES,
  S_DIAGNOSTICS_MONITORING, S_AUTO_CONTROLLER, S_TURBOCORE, S_DIT_BLOCKSKIP, S_SIGMA_DEPTH_SCHEDULE,
  S_NEGATIVE_SEMANTIC_REGULARIZATION,
  S_WEIGHT_COMPOSER, S_REGION_FOCUS, S_PROGRESSIVE_TRAINING, S_ADAPTIVE_TRAINING,
} from './schemaFrontierGroups.js';

// 分层 Alpha（通用 DiT 版）—— 按目标模块分别设置 LoRA alpha。后端字段 network_alpha_map_json。
// 非 anima 架构无固定模块类型分组，故用文本框：每行「模块后缀=alpha」或 JSON {后缀: alpha}。
// 例：qkv=16\nout=8  或  {"qkv":16,"out":8}。留空 = 全局 network_alpha = 传统 LoRA = parity。
const S_LAYERED_ALPHA_GENERIC = [
  { key: 'network_alpha_map_json', type: 'textarea', label: '分层 Alpha 映射', title: 'network_alpha_map_json', desc: '按目标模块分别设置 LoRA alpha', defaultValue: '', placeholder: '例:\nattention.qkv=16\nattention.out=8\nfeed_forward.w2=32' }
];

// ---- FLUX LoRA 专属（2026-08 第 3 站审计 B6/C）----
// unified FLUX 训练器读裸键 sigmoid_scale / weighting_scheme
// （flux_trainer_loss_mixin.py:112,114、flux_train_step.py:36,38），但：
//   1) field_alias_map.py:37-38,329 全局把这三个裸键改名 anima_*；
//   2) UnifiedTrainingConfig 无对应裸字段（configs_flux.py 仅 discrete_flow_shift/
//      timestep_sampling/guidance_scale 等），pydantic extra 默认 ignore；
//   3) mode_scale 连 FluxFlowConfig 都不接收（_build_flux_flow_config 未传参，恒 1.0）。
// ⇒ 任何出站键都到达不了消费者（builder 双写/改名均无效，已实证）。model_prediction_type
// 在 flux 范围同样零读者（仅 anima_flow.py 消费 anima_model_prediction_type）。
// 按「活跃假旋钮」治理：schema 层 hidden 保旧草稿回显，提交层按 typeId 剥除。
const FLUX_DEAD_FLOW_KEYS = new Set(['sigmoid_scale', 'weighting_scheme', 'mode_scale', 'model_prediction_type']);
const fluxLoraFlowParams = (defaults = {}) => flowParams(defaults).map((field) => (
  FLUX_DEAD_FLOW_KEYS.has(field.key) ? { ...field, type: 'hidden' } : field
));

// ---- FLUX LoRA ----
export const FLUX_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 模型路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 文本编码器路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 文本编码器路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },

    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('flux-params', 'model', 'FLUX 专用参数', '时间步采样与 CFG。', [
    ...fluxLoraFlowParams({ ts: 'sigmoid', gs: 1.0 }),
    // discrete_flow_shift（B9 信息项）：UI/registry 默认均为 1.0，payload 恒发 1.0，
    // UnifiedTrainingConfig 的 3.0 缺省不可达——三方以 UI 1.0 为准，后端缺省值不动。
    { key: 't5xxl_max_token_length', type: 'number', label: 'T5XXL 最大 token', title: 't5xxl_max_token_length', desc: 'T5-XXL 编码 token 上限。推荐范围：256–512；显存紧张取低值。', defaultValue: '', min: 1 },
    // 幻影开关（2026-08 第 3 站审计 C）：configs_base.py:146 声明 + 恒等别名
    // （field_alias_map.py:217）后全仓零运行时读者；前端默认 true 更误导。
    // hidden 保旧草稿回显，提交层剥除（PHANTOM_KEYS）。
    { key: 'apply_t5_attn_mask', type: 'hidden', defaultValue: true },
    // 幻影开关（第 5 站）：flux_preflight.py:126-129 对 train_t5xxl/train_text_encoder
    // 直接 error（FLUX LoRA 恒冻结 CLIP/T5），开启必被启动前检查拒绝。置 disabled
    // 保旧草稿回显，禁止新开；渲染层经 FieldControl 的 field.disabled 通道生效。
    { key: 'train_t5xxl', type: 'boolean', label: '训练T5XXL（不推荐）', title: 'train_t5xxl', desc: '训练 T5-XXL 文本编码器（不推荐，显存开销极大）', defaultValue: false, disabled: true, disabledReason: 'FLUX LoRA 管线恒冻结 CLIP/T5：后端预检会直接拒绝该开关（文本编码器训练未接入）。', disabledReason_en: 'The FLUX LoRA pipeline always freezes CLIP/T5: backend preflight rejects this switch outright (text-encoder training is not wired in).' }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  // dim/alpha 默认对齐后端 registry schema（flux_lora.py:78-85：dim 16 / α 8），
  // 结束三方不一致（2026-08 第 3 站审计 B8）。
  // includeLycoris=false：后端白名单只接 networks.lora（flux_preflight + inject
  // mixin 双重拒绝），LyCORIS 死结构随 includeLycoris 参数真正裁剪（F 项）。
  sec('network-settings', 'network', '网络设置', 'LoRA。', netLora('networks.lora_flux', 16, 8, 256, [], [
    { value: 'networks.tlora_flux', label: 'T-LoRA (FLUX)', disabled: true, disabledReason: 'FLUX T-LoRA 暂未接入后端训练器', disabledReason_en: 'FLUX T-LoRA is not wired into the backend trainer yet' },
    { value: 'networks.oft_flux', label: 'OFT (FLUX)', disabled: true, disabledReason: 'FLUX OFT 暂未接入后端训练器', disabledReason_en: 'FLUX OFT is not wired into the backend trainer yet' },
    { value: 'lycoris.kohya', label: 'LyCORIS', disabled: true, disabledReason: 'FLUX LyCORIS 暂未接入后端训练器', disabledReason_en: 'LyCORIS is not wired into the FLUX backend trainer yet' }
], false)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  // network_train_* 双假开关摘除 + train_length_mode 展开为轮数/步数常显
  // （E1/C，跨桶 #1：队列 pop 与 shim 反转覆盖见 training_queue_support.py:252-253；
  // FLUX 管线结构性恒冻结 CLIP/T5——flux_preflight + inject mixin 对
  // train_text_encoder 直接 RuntimeError——TE 训练不可用 = 无可暴露语义）。
  sec('training-settings', 'training', '训练参数', '', expandTrainLengthFields(S_TRAIN(20), { dropFakeTeSwitches: true })),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [
    // 补暴露（D⑩）：configs_flux.py:22 三档，由 Flux 训练器 memory mixin /
    // flux_compile_runtime 消费（auto=按显存自动、off=常驻、aggressive=激进流式）。
    // S_SPEED_FLOW 为多族共享组，flux 专属键就地前置。
    { key: 'flux_transformer_offload', type: 'select', label: 'Transformer 卸载档位', title: 'flux_transformer_offload', desc: 'Flux Transformer 卸载档位：off 常驻最快；auto 按显存自选；aggressive 流式卸载最省最慢。建议 auto。', defaultValue: 'auto', options: ['auto', 'off', 'aggressive'] },
    ...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  // 与其它 DiT 主路径对齐：高级模式下露出先锋 tab（画质包 + 诊断）
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Lumina LoRA ----
export const LUMINA_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Lumina 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'lumina-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Lumina 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 模型路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'gemma2', type: 'file', pickerType: 'model-file', label: 'Gemma2 模型路径', title: 'gemma2', desc: 'Gemma2 文本模型路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },

    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('lumina-params', 'model', 'Lumina 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 6.0 }),
    { key: 'gemma2_max_token_length', type: 'number', label: 'Gemma2 最大 token', title: 'gemma2_max_token_length', desc: 'Gemma2 最大 token 长度', defaultValue: '', min: 1 },
    { key: 'use_sage_attn', type: 'boolean', label: '启用 Sage Attention', title: 'use_sage_attn', desc: '启用 Sage Attention 加速', defaultValue: false },
        { key: 'system_prompt', type: 'string', label: '系统提示词', title: 'system_prompt', desc: 'Lumina 系统提示词', defaultValue: '' },
    { key: 'sample_batch_size', type: 'number', label: '预览图采样批量', title: 'sample_batch_size', desc: '每次预览并排出图数量。推荐范围： 1–4，过大拖慢训练。', defaultValue: '', min: 1 }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_lumina', 4, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- DiT 占位/通用 helper ----
const placeholderWarningField = (familyName) => ({
  key: 'route_status_note',
  type: 'textarea',
  label: '链路状态',
  desc: `${familyName} 轻量入口，暂不能直接训练`,
  defaultValue: `${familyName} 当前只是轻量选择入口，训练核心尚未深度接入。`,
});

const qwenImageSections = (typeId = 'qwen-image-lora') => [
  sec('model-settings', 'model', '训练用模型', 'Qwen Image 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Qwen Image DiT 路径', title: 'pretrained_model_name_or_path', desc: 'Qwen Image 底模或 transformer 权重路径', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径，可留空等待后续接入', defaultValue: '' },
    { key: 'text_encoder', type: 'file', pickerType: 'model-file', label: '文本编码器路径', title: 'text_encoder', desc: 'Qwen Image 文本编码器路径，可留空等待后续接入', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('qwen-image-params', 'model', 'Qwen Image 参数', '', [
    placeholderWarningField('Qwen Image'),
    ...flowParams({ ts: 'shift', dfs: 3.0 })
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_qwen_image', 16, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- Qwen Image LoRA ----
export const QWEN_IMAGE_LORA_SECTIONS = qwenImageSections();

// ---- HunyuanDiT helper ----
const hunyuanDitSections = (typeId = 'hunyuan-dit-lora') => [
  sec('model-settings', 'model', '训练用模型', 'HunyuanDiT 模型路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'HunyuanDiT 模型路径', title: 'pretrained_model_name_or_path', desc: '底模或 DiT 权重路径', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径，可留空等待后续接入', defaultValue: '' },
    { key: 'text_encoder', type: 'file', pickerType: 'model-file', label: '文本编码器路径', title: 'text_encoder', desc: '文本编码器路径，可留空等待后续接入', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('hunyuan-params', 'model', 'HunyuanDiT 参数', '', [
    placeholderWarningField('HunyuanDiT'),
    ...flowParams({ ts: 'sigma', dfs: 5.0 }),
    { key: 'attn_mode', type: 'select', label: 'Attention 实现', title: 'attn_mode', desc: '注意力实现：自动跟随启动环境默认；显式选择会写入 attention_backend。注意显存优化器仅在 FlashAttention 2 后端真正生效。建议 auto。', defaultValue: '', attentionBackendOptions: true, options: [
      { value: '', label: '自动（跟随启动环境）' },
      { value: 'torch', label: 'Torch' },
      { value: 'sdpa', label: 'SDPA' },
      { value: 'xformers', label: 'xFormers' },
      { value: 'flash', label: 'FlashAttention 2' },
      { value: 'sageattn', label: 'SageAttention' }
] },
    { key: 'mode_scale', type: 'number', label: 'mode 权重缩放', title: 'mode_scale', desc: 'mode 权重策略的缩放系数（EDM2 mode weighting）。推荐范围：留空关闭。', defaultValue: '', step: 0.01 },
    { key: 'split_attn', type: 'boolean', label: '拆分 attention', title: 'split_attn', desc: '按 head 拆分 attention 计算省显存。建议显存临界时开，速度略降。', defaultValue: false },
    { key: 'text_encoder_cpu', type: 'boolean', label: '文本编码器用 CPU', title: 'text_encoder_cpu', desc: '将文本编码器放在 CPU 上以节省显存', defaultValue: false },
    { key: 'vae_chunk_size', type: 'number', label: 'VAE 解码分块', title: 'vae_chunk_size', desc: 'VAE 解码分块大小，越小越省显存。推荐范围：2（默认）附近。', defaultValue: '', min: 1 }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora_hunyuan_dit', 16, 16, 256)),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_TARGET_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- HunyuanDiT LoRA ----
export const HUNYUAN_DIT_LORA_SECTIONS = hunyuanDitSections();

export const HUNYUAN_IMAGE_COMPAT_SECTIONS = hunyuanDitSections('hunyuan-image-lora');

const krea2WeightCompressionRequested = (config) => {
  const preset = String(config?.weight_compression_preset || 'off').trim().toLowerCase();
  const enabled = config?.weight_compression_enabled;
  return preset !== 'off' || enabled === true || enabled === 'true' || enabled === 1;
};

const KREA2_SPEED_FLOW_FIELDS = (() => {
  const fields = [];
  for (const field of S_SPEED_FLOW) {
    if (field.key === 'weight_compression_preset') {
      fields.push(
        {
          key: 'weight_compression_preset',
          type: 'select',
          label: '冻结主干量化',
          desc: '一键压缩预设（自动挑格式/目标/校验）。建议不确定时从预设起步再手动细化。',
          defaultValue: 'off',
          options: [
            { value: 'off', label: '关闭' },
            { value: 'stable_backbone_int8', label: '骨干 INT8（运行时压缩，非 Comfy 导出）' },
            { value: 'experimental_float8', label: '主干 FP8（torchao / RTX 40 系优先）' },
            { value: 'text_encoder_int8', label: '文本编码器 INT8' },
            { value: 'both_int8', label: '主干+文本编码器 INT8' }
],
        },
        {
          key: 'weight_compression_verify',
          type: 'boolean',
          label: '压缩能力探测',
          desc: '压缩后做数值校验（重建误差抽查）。建议首次对某底模启用压缩时开启。',
          defaultValue: true,
          visibleWhen: krea2WeightCompressionRequested,
        },
      );
      continue;
    }
    if (field.key === 'fp8_base' || field.key === 'fp8_base_unet') continue;
    fields.push(field);
  }
  return fields;
})();

// ---- FLUX Finetune ----
export const FLUX_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX 全参微调。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-finetune' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AutoEncoder 模型路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 文本编码器路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 文本编码器路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('flux-params', 'model', 'FLUX 专用参数', '', [
    ...flowParams({ ts: 'sigma', mp: 'sigma_scaled', dfs: 3.0, gs: 3.5 }),
    { key: 't5xxl_max_token_length', type: 'number', label: 'T5XXL 最大 token', title: 't5xxl_max_token_length', desc: 'T5-XXL 编码 token 上限。推荐范围：256–512；显存紧张取低值。', defaultValue: '', min: 1 },
    { key: 'apply_t5_attn_mask', type: 'boolean', label: '应用 T5 注意力掩码', title: 'apply_t5_attn_mask', desc: '应用 T5 注意力掩码以更好处理变长文本', defaultValue: false },
    { key: 'mem_eff_save', type: 'boolean', label: '省内存保存', title: 'mem_eff_save', desc: '使用更省内存的保存方式', defaultValue: false },
    { key: 'blockwise_fused_optimizers', type: 'boolean', label: 'Blockwise fused optimizer', desc: '把多个优化器 kernel 融合执行以省时。建议保持默认关闭，确认所用优化器支持后再开。', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_FT_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...VRAM_AUTO_ENHANCE_FIELDS, ...S_DIT_PERFORMANCE_EXPERT, ...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('lulynx-settings', 'advanced', 'Lulynx 核心', 'SafeGuard、EMA、ResourceManager、SmartRank、AutoController。', S_LULYNX_SDXL),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Lumina Finetune ----
export const LUMINA_FT_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Lumina 全参微调。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'lumina-finetune' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'Lumina 模型路径', title: 'pretrained_model_name_or_path', desc: 'Lumina 模型路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AE 路径', defaultValue: '' },
    { key: 'gemma2', type: 'file', pickerType: 'model-file', label: 'Gemma2 路径', title: 'gemma2', desc: 'Gemma2 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('lumina-params', 'model', 'Lumina 专用参数', '', [
    ...flowParams({ ts: 'shift', dfs: 6.0 }),
    { key: 'gemma2_max_token_length', type: 'number', label: 'Gemma2 最大 token', title: 'gemma2_max_token_length', desc: 'Gemma2 最大 token', defaultValue: '', min: 1 },
    { key: 'use_sage_attn', type: 'boolean', label: '启用 Sage Attention', title: 'use_sage_attn', desc: '启用 Sage Attention', defaultValue: false },
        { key: 'sample_batch_size', type: 'number', label: '预览图采样批量', title: 'sample_batch_size', desc: '每次预览并排出图数量。推荐范围： 1–4，过大拖慢训练。', defaultValue: '', min: 1 },
    { key: 'mem_eff_save', type: 'boolean', label: '省内存保存', title: 'mem_eff_save', desc: '使用更省内存的保存方式', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('1024,1024', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_FT_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED])
];

// ---- FLUX ControlNet ----
export const FLUX_CN_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX ControlNet。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux-controlnet' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'FLUX 模型路径', title: 'pretrained_model_name_or_path', desc: 'FLUX 模型路径', defaultValue: '' },
    { key: 'ae', type: 'file', pickerType: 'model-file', label: 'AE 路径', title: 'ae', desc: 'AE 路径', defaultValue: '' },
    { key: 'clip_l', type: 'file', pickerType: 'model-file', label: 'CLIP-L 路径', title: 'clip_l', desc: 'CLIP-L 路径', defaultValue: '' },
    { key: 't5xxl', type: 'file', pickerType: 'model-file', label: 'T5-XXL 路径', title: 't5xxl', desc: 'T5-XXL 文本编码器路径', defaultValue: '' },
    { key: 'controlnet_model_name_or_path', type: 'file', pickerType: 'model-file', label: '已有 ControlNet 路径', title: 'controlnet_model_name_or_path', desc: '已有 ControlNet 路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('768,768', 2048, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', S_CAPTION.filter((f) => f.key !== 'max_token_length')),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
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
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true })
];

// ---- Newbie 块常驻 helper ----
// E2（2026-08 第 3 站审计）：prefetch 三键锚 streaming_offload——后端 prefetch
// 控制器仅在该档安装（newbie_block_residency.py:252,283-284），block_cpu_pinned 下
// 恒返回 {"enabled":false,"reason":"prefetch requires streaming_offload"}。
const NEWBIE_BLOCK_RESIDENCY_FIELDS = [
  { key: 'lora_activation_recompute_mode', type: 'select', label: 'LoRA 分支重算', title: 'lora_activation_recompute_mode', desc: '原生 DiT LoRA 反传激活重算档位：auto 自动选择。建议 auto。', defaultValue: 'auto', options: LORA_RECOMPUTE_OPTIONS },
  { key: 'newbie_block_residency', type: 'select', label: 'Newbie Block Offload', title: 'newbie_block_residency', desc: 'Newbie 冻结 DiT 权重驻留策略（常驻/block_cpu_pinned 等）。建议默认 block_cpu_pinned 平衡显存与速度。', defaultValue: 'block_cpu_pinned', options: DIT_BLOCK_RESIDENCY_OPTIONS },
  { key: 'newbie_block_residency_min_params', type: 'number', label: 'Newbie Offload 最小参数量', title: 'newbie_block_residency_min_params', desc: '只托管参数量达到阈值的冻结 Linear，过滤小模块减少搬运开销。推荐范围：0 默认全托管。', defaultValue: 0, min: 0, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  { key: 'newbie_block_checkpointing', type: 'boolean', label: 'Newbie 梯度检查点（分块重算）', title: 'newbie_block_checkpointing', desc: 'Newbie 的梯度检查点主力：反传按 DiT block 重算激活降峰值。比通用检查点更省，显存不足优先开。', defaultValue: false, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  { key: 'newbie_block_checkpointing_mode', type: 'select', label: 'Newbie Checkpointing 模式', title: 'newbie_block_checkpointing_mode', desc: '检查点模式：block 整块重算（推荐）；selective 与 Anima 对齐的可选实现。', defaultValue: 'block', options: [
    { value: 'block', label: 'block（整块重算）' },
    { value: 'selective', label: 'selective' }
], visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_checkpointing', true)) },
  { key: 'newbie_block_checkpointing_interval', type: 'number', label: 'Newbie Checkpointing 间隔', title: 'newbie_block_checkpointing_interval', desc: '每隔 N 个 DiT block 设一个检查点（1=全部重算）。N>1 少重算多占激活显存。推荐范围：1（默认）。', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: all(nonResidentBlockMode('newbie_block_residency'), when('newbie_block_checkpointing', true)) },
  { key: 'newbie_block_prefetch', type: 'boolean', label: 'Newbie Block 预取', title: 'newbie_block_prefetch', desc: 'Newbie Block 预取开关，配合 offload 掩盖延迟。建议与 offload 同开。', defaultValue: false, visibleWhen: streamingBlockMode('newbie_block_residency') },
  { key: 'newbie_block_prefetch_depth', type: 'number', label: 'Newbie 预取深度', title: 'newbie_block_prefetch_depth', desc: '向前预取几个 block。推荐范围：1–2。', defaultValue: 1, min: 1, max: 8, step: 1, visibleWhen: all(streamingBlockMode('newbie_block_residency'), when('newbie_block_prefetch', true)) },
  { key: 'newbie_block_prefetch_mode', type: 'select', label: 'Newbie 预取模式', title: 'newbie_block_prefetch_mode', desc: '预取模式：original 固定深度（默认）；adaptive 自适应深度。建议 original。', defaultValue: 'original', options: [
    { value: 'original', label: 'original（固定深度）' },
    { value: 'adaptive', label: 'adaptive（自适应）' }
  ], visibleWhen: all(streamingBlockMode('newbie_block_residency'), when('newbie_block_prefetch', true)) },
  { ...PCIE_TRANSFER_FORMAT_FIELD, visibleWhen: nonResidentBlockMode('newbie_block_residency') },
  ...vortexRuntimeFields('newbie_block_residency'),
  pcieDeltaCacheField('newbie_block_residency'),
  ...pcieDeltaCacheModeFields('newbie_block_residency')
];

// ---- Newbie LoRA (实验) ----
// Newbie 专属 adapter_type 选项面（2026-08 第 3 站管线审计）：后端二次映射
// （config_adapter_conversion_finalize.py:201 + trainer_prepare_adapter_inject_
// mixin.py:156）只接六种 LyCORIS 算法，glora/glokr 两个值在两侧均无分支 →
// 静默降级为普通 LoRA 训练。置 disabled 保旧草稿回显（值原样透传），禁止新选。
const NEWBIE_ADAPTER_TYPE_OPTIONS = NATIVE_ADAPTER_TYPES.map((entry) => {
  const value = typeof entry === 'object' ? entry.value : entry;
  if (value === 'glora') {
    return {
      value, label: 'GLoRA', disabled: true,
      disabledReason: 'Newbie 后端未接入 GLoRA：选择后会静默按普通 LoRA 训练。',
      disabledReason_en: 'The Newbie backend has no GLoRA support: selecting it silently trains a plain LoRA.',
    };
  }
  if (value === 'glokr') {
    return {
      value, label: 'GLoKr', disabled: true,
      disabledReason: 'Newbie 后端未接入 GLoKr：选择后会静默按普通 LoRA 训练。',
      disabledReason_en: 'The Newbie backend has no GLoKr support: selecting it silently trains a plain LoRA.',
    };
  }
  return entry;
});

export const NEWBIE_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Newbie 基座模型与可选组件路径。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'newbie-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Newbie 基座模型目录', title: 'pretrained_model_name_or_path', desc: '必填，要求完整本地目录', defaultValue: '' },
    { key: 'transformer_path', type: 'folder', pickerType: 'folder', label: 'Transformer 目录', title: 'transformer_path', desc: '单独指定 transformer 目录（可选）', defaultValue: '' },
    { key: 'gemma_model_path', type: 'folder', pickerType: 'folder', label: 'Gemma 文本编码器目录', title: 'gemma_model_path', desc: '单独指定 Gemma 文本编码器目录（可选）', defaultValue: '' },
    { key: 'clip_model_path', type: 'folder', pickerType: 'folder', label: 'Jina CLIP 目录', title: 'clip_model_path', desc: '单独指定 Jina CLIP 目录（可选）', defaultValue: '' },
    { key: 'vae_path', type: 'folder', pickerType: 'folder', label: 'VAE 目录', title: 'vae_path', desc: '单独指定 VAE 目录（可选）', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' }
]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
    { key: 'dataloader_num_workers', type: 'number', label: 'DataLoader 线程数', title: 'dataloader_num_workers', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', defaultValue: 4, min: 0 },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', label: 'Bucket 最小分辨率', title: 'min_bucket_reso', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', label: 'Bucket 最大分辨率', title: 'max_bucket_reso', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', defaultValue: 2048, min: 64 },
    { key: 'bucket_reso_steps', type: 'number', label: 'Bucket 步长', title: 'bucket_reso_steps', desc: '桶分辨率的划分步进（px）。推荐范围：64（标准）；低显存模式可 32；DiT 路线见 enable_bucket 说明。', defaultValue: 64, min: 1 },
    { key: 'caption_extension', type: 'string', label: 'Caption 扩展名', title: 'caption_extension', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', defaultValue: '.txt' },
    // 补暴露（D⑨）：registry newbie_lora.py:128-137 声明、通用 caption 管线消费；
    // newbie 数据集节此前完全没有 caption 组，先收敛这两个高频键。
    { key: 'shuffle_caption', type: 'boolean', label: '随机打乱标签', title: 'shuffle_caption', desc: '每次读取时随机打乱逗号 tag 顺序，防止模型依赖固定位置。建议几乎所有逗号分隔 tag 训练开启（社区惯例）。', defaultValue: false },
    { key: 'shuffle_caption_tags_only', type: 'boolean', label: '仅打乱 Tag 部分', title: 'shuffle_caption_tags_only', desc: '结构化 JSON 标注只打乱 tags 部分，自然语言句子保持原序。建议 JSON 双通道标注时开启。', defaultValue: false, visibleWhen: when('shuffle_caption', true) }
]),
  // 排版重排（2026-08 第 3 站审计 F）：原「save-settings」实为输出+训练参数混挂
  // model 页。按 FIELD_GROUP_SPEC 九组规范拆分：输出/保存件留 save-settings（并
  // 并入 S_SAVE 的 save_state 族），训练参数独立 training-settings 归 training 页。
  sec('save-settings', 'model', '输出与保存', '输出路径与 checkpoint / 训练状态保存。', [
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/newbie' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'newbie-lora' },
    // 后端真相镜像（2026-08 漂移审计）：registry newbie_lora.py declare
    // save_every_n_epochs default=5/min=1；save_every_n_steps 走 UnifiedTrainingConfig
    // 默认 0。两个间隔字段的 0 都表示「关闭该路保存」，但 backend
    // configs_save_interval_interlock.py 在构造期拒绝「两路同时为 0」——run 必挂。
    { key: 'save_every_n_steps', type: 'number', label: '每 N 步保存', title: 'save_every_n_steps', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。0 表示关闭按步保存，此时每轮保存必须 ≥1（两路不能同时为 0）。', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', desc: '每 N 轮保存一次模型（后端默认 5，最小 1）。推荐范围：1–5；0 表示关闭按轮保存，此时按步保存必须 ≥1——两路同时为 0 会在启动时被后端拒绝。', defaultValue: 5, min: 1 },
    ...S_SAVE.filter((f) => ['save_model_as', 'save_precision', 'save_state', 'save_state_on_train_end', 'save_last_n_epochs_state', 'save_last_n_steps_state', 'save_n_epoch_ratio', 'save_last_n_epochs', 'save_last_n_steps'].includes(f.key))
  ]),
  sec('training-settings', 'training', '训练参数', '', [
    { key: 'max_train_epochs', type: 'number', label: '最大训练轮数', title: 'max_train_epochs', desc: '训练遍历整个数据集的次数上限，决定总训练量。推荐范围：小数据集（<50 张）10–30 轮；大数据集 1–5 轮；与 max_train_steps 二选一设置。', defaultValue: 50, min: 1 },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 0, min: 0 },
    { key: 'train_batch_size', type: 'number', label: '批量大小', title: 'train_batch_size', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', defaultValue: 1, min: 1 },
    { key: 'gradient_accumulation_steps', type: 'number', label: '梯度累积', title: 'gradient_accumulation_steps', desc: '累积 N 个 micro-batch 再更新一次参数，等效放大 batch 而不增加峰值显存。推荐范围：1（默认）或 4–8；等效 batch = batch_size × 本值。', defaultValue: 1, min: 1 },
    { key: 'gradient_accumulation_mode', type: 'select', label: '梯度累加模式', title: 'gradient_accumulation_mode', desc: '梯度累加实现路径：fast 只在真正 optimizer.step 时同步/检查（更快），classic 保留旧逐 micro-batch 检查。建议保持 fast，排查累加相关异常时再切 classic 对照。', defaultValue: 'fast', options: [
      { value: 'fast', label: 'fast' },
      // classic 是后端 training_loop_epoch_mixin.py:317 的真实 else 分支，
      // 逐 microbatch 做同步/检查。原先只给 fast，这个分支选不到。
      { value: 'classic', label: 'classic（逐 microbatch 检查）' }
], visibleWhen: (c) => Number(c.gradient_accumulation_steps || 1) > 1 },
    ditGradientCheckpointingField('Newbie'),
    // B2（2026-08 第 3 站审计）：fp32 不在后端 MixedPrecision 枚举
    // （configs_enums.py:135-139 = {no,fp16,bf16}），选中即校验失败；no=关闭 AMP。
    { key: 'mixed_precision', type: 'select', label: '训练精度', title: 'mixed_precision', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', defaultValue: 'bf16', options: ['bf16', 'fp16', 'no'] },
    // 后端 configs_newbie.py:30 + configs.py:280-314 桥接：standard|lulynx，默认 standard。
    // 仅当 ddpm_timestep_sampling 为空且 faster_dit_snr 未开时才桥接，显式设了以其为准。
    { key: 'newbie_sigma_schedule', type: 'select', label: 'Sigma 分布预设', title: 'newbie_sigma_schedule', desc: 'Newbie 训练噪声 sigma 的分布预设：standard 是参考实现自己的默认 logit-normal(0,1)、无分辨率偏移；lulynx 在同一采样上叠加分辨率相关的 flow shift，把更多噪声预算放到高噪声区（分辨率越高 shift 越大），预览与训练走同一条变换。显式设置 ddpm_timestep_sampling 或开启 FasterDiT SNR 时以其为准。建议 standard 起步；出图整体偏灰/高噪细节不足时用 lulynx 做 A/B 对照。', defaultValue: 'standard', options: [
      { value: 'standard', label: 'standard（参考默认）' },
      { value: 'lulynx', label: 'lulynx（分辨率偏移）' },
    ] },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 42 }
]),
  // 排版重排（F）：optimizer-settings 归 optimizer 页（原挂 training 页，而
  // autocontroller 反挂在 optimizer 页，两者一起归位）。
  sec('optimizer-settings', 'optimizer', '优化器与学习率', '', [
    { key: 'optimizer_type', type: 'select', label: '优化器', title: 'optimizer_type', desc: '优化器决定如何用梯度更新权重，是稳定性与显存的关键。AdamW8bit 最稳妥省显存；Prodigy/AutoProdigy 自适应步长免调 LR；ScheduleFree 系内置衰减。建议默认 AdamW8bit + cosine。', defaultValue: 'AdamW8bit', options: TARGET_LORA_OPTIMIZERS },
    { key: 'optimizer_backend', type: 'select', label: 'AdamW 后端', title: 'optimizer_backend', desc: 'AdamW 的后端实现档位（torch/foreach/fused/bnb 等），数值等价但速度显存有别。建议保持 auto 让后端择优。', defaultValue: 'auto', options: OPTIMIZER_BACKEND_OPTIONS, visibleWhen: all(when('performance_expert_mode', true), adamwFamilyOptimizer) },
    { key: 'advanced_optimizer_strategy', type: 'select', label: '高级优化策略', title: 'advanced_optimizer_strategy', desc: '高级优化策略入口：auto 自动判定；lora_plus/rs_lora 等在此叠加。建议 auto，不需要特殊策略时无感。', defaultValue: 'auto', options: ADVANCED_OPTIMIZER_STRATEGY_OPTIONS, visibleWhen: when('performance_expert_mode', true) },
    { key: 'optimizer_args_custom', type: 'textarea', label: '自定义 optimizer_args', title: 'optimizer_args_custom', desc: '自定义优化器参数，每行一个 key=value。', defaultValue: '' },
    { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '0.0001' },
    { key: 'weight_decay', type: 'number', label: '权重衰减', title: 'weight_decay', desc: 'AdamW 系 L2 正则强度，抑制权重无限增长。推荐范围：0.01（默认）；Prodigy/DAdaptation 系会自行管理，可设 0。', defaultValue: 0.01, min: 0, step: 0.0001 },
    { key: 'lr_scheduler', type: 'select', label: '学习率调度器', title: 'lr_scheduler', desc: '学习率随训练进度的变化曲线，影响中后期收敛质量。建议常规 LoRA 选 cosine 或 cosine_with_restarts；不确定时保持默认即可，loss 门控类调度适合想避免余弦过早触底的实验。', defaultValue: 'cosine', options: schedulerOptions(ALL_SCHEDULERS) },
    { key: 'lr_warmup_steps', type: 'number', label: 'Warmup 步数', title: 'lr_warmup_steps', desc: '训练开始时学习率从 0 线性升到目标值的步数，避免初期大步长破坏稳定。推荐范围：0–500 步（默认 0 即可不预热；大数据集或高 LR 建议 100 左右）。', defaultValue: 100, min: 0 },
    { key: 'lr_scheduler_num_cycles', type: 'number', label: '重启次数', title: 'lr_scheduler_num_cycles', desc: 'cosine_with_restarts 的重启次数：每个周期结束学习率回升再衰减。推荐范围：1–4（默认 1；多周期可缓解后期僵化）。', defaultValue: 1, min: 1, visibleWhen: when('lr_scheduler', 'cosine_with_restarts') },
    { key: 'lr_scheduler_type', type: 'string', label: '自定义调度器类', title: 'lr_scheduler_type', desc: '自定义学习率调度器类路径', defaultValue: '' },
    { key: 'lr_scheduler_args', type: 'textarea', label: '自定义调度器参数', title: 'lr_scheduler_args', desc: '传给调度器的额外参数（如 min_lr），每行一个 key=value。不认识调度器的参数会被忽略，建议保持为空除非文档明确要求。', defaultValue: '' },
    ...S_LOSS_AWARE_LR,
    { key: 'prodigy_d0', type: 'string', label: 'Prodigy d0', desc: 'Prodigy 初始步长估计。推荐范围：1e-6（默认，小值起步最稳）。', defaultValue: '', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
    { key: 'prodigy_d_coef', type: 'string', label: 'Prodigy d_coef', desc: 'Prodigy 步长放大系数。推荐范围：1.0（默认）；>1 更激进易过冲。', defaultValue: '2.0', visibleWhen: (cfg) => ['prodigy', 'prodigyplus.prodigyplusschedulefree'].includes(String(cfg.optimizer_type || '').trim().toLowerCase()) },
    { key: 'max_grad_norm', type: 'number', label: '梯度裁剪', title: 'max_grad_norm', desc: '梯度裁剪的全局范数上限，防止个别 step 梯度爆炸。推荐范围：保持默认 1.0；LoRA 一般无需改动，全参微调也常用 1.0。', defaultValue: 1.0, min: 0, step: 0.01 }
]),
  sec('negative-semantic-regularization', 'frontier', '负面语义正则', '用负面提示词约束 LoRA 在不希望语义上的增量。', [...S_NEGATIVE_SEMANTIC_REGULARIZATION]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  sec('peak-vram-settings', 'speed', '显存峰值控制', '目标等效 batch、启动峰值保护、micro-batch 拆分与显存诊断。', [...S_PEAK_VRAM]),

  sec('adapter-settings', 'network', '适配器设置', 'LoRA / LoKr 适配器参数。', [
    { key: 'adapter_type', type: 'select', label: '适配器类型', title: 'adapter_type', desc: 'Newbie 适配器类型选择，会映射到原生 LoRA 路线。建议 lora；其余为预留入口。', defaultValue: 'lora', options: NEWBIE_ADAPTER_TYPE_OPTIONS },
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', defaultValue: 0.05, min: 0, step: 0.01 },
    { key: 'flexrank_lora_rank_range_min', type: 'number', label: 'FlexRank 最小 Rank', title: 'flexrank_lora_rank_range_min', desc: 'FlexRank 采样激活 rank 下界；上界沿用 network_dim。推荐范围：dim 的 25%–50%。', defaultValue: 1, min: 1, visibleWhen: when('adapter_type', 'flexrank') },
    { key: 'newbie_target_modules', type: 'textarea', label: '目标模块列表', title: 'newbie_target_modules', desc: '目标模块列表，一行一个', defaultValue: 'attention.qkv\nattention.out\nfeed_forward.w2\ntime_text_embed.1\nclip_text_pooled_proj.1' },
    // B5（2026-08 第 3 站审计）：原 lokr_rank/lokr_alpha/lokr_dropout 三个滑条是
    // 误导性双轨——field_alias_map.py:115-117 把它们改名到 network_dim/network_alpha/
    // network_dropout，而 merge_field_aliases 规则 canonical 原值优先
    // （field_alias_map.py:437-462）⇒ 只要表单同时有 Rank/Alpha/Dropout（恒有），
    // 这三个 LoKr 专属值永远被忽略。LoKr 结构尺寸直接复用上方 Rank/Alpha/Dropout
    // （后端本就同源），删除三个假旋钮；LoKr 特有参数保留如下。
    { key: 'lokr_factor', type: 'number', label: 'LoKr Factor', desc: 'LoKr Kronecker 分解因子：越大越省参数越弱表达。-1 表示无穷大因子（最省）。推荐范围：4（常用起点）～8；-1 极限压缩。', defaultValue: -1, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_rank_dropout', type: 'number', label: 'LoKr Rank Dropout', desc: 'LoKr 按 rank 维度随机丢弃概率。推荐范围：0 默认；≤0.1 试验。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_module_dropout', type: 'number', label: 'LoKr Module Dropout', desc: 'LoKr 按整个模块随机丢弃概率。推荐范围：0 默认。', defaultValue: 0, min: 0, step: 0.01, visibleWhen: when('adapter_type', 'lokr') },
    { key: 'lokr_train_norm', type: 'boolean', label: 'LoKr 训练 Norm', title: 'lokr_train_norm', desc: 'LoKr 同时训练归一化层参数。建议仅在风格迁移类任务试验，默认关闭。', defaultValue: false, visibleWhen: when('adapter_type', 'lokr') },
    ...S_LAYERED_ALPHA_GENERIC,
    // 补暴露（D⑧）：PiSSA / OLoRA / LoftQ 统一初始化入口。registry
    // newbie_lora.py:172-197 声明、configs_validators.py:274-306 统一消费；
    // SD/FLUX 由 netLora 提供，newbie 此前缺块。
    { key: 'adapter_init_strategy', type: 'select', label: 'LoRA 初始化策略', title: 'adapter_init_strategy', desc: '统一初始化入口：default 标准 LoRA；pissa/olora/loftq 特殊初始化（仍走请求管线，不加新入口）。建议 default，需要快速收敛换 pissa。', defaultValue: 'default', options: ADAPTER_INIT_STRATEGY_OPTIONS, visibleWhen: (c) => String(c.adapter_type || 'lora') === 'lora' },
    { key: 'adapter_init_export_mode', type: 'select', label: '初始化导出模式', title: 'adapter_init_export_mode', desc: '特殊初始化产物的导出方式：auto 在最终保存时转成可直接加载到原底模的 LoRA。建议 auto。', defaultValue: 'auto', options: ADAPTER_INIT_EXPORT_MODE_OPTIONS, visibleWhen: all(when('adapter_type', 'lora'), nativeLoraInitSelected) },
    { key: 'loftq_bits', type: 'number', label: 'LoftQ 量化位宽', title: 'loftq_bits', desc: 'LoftQ 量化位宽（fake-quant 初始化，不是持久 4bit 底座）。推荐范围：4（默认）或 8。', defaultValue: 4, min: 2, max: 8, step: 1, visibleWhen: all(when('adapter_type', 'lora'), loftqInitSelected) },
    { key: 'loftq_quant_type', type: 'select', label: 'LoftQ 量化粒度', title: 'loftq_quant_type', desc: '量化粒度：rowwise 按输出通道，tensorwise 整张量。建议 rowwise（默认，精度更好）。', defaultValue: 'rowwise', options: LOFTQ_QUANT_TYPE_OPTIONS, visibleWhen: all(when('adapter_type', 'lora'), loftqInitSelected) },
    ...S_LORA_VARIANTS
]),
  sec('cache-runtime-settings', 'speed', '缓存与运行时', '缓存流程控制与显存管理。', [
    { key: 'use_cache', type: 'boolean', label: '启用缓存流程', title: 'use_cache', desc: '生成并复用版本匹配的 Newbie latent 与文本条件缓存，避免常驻 VAE/文本编码器。推荐范围：数据未变时保持 true（默认）；数据变更后重建。', defaultValue: true },
    // P0（2026-08 第 3 站审计 §0）：后端实义是「只建缓存、跳过训练循环」——
    // trainer_execution_dataset_setup.py:72-76 命中后，dataloader setup 直接
    // early_exit（trainer_execution_dataloader_setup.py:57-73）；registry schema 同义
    // 且默认 False（newbie_lora.py:407-411）。旧默认 true + 「参与训练」文案会让全新
    // 默认启动即空跑，改为 false 并如实描述。
    { key: 'newbie_force_cache_only', type: 'boolean', label: '仅构建缓存（不训练）', title: 'newbie_force_cache_only', desc: '只构建/补全缓存后提前退出，不进入训练循环；用于大数据集预处理。与「强制重建缓存」同开时仅重建并跳过训练。建议大批量预处理时单独跑一次。', defaultValue: false },
    { key: 'newbie_rebuild_cache', type: 'boolean', label: '强制重建缓存', title: 'newbie_rebuild_cache', desc: '无视既有缓存强制重建全部工件。建议数据/标注变更后开一次，平时关闭。', defaultValue: false },
    { key: 'newbie_cache_build_batch_size', type: 'number', label: '缓存构建批大小', title: 'newbie_cache_build_batch_size', desc: '首轮缓存构建每批编码图像数。推荐范围：8（默认），OOM 减半。', defaultValue: 8, min: 1 },
    { key: 'newbie_cache_build_prefetch', type: 'boolean', label: '缓存构建 CPU 预取', title: 'newbie_cache_build_prefetch', desc: '首轮构建时 CPU 线程预解码下一批，与 GPU 编码重叠。建议内存充足开启。', defaultValue: false },
    { key: 'gemma3_prompt', type: 'textarea', label: 'Gemma3 系统提示词', title: 'gemma3_prompt', desc: 'Gemma3 系统提示词。默认与官方模板对齐', defaultValue: 'You are an assistant designed to generate high-quality anime images with the highest degree of image-text alignment based on textual prompts. <Prompt Start>' },
    { key: 'newbie_gemma_max_token_length', type: 'number', label: 'Gemma 最大 Token', title: 'newbie_gemma_max_token_length', desc: 'Newbie Gemma 通道 token 上限。推荐范围：512（默认）。', defaultValue: 512, min: 32 },
    { key: 'newbie_clip_max_token_length', type: 'number', label: 'CLIP 最大 Token', title: 'newbie_clip_max_token_length', desc: 'Newbie CLIP 通道 token 上限。推荐范围：2048 内按需；过大拖慢缓存构建。', defaultValue: 2048, min: 32 },
    { key: 'newbie_caption_length_bucket_size', type: 'number', label: 'Caption Bucket 大小', title: 'newbie_caption_length_bucket_size', desc: '按 caption 长度分桶的大小，减少 padding 浪费。推荐范围：0 自动或 32–128。', defaultValue: 0, min: 0 },
    ...VRAM_AUTO_ENHANCE_FIELDS,
    ...NEWBIE_BLOCK_RESIDENCY_FIELDS,
    { key: 'swap_granularity', type: 'select', label: '显存交换模式', title: 'swap_granularity', desc: '显存交换模式总开关：选择按 block 还是 layer 粒度把冻结权重在 CPU/GPU 间搬运。建议显存不足先试 block 粒度档位。', defaultValue: 'off', options: ['off', 'auto', 'block', 'merged_block', 'layer'] },
    { key: 'swap_ratio', type: 'slider', label: '显存交换比例', title: 'swap_ratio', desc: '按 block 总数比例决定交换多少（0–1）。推荐范围：0.3–0.5 起步试探，配合水线自动调节。', defaultValue: 0, min: 0, max: 1, step: 0.05, visibleWhen: swapEnabled },
    { key: 'swap_count', type: 'number', label: '显存交换数量', title: 'swap_count', desc: '绝对交换数量，大于 0 时优先于比例。推荐范围： 0 用比例控制，精确控卡时才给具体数。', defaultValue: 0, min: 0, visibleWhen: swapEnabled },
    { key: 'block_merge_size', type: 'number', label: '合并 Block 大小', title: 'block_merge_size', desc: 'merged_block 模式下每组包含的相邻 block 数（不跨组边界）。推荐范围：2（默认）。', defaultValue: 2, min: 2, visibleWhen: when('swap_granularity', 'merged_block') },
    { key: 'block_swap_strategy', type: 'select', label: 'BlockSwap 搬运策略', title: 'block_swap_strategy', desc: 'BlockSwap 搬运策略：auto 由后端按家族解析最优路径。建议保持 auto。', defaultValue: 'auto', options: BLOCK_SWAP_STRATEGY_OPTIONS, visibleWhen: all(swapEnabled, when('performance_expert_mode', true)) },
    { key: 'blocks_to_swap', type: 'number', label: 'CPU 交换 Block 数', title: 'blocks_to_swap', desc: '将 N 个 U-Net/DiT block 卸载到 CPU（0=关闭）。推荐范围：DiT 28–48 层模型从 8–16 起步，每加一档省约一层显存换一点速度。', defaultValue: 0, min: 0 },
    { key: 'newbie_auto_swap_release', type: 'boolean', label: '自动 Swap 释放', desc: '显存持续偏低时逐步减少 blocks_to_swap 回收训练速度。建议开启让长训自适应提速。', defaultValue: false },
    { key: 'cpu_offload_checkpointing', type: 'boolean', label: 'CPU 卸载检查点', title: 'cpu_offload_checkpointing', desc: '梯度检查点时把部分张量卸载到 CPU，进一步省显存但更慢。建议极端显存场景才开。', defaultValue: false },
    ...S_MEMORY_RECLAIM,
    { key: 'pytorch_cuda_expandable_segments', type: 'boolean', label: '显存碎片优化', title: 'pytorch_cuda_expandable_segments', desc: '训练前设置 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True 减少碎片 OOM。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'newbie_safe_fallback', type: 'boolean', label: 'OOM 安全回退', title: 'newbie_safe_fallback', desc: 'OOM 时自动尝试更保守的 Newbie 回退组合。建议保持 true（默认）提高存活率。', defaultValue: true },
    { key: 'trust_remote_code', type: 'boolean', label: '允许远程代码', title: 'trust_remote_code', desc: '允许 transformers/diffusers 执行模型仓库自带自定义代码。安全敏感：仅对可信来源开启。', defaultValue: false },
    ...S_DIT_PERFORMANCE_EXPERT
  ]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('lulynx-settings', 'advanced', 'Lulynx 核心 (Newbie)', 'SafeGuard、EMA、ResourceManager、SmartRank、AutoController。', S_LULYNX_SDXL),
  // 排版重排（F）：日志设置从 model 页摘下归 advanced（model 页只留模型/网络身份）。
  sec('log-settings', 'advanced', '日志设置', '', [
    { key: 'log_with', type: 'select', label: '日志模块', title: 'log_with', desc: '训练指标上报渠道。建议 tensorboard（默认）；wandb 需要联网与 API key。', defaultValue: 'tensorboard', options: ['tensorboard', 'wandb'] },
    { key: 'logging_dir', type: 'folder', pickerType: 'folder', label: '日志保存文件夹', title: 'logging_dir', desc: 'TensorBoard 日志目录。建议保持默认或指向独立的 logs 目录，便于多 run 对比。', defaultValue: './logs' },
    { key: 'log_prefix', type: 'string', label: '日志前缀', title: 'log_prefix', desc: '日志前缀', defaultValue: '' },
    { key: 'wandb_api_key', type: 'string', label: 'WandB API Key', desc: 'Weights & Biases API key，仅 log_with=wandb 时必填。注意保密，勿提交到仓库。', defaultValue: '', visibleWhen: when('log_with', 'wandb') }
]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 Newbie 的共享噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('dit-blockskip-training', 'frontier', 'DiT BlockSkip 训练裁剪', '训练时按固定计划跳过部分 Newbie DiT block 计算。开启后只走 blockskip，', [...S_DIT_BLOCKSKIP], { expert: true }),
  sec('sigma-depth-schedule', 'frontier', 'σ 深度调度', '按当前样本 RF σ 调度本步 DiT 计算深度；identity 跳过不断 grad。', [...S_SIGMA_DEPTH_SCHEDULE], { expert: true }),
  // 排版对齐（F）：quality-pack / diagnostics 与 flux/krea2 同组一样标 expert。
  sec('quality-pack-settings', 'frontier', '图像质量优化', '线稿保护、DCT 频域、Gram 纹理、Scale Guidance。', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('perceptual-anchor-loss', 'frontier', '感知锚/频域纹理损失', 'latent 频域纹理 + 感知锚, 参与 loss 拆分。', [...S_PERCEPTUAL_ANCHOR_LOSS]),
  sec('sampling-optimization-reserve', 'frontier', '采样与优化', 'ANT / BP-low / AnyFlow / DOP / Coreset。', [...S_SAMPLING_OPTIMIZATION_RESERVE], { expert: true }),
  sec('repa-reserve', 'frontier', 'REPA 表征对齐', 'SoftREPA 软化版渐进对齐。', [...S_REPA_RESERVE]),
  sec('experimental-probes', 'frontier', '实验探针', '探针/诊断开关。', [...S_EXPERIMENTAL_PROBES]),
  sec('diagnostics-settings', 'frontier', '诊断与监控', '高级监控/统计/深度诊断/逐层监测。', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('autocontroller-settings', 'optimizer', 'AutoController', '高级功能。根据训练状态自动调整学习率、早停等。', [...S_AUTO_CONTROLLER], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优与加速。', [...S_TURBOCORE], { expert: true })
];

// ---- Krea-2 LoRA (Turbo / Raw) ----
export const KREA2_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Krea-2 模型路径（Turbo 或 Raw：可选模型目录，也可直接选单个 .safetensors 文件）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'krea2-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'Krea-2 模型路径', title: 'pretrained_model_name_or_path', desc: '可填模型目录或直接选单个 .safetensors 文件；选单文件时 TE/VAE 会从同目录的 text_encoder/、vae/ 子目录或兄弟 Krea-2 目录树自动解析，找不到时退用 CLIP/sdxl-vae 兜底（可能影响训练质量）', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/krea2' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'krea2-lora' },
    { key: 'use_cache', type: 'boolean', label: '启用缓存流程', title: 'use_cache', desc: '优先复用 Krea-2 latent 与文本编码缓存，避免训练时常驻 VAE/文本编码器。推荐范围：保持 true（默认）。', defaultValue: true },
    {
      key: 'krea2_training_mode',
      type: 'select',
      label: '训练模式',
      desc: 'Krea2 训练模式选择。建议按任务选默认档。',
      defaultValue: 'de_turbo',
      options: [
        { value: 'de_turbo', label: 'De-Turbo（Turbo 推荐；Raw 会自动改 standard）' },
        { value: 'frozen_delta', label: 'Frozen Delta（冻底模 / 偏保 Turbo 快推）' },
        { value: 'sigma_selective', label: 'Sigma Selective（只训高噪声区间）' },
        { value: 'standard', label: 'Standard（Raw 推荐 / 标准 RF）' }
],
    },
    {
      key: 'krea2_text_fusion_mode',
      type: 'select',
      label: '文本融合模式',
      desc: '决定缓存与 DiT 装载：fusion_frozen 缓存 txtfusion 后输出（默认，塔不参训）；fusion_trainable 缓存 12 层原始 stack 并装回 343M txtfusion 塔参训。两种模式的缓存互不兼容，切换需重建缓存',
      defaultValue: 'fusion_frozen',
      options: [
        { value: 'fusion_frozen', label: 'Fusion Frozen（默认；缓存融合后文本，塔冻结）' },
        { value: 'fusion_trainable', label: 'Fusion Trainable（缓存 12 层 stack，塔参训）' }
],
    },
    {
      key: 'krea2_sigma_selective_threshold',
      type: 'number',
      label: 'Sigma Selective 阈值',
      desc: 'Krea2 σ 选择性阈值：仅特定噪声段参与计算。推荐范围：默认。',
      defaultValue: 0.5,
      min: 0.1,
      max: 0.95,
      step: 0.05,
      visibleWhen: (c) => c.krea2_training_mode === 'sigma_selective',
    }
]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '512,512' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 4, min: 0 }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'Krea-2 LoRA 参数。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（2026-08 第 6 站桶）：Krea-2 族 default_sampler_pipeline=None
  // （model_family.py:292-435，sampler_preview.py:149-152 对 None 直接 return），
  // 预览与质量评估在本族为永久 no-op。整节下架（sec hidden 机制）：数据定义保留，
  // 待后端接入签名采样管线后去掉 hidden 即恢复。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...KREA2_SPEED_FLOW_FIELDS]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  // 排版重排（F）：vram_preset 覆写的正是本组的 slots/prefetch/pin，移到组顶并
  // 说明真实语义。注意：后端只在「用户未显式设置」时才按预设覆写三键
  // （configs.py:341-347 的 model_fields_set 判断）；提交层把 aggressive 下仍属
  // 「未触碰的注入默认」的 standard 档键值剥除
  // （runConfigBuilder.normalizeKrea2VramPreset，经 buildRunConfig 的 explicitKeys
  // 区分手填），否则 always-submit 的默认值会短路预设。
  sec('krea2-offload-settings', 'speed', 'Krea2 Block/Layer Offload', '显存预设 + resident / block_offload / layer_offload 与预取、槽位。', [
    {
      key: 'krea2_vram_preset',
      type: 'select',
      label: '显存预设',
      desc: 'Krea2 显存预设档。建议按实际显存选相邻档，不超配。',
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: 'Standard（默认平衡 / 4 GPU slots）' },
        { value: 'aggressive', label: 'Aggressive（更省显存 / 3 GPU slots）' }
],
    },
    ...KREA2_OFFLOAD_FIELDS,
  ]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 Krea-2 的共享噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

const KREA2_DEPTH_EXPANSION_FIELDS = [
  { key: 'krea2_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'krea2_depth_expansion_enabled', desc: '交错复制 Krea-2 block，并以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'krea2_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'krea2_depth_expansion_target_layers', desc: '扩层后的 Transformer block 总数。', defaultValue: 40, min: 2, step: 1, visibleWhen: when('krea2_depth_expansion_enabled', true) },
  { key: 'krea2_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'krea2_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('krea2_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

const KREA2_FT_EXCLUDED_FIELDS = new Set([
  'lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled',
  'weight_compression_preset', 'weight_compression_verify', 'train_quant_preset',
  'weight_compression_enabled', 'weight_compression_target', 'weight_compression_format',
  'quant_train_mode', 'keep_w8_vram_prefer', 'quant_train_convrot',
  'layer_precision_policy', 'layer_precision_default', 'layer_precision_sensitivity_mode',
  'layer_precision_activation_geometry_path',
  'layer_precision_rules_json', 'layer_precision_overrides_json', 'quant_requantize_policy',
  'vram_swap_to_ram',
  'lulynx_weight_noise_enabled', 'lulynx_weight_noise_mode', 'lulynx_weight_noise_sigma',
  'lulynx_weight_noise_bound_norm', 'lulynx_weight_noise_log_every', 'merge_export',
  'network_train_unet_only', 'network_train_text_encoder_only',
  // F 对称过滤（第 6 站桶，参照 H3 桶模式）：thin_svd_* 与 ConvRot groupsize 是
  // LoRA 导出件，全参微调无语义。
  'thin_svd_export_enabled', 'thin_svd_export_rank', 'export_comfy_int8_groupsize',
]);

// krea2-finetune 派生自 KREA2_LORA_SECTIONS，若不处理会把 krea2-lora 的三条历史
// 重复（save_every_n_steps / save_every_n_epochs / train_batch_size）带进新类型，
// 撞 webui_duplicate_field_key_smoke 的重复总量基线。跨 section 按 key 去重：
// 两份定义的默认值相同，保留首份不改变 createDefaultConfig 的生效结果。
const dropDuplicateFieldKeys = (sections) => {
  const seen = new Set();
  return sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => {
      if (!field?.key) return true;
      if (seen.has(field.key)) return false;
      seen.add(field.key);
      return true;
    }),
  }));
};

export const KREA2_FT_SECTIONS = dropDuplicateFieldKeys(KREA2_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'krea2-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Krea-2 底座输出文件名', defaultValue: 'krea2-expanded' };
      if (field.key === 'krea2_training_mode') {
        return { ...field, options: field.options.filter((option) => option.value !== 'frozen_delta') };
      }
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Krea-2 全参微调', description: '训练完整 Krea-2 DiT，或扩展深度后只训练新增层。', fields: [...fields, ...KREA2_DEPTH_EXPANSION_FIELDS] };
  }));

// ---- FLUX.2 Klein LoRA ----
// 分模型默认：slots=4 / prefetch=3 / pin=true（与 krea2 4/2 字段分离）
// 不挂：krea2_training_mode / vram_preset / layer_offload / de_turbo
export const FLUX2_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'FLUX.2 Klein 模型路径（完整本地目录，含 transformer + text_encoder + vae + scheduler）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'flux2-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'FLUX.2 模型目录', title: 'pretrained_model_name_or_path', desc: '完整本地目录，含 transformer/、text_encoder/', defaultValue: '' },
    {
      key: 'flux2_model_version',
      type: 'select',
      label: '模型版本',
      desc: 'Flux2 版本声明，决定缓存与结构分支。必须与底模一致。',
      defaultValue: 'klein-base-9b',
      options: [
        { value: 'klein-base-9b', label: 'klein-base-9b（推荐）' }
      ]
    },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/flux2' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'flux2-lora' }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练数据与分辨率。cache 文件后缀 *_flux2.npz。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
    // 幻影治理（B，2026-08 第 6 站桶）：BUCKET_TRAINING_MATRIX 没有 flux2 行
    // （bucket_training_contract.py:9-85）→ known=False、knobs 无契约保障，
    // enable_bucket/min/max 三键处于「无契约」状态。后端补矩阵行之前不暴露；
    // 后端 UnifiedTrainingConfig 自有默认（enable_bucket=true）不受影响。
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '启用后优先读 latent/TE 缓存（*_flux2 格式）。推荐范围：保持开启；缓存与模型版本必须匹配。', defaultValue: false }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'FLUX.2 Klein LoRA 参数。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（第 6 站桶）：FLUX.2 族 sampler pipeline=None，预览/质量评估永久 no-op → 整节下架。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('flux2-offload-settings', 'speed', 'FLUX.2 Block Offload', 'resident / block_offload 与预取、槽位。默认 slots=4、prefetch=3、pin=true。无 layer_offload。', [...FLUX2_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('noise-settings', 'advanced', '噪声设置', 'noise_offset=0 表示关闭；正数会进入 FLUX.2 RF 噪声构造。', [...S_NOISE]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

// ---- Boogu-Image Base LoRA（RunComfy 产品默认）----
// rank/α 32/32 · LR 1e-4 · steps 2500 · buckets 512+768+1024 · Layer offload OFF
// cache 后缀 *_boogu.npz；指令 TE dim=4096；支持 BF16 与官方 Base/Edit-fp8（torchao dequant）
// ---- Z-Image Base LoRA ----
export const ZIMAGE_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练与模型', 'Z-Image 模型路径：diffusers 本地目录（含 transformer + text_encoder + vae + scheduler）。默认 Base 包。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'zimage-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Z-Image 模型目录', title: 'pretrained_model_name_or_path', desc: 'diffusers 目录，含 transformer/', defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/zimage' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'zimage-lora' },
    { key: 'zimage_max_text_length', type: 'number', label: '最大文本长度', title: 'zimage_max_text_length', desc: 'Qwen3 TE 序列长度，默认 512。', defaultValue: 512, min: 64, max: 2048 },
    { key: 'zimage_timestep_sampling', type: 'select', label: '时间步采样', title: 'zimage_timestep_sampling', desc: 'ZImage 时间步采样分布。建议保持默认。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigmoid', label: 'sigmoid' }
    ] },
    { key: 'zimage_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'zimage_discrete_flow_shift', desc: 'discrete flow shift，默认 2.0。', defaultValue: 2.0, min: 0.1, step: 0.1 }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '训练图片与分辨率。cache 后缀 *_zimage.npz（读/写契约与 manifest 校验均已落地）。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', label: 'Bucket 最小分辨率', defaultValue: 256, min: 64 },
    { key: 'max_bucket_reso', type: 'number', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', label: 'Bucket 最大分辨率', defaultValue: 1536, min: 64 },
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    // C⑧（2026-08 第 6 站桶）：zimage 缓存契约已落地（dataset_setup 读侧 gate +
    // cache_build_registry 写侧 + manifest 校验），默认值与其余缓存族对齐转 true；
    // 原文案「契约后续补齐」已过时，如实描述。
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '读取/写入 *_zimage.npz latent 与文本条件缓存（带变体自描述校验），避免训练时常驻 VAE/Qwen3 编码器；关闭则回落 live 编码。推荐范围：保持 true（默认）；数据变更后强制重建一次。', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 网络', 'Z-Image LoRA 默认 rank/alpha 16。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    // DoRA 叠加开关（D，2026-08 第 6 站桶）：zimage 行已实证（schemaCommon
    // DORA_SUPPORT_BY_MODEL_FAMILY，注入链无架构白名单、TE 目标列表恒空 → 仅落
    // DiT）。单开关形态：提交层经 normalizeAdapterEntityMutex 归一为
    // use_dora/dora_enabled 训练旗标；向导 rider（doraToggleState）读写同一键。
    { key: 'dora_enabled', type: 'boolean', label: '叠加 DoRA 权重分解', title: 'dora_enabled', desc: 'DoRA 把权重分解为方向+幅度联合训练，表达力强于同 rank LoRA 但稍慢。建议在原生 LoRA 基础上叠加使用；与 LyCORIS 族互斥（注入链短路）。', defaultValue: false },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('region-focus', 'frontier', '区域聚焦配方', '在语义区域权重上叠加聚焦强度×步程衰减；需预处理语义 mask。', [...S_REGION_FOCUS]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（第 6 站桶）：Z-Image 族 sampler pipeline=None，预览/质量评估永久 no-op → 整节下架。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('zimage-offload-settings', 'speed', 'Z-Image Block Offload', 'resident / block_offload 与预取槽位。默认 slots=4、prefetch=2、pin=true。', [...ZIMAGE_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级参数', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调参。', [...S_TURBOCORE], { expert: true })
];

const WAN22_A14B_OFFLOAD_FIELDS = WAN22_OFFLOAD_FIELDS.map((field) => {
  if (field.key === 'wan22_block_offload_gpu_slots') {
    return { ...field, defaultValue: 2, desc: 'A14B 每次只加载 high/low 中所选单塔；显存安全基线同时驻留 2 个 block。' };
  }
  if (field.key === 'wan22_block_offload_prefetch_depth') {
    return { ...field, defaultValue: 1, desc: 'A14B 显存安全基线只异步预取后续 1 个 block。' };
  }
  return field;
});

// C①②③（2026-08 第 6 站桶）：Wave3 E2 短 clip 时间策略三键，仿 ltx23 的
// LTX2_VIDEO_FIELDS 形态补暴露。消费点：video_clip_contract.py:146-147（clip 契约）、
// trainer_cache_build_runtime.py:198-206（cache build options + fingerprint）。
// 后端默认 F=1（configs_boogu.py:71-73），与产品单图训练默认一致。
const WAN22_VIDEO_FIELDS = [
  { key: 'wan22_target_frames', type: 'number', label: '目标帧数', title: 'wan22_target_frames', desc: '训练 clip 目标帧数；单图训练保持 1。', defaultValue: 1, min: 1, step: 1 },
  { key: 'wan22_frame_stride', type: 'number', label: '帧采样步长', title: 'wan22_frame_stride', desc: '相邻采样帧之间的源视频帧间隔。', defaultValue: 1, min: 1, step: 1 },
  { key: 'wan22_fps', type: 'number', label: 'FPS', title: 'wan22_fps', desc: '元数据帧率，写入缓存指纹；不影响采样步长。', defaultValue: 16, min: 1, step: 1 },
];

// C⑦（登记为「有意不暴露」）：wan22_sigma_stage_routing / sigma_stage_boundary
// （configs_boogu.py:75-76）虽在 wan22_sigma_stage_routing.py 有真实消费者，但
// 训练路由是 primary-only 硬校验：wan22_noise_stage 只允许 high/low（'both' 直接
// ValueError），且 validate_wan22_training_routing 在检测到双塔配置时直接拒绝
// sigma-stage 训练（RuntimeError）；单塔下开启 routing 只会得到 "no_secondary"
// 回落主塔的 no-op。即当前任何可启动组合下该开关都不产生效果——登记为不暴露，
// 待后端开放双塔导出/注入后再上 frontier 组。

// 排版收敛（F）：TI2V / A14B 双入口参数化派生（对齐 ltx25 的 retarget 形态），
// 只保留真正差异：typeId、模型文案、变体默认、flow shift 默认与 offload 档位。
// 差异之外的字段面单一来源，避免双份定义漂移。
const wan22Sections = ({
  typeId,
  modelDesc,
  pathLabel,
  pathDesc,
  outputDir,
  outputName,
  variantDefault,
  variantDesc,
  flowShiftDefault,
  offloadFields,
  offloadDesc,
}) => ([
  sec('model-settings', 'model', '训练用模型', modelDesc, [
    { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: pathLabel, title: 'pretrained_model_name_or_path', desc: pathDesc, defaultValue: '' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: outputDir },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: outputName },
    { key: 'wan22_model_variant', type: 'select', label: '变体', title: 'wan22_model_variant', desc: `Wan2.2 变体选择（14B/A14B 等），决定权重结构与缓存格式：${variantDesc}。建议与底模严格一致，选错会在加载权重时直接失败。`, defaultValue: variantDefault, options: [
      { value: 'ti2v-5b', label: 'TI2V-5B' },
      { value: 't2v-a14b', label: 'T2V-A14B' }
    ] },
    { key: 'wan22_noise_stage', type: 'select', label: 'A14B 噪声塔', title: 'wan22_noise_stage', desc: 'Wan2.2 双专家噪声阶段划分（high/low）。由底模配对决定，建议保持默认。', defaultValue: 'high', options: [
      { value: 'high', label: 'high_noise' },
      { value: 'low', label: 'low_noise' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_expert_timestep_preset', type: 'select', label: '按塔限定时间步', title: 'wan22_expert_timestep_preset', desc: '默认关。开启后按后端的噪声塔 σ 边界填时间步先验（high→[875,1000)，low→[0,875)）。只写你没填的字段：手填过范围或分段权重时本预设不生效。', defaultValue: 'off', options: [
      { value: 'off', label: '关闭（默认）' },
      { value: 'auto', label: 'auto（跟随所选塔）' },
      { value: 'high', label: '强制 high 区间' },
      { value: 'low', label: '强制 low 区间' }
    ], visibleWhen: when('wan22_model_variant', 't2v-a14b') },
    { key: 'wan22_max_text_length', type: 'number', label: '最大文本长度', title: 'wan22_max_text_length', desc: 'umT5 序列长度，默认 512。', defaultValue: 512, min: 64, max: 1024 },
    { key: 'wan22_timestep_sampling', type: 'select', label: '时间步采样', title: 'wan22_timestep_sampling', desc: 'Wan2.2 时间步采样分布。建议保持默认 shift 族。', defaultValue: 'shift', options: [
      { value: 'shift', label: 'shift（推荐）' },
      { value: 'uniform', label: 'uniform' },
      { value: 'sigmoid', label: 'sigmoid' }
    ] },
    { key: 'wan22_discrete_flow_shift', type: 'number', label: 'Flow shift', title: 'wan22_discrete_flow_shift', desc: 'TI2V/I2V 倾向 5.0；T2V 常见 12.0。', defaultValue: flowShiftDefault, min: 0.1, step: 0.1 }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '首版支持图像当 1 帧（F=1）或短 clip 潜空间；推荐合成/缓存 text embeds。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '704,704' },
    // 幻影治理（B，第 6 站桶）：bucket matrix 中 wan22 行 support="none"、knobs=()
    // （bucket_training_contract.py:73-78），连 enable_bucket 都不在契约里，
    // 三键纯惰性 → 不暴露；后端自有默认不受影响。
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 2, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用 Wan2.2 cache-first', title: 'use_cache', desc: '默认读取兼容的 *_wan22.npz latent/文本条件缓存，避免常驻 VAE/文本编码器。推荐范围：保持 true（默认）。', defaultValue: true },
    ...WAN22_VIDEO_FIELDS,
  ]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'save_every_n_steps', type: 'number', desc: '每 N 步保存一次模型。推荐范围：500–2000；与 epoch 保存互斥。', label: '每 N 步保存', title: 'save_every_n_steps', defaultValue: 0, min: 0 },
    { key: 'save_every_n_epochs', type: 'number', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', label: '每 N 轮保存', title: 'save_every_n_epochs', defaultValue: 1, min: 0 },
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
  ]),
  sec('adapter-settings', 'network', 'LoRA 设置', 'Wan2.2 LoRA 默认 rank/alpha 16；目标 attn1/attn2 + FFN。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    // DoRA 叠加开关（D，第 6 站桶）：仅 TI2V-5B 单塔入口提供；A14B 暂缓
    // （arch_capability_registry notes：单塔显存基线刚绿，DoRA 幅度向量叠加待
    // 冒烟证据）。TE 目标列表恒空 → DoRA 结构性只落 DiT。
    ...(typeId === 'wan22-ti2v-lora' ? [
      { key: 'dora_enabled', type: 'boolean', label: '叠加 DoRA 权重分解', title: 'dora_enabled', desc: 'DoRA 把权重分解为方向+幅度联合训练，表达力强于同 rank LoRA 但稍慢。建议在原生 LoRA 基础上叠加使用；与 LyCORIS 族互斥（注入链短路）。', defaultValue: false, visibleWhen: when('wan22_model_variant', 'ti2v-5b') },
    ] : []),
    ...S_LAYERED_ALPHA_GENERIC
  ]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '', S_TRAIN(20)),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（第 6 站桶）：Wan2.2 族 sampler pipeline=None，预览/质量评估永久 no-op → 整节下架。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  sec('wan22-offload-settings', 'speed', 'Wan2.2 Block Offload', offloadDesc, [...offloadFields]),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值观测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '质量优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
]);

export const WAN22_TI2V_LORA_SECTIONS = wan22Sections({
  typeId: 'wan22-ti2v-lora',
  modelDesc: 'Wan2.2 TI2V-5B 官方目录（config.json + diffusion shards + Wan2.2_VAE.pth + umT5）。',
  pathLabel: 'Wan2.2 模型目录',
  pathDesc: 'TI2V-5B 目录',
  outputDir: './output/wan22',
  outputName: 'wan22-ti2v-lora',
  variantDefault: 'ti2v-5b',
  variantDesc: 'TI2V-5B；A14B 训练时每次只加载 high/low 中所选单塔',
  flowShiftDefault: 5.0,
  offloadFields: WAN22_OFFLOAD_FIELDS,
  offloadDesc: 'resident / block_offload；5B 建议 slots=4。',
});

export const WAN22_T2V_A14B_LORA_SECTIONS = dropDuplicateFieldKeys(wan22Sections({
  typeId: 'wan22-t2v-a14b-lora',
  modelDesc: 'Wan2.2 T2V-A14B 目录包含 high/low noise 权重；单次训练只加载所选单塔，不会同时加载两套 DiT。',
  pathLabel: 'Wan2.2 A14B 模型目录',
  pathDesc: 'T2V-A14B 根目录',
  outputDir: './output/wan22-a14b',
  outputName: 'wan22-t2v-a14b-lora',
  variantDefault: 't2v-a14b',
  variantDesc: 'A14B 目录含 high/low 两套权重；训练时只挂载所选单塔',
  flowShiftDefault: 12.0,
  offloadFields: WAN22_A14B_OFFLOAD_FIELDS,
  offloadDesc: 'A14B 单塔显存安全基线：slots=2 / prefetch=1；16GB/24GB 可训练性仍待真实训练证据确认。',
}));

export const BOOGU_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Boogu-Image Base 完整本地目录（transformer + mllm + vae + processor + scheduler）。支持 BF16 与官方 Base-fp8（自动识别；FP8 为 torchao 包，加载时 dequant 到训练 dtype，常驻 VRAM≈BF16）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'boogu-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Boogu 模型目录', title: 'pretrained_model_name_or_path', desc: '完整本地目录：transformer/、mllm/、processor/', defaultValue: '' },
    {
      key: 'boogu_model_version',
      type: 'select',
      label: '模型版本',
      desc: 'Boogu 底模版本声明。必须与实际文件匹配否则权重错载。',
      defaultValue: 'base-0.1',
      options: [
        { value: 'base-0.1', label: 'base-0.1（推荐）' }
      ]
    },
    // 幻影治理（B，2026-08 第 6 站桶）：boogu_task 是「写而不读」的安慰剂——
    // config 键全仓只写不读（trainer_prepare_mixin.py:457 仅 edit 推导回写；
    // loader 按版本派生 model.boogu_task，boogu_loader.py:311；cache build 按
    // training_type 派生，trainer_cache_build_runtime.py:170-173），任务由类型+
    // 版本唯一决定。hidden 保旧草稿回显，提交层剥除（PHANTOM_KEYS）。
    {
      key: 'boogu_task',
      type: 'hidden',
      label: '任务',
      desc: 'Base 阶段仅 t2i',
      defaultValue: 't2i',
      options: [
        { value: 't2i', label: 't2i（文生图）' }
      ]
    },
    { key: 'boogu_load_mllm', type: 'boolean', label: '加载 MLLM', title: 'boogu_load_mllm', desc: '默认关闭以复用文本缓存；仅在构建缓存或实时文本编码时开启，会显著增加内存/显存占用。', defaultValue: false },
    // 幻影治理（B）：boogu_max_text_length 全仓唯一出现=定义处 configs_boogu.py:29，
    // cache build 的 encode fn 不接收长度参数——零消费者。hidden 保旧草稿回显，
    // 提交层剥除；待后端文本编码真正消费后再恢复暴露。
    { key: 'boogu_max_text_length', type: 'hidden', label: '最大文本长度', title: 'boogu_max_text_length', desc: '指令 TE pad 上限（token）。', defaultValue: 1024, min: 64, max: 4096 },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/boogu' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'boogu-lora' }
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '自然语言 instruction caption。cache 后缀 *_boogu.npz。推荐 buckets 覆盖 512/768/1024。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', label: 'Bucket 最小分辨率', defaultValue: 512, min: 64 },
    { key: 'max_bucket_reso', type: 'number', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: '推荐开启：读 latent/指令 TE 缓存（Qwen-Image 格式）。数据变化后需重建。', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '默认按轮保存（每轮一次）。RunComfy 参考基线是每 250 步保留约 4 份，需要的话把「每 N 步保存」改成 250。', [
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  sec('adapter-settings', 'network', 'LoRA 适配器', 'RunComfy 默认 rank/α 32/32。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    // DoRA 叠加开关（D，第 6 站桶）：boogu(Base) 行已实证（TE 目标列表恒空 → 仅落
    // DiT）；Edit 入口暂缓（ref-latents 双路 × DoRA 冒烟未做，见 BOOGU_EDIT）。
    { key: 'dora_enabled', type: 'boolean', label: '叠加 DoRA 权重分解', title: 'dora_enabled', desc: 'DoRA 把权重分解为方向+幅度联合训练，表达力强于同 rank LoRA 但稍慢。建议在原生 LoRA 基础上叠加使用；与 LyCORIS 族互斥（注入链短路）。', defaultValue: false },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', 'RunComfy 默认 LR 1e-4 + AdamW8Bit。', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练参数', '默认按最大步数 2500（RunComfy full）；探针可用 100–250。', [
    { key: 'train_length_mode', type: 'select', label: '训练长度模式', title: 'train_length_mode', desc: '选择按最大轮数还是最大步数结束训练，两者只生效一个。建议概念简单的小数据集用轮数，大图库或精确控量用步数。', defaultValue: '最大步数', options: ['最大轮数', '最大步数'] },
    { key: 'max_train_epochs', type: 'number', desc: '训练遍历整个数据集的次数上限，决定总训练量。推荐范围：小数据集（<50 张）10–30 轮；大数据集 1–5 轮；与 max_train_steps 二选一设置。', label: '最大训练轮数', title: 'max_train_epochs', defaultValue: 10, min: 1, visibleWhen: (c) => !c.train_length_mode || c.train_length_mode === '最大轮数' },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 2500, min: 1, visibleWhen: when('train_length_mode', '最大步数') },
    ...S_TRAIN(10).filter((f) => !['train_length_mode', 'max_train_epochs', 'max_train_steps'].includes(f.key))
]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（第 6 站桶）：Boogu 族 sampler pipeline=None，预览/质量评估永久 no-op → 整节下架。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  // E1（第 6 站桶）：驻留默认对齐后端 configs_boogu.py:35 的 block_offload
  // （注释明言 streaming is the honest default：19GiB 驻留在 16GB 卡 ≈430s/步 vs
  // 流式 175s）。前端原默认 resident 会恒提交并顶掉后端的保守默认。
  sec('boogu-offload-settings', 'speed', 'Boogu Block Offload', '默认 block_offload（流式，后端实测更稳）；显存充裕可切 resident 省去换入换出。', [...BOOGU_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监测', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

export const BOOGU_EDIT_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'Boogu-Image Edit LoRA：与 Base 同 DiT 族；需 Edit 权重目录。双路：VLM 图文指令 + VAE ref_latents。支持 BF16 Edit 与官方 Edit-fp8（自动识别；加载 dequant）。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'boogu-edit-lora' },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: 'Boogu Edit 模型目录', title: 'pretrained_model_name_or_path', desc: 'Edit 权重根目录（layout 同 Base：transformer/', defaultValue: '' },
    {
      key: 'boogu_model_version',
      type: 'select',
      label: '模型版本',
      desc: 'Boogu 底模版本声明。必须与实际文件匹配否则权重错载。',
      defaultValue: 'edit-0.1',
      options: [
        { value: 'edit-0.1', label: 'edit-0.1' },
        { value: 'base-0.1', label: 'base-0.1（仅通路探测，非产品）' }
],
    },
    // 幻影治理（B）：同 boogu-lora——写而不读的安慰剂键，hidden 保旧草稿回显。
    {
      key: 'boogu_task',
      type: 'hidden',
      label: '任务',
      desc: 'Edit 固定 edit：TI2I system prompt',
      defaultValue: 'edit',
      options: [
        { value: 'edit', label: 'edit（图文编辑）' }
],
    },
    { key: 'boogu_load_mllm', type: 'boolean', label: '加载 MLLM', title: 'boogu_load_mllm', desc: '默认关闭以复用文本缓存；仅在构建缓存或实时文本编码时开启，会显著增加内存/显存占用。', defaultValue: false },
    // 幻影治理（B）：零消费者（Edit ref/VLM 编码路径无读者），hidden 保旧草稿回显。
    { key: 'boogu_max_text_length', type: 'hidden', label: '最大文本长度', title: 'boogu_max_text_length', desc: '指令 TE pad 上限', defaultValue: 1024, min: 64, max: 4096 },
    { key: 'boogu_control_image_max_pixels', type: 'hidden', label: '控制图最大像素', title: 'boogu_control_image_max_pixels', desc: 'VAE ref 编码前 cap，默认约 1MP', defaultValue: 1048576, min: 65536 },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/boogu-edit' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'boogu-edit-lora' }
]),
  sec('dataset-settings', 'dataset', '数据集设置', 'Edit：目标图 + caption；ref 图进 cache 的 ref_latents（与 Base *_boogu.npz 命名空间隔离推荐分目录）。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图片目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx-edit' },
    { key: 'resolution', type: 'string', label: '训练分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: '1024,1024' },
    { key: 'enable_bucket', type: 'boolean', label: '启用 Bucket', title: 'enable_bucket', desc: '宽高比分桶（ARB）：把不同比例的图分进各桶减少裁剪。UNet 路线全支持；DiT cache-first 族主要影响 online/重建路径。建议保持开启（默认 true）。', defaultValue: true },
    { key: 'min_bucket_reso', type: 'number', desc: '桶允许的最小边长，过小会产生极端拉伸样本。推荐范围：256 以上且不超过 resolution 一半太多。', label: 'Bucket 最小分辨率', defaultValue: 512, min: 64 },
    { key: 'max_bucket_reso', type: 'number', desc: '桶允许的最大边长；cache-first 回放通常沿用构建时分辨率。推荐范围：不超过 resolution 的 2 倍。', label: 'Bucket 最大分辨率', defaultValue: 1024, min: 64 },
    { key: 'caption_extension', type: 'string', desc: '标注文件扩展名（默认 .txt，与图片同名）。建议全库统一一种扩展名，混用会导致部分图读不到标注。', label: 'Caption 扩展名', title: 'caption_extension', defaultValue: '.txt' },
    { key: 'dataloader_num_workers', type: 'number', desc: 'DataLoader 工作进程数，影响取数吞吐。推荐范围：2–8；Windows 下过高会拖慢启动。', label: 'DataLoader 线程数', defaultValue: 4, min: 0 },
    { key: 'use_cache', type: 'boolean', label: '使用磁盘缓存', title: 'use_cache', desc: 'Edit 缓存额外包含 ref_latents 参考图分支。推荐范围：编辑类任务保持 true。', defaultValue: true }
]),
  sec('save-settings', 'model', '保存设置', '默认按轮保存（每轮一次）。RunComfy 基线是每 250 步保留约 4 份，需要的话把「每 N 步保存」改成 250。', [
    { key: 'train_batch_size', type: 'number', desc: '每次前向/反向同时处理的图片数，直接影响显存与梯度平滑度。推荐范围：显存优先取 1，24G 卡 SDXL 1024px 可到 2；配合梯度累加放大等效 batch。', label: 'Batch Size', title: 'train_batch_size', defaultValue: 1, min: 1 },
    ...S_SAVE.filter((f) => !['output_dir', 'output_name'].includes(f.key))
]),
  // D（第 6 站桶）：Edit 不加 DoRA rider——ref-latents 双条件注入 × DoRA 幅度分解
  // 尚无冒烟证据，待后端签收后再补。
  sec('adapter-settings', 'network', 'LoRA 适配器', '默认 rank/α 32/32。', [
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 32, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 32, min: 1 },
    { key: 'network_dropout', type: 'number', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', label: 'Dropout', defaultValue: 0.05, min: 0, step: 0.01 },
    ...S_LAYERED_ALPHA_GENERIC
]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '默认 LR 1e-4 + AdamW8Bit。', [...S_LR_DIT]),
  sec('training-settings', 'training', '训练设置', '默认按最大步数 2500。', [
    { key: 'train_length_mode', type: 'select', label: '训练长度模式', title: 'train_length_mode', desc: '选择按最大轮数还是最大步数结束训练，两者只生效一个。建议概念简单的小数据集用轮数，大图库或精确控量用步数。', defaultValue: '最大步数', options: ['最大轮数', '最大步数'] },
    { key: 'max_train_epochs', type: 'number', desc: '训练遍历整个数据集的次数上限，决定总训练量。推荐范围：小数据集（<50 张）10–30 轮；大数据集 1–5 轮；与 max_train_steps 二选一设置。', label: '最大训练轮数', title: 'max_train_epochs', defaultValue: 10, min: 1, visibleWhen: (c) => !c.train_length_mode || c.train_length_mode === '最大轮数' },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 2500, min: 1, visibleWhen: when('train_length_mode', '最大步数') },
    ...S_TRAIN(10).filter((f) => !['train_length_mode', 'max_train_epochs', 'max_train_steps'].includes(f.key))
]),
  sec('weight-composer', 'frontier', '统一权重组合', '空间/语义、时间步、噪声与样本难度权重按乘法组合，并保持均值尺度。', [...S_WEIGHT_COMPOSER]),
  sec('progressive-training', 'frontier', '渐进式 / 分阶段训练', '按 optimizer progress 切换阶段；当前首版使用稳定 JSON contract。', [...S_PROGRESSIVE_TRAINING, ...S_ADAPTIVE_TRAINING]),
  // E4（第 6 站桶）：sampler pipeline=None，预览/质量评估永久 no-op → 整节下架。
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL], { hidden: true }),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_FLOW]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
  // E1（第 6 站桶）：驻留默认对齐后端 configs_boogu.py:35（block_offload）。
  sec('boogu-offload-settings', 'speed', 'Boogu Block Offload', '默认 block_offload（流式，后端实测更稳）；显存充裕可切 resident 省去换入换出。', [...BOOGU_OFFLOAD_FIELDS]),
  sec('advanced-settings', 'advanced', '高级设置', '', [...S_ADV_DIT]),
  sec('thermal-settings', 'training', '散热与功耗', '', [...S_THERMAL]),
  sec('peak-vram-settings', 'speed', 'VRAM 峰值监控', '', [...S_PEAK_VRAM], { expert: true }),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),
  sec('turbocore-settings', 'speed', 'TurboCore 内核优化', 'CUDA/Triton 内核自动调优。', [...S_TURBOCORE], { expert: true })
];

const BOOGU_DEPTH_EXPANSION_FIELDS = [
  { key: 'boogu_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'boogu_depth_expansion_enabled', desc: '交错复制 Boogu 单流 block，并以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'boogu_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'boogu_depth_expansion_target_layers', desc: '扩层后的单流 Transformer block 总数（Base 原生 32）。', defaultValue: 40, min: 2, step: 1, visibleWhen: when('boogu_depth_expansion_enabled', true) },
  { key: 'boogu_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'boogu_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('boogu_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// boogu-finetune 派生自 BOOGU_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重，
// 避免撞 webui_duplicate_field_key_smoke 的重复总量基线。
export const BOOGU_FT_SECTIONS = dropDuplicateFieldKeys(BOOGU_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'boogu-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Boogu 底座输出文件名', defaultValue: 'boogu-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Boogu 全参微调', description: '训练完整 Boogu-Image DiT，或扩展深度后只训练新增单流层。需要 BF16/FP16 稠密底座（官方 FP8 包加载时自动 dequant）。', fields: [...fields, ...BOOGU_DEPTH_EXPANSION_FIELDS] };
  }));

const FLUX2_DEPTH_EXPANSION_FIELDS = [
  { key: 'flux2_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'flux2_depth_expansion_enabled', desc: '交错复制 FLUX.2 单流 block（并行块，注意力/MLP 融合输出投影归零），以恒等残差初始化新增层。最终保存完整新底座。', defaultValue: false },
  { key: 'flux2_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'flux2_depth_expansion_target_layers', desc: '扩层后的单流 Transformer block 总数（Klein-9B 原生 48；双流 8 层不参与扩层）。', defaultValue: 60, min: 2, step: 1, visibleWhen: when('flux2_depth_expansion_enabled', true) },
  { key: 'flux2_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'flux2_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('flux2_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// flux2-finetune 派生自 FLUX2_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const FLUX2_FT_SECTIONS = dropDuplicateFieldKeys(FLUX2_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'flux2-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 FLUX.2 底座输出文件名', defaultValue: 'flux2-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'FLUX.2 全参微调', description: '训练完整 FLUX.2 Klein DiT，或扩展深度后只训练新增单流层。需要未旋转的稠密底座（ConvRot INT8 包仅支持冻结底座 LoRA）。', fields: [...fields, ...FLUX2_DEPTH_EXPANSION_FIELDS] };
  }));

const ZIMAGE_DEPTH_EXPANSION_FIELDS = [
  { key: 'zimage_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'zimage_depth_expansion_enabled', desc: '交错复制 Z-Image 主干 layers block（attention 输出投影与 FFN w2 归零），以恒等残差初始化新增层。refiner 层不参与扩层。最终保存完整新底座。', defaultValue: false },
  { key: 'zimage_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'zimage_depth_expansion_target_layers', desc: '扩层后的主干 Transformer block 总数（Z-Image 6B 原生 30）。', defaultValue: 38, min: 2, step: 1, visibleWhen: when('zimage_depth_expansion_enabled', true) },
  { key: 'zimage_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'zimage_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: when('zimage_depth_expansion_enabled', true), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// zimage-finetune 派生自 ZIMAGE_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const ZIMAGE_FT_SECTIONS = dropDuplicateFieldKeys(ZIMAGE_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'zimage-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Z-Image 底座输出文件名', defaultValue: 'zimage-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Z-Image 全参微调', description: '训练完整 Z-Image DiT，或扩展深度后只训练新增主干层。', fields: [...fields, ...ZIMAGE_DEPTH_EXPANSION_FIELDS] };
  }));

// E2（第 6 站桶）：wan22 深度扩层仅支持 TI2V-5B 单塔——A14B 双塔组合后端直接
// ValueError（wan22_depth_expansion_runtime.py:51-56）。enabled 锚 variant 守卫：
// 选 t2v-a14b 时整组隐藏、不收集；configValidator 另对旧草稿兜底自动复位。
const wan22DepthExpansionAllowed = (c) => String(c.wan22_model_variant || 'ti2v-5b') !== 't2v-a14b';

const WAN22_DEPTH_EXPANSION_FIELDS = [
  { key: 'wan22_depth_expansion_enabled', type: 'boolean', label: '扩展 Transformer 深度', title: 'wan22_depth_expansion_enabled', desc: '交错复制 Wan2.2 TI2V-5B block（自注意/交叉注意/FFN 三个输出投影归零），以恒等残差初始化新增层。仅支持 TI2V-5B 单塔；A14B 双塔不支持。最终保存完整新底座。', defaultValue: false, visibleWhen: wan22DepthExpansionAllowed },
  { key: 'wan22_depth_expansion_target_layers', type: 'number', label: '目标层数', title: 'wan22_depth_expansion_target_layers', desc: '扩层后的 Transformer block 总数（TI2V-5B 原生 30）。', defaultValue: 38, min: 2, step: 1, visibleWhen: all(when('wan22_depth_expansion_enabled', true), wan22DepthExpansionAllowed) },
  { key: 'wan22_depth_expansion_train_scope', type: 'select', label: '训练范围', title: 'wan22_depth_expansion_train_scope', desc: '选择只训练新增层、同时训练外围模块，或训练全部参数。', defaultValue: 'new_layers', visibleWhen: all(when('wan22_depth_expansion_enabled', true), wan22DepthExpansionAllowed), options: [
    { value: 'new_layers', label: '只训练新增层' },
    { value: 'new_layers_periphery', label: '新增层 + 外围模块' },
    { value: 'all', label: '全部参数' },
  ] },
];

// wan22-finetune 派生自 WAN22_TI2V_LORA_SECTIONS：去掉 LoRA 适配器 section 与
// LoRA/量化专属字段（复用 krea2 的排除清单），并跨 section 按 key 去重。
export const WAN22_FT_SECTIONS = dropDuplicateFieldKeys(WAN22_TI2V_LORA_SECTIONS
  .filter((section) => section.id !== 'adapter-settings')
  .map((section) => {
    const sourceFields = section.id === 'optimizer-settings' ? S_LR_FT_DIT : section.fields;
    const fields = sourceFields
      .filter((field) => !KREA2_FT_EXCLUDED_FIELDS.has(field.key))
      .map((field) => {
      if (field.key === 'model_train_type') return { ...field, defaultValue: 'wan22-finetune' };
      if (field.key === 'output_name') return { ...field, label: '底座输出名称', desc: '完整 Wan2.2 底座输出文件名', defaultValue: 'wan22-expanded' };
      return field;
    });
    if (section.id !== 'model-settings') return { ...section, fields };
    return { ...section, title: 'Wan2.2 全参微调', description: '训练完整 Wan2.2 TI2V-5B DiT，或扩展深度后只训练新增层。扩层仅支持 TI2V-5B 单塔。', fields: [...fields, ...WAN22_DEPTH_EXPANSION_FIELDS] };
  }));
