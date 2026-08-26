// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import type { SchemaField, SchemaSection } from '@/schema/schemaIndex'
import {
  ALL_TRAINING_TYPES,
  TRAINING_TYPES,
  getFieldDefinition,
  getSectionsForType,
  isFieldVisible,
} from '@/schema/schemaIndex.js'
import { resolveTrainingInputs, inputGroupLabel } from './trainingInputs'
import { translate } from '@/i18n/useI18n'

export type WizardCategory =
  | 'lora'
  | 'finetune'
  | 'controlnet'
  | 'textual_inversion'
  | 'specialized'
  | 'other'

export type WizardStepId =
  | 'type'
  | 'model'
  | 'adapter'
  | 'files'
  | 'dataset'
  | 'controlnet'
  | 'yolo'
  | 'goal'
  | 'core'
  | 'ti-token'
  | 'fewstep'
  | 'distiller'
  | 'performance'
  | 'preview'
  | 'dataset-intelligence'
  | 'optional'
  | 'output'
  | 'other-settings'
  | 'review'

/** 步骤固定顺序（页面与 wizardStore 共用，避免多处维护漂移）。 */
export const WIZARD_STEP_ORDER: WizardStepId[] = [
  'type',
  'model',
  'adapter',
  'files',
  'dataset',
  'controlnet',
  'yolo',
  'goal',
  'core',
  'ti-token',
  'fewstep',
  'distiller',
  'performance',
  'preview',
  'dataset-intelligence',
  'optional',
  'output',
  'other-settings',
  'review',
]

export type WizardStepStatus =
  | 'locked'
  | 'active'
  | 'complete'
  | 'warning'
  | 'error'
  | 'stale'

export interface WizardValidation {
  errors: string[]
  warnings: string[]
  requiredKeys: string[]
}

export interface WizardFieldGroup {
  id: string
  title: string
  description?: string
  fields: SchemaField[]
  sourceSections: SchemaSection[]
}

export interface WizardStepDefinition {
  id: WizardStepId
  label: string
  description: string
  fields: SchemaField[]
  sourceSections: SchemaSection[]
  fieldSources: Record<string, string[]>
  visible: boolean
}

export interface FieldConflict {
  key: string
  sectionIds: string[]
  winnerSectionId: string
}

export interface WizardProjection {
  category: WizardCategory
  typeLabel: string
  steps: WizardStepDefinition[]
  visibleFields: SchemaField[]
  unmappedFieldKeys: string[]
  duplicateFieldKeys: string[]
  duplicateFieldConflicts: FieldConflict[]
}

export const WIZARD_CATEGORY_LABELS: Record<WizardCategory, string> = {
  lora: 'LoRA / Adapter',
  finetune: 'Full Finetune',
  controlnet: 'ControlNet',
  textual_inversion: 'Textual Inversion',
  specialized: 'Specialized',
  other: 'Other',
}

export const WIZARD_CATEGORY_DESCRIPTIONS: Record<WizardCategory, string> = {
  lora: 'Train a lightweight adapter, ideal for styles, characters, and concepts.',
  finetune: 'Update the model main weights for deeper capability changes.',
  controlnet: 'Train an additional structural or conditioning control branch.',
  textual_inversion: 'Train text embeddings that plug into prompts.',
  specialized: 'Specialized flows such as Turbo, Few-step, and Distiller.',
  // 仅当语言包缺 wizard.category.other_desc 时才会显示的回落文案；
  // YOLO 入口已隐藏，不得再宣传。
  other: 'Aesthetic scoring and other model families.',
}

const CATEGORY_ORDER: WizardCategory[] = ['lora', 'finetune', 'controlnet', 'textual_inversion', 'specialized', 'other']

type BucketId = Exclude<WizardStepId, 'type' | 'model' | 'review'>

/**
 * 显式字段归属覆盖表：优先于所有正则启发式。
 * 命中字段（键名级或 类型+键名 级）直接路由到指定步骤。
 */
