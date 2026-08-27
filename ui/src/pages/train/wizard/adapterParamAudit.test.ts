// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 全算法参数显示审计：以后端能力注册表（contracts/adapter_family_registry，25 家族，
 * family_fields 从注入器签名实证提取）为权威清单，核验每个算法被选中后：
 *   1. schema 字段存在；2. 全页 visibleWhen 点亮；3. 向导适配器步骤可见；4. payload 透传。
 * 快照 tools/.backend-adapter-specs.json 由后端 adapter_family_capabilities() 导出。
 *
 * 多类型扩展：主审计循环按 TYPE_IDS 参数化（每类型跑通后进入白名单；类型→选择构造
 * 差异见 bareSelectionFor；排除类型必须在 EXCLUDED_TYPES 登记一行原因，由 meta 测试
 * 强制「注册表内每个训练类型要么被审计、要么有书面排除理由」）。
 *
 * 两类有意豁免（消除误报，不是放松真检查）：
 * ── 选择键豁免 ───────────────────────────────────────────────────────────────
 * family_fields 里的家族激活旗标/别名（use_dora、*_enabled 等）是「选择器」：
 * 用户通过向导家族卡（adapterModel）或全页实体开关做选择，不是选中后可调的参数。
 * 对它们跳过存在/可见/向导三项检查，改为激活断言：bareSelection 构建 payload 后
 * 断言 builder 发出的真实激活键。激活键以提交层实证为准（非注册表键名）：
 *   - tlora：注册表写 tlora_enabled，前端实名 t_lora_enabled
 *     （schemaCommon.js:822 实体表 / :968 lora_type 物化 / moduleEntities 路由）；
 *   - rs-lora：use_rslora 是选择别名，collectVisiblePayload 按 schema 收集会丢弃它，
 *     builder 真实发出的激活键是 rs_lora_enabled（schemaFieldGroups 实体旗标）；
 *   - lora-fa：network_module=networks.lora_fa → 实体 lora_fa（schemaCommon.js:883）
 *     发出 lora_fa_enabled；
 *   - lora2 / gdlokr：本类型 schema 无 enabled 字段、也无 network_module/lora_type
 *     路由可把旗标置真——提交层实体互斥表（normalizeAdapterEntityMutex）只会把键
 *     写出为 false。降级断言「键出现在 payload」（互斥表统一写出，缺失即回归），
 *     在 SELECTION_PRESENCE_ONLY 中显式登记。
 * ── 有意不暴露清单（hidden/phantom/注册表虚键）─────────────────────────────
 * type==='hidden' 的字段只保旧草稿回显，不是 UI 旋钮，跳过可见/向导/payload 检查：
 *   - dora_wd：sdxl 有意 hideDoraWd（sdxlSchema.js，主入口收敛为
 *     S_LORA_VARIANTS.dora_enabled；顶层 dora_wd 实际有消费者——config_adapter.py
 *     :511-517 归一为 use_dora+dora_enabled+dora_mode='wd'，仅 network_args 嵌入路
 *     零接收者）。wd 变体经 builder 互斥变换承载，不单独出旋钮。
 *   - lora2_adaptive_rank_threshold：configs_training_methods.py:303 声明后全仓零
 *     读者，前端 PHANTOM_KEYS（runConfigBuilder.js）提交层剥除。
 * 注册表虚键（后端注册表清理待办，非用户键）：
 *   - tlora_total_steps：无后端 config 字段，注入器值由 trainer_prepare 以
 *     max_train_steps 派生（max(x,1000) 兜底）——UI 键无处落地。
 * ── common_fields 发散登记（本审计发现，报告主会话跟进，不在前端擅修）───────
 *   - target_modules：后端 TrainingRecipe 真实消费（training_recipe.py:99/118 +
 *     adapter_config_contract.py:44-45），sdxl-lora UI 只剩间接 network_args_custom，
 *     无一等键——COMMON_FIELD_DIVERGENCES 登记。
 *   - rank_strategy：后端 flat 键真实消费（training_recipe.py:100/115-117 +
 *     training_recipe_resolver.py:172，合法集 uniform/module_group/module/
 *     auto_static/dynamic），前端全仓零键，恒走后端默认 uniform——同上登记。
 *   - network_dropout：schema/可见齐全，仅提交层把 0 值剥除（runConfigBuilder.js:115
 *     视为后端默认的 no-op 省略）——COMMON_FIELD_DEFAULT_OMISSIONS 登记并以非零探针
 *     断言出站。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRunConfig,
  createDefaultConfig,
  getSectionsForType,
  ALL_TRAINING_TYPES,
} from '@/schema/schemaIndex.js'
import { buildWizardProjection } from './wizardModel'

