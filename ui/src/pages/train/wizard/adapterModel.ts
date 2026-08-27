// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import {
  ADAPTER_ENTITY_KEYS,
  ADAPTER_ENTITY_PRIORITY,
  doraEnabled,
  doraModelFamilyKey,
  doraStackableFamiliesForType,
  doraSupportAuditedForType,
  normalizeAdapterFamily,
  resolveAdapterFamily,
} from '@/schema/schemaCommon.js'
import {
  getAdapterFamilyCapabilities,
  getBackendAdapterFamilyCapabilities,
  getFieldDefinition,
} from '@/schema/schemaIndex.js'
import { useLocaleStore, type UiLanguage } from '@/stores/localeStore'
import { resolveDisabledReason } from '@/i18n/useI18n'
import schemaFieldOptionsEn from '@/i18n/schemaFieldOptionsEn.json'

/** 语言对文本:{zh,en} 二选一由当前 UI 语言决定。 */
interface Bilingual {
  zh: string
  en: string
}

const bi = (zh: string, en: string = zh): Bilingual => ({ zh, en })

function currentLanguage(): UiLanguage {
  return useLocaleStore.getState().language
}

function localized(value: Bilingual): string {
  return currentLanguage() === 'en' ? value.en : value.zh
}

export type AdapterCompatibility = 'available' | 'unsupported' | 'legacy'

export type AdapterCategoryKey = 'lora' | 'lycoris' | 'other'

/**
 * 三层信息架构（基础算法 → 可叠加增强 → 实体注入器）：
 * - base：原生 LoRA / LyCORIS 算法家族等基础参数化路线，经大类 Tab + 方法下拉选择；
 * - enhance：叠加在基础算法上的增强（rsLoRA/LoRA+ 优化器侧缩放、DoRA rider），
 *   不改变 ΔW 实体身份；
 * - entity：ADAPTER_ENTITY_PRIORITY 的硬互斥注入器（vera/tlora/flexrank/hydralora 等），
 *   同一线性层只能装一种。
 */
export type AdapterTier = 'base' | 'enhance' | 'entity'

