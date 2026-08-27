// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 全参数透传审计（前端全字段 → buildRunConfig payload）：
 *   任务 1 —— sdxl-lora 每个 schema 字段（全部 section，含 expert/frontier；跳过
 *     type hidden / ui_group）取合法非默认探针值，断言键出现在 payload 顶层 ∪
 *     已知派生键 ∪ network_args / optimizer_args 行。
 *   任务 2/3 —— tools/.backend-config-vocab.json（genBackendVocab.py 真实 import
 *     core.configs.UnifiedTrainingConfig + config_adapter*.py 别名扫描）作为后端
 *     配置词表，交叉核验全部 40 个可见类型 buildRunConfig(createDefaultConfig)
 *     payload 顶层键 ∈ 词表 ∪ 白名单（防幻影出站）。
 *
 * 探测/豁免/emittedSomewhere 模式复用 adapterParamAudit.test.ts。
 * 三类显式豁免（消除误报，不是放松真检查）：
 * ── 选择键豁免 ──────────────────────────────────────────────────────────────
 * SELECTION_ACTIVATION 键经 builder 互斥表改名/物化（tlora_enabled→t_lora_enabled、
 * use_rslora→rs_lora_enabled 等，schemaCommon.normalizeAdapterEntityMutex），按
 * 激活键断言（同 adapterParamAudit 先例）。
 * ── 有意剥除（幻影）豁免 ───────────────────────────────────────────────────
 * STRIPPED_AS_PHANTOM：后端全仓零读者的死键，runConfigBuilder.PHANTOM_KEYS 提交层
 * 剥除（schema 层 hidden 保旧草稿回显）。断言反转：payload 不得包含该键（防剥除
 * 回归），证据见各键行内注释与 runConfigBuilder PHANTOM_KEYS。
 * ── 白名单 ─────────────────────────────────────────────────────────────────
 * builder 合法派生、但 UnifiedTrainingConfig 无对应字段的出站键，逐键一行依据。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TRAINING_TYPES,
  buildRunConfig,
  createDefaultConfig,
  getSectionsForType,
  isFieldVisible,
} from '@/schema/schemaIndex.js'
import { OPT_FIELD_ARG_KEYS } from '@/schema/features/optimizerParams.js'

interface SchemaField {
  key: string
  type: string
  defaultValue?: unknown
  options?: Array<string | { value: string; disabled?: boolean }>
  min?: number
  max?: number
  step?: number
  visibleWhen?: (config: Record<string, unknown>) => boolean
  requiresAttentionBackend?: string
}
type Payload = Record<string, unknown>

const vocabPath = join(dirname(fileURLToPath(import.meta.url)), '../../tools/.backend-config-vocab.json')
const vocab = JSON.parse(readFileSync(vocabPath, 'utf8')) as {
  canonical_keys: string[]
  adapter_alias_keys: string[]
}
const VOCAB_KEYS = new Set([...vocab.canonical_keys, ...vocab.adapter_alias_keys])

const TYPE_ID = 'sdxl-lora'

