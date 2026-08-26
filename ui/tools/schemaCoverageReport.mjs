// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
//
// Beginner wizard schema coverage report.
//
// The report intentionally reads the registry and schema directly instead of
// maintaining a second list of training types. `unmappedFieldKeys` means a
// beginner-visible field which falls into the wizard's "other settings"
// bucket. Expert/frontier and hidden UI fields are reported separately.
//
// Usage:
//   node tools/schemaCoverageReport.mjs
//   node tools/schemaCoverageReport.mjs --json

import {
  VISIBLE_TRAINING_TYPES,
} from '../src/schema/trainingTypeRegistry.js'
import {
  createDefaultConfig,
  getSectionsForType,
  isFieldVisible,
} from '../src/schema/schemaIndex.js'

const EXPECTED_VISIBLE_TYPE_COUNT = 28

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
  'teacher_lora_path',
  'teacher_path',
  'lora_path',
  'text_encoder_path',
  'clip_l',
  't5xxl',
  'output_model_path',
  'unet_path',
  'transformer_path',
  'h3_transformer_path',
  'anima_auto_scan_folder',
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
  'annotations',
  'image_root',
  'yolo_data_config_path',
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

const PERFORMANCE_TOKEN = /(accelerat|compile|cache|offload|swap|gradient_checkpoint|checkpoint|memory|vram|turbocore|precision|dtype|attention)/i
const PREVIEW_TOKEN = /(preview|validation|sample)/i
const DATASET_INTELLIGENCE_TOKEN = /(dataset_intelligence|sample_difficulty|difficulty_weighting)/i
const CONTROLNET_TOKEN = /(controlnet|control_net|conditioning|cond_)/i
const TI_TOKEN = /(ti_|placeholder|num_vectors|inversion|token)/i
const OPTIONAL_TOKEN = /(augment|caption|regulariz|ema|safet|logging|tensorboard|wandb|random|seed)/i

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

function hasModelKey(key) {
  return MODEL_KEYS.has(key) || /(^|_)(model|vae|clip|text_encoder|qwen|t5|teacher).*path/i.test(key)
}

function hasDatasetKey(key) {
  return DATASET_KEYS.has(key) || /dataset|caption|bucket|augment|instance_data|class_data/i.test(key)
}

function hasOutputKey(key) {
  return OUTPUT_KEYS.has(key) || /(^|_)(output|save|resume|checkpoint)/i.test(key)
}

function hasAdapterKey(key) {
  return ADAPTER_EXACT_KEYS.has(key) || ADAPTER_TOKEN.test(key)
}

function bucketForKey(key) {
  if (hasModelKey(key)) return 'model'
  if (hasDatasetKey(key)) return 'dataset'
  if (hasOutputKey(key)) return 'output'
  if (hasAdapterKey(key)) return 'adapter'
  if (DATASET_INTELLIGENCE_TOKEN.test(key)) return 'dataset-intelligence'
  if (PREVIEW_TOKEN.test(key)) return 'preview'
  if (PERFORMANCE_TOKEN.test(key)) return 'performance'
  if (CONTROLNET_TOKEN.test(key)) return 'controlnet'
  if (TI_TOKEN.test(key)) return 'ti'
  if (OPTIONAL_TOKEN.test(key)) return 'optional'
  return 'other-settings'
}

function optionValue(option) {
  if (option && typeof option === 'object') return String(option.value ?? '').trim()
  return String(option ?? '').trim()
}

function optionsFor(field, config) {
  let raw
  try {
    raw = typeof field.options === 'function' ? field.options(config) : field.options
  } catch {
    return []
  }
  if (raw == null) return []
  const values = Array.isArray(raw) ? raw : Array.from(raw)
  return [...new Set(values.map(optionValue).filter(Boolean))]
}

function safeVisible(field, config) {
  try {
    return isFieldVisible(field, config)
  } catch {
    return false
  }
}

function isExpertSection(section) {
  return section.tab === 'advanced'
    || section.tab === 'frontier'
    || section.expert === true
}

function fieldLabel(field) {
  return field.label || field.title || field.key
}