interface FamilySpec {
  family: string
  network_module: string
  lycoris_algo: string
  common_fields: string[]
  family_fields: string[]
}

const specPath = join(dirname(fileURLToPath(import.meta.url)), '../../../../tools/.backend-adapter-specs.json')
const specs = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, FamilySpec>

const TYPE_ID = 'sdxl-lora'

interface SchemaField {
  type: string
  visibleWhen?: (c: Record<string, unknown>) => boolean
  defaultValue: unknown
  options?: unknown
}

const _fieldIndexCache = new Map<string, Map<string, SchemaField>>()
function fieldIndexOf(typeId: string): Map<string, SchemaField> {
  let map = _fieldIndexCache.get(typeId)
  if (!map) {
    map = new Map()
    for (const section of getSectionsForType(typeId)) {
      for (const field of section.fields || []) map.set(field.key, field as SchemaField)
    }
    _fieldIndexCache.set(typeId, map)
  }
  return map
}

/**
 * 选择键 → builder 发出的真实激活键。依据见文件头注释与 schemaCommon.js
 * ADAPTER_ENTITY_PRIORITY / moduleEntities 实体表。与类型无关：激活键是提交层事实。
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

/** 注册表虚键：后端无 config 字段/派生量，不是用户键，全部检查豁免（清理待办见头注）。 */
const REGISTRY_GHOST_KEYS = new Set(['tlora_total_steps'])

/** 无法经 UI 路由置真的激活键：只断言互斥表把键写出（出现在 payload）。 */
const SELECTION_PRESENCE_ONLY = new Set(['gdlokr_enabled'])

// ── 多类型选择构造 ─────────────────────────────────────────────────────────────
// 三类路由（见 adapterModel.resolveAdapterFamily / buildAdapterSelection 与
// schemaCommon.resolveWinningAdapterEntity 的归一语义）：
//   - module 路由（sdxl/sd/flux…）：network_module 卡（lycoris 族再经 lycoris_algo 子下拉）；
//   - dropdown 路由（anima/newbie）：lora_type / adapter_type 下拉直选 family；
//   - flag 路由：类型 schema 里可编辑的 *_enabled 实体旗标（向导实体卡同源）。

const LYCORIS_FAMILY_SET = new Set(['locon', 'loha', 'lokr', 'glora', 'glokr', 'diag-oft', 'ia3', 'full'])

/** family → identity 下拉 option 值（anima lora_type / newbie adapter_type 的取值空间）。 */
const FAMILY_DROPDOWN_OPTION: Record<string, string> = {
  'lora-fa': 'lora_fa',
  vera: 'vera',
  tlora: 'tlora',
  flexrank: 'flexrank',
  fera: 'fera',
  gdlokr: 'gdlokr',
  'rs-lora': 'rs_lora',
}

/** 无路由家族的盲置白名单：互斥表按 enabled_flag 赢家仍会写出真值（sdxl gdlokr 先例）。 */
const BLIND_FLAG_ALLOWED = new Set(['gdlokr_enabled'])