// ── 任务 1 支撑：派生键 / network_args 别名行 ────────────────────────────────
// builder 落地形态与 schema 键不同名的映射（runConfigBuilder 各 normalize* 实证）。
const DERIVED_PAYLOAD_KEYS: Record<string, string[]> = {
  conv_dim: ['lycoris_conv_dim'],
  conv_alpha: ['lycoris_conv_alpha'],
  dropout: ['network_dropout'],
  rank_dropout: ['lokr_rank_dropout'],
  module_dropout: ['lokr_module_dropout'],
  train_norm: ['lycoris_train_norm'],
  lokr_factor: ['lycoris_lokr_factor'],
  decompose_both: ['lokr_decompose_both'],
  full_matrix: ['lokr_full_matrix'],
  unbalanced_factorization: ['lokr_unbalanced_factorization'],
  tlora_enabled: ['t_lora_enabled'],
  use_rslora: ['rs_lora_enabled'],
  ui_custom_params: ['custom_toml'],
  enable_block_weights: ['bw_enable'],
  lulynx_down_lr_weight: ['down_lr_weight'],
  lulynx_mid_lr_weight: ['mid_lr_weight'],
  lulynx_up_lr_weight: ['up_lr_weight'],
  lulynx_block_lr_zero_threshold: ['block_lr_zero_threshold'],
  svd_grad_proj_enabled: ['lulynx_svd_gradient_filter_enabled'],
  svd_grad_proj_rank: ['lulynx_svd_gradient_filter_rank'],
  svd_grad_proj_update_interval: ['lulynx_svd_gradient_filter_update_interval'],
  svd_grad_proj_scale: ['lulynx_svd_gradient_filter_scale'],
  svd_grad_proj_warmup_steps: ['lulynx_svd_gradient_filter_warmup_steps'],
  svd_grad_proj_target: ['lulynx_svd_gradient_filter_target'],
}
// network_args / optimizer_args 的 key=value 行别名（normalizeLycorisNetworkArgs /
// normalizeOptimizerArgs OPT_FIELD_ARG_KEYS 展开）。
const NETWORK_ARG_ALIASES: Record<string, string[]> = {
  lycoris_preset: ['preset'],
  lokr_factor: ['factor'],
  prodigy_d0: ['d0'],
  prodigy_d_coef: ['d_coef'],
  network_args_custom: ['zz-probe'],
  optimizer_args_custom: ['zz-probe'],
}
for (const [fieldKey, argName] of Object.entries(OPT_FIELD_ARG_KEYS)) {
  NETWORK_ARG_ALIASES[fieldKey] = [argName]
}

/**
 * 选择键 → builder 发出的真实激活键（schemaCommon.normalizeAdapterEntityMutex /
 * moduleEntities 实体表，同 adapterParamAudit.SELECTION_ACTIVATION）。
 */
const SELECTION_ACTIVATION: Record<string, string> = {
  use_dora: 'use_dora',
  dora_enabled: 'dora_enabled',
  use_rslora: 'rs_lora_enabled',
  rs_lora_enabled: 'rs_lora_enabled',
  lora_fa_enabled: 'lora_fa_enabled',
  tlora_enabled: 't_lora_enabled',
  flexrank_lora_enabled: 'flexrank_lora_enabled',
  vera_enabled: 'vera_enabled',
  hydralora_enabled: 'hydralora_enabled',
  fera_enabled: 'fera_enabled',
  reslora_enabled: 'reslora_enabled',
  lora2_enabled: 'lora2_enabled',
  gdlokr_enabled: 'gdlokr_enabled',
  lora2_adaptive_enabled: 'lora2_adaptive_enabled',
  tensorring_lora_enabled: 'tensorring_lora_enabled',
  dokr_enabled: 'dokr_enabled',
  cdka_enabled: 'cdka_enabled',
  krona_enabled: 'krona_enabled',
}

/**
 * 幻影键豁免（后端全仓零读者，builder 剥除）：断言反转 —— payload 不得出现。
 * 逐键证据（rg 全仓 = 仅 configs_* 声明行，零消费者）：
 *   - ac_early_stopping_threshold / ac_te_freeze_step / ac_auto_lr_scale_factor /
 *     ac_target_loss：configs_monitoring.py:459-474 声明后零读者；
 *     AutoController 实际消费集合见 trainer_execution_resume_callbacks.py:66-123
 *     （schemaFrontierGroups.js:733-735 同源注释）。
 *   - compile_cache_prewarm / torch_compile_first_step_timeout：第 3 站桶审计，
 *     全仓零读者（runConfigBuilder.js PHANTOM_KEYS 注释）。
 *   - lora2_adaptive_rank_threshold：configs_training_methods.py:303 声明后零读者。
 *   - ed_lora_fusion_alpha / dora_init_scale / dora_use_scalar_magnitude /
 *     dora_normalize_magnitude：第 3 站桶审计，全仓零读者。
 *   - lulynx_experimental_core_enabled：UI 集中管理总开关，builder removeUiOnlyFields
 *     有意剥除；真实能力由子旗标（lulynx_resource_manager_enabled 等后端别名键）承载。
 *   - opt_adamw_bf16_note：UI 提示字段（optimizerParams.js:108-112「无额外 knobs，
 *     仅提示」），非训练参数；opt_* 尾部剥除，后端零读者。
 */
