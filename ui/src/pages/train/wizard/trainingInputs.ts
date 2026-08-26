// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { getSectionsForType, isFieldVisible } from '@/schema/schemaIndex.js'
import { useLocaleStore } from '@/stores/localeStore'
import { resolveGroupLabel } from '@/i18n/useI18n'

export interface TrainingInputGroup {
  id: string
  label: string
  keys: string[]
  required: boolean
  anyOf: boolean
}

export interface TrainingInputResolution {
  model: TrainingInputGroup[]
  dataset: TrainingInputGroup[]
  output: TrainingInputGroup[]
  missing: Array<{ group: TrainingInputGroup; keys: string[] }>
}

const MODEL_KEYS = [
  'pretrained_model_name_or_path',
  'base_model_path',
  'model_path',
  'model_file',
  'h3_transformer_path',
  'transformer_path',
  'unet_path',
  'teacher_path',
  'teacher_lora_path',
  'teacher_adapter_path',
  'lora_path',
  'model',
]

const DATASET_KEYS = [
  'train_data_dir',
  'dataset_dir',
  'dataset_path',
  'train_dataset',
  'dataset_yaml',
  'yolo_data_config_path',
  'annotations',
  'image_root',
  'instance_data_dir',
  'data_root',
]

const OUTPUT_KEYS = ['output_dir', 'output_path', 'save_to']

function availableKeys(typeId: string, config: Record<string, unknown>): Set<string> {
  const result = new Set<string>()
  for (const section of getSectionsForType(typeId)) {
    for (const field of section.fields || []) {
      if (field.type !== 'hidden' && field.type !== 'ui_group' && isFieldVisible(field, config)) result.add(field.key)
    }
  }
  return result
}

function firstAvailable(keys: string[], available: Set<string>): string[] {
  return keys.filter((key) => available.has(key))
}

function group(id: string, label: string, keys: string[], required = true, anyOf = false): TrainingInputGroup {
  return { id, label, keys, required, anyOf }
}

/**
 * 组标签的本地化出口：schemaGroupsEn.json 按 zh 文本映射 EN（与 TypeRail 的
 * resolveGroupLabel 同一条链）。错误消息拼接组 label 时必须走这里，EN 界面
 * 才不会裸露中文。
 */
export function inputGroupLabel(group: TrainingInputGroup): string {
  return resolveGroupLabel(group.label, useLocaleStore.getState().language)
}

export function resolveTrainingInputs(typeId: string, config: Record<string, unknown>): TrainingInputResolution {
  const available = availableKeys(typeId, config)
  let model: TrainingInputGroup[] = []
  let dataset: TrainingInputGroup[] = []
  let output: TrainingInputGroup[] = []

  if (typeId === 'minimax-h3-lora' || typeId === 'minimax-h3-finetune') {
    model = [group('h3-transformer', 'H3 Transformer', ['h3_transformer_path'], true)]
  } else if (typeId === 'lab-distiller') {
    model = [
      group('distiller-unet', 'UNet 输入', ['unet_path'], true),
      group('distiller-teacher', '教师输入', firstAvailable(['teacher_path', 'lora_path', 'llm_path'], available), false, true),
    ].filter((item) => item.keys.length)
  } else if (typeId === 'anima-few-step-lora' || typeId === 'newbie-few-step-lora') {
    model = [
      group('fewstep-base', '基础模型', firstAvailable(['base_model_path', 'pretrained_model_name_or_path'], available), true),
      group('fewstep-teacher', '教师模型', firstAvailable(['teacher_adapter_path', 'teacher_lora_path', 'teacher_path'], available), false),
    ].filter((item) => item.keys.length)
  } else if (typeId === 'newbie-lora') {
    const baseKeys = firstAvailable(['base_model_path', 'pretrained_model_name_or_path'], available)
    if (baseKeys.length) model = [group('base-model', '基础模型', baseKeys, true)]
  } else if (typeId === 'aesthetic-scorer') {
    model = []
  } else {
    const modelKey = firstAvailable(MODEL_KEYS, available)
    if (modelKey.length) model = [group('base-model', '模型输入', modelKey, true, true)]
  }

  if (typeId === 'aesthetic-scorer') {
    dataset = [
      group('scorer-annotations', '标注文件', ['annotations'], true),
      group('scorer-images', '图像目录', ['image_root'], false),
    ]
  } else if (typeId === 'yolo') {
    dataset = [
      group('yolo-data', '训练数据', ['train_data_dir'], true),
      group('yolo-config', 'YOLO 数据配置', ['yolo_data_config_path'], false),
    ]
  } else if (typeId === 'lab-distiller' || typeId === 'anima-few-step-lora' || typeId === 'newbie-few-step-lora') {
    dataset = []
  } else {
    const datasetKey = firstAvailable(DATASET_KEYS, available)
    if (datasetKey.length) dataset = [group('dataset', '训练数据', datasetKey, true, true)]
  }

  const outputKeys = firstAvailable(OUTPUT_KEYS, available)
  if (outputKeys.length) output = [group('output', '输出位置', outputKeys, true, true)]

  const missing: TrainingInputResolution['missing'] = []
  for (const inputGroup of [...model, ...dataset, ...output]) {
    if (!inputGroup.required) continue
    if (inputGroup.anyOf) {
      const hasAny = inputGroup.keys.some((key) => String(config[key] ?? '').trim().length > 0)
      if (!hasAny) missing.push({ group: inputGroup, keys: inputGroup.keys })
    } else {
      const emptyKeys = inputGroup.keys.filter((key) => !String(config[key] ?? '').trim().length)
      if (emptyKeys.length) missing.push({ group: inputGroup, keys: emptyKeys })
    }
  }
  return { model, dataset, output, missing }
}

export function requiredInputKeys(typeId: string, config: Record<string, unknown>): string[] {
  return resolveTrainingInputs(typeId, config).missing.flatMap((item) => item.keys)
}