/** 类型 schema 下拉里「可选」的 option 值（剔除 disabled 项与空值）。 */
function enabledSelectOptions(typeId: string, key: string): string[] {
  const field = fieldIndexOf(typeId).get(key)
  if (!field || field.type !== 'select') return []
  const raw = typeof field.options === 'function'
    ? (field.options as (c: Record<string, unknown>) => Iterable<unknown>)(createDefaultConfig(typeId) as Record<string, unknown>)
    : field.options
  if (!raw) return []
  const values = Array.isArray(raw) ? raw : Array.from(raw as Iterable<unknown>)
  return values
    .map((item) => (item && typeof item === 'object' ? item as { value?: string; disabled?: boolean } : { value: String(item ?? '') }))
    .filter((option) => option.value && option.disabled !== true)
    .map((option) => option.value as string)
}

const hasEditableField = (typeId: string, key: string): boolean => {
  const field = fieldIndexOf(typeId).get(key)
  return Boolean(field && field.type !== 'hidden')
}

/**
 * 家族被选中时的最小 config（模块路由 / lycoris 算法 / 下拉 / 实体旗标）。
 * 返回 null = 该类型无此家族的任何 UI 路由（配合 family_fields 是否存在判定「不供此族」）。
 */
function bareSelectionFor(typeId: string, spec: FamilySpec): Record<string, unknown> | null {
  const cfg: Record<string, unknown> = { ...createDefaultConfig(typeId) as Record<string, unknown> }
  if (spec.family === 'lora') return cfg

  const identityKey = (['lora_type', 'adapter_type'] as const).find((key) => fieldIndexOf(typeId).get(key)?.type === 'select')
  const identityOptions = identityKey ? enabledSelectOptions(typeId, identityKey) : []
  const moduleOptions = enabledSelectOptions(typeId, 'network_module')
  const flag = spec.family_fields.find((key) => key.endsWith('_enabled'))

  if (LYCORIS_FAMILY_SET.has(spec.family)) {
    if (hasEditableField(typeId, 'lycoris_algo') && moduleOptions.includes('lycoris.kohya')) {
      cfg.network_module = 'lycoris.kohya'
      cfg.lycoris_algo = spec.lycoris_algo
      return cfg
    }
    if (identityKey && identityOptions.includes(spec.lycoris_algo)) {
      cfg[identityKey] = spec.lycoris_algo
      return cfg
    }
    // oft 别名：anima/newbie 下拉用 oft 值，schemaCommon 归一为 diag-oft（LYCORIS_METHOD_TYPES + 注释 animaSchema.js:96）
    if (identityKey && spec.lycoris_algo === 'diag-oft' && identityOptions.includes('oft')) {
      cfg[identityKey] = 'oft'
      return cfg
    }
    return null
  }
  if (spec.network_module && spec.network_module !== 'networks.lora' && moduleOptions.includes(spec.network_module)) {
    cfg.network_module = spec.network_module
    if (flag) cfg[flag] = true
    return cfg
  }
  const dropdownOption = FAMILY_DROPDOWN_OPTION[spec.family]
  if (dropdownOption && identityKey && identityOptions.includes(dropdownOption)) {
    cfg[identityKey] = dropdownOption
    if (flag) cfg[flag] = true
    return cfg
  }
  if (spec.family === 'dora') {
    // 主键优先级与 doraToggleState 一致：dora_enabled → dora_wd → use_dora。
    if (hasEditableField(typeId, 'dora_enabled')) { cfg.dora_enabled = true; return cfg }
    if (hasEditableField(typeId, 'dora_wd')) { cfg.dora_wd = true; return cfg }
    if (hasEditableField(typeId, 'use_dora')) { cfg.use_dora = true; return cfg }
    return null
  }
  if (spec.family === 'rs-lora') {
    if (hasEditableField(typeId, 'rs_lora_enabled')) { cfg.rs_lora_enabled = true; return cfg }
    if (hasEditableField(typeId, 'use_rslora')) { cfg.use_rslora = true; return cfg }
    return null
  }
  if (flag && hasEditableField(typeId, flag)) { cfg[flag] = true; return cfg }
  // 盲置兜底仅当类型确实携带本家族子参数（sdxl gdlokr：S_LORA_VARIANTS 有 factor/mode/alpha），
  // 否则会给「路由都没有」的类型虚构选中态。
  if (flag && BLIND_FLAG_ALLOWED.has(flag) && spec.family_fields.some((key) => hasEditableField(typeId, key))) {
    cfg[flag] = true
    return cfg
  }
  return null
}

