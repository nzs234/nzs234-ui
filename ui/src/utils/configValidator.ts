// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 训练配置冲突检测与验证
 *
 * 在用户提交训练前实时检测配置冲突，避免训练失败
 *
 * 文案契约：所有面向用户的 message 都经 translate() 走 zh/en 双语包；字段名保持
 * 机器键（fields 数组）供测试与定位使用。测试断言用语言包派生文本或 fields，
 * 不抄字面量。
 */

export interface ValidationResult {
  errors: ValidationMessage[]
  warnings: ValidationMessage[]
  autoFixes?: Record<string, any>  // 自动修正的字段值
}

export interface ValidationMessage {
  message: string
  fields?: string[]  // 涉及的字段名
}

import { resolveTrainingInputs, inputGroupLabel } from '@/pages/train/wizard/trainingInputs'
import { createDefaultConfig, getSectionsForType } from '@/schema/schemaIndex.js'
import {
  baseAlgoFamilyForDora,
  doraEnabled,
  doraStackableFamiliesForType,
  doraSupportAuditedForType,
} from '@/schema/schemaCommon.js'
import { translate } from '@/i18n/useI18n'

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(key, vars)
}

/** 互锁涉及的两路保存间隔键（与 SAVE_INTERVAL_FIELDS 后端常量同名同序）。 */
const SAVE_INTERVAL_FIELDS = ['save_every_n_epochs', 'save_every_n_steps']

/**
 * save 间隔互锁的后端真相镜像（configs_save_interval_interlock.py）：
 * 缺失/None/空串/负数一律读作 0（=关闭该路保存）。
 */
function readSaveInterval(config: Record<string, any>, field: string): number {
  const raw = config?.[field]
  if (raw === undefined || raw === null || raw === '') return 0
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return 0
  return Math.max(Math.trunc(parsed), 0)
}