const STRIPPED_AS_PHANTOM = new Set([
  'ac_early_stopping_threshold',
  'ac_te_freeze_step',
  'ac_auto_lr_scale_factor',
  'ac_target_loss',
  'compile_cache_prewarm',
  'torch_compile_first_step_timeout',
  'lora2_adaptive_rank_threshold',
  'ed_lora_fusion_alpha',
  'dora_init_scale',
  'dora_use_scalar_magnitude',
  'dora_normalize_magnitude',
  'lulynx_experimental_core_enabled',
  'opt_adamw_bf16_note',
])

// ── UI-only 门控键豁免（断言效果承载键，而非键本身）──────────────────────────
// 后端零读者、但语义由 builder/后端从其它键承载的 UI 门控：
//   - enable_base_weight：后端无此键（rg 全仓零读者）；差异炼丹由 base_weight_path
//     非空激活（base_lora_weights.py:29，config_adapter_main_feature_fields.py:238
//     把 base_weights 改名 base_weight_path）。断言 base_weights 出站。
//   - train_length_mode：UI 轮数/步数二选一选择器（bucket3ParamAudit 先例），效果
//     由 max_train_epochs / max_train_steps 出站承载（builder 剥除选择器本身）。
const UI_ONLY_GATE_KEYS: Record<string, string[]> = {
  enable_base_weight: ['base_weights'],
  train_length_mode: ['max_train_epochs', 'max_train_steps'],
}

// ── 本类型不可达字段（共享组的死重量，跳过探针）──────────────────────────────
//   - gdlokr_*：gate 读 gdlokr_enabled / lora_type / adapter_type，三者均非本类型
//     schema 字段（getAdapterTypeKey 读不到 → 永久隐藏）；本类型无 gdlokr 家族卡
//     （adapterParamAudit.SELECTION_PRESENCE_ONLY 同源事实）。
//   - torch_compile / thunder_jit_enabled：legacy 执行后端字段，visibleWhen 恒 false
//     （schemaFieldGroups LEGACY_BACKEND_FIELD_HIDDEN，sdxl 已摘 legacy execution_backend）。
//   - lulynx_steady_accel：supportsSteadyAccel 只认 anima|newbie（schemaFrontierGroups:921），
//     sdxl-lora 设计性不可达（desc 明示 Anima/Newbie 专用）。
const UNREACHABLE_IN_TYPE = new Set([
  'gdlokr_factor',
  'gdlokr_mode',
  'gdlokr_alpha',
  'torch_compile',
  'thunder_jit_enabled',
  'lulynx_steady_accel',
])

// ── 任务 3 白名单：词表外出站键（逐键一行依据）───────────────────────────────
// 分组依据：这些类型的 payload 不进 UnifiedTrainingConfig，或为 UI-only 旗标。
const WHITELIST: Record<string, string> = {
  // recipe 契约键：后端从顶层 cfg dict 读入 TrainingRecipe（contracts/
  // training_recipe.py:99-101/115-125 from_raw 的 source；resolver:172 消费），
  // 不在 UnifiedTrainingConfig pydantic 声明内，属跨合同消费。
  target_modules: 'recipe 契约键：training_recipe.py:118 _string_list 从顶层读数组',
  rank_strategy: 'recipe 契约键：training_recipe.py:115-117 + module_group_registry.py:328 硬校验（uniform/module_group/module/auto_static/dynamic）',
  // builder 镜像键：后端 preflight 守卫读原始 payload dict（training_config_checks.py:194、
  // lulynx_route_contract/contract.py:120），UnifiedTrainingConfig 无此字段。
  sdxl_fixed_block_swap: 'builder 镜像键：后端守卫读原始 payload（training_config_checks.py:194 / contract.py:120）',
  // UI-only 专家模式旗标：前端 isFieldVisible/getAvailableTabs 消费；后端
  // UnifiedTrainingConfig extra=ignore 丢弃（rg 全仓零读者），非训练键。
  performance_expert_mode: 'UI-only 专家模式旗标：前端消费（schemaIndex.getAvailableTabs），后端 extra=ignore 丢弃',
  // launcher 路由层读原始 cfg（launcher/api/services/training_route_service.py:198-199）
  // 决定是否注入预览采样参数；不进 UnifiedTrainingConfig。
  enable_preview: 'launcher 路由层读者：training_route_service.py:199 if "enable_preview" in cfg',
  // aesthetic-scorer：后端 schema 为 placeholder（launcher/api/domain/schemas/
  // peripheral_schemas.py:201-205 "not yet implemented"），字段面为前瞻规格。
  annotations: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205），训练核心未实现',
  cls_loss_weight: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  hidden_dims: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  include_waifu_score: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  jtp3_model_id: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  loss: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  target_dims: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  waifu_clip_model_name: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
  waifu_clip_pretrained: 'aesthetic-scorer 前瞻规格：后端为 placeholder（peripheral_schemas.py:201-205）',
}

