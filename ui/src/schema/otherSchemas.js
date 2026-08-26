// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// ================================================================
// otherSchemas.js — SD1.5 / DreamBooth / ControlNet / Textual Inversion / YOLO / 美学评分
// 经典(非 anima/sdxl/DiT)训练族的归一 schema。增删这些族的字段只改本文件。
// 依赖方向(单向无环):schemaCommon → schemaFieldGroups → 本文件 → schemaIndex。
// ================================================================
import {
  vParameterizationFields,
  ds,
  netLora,
  rectifiedFlowParams,
  sec,
} from './schemaCommon.js';
import {
  S_SAVE,
  S_CAPTION,
  S_LR,
  S_TRAIN,
  expandTrainLengthFields,
  S_PREVIEW,
  S_QUALITY_EVAL,
  S_DISTRIBUTED,
  S_SPEED_SD15,
  S_ADV,
  S_NOISE,
  S_DATA_AUG,
  S_VALIDATION,
  S_THERMAL,
  conceptEditSections,
  finetuneModel,
  cnModel,
  cnDataset,
  cnTrainFields,
  cnLR,
  tiModel,
  tiParams,
  S_EXECUTION_BACKEND,
  S_COMPILE_EXPERT,
  S_MODULE_OFFLOAD_EXPERT,
} from './schemaFieldGroups.js';
import {
  S_NEGATIVE_SEMANTIC_REGULARIZATION,
  S_QUALITY_OPTIMIZATION_PACK,
  S_DIAGNOSTICS_MONITORING,
} from './schemaFrontierGroups.js';

// ---- SD 1.5 LoRA ----
// E1（2026-08 第 3 站审计，跨桶 #1）：S_TRAIN 的 network_train_text_encoder_only 被
// 队列无条件 pop、network_train_unet_only 被 shim 默认 train_text_encoder=True 反转
// 覆盖（training_queue_support.py:252-253）——「仅训 U-Net」勾选实际不生效（SD LoRA
// 的 TE 恒参训）。按后端真实行为改用显式 train_text_encoder master（SDXL finetune
// FT_TRAIN_FIELDS 三键一致先例）：worker 运行时以 config.train_text_encoder 为准
// （trainer_prepare_adapter_inject_mixin.py:46-52,297-316），builder 提交层保证三键
// 一致出站（runConfigBuilder removeUiOnlyFields）。train_length_mode 同步展开为
// 轮数/步数常显（幻影治理 C）。
const SD_LORA_TRAIN_FIELDS = [
  { key: 'train_text_encoder', type: 'boolean', label: '训练文本编码器', title: 'train_text_encoder', desc: '同时微调 CLIP 文本编码器（运行时默认语义）；关闭则仅训练 U-Net/DiT。触发词理解差、词汇绑定弱时建议开启，TE 学习率另设为 UNet 的 1/2～1/10。', defaultValue: true },
  ...expandTrainLengthFields(S_TRAIN(10), { dropFakeTeSwitches: true }),
];

export const SD15_LORA_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SD1.5 底模与恢复训练。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'sd-lora' },
    { key: 'pretrained_model_name_or_path', type: 'file', pickerType: 'model-file', label: 'SD1.5 底模路径', title: 'pretrained_model_name_or_path', desc: '底模文件路径', defaultValue: '' },
    { key: 'resume', type: 'folder', pickerType: 'output-folder', label: '继续训练路径', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
    { key: 'vae', type: 'file', pickerType: 'model-file', label: 'VAE 路径', title: 'vae', desc: 'VAE 路径', defaultValue: '' },
    { key: 'network_weights', type: 'file', pickerType: 'output-model-file', label: '继续训练 LoRA', title: 'network_weights', desc: '从已有 LoRA 文件继续训练（增量叠加而非重置）。建议 dim/alpha 与原模型一致；换底模时注意域差。', defaultValue: '' },
    { key: 'v2', type: 'boolean', label: 'SD 2.x 模型', title: 'v2', desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。', defaultValue: false },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('512,512', 1024, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', [...S_CAPTION]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('network-settings', 'network', '网络设置', '', netLora('networks.lora', 32, 32, 256, [], ['networks.flexrank_lora'])),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '', SD_LORA_TRAIN_FIELDS),
  sec('negative-semantic-regularization', 'frontier', '负面语义正则', '用负面提示词约束 LoRA 在不希望语义上的增量。', [...S_NEGATIVE_SEMANTIC_REGULARIZATION]),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标开关。', vParameterizationFields()),
  sec('rf-settings', 'training', 'Rectified Flow', 'RF / Flow Matching 训练目标与时间步策略。', rectifiedFlowParams()),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SD15]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
];

