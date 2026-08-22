// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import {
  ADAPTER_ENTITY_KEYS,
  ADAPTER_ENTITY_PRIORITY,
  doraEnabled,
  getAdapterTypeKey,
  normalizeAdapterFamily,
  resolveWinningAdapterEntity,
} from '@/schema/schemaCommon.js'
import {
  getAdapterFamilyCapabilities,
  getBackendAdapterFamilyCapabilities,
  getFieldDefinition,
} from '@/schema/schemaIndex.js'

export type AdapterCompatibility = 'available' | 'unsupported' | 'legacy'

export type AdapterCategoryKey = 'lora' | 'lycoris' | 'other'

export interface AdapterOption {
  id: string
  family: string
  label: string
  description: string
  values: Record<string, unknown>
  selected: boolean
  compatibility: AdapterCompatibility
  disabledReason?: string
  /** Keys to force-off when this option is chosen. */
  clears: string[]
  /** Keys to force-on when this option is chosen. */
  enables: string[]
  /**
   * Extra schema keys this card already speaks for (alias toggles of the same
   * family).  The wizard must not render a second input for them; Expert mode
   * still exposes the raw schema field.
   */
  hides: string[]
}

interface SchemaOption {
  value: string
  label?: string
  disabled?: boolean
  disabledReason?: string
}

interface FlagSpec {
  family: string
  label: string
  key: string
}

interface FieldLike {
  type?: string
  options?: unknown
}

// Re-export the single source of truth for family normalization so consumers and
// tests can assert parity with schemaCommon without importing two copies.
export { normalizeAdapterFamily }

// Local alias only — same function object, no duplicated logic.
const normalizeFamily = normalizeAdapterFamily

export interface AdapterCategoryInfo {
  id: AdapterCategoryKey
  titleKey: string
  descKey: string
  count: number
}

export const ADAPTER_CATEGORIES: ReadonlyArray<{ id: AdapterCategoryKey; titleKey: string; descKey: string }> = [
  { id: 'lora', titleKey: 'wizard.adapter_group.lora', descKey: 'wizard.adapter_group.lora_desc' },
  { id: 'lycoris', titleKey: 'wizard.adapter_group.lycoris', descKey: 'wizard.adapter_group.lycoris_desc' },
  { id: 'other', titleKey: 'wizard.adapter_group.other', descKey: 'wizard.adapter_group.other_desc' },
]

export function adapterCategoryForFamily(family: string): AdapterCategoryKey {
  const norm = normalizeFamily(family)
  if (norm === 'lora' || norm === 'dora' || norm === 'rs-lora' || norm === 'lora-plus') {
    return 'lora'
  }
  if ([
    'loha',
    'lokr',
    'glora',
    'glokr',
    'ia3',
    'full',
    'diag-oft',
    'locon',
    'dokr',
    'gdlokr',
    'cdka',
    'krona',
    'tensorring',
  ].includes(norm)) {
    return 'lycoris'
  }
  return 'other'
}

export function groupAdapterOptionsByCategory(options: AdapterOption[]): Record<AdapterCategoryKey, AdapterOption[]> {
  const groups: Record<AdapterCategoryKey, AdapterOption[]> = {
    lora: [],
    lycoris: [],
    other: [],
  }
  for (const opt of options) {
    const cat = adapterCategoryForFamily(opt.family)
    groups[cat].push(opt)
  }
  return groups
}

const FAMILY_LABELS: Record<string, string> = {
  lora: '标准 LoRA',
  dora: 'DoRA',
  'rs-lora': 'rsLoRA',
  'lora-plus': 'LoRA+',
  'lora-fa': 'LoRA-FA',
  vera: 'VeRA',
  tlora: 'T-LoRA',
  flexrank: 'FlexRank',
  fera: 'FeRA',
  hydralora: 'HydraLoRA',
  gdlokr: 'GDLoKr',
  reslora: 'ResLoRA',
  lora2: 'LoRA2',
  'lora2-adaptive': 'LoRA2 Adaptive',
  tensorring: 'T-LoRA TensorRing',
  dokr: 'DoKr',
  cdka: 'CDKA',
  krona: 'KronA',
  locon: 'LoCon',
  loha: 'LoHa',
  lokr: 'LoKr',
  glora: 'GLoRA',
  glokr: 'GLoKr',
  ia3: 'IA3',
  full: 'LyCORIS Full',
  'diag-oft': 'Diag-OFT',
}