export interface AdapterOption {
  id: string
  family: string
  tier: AdapterTier
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
  label_en?: string
  disabled?: boolean
  disabledReason?: string
  disabledReason_en?: string
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

// 实体注入器 family 集合 = ADAPTER_ENTITY_PRIORITY 的归一化 id。
const ENTITY_FAMILY_SET: ReadonlySet<string> = new Set(
  ADAPTER_ENTITY_PRIORITY.map((ent) => normalizeAdapterFamily(ent.id)),
)

const ENHANCE_FAMILIES: ReadonlySet<string> = new Set(['rs-lora', 'lora-plus'])

export function adapterTierForFamily(family: string): AdapterTier {
  if (ENTITY_FAMILY_SET.has(family)) return 'entity'
  if (ENHANCE_FAMILIES.has(family)) return 'enhance'
  return 'base'
}

/**
 * 类型专属限制显性化：这些约束来自后端硬校验（不是 UI 偏好），
 * 必须以提示文案呈现而不是静默隐藏可选卡。
 * 证据：flux_preflight.py:32-53（FLUX 非 networks.lora 直接 RuntimeError）；
 * minimax_h3/adapter_compat.py:14-34（MiniMax-H3 硬拒 LyCORIS 与 DoRA）；
 * anima_lora.py:529-537 + config_adapter.py:371-405（Anima lora_type 别名体系，
 * dora_wd 是其 Weight-Decomposed 别名，经叠加增强区统一入口）。
 */
const TYPE_ADAPTER_RESTRICTION_NOTICES: ReadonlyArray<{ match: RegExp; noticeKey: string }> = [
  { match: /^minimax-h3/, noticeKey: 'wizard.adapter.restrict.minimax_native_only' },
  { match: /^flux/, noticeKey: 'wizard.adapter.restrict.flux_native_lora' },
  { match: /^anima/, noticeKey: 'wizard.adapter.restrict.anima_alias_selector' },
]

export function adapterRestrictionNoticeKey(typeId: string): string | null {
  const id = String(typeId || '').trim().toLowerCase()
  for (const rule of TYPE_ADAPTER_RESTRICTION_NOTICES) {
    if (rule.match.test(id)) return rule.noticeKey
  }
  return null
}

const FAMILY_LABELS: Record<string, Bilingual> = {
  lora: bi('标准 LoRA', 'Standard LoRA'),
  'rs-lora': bi('rsLoRA'),
  'lora-plus': bi('LoRA+'),
  'lora-fa': bi('LoRA-FA'),
  vera: bi('VeRA'),
  tlora: bi('T-LoRA'),
  flexrank: bi('FlexRank'),
  fera: bi('FeRA'),
  hydralora: bi('HydraLoRA'),
  gdlokr: bi('GDLoKr'),
  reslora: bi('ResLoRA'),
  lora2: bi('LoRA2'),
  'lora2-adaptive': bi('LoRA2 Adaptive'),
  tensorring: bi('T-LoRA TensorRing'),
  dokr: bi('DoKr'),
  cdka: bi('CDKA'),
  krona: bi('KronA'),
  locon: bi('LoCon'),
  loha: bi('LoHa'),
  lokr: bi('LoKr'),
  glora: bi('GLoRA'),
  glokr: bi('GLoKr'),
  ia3: bi('IA3'),
  full: bi('LyCORIS Full'),
  'diag-oft': bi('Diag-OFT'),
}

const FAMILY_DESCRIPTIONS: Record<string, Bilingual> = {
  lora: bi('兼容性最好，适合大多数基础训练。', 'Best compatibility; fits most base training.'),
  'rs-lora': bi('对 rank 进行稳定化缩放。', 'Stabilized scaling of the rank.'),
  'lora-plus': bi('为 A/B 矩阵使用不同学习率倍率。', 'Different learning-rate multipliers for the A/B matrices.'),
  'lora-fa': bi('冻结部分低秩分量以降低显存占用。', 'Freezes part of the low-rank components to save VRAM.'),
  vera: bi('使用向量化参数化减少可训练参数。', 'Vectorized parameterization to reduce trainable parameters.'),
  tlora: bi('使用动态 rank 调度。', 'Dynamic rank scheduling.'),
  flexrank: bi('按训练过程动态激活 rank。', 'Activates ranks dynamically over training.'),
  fera: bi('使用 feature reparameterization。', 'Uses feature reparameterization.'),
  hydralora: bi('多分支 LoRA + 分支平衡损失。', 'Multi-branch LoRA with branch-balancing loss.'),
  gdlokr: bi('LoKr 与广义 DoRA 组合（独立架构）。', 'LoKr combined with generalized DoRA (standalone architecture).'),
  reslora: bi('跨层残差 shortcut。', 'Cross-layer residual shortcuts.'),
  lora2: bi('LoRA2 门控注入。', 'Gated LoRA2 injection.'),
  'lora2-adaptive': bi('指数衰减权重自动学习最优 rank。', 'Exponentially decayed weights learn the optimal rank automatically.'),
  tensorring: bi('Tensor-Ring 分解，单步 fused。', 'Tensor-Ring factorization, single-step fused.'),
  dokr: bi('DoRA 与 LoKr 组合（独立架构）。', 'DoRA combined with LoKr (standalone architecture).'),
  cdka: bi('Component-Designed Kronecker。', 'Component-Designed Kronecker adaptation.'),
  krona: bi('Kronecker 分解参数化。', 'Kronecker-factorized parameterization.'),
  locon: bi('为卷积层增加 LoRA 分支。', 'Adds LoRA branches to convolution layers.'),
  loha: bi('使用 Hadamard 乘积参数化。', 'Hadamard-product parameterization.'),
  lokr: bi('使用 Kronecker 分解参数化。', 'Kronecker-factorized parameterization.'),
  glora: bi('使用门控 LoRA 参数化。', 'Gated LoRA parameterization.'),
  glokr: bi('使用门控 Kronecker 分解。', 'Gated Kronecker factorization.'),
  ia3: bi('IA3 稀疏注入。', 'IA3 sparse injection.'),
  full: bi('全参数 LyCORIS 适配。', 'Full-parameter LyCORIS adaptation.'),
  'diag-oft': bi('对角 OFT 正交微调。', 'Diagonal OFT orthogonal finetuning.'),
}

/**
 * 后端 adapter_family_registry 是**确认信息**而不是准入门槛：注册表滞后于运行时
 * （实体注入器 vera/tlora/flexrank/hydralora/krona 等运行时全部支持却未登记），
 * 因此 schema 已暴露的字段不因注册表缺项而禁用，只落一条说明性提示。
 * 真禁用只来自 schema option 自带的 disabled:true（后端硬校验，如 FLUX 非
 * networks.lora）。
 */
const BACKEND_REGISTRY_UNLISTED_NOTE = bi(
  'Schema 已暴露此适配器；后端能力注册表未列出（运行版本通常仍支持）。',
  'Exposed by the type schema; missing from the backend capability registry (runtime usually still supports it).',
)
const SCHEMA_SUPPORTED_STRUCTURE_NOTICE = bi(
  '当前 schema 支持的适配器结构。',
  'Adapter structure supported by the current schema.',
)

/**
 * Identity 字段的 schema option 文案按语言解析（与 useI18n.resolveOptionLabel
 * 同一条 en 优先级：label_en → optionsEn pack → label），但**不做裸 value 兜底**
 * —— 返回 undefined 时由调用方回落 FAMILY_LABELS/family id。
 */
function identityOptionLabel(fieldKey: string, option: SchemaOption): string | undefined {
  if (currentLanguage() === 'en') {
    if (typeof option.label_en === 'string' && option.label_en.trim()) return option.label_en
    const packed = (schemaFieldOptionsEn as Record<string, string>)[`${fieldKey}|${option.value}`]
    if (typeof packed === 'string' && packed.trim()) return packed
  }
  return typeof option.label === 'string' && option.label.trim() ? option.label : undefined
}

// Default-LoRA variants that are not their own ΔW entity but still live on the
// default LoRALinear path. All DoRA aliases are cleared together with entity
// flags when switching away. DoRA itself is not offered as a method card: it is
// a weight-decomposition rider projected by doraToggleState() below.
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

// Default-LoRA variant flag cards (in display order). DoRA deliberately absent —
// it stacks on the chosen algorithm instead of competing with it.
const VARIANT_SPECS: FlagSpec[] = [
  { family: 'rs-lora', label: 'rsLoRA', key: 'rs_lora_enabled' },
  { family: 'lora-plus', label: 'LoRA+', key: 'lora_plus_enabled' },
]

// Alias toggles that mean "this family is on" but are not the master key the
// cards write.  dora_wd is the legacy network-args DoRA entry (the backend
// normalizer maps it onto dora_enabled/use_dora). The DoRA method card is gone,
// so these aliases are now claimed by the doraToggleState() rider instead.
const FAMILY_ALIAS_FLAG_KEYS: Record<string, string[]> = {
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
        label_en: typeof option.label_en === 'string' ? option.label_en : undefined,
        disabled: option.disabled === true,
        disabledReason: typeof option.disabledReason === 'string' ? option.disabledReason : undefined,
        disabledReason_en: typeof option.disabledReason_en === 'string' ? option.disabledReason_en : undefined,
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

// Resolve the effective family from the current config. Single shared
// implementation in schemaCommon (resolveAdapterFamily): derived from
// schemaCommon.resolveWinningAdapterEntity (winner id), never from a raw string
// comparison of lora_type. DoRA is a rider, not a family: a dora-enabled draft
// keeps resolving to its base algorithm so the algorithm card stays selected.
function winnerFamily(config: Record<string, unknown>): string {
  return resolveAdapterFamily(config)
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

/**
 * Build the values to write when a tier-2/3 toggle (rsLoRA/LoRA+/entity
 * injector) is switched off. Only meaningful while that option is the current
 * winner: identity fields fall back to the standard LoRA route so the mutex
 * winner resolves back to plain lora instead of lingering on the module.
 */
export function buildAdapterDeselection(typeId: string, option: AdapterOption): Record<string, unknown> {
  if (option.tier === 'base') return {}
  const fields = {
    lora_type: getFieldDefinition('lora_type', typeId) as FieldLike | undefined,
    adapter_type: getFieldDefinition('adapter_type', typeId) as FieldLike | undefined,
    network_module: getFieldDefinition('network_module', typeId) as FieldLike | undefined,
    lycoris_algo: getFieldDefinition('lycoris_algo', typeId) as FieldLike | undefined,
  }
  const values: Record<string, unknown> = {}
  for (const key of option.enables) values[key] = false
  for (const key of option.clears) values[key] = false
  Object.assign(values, defaultAdapterIdentityValues(fields, {}))
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
    let disabledReason: string | undefined = resolveDisabledReason(option, currentLanguage())
    let registryNote: string | undefined
    if (disabled) {
      // 唯一的真禁用来源：schema option 自带 disabled（后端硬校验）。
      compatibility = 'unsupported'
    } else if (backendPresent) {
      compatibility = 'available'
      if (!backendKeys.has(family)) {
        disabledReason = undefined
        registryNote = localized(BACKEND_REGISTRY_UNLISTED_NOTE)
      }
    } else {
      compatibility = mergedKeys.has(family) ? 'available' : 'legacy'
    }
    return {
      id: family,
      family,
      tier: adapterTierForFamily(family),
      label: identityOptionLabel(fieldKey, option) || (FAMILY_LABELS[family] && localized(FAMILY_LABELS[family])) || family,
      description: disabledReason || registryNote || (FAMILY_DESCRIPTIONS[family] && localized(FAMILY_DESCRIPTIONS[family])) || localized(SCHEMA_SUPPORTED_STRUCTURE_NOTICE),
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
    let registryNote: string | undefined
    if (backendPresent) {
      compatibility = 'available'
      if (!backendKeys.has(spec.family)) {
        registryNote = localized(BACKEND_REGISTRY_UNLISTED_NOTE)
      }
    } else {
      compatibility = mergedKeys.has(spec.family) ? 'available' : 'legacy'
    }
    return {
      id: spec.family,
      family: spec.family,
      tier: adapterTierForFamily(spec.family),
      label: spec.label || (FAMILY_LABELS[spec.family] && localized(FAMILY_LABELS[spec.family])) || spec.family,
      description: registryNote || (FAMILY_DESCRIPTIONS[spec.family] && localized(FAMILY_DESCRIPTIONS[spec.family])) || localized(SCHEMA_SUPPORTED_STRUCTURE_NOTICE),
      values: targetIdentityValues(spec.family, fields, config),
      compatibility,
      disabledReason: undefined,
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

// ── DoRA 权重分解叠加开关（不是算法卡片）─────────────────────────────────────
// DoRA 是叠加在原生 LoRA 路线上的权重分解增强。向导把它渲染成所选算法旁边的
// 开关；开启时写底层旗标而非改动算法身份字段。
export const DORA_RIDER_KEYS = ['dora_enabled', 'use_dora', 'dora_wd'] as const

export interface DoraToggleState {
  /** 类型 schema 至少定义了一个 DoRA 别名键，开关才渲染。 */
  available: boolean
  /** 当前基础算法是否接受 DoRA 叠加。 */
  supported: boolean
  enabled: boolean
  /**
   * 该类型的叠加结论是否已经过后端管线实证。false = pending：矩阵行沿用
   * 保守默认（仅原生 LoRA），提示文案不得写成绝对化结论。
   */
  audited: boolean
  /** 实际写入的主键（优先 dora_enabled；仅定义 dora_wd 的类型回退之）。 */
  masterKey: string | null
  /**
   * 本类型 schema 中定义的全部别名键，开关关闭时统一清零并从向导网格隐藏。
   * available:false 时恒为空数组 —— 不渲染的开关不托管任何键。
   */
  managedKeys: string[]
  /**
   * 家族级补充提示的 i18n 键（实证发现的家独特有边界，如 Anima 的 cache-first
   * TE 跳过 / packed 显存优化器拒绝 DoRA）。null = 无补充说明。
   */
  familyNoteI18nKey: string | null
}

// 已实证家族的家独有 DoRA 边界（与 schemaCommon DORA_SUPPORT_BY_MODEL_FAMILY
// 注释中的管线审计记录一一对应）。仅 supported 时展示。
const DORA_FAMILY_NOTE_I18N_KEYS: Record<string, string> = {
  anima: 'wizard.adapter.dora_toggle_family_anima',
  newbie: 'wizard.adapter.dora_toggle_family_newbie',
  // 第 4 站：flux 双路由（默认统一 LulynxTrainer / 显式 legacy FluxLoraTrainer）
  // 均只接受 networks.lora，TE 恒冻结 → DoRA 只落 DiT；dora_wd 是本类型唯一
  // master 键，经后端 ConfigAdapter 归一化驱动两条路由。
  flux: 'wizard.adapter.dora_toggle_family_flux',
  // 第 5 站：cache-first DiT 族共享同一条结构性边界（TE 目标列表为空 →
  // DoRA 仅落 DiT；深度扩层仅限全参微调；wan22 A14B 只挂主塔）。第 6 站桶 D 项起
  // zimage / wan22-TI2V(5B) / boogu-Base 已在 adapter 区补暴露单一 dora_enabled 键，
  // rider 正常渲染（managedKeys=['dora_enabled']）；krea2 / boogu-edit / flux2 /
  // wan22 A14B 暂仍无 DoRA 键不渲染，本提示供后续补暴露时复用。
  krea2: 'wizard.adapter.dora_toggle_family_cached_dit',
  zimage: 'wizard.adapter.dora_toggle_family_cached_dit',
  boogu: 'wizard.adapter.dora_toggle_family_cached_dit',
  flux2: 'wizard.adapter.dora_toggle_family_cached_dit',
  wan22: 'wizard.adapter.dora_toggle_family_cached_dit',
}

function doraFamilyNoteKey(typeId: string): string | null {
  return DORA_FAMILY_NOTE_I18N_KEYS[doraModelFamilyKey(typeId)] ?? null
}

function editableSchemaField(field: unknown): boolean {
  const item = field as { type?: string } | undefined
  return Boolean(item && item.type !== 'hidden' && item.type !== 'ui_group')
}

export function doraToggleState(config: Record<string, unknown>, typeId: string): DoraToggleState {
  const defined = DORA_RIDER_KEYS.filter((key) => Boolean(getFieldDefinition(key, typeId)))
  if (defined.length === 0) {
    return { available: false, supported: false, enabled: false, audited: false, masterKey: null, managedKeys: [], familyNoteI18nKey: null }
  }
  // 提交层消费的是顶层 use_dora/dora_enabled 路由旗标（dora_wd 由后端 normalizer
  // 映射成同一组旗标）；主键统一收敛到 dora_enabled。
  const masterKey = defined.find((key) => key !== 'use_dora') ?? null
  if (!masterKey) {
    // available:false 时 managedKeys 一并置空：开关不渲染，调用方不应再把任何键
    // 当作「rider 托管」去隐藏或清零——空 managed + 不可用才是无歧义组合。
    return { available: false, supported: false, enabled: false, audited: false, masterKey: null, managedKeys: [], familyNoteI18nKey: null }
  }
  const family = winnerFamily(config)
  const caps = getAdapterFamilyCapabilities()[family]
  const capabilityAllows = !(caps && typeof caps.supports_dora === 'boolean' && !caps.supports_dora)
  // 单一事实源 DORA_SUPPORT_BY_MODEL_FAMILY：按模型家族查可叠加 family。
  // 五站管线审计（sdxl/anima/newbie/flux/ltx23/ltx25/sd15/universal-dit/krea2/
  // zimage/boogu/flux2/wan22 + 隐藏类型）已全部转正，无 pending 行；audited:false
  // 仅剩未知 family 键的防御性回退（见 schemaCommon 注释）。
  const moduleField = getFieldDefinition('network_module', typeId)
  const moduleLycoris = editableSchemaField(moduleField)
    && String(config.network_module || '').trim().toLowerCase().includes('lycoris')
  const supported = capabilityAllows && !moduleLycoris && doraStackableFamiliesForType(typeId).includes(family)
  return {
    available: true,
    supported,
    enabled: doraEnabled(config),
    audited: doraSupportAuditedForType(typeId),
    masterKey,
    managedKeys: defined,
    familyNoteI18nKey: doraFamilyNoteKey(typeId),
  }
}
