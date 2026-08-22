import { sec, when } from './schemaCommon.js';
import {
  S_LR_DIT,
  S_LR_FT_DIT,
  S_SAVE,
  S_TRAIN,
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

const modelFields = (typeId) => [
  { key: 'model_train_type', type: 'hidden', defaultValue: typeId },
  { key: 'h3_transformer_path', type: 'file', pickerType: 'model-file', label: 'H3 Transformer', defaultValue: '' },
  { key: 'h3_text_encoder_path', type: 'file', pickerType: 'model-file', label: 'Qwen3-VL Text Encoder', defaultValue: '' },
  { key: 'h3_video_vae_path', type: 'file', pickerType: 'model-file', label: 'Video VAE', defaultValue: '' },
  { key: 'h3_audio_vae_path', type: 'file', pickerType: 'model-file', label: 'Audio VAE', defaultValue: '' },
  { key: 'h3_partition', type: 'select', label: 'Model Partition', defaultValue: 'fl2va_pruned', options: ['fl2va_pruned', 'fl2va', 'ref2va_pruned', 'ref2va'] },
];
const expansionFields = [
  { key: 'h3_depth_expansion_enabled', type: 'boolean', label: 'Expand Transformer Depth', defaultValue: false },
  { key: 'h3_depth_expansion_target_layers', type: 'number', label: 'Target Layers', defaultValue: 64, min: 2, step: 1, visibleWhen: when('h3_depth_expansion_enabled', true) },
  { key: 'h3_depth_expansion_train_scope', type: 'select', label: 'Train Scope', defaultValue: 'new_layers', visibleWhen: when('h3_depth_expansion_enabled', true), options: ['new_layers', 'new_layers_periphery', 'all'] },
];
const memoryFields = [
  TRAINING_VRAM_PROFILE_FIELD,
  ...TRAINING_VRAM_PROFILE_HIDDEN_FIELDS,
  { key: 'mixed_precision', type: 'select', label: 'Mixed Precision', defaultValue: 'bf16', options: ['bf16', 'fp16', 'no'] },
  { key: 'h3_cache_latents', type: 'boolean', label: 'Cache Audio/Video Latents', defaultValue: true },
  { key: 'h3_cache_text_encoder_outputs', type: 'boolean', label: 'Cache Text Encoder Outputs', defaultValue: true },
  { key: 'h3_blocks_to_swap', type: 'number', label: 'Blocks to Swap', defaultValue: 48, min: 0, max: 48, step: 1 },
  { key: 'h3_block_swap_strategy', type: 'select', label: 'Block Swap Strategy', defaultValue: 'async', options: ['async', 'pipeline', 'sync', 'auto'] },
  { key: 'h3_int8_gemm_mode', type: 'select', label: 'INT8 GEMM Mode', defaultValue: 'oracle', options: ['oracle', 'w8a16', 'pure_torch', 'auto'] },
  { key: 'h3_preserve_lora_master_dtype', type: 'boolean', label: 'FP32 LoRA Master', defaultValue: true },
  { key: 'h3_checkpoint_mode', type: 'select', label: 'Activation Checkpoint Mode', defaultValue: 'unsloth', options: getMiniMaxH3CheckpointOptions },
  { key: 'h3_activation_offload_min_tensor_mb', type: 'number', label: 'Activation Offload Threshold (MB)', defaultValue: 10, min: 0, step: 1 },
];
const common = (typeId, finetune) => [
  sec('model-settings', 'model', finetune ? 'MiniMax H3 Full Finetune' : 'MiniMax H3 Model', '', [...modelFields(typeId), ...(finetune ? expansionFields : [])]),
  sec('dataset-settings', 'dataset', 'H3 Data', '', [
    { key: 'train_data_dir', type: 'folder', pickerType: 'folder', label: 'Training Data', defaultValue: './output/lulynx' },
    { key: 'resolution', type: 'string', label: 'Resolution', defaultValue: '512,512' },
    { key: 'h3_frame_count', type: 'number', label: 'Frames', defaultValue: 39, min: 1 },
    { key: 'h3_fps', type: 'number', label: 'FPS', defaultValue: 24, min: 1 },
  ]),
  ...(finetune ? [] : [sec('adapter-settings', 'network', 'H3 LoRA', '', [
    { key: 'network_module', type: 'hidden', defaultValue: 'networks.lora' },
    { key: 'network_dim', type: 'number', label: 'LoRA Rank', defaultValue: 16, min: 1 },
    { key: 'network_alpha', type: 'number', label: 'LoRA Alpha', defaultValue: 16, min: 1 },
  ])]),
  sec('optimizer-settings', 'optimizer', 'Optimizer', '', [...(finetune ? S_LR_FT_DIT : S_LR_DIT)]),
  sec('training-settings', 'training', 'Training', '', [...S_TRAIN(10)]),
  sec('save-settings', 'model', 'Save', '', S_SAVE.filter((field) => !['merge_export', 'export_comfy_int8_base', 'export_comfy_int8_engine'].includes(field.key)).map((field) => field.key === 'output_name' ? { ...field, defaultValue: finetune ? 'minimax-h3-expanded' : 'minimax-h3-lora' } : field)),
  sec('h3-memory-settings', 'speed', 'H3 Memory Runtime', 'Cache, Block Swap, and activation checkpointing share the H3 runtime.', memoryFields),
];
export const MINIMAX_H3_LORA_SECTIONS = common('minimax-h3-lora', false);
export const MINIMAX_H3_FT_SECTIONS = common('minimax-h3-finetune', true);