const FAMILY_DESCRIPTIONS: Record<string, string> = {
  lora: '兼容性最好，适合大多数基础训练。',
  dora: '在 LoRA 方向之外学习幅度分量。',
  'rs-lora': '对 rank 进行稳定化缩放。',
  'lora-plus': '为 A/B 矩阵使用不同学习率倍率。',
  'lora-fa': '冻结部分低秩分量以降低显存占用。',
  vera: '使用向量化参数化减少可训练参数。',
  tlora: '使用动态 rank 调度。',
  flexrank: '按训练过程动态激活 rank。',
  fera: '使用 feature reparameterization。',
  hydralora: '多分支 LoRA + 分支平衡损失。',
  gdlokr: 'LoKr 与广义 DoRA 组合。',
  reslora: '跨层残差 shortcut。',
  lora2: 'LoRA2 门控注入。',
  'lora2-adaptive': '指数衰减权重自动学习最优 rank。',
  tensorring: 'Tensor-Ring 分解，单步 fused。',
  dokr: 'DoRA 与 LoKr 组合。',
  cdka: 'Component-Designed Kronecker。',
  krona: 'Kronecker 分解参数化。',
  locon: '为卷积层增加 LoRA 分支。',
  loha: '使用 Hadamard 乘积参数化。',
  lokr: '使用 Kronecker 分解参数化。',
  glora: '使用门控 LoRA 参数化。',
  glokr: '使用门控 Kronecker 分解。',
  ia3: 'IA3 稀疏注入。',
  full: '全参数 LyCORIS 适配。',
  'diag-oft': '对角 OFT 正交微调。',
}

// Default-LoRA variants that are not their own ΔW entity but still live on the
// default LoRALinear path. All DoRA aliases are cleared together with entity
// flags when switching away.
const DEFAULT_LORA_VARIANT_KEYS = ['dora_enabled', 'use_dora', 'dora_wd', 'adalora_enabled', 'delta_lora_enabled']

// Union of every flag a card must force off when switching adapter families.
// LoRA+ and rsLoRA are rendered as exclusive choices in the simplified wizard,
// even though Expert mode may combine optimizer-side LoRA+ with another entity.
const CLEAR_ALL_FLAG_KEYS = [
  ...ADAPTER_ENTITY_KEYS,
  ...DEFAULT_LORA_VARIANT_KEYS,
  'lora_plus_enabled',
  'rs_lora_enabled',
]

// Default-LoRA variant flag cards (in display order).
const VARIANT_SPECS: FlagSpec[] = [
  { family: 'dora', label: 'DoRA', key: 'dora_enabled' },
  { family: 'rs-lora', label: 'rsLoRA', key: 'rs_lora_enabled' },
  { family: 'lora-plus', label: 'LoRA+', key: 'lora_plus_enabled' },
]

// Alias toggles that mean "this family is on" but are not the master key the
// cards write.  dora_wd is the legacy network-args DoRA entry (the backend
// normalizer maps it onto dora_enabled/use_dora), so a wizard that renders both
// dora_wd and the DoRA method card would expose two controls for one concept.
// Expert mode still renders these raw schema fields.
const FAMILY_ALIAS_FLAG_KEYS: Record<string, string[]> = {
  dora: ['dora_wd', 'use_dora'],
  'rs-lora': ['rs_lora', 'use_rslora'],
}

function aliasHiddenKeys(family: string, masterKey: string | undefined, typeId: string): string[] {
  const aliases = FAMILY_ALIAS_FLAG_KEYS[family]
  if (!aliases) return []
  return aliases.filter((key) => key !== masterKey && Boolean(getFieldDefinition(key, typeId)))
}