/** 解锁族内嵌套前置：布尔全开、select 取第一项（沿用 sdxl 先例）。 */
function unlockedSelectionFor(typeId: string, spec: FamilySpec, selection: Record<string, unknown>): Record<string, unknown> {
  const cfg = { ...selection }
  const fields = fieldIndexOf(typeId)
  for (const key of spec.family_fields) {
    const field = fields.get(key)
    if (!field) continue
    if (field.type === 'boolean') cfg[key] = true
    if (field.type === 'select') {
      const raw = typeof field.options === 'function'
        ? (field.options as (c: Record<string, unknown>) => Iterable<unknown>)(cfg)
        : field.options
      const first = Array.isArray(raw) ? raw[0] : undefined
      if (first) cfg[key] = typeof first === 'object' ? (first as { value: string }).value : first
    }
  }
  return cfg
}

/**
 * payload 形态认可：键不在顶层，但出现在已知派生键（conv_dim→lycoris_conv_dim 等，
 * runConfigBuilder.normalizeLycorisNetworkArgs 的落地形态）或 network_args 的
 * key=value 行（lycoris_preset 以 alias `preset=` 出站）也算通过。
 */
const DERIVED_PAYLOAD_KEYS: Record<string, string[]> = {
  conv_dim: ['lycoris_conv_dim'],
  conv_alpha: ['lycoris_conv_alpha'],
  dropout: ['network_dropout'],
  rank_dropout: ['lokr_rank_dropout'],
  module_dropout: ['lokr_module_dropout'],
}
const NETWORK_ARG_ALIASES: Record<string, string[]> = {
  lycoris_preset: ['preset'],
}

function emittedSomewhere(payload: Record<string, unknown>, key: string): boolean {
  if (key in payload) return true
  for (const derived of DERIVED_PAYLOAD_KEYS[key] || []) {
    if (derived in payload) return true
  }
  const args = payload.network_args
  if (!Array.isArray(args)) return false
  const names = [key, ...(NETWORK_ARG_ALIASES[key] || [])]
  return args.some((line) => typeof line === 'string' && names.some((name) => line.startsWith(`${name}=`)))
}

// ── 类型特异豁免（显式 + 一行依据；整族 family / 逐键 keys 两级）──────────────
interface FamilyExemption {
  /** 整族豁免：本类型不提供该族或该族面不可审计。 */
  family?: string
  /** 逐键豁免：该族在本类型仅缺个别键（有意不暴露）。 */
  keys?: Record<string, string>
}

const DEAD_FLEXRANK_NOTE = 'netLora 共享组的 flexrank_lora_rank_range_min 恒不可见（visibleWhen 锚 networks.flexrank_lora，本类型 network_module 无该选项）——死 schema 重量，登记报告待清理'
const DEAD_INIT_STRATEGY_NOTE = 'netLora 共享组的 adapter_init_strategy 锚死 networks.lora，而本类型可用模块没有 networks.lora——初始化策略在本类型无落地，登记报告待清理'

const TYPE_FAMILY_EXEMPTS: Record<string, Record<string, FamilyExemption>> = {
  'newbie-lora': {
    // 后端静默降级：glora/glokr 选项 disabled，选后按普通 LoRA 训练（otherDitSchemas.js:492-505）。
    glora: { family: 'adapter_type glora 选项 disabled：Newbie 后端未接入 GLoRA，选择后静默按普通 LoRA（otherDitSchemas.js:492-497），且本类型无 registry glora 子参数' },
    glokr: { family: 'adapter_type glokr 选项 disabled：Newbie 后端未接入 GLoKr，选择后静默按普通 LoRA（otherDitSchemas.js:499-505），且本类型无 registry glokr 子参数' },
    // newbie DoRA rider 主键收敛为 dora_enabled（doraToggleState masterKey）；dora_wd 无旧草稿兼容需求未定义。
    dora: { keys: { dora_wd: 'newbie DoRA rider 主键收敛为 dora_enabled（doraToggleState masterKey 语义），dora_wd 无旧草稿兼容需求故未定义——同 sdxl hideDoraWd 的有意不暴露' } },
  },
  'flux-lora': {
    flexrank: { family: DEAD_FLEXRANK_NOTE },
    lora: { keys: { adapter_init_strategy: DEAD_INIT_STRATEGY_NOTE } },
  },
}