/** 验证训练配置，检测冲突和潜在问题 */
export function validateConfig(config: Record<string, any>, typeId?: string): ValidationResult {
  const errors: ValidationMessage[] = []
  const warnings: ValidationMessage[] = []
  const autoFixes: Record<string, any> = {}

  // 草稿里没有 training_type/model_type 键；路由身份只有 model_train_type
  // （hidden schema 字段，值为 typeId，如 'anima-lora' / 'sdxl-finetune'）。
  const routeId = String(typeId || config.model_train_type || '').trim().toLowerCase()
  const isLoraRoute = routeId.includes('lora')
  // DreamBooth（sd-dreambooth / sdxl-dreambooth）同样是全参微调路线：只认
  // 'finetune' 子串会漏掉它们，小显存 Gradient Release 建议永远不触发。
  const isFinetuneRoute = /finetune|dreambooth/.test(routeId)
  const isAnimaLoraRoute = routeId.includes('anima') && isLoraRoute

  // ========== 冲突 1: Gradient Release Full/Compatible vs TurboCore → 自动 fallback ==========
  const turbocoreEnabled = config.turbocore_enabled === true
  const gradientReleaseMode = String(config.gradient_release_mode || 'off').toLowerCase()

  if (turbocoreEnabled && (gradientReleaseMode === 'full' || gradientReleaseMode === 'compatible')) {
    warnings.push({
      message: t('validator.gradient_release_turbocore'),
      fields: ['turbocore_enabled', 'gradient_release_mode']
    })
    autoFixes.gradient_release_mode = 'post_step'
  }

  // ========== 冲突 2: torch.compile + 随机化特征 ==========
  const torchCompile = config.torch_compile_scope && config.torch_compile_scope !== 'off'
  const hasRandomFeatures =
    config.pyramid_noise_offset_enable === true ||
    (config.noise_offset && parseFloat(config.noise_offset) > 0) ||
    config.perlin_noise_offset_enable === true ||
    (config.caption_dropout_rate && parseFloat(config.caption_dropout_rate) > 0) ||
    config.caption_shuffle === true ||
    config.random_flip === true

  if (torchCompile && hasRandomFeatures) {
    warnings.push({
      message: t('validator.compile_random_features'),
      fields: ['torch_compile_scope']
    })
  }

  // ========== 建议 1: 全参微调 + 小显存 → 建议 Gradient Release ==========
  const vramMB = typeof window !== 'undefined' && (window as any).__SYSTEM_VRAM_MB
    ? (window as any).__SYSTEM_VRAM_MB
    : null

  if (
    isFinetuneRoute &&
    vramMB !== null &&
    vramMB < 24000 &&
    gradientReleaseMode === 'off'
  ) {
    warnings.push({
      message: t('validator.finetune_small_vram_gradient_release'),
      fields: ['gradient_release_mode']
    })
  }

  // ========== 建议 2: LoRA + 大 rank → 过拟合风险 ==========
  const networkDim = config.network_dim ? parseInt(config.network_dim) : 0

  if (isLoraRoute && networkDim > 64) {
    warnings.push({
      message: t('validator.lora_rank_overfit_risk', { dim: networkDim }),
      fields: ['network_dim']
    })
  }

  // ========== 建议 3: 学习率过大 ==========
  const learningRate = config.learning_rate ? parseFloat(config.learning_rate) : 0

  if (learningRate > 1e-3) {
    warnings.push({
      message: t('validator.learning_rate_too_large', { lr: learningRate }),
      fields: ['learning_rate']
    })
  }

  // ========== 建议 4: 训练步数过少 ==========
  const maxTrainSteps = config.max_train_steps ? parseInt(config.max_train_steps) : 0

  if (maxTrainSteps > 0 && maxTrainSteps < 100) {
    warnings.push({
      message: t('validator.max_train_steps_too_few', { steps: maxTrainSteps }),
      fields: ['max_train_steps']
    })
  }

  // ========== 冲突 3: DoRA 叠加与基础算法不兼容 → 自动关闭 ==========
  // 单一事实源 DORA_SUPPORT_BY_MODEL_FAMILY：按模型家族查可叠加 family。
  // 五站管线审计已全部转正（无 pending 行）：所有已知家族要么仅原生 LoRA 可叠加
  // （注入链 LyCORIS 分支先于 use_dora 分派），要么整体不可启动（隐藏类型行）。
  // audited:false 仅剩未知 family 键的防御性回退，此时文案不写绝对化结论。
  if (doraEnabled(config)) {
    const baseAlgo = baseAlgoFamilyForDora(config)
    if (!doraStackableFamiliesForType(routeId).includes(baseAlgo)) {
      const audited = doraSupportAuditedForType(routeId)
      warnings.push({
        message: audited
          ? t('validator.dora_unstackable_audited', { type: routeId || '', base: baseAlgo || 'lora' })
          : t('validator.dora_unstackable_pending', { base: baseAlgo || 'lora' }),
        fields: ['dora_enabled', 'use_dora', 'dora_wd'],
      })
      autoFixes.dora_enabled = false
      autoFixes.use_dora = false
      autoFixes.dora_wd = false
    }
  }

  // ========== 冲突 4: LoRA + network_alpha > network_dim ==========
  const networkAlpha = config.network_alpha ? parseInt(config.network_alpha) : 0

  if (isLoraRoute && networkAlpha > 0 && networkDim > 0 && networkAlpha > networkDim) {
    warnings.push({
      message: t('validator.alpha_exceeds_dim', { alpha: networkAlpha, dim: networkDim }),
      fields: ['network_alpha', 'network_dim']
    })
  }

  // ========== 第 3 站桶（2026-08）显隐矛盾修复 ==========
  const compileRequested = String(config.execution_backend || '').trim().toLowerCase() === 'torch_compile'

  // E3：Newbie torch.compile 需要 cache-first（compile_contract.py:297-299 直接把
  // resolved 压成 off 并给 reason）。前端加联动提示，避免「开了 compile 却没生效」。
  if (routeId === 'newbie-lora' && compileRequested && config.use_cache !== true) {
    warnings.push({
      message: t('validator.newbie_compile_requires_cache'),
      fields: ['use_cache', 'execution_backend']
    })
  }

  // E4：torch.compile 与 blocks_to_swap>0 互斥（offload_product_contract.py:147-154
  // severity=error；training_loop_init_memory.py:146 会静默禁用 swap）。
  const blocksToSwap = Number(config.blocks_to_swap || 0)
  if ((routeId === 'flux-lora' || routeId === 'newbie-lora') && compileRequested && blocksToSwap > 0) {
    warnings.push({
      message: t('validator.compile_blocks_swap_conflict', { blocks: blocksToSwap }),
      fields: ['blocks_to_swap', 'execution_backend']
    })
  }

  // B7 联动提示：MiniMax-H3 swap>0 仅允许 unsloth checkpointing（configs_h3.py:105-109
  // ValueError 硬拒）；提交层会自动复位为 unsloth，这里给出可见反馈。
  const h3Swap = Number(config.h3_blocks_to_swap || 0)
  if (
    (routeId === 'minimax-h3-lora' || routeId === 'minimax-h3-finetune') &&
    h3Swap > 0 &&
    config.h3_checkpoint_mode &&
    config.h3_checkpoint_mode !== 'unsloth'
  ) {
    warnings.push({
      message: t('validator.h3_swap_requires_unsloth', { mode: config.h3_checkpoint_mode }),
      fields: ['h3_blocks_to_swap', 'h3_checkpoint_mode']
    })
    autoFixes.h3_checkpoint_mode = 'unsloth'
  }

  // A 组合提示：Newbie「仅构建缓存」+「强制重建缓存」同开时只重建不训练
  // （training_config_checks.py:424-425 warning），schema 文案已注明，这里兜底提醒。
  if (routeId === 'newbie-lora' && config.newbie_force_cache_only === true && config.newbie_rebuild_cache === true) {
    warnings.push({
      message: t('validator.newbie_cache_only_combo'),
      fields: ['newbie_force_cache_only', 'newbie_rebuild_cache']
    })
  }

  // E2（第 6 站桶）：wan22 深度扩层仅支持 TI2V-5B 单塔——A14B 双塔组合后端直接
  // ValueError（wan22_depth_expansion_runtime.py:51-56）。schema 层扩组已按
  // variant 显隐，这里兜底「先开扩层、后切 A14B」的旧草稿：自动关闭并给出反馈。
  if (routeId.startsWith('wan22') && String(config.wan22_model_variant || '') === 't2v-a14b' && config.wan22_depth_expansion_enabled === true) {
    warnings.push({
      message: t('validator.wan22_depth_expansion_variant'),
      fields: ['wan22_model_variant', 'wan22_depth_expansion_enabled']
    })
    autoFixes.wan22_depth_expansion_enabled = false
  }

  // ========== 保存间隔双零互锁（P0 漂移修复，全 40 型生效）==========
  // 后端 configs_save_interval_interlock.py 在 UnifiedTrainingConfig 构造期抛
  // ValueError，而 preflight 无此检查 → 失败发生在 run 启动后。这里前置到 UI：
  // 两路保存间隔都为 0 时报 error（阻断启动），语义与后端逐字对齐
  // （''/null 读作 0；任一 > 0 即放行）。
  //
  // 判定基准是「生效值」：草稿未写的键会回落 schema 默认（epochs 默认 ≥1），
  // 所以必须先并上该类型的默认配置再判，否则没显式带这两个键的类型会全误报。
  // 没有 typeId 的旧调用方无法解析默认值，不在此判定（维持原契约，后端兜底）。
  // 且仅当该类型的 schema 真的暴露了这两个键之一时才判定：完全不暴露的类型
  // （yolo / aesthetic-scorer / lab 路线等）由后端自带默认（epochs=1），不存在
  // 双零形态，UI 误报只会制造噪音。
  if (typeId) {
    const schemaHasSaveInterval = getSectionsForType(typeId).some((section) =>
      (section.fields || []).some((field) => SAVE_INTERVAL_FIELDS.includes(field.key)))
    if (schemaHasSaveInterval) {
      const effective = { ...createDefaultConfig(typeId), ...config }
      const saveEveryEpochs = readSaveInterval(effective, 'save_every_n_epochs')
      const saveEverySteps = readSaveInterval(effective, 'save_every_n_steps')
      if (saveEveryEpochs === 0 && saveEverySteps === 0) {
        errors.push({
          message: t('validator.save_interval_both_zero'),
          fields: [...SAVE_INTERVAL_FIELDS],
        })
      }
    }
  }

  // ========== 必填输入：按当前 schema/type 解析，而不是假设所有训练都是 SDXL ==========
  if (typeId) {
    const inputs = resolveTrainingInputs(typeId, config)
    for (const missing of inputs.missing) {
      errors.push({
        message: t('validator.input_group_empty', { group: inputGroupLabel(missing.group) }),
        fields: missing.keys,
      })
    }
  } else {
    // 兼容旧调用方（没有 typeId 时保持原有通用校验契约）。
    if (!String(config.train_data_dir || '').trim()) {
      errors.push({ message: t('validator.missing_train_data_dir'), fields: ['train_data_dir'] })
    }
    if (!String(config.pretrained_model_name_or_path || '').trim()) {
      errors.push({ message: t('validator.missing_model_path'), fields: ['pretrained_model_name_or_path'] })
    }
  }

  // ========== 建议 5: Anima + 短训练推荐设置 ==========
  if (isAnimaLoraRoute && maxTrainSteps > 0 && maxTrainSteps < 800) {
    const steady = String(config.lulynx_steady_accel || 'auto').trim().toLowerCase()
    const recommendations: string[] = []
    const fields = ['max_train_steps']
    if (steady === 'off') {
      recommendations.push(t('validator.anima_rec_steady_accel'))
      fields.push('lulynx_steady_accel')
    }
    if (Number(config.gradient_accumulation_steps || 1) < 2) {
      recommendations.push(t('validator.anima_rec_gradient_accumulation'))
      fields.push('gradient_accumulation_steps')
    }
    if (recommendations.length > 0) {
      warnings.push({
        message: t('validator.anima_short_training_recommendations', {
          recommendations: recommendations.join('; ')
        }),
        fields,
      })
    }
  }

  return { errors, warnings, autoFixes: Object.keys(autoFixes).length > 0 ? autoFixes : undefined }
}

/**
 * 检查单个字段是否有效（用于实时表单验证）
 */
export function validateField(fieldName: string, value: any): ValidationMessage | null {
  switch (fieldName) {
    case 'network_dim':
      if (value && parseInt(value) > 128) {
        return {
          message: t('validator.field_rank_too_large', { value }),
          fields: ['network_dim']
        }
      }
      break

    case 'learning_rate':
      if (value && parseFloat(value) > 1e-3) {
        return {
          message: t('validator.field_lr_too_large', { value }),
          fields: ['learning_rate']
        }
      }
      if (value && parseFloat(value) < 1e-6) {
        return {
          message: t('validator.field_lr_too_small', { value }),
          fields: ['learning_rate']
        }
      }
      break

    case 'max_train_steps':
      if (value && parseInt(value) < 50) {
        return {
          message: t('validator.field_steps_too_few', { value }),
          fields: ['max_train_steps']
        }
      }
      break
  }

  return null
}
