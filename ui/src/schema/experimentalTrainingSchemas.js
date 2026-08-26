
import {
  S_QUALITY_OPTIMIZATION_PACK,
  S_DIAGNOSTICS_MONITORING,
} from './schemaFrontierGroups.js';
// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
const sec = (id, tab, title, desc, fields) => ({ id, tab, title, description: desc, fields });
const when = (key, expected) => (config) => config[key] === expected;

export const LAB_DISTILLER_SECTIONS = [
  sec('lab-model-settings', 'model', '蒸馏输入', '从传统 LoRA teacher 蒸馏出 Lulynx LAB sidecar。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'lab-distiller' },
    { key: 'unet_path', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'UNet / SDXL 基础模型', title: 'unet_path', desc: 'SDXL UNet、checkpoint 或 diffusers 模型路径。', defaultValue: '' },
    { key: 'lora_path', type: 'file', pickerType: 'model-file', label: 'Teacher LoRA', title: 'lora_path', desc: '传统 LoRA teacher，通常对应 LoRA 架构模型。', defaultValue: '' },
    { key: 'teacher_path', type: 'file', pickerType: 'model-file', label: '可选 Teacher 模型', title: 'teacher_path', desc: '可选，用于显式指定 teacher 模型资源。', defaultValue: '' },
    { key: 'llm_path', type: 'folder', pickerType: 'folder', label: '文本/语义模型路径', title: 'llm_path', desc: '可填本地 Gemma/Jina CLIP/文本模型目录', defaultValue: 'Qwen/Qwen2.5-0.5B' },
    { key: 'projector_path', type: 'file', pickerType: 'model-file', label: 'Projector', title: 'projector_path', desc: '可选，已有 projector 权重路径。', defaultValue: '' },
  ]),
  sec('lab-run-settings', 'training', '蒸馏参数', '先用 dry-run 验证契约，再做真实短测。', [
    { key: 'dry_run', type: 'boolean', label: '仅验证契约', title: 'dry_run', desc: '默认开启：只校验数据集/配置契约并写 metadata stub，不启动真实训练。真实训练前请确认已关闭。推荐范围：试跑新配置保持 true，正式跑改 false。', defaultValue: true },
    { key: 'allow_tokenizer_only_clip', type: 'boolean', label: '允许 tokenizer-only CLIP', title: 'allow_tokenizer_only_clip', desc: '允许加载只有 tokenizer 的不完整 CLIP/Jina 资源（仅分词用途）。建议仅在明确知道后果时开启。', defaultValue: false },
    { key: 'steps', type: 'number', label: '蒸馏步数', title: 'steps', desc: '真实蒸馏总步数。推荐范围：与常规 LoRA 同量级（1000 起）再调。', defaultValue: 1000, min: 1 },
    { key: 'batch_size', type: 'number', label: 'Batch', title: 'batch_size', desc: '短测流程的批大小。当前真实短测仅允许 batch=1。推荐范围：固定 1。', defaultValue: 4, min: 1 },
    { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '1e-5' },
    { key: 'dtype', type: 'select', label: '计算精度', title: 'dtype', desc: '底模加载与计算精度。auto 按设备自动选择；建议 auto 或 bf16，fp16 仅用于不支持 bf16 的环境。', defaultValue: 'bf16', options: ['auto', 'bf16', 'fp16', 'fp32'] },
    { key: 'device', type: 'string', label: '设备', title: 'device', desc: 'cuda、cuda:0 或 cpu。', defaultValue: 'cuda' },
  ]),
  sec('lab-output-settings', 'model', '输出', '输出 sidecar 会写入 output/lab_distiller。', [
    { key: 'output_path', type: 'file', pickerType: 'output-model-file', label: '输出 sidecar', title: 'output_path', desc: '建议使用 output/lab_distiller', defaultValue: './output/lab_distiller/sidecar.safetensors' },
  ]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

export const SDXL_TURBO_LORA_SECTIONS = [
  sec('turbo-model-settings', 'model', 'SDXL 教师与数据', 'few-step LoRA 蒸馏入口。当前重点是 LCM-LoRA/短测链路。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: 'sdxl-turbo-lora' },
    { key: 'base_model_path', type: 'file', pickerType: 'model-file', allowModelDirectory: true, label: 'SDXL 基础模型', title: 'base_model_path', desc: 'SDXL checkpoint 或 diffusers 模型目录。', defaultValue: '' },
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: '训练数据目录', title: 'train_data_dir', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', defaultValue: './output/lulynx' },
    { key: 'teacher_lora_path', type: 'file', pickerType: 'model-file', label: 'Teacher LoRA', title: 'teacher_lora_path', desc: '可选，从已有风格/角色 LoRA 蒸馏 few-step 版本。', defaultValue: '' },
    { key: 'teacher_lora_scope', type: 'select', label: 'Teacher LoRA 加载范围', title: 'teacher_lora_scope', desc: 'Teacher LoRA 加载范围：unet_only 默认。建议保持默认避免 TE 干扰蒸馏目标。', defaultValue: 'unet_only', options: ['unet_only', 'unet_and_text_encoder_experimental'] },
    { key: 'vae_path', type: 'file', pickerType: 'model-file', label: 'VAE', title: 'vae_path', desc: '可选，自定义 SDXL VAE', defaultValue: '' },
  ]),
  sec('turbo-distill-settings', 'training', 'LCM / Turbo 蒸馏参数', '真实短测目前限制为最多 4 步、batch 1，用来验证链路和 sidecar，不代表最终质量。', [
    { key: 'dry_run', type: 'boolean', label: '仅验证契约', title: 'dry_run', desc: '默认开启：只校验数据集/配置契约并写 metadata stub，不启动真实训练。真实训练前请确认已关闭。推荐范围：试跑新配置保持 true，正式跑改 false。', defaultValue: true },
    { key: 'confirm_real_run', type: 'boolean', label: '确认真实短测', title: 'confirm_real_run', desc: '关闭 dry-run 后必须开启。', defaultValue: false, visibleWhen: when('dry_run', false) },
    { key: 'distill_method', type: 'select', label: '蒸馏方法', title: 'distill_method', desc: '当前推荐 LCM-LoRA', defaultValue: 'lcm_lora', options: ['lcm_lora', 'turbo_lora'] },
    { key: 'real_objective', type: 'select', label: '真实短测目标', title: 'real_objective', desc: '真实短测目标选择：lcm_consistency_prob 用 teacher 生成对齐目标。建议按实验目的选择，默认即可。', defaultValue: 'lcm_consistency_probe', options: ['lcm_consistency_probe', 'epsilon_lora_probe'] },
    { key: 'teacher_scheduler', type: 'select', label: 'Teacher Scheduler', title: 'teacher_scheduler', desc: 'Teacher 采样器。建议 dpmpp_2m_karras（默认）高质量。', defaultValue: 'dpmpp_2m_karras', options: ['euler_a', 'dpmpp_2m_karras', 'ddim', 'lcm'] },
    { key: 'teacher_steps', type: 'number', label: 'Teacher 步数', title: 'teacher_steps', desc: 'Teacher 推理步数。推荐范围：30（默认）；越大越准越贵。', defaultValue: 30, min: 1 },
    { key: 'student_scheduler', type: 'select', label: 'Student Scheduler', title: 'student_scheduler', desc: 'Student 少步采样器。建议 lcm（默认）。', defaultValue: 'lcm', options: ['lcm', 'euler', 'euler_a'] },
    { key: 'student_steps', type: 'number', label: 'Student 步数', title: 'student_steps', desc: '目标 few-step 步数。推荐范围：4（默认）；1–8 内越少越难对齐。', defaultValue: 4, min: 1, max: 12 },
    { key: 'guidance_scale', type: 'number', label: 'CFG / Guidance', title: 'guidance_scale', desc: 'CFG/Guidance 强度（LCM-LoRA 类低值）。推荐范围：LCM 1.0–2.0 起测；常规蒸馏按教师设定。', defaultValue: 1.5, min: 0, max: 12, step: 0.1 },
    { key: 'lcm_target_stride', type: 'number', label: 'LCM 目标跨度', title: 'lcm_target_stride', desc: 'teacher 一致性跨度 t→t-stride。推荐范围：80（默认）附近。', defaultValue: 80, min: 1 },
    { key: 'timestep_sampling', type: 'select', label: 'Timestep 采样', title: 'timestep_sampling', desc: '扩散时间步采样分布（shift/logit_normal/uniform 等）。建议 shift（默认）对多数 flow 模型最佳。', defaultValue: 'lcm', options: ['lcm', 'uniform', 'logit_normal'] },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 42, min: 0 },
    { key: 'distillation_loss_weight', type: 'number', label: '蒸馏损失权重', title: 'distillation_loss_weight', desc: '蒸馏对齐损失的总体权重。推荐范围：1（默认）；过大压制学生自身目标。', defaultValue: 1.0, min: 0, max: 10, step: 0.1 },
    { key: 'learning_rate', type: 'string', label: '学习率', title: 'learning_rate', desc: '主学习率：每次参数更新的步幅，是影响收敛与稳定性的首要超参。留空时按各子项学习率回退。推荐范围：LoRA 用 1e-4 起步（小数据集可到 5e-5）；全参 finetune 用 1e-6～5e-6；Prodigy/DAdaptation 系设 1.0 让其自适应。', defaultValue: '1e-4' },
    { key: 'max_train_steps', type: 'number', label: '最大训练步数', title: 'max_train_steps', desc: '按优化器更新步数控制训练长度，比轮数更精确。推荐范围：设 0 表示不启用；启用时常用 1000–5000 步做 LoRA。', defaultValue: 1000, min: 1 },
    { key: 'batch_size', type: 'number', label: 'Batch', title: 'batch_size', desc: '短测流程的批大小。当前真实短测仅允许 batch=1。推荐范围：固定 1。', defaultValue: 1, min: 1 },
    { key: 'resolution', type: 'number', label: '短测分辨率', title: 'resolution', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', defaultValue: 512, min: 256, max: 512, step: 64 },
    { key: 'mixed_precision', type: 'select', label: '混合精度', title: 'mixed_precision', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', defaultValue: 'bf16', options: ['bf16', 'fp16', 'fp32'] },
  ]),
  sec('turbo-network-settings', 'network', 'LoRA 网络', 'Student LoRA 结构。', [
    { key: 'network_dim', type: 'number', label: 'Rank', title: 'network_dim', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1, max: 256 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', title: 'network_alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1, max: 256 },
    { key: 'network_dropout', type: 'number', label: 'Dropout', title: 'network_dropout', desc: '对 LoRA 输出按神经元随机置零的正则。推荐范围：0（默认）或 ≤0.1；过大伤收敛。', defaultValue: 0, min: 0, max: 1, step: 0.05 },
    { key: 'target_modules', type: 'select', label: '目标模块', title: 'target_modules', desc: 'LyCORIS 目标模块选择。建议保持默认全集，缩小目标用于排查冲突。', defaultValue: 'unet_attention', options: ['unet_attention', 'unet_attention_and_mlp'] },
  ]),
  sec('turbo-output-settings', 'model', '输出与验证', '输出会写 scheduler-aware metadata，资源中心可识别为 acceleration LoRA。', [
    { key: 'output_path', type: 'file', pickerType: 'output-model-file', label: '输出 LoRA', title: 'output_path', desc: '建议使用 output/turbo_lora/*.', defaultValue: './output/turbo_lora/sdxl_lcm_lora.safetensors' },
    { key: 'metadata_note', type: 'textarea', label: '元数据备注', title: 'metadata_note', desc: '写入输出 sidecar 的备注。', defaultValue: 'Experimental SDXL LCM-LoRA output.' },
    { key: 'samples_dir', type: 'folder', pickerType: 'folder', label: '样张目录', title: 'samples_dir', desc: '可选，用于生成基础样张文件报告', defaultValue: '' },
  ]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

const ditFewStepSections = (family, label) => [
  sec(`${family}-few-step-model-settings`, 'model', `${label} few-step 输入`, '当前为契约入口，用来打通 metadata、资源中心和后端 runner。', [
    { key: 'model_train_type', type: 'hidden', defaultValue: `${family}-few-step-lora` },
    { key: 'model_family', type: 'hidden', defaultValue: family },
    { key: 'base_model_path', type: 'file', pickerType: 'model-file', label: `${label} 基础模型`, title: 'base_model_path', desc: '可选，记录到 metadata', defaultValue: '' },
    { key: 'transformer_path', type: 'folder', pickerType: 'folder', label: 'Transformer 目录', title: 'transformer_path', desc: '可选，记录到 metadata', defaultValue: '' },
    { key: 'teacher_adapter_path', type: 'file', pickerType: 'model-file', label: 'Teacher Adapter', title: 'teacher_adapter_path', desc: '可选，用已有 adapter 作为 teacher。', defaultValue: '' },
  ]),
  sec(`${family}-few-step-distill-settings`, 'training', 'Few-step 目标', '真实质量训练放在后续阶段；这里先生成可识别的 acceleration LoRA 契约产物。', [
    { key: 'dry_run', type: 'boolean', label: '仅验证契约', title: 'dry_run', desc: '默认开启：只校验数据集/配置契约并写 metadata stub，不启动真实训练。真实训练前请确认已关闭。推荐范围：试跑新配置保持 true，正式跑改 false。', defaultValue: true },
    { key: 'distill_method', type: 'string', label: '蒸馏方法', title: 'distill_method', desc: '记录到 metadata', defaultValue: 'family_flow_consistency' },
    { key: 'few_step_objective', type: 'string', label: 'Few-step 目标', title: 'few_step_objective', desc: '记录到 metadata', defaultValue: 'contract_probe' },
    { key: 'sigma_schedule', type: 'string', label: 'Sigma Schedule', title: 'sigma_schedule', desc: '记录到 metadata', defaultValue: 'family_default' },
    { key: 'teacher_steps', type: 'number', label: 'Teacher 步数', title: 'teacher_steps', desc: 'Teacher 推理步数。推荐范围：30（默认）；越大越准越贵。', defaultValue: 28, min: 1 },
    { key: 'student_steps', type: 'number', label: 'Student 步数', title: 'student_steps', desc: '目标 few-step 步数。推荐范围：4（默认）；1–8 内越少越难对齐。', defaultValue: 4, min: 1 },
    { key: 'guidance_scale', type: 'number', label: 'Guidance', title: 'guidance_scale', desc: 'CFG/Guidance 强度（LCM-LoRA 类低值）。推荐范围：LCM 1.0–2.0 起测；常规蒸馏按教师设定。', defaultValue: 1.0, min: 0, step: 0.1 },
    { key: 'seed', type: 'number', label: '随机种子', title: 'seed', desc: '随机种子：固定后数据顺序/初始化/噪声可复现。推荐范围：调试期与正式出包都建议固定（如 1337）便于复现；-1 表示每次随机。', defaultValue: 42, min: 0 },
  ]),
  sec(`${family}-few-step-network-settings`, 'network', 'LoRA 网络', 'Acceleration LoRA metadata。', [
    { key: 'adapter_type', type: 'select', label: '适配器类型', title: 'adapter_type', desc: 'Newbie 适配器类型选择，会映射到原生 LoRA 路线。建议 lora；其余为预留入口。', defaultValue: 'lora', options: ['lora'] },
    { key: 'network_module', type: 'string', label: '网络模块', title: 'network_module', desc: '训练网络模块决定适配器实现路线。建议 networks.lora（兼容性最好）；lora_fa/vera/tlora/flexrank 为实验变体；lycoris.kohya 是旧入口。', defaultValue: 'networks.lora' },
    { key: 'network_dim', type: 'number', label: 'Rank', title: 'network_dim', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'Alpha', title: 'network_alpha', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', defaultValue: 16, min: 1 },
  ]),
  sec(`${family}-few-step-output-settings`, 'model', '输出', '输出 metadata-only safetensors，用于资源中心识别与后续真实训练替换。', [
    { key: 'output_path', type: 'file', pickerType: 'output-model-file', label: '输出 LoRA', title: 'output_path', desc: '建议使用 output/dit_few_step_lora', defaultValue: `./output/dit_few_step_lora/${family}_few_step_lora.safetensors` },
  ]),
  sec('quality-pack-settings', 'frontier', '画质优化包', '', [...S_QUALITY_OPTIMIZATION_PACK], { expert: true }),
  sec('diagnostics-settings', 'frontier', '诊断监控', '', [...S_DIAGNOSTICS_MONITORING], { expert: true }),

];

export const ANIMA_FEW_STEP_LORA_SECTIONS = ditFewStepSections('anima', 'Anima');
export const NEWBIE_FEW_STEP_LORA_SECTIONS = ditFewStepSections('newbie', 'Newbie');