// ── 类型白名单与排除名册 ───────────────────────────────────────────────────────
// TYPE_IDS：携带适配器面、且整循环跑通的类型（选择构造差异见 bareSelectionFor）。
// EXCLUDED_TYPES：其余每个注册类型必须有一行排除理由（meta 测试强制）。
const TYPE_IDS = ['sdxl-lora', 'anima-lora', 'anima-edit-model', 'newbie-lora', 'sd-lora', 'flux-lora']

const EXCLUDED_TYPES: Record<string, string> = {}
const exclude = (ids: string[], reason: string): void => { for (const id of ids) EXCLUDED_TYPES[id] = reason }

exclude(['universal-dit-lora'], '无适配器面：network_module hidden 固定 networks.lora、无实体旗标（universalDitFields.js:136），无 family_field 可审计')
exclude(['sdxl-turbo-lora'], '无适配器面：schema 无 identity/实体旗标字段（Lab 子进程路线）')
exclude(['anima-few-step-lora', 'newbie-few-step-lora'], 'adapter_type 单选项 [lora] 预留入口、network_module 为 string，无 registry 子参数可审计')
exclude(['lab-distiller'], '无适配器面：向导无 adapter 步、schema 无 identity/实体旗标')
exclude(
  ['krea2-lora', 'flux2-lora', 'zimage-lora', 'wan22-ti2v-lora', 'wan22-t2v-a14b-lora', 'ltx23-lora', 'ltx25-lora', 'boogu-lora', 'boogu-edit-lora', 'minimax-h3-lora'],
  '仅叠加增强旗标（rs_lora_enabled/lora_plus_enabled[/dora]），无实体注入器/LyCORIS 选择面——多族循环无族可审；minimax 另有后端硬拒 LyCORIS/DoRA（minimax_h3/adapter_compat.py:14-34）',
)
exclude(
  ['lumina-lora', 'qwen-image-lora', 'hunyuan-dit-lora'],
  'lycoris 路由与 sd-lora 同构但 lora 族子面残缺（adapter_init_strategy 锚死 networks.lora、flexrank 旋钮死重量）——登记报告，未纳入白名单',
)
exclude(
  ['anima-ileco', 'anima-addift', 'anima-multi-addift'],
  'sections 与 anima-lora 同构（animaSchema 共享构造）且实体旗标被裁剪，lora_type 路由已由 anima-lora 代表审计',
)
exclude(['sdxl-ileco', 'sdxl-addift', 'sdxl-multi-addift', 'sd-ileco', 'sd-addift', 'sd-multi-addift'], 'network-settings 与 sdxl/sd-lora 同构共享 netLora，路由已代表审计')
exclude(['concept-edit'], 'lora_type 路由与 anima 同构（conceptEditUnifiedSchema netLora），registry 子参数仅 rs/lora+/dora_wd，已由宿主族代表')
exclude(
  ['sdxl-finetune', 'anima-finetune', 'krea2-finetune', 'boogu-finetune', 'ltx23-finetune', 'ltx25-finetune', 'flux2-finetune', 'zimage-finetune', 'wan22-finetune', 'minimax-h3-finetune', 'lumina-finetune', 'sd-dreambooth', 'sdxl-dreambooth'],
  'Finetune/DreamBooth 全参微调：无适配器选择面，registry ΔW family 不适用',
)
exclude(['sd-controlnet', 'sdxl-controlnet', 'sdxl-controlnet-lllite', 'sdxl-ip-adapter', 'anima-controlnet'], 'ControlNet/IP-Adapter：适配器即控制网本体，registry LoRA family 不适用')
exclude(['sd-textual-inversion', 'sdxl-textual-inversion'], 'Textual Inversion：训练 embedding，无 LoRA family 面')
exclude(['yolo', 'aesthetic-scorer'], '非扩散训练（YOLO/评分器），registry 不适用')