// ── 字段枚举与探针值 ────────────────────────────────────────────────────────
function sectionsOf(typeId: string): Array<{ id: string; fields: SchemaField[] }> {
  return getSectionsForType(typeId) as unknown as Array<{ id: string; fields: SchemaField[] }>
}
function uniqueFieldsOf(typeId: string): SchemaField[] {
  const map = new Map<string, SchemaField>()
  for (const section of sectionsOf(typeId)) {
    for (const field of section.fields || []) if (!map.has(field.key)) map.set(field.key, field)
  }
  return [...map.values()]
}

const LIST_TEXTAREA_PROBES: Record<string, string> = {
  base_weights_multiplier: '2',
  network_args_custom: 'zz-probe=1',
  optimizer_args_custom: 'zz-probe=1',
  lr_scheduler_args: 'zz-probe=1',
}

// options 可以是 (config) => options 的惰性函数（FieldControl.tsx:46 同一约定）。
function resolveOptions(field: SchemaField): Array<{ value: string; disabled?: boolean }> {
  const raw = typeof field.options === 'function'
    ? (field.options as (config: Payload) => unknown)(BASE_CTX)
    : field.options
  if (!Array.isArray(raw)) return []
  return raw.map((option) => (typeof option === 'object' ? option : { value: String(option) }))
}

function probeOf(field: SchemaField): { value: unknown; form: string } | null {
  if (field.type === 'boolean') return { value: field.defaultValue !== true, form: 'boolean 取反' }
  if (field.type === 'number' || field.type === 'slider') {
    const def = typeof field.defaultValue === 'number' ? field.defaultValue : Number(field.defaultValue) || 0
    const step = field.step && field.step > 0 ? field.step : 1
    let value = def + step
    if (field.max != null && value > field.max) value = def - step
    if (field.min != null && value < field.min) value = field.min + step
    if (value === def) return null
    return { value, form: `number ${def}±step(${step})` }
  }
  if (field.type === 'select') {
    const pick = resolveOptions(field).find((option) => !option.disabled && option.value !== field.defaultValue)
    if (!pick) return null
    return { value: pick.value, form: `select 非默认项(${pick.value})` }
  }
  if (field.type === 'multiSelect') return { value: ['zz-probe'], form: 'multiSelect 探针' }
  return { value: LIST_TEXTAREA_PROBES[field.key] ?? 'zz-probe', form: 'string 探针 zz-probe' }
}

