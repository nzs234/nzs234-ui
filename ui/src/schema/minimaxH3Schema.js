import { sec, when, all } from './schemaCommon.js';
import {
  S_LR_DIT,
  S_LR_FT_DIT,
  S_SAVE,
  S_TRAIN,
  expandTrainLengthFields,
  TRAINING_VRAM_PROFILE_FIELD,
  TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
} from './schemaFieldGroups.js';

const H3_CHECKPOINT_OPTIONS = [
  { value: 'unsloth', label: 'Unsloth (recommended)' },
  { value: 'ffn', label: 'FFN-only' },
  { value: 'selective', label: 'Selective' },
  { value: 'full', label: 'Full recompute' },
];

function getMiniMaxH3CheckpointOptions(config = {}) {
  const swapEnabled = Number(config.h3_blocks_to_swap || 0) > 0;
  return H3_CHECKPOINT_OPTIONS.map((option) => (
    swapEnabled && option.value !== 'unsloth'
      ? { ...option, disabled: true, disabledReason: 'Unavailable while Block Swap is enabled' }
      : option
  ));
}

// E1（2026-08 第 3 站审计，跨桶 #1）：S_TRAIN 的 network_train_text_encoder_only 被
// 队列无条件 pop、network_train_unet_only 被 shim 默认 train_text_encoder=True 反转
// 覆盖（training_queue_support.py:252-253）——两个开关都是假旋钮。H3 的 Qwen3-VL 文本
// 编码器结构性冻结（LoRA 仅挂 transformer；finetune 为 DiT-only 路线），无可暴露的
// TE 训练语义 → 双键摘除。
// C（幻影治理）：train_length_mode 是 ui-only 键，展开为轮数/步数常显（见
// expandTrainLengthFields 注释）。
const H3_TRAIN_FIELDS = expandTrainLengthFields(S_TRAIN(10), { dropFakeTeSwitches: true });