// ── 主审计循环（多类型）─────────────────────────────────────────────────────────
interface Gap {
  type: string
  family: string
  key: string
  check: 'schema' | 'activation' | 'visibleWhen' | 'wizard' | 'payload' | 'route'
  problem: string
}

describe('backend adapter registry params are all reachable in the UI (multi-type audit)', () => {
  const gaps: Gap[] = []
  const matrix: string[] = []

  for (const typeId of TYPE_IDS) {
    for (const spec of Object.values(specs)) {
      const exemption = TYPE_FAMILY_EXEMPTS[typeId]?.[spec.family]
      if (exemption?.family) {
        matrix.push(`${typeId}/${spec.family}: EXEMPT — ${exemption.family}`)
        continue
      }
      const selection = bareSelectionFor(typeId, spec)
      const fields = fieldIndexOf(typeId)
      const presentFields = spec.family_fields.filter((key) => {
        const field = fields.get(key)
        return Boolean(field && field.type !== 'hidden')
      })
      if (!selection) {
        if (presentFields.length > 0 && !exemption) {
          // 有 registry 子参数却无法在 UI 里选中该族：真 gap（路由缺失）。
          gaps.push({ type: typeId, family: spec.family, key: presentFields[0], check: 'route', problem: 'family fields present in schema but the type has no selection route for this family' })
        }
        // 无路由且无子参数 = 类型确实不供此族 → 自然跳过，不算 gap。
        matrix.push(`${typeId}/${spec.family}: not offered (no route, ${presentFields.length} registry fields present)`)
        continue
      }
      // 路由存在但类型不提供任何 registry 子参数（family_fields 在 sections 为空）
      // → 该类型确实不供此族的可调面，自然跳过（任务规则：不算 gap）。
      // 纯旗标家族（如 lora-fa：唯一 family_field 即选择键）仍保留激活审计。
      const selectionOrGhostKeys = spec.family_fields.filter((key) => SELECTION_ACTIVATION[key] || REGISTRY_GHOST_KEYS.has(key)).length
      if (presentFields.length === 0 && spec.family_fields.length > selectionOrGhostKeys) {
        matrix.push(`${typeId}/${spec.family}: route-only natural skip (type offers no registry sub-params)`)
        continue
      }

      const unlocked = unlockedSelectionFor(typeId, spec, selection)
      const selectionPayload = buildRunConfig(selection as Record<string, unknown>, typeId) as Record<string, unknown>
      const projection = buildWizardProjection(typeId, unlocked)
      const adapterStep = projection.steps.find((step) => step.id === 'adapter')
      const wizardKeys = new Set((adapterStep?.fields || []).map((field) => field.key))

      for (const key of spec.family_fields) {
        // 注册表虚键：后端无 config 字段（派生量/死拼写），全检查豁免（见头注）。
        if (REGISTRY_GHOST_KEYS.has(key)) continue
        // 类型特异逐键豁免（依据见 TYPE_FAMILY_EXEMPTS）。
        if (exemption?.keys?.[key]) continue
        // 选择键：跳过存在/可见/向导三项检查，改为激活断言（见文件头注释）。
        const activation = SELECTION_ACTIVATION[key]
        if (activation) {
          // 基础 lora 家族的 use_dora/use_rslora 是可选 rider（默认关闭是正确状态），
          // 不构成 lora 家族的激活条件；它们的激活已由专属 dora / rs-lora 家族审计。
          const optionalRiderOnBaseLora = spec.family === 'lora' && (key === 'use_dora' || key === 'use_rslora')
          if (!optionalRiderOnBaseLora) {
            if (SELECTION_PRESENCE_ONLY.has(key)) {
              if (!(activation in selectionPayload)) {
                gaps.push({ type: typeId, family: spec.family, key, check: 'activation', problem: `activation key ${activation} not emitted by buildRunConfig for bare selection` })
              }
            } else if (selectionPayload[activation] !== true) {
              gaps.push({ type: typeId, family: spec.family, key, check: 'activation', problem: `activation key ${activation} is not true after bare selection` })
            }
          }
          continue
        }
        const field = fields.get(key)
        if (!field) { gaps.push({ type: typeId, family: spec.family, key, check: 'schema', problem: 'schema field missing' }); continue }
        // hidden/phantom：有意不暴露清单（见文件头注释），跳过可见/向导/payload 检查。
        if (field.type === 'hidden') continue
        const visible = field.visibleWhen ? field.visibleWhen(unlocked) : true
        if (!visible) gaps.push({ type: typeId, family: spec.family, key, check: 'visibleWhen', problem: 'visibleWhen not satisfied even with family fully selected' })
        else if (!wizardKeys.has(key)) gaps.push({ type: typeId, family: spec.family, key, check: 'wizard', problem: 'visible in full page but missing from wizard adapter step' })
        // 空默认的 string 字段（lycoris_preset）用非空探针值，否则提交层不会出站。
        const probeValue = field.type === 'boolean'
          ? true
          : field.type === 'number' ? 3
          : typeof field.defaultValue === 'string' && field.defaultValue.trim() ? field.defaultValue
          : 'attn-mlp'
        const probeConfig = { ...unlocked, [key]: probeValue }
        const payload = buildRunConfig(probeConfig as Record<string, unknown>, typeId) as Record<string, unknown>
        if (!emittedSomewhere(payload, key)) gaps.push({ type: typeId, family: spec.family, key, check: 'payload', problem: 'not emitted by buildRunConfig (stripped or renamed)' })
      }
      matrix.push(`${typeId}/${spec.family}: ${spec.family_fields.length} family fields audited`)
    }
  }

  it('every family_field from the backend registry exists in the schema (per type)', () => {
    const missing = gaps.filter((gap) => gap.check === 'schema')
    if (missing.length) console.error('MISSING:', JSON.stringify(missing, null, 1))
    expect(missing).toEqual([])
  })

  it('selection keys activate their family in the built payload (per type)', () => {
    const dormant = gaps.filter((gap) => gap.check === 'activation' || gap.check === 'route')
    if (dormant.length) console.error('DORMANT:', JSON.stringify(dormant, null, 1))
    expect(dormant).toEqual([])
  })

  it('every family_field lights up when its family is selected (per type)', () => {
    const invisible = gaps.filter((gap) => gap.check === 'visibleWhen')
    if (invisible.length) console.error('INVISIBLE:', JSON.stringify(invisible, null, 1))
    expect(invisible).toEqual([])
  })

  it('every family_field shows in the wizard adapter step once the family card is picked (per type)', () => {
    const absent = gaps.filter((gap) => gap.check === 'wizard')
    if (absent.length) console.error('WIZARD-MISSING:', JSON.stringify(absent, null, 1))
    expect(absent).toEqual([])
  })

  it('every family_field reaches the training payload (per type)', () => {
    const stripped = gaps.filter((gap) => gap.check === 'payload')
    if (stripped.length) console.error('PAYLOAD-STRIPPED:', JSON.stringify(stripped, null, 1))
    expect(stripped).toEqual([])
  })

  it('audits all 25 registered families across every whitelisted type', () => {
    expect(Object.keys(specs).length).toBe(25)
    expect(TYPE_IDS.length).toBeGreaterThan(1)
  })

  it('adapter-surface type whitelist (each type ran the full loop green before entering)', () => {
    console.log(matrix.join('\n'))
    expect(TYPE_IDS).toEqual(['sdxl-lora', 'anima-lora', 'anima-edit-model', 'newbie-lora', 'sd-lora', 'flux-lora'])
  })

  it('every registered training type is either audited or has a documented exclusion', () => {
    const undocumented = (ALL_TRAINING_TYPES as Array<{ id: string }>)
      .map((entry) => entry.id)
      .filter((id) => !TYPE_IDS.includes(id) && !EXCLUDED_TYPES[id])
    if (undocumented.length) console.error('UNDOCUMENTED EXCLUSION:', undocumented.join(','))
    expect(undocumented).toEqual([])
  })
})