const GLOBAL_OWNERSHIP_OVERRIDES: Record<string, BucketId> = {
  gradient_checkpointing: 'performance',
  checkpoint_policy: 'performance',
  anima_auto_scan_folder: 'files',
  unet_path: 'files',
  transformer_path: 'files',
  h3_transformer_path: 'files',
  teacher_path: 'files',
  teacher_lora_path: 'files',
  teacher_adapter_path: 'files',
  lora_path: 'files',
  annotations: 'dataset',
  image_root: 'dataset',
  yolo_data_config_path: 'dataset',
  dataset_intelligence_enabled: 'dataset-intelligence',
  sample_difficulty_weighting: 'dataset-intelligence',
  // SDXL 桶新增类型（dreambooth / lllite / ip-adapter）与补暴露字段的归属。
  instance_prompt: 'dataset',
  class_prompt: 'dataset',
  num_class_images: 'dataset',
  train_text_encoder: 'core',
  tag_group_shuffle: 'dataset',
  tag_group_separator: 'dataset',
  ip_image_encoder_path: 'files',
  ip_num_tokens: 'controlnet',
}

// Anima 族分桶修正（2026-08 ANIMA 桶）：分组 LR 与 Flow/时间步参数同属一张卡，
// 却被 token 启发式拆进 3 个步——anima_llm_adapter_lr 因 'adapter' 命中 adapter 步、
// 其余分组 LR 落 other-settings、discrete_flow_shift/sigmoid_scale/weighting_scheme
// 落 optional 而 timestep_sampling 命中 'timestep' 落 core。这里统一钉进 core。
const ANIMA_CORE_OVERRIDES: Record<string, BucketId> = {
  anima_self_attn_lr: 'core',
  anima_cross_attn_lr: 'core',
  anima_mlp_lr: 'core',
  anima_mod_lr: 'core',
  anima_llm_adapter_lr: 'core',
  timestep_sampling: 'core',
  discrete_flow_shift: 'core',
  anima_sigmoid_scale: 'core',
  sigmoid_scale: 'core',
  anima_weighting_scheme: 'core',
  weighting_scheme: 'core',
  mode_scale: 'core',
  anima_model_prediction_type: 'core',
  loss_type: 'core',
  flow_logit_mean: 'core',
  flow_logit_std: 'core',
  qwen3_max_token_length: 'core',
  t5_max_token_length: 'core',
}

const TYPE_OWNERSHIP_OVERRIDES: Record<string, Record<string, BucketId>> = {
  'anima-lora': ANIMA_CORE_OVERRIDES,
  'anima-finetune': ANIMA_CORE_OVERRIDES,
  'anima-controlnet': ANIMA_CORE_OVERRIDES,
  'aesthetic-scorer': {
    dropout: 'core',
    batch_size: 'core',
    epochs: 'core',
    learning_rate: 'core',
    device: 'core',
    cls_loss_weight: 'core',
    cls_pos_weight: 'core',
  },
  yolo: {
    batch: 'yolo',
    class_names: 'yolo',
    imgsz: 'yolo',
    epochs: 'yolo',
    device: 'yolo',
    seed: 'yolo',
  },
  'lab-distiller': {
    batch_size: 'distiller',
    learning_rate: 'distiller',
    distill_method: 'distiller',
    distillation_loss_weight: 'distiller',
    guidance_scale: 'distiller',
    seed: 'distiller',
    dtype: 'distiller',
    dry_run: 'distiller',
  },
  'sdxl-turbo-lora': {
    batch_size: 'fewstep',
    learning_rate: 'fewstep',
    distill_method: 'fewstep',
    distillation_loss_weight: 'fewstep',
    guidance_scale: 'fewstep',
    lcm_target_stride: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    teacher_lora_scope: 'fewstep',
    dry_run: 'fewstep',
  },
  // Lab 探针契约页真实存在的键才进 fewstep 步。曾为它路由 batch_size /
  // learning_rate / distillation_loss_weight / teacher_lora_scope —— 这四个键在
  // schema 与 lab contract（contracts/tools.py DitFewStepLoraRequest）里都不存在，
  // 属死覆盖项，已清理。
  'anima-few-step-lora': {
    distill_method: 'fewstep',
    few_step_objective: 'fewstep',
    guidance_scale: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    dry_run: 'fewstep',
  },
  // Lab 探针契约页真实存在的键才进 fewstep 步。曾为它路由 batch_size /
  // learning_rate / distillation_loss_weight / teacher_lora_scope —— 这四个键在
  // schema 与 lab contract（contracts/tools.py DitFewStepLoraRequest）里都不存在，
  // 属死覆盖项，已清理（与 anima-few-step-lora 同批对齐，2026-08 第 3 站）。
  'newbie-few-step-lora': {
    distill_method: 'fewstep',
    few_step_objective: 'fewstep',
    guidance_scale: 'fewstep',
    seed: 'fewstep',
    sigma_schedule: 'fewstep',
    dry_run: 'fewstep',
  },
  // universal-dit-lora：network_module 恒为隐藏 networks.lora，无算法卡可选面；
  // rank/alpha/dropout 钉进 core 与学习率同屏，避免 specialized 类别下出现
  // 「不需要单独选择适配器」文案却挂着三个网络字段的矛盾空步。
  'universal-dit-lora': {
    network_dim: 'core',
    network_alpha: 'core',
    network_dropout: 'core',
  },
}