// ---- SD 1.5 概念编辑(iLECO / ADDifT / Multi-ADDifT) ----
export const SD15_ILECO_SECTIONS = conceptEditSections({
  typeId: 'sd-ileco',
  label: 'SD 1.5',
  isSdxl: false,
  mode: 'ileco',
  resolution: '512,512',
  maxTrainSteps: 500,
});

export const SD15_ADDIFT_SECTIONS = conceptEditSections({
  typeId: 'sd-addift',
  label: 'SD 1.5',
  isSdxl: false,
  mode: 'addift',
  resolution: '512,512',
  maxTrainSteps: 80,
  minTimestep: 500,
  maxTimestep: 1000,
});

export const SD15_MULTI_ADDIFT_SECTIONS = conceptEditSections({
  typeId: 'sd-multi-addift',
  label: 'SD 1.5',
  isSdxl: false,
  mode: 'multi-addift',
  resolution: '512,512',
  maxTrainSteps: 120,
  minTimestep: 500,
  maxTimestep: 1000,
});

// ---- SD DreamBooth ----
export const DB_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SD DreamBooth 全参微调。', [
    ...finetuneModel('sd-dreambooth', 'SD1.5'),
    { key: 'v2', type: 'boolean', label: 'SD 2.x 模型', title: 'v2', desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。', defaultValue: false },
  ]),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('512,512', 1024, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', [...S_CAPTION]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('v-parameterization-settings', 'training', 'V 参数化', 'v-pred 训练目标开关。', vParameterizationFields()),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SD15]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

// ---- SD ControlNet ----
export const SD_CN_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SD1.5 ControlNet。', cnModel('sd-controlnet', 'SD1.5', [{ key: 'v2', type: 'boolean', label: 'SD 2.x', desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。', defaultValue: false }])),
  sec('save-settings', 'model', '保存设置', '', [...S_SAVE]),
  sec('dataset-settings', 'dataset', '数据集设置', '', cnDataset('512,512', 1024, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', [...S_CAPTION]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...cnLR]),
  sec('training-settings', 'training', '训练参数', '', [...cnTrainFields]),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SD15]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

// ---- SD Textual Inversion ----
export const SD_TI_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'SD1.5 Textual Inversion。', tiModel('sd-textual-inversion', 'SD1.5', [{ key: 'v2', type: 'boolean', label: 'SD 2.x', desc: '声明底模为 SD 2.x 架构（影响 tokenizer/padding 与 v-pred 判断）。建议仅在确实使用 SD2.x 底模时开启，SD1.5/SDXL 保持 false。', defaultValue: false }])),
  sec('ti-params', 'model', 'Textual Inversion 专用', '', [...tiParams]),
  sec('save-settings', 'model', '保存设置', '', S_SAVE.map((f) => f.key === 'save_model_as' ? { ...f, defaultValue: 'pt' } : f.key === 'output_name' ? { ...f, defaultValue: 'embedding' } : f)),
  sec('dataset-settings', 'dataset', '数据集设置', '', ds('512,512', 1024, 64)),
  sec('caption-settings', 'dataset', 'Caption 选项', '', [...S_CAPTION]),
  sec('data-aug-settings', 'dataset', '数据增强', '颜色、翻转与裁剪增强。', [...S_DATA_AUG]),
  sec('optimizer-settings', 'optimizer', '学习率与优化器', '', [...S_LR]),
  sec('training-settings', 'training', '训练参数', '', S_TRAIN(10)),
  sec('preview-settings', 'preview', '预览图设置', '', [...S_PREVIEW, ...S_QUALITY_EVAL]),
  sec('validation-settings', 'preview', '验证设置', '验证集划分与验证频率。', [...S_VALIDATION]),
  sec('speed-settings', 'speed', '速度优化', '', [...S_SPEED_SD15]),
    sec('compile-settings', 'speed', '编译与执行后端',
    'execution_backend / torch.compile / Thunder 与 compile expert 旋钮；从速度页拆出以免与缓存/注意力搅在一起。',
    [...S_EXECUTION_BACKEND, ...S_COMPILE_EXPERT], { expert: true }),
    sec('memory-offload-settings', 'speed', '模块 Offload',
    'module_offload 完整面（CORE+EXPERT）；默认关闭。与 family block_swap / activation offload 独立。',
    [...S_MODULE_OFFLOAD_EXPERT], { expert: true }),
  sec('noise-settings', 'advanced', '噪声设置', '噪声偏移与多分辨率噪声。', [...S_NOISE]),
  sec('advanced-settings', 'advanced', '其他设置', '', [...S_ADV]),
  sec('thermal-settings', 'training', '散热与功耗', '训练期间冷却与功率管理。', [...S_THERMAL]),
  sec('distributed-settings', 'advanced', '分布式训练', '多 GPU / 多机分布式训练配置。', [...S_DISTRIBUTED]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

// ---- YOLO 训练 ----
export const YOLO_SECTIONS = [
  sec('model-settings', 'model', '训练用模型', 'YOLO 模型配置。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'yolo' },
    { key: 'pretrained_model_name_or_path', type: 'string', label: 'YOLO 模型权重', title: 'pretrained_model_name_or_path', desc: 'YOLO 模型权重或模型 yaml。', defaultValue: 'yolo11n.pt' },
    { key: 'resume', type: 'file', pickerType: 'model-file', label: '继续训练检查点', title: 'resume', desc: '从 save_state 保存的状态目录继续训练（选目录而非文件）。建议只在同版本代码/同配置下 resume，跨版本可能不兼容。', defaultValue: '' },
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', 'YOLO 数据集目录与类别。', [
    { key: 'yolo_data_config_path', type: 'file', pickerType: 'model-file', label: '自定义数据集 yaml', title: 'yolo_data_config_path', desc: '可选。自定义 YOLO 数据集 yaml。', defaultValue: '' },
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练图像目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './datasets/images/train' },
    { key: 'val_data_dir', type: 'folder', pickerType: 'folder', label: '验证图像目录', title: 'val_data_dir', desc: '验证图像目录。留空时回退为训练目录', defaultValue: './datasets/images/val' },
    { key: 'class_names', type: 'textarea', label: '类别名称', title: 'class_names', desc: '类别名称，一行一个', defaultValue: 'class0' },
  ]),
  sec('save-settings', 'model', '保存设置', '', [
    { key: 'output_name', type: 'string', label: '输出名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'exp' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/yolo' },
    { key: 'save_every_n_epochs', type: 'number', label: '每 N 轮保存', title: 'save_every_n_epochs', desc: '每 N 轮保存一次模型。推荐范围：1–5；注意与 save_every_n_steps 互斥，同时设置可能导致存储暴涨。', defaultValue: 10, min: 1 },
  ]),
  sec('training-settings', 'training', '训练参数', '', [
    { key: 'epochs', type: 'number', label: '训练轮数', title: 'epochs', desc: '训练轮数（蒸馏/短测流程用）。推荐范围：与数据规模匹配的 1–10 轮起步。', defaultValue: 100, min: 1 },
    { key: 'batch', type: 'number', label: '批量大小', title: 'batch', desc: '训练批量大小', defaultValue: 16, min: 1 },
    { key: 'imgsz', type: 'number', label: '输入分辨率', title: 'imgsz', desc: '训练输入分辨率', defaultValue: 640, min: 32 },
    { key: 'workers', type: 'number', label: '数据加载 Worker', title: 'workers', desc: '数据加载 worker 数量', defaultValue: 8, min: 0 },
    { key: 'device', type: 'string', label: '设备', title: 'device', desc: '手动指定设备，如 0、0,1、cpu。留空自动检测', defaultValue: '' },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 1337 },
  ]),
];