function buildTypeReport(type) {
  const config = createDefaultConfig(type.id)
  const sections = getSectionsForType(type.id)
  const occurrencesByKey = new Map()

  sections.forEach((section, sectionIndex) => {
    for (const [fieldIndex, field] of (section.fields || []).entries()) {
      if (!field || !field.key) continue
      const occurrence = {
        sectionId: section.id,
        sectionTitle: section.title,
        tab: section.tab,
        sectionIndex,
        fieldIndex,
        type: field.type,
        label: fieldLabel(field),
        visibleAtDefaults: safeVisible(field, config),
        hiddenControl: field.type === 'hidden' || field.type === 'ui_group',
        expertSection: isExpertSection(section),
      }
      const existing = occurrencesByKey.get(field.key) || []
      existing.push(occurrence)
      occurrencesByKey.set(field.key, existing)
    }
  })

  const allOccurrences = [...occurrencesByKey.entries()]
  const beginnerEntries = allOccurrences.filter(([, occurrences]) => occurrences.some((entry) =>
    !entry.hiddenControl && !entry.expertSection && entry.visibleAtDefaults,
  ))
  const expertOnlyEntries = allOccurrences.filter(([, occurrences]) => occurrences.some((entry) =>
    !entry.hiddenControl && entry.expertSection,
  ) && !occurrences.some((entry) => !entry.hiddenControl && !entry.expertSection && entry.visibleAtDefaults))
  const hiddenEntries = allOccurrences.filter(([, occurrences]) => occurrences.every((entry) => entry.hiddenControl))

  const buckets = {
    model: [],
    dataset: [],
    output: [],
    adapter: [],
    'dataset-intelligence': [],
    preview: [],
    performance: [],
    controlnet: [],
    ti: [],
    optional: [],
    'other-settings': [],
  }
  const adapterOptions = {}

  for (const [key, occurrences] of beginnerEntries) {
    const bucket = bucketForKey(key)
    buckets[bucket].push(key)
    if (bucket === 'adapter') {
      const source = occurrences.find((entry) => !entry.hiddenControl && !entry.expertSection)
      const section = source ? sections[source.sectionIndex] : undefined
      const field = section?.fields?.[source?.fieldIndex]
      adapterOptions[key] = field ? optionsFor(field, config) : []
    }
  }

  const duplicateFields = allOccurrences
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([key, occurrences]) => ({
      key,
      occurrences: occurrences.map(({ sectionId, tab, fieldIndex, type, visibleAtDefaults }) => ({
        sectionId,
        tab,
        fieldIndex,
        type,
        visibleAtDefaults,
      })),
    }))

  const sortKeys = (keys) => keys.sort((a, b) => a.localeCompare(b))
  Object.values(buckets).forEach(sortKeys)

  return {
    id: type.id,
    label: type.label,
    group: type.group,
    sectionCount: sections.length,
    fieldOccurrenceCount: allOccurrences.reduce((total, [, entries]) => total + entries.length, 0),
    uniqueFieldCount: allOccurrences.length,
    beginnerVisibleFieldCount: beginnerEntries.length,
    expertOnlyFieldCount: expertOnlyEntries.length,
    hiddenControlFieldCount: hiddenEntries.length,
    modelFieldKeys: buckets.model,
    datasetFieldKeys: buckets.dataset,
    outputFieldKeys: buckets.output,
    adapterFieldKeys: buckets.adapter,
    adapterOptions,
    otherSettingsFieldKeys: buckets['other-settings'],
    performanceFieldKeys: buckets.performance,
    previewFieldKeys: buckets.preview,
    datasetIntelligenceFieldKeys: buckets['dataset-intelligence'],
    controlnetFieldKeys: buckets.controlnet,
    tiFieldKeys: buckets.ti,
    optionalFieldKeys: buckets.optional,
    expertOnlyFieldKeys: sortKeys(expertOnlyEntries.map(([key]) => key)),
    hiddenControlFieldKeys: sortKeys(hiddenEntries.map(([key]) => key)),
    duplicateFieldKeys: duplicateFields.map((item) => item.key).sort((a, b) => a.localeCompare(b)),
    duplicateFields,
  }
}

function buildReport() {
  const types = VISIBLE_TRAINING_TYPES.map(buildTypeReport)
  return {
    generatedBy: 'tools/schemaCoverageReport.mjs',
    expectedVisibleTypeCount: EXPECTED_VISIBLE_TYPE_COUNT,
    visibleTypeCount: types.length,
    visibleTypeCountMatchesExpectation: types.length === EXPECTED_VISIBLE_TYPE_COUNT,
    types,
  }
}

function preview(keys, limit = 6) {
  if (keys.length <= limit) return keys.join(', ') || '-'
  return `${keys.slice(0, limit).join(', ')} (+${keys.length - limit})`
}

function renderText(report) {
  const lines = [
    `Schema coverage: ${report.visibleTypeCount}/${report.expectedVisibleTypeCount} visible training types`,
    'Columns show beginner-visible schema keys at default config; "other" keys are covered by the wizard other-settings fallback.',
    '',
    '| Type | Model | Dataset | Output | Adapter | Perf | Preview | DI | ControlNet | TI | Optional | Other | Dup |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const type of report.types) {
    lines.push(`| ${type.id} | ${type.modelFieldKeys.length} | ${type.datasetFieldKeys.length} | ${type.outputFieldKeys.length} | ${type.adapterFieldKeys.length} | ${type.performanceFieldKeys.length} | ${type.previewFieldKeys.length} | ${type.datasetIntelligenceFieldKeys.length} | ${type.controlnetFieldKeys.length} | ${type.tiFieldKeys.length} | ${type.optionalFieldKeys.length} | ${type.otherSettingsFieldKeys.length} | ${type.duplicateFieldKeys.length} |`)
  }
  lines.push('', 'Details:')
  for (const type of report.types) {
    lines.push(`- ${type.id} (${type.label}; ${type.group})`)
    lines.push(`  model: ${preview(type.modelFieldKeys)}`)
    lines.push(`  dataset: ${preview(type.datasetFieldKeys)}`)
    lines.push(`  output: ${preview(type.outputFieldKeys)}`)
    lines.push(`  adapter: ${preview(type.adapterFieldKeys)}`)
    lines.push(`  other-settings: ${preview(type.otherSettingsFieldKeys)}`)
    lines.push(`  performance: ${preview(type.performanceFieldKeys)}`)
    lines.push(`  duplicate: ${preview(type.duplicateFieldKeys)}`)
    lines.push(`  expert-only: ${type.expertOnlyFieldCount}; hidden/ui: ${type.hiddenControlFieldCount}`)
  }
  return lines.join('\n')
}

const report = buildReport()
const args = new Set(process.argv.slice(2))

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node tools/schemaCoverageReport.mjs [--json]')
} else {
  console.log(renderText(report))
}

if (!report.visibleTypeCountMatchesExpectation) process.exitCode = 1