// Boolean entity flags from ADAPTER_ENTITY_PRIORITY.  family is the normalized
// form so it lines up with identity-option families (lora_fa -> lora-fa etc.).
const ENTITY_SPECS: FlagSpec[] = ADAPTER_ENTITY_PRIORITY.map((ent) => ({
  family: normalizeAdapterFamily(ent.id),
  label: ent.label,
  key: ent.key,
}))

// network_module spellings are folded into the canonical family space here.
// schemaCommon.normalizeAdapterFamily intentionally keeps raw spellings
// ('networks.vera' stays 'networks.vera'), so this map is the single place that
// turns network-module values into the same family ids the capability maps use.
const NETWORK_MODULE_FAMILY: Record<string, string> = {
  'networks.lora_fa': 'lora-fa',
  'networks.lora-fa': 'lora-fa',
  'networks.vera': 'vera',
  'networks.tlora': 'tlora',
  'networks.tlora_flux': 'tlora',
  'networks.tlora-flux': 'tlora',
  'networks.flexrank_lora': 'flexrank',
  'networks.flexrank-lora': 'flexrank',
  'networks.oft': 'diag-oft',
  'networks.oft_flux': 'diag-oft',
  'networks.oft-flux': 'diag-oft',
}

const LYCORIS_UMBRELLA_MODULES = new Set(['lycoris', 'lycoris.kohya', 'lycoris.locon'])

function networkModuleFamily(value: string): string | undefined {
  const raw = String(value || '').trim().toLowerCase()
  if (NETWORK_MODULE_FAMILY[raw]) return NETWORK_MODULE_FAMILY[raw]
  if (LYCORIS_UMBRELLA_MODULES.has(raw)) return undefined
  if (raw.startsWith('networks.lora')) return 'lora'
  return normalizeFamily(raw)
}

function schemaOptions(field: { options?: unknown } | undefined, config: Record<string, unknown>): SchemaOption[] {
  if (!field) return []
  const raw = typeof field.options === 'function'
    ? (field.options as (current: Record<string, unknown>) => Iterable<unknown>)(config)
    : field.options
  if (!raw) return []
  const values = Array.isArray(raw) ? raw : Array.from(raw as Iterable<unknown>)
  return values.map((item) => {
    if (item && typeof item === 'object') {
      const option = item as Record<string, unknown>
      return {
        value: String(option.value ?? ''),
        label: typeof option.label === 'string' ? option.label : undefined,
        disabled: option.disabled === true,
        disabledReason: typeof option.disabledReason === 'string' ? option.disabledReason : undefined,
      }
    }
    return { value: String(item ?? '') }
  }).filter((item) => item.value)
}

function editableField(field: FieldLike | undefined): boolean {
  return Boolean(field && field.type !== 'hidden' && field.type !== 'ui_group')
}

function identityValues(
  fieldKey: 'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo',
  optionValue: string,
  fields: Record<'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo', FieldLike | undefined>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (fieldKey === 'lora_type' && editableField(fields.lora_type)) values.lora_type = optionValue
  if (fieldKey === 'adapter_type' && editableField(fields.adapter_type)) values.adapter_type = optionValue
  if (fieldKey === 'network_module' && editableField(fields.network_module)) values.network_module = optionValue
  if (fieldKey === 'lycoris_algo' && editableField(fields.lycoris_algo)) {
    values.lycoris_algo = optionValue
    if (editableField(fields.network_module)) values.network_module = 'lycoris.kohya'
  }
  return values
}

function targetIdentityValues(
  family: string,
  fields: Record<'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo', FieldLike | undefined>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (editableField(fields.network_module)) {
    const networkOpts = schemaOptions(fields.network_module, config)
    const matching = networkOpts.find((opt) => networkModuleFamily(opt.value) === family)
    if (matching) return { network_module: matching.value }
  }
  for (const fieldKey of ['lora_type', 'adapter_type'] as const) {
    if (!editableField(fields[fieldKey])) continue
    const opts = schemaOptions(fields[fieldKey], config)
    const matching = opts.find((opt) => normalizeFamily(opt.value) === family)
    if (matching) return { [fieldKey]: matching.value }
  }
  return defaultAdapterIdentityValues(fields, config)
}