// ---- 美学评分模型训练 ----
export const AESTHETIC_SCORER_SECTIONS = [
  sec('output-settings', 'model', '输出设置', '模型输出配置。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'aesthetic-scorer' },
    { key: 'output_name', type: 'string', label: '模型保存名称', title: 'output_name', desc: '输出文件名（不含扩展名）。建议用「概念名+版本」命名（如 lulu_v2），同一目录多次训练勿重名以免覆盖。', defaultValue: 'aesthetic-scorer-best' },
    { key: 'output_dir', type: 'folder', pickerType: 'folder', label: '输出目录', title: 'output_dir', desc: '模型输出目录。建议指向专用盘的 models/lora 类目录，避免系统盘；训练缓存与数据集分开存放。', defaultValue: './output/aesthetic-scorer' },
    { key: 'save_model_as', type: 'select', label: '保存格式', title: 'save_model_as', desc: '产物容器格式。safetensors 安全且加载快（推荐）；ckpt 兼容旧工具链。此处是 LoRA/dense 容器选择，不是 Comfy INT8 适配器格式。', defaultValue: 'safetensors', options: ['safetensors', 'pt', 'pth', 'ckpt'] },
  ]),
  sec('dataset-settings', 'dataset', '数据集设置', '标注文件与图片配置。', [
    { key: 'annotations', type: 'file', pickerType: 'model-file', label: '标注文件路径', title: 'annotations', desc: '标注文件路径，支持 .jsonl、.csv、.db', defaultValue: './datasets/aesthetic/annotations.jsonl' },
    { key: 'image_root', type: 'folder', pickerType: 'folder', label: '图片根目录', title: 'image_root', desc: '图片根目录。留空时按标注文件中的路径直接解析', defaultValue: '' },
    { key: 'train_split', type: 'string', label: '训练 split', title: 'train_split', desc: '训练 split 名称，如 train', defaultValue: '' },
    { key: 'val_split', type: 'string', label: '验证 split', title: 'val_split', desc: '验证 split 名称，如 val', defaultValue: '' },
    { key: 'val_ratio', type: 'number', label: '验证集比例', title: 'val_ratio', desc: '未用 split 字段时按比例随机切分验证集。推荐范围：0.1（默认）附近。', defaultValue: 0.1, min: 0.01, max: 0.99, step: 0.01 },
    { key: 'target_dims', type: 'textarea', label: '评分维度', title: 'target_dims', desc: '参与训练的评分维度，一行一个', defaultValue: 'aesthetic\ncomposition\ncolor\nsexual' },
  ]),
  sec('training-settings', 'training', '训练参数', '', [
    { key: 'batch_size', type: 'number', label: '批量大小', title: 'batch_size', desc: '短测流程的批大小。当前真实短测仅允许 batch=1。推荐范围：固定 1。', defaultValue: 8, min: 1 },
    { key: 'num_workers', type: 'number', label: 'DataLoader Worker', desc: 'DataLoader worker 数（简写入口）。推荐范围：2–8，0 主进程加载。', defaultValue: 4, min: 0 },
    { key: 'epochs', type: 'number', label: '训练轮数', title: 'epochs', desc: '训练轮数（蒸馏/短测流程用）。推荐范围：与数据规模匹配的 1–10 轮起步。', defaultValue: 10, min: 1 },
    { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '3e-4' },
    { key: 'weight_decay', type: 'string', label: '权重衰减', title: 'weight_decay', desc: 'AdamW 系 L2 正则强度，抑制权重无限增长。推荐范围：0.01（默认）；Prodigy/DAdaptation 系会自行管理，可设 0。', defaultValue: '1e-4' },
    { key: 'loss', type: 'select', label: '损失函数', title: 'loss', desc: '回归损失函数选择。建议保持 mse；数据噪声明显时可换 huber 族。', defaultValue: 'mse', options: ['mse', 'smooth_l1'] },
    { key: 'cls_loss_weight', type: 'number', label: '分类损失权重', title: 'cls_loss_weight', desc: 'in_domain 二分类损失权重。推荐范围：1（默认）附近。', defaultValue: 1.0, min: 0, step: 0.1 },
    { key: 'cls_pos_weight', type: 'string', label: '正样本权重', title: 'cls_pos_weight', desc: '分类正样本权重。留空不额外加权', defaultValue: '' },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 42 },
    { key: 'device', type: 'string', label: '设备', title: 'device', desc: 'cuda、cuda:0、cpu', defaultValue: 'cuda' },
  ]),
  sec('head-settings', 'network', '融合头设置', 'Fusion head 参数。', [
    { key: 'hidden_dims', type: 'string', label: '隐层维度', title: 'hidden_dims', desc: 'Fusion head 隐层维度，逗号分隔', defaultValue: '1024,256' },
    { key: 'dropout', type: 'number', label: 'Dropout', desc: 'LyCORIS 主 dropout 概率。推荐范围：0–0.1，默认 0。', defaultValue: 0.2, min: 0, max: 1, step: 0.01 },
    { key: 'freeze_extractors', type: 'boolean', label: '冻结提取器', title: 'freeze_extractors', desc: '冻结 JTP-3 与 Waifu CLIP 特征提取器。建议保持 true（默认）防辅助分支漂移。', defaultValue: true },
    { key: 'include_waifu_score', type: 'boolean', label: '启用 Waifu 分支', title: 'include_waifu_score', desc: '启用 Waifu Scorer v3 额外特征分支。建议审美导向任务开启，一般概念训练关闭。', defaultValue: true },
  ]),
  sec('extractor-settings', 'advanced', '特征提取器设置', '', [
    { key: 'jtp3_model_id', type: 'string', label: 'JTP-3 模型 ID', title: 'jtp3_model_id', desc: 'JTP-3 模型 ID 或本地目录', defaultValue: 'RedRocket/JTP-3' },
    { key: 'jtp3_fallback_model_id', type: 'string', label: 'JTP-3 回退模型', title: 'jtp3_fallback_model_id', desc: 'JTP-3 加载失败时的回退模型 ID', defaultValue: '' },
    { key: 'hf_token_env', type: 'string', label: 'HF Token 环境变量', title: 'hf_token_env', desc: '读取 HuggingFace Token 的环境变量名', defaultValue: 'HF_TOKEN' },
    { key: 'waifu_clip_model_name', type: 'string',label: 'Waifu CLIP 模型', title: 'waifu_clip_model_name', desc: 'Waifu CLIP 模型名称', defaultValue: 'ViT-L-14' },
    { key: 'waifu_clip_pretrained', type: 'string', label: 'CLIP 预训练', title: 'waifu_clip_pretrained', desc: 'Waifu CLIP 预训练权重名称', defaultValue: 'openai' },
    { key: 'wv3_head_path', type: 'file', pickerType: 'model-file', label: 'Waifu v3 头部路径', title: 'wv3_head_path', desc: 'Waifu Scorer v3 头部权重路径。留空时自动尝试内置路径', defaultValue: '' },
  ]),
];