const MODEL_KEYS = new Set([
  'pretrained_model_name_or_path',
  'model_path',
  'base_model_path',
  'vae',
  'vae_path',
  'qwen3',
  'llm_adapter_path',
  'network_weights',
  'teacher_model_path',
  'teacher_adapter_path',
  'text_encoder_path',
  'clip_l',
  't5xxl',
  'output_model_path',
])

const DATASET_KEYS = new Set([
  'train_data_dir',
  'dataset_dir',
  'dataset_path',
  'train_dataset',
  'validation_data_dir',
  'reg_data_dir',
  'conditioning_data_dir',
  'instance_data_dir',
  'class_data_dir',
  'data_root',
  'caption_extension',
  'caption_file_ext',
  'repeats',
  'resolution',
  'bucket_reso_steps',
  'enable_bucket',
  'random_crop',
  'center_crop',
  'color_aug',
  'flip_aug',
])

const GOAL_KEYS = new Set([
  'training_intent',
  'training_goal',
  'training_preset',
  'intent_profile',
  'profile',
  // dataset_intelligence_enabled / sample_difficulty_weighting 曾列在这里，
  // 但 GLOBAL_OWNERSHIP_OVERRIDES 先行把它们路由到 dataset-intelligence，
  // 这两条是永远不可达的死分支——归属单一事实源在 overrides 表。
])

const OUTPUT_KEYS = new Set([
  'output_dir',
  'output_name',
  'output_path',
  'save_model_as',
  'save_every_n_steps',
  'save_every_n_epochs',
  'save_last_n_models',
  'save_state',
  'resume',
  'resume_from_checkpoint',
])

const ADAPTER_EXACT_KEYS = new Set([
  'network_module',
  'network_dim',
  'network_alpha',
  'network_dropout',
  'lora_type',
  'adapter_type',
  'lycoris_algo',
  'lokr_factor',
  'decompose_both',
  'full_matrix',
  'unbalanced_factorization',
  'conv_dim',
  'conv_alpha',
  'rank_dropout',
  'module_dropout',
  'dropout',
  'dora_wd',
  'adapter_init_strategy',
  'adapter_init_export_mode',
  'loftq_bits',
  'loftq_quant_type',
  'dim_from_weights',
])

const ADAPTER_TOKEN = /(lora|lokr|glora|lycoris|adapter|network_|dora|vera|tlora|flexrank|hydra|fera|gdlokr|reslora|dokr|cdka|krona)/i
const CORE_TOKEN = /(learning_rate|lr_|train_(batch|steps|epoch)|max_train|gradient_accumulation|optimizer|scheduler|batch_size|epoch|steps|warmup|weight_decay|clip_grad|noise_offset|resolution|frame|timestep|prior_loss)/i
const PERFORMANCE_TOKEN = /(accelerat|compile|cache|offload|swap|gradient_checkpoint|checkpoint|memory|vram|turbocore|precision|dtype|attention)/i
const PREVIEW_TOKEN = /(preview|validation|sample)/i
const DATASET_INTELLIGENCE_TOKEN = /(dataset_intelligence|sample_difficulty|difficulty_weighting)/i
const CONTROLNET_TOKEN = /(controlnet|control_net|conditioning|cond_)/i
const TI_TOKEN = /(ti_|placeholder|num_vectors|inversion|token)/i
const OPTIONAL_TOKEN = /(augment|caption|regulariz|ema|safet|logging|tensorboard|wandb|random|seed)/i

