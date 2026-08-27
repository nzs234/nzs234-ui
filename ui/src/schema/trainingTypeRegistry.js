// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// expertOnly: 仅 performance_expert_mode（顶栏「高级」）为 true 时露出
export const UI_TABS = [
  { key: 'model', label: '模型' },
  { key: 'dataset', label: '数据参数' },
  // universal-dit-lora 专属页签（后端 schema 第 3 个 tab「契约」）；getAvailableTabs
  // 按 tabSet 过滤，无该 section 的类型不会显示此页签。
  { key: 'contract', label: '契约' },
  { key: 'training', label: '训练' },
  { key: 'network', label: '网络' },
  { key: 'optimizer', label: '优化器' },
  { key: 'preview', label: '预览/验证' },
  { key: 'speed', label: '加速' },
  { key: 'frontier', label: '先锋', expertOnly: true },
  { key: 'advanced', label: '高级', expertOnly: true },
];

// 第 6 站桶 12 型的入口标注（类型级 note，非字段级）：后端注册状态是
// configurable_not_verified —— 薄壳可配置、但未经真实训练验证。文案与
// universal-dit-lora 的实验标注同体例；EN 通道走 note_en（与 disabledReason_en
// 同构，渲染层经 resolveTypeNote 按语言取用）。
const WEBUI_OWNED_NOTE = '实验标注：后端注册为 webui-owned identity-only 薄壳（字段权威在 UI 侧），状态 configurable_not_verified —— 可配置但未经真实训练验证。建议先跑一次 short smoke 验证，再用于正式训练。';
const WEBUI_OWNED_NOTE_EN = 'Experimental: the backend registers this as a webui-owned identity-only shell (field authority stays in the UI) with status configurable_not_verified — configurable, but not verified by a real run. Run a short smoke first, then use it for real training.';