function defaultAdapterIdentityValues(
  fields: Record<'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo', FieldLike | undefined>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const networkOptions = schemaOptions(fields.network_module, config)
  const standardNetwork = networkOptions.find((option) => networkModuleFamily(option.value) === 'lora')
  if (standardNetwork && editableField(fields.network_module)) return { network_module: standardNetwork.value }

  for (const fieldKey of ['lora_type', 'adapter_type'] as const) {
    if (!editableField(fields[fieldKey])) continue
    const standard = schemaOptions(fields[fieldKey], config).find((option) => normalizeFamily(option.value) === 'lora')
    if (standard) return { [fieldKey]: standard.value }
  }
  return {}
}

// Resolve the effective family from the current config. Derived from
// schemaCommon.resolveWinningAdapterEntity (winner id), never from a raw string
// comparison of lora_type.
function winnerFamily(config: Record<string, unknown>): string {
  const winner = resolveWinningAdapterEntity(config)
  if (winner.id === 'lycoris') {
    // Module-driven schemas can retain a stale lora_type from a previous draft;
    // lycoris_algo is the source of truth whenever network_module selects it.
    const networkModule = String(config.network_module || '').trim().toLowerCase()
    const networkDriven = networkModule.includes('lycoris')
      || ['networks.oft', 'networks.oft_flux', 'networks.oft-flux', 'oft', 'diag-oft', 'diag_oft'].includes(networkModule)
    const algo = networkDriven
      ? (['networks.oft', 'networks.oft_flux', 'networks.oft-flux', 'oft', 'diag-oft', 'diag_oft'].includes(networkModule)
          ? 'diag-oft'
          : String(config.lycoris_algo || 'loha'))
      : (getAdapterTypeKey(config) || String(config.lycoris_algo || 'loha'))
    return normalizeFamily(algo)
  }
  if (winner.id !== 'lora') {
    return normalizeFamily(winner.id)
  }
  if (doraEnabled(config)) return 'dora'
  if (config.rs_lora_enabled === true || config.rs_lora === true || config.use_rslora === true) return 'rs-lora'
  if (config.lora_plus_enabled === true) return 'lora-plus'
  return normalizeFamily(getAdapterTypeKey(config))
}

function activeFlagSpec(family: string, typeId: string): FlagSpec | undefined {
  const spec = [...VARIANT_SPECS, ...ENTITY_SPECS].find((entry) => entry.family === family)
  if (spec && getFieldDefinition(spec.key, typeId)) return spec
  return undefined
}

function clearKeysFor(flagKey: string | undefined): string[] {
  return flagKey ? CLEAR_ALL_FLAG_KEYS.filter((key) => key !== flagKey) : [...CLEAR_ALL_FLAG_KEYS]
}

/**
 * Build the values to write when an adapter card is chosen.  The caller applies
 * normalizeAdapterEntityMutex({ ...config, ...buildAdapterSelection(config, option) }).
 */
export function buildAdapterSelection(config: Record<string, unknown>, option: AdapterOption): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const key of option.enables) values[key] = true
  for (const key of option.clears) values[key] = false
  Object.assign(values, option.values)
  return values
}

