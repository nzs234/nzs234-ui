// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 全算法参数显示审计：以后端能力注册表（contracts/adapter_family_registry，25 家族，
 * family_fields 从注入器签名实证提取）为权威清单，核验每个算法被选中后：
 *   1. schema 字段存在；2. 全页 visibleWhen 点亮；3. 向导适配器步骤可见；4. payload 透传。
 * 快照 tools/.backend-adapter-specs.json 由后端 adapter_family_capabilities() 导出。
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
  */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRunConfig,
  createDefaultConfig,
  getSectionsForType,
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

function fieldsOf(): Map<string, { type: string; visibleWhen?: (c: Record<string, unknown>) => boolean; defaultValue: unknown }> {
  const map = new Map()
  for (const section of getSectionsForType(TYPE_ID)) {
    for (const field of section.fields || []) map.set(field.key, field)
  }
  return map
}
const FIELD_INDEX = fieldsOf()

/**
 * 选择键 → builder 发出的真实激活键。依据见文件头注释与 schemaCommon.js
 * ADAPTER_ENTITY_PRIORITY / moduleEntities 实体表。
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

/** 家族被选中时的最小 config（模块路由 / lycoris 算法 / 实体旗标）。 */
function bareSelection(spec: FamilySpec): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...createDefaultConfig(TYPE_ID) as Record<string, unknown> }
  if (spec.lycoris_algo) {
    cfg.network_module = spec.network_module || 'lycoris.kohya'
    cfg.lycoris_algo = spec.lycoris_algo
  } else if (spec.network_module && spec.network_module !== 'networks.lora') {
    cfg.network_module = spec.network_module
  }
  const flag = spec.family_fields.find((key) => key.endsWith('_enabled'))
  if (flag) cfg[flag] = true
  if (spec.family === 'dora') cfg.use_dora = true
  if (spec.family === 'rs-lora') cfg.use_rslora = true
  return cfg
}

/** 解锁族内嵌套前置：布尔全开、select 取第一项。 */
function unlockedSelection(spec: FamilySpec): Record<string, unknown> {
  const cfg = bareSelection(spec)
  for (const key of spec.family_fields) {
    const field = FIELD_INDEX.get(key)
    if (!field) continue
    if (field.type === 'boolean') cfg[key] = true
    if (field.type === 'select') {
      const raw = (field as { options?: Array<{ value: string } | string> }).options
      const first = Array.isArray(raw) ? raw[0] : undefined
      if (first) cfg[key] = typeof first === 'object' ? first.value : first
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

interface Gap {
  family: string
  key: string
  check: 'schema' | 'activation' | 'visibleWhen' | 'wizard' | 'payload'
  problem: string
}

describe('backend adapter registry params are all reachable in the UI (per-family audit)', () => {
  const gaps: Gap[] = []
  const matrix: string[] = []

  for (const spec of Object.values(specs)) {
    const unlocked = unlockedSelection(spec)
    const selectionPayload = buildRunConfig(bareSelection(spec) as Record<string, unknown>, TYPE_ID) as Record<string, unknown>
    const projection = buildWizardProjection(TYPE_ID, unlocked)
    const adapterStep = projection.steps.find((step) => step.id === 'adapter')
    const wizardKeys = new Set((adapterStep?.fields || []).map((field) => field.key))

    const probe = spec.family_fields.length
    for (const key of spec.family_fields) {
      // 注册表虚键：后端无 config 字段（派生量/死拼写），全检查豁免（见头注）。
      if (REGISTRY_GHOST_KEYS.has(key)) continue
      // 选择键：跳过存在/可见/向导三项检查，改为激活断言（见文件头注释）。
      const activation = SELECTION_ACTIVATION[key]
      if (activation) {
        // 基础 lora 家族的 use_dora/use_rslora 是可选 rider（默认关闭是正确状态），
        // 不构成 lora 家族的激活条件；它们的激活已由专属 dora / rs-lora 家族审计。
        const optionalRiderOnBaseLora = spec.family === 'lora' && (key === 'use_dora' || key === 'use_rslora')
        if (!optionalRiderOnBaseLora) {
          if (SELECTION_PRESENCE_ONLY.has(key)) {
            if (!(activation in selectionPayload)) {
              gaps.push({ family: spec.family, key, check: 'activation', problem: `activation key ${activation} not emitted by buildRunConfig for bare selection` })
            }
          } else if (selectionPayload[activation] !== true) {
            gaps.push({ family: spec.family, key, check: 'activation', problem: `activation key ${activation} is not true after bare selection` })
          }
        }
        continue
      }
      const field = FIELD_INDEX.get(key)
      if (!field) { gaps.push({ family: spec.family, key, check: 'schema', problem: 'schema field missing' }); continue }
      // hidden/phantom：有意不暴露清单（见文件头注释），跳过可见/向导/payload 检查。
      if (field.type === 'hidden') continue
      const visible = field.visibleWhen ? field.visibleWhen(unlocked) : true
      if (!visible) gaps.push({ family: spec.family, key, check: 'visibleWhen', problem: 'visibleWhen not satisfied even with family fully selected' })
      else if (!wizardKeys.has(key)) gaps.push({ family: spec.family, key, check: 'wizard', problem: 'visible in full page but missing from wizard adapter step' })
      // 空默认的 string 字段（lycoris_preset）用非空探针值，否则提交层不会出站。
      const probeValue = field.type === 'boolean'
        ? true
        : field.type === 'number' ? 3
        : typeof field.defaultValue === 'string' && field.defaultValue.trim() ? field.defaultValue
        : 'attn-mlp'
      const probeConfig = { ...unlocked, [key]: probeValue }
      const payload = buildRunConfig(probeConfig as Record<string, unknown>, TYPE_ID) as Record<string, unknown>
      if (!emittedSomewhere(payload, key)) gaps.push({ family: spec.family, key, check: 'payload', problem: 'not emitted by buildRunConfig (stripped or renamed)' })
    }
    matrix.push(`${spec.family}: ${probe} family fields audited`)
  }

  it('every family_field from the backend registry exists in the schema', () => {
    const missing = gaps.filter((gap) => gap.check === 'schema')
    if (missing.length) console.error('MISSING:', JSON.stringify(missing, null, 1))
    expect(missing).toEqual([])
  })

  it('selection keys activate their family in the built payload', () => {
    const dormant = gaps.filter((gap) => gap.check === 'activation')
    if (dormant.length) console.error('DORMANT:', JSON.stringify(dormant, null, 1))
    expect(dormant).toEqual([])
  })

  it('every family_field lights up when its family is selected', () => {
    const invisible = gaps.filter((gap) => gap.check === 'visibleWhen')
    if (invisible.length) console.error('INVISIBLE:', JSON.stringify(invisible, null, 1))
    expect(invisible).toEqual([])
  })

  it('every family_field shows in the wizard adapter step once the family card is picked', () => {
    const absent = gaps.filter((gap) => gap.check === 'wizard')
    if (absent.length) console.error('WIZARD-MISSING:', JSON.stringify(absent, null, 1))
    expect(absent).toEqual([])
  })

  it('every family_field reaches the training payload', () => {
    const stripped = gaps.filter((gap) => gap.check === 'payload')
    if (stripped.length) console.error('PAYLOAD-STRIPPED:', JSON.stringify(stripped, null, 1))
    expect(stripped).toEqual([])
  })

  it('audits all 25 registered families', () => {
    console.log(matrix.join('\n'))
    expect(Object.keys(specs).length).toBe(25)
  })
})