const FEW_STEP_TYPES = new Set(['sdxl-turbo-lora', 'anima-few-step-lora', 'newbie-few-step-lora'])

function fieldBucket(field: SchemaField, typeId: string, category: WizardCategory): BucketId {
  const key = field.key
  const typed = TYPE_OWNERSHIP_OVERRIDES[typeId]?.[key]
  if (typed) return typed
  const global = GLOBAL_OWNERSHIP_OVERRIDES[key]
  if (global) return global
  if (MODEL_KEYS.has(key) || /(^|_)(model|vae|clip|text_encoder|qwen|t5|teacher|unet|transformer).*path/i.test(key)) return 'files'
  if (DATASET_KEYS.has(key) || /dataset|caption|bucket|augment|instance_data|class_data/i.test(key)) return 'dataset'
  if (GOAL_KEYS.has(key) || /intent|purpose|goal|preset/i.test(key)) return 'goal'
  if (OUTPUT_KEYS.has(key) || /(^|_)(output|save|resume)/i.test(key)) return 'output'
  if (DATASET_INTELLIGENCE_TOKEN.test(key)) return 'dataset-intelligence'
  if (ADAPTER_EXACT_KEYS.has(key) || ADAPTER_TOKEN.test(key)) return 'adapter'
  if (CORE_TOKEN.test(key)) return 'core'
  if (PREVIEW_TOKEN.test(key)) return 'preview'
  if (PERFORMANCE_TOKEN.test(key)) return 'performance'
  if (CONTROLNET_TOKEN.test(key)) return category === 'controlnet' ? 'controlnet' : 'optional'
  if (TI_TOKEN.test(key)) return category === 'textual_inversion' ? 'ti-token' : 'optional'
  if (OPTIONAL_TOKEN.test(key)) return 'optional'
  // 专项类型未归类的字段进入对应条件步骤
  if (FEW_STEP_TYPES.has(typeId)) return 'fewstep'
  if (typeId === 'lab-distiller') return 'distiller'
  if (typeId === 'yolo') return 'yolo'
  if (category === 'controlnet') return 'controlnet'
  if (category === 'textual_inversion') return 'ti-token'
  return 'other-settings'
}

export function categoryForTrainingType(typeId: string): WizardCategory {
  const meta = ALL_TRAINING_TYPES.find((type) => type.id === typeId)
  const group = String(meta?.group || '').toLowerCase()
  if (group === 'finetune' || /finetune|dreambooth/.test(typeId)) return 'finetune'
  if (group.includes('controlnet') || typeId.includes('controlnet')) return 'controlnet'
  if (group.includes('textual') || typeId.includes('textual-inversion')) return 'textual_inversion'
  // 实验训练（universal-dit-lora）：与专项流程同属 specialized，不混入新手 LoRA 卡列表。
  if (group.includes('实验') || /experiment/.test(group)) return 'specialized'
  if (group.includes('专项') || /turbo|few-step|distiller/.test(typeId)) return 'specialized'
  if (group === 'lora' || typeId.endsWith('-lora')) return 'lora'
  return 'other'
}

export function visibleTypesForCategory(category: WizardCategory) {
  return TRAINING_TYPES.filter((type) => !type.hidden && !type.disabled && categoryForTrainingType(type.id) === category)
}

export function wizardCategories() {
  return CATEGORY_ORDER.filter((category) => visibleTypesForCategory(category).length > 0)
}