const modelFields = (typeId) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'h3_transformer_path', type: 'file', desc: 'H3 Transformer（DiT 主干）权重文件路径。必填才能训练。', pickerType: 'model-file', label: 'H3 Transformer', defaultValue: '' },
  { key: 'h3_text_encoder_path', type: 'file', desc: 'Qwen3-VL 文本编码器权重路径。用于文本条件编码与缓存。', pickerType: 'model-file', label: 'Qwen3-VL Text Encoder', defaultValue: '' },
  { key: 'h3_video_vae_path', type: 'file', desc: '视频 VAE 权重路径，负责像素↔latent 转换的视频分支。', pickerType: 'model-file', label: 'Video VAE', defaultValue: '' },
  { key: 'h3_audio_vae_path', type: 'file', desc: '音频 VAE 权重路径（音视频联合任务需要）。', pickerType: 'model-file', label: 'Audio VAE', defaultValue: '' },
  { key: 'h3_partition', type: 'select', desc: '模型分区裁剪方案：fl2va_pruned 按任务裁剪非必需分支（推荐）。', label: 'Model Partition', defaultValue: 'fl2va_pruned', options: ['fl2va_pruned', 'fl2va', 'ref2va_pruned', 'ref2va'] },
];
const expansionFields = [
  { key: 'h3_depth_expansion_enabled', type: 'boolean', desc: '扩展 Transformer 深度（交错复制块+恒等初始化），全参微调专用。建议明确需要更深网络时才开启。', label: 'Expand Transformer Depth', defaultValue: false },
  { key: 'h3_depth_expansion_target_layers', type: 'number', desc: '扩层后的目标层数，须大于底模层数。推荐范围：按容量需求逐级加，不宜一次翻倍过多。', label: 'Target Layers', defaultValue: 64, min: 2, step: 1, visibleWhen: when('h3_depth_expansion_enabled', true) },
  { key: 'h3_depth_expansion_train_scope', type: 'select', desc: '扩层后的训练范围：new_layers 仅新层（接近经典 DUS）。建议 new_layers。', label: 'Train Scope', defaultValue: 'new_layers', visibleWhen: when('h3_depth_expansion_enabled', true), options: ['new_layers', 'new_layers_periphery', 'all'] },
];
// ── Flow 训练组（D①②③ 补暴露，configs_h3.py:17-35 全部消费点已核实：
//    train_step.py:279/320/327/334/376-378、cache_runtime.py:128/336）──────────────
const flowTrainingFields = [
  // σ / timestep 映射四件套（D②）
  { key: 'h3_timestep_shift', type: 'number', label: 'Timestep Shift', title: 'h3_timestep_shift', desc: '视频时间步 shift 映射，改变噪声调度重心。推荐范围：12（默认）附近微调。', defaultValue: 12.0, min: 0.000001, step: 0.1 },
  { key: 'h3_image_timestep_shift', type: 'number', label: 'Image Timestep Shift', title: 'h3_image_timestep_shift', desc: '单帧（图像）样本的时间步 shift。推荐范围：1（默认）附近。', defaultValue: 1.0, min: 0.000001, step: 0.1 },
  { key: 'h3_video_sigma_shift', type: 'number', label: 'Video Sigma Shift', title: 'h3_video_sigma_shift', desc: '视频 σ 映射 shift，与 timestep shift 协同。推荐范围：12（默认）附近。', defaultValue: 12.0, min: 0.000001, step: 0.1 },
  { key: 'h3_audio_sigma_shift', type: 'number', label: 'Audio Sigma Shift', title: 'h3_audio_sigma_shift', desc: '音频 σ 映射 shift。推荐范围：3（默认）附近。', defaultValue: 3.0, min: 0.000001, step: 0.1 },
  // 音视频损失配比（D③）
  { key: 'h3_audio_loss_weight', type: 'number', label: 'Audio Loss Weight', title: 'h3_audio_loss_weight', desc: '音频分支损失相对视频分支的权重。推荐范围：1（默认）平衡。', defaultValue: 1.0, min: 0, step: 0.05 },
  { key: 'h3_video_only', type: 'boolean', label: 'Video Only', title: 'h3_video_only', desc: '只保留视频 latent 丢弃音频分支。纯视频任务建议 true 省显存。', defaultValue: false },
  { key: 'h3_condition_noise_clean', type: 'slider', label: 'Condition Noise Clean', title: 'h3_condition_noise_clean', desc: '条件帧加噪洁净度：越接近 1 条件帧越干净。推荐范围：0.999（默认）附近。', defaultValue: 0.999, min: 0, max: 1, step: 0.001 },
  // CFG 保真组（D①）：Guidance-consistent SFT，不加载/合并任何训练 adapter。
  { key: 'h3_cfg_preservation_enabled', type: 'boolean', label: 'CFG Preservation', title: 'h3_cfg_preservation_enabled', desc: '以 CFG 一致目标做保真训练（默认开启）', defaultValue: true },
  { key: 'h3_cfg_scale', type: 'slider', label: 'CFG Scale', title: 'h3_cfg_scale', desc: '保真 CFG 强度（蒸馏模型常低 CFG）。推荐范围：1–16，默认 4 起步。', defaultValue: 4.0, min: 1, max: 16, step: 0.5, visibleWhen: when('h3_cfg_preservation_enabled', true) },
  { key: 'h3_cfg_schedule', type: 'select', label: 'CFG Schedule', title: 'h3_cfg_schedule', desc: 'CFG 调度：constant 恒定；sigma 按低 σ 区间衰减。建议 constant 起步。', defaultValue: 'constant', options: ['constant', 'sigma'], visibleWhen: when('h3_cfg_preservation_enabled', true) },
  { key: 'h3_cfg_preservation_sigma_min', type: 'slider', label: 'CFG Sigma Min', title: 'h3_cfg_preservation_sigma_min', desc: '低于该 base σ 区间不做 CFG 保真（0 全程保真）。推荐范围： 0。', defaultValue: 0.0, min: 0, max: 1, step: 0.01, visibleWhen: all(when('h3_cfg_preservation_enabled', true), when('h3_cfg_schedule', 'sigma')) },
  { key: 'h3_unconditional_prompt', type: 'textarea', label: 'Unconditional Prompt', title: 'h3_unconditional_prompt', desc: 'CFG 无条件分支提示词（留空用后端默认空串）', defaultValue: '', visibleWhen: when('h3_cfg_preservation_enabled', true) },
];
const memoryFields = [
  TRAINING_VRAM_PROFILE_FIELD,
  ...TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
  { key: 'mixed_precision', type: 'select', desc: '混合精度：前向/反向用低精度计算、保留 FP32 主权重。bf16 数值最稳（RTX30 系+/A100 必选）；fp16 给旧卡但需梯度缩放；no 为全精度调试用。推荐范围：bf16（默认）。', label: 'Mixed Precision', defaultValue: 'bf16', options: ['bf16', 'fp16', 'no'] },
  { key: 'h3_cache_latents', type: 'boolean', desc: '缓存视频/音频 latent 避免逐步重编码。建议保持 true（默认）。', label: 'Cache Audio/Video Latents', defaultValue: true },
  { key: 'h3_cache_text_encoder_outputs', type: 'boolean', desc: '缓存 Qwen3-VL 文本输出省 TE 显存与时间。建议 caption 固定保持 true。', label: 'Cache Text Encoder Outputs', defaultValue: true },
  // 缓存管理组（D④ 补暴露，cache_runtime.py:254/267 消费）
  { key: 'h3_cache_build_enabled', type: 'boolean', label: 'Enable Cache Build', title: 'h3_cache_build_enabled', desc: '关闭则跳过缓存构建（要求缓存已存在）。建议首跑保持开启。', defaultValue: true },
  { key: 'h3_cache_rebuild', type: 'boolean', label: 'Rebuild Cache', title: 'h3_cache_rebuild', desc: '忽略既有缓存工件并强制重建。建议数据变更后开一次，平时保持关闭。', defaultValue: false },
  { key: 'h3_cache_dir', type: 'folder', pickerType: 'folder', label: 'Cache Directory', title: 'h3_cache_dir', desc: '缓存目录；留空使用数据集内默认位置', defaultValue: '' },
  { key: 'h3_cache_include_audio', type: 'boolean', label: 'Include Audio In Cache', title: 'h3_cache_include_audio', desc: '缓存构建同时编码音频 VAE 分支。音频任务建议开启。', defaultValue: false },
  { key: 'h3_cache_max_pixels', type: 'number', label: 'Cache Max Pixels', title: 'h3_cache_max_pixels', desc: '单样本进入缓存的像素上限。推荐范围：262144（≈512x512，默认）。', defaultValue: 262144, min: 1024, step: 1024 },
  { key: 'h3_cache_max_samples', type: 'number', label: 'Cache Max Samples', title: 'h3_cache_max_samples', desc: '最多缓存的样本数；调试期可给小值快速迭代。推荐范围：0（不限制）。', defaultValue: 0, min: 0, step: 1 },
  // 缓存构建期 TE 流式编码（D⑤ 补暴露，cache_runtime.py:137/298 消费）
  { key: 'h3_te_layer_streaming', type: 'boolean', label: 'TE Layer Streaming (cache build)', title: 'h3_te_layer_streaming', desc: '缓存构建时逐层从 CPU 流式解码 Qwen3-VL（低显存更慢）。建议低显存构建时开。', defaultValue: false },
  { key: 'h3_blocks_to_swap', type: 'number', desc: '交换到 CPU 的 Transformer block 数量上限（0-48）。推荐范围：16G 卡从 16 起，24G 可减半或不交换。', label: 'Blocks to Swap', defaultValue: 48, min: 0, max: 48, step: 1 },
  { key: 'h3_block_swap_strategy', type: 'select', desc: '块交换调度：async 异步搬运掩盖延迟（推荐）；sync 同步简单稳妥。', label: 'Block Swap Strategy', defaultValue: 'async', options: ['async', 'pipeline', 'sync', 'auto'] },
  { key: 'h3_int8_gemm_mode', type: 'select', desc: 'INT8 GEMM 选择模式：oracle 按层实测择优（推荐）/固定策略。', label: 'INT8 GEMM Mode', defaultValue: 'oracle', options: ['oracle', 'w8a16', 'pure_torch', 'auto'] },
  { key: 'h3_preserve_lora_master_dtype', type: 'boolean', desc: 'LoRA master 权重保持 FP32 精度更新（推荐 true 防 8bit 舍入漂移）。', label: 'FP32 LoRA Master', defaultValue: true },
  // B7：swap>0 时非 unsloth 选项被禁用（下方 options 函数），提交层还会联动复位
  // （runConfigBuilder.normalizeMiniMaxH3SwapCheckpoint），双保险对齐 configs_h3.py:105-109 硬约束。
  { key: 'h3_checkpoint_mode', type: 'select', desc: '激活检查点模式：unsloth 优化重算路径（推荐）/标准实现。', label: 'Activation Checkpoint Mode', defaultValue: 'unsloth', options: getMiniMaxH3CheckpointOptions },
  { key: 'h3_activation_offload_min_tensor_mb', type: 'number', desc: '激活卸载的最小张量体积阈值（MB）。推荐范围：10（默认）以上。', label: 'Activation Offload Threshold (MB)', defaultValue: 10, min: 0, step: 1 },
  // 加载期优化（D⑥ 补暴露，loader.py:212/345/525/634 消费）
  { key: 'h3_prune_adaln_on_load', type: 'boolean', label: 'Prune AdaLN On Load', title: 'h3_prune_adaln_on_load', desc: '加载全量 BF16 checkpoint 时按 rank-8 SVD 裁剪 AdaLN（已剪模型上无效）。建议配合已剪枝模型使用。', defaultValue: false },
  { key: 'h3_load_direct_to_device', type: 'boolean', label: 'Load Direct To Device', title: 'h3_load_direct_to_device', desc: 'transformer 张量直接装载到目标设备（swap=0 时避免整模内存镜像）。建议小内存机器开启。', defaultValue: false },
];
const common = (typeId, finetune) => [
  sec('model-settings', 'model', finetune ? 'MiniMax H3 Full Finetune' : 'MiniMax H3 Model', '', [...modelFields(typeId), ...(finetune ? expansionFields : [])]),
  sec('dataset-settings', 'dataset', 'H3 Data', '', [
    { key: 'train_data_dir', type: 'folder', desc: '训练数据集根目录：每个子文件夹是一个概念，文件夹名 = 重复次数@概念名（如 10_lulu）。建议图片统一存放于此盘，SSD 更快。', pickerType: 'folder', label: 'Training Data', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', desc: '训练分辨率「宽,高」，须为 64 的倍数，匹配底模训练分辨率最佳。推荐范围：SDXL/Flux/Anima 1024,1024；SD1.5 512,512。降分辨率省显存但丢细节。', label: 'Resolution', defaultValue: '512,512' },
    { key: 'h3_frame_count', type: 'number', desc: '每个训练 clip 的帧数。推荐范围：39（默认）附近；越长越吃显存。', label: 'Frames', defaultValue: 39, min: 1 },
    { key: 'h3_fps', type: 'number', desc: '视频帧率，供 RoPE 时间编码使用。推荐范围：24（默认）与源素材一致。', label: 'FPS', defaultValue: 24, min: 1 },
  ]),
  ...(finetune ? [] : [sec('adapter-settings', 'network', 'H3 LoRA', '', [
    { key: 'network_module', type: 'hidden', defaultValue: 'networks.lora' },
    { key: 'network_dim', type: 'number', desc: 'LoRA rank：低秩子空间维度，决定可学习容量与文件体积。推荐范围：4–128；角色/复杂风格 32–64 起步，简单概念 8–16 即可。', label: 'LoRA Rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', desc: '缩放系数：有效学习率 ≈ lr × alpha/rank。推荐范围：rank 或 rank/2（如 rank=32 时 alpha=16–32）；高 rank 可降低比值求稳。', label: 'LoRA Alpha', defaultValue: 16, min: 1 },
  ])]),
  sec('optimizer-settings', 'optimizer', 'Optimizer', '', [...(finetune ? S_LR_FT_DIT : S_LR_DIT)]),
  sec('training-settings', 'training', 'Training', '', H3_TRAIN_FIELDS),
  // Flow 训练节（报告 §4.6：介于 training 与 h3-memory 之间）
  sec('h3-flow-training', 'training', 'H3 Flow Training', 'σ/timestep 映射、音视频损失配比与 CFG 保真（Guidance-consistent SFT）。', flowTrainingFields),
  // 排版对称化（F）：finetune 再滤 thin_svd_* 与 export_comfy_int8_groupsize——
  // 这些是 LoRA 导出件，此前只滤 merge_export/int8_base/engine，过滤列表与训练种类不匹配。
  sec('save-settings', 'model', 'Save', '', S_SAVE
    .filter((field) => !['merge_export', 'export_comfy_int8_base', 'export_comfy_int8_engine'].includes(field.key))
    .filter((field) => !finetune || !['export_comfy_int8_groupsize', 'thin_svd_export_enabled', 'thin_svd_export_rank'].includes(field.key))
    .map((field) => field.key === 'output_name' ? { ...field, defaultValue: finetune ? 'minimax-h3-expanded' : 'minimax-h3-lora' } : field)),
  sec('h3-memory-settings', 'speed', 'H3 Memory Runtime', 'Cache, Block Swap, and activation checkpointing share the H3 runtime.', memoryFields),
];
export const MINIMAX_H3_LORA_SECTIONS = common('minimax-h3-lora', false);
export const MINIMAX_H3_FT_SECTIONS = common('minimax-h3-finetune', true);
