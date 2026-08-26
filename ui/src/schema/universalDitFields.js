// Universal DiT controls. 第 6 站桶文案修正（E3）：这不是"fallback 探测"——
// 开启即写 payload.model_type='universal_dit'（runConfigBuilder.normalizeUniversalDitRoute），
// entry_train 按 explicit model_type 优先解析（arch_capability_registry.py:395-397），
// 整个 run 改走 universal_dit_step + AutoModel 裸加载，原族的 VAE/TE/conditioning
// 装配全部不发生。对已识别专用族开启 ≈ 必败。文案如实描述该架构级覆盖语义。
import { sec } from './schemaCommon.js';
import { S_LR_DIT, S_TRAIN, excludeKeys, expandTrainLengthFields } from './schemaFieldGroups.js';

export const S_UNIVERSAL_DIT = [
  {
    key: 'universal_dit_enabled', type: 'boolean', label: '启用 Universal DiT 路线（架构级覆盖）',
    desc: '启用后本次训练将改走 Universal DiT 预计算张量路线（架构硬覆盖，不是 fallback 探测）：AutoModel 裸加载 + 静态/前向探测 + 基础 LoRA，原模型族的 VAE/文本编码器装配不会发生。仅对无专用族路由的未知 DiT 使用；对已识别族开启会直接失败。',
    defaultValue: false,
  },
  {
    key: 'universal_dit_probe_mode', type: 'select', label: 'Universal DiT 探测模式',
    desc: 'auto 会按可用输入逐步执行静态检查与前向；train_smoke 还会执行最小反向。',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: 'Auto（推荐）' },
      { value: 'static', label: '仅静态结构' },
      { value: 'forward', label: '结构 + forward' },
      { value: 'train_smoke', label: '结构 + 前向 + 反向检查' },
    ],
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_objective_template', type: 'select', label: 'Objective 模板',
    desc: '未知模型无法从类名可靠推断时不会静默猜测；auto 会在证据不足时要求确认。',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: 'Auto（证据优先）' },
      { value: 'epsilon', label: 'Epsilon prediction' },
      { value: 'v_prediction', label: 'V prediction' },
      { value: 'x0', label: 'X0 prediction' },
      { value: 'flow_matching', label: 'Flow matching' },
      { value: 'rectified_flow', label: 'Rectified flow' },
      { value: 'velocity', label: 'Velocity prediction' },
      { value: 'custom', label: 'Custom' },
    ],
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_target_policy', type: 'select', label: 'Linear Target 策略',
    desc: 'attention_mlp 仅选注意力/MLP；all_linear 扩大到全部 Linear；explicit 使用严格路径白名单。',
    defaultValue: 'attention_mlp',
    options: [
      { value: 'attention_mlp', label: 'Attention + MLP（推荐）' },
      { value: 'all_linear', label: '全部 Linear' },
      { value: 'explicit', label: '显式路径白名单' },
    ],
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_allow_fused_qkv', type: 'boolean', label: '允许 fused QKV 整层注入',
    desc: '开启后按整层 Linear 注入，不做 q/k/v slice adapter。',
    defaultValue: false,
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_allow_remote_download', type: 'boolean', label: '允许远程模型下载',
    desc: '开启后 base_model_path 可以解析远程仓库；建议先在资源中心或本地完成下载与校验。',
    defaultValue: false,
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_trust_remote_code', type: 'boolean', label: '信任模型自定义代码',
    desc: '高风险选项，仅对来源可信且已审查的本地/远程模型启用 trust_remote_code。',
    defaultValue: false,
    visibleWhen: (c) => c.universal_dit_enabled,
  },
  {
    key: 'universal_dit_target_modules_json', type: 'textarea', label: '显式 Target 路径 JSON',
    desc: '仅 explicit 策略使用，例如 ["blocks.0.attn.to_q", "blocks.0.mlp.fc1"]。路径必须精确存在且为 nn.Linear。',
    defaultValue: '', placeholder: '["blocks.0.attn.to_q"]',
    visibleWhen: (c) => c.universal_dit_enabled && c.universal_dit_target_policy === 'explicit',
  },
  {
    key: 'universal_dit_probe_inputs_json', type: 'textarea', label: '安全 Probe 输入 JSON',
    desc: '可选形状描述，不执行任意代码，例如 {"kwargs":{"hidden_states":{"shape":[1,4,8]},"timestep":{"shape":[1],"dtype":"int64","value":1}}}。',
    defaultValue: '',
    visibleWhen: (c) => c.universal_dit_enabled && c.universal_dit_probe_mode !== 'static',
  },
  // C④⑤（2026-08 第 6 站桶）：补暴露后端已声明的两个 JSON 键
  // （configs_training_methods.py:442-443；training_capabilities/universal_dit.py:92-93,117-118）。
  // forward contract 解析 / 多 Tensor 输出选择在 cache↔forward 形参歧义或多输出
  // 模型下必需，故仅在实际执行前向的探测模式下露出。
  {
    key: 'universal_dit_forward_mapping_json', type: 'textarea', label: 'Forward 形参映射 JSON',
    desc: '可选。cache↔forward 形参名不一致时的显式映射（JSON 对象：缓存键 → forward kwargs 键）。留空由后端按探测结果推断。',
    defaultValue: '', placeholder: '{"encoder_hidden_states": "encoder_hidden_states"}',
    visibleWhen: (c) => c.universal_dit_enabled && (c.universal_dit_probe_mode === 'forward' || c.universal_dit_probe_mode === 'train_smoke'),
  },
  {
    key: 'universal_dit_output_selector_json', type: 'textarea', label: '输出选择器 JSON',
    desc: '可选。模型 forward 返回多个 Tensor 时必须显式指定训练目标输出（JSON，如 {"index": 0} 或 {"key": "sample"}）；单输出模型留空即可。',
    defaultValue: '', placeholder: '{"index": 0}',
    visibleWhen: (c) => c.universal_dit_enabled && (c.universal_dit_probe_mode === 'forward' || c.universal_dit_probe_mode === 'train_smoke'),
  },
];