function canonicalFields(typeId: string, config: Record<string, unknown>) {
  const sections = getSectionsForType(typeId)
  const entries = new Map<string, Array<{ field: SchemaField; section: SchemaSection }>>()
  for (const section of sections) {
    // Advanced/frontier fields remain available in expert mode. The wizard keeps
    // them out of the beginner path so the first screen stays focused.
    if (section.tab === 'advanced' || section.tab === 'frontier' || (section as SchemaSection & { expert?: boolean }).expert) continue
    for (const field of section.fields || []) {
      if (field.type === 'hidden' || field.type === 'ui_group') continue
      if (!isFieldVisible(field, config)) continue
      const list = entries.get(field.key) || []
      list.push({ field, section })
      entries.set(field.key, list)
    }
  }
  const fields: SchemaField[] = []
  const fieldSources = new Map<string, SchemaSection[]>()
  const conflicts: FieldConflict[] = []
  for (const [key, candidates] of entries) {
    const canonical = getFieldDefinition(key, typeId)
    const visibleCanonical = canonical && isFieldVisible(canonical, config) ? canonical : undefined
    const winner = visibleCanonical || candidates[candidates.length - 1].field
    fields.push(winner)
    const sourceSections = candidates.map((candidate) => candidate.section)
    fieldSources.set(key, sourceSections)
    if (candidates.length > 1) {
      const winnerSource = candidates.find((candidate) => candidate.field === winner) ?? candidates[candidates.length - 1]
      conflicts.push({
        key,
        sectionIds: sourceSections.map((section) => section.id),
        winnerSectionId: winnerSource.section.id,
      })
    }
  }
  return { fields, fieldSources, conflicts }
}

export function buildWizardProjection(typeId: string, config: Record<string, unknown>): WizardProjection {
  const meta = ALL_TRAINING_TYPES.find((type) => type.id === typeId)
  const category = categoryForTrainingType(typeId)
  const { fields, fieldSources, conflicts } = canonicalFields(typeId, config)
  const buckets = new Map<string, SchemaField[]>()
  const sourceBuckets = new Map<string, SchemaSection[]>()
  const bucketFieldSources = new Map<string, Record<string, string[]>>()
  const semanticBuckets = new Set<BucketId>([
    'files', 'dataset', 'goal', 'adapter', 'core', 'optional', 'output',
    'controlnet', 'ti-token', 'yolo', 'fewstep', 'distiller', 'performance', 'preview', 'dataset-intelligence',
  ])
  for (const field of fields) {
    const bucket = fieldBucket(field, typeId, category)
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket)!.push(field)
    const sections = fieldSources.get(field.key) || []
    const source = sourceBuckets.get(bucket) || []
    for (const section of sections) if (!source.some((item) => item.id === section.id)) source.push(section)
    sourceBuckets.set(bucket, source)
    const byKey = bucketFieldSources.get(bucket) || {}
    byKey[field.key] = sections.map((section) => section.id)
    bucketFieldSources.set(bucket, byKey)
  }

  const fewStepType = FEW_STEP_TYPES.has(typeId)
  const base: Array<[WizardStepId, string, string]> = [
    ['type', '训练类型', '选择 LoRA、Full Finetune 或其它训练入口。'],
    ['model', '模型与训练方案', '选择具体模型族和训练变体。'],
    ['adapter', category === 'lora' ? '适配器方法' : '训练结构', '只显示当前训练类型支持的结构选项。'],
    ['files', '模型文件', '选择底模、编码器、教师模型或其它所需文件。'],
    ['dataset', '数据集', '选择训练数据并配置数据读取方式。'],
    ['controlnet', 'ControlNet 条件输入', '设置控制分支的条件输入与条件图参数。'],
    ['yolo', 'YOLO 数据与类别', '设置检测数据、类别名称与训练规模。'],
    ['goal', '训练目标', '选择目标和推荐配置，建议值仍可手动修改。'],
    ['core', '核心训练参数', '设置学习率、批次、步数和优化器等主要参数。'],
    ['ti-token', 'Textual Inversion Token', '设置词向量数量与占位 token。'],
    ['fewstep', 'Few-step 专项参数', '蒸馏目标、引导与 sigma 调度等专项设置。'],
    ['distiller', 'Distiller 专项参数', '蒸馏损失与教师输入等专项设置。'],
    ['performance', '性能与加速', '显存、加速、缓存与精度相关设置。'],
    ['preview', '预览与验证', '训练中预览与验证设置。'],
    ['dataset-intelligence', '数据集智能分析', '数据难度加权与智能分析设置。'],
    ['optional', '可选能力', '按需开启增强、日志与正则化等设置。'],
    ['output', '输出与保存', '设置输出目录、文件名和 checkpoint 策略。'],
    ['other-settings', '其它设置', '当前训练类型的其它可见 schema 设置。'],
    ['review', '检查并开始', '检查最终配置，运行预检后启动训练。'],
  ]
  const steps = base.map(([id, label, description]) => {
    const hasFields = (buckets.get(id)?.length ?? 0) > 0
    let visible: boolean
    if (id === 'type' || id === 'model' || id === 'review' || id === 'files' || id === 'dataset' || id === 'output') {
      visible = true
    } else if (id === 'adapter') {
      visible = category === 'lora' || hasFields
    } else if (id === 'controlnet' || id === 'ti-token') {
      visible = (category === 'controlnet' || category === 'textual_inversion') && hasFields
    } else if (id === 'yolo') {
      visible = typeId === 'yolo' && hasFields
    } else if (id === 'fewstep') {
      visible = fewStepType && hasFields
    } else if (id === 'distiller') {
      visible = typeId === 'lab-distiller' && hasFields
    } else {
      visible = hasFields
    }
    return {
      id,
      label,
      description,
      fields: buckets.get(id) || [],
      sourceSections: sourceBuckets.get(id) || [],
      fieldSources: bucketFieldSources.get(id) || {},
      visible,
    } as WizardStepDefinition
  })

  return {
    category,
    typeLabel: meta?.label || typeId,
    steps: steps.filter((step) => step.visible),
    visibleFields: fields,
    // Every visible field has a bucket. The report still exposes the fallback
    // bucket so coverage tooling can distinguish semantic ownership from the
    // explicit "other settings" safety net.
    unmappedFieldKeys: fields.filter((field) => !semanticBuckets.has(fieldBucket(field, typeId, category))).map((field) => field.key),
    duplicateFieldKeys: conflicts.map((conflict) => conflict.key),
    duplicateFieldConflicts: conflicts,
  }
}