// ── 任务 1：registry common_fields 显式断言（sdxl-lora 代表，去重后逐键一次）──

/** 已实证的 registry↔UI 发散键：后端真实存在、sdxl-lora UI 无一等键（报告主会话跟进）。 */
const COMMON_FIELD_DIVERGENCES: Record<string, string> = {}

/**
 * 有形态变换的一等键：textarea/select 原值不直接出站，以提交层产物形态断言。
 * - target_modules：空值不出站（默认预设）；非空切分成数组（runConfigBuilder
 *   normalizeListTextareas，后端 _string_list 不切分字符串）。
 * - rank_strategy：默认 uniform 出站。
 */
const COMMON_FIELD_TRANSFORMED: Record<string, (probe: Record<string, unknown>) => void> = {
  target_modules: (probe) => {
    const payload = buildRunConfig({ ...probe, target_modules: 'to_q, to_v\n to_out.0' }, TYPE_ID) as Record<string, unknown>
    expect(payload.target_modules).toEqual(['to_q', 'to_v', 'to_out.0'])
  },
}

/** 默认 payload 有意省略键：提交层把 0 值视为后端默认剥除（非 UI 缺口），以非零探针断言出站。 */
const COMMON_FIELD_DEFAULT_OMISSIONS: Record<string, string> = {
  network_dropout: 'runConfigBuilder.js:115 把 0 值 network_dropout 视为后端默认剥除（no-op 省略）——默认 payload 无键属有意行为',
}