// ── universal-dit-lora 独立类型入口（2026-08 收官审计补注册）────────────────────
// 后端已独立注册该 schema（launcher/api/domain/schemas/universal_dit_schema.py，
// 路由表 training_route_catalog.py:50 → ("lora","universal_dit")，runtime=standard 走
// entry_train + UnifiedTrainingConfig），experimental=true、status=configurable_not_verified。
// 字段面对齐后端六个 section；contract 段复用共享 S_UNIVERSAL_DIT（含第 4 桶补进的
// forward_mapping/output_selector 两 JSON 键），开关本体按后端形态收成 hidden+true——
// 本类型本身就是 universal-dit 路线，提交层据此写 payload.model_type='universal_dit'。
const udField = (key) => S_UNIVERSAL_DIT.find((f) => f.key === key);

export const UNIVERSAL_DIT_LORA_SECTIONS = [
  sec('model-settings', 'model', '高级自定义 DiT（实验）', '不自动装配 VAE、文本编码器或 conditioning：输入必须是带 AutoModel 可构造 config 的本地模型目录，未知裸权重文件不支持。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'universal-dit-lora' },
    { key: 'universal_dit_enabled', type: 'hidden', defaultValue: true },
    { key: 'pretrained_model_name_or_path', type: 'folder', pickerType: 'folder', label: '自定义 DiT 模型目录', title: 'pretrained_model_name_or_path', desc: '必须包含可供 AutoModel 构造的 config 元数据；未知裸权重文件不支持。', defaultValue: '' },
    { ...udField('universal_dit_allow_remote_download') },
    { ...udField('universal_dit_trust_remote_code') },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '训练输出目录', defaultValue: './output/universal_dit' },
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: 'LoRA 输出文件名', defaultValue: 'universal_dit_lora' },
    { key: 'use_cache', type: 'hidden', defaultValue: true },
  ]),
  sec('dataset-settings', 'dataset', '预计算训练张量', '输入不是图片：目录至少包含 latents，并携带 forward/objective 契约所需张量。', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '预计算张量目录', title: 'train_data_dir', desc: '预计算张量目录：至少包含 latents，并携带 forward/objective 所需张量。', defaultValue: '' },
  ]),
  sec('universal-contract-settings', 'contract', 'Batch / Objective / Forward 契约', '探测模式与训练 Objective 必须与外部模型一致；多 Tensor 输出或 cache↔forward 形参歧义时必须显式声明 JSON 契约。', [
    { ...udField('universal_dit_probe_mode') },
    { ...udField('universal_dit_objective_template') },
    { ...udField('universal_dit_target_policy') },
    { ...udField('universal_dit_allow_fused_qkv') },
    { ...udField('universal_dit_target_modules_json') },
    { ...udField('universal_dit_probe_inputs_json') },
    { ...udField('universal_dit_forward_mapping_json') },
    { ...udField('universal_dit_output_selector_json') },
  ]),
  sec('adapter-settings', 'network', 'LoRA 注入', '后端固定 networks.lora；只暴露 rank / alpha / dropout。', [
    { key: 'network_module', type: 'hidden', defaultValue: 'networks.lora' },
    { key: 'network_dim', type: 'number', label: 'Rank (Dim)', title: 'network_dim', desc: 'LoRA rank', defaultValue: 16, min: 1, max: 256, step: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', title: 'network_alpha', desc: 'LoRA alpha', defaultValue: 16, min: 0.1, max: 256, step: 0.1 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', title: 'network_dropout', desc: 'LoRA dropout', defaultValue: 0, min: 0, max: 1, step: 0.01 },
  ]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [
    // LoRA+/RS-LoRA 修饰开关不在后端 universal-dit schema 字段面内（且会经
    // ADAPTER_TOKEN 启发式漏进向导 adapter 桶，造出矛盾空步）→ 本类型摘除。
    ...excludeKeys(S_LR_DIT, ['lora_plus_enabled', 'lora_plus_lr_ratio', 'rs_lora_enabled']),
  ]),
  // 无 TE 训练面：摘除 network_train_* 双假开关；轮数/步数常显双字段（第 3 站桶先例）。
  sec('training-settings', 'training', '训练参数', '', expandTrainLengthFields(S_TRAIN(10), { dropFakeTeSwitches: true })),
];
