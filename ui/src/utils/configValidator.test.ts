// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 配置验证器单元测试
 */

import { validateConfig } from './configValidator'

describe('validateConfig', () => {
  test('冲突 1: Gradient Release Full + TurboCore → 自动 fallback 到 post_step', () => {
    const config = {
      turbocore_enabled: true,
      gradient_release_mode: 'full',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].message).toContain('自动切换为 post_step')
    expect(result.autoFixes?.gradient_release_mode).toBe('post_step')
  })

  test('冲突 1: Gradient Release Compatible + TurboCore → 自动 fallback 到 post_step', () => {
    const config = {
      turbocore_enabled: true,
      gradient_release_mode: 'compatible',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].message).toContain('自动切换为 post_step')
    expect(result.autoFixes?.gradient_release_mode).toBe('post_step')
  })

  test('冲突 2: torch.compile + 随机化特征 → 警告', () => {
    const config = {
      torch_compile_scope: 'per_block',
      pyramid_noise_offset_enable: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some(w => w.message.includes('torch.compile'))).toBe(true)
  })

  test('建议 1: 全参微调 + 小显存 → 警告', () => {
    // 模拟 16GB 显存
    ;(global as any).window = { __SYSTEM_VRAM_MB: 16000 }

    const config = {
      training_type: 'full_finetune',
      gradient_release_mode: 'off',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('Gradient Release'))).toBe(true)

    delete (global as any).window
  })

  test('建议 2: LoRA rank 过大 → 警告', () => {
    const config = {
      training_type: 'lora',
      network_dim: 128,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('过拟合'))).toBe(true)
  })

  test('建议 3: 学习率过大 → 警告', () => {
    const config = {
      learning_rate: 1e-2,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('学习率'))).toBe(true)
  })

  test('建议 4: 训练步数过少 → 警告', () => {
    const config = {
      max_train_steps: 50,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('训练步数'))).toBe(true)
  })

  test('冲突 3: network_alpha > network_dim → 警告', () => {
    const config = {
      training_type: 'lora',
      network_dim: 16,
      network_alpha: 32,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('network_alpha'))).toBe(true)
  })

  test('冲突 4: 数据集路径为空 → 错误', () => {
    const config = {
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message.includes('数据集路径'))).toBe(true)
  })

  test('冲突 5: 模型路径为空 → 错误', () => {
    const config = {
      train_data_dir: '/path/to/data',
    }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message.includes('模型路径'))).toBe(true)
  })

  test('建议 5: Anima 短训练 + lulynx_steady_accel=off → 警告', () => {
    const config = {
      model_type: 'anima',
      training_type: 'lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'off',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('Anima LoRA 短训练'))).toBe(true)
    expect(result.warnings.some(w => w.message.includes('lulynx_steady_accel'))).toBe(true)
  })

  test('建议 5: Anima 短训练 + steady=auto 仍提示梯度累积', () => {
    const config = {
      model_type: 'anima',
      training_type: 'lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'auto',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    const warning = result.warnings.find(w => w.message.includes('Anima LoRA 短训练'))
    expect(warning?.message).toContain('gradient_accumulation_steps=2')
    expect(warning?.message).not.toContain('启用 lulynx_steady_accel')
  })

  test('建议 5: steady=auto 且梯度累积已为 2 → 不警告', () => {
    const result = validateConfig({
      model_type: 'anima',
      training_type: 'lora',
      max_train_steps: 400,
      lulynx_steady_accel: 'auto',
      gradient_accumulation_steps: 2,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes('Anima LoRA 短训练'))).toBe(false)
  })

  test('正常配置 → 无错误', () => {
    const config = {
      model_type: 'anima',
      training_type: 'lora',
      network_dim: 16,
      network_alpha: 8,
      learning_rate: 1e-4,
      max_train_steps: 800,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.length).toBe(0)
  })
})

describe('validateConfig with typeId (schema-driven input resolution)', () => {
  test('sdxl-lora empty config reports 模型输入 and 训练数据 as empty', () => {
    const result = validateConfig({}, 'sdxl-lora')
    const messages = result.errors.map((error) => error.message)
    expect(messages.some((message) => message.includes('模型输入') && message.includes('为空'))).toBe(true)
    expect(messages.some((message) => message.includes('训练数据') && message.includes('为空'))).toBe(true)
  })

  test('sdxl-lora with model+dataset (and output) filled -> no missing-input errors', () => {
    const result = validateConfig({
      pretrained_model_name_or_path: '/path/to/model',
      train_data_dir: '/path/to/data',
      output_dir: '/path/to/output',
    }, 'sdxl-lora')
    expect(result.errors).toEqual([])
  })

  test('aesthetic-scorer with annotations filled but image_root empty -> no missing errors', () => {
    const result = validateConfig({
      annotations: '/path/to/annotations.jsonl',
      image_root: '',
      output_dir: '/path/to/output',
    }, 'aesthetic-scorer')
    expect(result.errors).toEqual([])
  })

  test('aesthetic-scorer without annotations still errors (annotations required)', () => {
    const result = validateConfig({ image_root: '/path/to/images' }, 'aesthetic-scorer')
    expect(result.errors.some((error) => error.message.includes('标注文件') && error.message.includes('为空'))).toBe(true)
  })
})