export const TRAINING_TYPES = [
  { id: 'sdxl-lora', group: 'LoRA', label: 'SDXL' },
  { id: 'anima-lora', group: 'LoRA', label: 'Anima' },
  { id: 'newbie-lora', group: 'LoRA', label: 'Newbie' },
  // ── 第 6 站桶（krea2/flux2/zimage/boogu/wan22 共 12 型）：后端已在
  // launcher/api/domain/schemas/webui_owned_schemas.py 以 identity-only 薄壳
  // （field_authority=webui，字段权威在 UI 侧）补齐注册，路由表
  // training_route_catalog.py 与 arch_capability_registry 均就绪 → 入口可见。
  { id: 'krea2-lora', group: 'LoRA', label: 'Krea-2', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'minimax-h3-lora', group: 'LoRA', label: 'MiniMax H3' },
  { id: 'flux2-lora', group: 'LoRA', label: 'FLUX.2 Klein', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'zimage-lora', group: 'LoRA', label: 'Z-Image', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'wan22-ti2v-lora', group: 'LoRA', label: 'Wan2.2 TI2V-5B', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'wan22-t2v-a14b-lora', group: 'LoRA', label: 'Wan2.2 T2V-A14B', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'ltx23-lora', group: 'LoRA', label: 'LTX-2.3' },
  { id: 'ltx25-lora', group: 'LoRA', label: 'LTX-2.5' },
  { id: 'boogu-lora', group: 'LoRA', label: 'Boogu-Image', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'boogu-edit-lora', group: 'Edit 模型', label: 'Boogu-Image Edit', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  // 后端无 anima-edit-model schema/路由（get_training_schema 会 404）；
  // 保留数据定义以兼容已存草稿，入口隐藏。
  { id: 'anima-edit-model', group: 'Edit 模型', label: 'Anima', hidden: true },
  { id: 'concept-edit', group: '概念编辑', label: '概念编辑训练', hidden: true, disabled: true, disabledReason: '该训练类型暂未开放启动。' },
  // 以下旧入口保留但隐藏（existing configs 兼容）
  { id: 'sdxl-ileco', group: 'LoRA 概念编辑', label: 'SDXL iLECO', hidden: true },
  { id: 'sdxl-addift', group: 'LoRA 概念编辑', label: 'SDXL ADDifT', hidden: true },
  { id: 'sdxl-multi-addift', group: 'LoRA 概念编辑', label: 'SDXL Multi-ADDifT', hidden: true },
  { id: 'anima-ileco', group: 'LoRA 概念编辑', label: 'Anima iLECO', hidden: true },
  { id: 'anima-addift', group: 'LoRA 概念编辑', label: 'Anima ADDifT', hidden: true },
  // 后端零 schema/路由/别名（全仓 grep multi-addift 空）：恢复/导入可识别，
  // 但普通链路必启动失败 → 按先例（yolo/concept-edit）hidden+disabled。
  { id: 'anima-multi-addift', group: 'LoRA 概念编辑', label: 'Anima Multi-ADDifT', hidden: true, disabled: true, disabledReason: '后端未注册 Multi-ADDifT 的 schema 与训练路由，无法启动；仅保留注册用于旧配置识别。' },
  { id: 'sdxl-turbo-lora', group: '专项训练', label: 'SDXL Turbo / LCM LoRA' },
  { id: 'lab-distiller', group: '专项训练', label: 'LAB Distiller' },
  // /api/lulynx-lab 探针（contracts/tools.py DitFewStepLoraRequest，lab_id=dit-few-step-lora）：
  // 普通 /train 链路无 schema/路由，经 Lab runner 产出契约产物。保留可见但标注入口属性。
  { id: 'anima-few-step-lora', group: '专项训练', label: 'Anima Few-step LoRA', note: 'Lab 探针：经 /api/lulynx-lab (lab_id=dit-few-step-lora) 启动；本页仅生成契约产物。', note_en: 'Lab probe: launched through /api/lulynx-lab (lab_id=dit-few-step-lora); this page only produces the contract artifacts.' },
  // 与 anima-few-step-lora 同链路（lab runner 产出契约产物）；第 3 站补标注入口属性。
  { id: 'newbie-few-step-lora', group: '专项训练', label: 'Newbie Few-step LoRA', note: 'Lab 探针：经 /api/lulynx-lab (lab_id=dit-few-step-lora) 启动；本页仅生成契约产物。', note_en: 'Lab probe: launched through /api/lulynx-lab (lab_id=dit-few-step-lora); this page only produces the contract artifacts.' },
  // 后端已独立注册 universal-dit-lora schema（launcher/api/domain/schemas/universal_dit_schema.py；
  // 路由表 training_route_catalog.py:50 → ("lora","universal_dit")，runtime=standard 走
  // entry_train + UnifiedTrainingConfig）。experimental=true、status=configurable_not_verified：
  // 入口可见但标注实验属性，schema 面见 universalDitFields.UNIVERSAL_DIT_LORA_SECTIONS。
  { id: 'universal-dit-lora', group: '实验训练', label: '高级自定义 DiT', note: '实验功能：预计算张量 Universal DiT LoRA。不装配 VAE/文本编码器，需自备含 latents 的契约张量目录与 AutoModel config 模型目录；启动前务必跑预检。', note_en: 'Experimental: Universal DiT LoRA over precomputed tensors. No VAE or text encoder is loaded — bring your own contract tensor directory with latents plus an AutoModel config model directory, and always run preflight before launching.' },
  { id: 'flux-lora', group: 'LoRA', label: 'FLUX' },
  { id: 'lumina-lora', group: 'LoRA', label: 'Lumina', hidden: true },
  { id: 'qwen-image-lora', group: 'LoRA', label: 'Qwen Image', hidden: true },
  { id: 'hunyuan-dit-lora', group: 'LoRA', label: 'HunyuanDiT', hidden: true },
  { id: 'sd-lora', group: 'LoRA', label: 'SD 1.5' },
  { id: 'sd-ileco', group: 'LoRA 概念编辑', label: 'SD 1.5 iLECO', hidden: true },
  { id: 'sd-addift', group: 'LoRA 概念编辑', label: 'SD 1.5 ADDifT', hidden: true },
  { id: 'sd-multi-addift', group: 'LoRA 概念编辑', label: 'SD 1.5 Multi-ADDifT', hidden: true },
  { id: 'sdxl-finetune', group: 'Finetune', label: 'SDXL' },
  { id: 'anima-finetune', group: 'Finetune', label: 'Anima' },
  { id: 'krea2-finetune', group: 'Finetune', label: 'Krea-2', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'boogu-finetune', group: 'Finetune', label: 'Boogu-Image', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'ltx23-finetune', group: 'Finetune', label: 'LTX-2.3' },
  { id: 'ltx25-finetune', group: 'Finetune', label: 'LTX-2.5' },
  { id: 'flux2-finetune', group: 'Finetune', label: 'FLUX.2 Klein', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'zimage-finetune', group: 'Finetune', label: 'Z-Image', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'wan22-finetune', group: 'Finetune', label: 'Wan2.2 TI2V-5B', note: WEBUI_OWNED_NOTE, note_en: WEBUI_OWNED_NOTE_EN },
  { id: 'minimax-h3-finetune', group: 'Finetune', label: 'MiniMax H3' },
  { id: 'lumina-finetune', group: 'Finetune', label: 'Lumina', hidden: true },
  { id: 'sd-dreambooth', group: 'Finetune', label: 'SD DreamBooth' },
  // 后端已接线（training_route_catalog.py:56 dreambooth×sdxl，entry_train 分派
  // DreamBoothTrainer）但 UI 此前无入口 —— 2026-08 SDXL 桶补注册。
  { id: 'sdxl-dreambooth', group: 'Finetune', label: 'SDXL DreamBooth' },
  { id: 'sd-controlnet', group: 'ControlNet', label: 'SD 1.5' },
  { id: 'sdxl-controlnet', group: 'ControlNet', label: 'SDXL' },
  // 后端路由 training_route_catalog.py:63（lllite×sdxl → LLLiteTrainer）。
  { id: 'sdxl-controlnet-lllite', group: 'ControlNet', label: 'SDXL LLLite' },
  // 后端路由 training_route_catalog.py:69（ip-adapter×sdxl → IPAdapterTrainer）。
  { id: 'sdxl-ip-adapter', group: 'ControlNet', label: 'SDXL IP-Adapter' },
  { id: 'anima-controlnet', group: 'ControlNet', label: 'Anima' },
  { id: 'sd-textual-inversion', group: 'Textual Inversion', label: 'SD 1.5 TI' },
  { id: 'sdxl-textual-inversion', group: 'Textual Inversion', label: 'SDXL TI' },
  // 后端 yolo schema 为 registered_placeholder（启动被 400 拒绝）；隐藏对齐。
  { id: 'yolo', group: '其他模型训练', label: 'YOLO 模型训练', hidden: true, disabled: true, disabledReason: '该训练类型暂未开放启动。' },
  { id: 'aesthetic-scorer', group: '其他模型训练', label: '美学评分模型训练' },
];

export const VISIBLE_TRAINING_TYPES = TRAINING_TYPES.filter((type) => !type.hidden);