// ── visibleWhen 求解：按需点亮前置 ──────────────────────────────────────────
function candidateAssignments(fields: SchemaField[]): Array<{ key: string; value: unknown }> {
  const out: Array<{ key: string; value: unknown }> = []
  const seen = new Set<string>()
  const push = (key: string, value: unknown) => {
    const id = `${key}=${String(value)}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ key, value })
  }
  push('performance_expert_mode', true)
  for (const field of fields) {
    if (field.type === 'boolean') push(field.key, true)
    if (field.type === 'select') {
      for (const option of resolveOptions(field)) {
        if (option.value) push(field.key, option.value)
      }
    }
  }
  return out
}

const SDXL_FIELDS = uniqueFieldsOf(TYPE_ID)
const SDXL_SECTIONS = sectionsOf(TYPE_ID)
const BASE_CTX: Payload = { ...(createDefaultConfig(TYPE_ID) as Payload), performance_expert_mode: true }
const ASSIGNMENTS = candidateAssignments(SDXL_FIELDS)

function fieldVisible(field: SchemaField, config: Payload): boolean {
  return isFieldVisible(field as never, config as never)
}

function contextWith(base: Payload, picks: Array<{ key: string; value: unknown }>): Payload {
  const ctx = { ...base }
  for (const pick of picks) ctx[pick.key] = pick.value
  return ctx
}

// 门控键侦测：Proxy get 陷阱记录 gate 实际读取的 config 键，把组合搜索限制在
// 真正被读取的键上（每条 gate 通常只读 1–3 个键）。
function keysReadByGate(gate: (config: Payload) => boolean, base: Payload): Set<string> {
  const reads = new Set<string>()
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') reads.add(prop)
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      if (typeof prop === 'string') reads.add(prop)
      return Reflect.has(target, prop)
    },
  })
  gate(proxy)
  return reads
}

function combinations<T>(items: T[], depth: number): T[][] {
  const out: T[][] = []
  const pick = (start: number, current: T[]) => {
    if (current.length === depth) { out.push([...current]); return }
    for (let i = start; i < items.length; i++) {
      current.push(items[i])
      pick(i + 1, current)
      current.pop()
    }
  }
  pick(0, [])
  return out
}

const CTX_MEMO = new Map<SchemaField['visibleWhen'], Payload | null>()
// 每 gate 参与组合搜索的候选上限（确定性顺序），防不可解 gate 的组合爆炸。
const RELEVANT_CAP = 28
// 为「被 gate 读取、但自身不是 select/boolean」的键合成候选值（number 门限值等）。
function ensureAssignmentsFor(keys: Set<string>): void {
  for (const key of keys) {
    if (ASSIGNMENTS.some((pick) => pick.key === key)) continue
    const field = SDXL_FIELDS.find((candidate) => candidate.key === key)
    if (!field) continue
    if (field.type === 'multiSelect') {
      for (const option of resolveOptions(field)) ASSIGNMENTS.push({ key, value: [option.value] })
      continue
    }
    if (field.type === 'boolean') {
      ASSIGNMENTS.push({ key, value: true })
      continue
    }
    if (field.type === 'select') {
      for (const option of resolveOptions(field)) if (option.value) ASSIGNMENTS.push({ key, value: option.value })
      continue
    }
    const def = typeof field.defaultValue === 'number' ? field.defaultValue : Number(field.defaultValue) || 0
    const step = field.step && field.step > 0 ? field.step : 1
    for (const value of [def + step, 2, 4, 8]) {
      if (field.max == null || value <= field.max) ASSIGNMENTS.push({ key, value })
    }
    ASSIGNMENTS.push({ key, value: 'zz-probe' })
  }
}
// 累积分支侦测：把已知键的候选值做 ≤2 键组合，逐节点记录 gate 读取的键，
// 覆盖「按值分派后才读取后续键」的多级链（module→algo→flag→子键）。
function discoverReads(gate: (config: Payload) => boolean, keys: Set<string>): Set<string> {
  ensureAssignmentsFor(keys)
  const relevant = ASSIGNMENTS.filter((pick) => keys.has(pick.key)).slice(0, RELEVANT_CAP)
  const reads = new Set(keys)
  const maxDepth = Math.min(3, relevant.length)
  for (let depth = 1; depth <= maxDepth; depth++) {
    for (const combo of combinations(relevant, depth)) {
      for (const read of keysReadByGate(gate, contextWith(BASE_CTX, combo))) reads.add(read)
    }
  }
  return reads
}
function searchGateSolution(gate: (config: Payload) => boolean): Payload | null {
  let keys = keysReadByGate(gate, BASE_CTX)
  for (let expansion = 0; expansion < 4; expansion++) {
    ensureAssignmentsFor(keys)
    const relevant = ASSIGNMENTS.filter((pick) => keys.has(pick.key))
    // depth1 全量扫（isOpt 类单键 gate 的选项表可达百项，代价线性）；
    // depth2/3 组合才套 RELEVANT_CAP 防组合爆炸。
    for (const pick of relevant) {
      const ctx = contextWith(BASE_CTX, [pick])
      if (gate(ctx)) return ctx
    }
    const capped = relevant.slice(0, RELEVANT_CAP)
    const maxDepth = Math.min(4, capped.length)
    for (let depth = 2; depth <= maxDepth; depth++) {
      for (const combo of combinations(capped, depth)) {
        const ctx = contextWith(BASE_CTX, combo)
        if (gate(ctx)) return ctx
      }
    }
    // 未解：累积侦测分支键（不能只按单键探——同一 key 的不同取值打开不同分支）。
    const expanded = discoverReads(gate, keys)
    if (expanded.size === keys.size) break
    keys = expanded
  }
  return null
}

function solveVisibleContext(field: SchemaField): Payload | null {
  const gate = field.visibleWhen
  let ctx: Payload | null
  if (!gate) {
    ctx = BASE_CTX
  } else {
    if (CTX_MEMO.has(gate)) ctx = CTX_MEMO.get(gate) ?? null
    else {
      ctx = searchGateSolution(gate)
      CTX_MEMO.set(gate, ctx)
    }
  }
  if (!ctx) return null
  // requiresAttentionBackend 是 visibleWhen 之外的硬前置（schemaIndex.isFieldVisible）。
  if (field.requiresAttentionBackend) ctx = { ...ctx, attention_backend: field.requiresAttentionBackend }
  return ctx
}

function emittedSomewhere(payload: Payload, key: string): boolean {
  if (key in payload) return true
  for (const derived of DERIVED_PAYLOAD_KEYS[key] || []) {
    if (derived in payload) return true
  }
  for (const container of ['network_args', 'optimizer_args']) {
    const args = payload[container]
    if (!Array.isArray(args)) continue
    const names = [key, ...(NETWORK_ARG_ALIASES[key] || [])]
    if (args.some((line) => typeof line === 'string' && names.some((name) => line.startsWith(`${name}=`)))) return true
  }
  return false
}

interface MatrixGap {
  key: string
  section: string
  check: 'probe' | 'visible' | 'payload'
  problem: string
}

// ── 任务 1：sdxl-lora 全字段非默认透传矩阵 ───────────────────────────────────
describe('sdxl-lora every schema field passes a non-default probe into the payload', () => {
  const gaps: MatrixGap[] = []
  const matrix: string[] = []
  let probed = 0
  let improbable = 0

  const sectionOfKey = new Map<string, string>()
  for (const section of SDXL_SECTIONS) for (const field of section.fields || []) if (!sectionOfKey.has(field.key)) sectionOfKey.set(field.key, section.id)

  for (const field of SDXL_FIELDS) {
    const section = sectionOfKey.get(field.key) || '?'
    if (field.type === 'hidden' || field.type === 'ui_group' || field.type === 'action') continue
    if (UNREACHABLE_IN_TYPE.has(field.key)) {
      matrix.push(`${field.key}: unreachable in ${TYPE_ID} (shared-group dead weight, see UNREACHABLE_IN_TYPE)`)
      improbable += 1
      continue
    }
    const probe = probeOf(field)
    if (!probe) {
      improbable += 1
      matrix.push(`${field.key}: skipped (no legal non-default value)`)
      continue
    }
    probed += 1
    // 幻影键断言反转：builder 必须剥除（缺失=剥除回归）。
    if (STRIPPED_AS_PHANTOM.has(field.key)) {
      const ctx = solveVisibleContext(field) || BASE_CTX
      const payload = buildRunConfig({ ...ctx, [field.key]: probe.value } as Payload, TYPE_ID) as Payload
      if (field.key in payload) gaps.push({ key: field.key, section, check: 'payload', problem: 'phantom key reached payload (builder strip regressed)' })
      matrix.push(`${field.key}: phantom-stripped as designed`)
      continue
    }
    const ctx = solveVisibleContext(field)
    if (!ctx) {
      gaps.push({ key: field.key, section, check: 'visible', problem: 'no context lights visibleWhen (solver exhausted)' })
      continue
    }
    // UI-only 门控键：探针连同效果承载键一起点亮，断言承载键出站。
    const carriers = UI_ONLY_GATE_KEYS[field.key]
    if (carriers) {
      const probeConfig = { ...ctx, [field.key]: probe.value }
      if (field.key === 'enable_base_weight') probeConfig.base_weights = 'zz-probe'
      const payload = buildRunConfig(probeConfig as Payload, TYPE_ID) as Payload
      const carried = carriers.some((carrier) => carrier in payload)
      if (!carried) gaps.push({ key: field.key, section, check: 'payload', problem: `UI-only gate: none of effect carriers ${carriers.join('|')} emitted` })
      matrix.push(`${field.key}: UI-only gate, carrier ${carriers.join('|')} ${carried ? 'emitted' : 'MISSING'}`)
      continue
    }
    const probeConfig = { ...ctx, [field.key]: probe.value }
    if (!fieldVisible(field, probeConfig)) {
      gaps.push({ key: field.key, section, check: 'visible', problem: `visibleWhen false on solved context (probe=${String(probe.value)})` })
      continue
    }
    const payload = buildRunConfig(probeConfig as Payload, TYPE_ID) as Payload
    const activation = SELECTION_ACTIVATION[field.key]
    const ok = activation ? activation in payload : emittedSomewhere(payload, field.key)
    if (!ok) {
      gaps.push({
        key: field.key,
        section,
        check: 'payload',
        problem: `expected ${probe.form} to emit key "${field.key}" (top-level / derived ${(DERIVED_PAYLOAD_KEYS[field.key] || []).join('|') || '—'} / args line), payload keys: ${Object.keys(payload).length}`,
      })
    }
  }

  it('every non-hidden sdxl-lora field reaches the payload (or its builder-renamed form)', () => {
    if (gaps.length) console.error('PASSTHROUGH-GAPS:', JSON.stringify(gaps, null, 1))
    expect(gaps).toEqual([])
  })

  it('audits every schema field with a probe or an explicit skip', () => {
    const audited = probed + improbable
    console.info(matrix.join('\n'))
    expect(audited).toBe(SDXL_FIELDS.filter((field) => field.type !== 'hidden' && field.type !== 'ui_group' && field.type !== 'action').length)
  })

  it('sdxl-lora has the full section surface (42 sections incl. derived profile/universal-dit)', () => {
    expect(SDXL_SECTIONS.length).toBeGreaterThanOrEqual(39)
  })

  it('phantom keys stay stripped from the payload', () => {
    const payload = buildRunConfig(createDefaultConfig(TYPE_ID) as Payload, TYPE_ID) as Payload
    const leaked = [...STRIPPED_AS_PHANTOM].filter((key) => key in payload)
    expect(leaked).toEqual([])
  })
})

// ── 任务 3：全 40 可见类型 payload 词表交叉（防幻影出站）────────────────────
describe('every visible type emits only backend-known payload keys', () => {
  it('buildRunConfig(default) top-level keys ∈ backend vocab ∪ whitelist', () => {
    const unknown: Array<{ type: string; key: string; value: unknown }> = []
    for (const type of TRAINING_TYPES) {
      const payload = buildRunConfig(createDefaultConfig(type.id) as Payload, type.id) as Payload
      for (const [key, value] of Object.entries(payload)) {
        if (VOCAB_KEYS.has(key) || key in WHITELIST) continue
        unknown.push({ type: type.id, key, value })
      }
    }
    if (unknown.length) console.error('PHANTOM-OUTBOUND:', JSON.stringify(unknown, null, 1))
    expect(unknown).toEqual([])
  })

  it('sdxl-lora non-default probes stay inside the backend vocab ∪ whitelist', () => {
    const unknown: Array<{ key: string; emitted: string }> = []
    const probedKeys = new Set<string>()
    for (const field of SDXL_FIELDS) {
      if (field.type === 'hidden' || field.type === 'ui_group' || field.type === 'action') continue
      if (UNREACHABLE_IN_TYPE.has(field.key) || STRIPPED_AS_PHANTOM.has(field.key)) continue
      const probe = probeOf(field)
      if (!probe) continue
      const ctx = solveVisibleContext(field)
      if (!ctx) continue
      const probeConfig = { ...ctx, [field.key]: probe.value }
      if (field.key === 'enable_base_weight') probeConfig.base_weights = 'zz-probe'
      const payload = buildRunConfig(probeConfig as Payload, TYPE_ID) as Payload
      for (const key of Object.keys(payload)) {
        if (probedKeys.has(key)) continue
        probedKeys.add(key)
        if (!VOCAB_KEYS.has(key) && !(key in WHITELIST)) unknown.push({ key: field.key, emitted: key })
      }
    }
    if (unknown.length) console.error('PROBE-PHANTOM-OUTBOUND:', JSON.stringify(unknown, null, 1))
    expect(unknown).toEqual([])
  })

  it('covers all visible training types', () => {
    expect(TRAINING_TYPES.length).toBe(40)
  })
})