export function requiredKeysForStep(step: WizardStepId, fields: SchemaField[]): string[] {
  if (step === 'files') {
    return fields
      .filter((field) => MODEL_KEYS.has(field.key) && /pretrained|model_path|base_model|train_model|unet|transformer|h3|teacher/i.test(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  if (step === 'dataset') {
    return fields
      .filter((field) => ['train_data_dir', 'dataset_path', 'dataset_dir', 'train_dataset', 'dataset_yaml', 'yolo_data_config_path', 'annotations', 'image_root'].includes(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  if (step === 'output') {
    return fields
      .filter((field) => ['output_dir', 'output_path', 'save_to'].includes(field.key))
      .slice(0, 1)
      .map((field) => field.key)
  }
  return []
}

export function validateWizardStep(step: WizardStepDefinition, config: Record<string, unknown>, typeId?: string): WizardValidation {
  const errors: string[] = []
  let requiredKeys = requiredKeysForStep(step.id, step.fields)
  if (typeId) {
    const inputs = resolveTrainingInputs(typeId, config)
    const groups = step.id === 'files'
      ? inputs.model
      : step.id === 'dataset'
        ? inputs.dataset
        : step.id === 'output'
          ? inputs.output
          : []
    requiredKeys = groups.filter((group) => group.required).flatMap((group) => group.keys)
    for (const group of groups) {
      if (!group.required) continue
      if (group.anyOf) {
        const hasAny = group.keys.some((key) => String(config[key] ?? '').trim().length > 0)
        if (!hasAny) errors.push(translate('wizard.error.group_anyof_empty', { group: inputGroupLabel(group) }))
      } else {
        for (const key of group.keys) {
          if (!String(config[key] ?? '').trim()) errors.push(translate('wizard.error.field_required', { key }))
        }
      }
    }
  } else {
    const missing = requiredKeys
      .filter((key) => !String(config[key] ?? '').trim())
      .map((key) => translate('wizard.error.field_required', { key }))
    errors.push(...missing)
  }
  return { errors, warnings: [], requiredKeys }
}

export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === '' || value === null || value === undefined) return '--'
  return String(value)
}