describe('registry common_fields are first-class UI keys (sdxl-lora representative)', () => {
  const canonical = ['network_dim', 'network_alpha', 'network_dropout', 'target_modules', 'rank_strategy']
  const sdxlFields = fieldIndexOf(TYPE_ID)

  it('all 25 families declare the identical common_fields set', () => {
    for (const spec of Object.values(specs)) {
      expect(spec.common_fields, `family ${spec.family} common_fields drifted`).toEqual(canonical)
    }
  })

  for (const key of canonical) {
    it(`common_field ${key}: schema exists + default payload outbound + bare-lora visible`, () => {
      const divergence = COMMON_FIELD_DIVERGENCES[key]
      if (divergence) {
        // 已登记的 registry↔UI 发散：断言登记在案（一行依据），报告主会话跟进。
        expect(divergence).toContain('后端')
        return
      }
      const field = sdxlFields.get(key)
      expect(field, `common_field ${key} missing from sdxl-lora schema`).toBeTruthy()
      const defaultPayload = buildRunConfig(createDefaultConfig(TYPE_ID) as Record<string, unknown>, TYPE_ID) as Record<string, unknown>
      if (COMMON_FIELD_DEFAULT_OMISSIONS[key]) {
        expect(defaultPayload[key]).toBeUndefined()
        const probe = { ...(createDefaultConfig(TYPE_ID) as Record<string, unknown>), [key]: 0.05 }
        expect((buildRunConfig(probe, TYPE_ID) as Record<string, unknown>)[key]).toBe(0.05)
      } else if (COMMON_FIELD_TRANSFORMED[key]) {
        // 变换键：默认空值不出站（走后端预设），非空按提交层产物形态断言。
        expect(defaultPayload[key]).toBeUndefined()
        COMMON_FIELD_TRANSFORMED[key](defaultPayload)
      } else {
        expect(defaultPayload).toHaveProperty(key)
      }
      const bareLora = bareSelectionFor(TYPE_ID, specs.lora)
      expect(bareLora).toBeTruthy()
      expect(field!.visibleWhen ? field!.visibleWhen(bareLora!) : true).toBe(true)
    })
  }
})
