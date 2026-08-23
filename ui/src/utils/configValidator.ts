// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 训练配置冲突检测与验证
 *
 * 在用户提交训练前实时检测配置冲突，避免训练失败
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

import { resolveTrainingInputs } from '@/pages/train/wizard/trainingInputs'

/**
 * 验证训练配置，检测冲突和潜在问题
 */
export function validateConfig(config: Record<string, any>, typeId?: string): ValidationResult {
  const errors: ValidationMessage[] = []
  const warnings: ValidationMessage[] = []
  const autoFixes: Record<string, any> = {}

  // ========== 冲突 1: Gradient Release Full/Compatible vs TurboCore → 自动 fallback ==========
  const turbocoreEnabled = config.turbocore_enabled === true
  const gradientReleaseMode = String(config.gradient_release_mode || 'off').toLowerCase()

  if (turbocoreEnabled && (gradientReleaseMode === 'full' || gradientReleaseMode === 'compatible')) {
    warnings.push({
      message:
        'Gradient Release (Full/Compatible) 与 TurboCore 冲突，已自动切换为 post_step 模式。' +
        'TurboCore 需要全局 optimizer.step()，而 Full/Compatible 使用逐参数优化器实例。',
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
      message:
        'torch.compile 会使部分随机化特征失效（包括 pyramid noise、noise offset、perlin noise、caption dropout、random flip）。' +
        '如需使用这些特征，建议关闭 torch.compile。',
      fields: ['torch_compile_scope']
    })
  }

  // ========== 建议 1: 全参微调 + 小显存 → 建议 Gradient Release ==========
  const trainingType = String(config.training_type || '').toLowerCase()
  const vramMB = typeof window !== 'undefined' && (window as any).__SYSTEM_VRAM_MB
    ? (window as any).__SYSTEM_VRAM_MB
    : null

  if (
    trainingType === 'full_finetune' &&
    vramMB !== null &&
    vramMB < 24000 &&
    gradientReleaseMode === 'off'
  ) {
    warnings.push({
      message:
        '全参微调在 < 24GB 显存下建议启用 Gradient Release（可节省 15-20% VRAM）。' +
        '推荐设置 gradient_release_mode = "post_step"。',
      fields: ['gradient_release_mode']
    })
  }

  // ========== 建议 2: LoRA + 大 rank → 过拟合风险 ==========
  const networkDim = config.network_dim ? parseInt(config.network_dim) : 0
  const modelType = String(config.model_type || '').toLowerCase()

  if (trainingType === 'lora' && networkDim > 64) {
    warnings.push({
      message:
        `LoRA rank (network_dim) 设置为 ${networkDim}，可能导致过拟合。` +
        '推荐值：小模型 (Anima/Boogu) 使用 8-16，大模型 (FLUX) 使用 16-32。',
      fields: ['network_dim']
    })
  }

  // ========== 建议 3: 学习率过大 ==========
  const learningRate = config.learning_rate ? parseFloat(config.learning_rate) : 0

  if (learningRate > 1e-3) {
    warnings.push({
      message:
        `学习率 ${learningRate} 过大，可能导致训练不稳定或 NaN。` +
        '推荐值：1e-4 ~ 5e-4（LoRA），1e-5 ~ 1e-4（全参微调）。',
      fields: ['learning_rate']
    })
  }

  // ========== 建议 4: 训练步数过少 ==========
  const maxTrainSteps = config.max_train_steps ? parseInt(config.max_train_steps) : 0

  if (maxTrainSteps > 0 && maxTrainSteps < 100) {
    warnings.push({
      message:
        `训练步数 ${maxTrainSteps} 过少，模型可能无法充分学习。` +
        '推荐值：LoRA 至少 400 步，全参微调至少 1000 步。',
      fields: ['max_train_steps']
    })
  }

  // ========== 冲突 3: LoRA + network_alpha > network_dim ==========
  const networkAlpha = config.network_alpha ? parseInt(config.network_alpha) : 0

  if (trainingType === 'lora' && networkAlpha > 0 && networkDim > 0 && networkAlpha > networkDim) {
    warnings.push({
      message:
        `network_alpha (${networkAlpha}) 大于 network_dim (${networkDim})，会降低 LoRA 的实际学习率。` +
        '推荐设置 network_alpha = network_dim / 2（例如 dim=16 → alpha=8）。',
      fields: ['network_alpha', 'network_dim']
    })
  }

  // ========== 必填输入：按当前 schema/type 解析，而不是假设所有训练都是 SDXL ==========
  if (typeId) {
    const inputs = resolveTrainingInputs(typeId, config)
    for (const missing of inputs.missing) {
      const label = missing.group.label
      errors.push({
        message: `${label}为空，无法开始训练。`,
        fields: missing.keys,
      })
    }
  } else {
    // 兼容旧调用方（没有 typeId 时保持原有通用校验契约）。
    if (!String(config.train_data_dir || '').trim()) {
      errors.push({ message: '训练数据集路径为空，无法开始训练。', fields: ['train_data_dir'] })
    }
    if (!String(config.pretrained_model_name_or_path || '').trim()) {
      errors.push({ message: '预训练模型路径为空，无法开始训练。', fields: ['pretrained_model_name_or_path'] })
    }
  }

  // ========== 建议 5: Anima + 短训练推荐设置 ==========
  if (modelType === 'anima' && trainingType === 'lora' && maxTrainSteps > 0 && maxTrainSteps < 800) {
    const steady = String(config.lulynx_steady_accel || 'auto').trim().toLowerCase()
    const recommendations: string[] = []
    const fields = ['max_train_steps']
    if (steady === 'off') {
      recommendations.push('启用 lulynx_steady_accel = "auto" 或 "on"（稳态加速）')
      fields.push('lulynx_steady_accel')
    }
    if (Number(config.gradient_accumulation_steps || 1) < 2) {
      recommendations.push('设置 gradient_accumulation_steps=2（提高稳定性）')
      fields.push('gradient_accumulation_steps')
    }
    if (recommendations.length > 0) {
      warnings.push({
        message: `Anima LoRA 短训练（< 800 步）建议：${recommendations.join('；')}`,
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
          message: `LoRA rank ${value} 过大，可能导致过拟合和显存不足`,
          fields: ['network_dim']
        }
      }
      break

    case 'learning_rate':
      if (value && parseFloat(value) > 1e-3) {
        return {
          message: `学习率 ${value} 过大，可能导致训练不稳定`,
          fields: ['learning_rate']
        }
      }
      if (value && parseFloat(value) < 1e-6) {
        return {
          message: `学习率 ${value} 过小，模型可能无法学习`,
          fields: ['learning_rate']
        }
      }
      break

    case 'max_train_steps':
      if (value && parseInt(value) < 50) {
        return {
          message: `训练步数 ${value} 过少，模型无法充分学习`,
          fields: ['max_train_steps']
        }
      }
      break
  }

  return null
}
