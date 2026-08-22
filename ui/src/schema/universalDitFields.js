// Universal DiT fallback controls. This section is opt-in and only adds
// request fields; known model-family routes remain the default behavior.
export const S_UNIVERSAL_DIT = [
  {
    key: 'universal_dit_enabled', type: 'boolean', label: '启用 Universal DiT LoRA fallback',
    desc: '对已加载但未被专用族路由识别的 DiT/Transformer 尝试静态探测、自动 Linear target 和基础 LoRA。',
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
];