export function adapterOptions(config: Record<string, unknown>, typeId: string): AdapterOption[] {
  const fields = {
    lora_type: getFieldDefinition('lora_type', typeId) as FieldLike | undefined,
    adapter_type: getFieldDefinition('adapter_type', typeId) as FieldLike | undefined,
    network_module: getFieldDefinition('network_module', typeId) as FieldLike | undefined,
    lycoris_algo: getFieldDefinition('lycoris_algo', typeId) as FieldLike | undefined,
  }
  if (!Object.values(fields).some(editableField)) return []

  const backend = getBackendAdapterFamilyCapabilities()
  const merged = getAdapterFamilyCapabilities()
  const backendKeys = new Set(Object.keys(backend).map(normalizeFamily))
  const backendPresent = backendKeys.size > 0
  const mergedKeys = new Set(Object.keys(merged))

  const winner = winnerFamily(config)
  const seen = new Set<string>()
  const result: AdapterOption[] = []

  const pushCard = (card: Omit<AdapterOption, 'selected'>): void => {
    if (!card || seen.has(card.family)) return
    seen.add(card.family)
    result.push({ ...card, selected: card.family === winner })
  }

  const buildIdentityCard = (
    fieldKey: 'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo',
    option: SchemaOption,
    family: string,
  ): Omit<AdapterOption, 'selected'> => {
    const flagSpec = activeFlagSpec(family, typeId)
    const values = identityValues(fieldKey, option.value, fields)
    const disabled = option.disabled === true
    let compatibility: AdapterCompatibility = 'available'
    let disabledReason = option.disabledReason
    if (disabled) {
      compatibility = 'unsupported'
    } else if (backendPresent) {
      if (backendKeys.has(family)) {
        compatibility = 'available'
      } else {
        compatibility = 'unsupported'
        disabledReason = disabledReason || '当前后端能力未提供此适配器。'
      }
    } else {
      compatibility = mergedKeys.has(family) ? 'available' : 'legacy'
    }
    return {
      id: family,
      family,
      label: option.label || FAMILY_LABELS[family] || family,
      description: option.disabledReason || FAMILY_DESCRIPTIONS[family] || '当前 schema 支持的适配器结构。',
      values,
      compatibility,
      disabledReason,
      clears: clearKeysFor(flagSpec?.key),
      enables: flagSpec ? [flagSpec.key] : [],
      hides: aliasHiddenKeys(family, flagSpec?.key, typeId),
    }
  }

  const buildFlagCard = (spec: FlagSpec): Omit<AdapterOption, 'selected'> => {
    let compatibility: AdapterCompatibility = 'available'
    let disabledReason: string | undefined
    if (backendPresent) {
      if (backendKeys.has(spec.family)) {
        compatibility = 'available'
      } else {
        compatibility = 'unsupported'
        disabledReason = '当前后端能力未提供此适配器。'
      }
    } else {
      compatibility = mergedKeys.has(spec.family) ? 'available' : 'legacy'
    }
    return {
      id: spec.family,
      family: spec.family,
      label: spec.label || FAMILY_LABELS[spec.family] || spec.family,
      description: FAMILY_DESCRIPTIONS[spec.family] || '当前 schema 支持的适配器结构。',
      values: targetIdentityValues(spec.family, fields, config),
      compatibility,
      disabledReason,
      clears: clearKeysFor(spec.key),
      enables: [spec.key],
      hides: aliasHiddenKeys(spec.family, spec.key, typeId),
    }
  }

  // (a) identity field options — schema options are the source of truth for the
  // adapter families a type actually exposes, preserving disabled/disabledReason.
  const identityFieldOrder: Array<'lora_type' | 'adapter_type' | 'network_module' | 'lycoris_algo'> = [
    'lora_type',
    'adapter_type',
    'network_module',
    'lycoris_algo',
  ]
  for (const fieldKey of identityFieldOrder) {
    const field = fields[fieldKey]
    if (!editableField(field)) continue
    for (const option of schemaOptions(field, config)) {
      if (fieldKey === 'network_module' && LYCORIS_UMBRELLA_MODULES.has(option.value.trim().toLowerCase())) continue
      const family = fieldKey === 'network_module'
        ? networkModuleFamily(option.value)
        : normalizeFamily(option.value)
      if (!family || seen.has(family)) continue
      pushCard(buildIdentityCard(fieldKey, option, family))
    }
  }

  // (b) boolean entity flags + default-LoRA variant cards — only when the type's
  // schema actually contains the corresponding field key.
  for (const spec of [...VARIANT_SPECS, ...ENTITY_SPECS]) {
    if (!getFieldDefinition(spec.key, typeId)) continue
    if (seen.has(spec.family)) continue
    pushCard(buildFlagCard(spec))
  }

  return result
}
