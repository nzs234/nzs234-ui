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
      model_train_type: 'sdxl-finetune',
      gradient_release_mode: 'off',
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('Gradient Release'))).toBe(true)

    delete (global as any).window
  })

  test('建议 1: DreamBooth 全参路线（sd/sdxl）同样命中小显存 Gradient Release 建议', () => {
    // 路由匹配缺口修复：isFinetuneRoute 只认 'finetune' 子串时，
    // sd-dreambooth / sdxl-dreambooth 这类全参微调永远拿不到该建议。
    ;(global as any).window = { __SYSTEM_VRAM_MB: 16000 }
    try {
      for (const typeId of ['sd-dreambooth', 'sdxl-dreambooth']) {
        const result = validateConfig({ model_train_type: typeId, gradient_release_mode: 'off' }, typeId)
        const warning = result.warnings.find(w => w.message.includes('Gradient Release'))
        expect(warning, typeId).toBeTruthy()
        expect(warning?.fields).toContain('gradient_release_mode')
      }
      // 非 finetune/dreambooth 的 LoRA 路线不受影响：不触发该建议。
      const loraResult = validateConfig({ model_train_type: 'sdxl-lora', gradient_release_mode: 'off' }, 'sdxl-lora')
      expect(loraResult.warnings.some(w => w.message.includes('Gradient Release'))).toBe(false)
    } finally {
      delete (global as any).window
    }
  })

  test('建议 2: LoRA rank 过大 → 警告', () => {
    const config = {
      model_train_type: 'sdxl-lora',
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

  test('冲突 3: DoRA 叠加在 LyCORIS 算法（LoKr）上 → 警告并自动关闭', () => {
    // 后端注入链 LyCORIS 分支先于 use_dora 分派：LoKr+DoRA 训练不到分解。
    const config = {
      network_module: 'lycoris.kohya',
      lycoris_algo: 'lokr',
      dora_wd: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(true)
    expect(result.autoFixes?.dora_enabled).toBe(false)
    expect(result.autoFixes?.dora_wd).toBe(false)
  })

  test('冲突 3: 五站审计收官 —— 所有已知名族文案统一引用实证结论', () => {
    const base = { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', use_dora: true, train_data_dir: '/d', pretrained_model_name_or_path: '/m' }
    const sdxl = validateConfig({ ...base, model_train_type: 'sdxl-lora' }, 'sdxl-lora')
    const sdxlWarning = sdxl.warnings.find(w => w.message.includes('DoRA'))
    expect(sdxlWarning?.message).toContain('后端实证')
    // ANIMA 站（第 2 站）实证：与 SDXL 同一 LulynxTrainer 注入链，LyCORIS 分支短路。
    const anima = validateConfig({ ...base, model_train_type: 'anima-lora' }, 'anima-lora')
    const animaWarning = anima.warnings.find(w => w.message.includes('DoRA'))
    expect(animaWarning?.message).toContain('后端实证')
    expect(animaWarning?.message).toContain('anima-lora')
    // NEWBIE 站（第 3 站）实证：同一注入链 + adapter_type 二次映射不改 rider 语义。
    const newbie = validateConfig({
      model_train_type: 'newbie-lora',
      adapter_type: 'lokr',
      use_dora: true,
      train_data_dir: '/d',
      pretrained_model_name_or_path: '/m',
    }, 'newbie-lora')
    const newbieWarning = newbie.warnings.find(w => w.message.includes('DoRA'))
    expect(newbieWarning?.message).toContain('后端实证')
    expect(newbieWarning?.message).toContain('newbie-lora')
    expect(newbie.autoFixes?.use_dora).toBe(false)
    // 第 5 站收官：krea2 行转正，pending 文案分支退役。
    const krea2 = validateConfig({ ...base, model_train_type: 'krea2-lora' }, 'krea2-lora')
    const krea2Warning = krea2.warnings.find(w => w.message.includes('DoRA'))
    expect(krea2Warning?.message).toContain('后端实证')
    expect(krea2Warning?.message).not.toContain('逐管线审计')
    // sd15 行同样在第 5 站转正。
    const sd15 = validateConfig({ ...base, model_train_type: 'sd-lora' }, 'sd-lora')
    const sd15Warning = sd15.warnings.find(w => w.message.includes('DoRA'))
    expect(sd15Warning?.message).toContain('后端实证')
    expect(sd15Warning?.message).toContain('sd-lora')
  })

  test('冲突 3: FLUX/LTX 站（第 4 站）已实证，警告文案引用实证结论', () => {
    // FLUX 站：双路由（统一/legacy）均 fail-closed 拒绝 LyCORIS；
    // lycoris.kohya 草稿在 flux 上只会触发 RuntimeError，不存在静默降级。
    const base = { network_module: 'lycoris.kohya', lycoris_algo: 'lokr', use_dora: true, train_data_dir: '/d', pretrained_model_name_or_path: '/m' }
    const flux = validateConfig({ ...base, model_train_type: 'flux-lora' }, 'flux-lora')
    const fluxWarning = flux.warnings.find(w => w.message.includes('DoRA'))
    expect(fluxWarning?.message).toContain('后端实证')
    expect(fluxWarning?.message).toContain('flux-lora')
    // LTX 站：ltx25-lora 与 ltx23-lora 同一 canonical ltx23 运行时族；
    // 页面无算法选择键，仅旧草稿可能携带残留 use_dora。
    for (const typeId of ['ltx23-lora', 'ltx25-lora']) {
      const result = validateConfig({ ...base, model_train_type: typeId }, typeId)
      const warning = result.warnings.find(w => w.message.includes('DoRA'))
      expect(warning?.message, typeId).toContain('后端实证')
      expect(warning?.message, typeId).toContain(typeId)
      expect(result.autoFixes?.use_dora, typeId).toBe(false)
    }
  })

  test('冲突 3: Anima lora_type=lokr + dora_wd → 警告并自动关闭', () => {
    const result = validateConfig({
      model_train_type: 'anima-lora',
      lora_type: 'lokr',
      dora_wd: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(true)
    expect(result.autoFixes?.use_dora).toBe(false)
  })

  test('冲突 3: DoRA 叠加在原生 LoRA 上 → 不警告', () => {
    const result = validateConfig({
      network_module: 'networks.lora',
      dora_enabled: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(false)
  })

  test('冲突 3: DoRA + 不兼容算法（ia3）→ 警告并自动关闭', () => {
    const config = {
      network_module: 'lycoris.kohya',
      lycoris_algo: 'ia3',
      use_dora: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(true)
    expect(result.autoFixes?.dora_enabled).toBe(false)
    expect(result.autoFixes?.dora_wd).toBe(false)
  })

  test('冲突 3: Anima 原生 LoRA + dora_wd 别名 → 不警告', () => {
    const result = validateConfig({
      model_train_type: 'anima-lora',
      lora_type: 'lora',
      dora_wd: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(false)
  })

  test('冲突 3: DoRA + 独立实体（VeRA）→ 警告并自动关闭', () => {
    const result = validateConfig({
      vera_enabled: true,
      dora_enabled: true,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    })
    expect(result.warnings.some(w => w.message.includes('DoRA'))).toBe(true)
    expect(result.autoFixes?.use_dora).toBe(false)
  })

  test('冲突 4: network_alpha > network_dim → 警告', () => {
    const config = {
      model_train_type: 'sdxl-lora',
      network_dim: 16,
      network_alpha: 32,
      train_data_dir: '/path/to/data',
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.warnings.some(w => w.message.includes('network_alpha'))).toBe(true)
  })

  test('冲突 5: 数据集路径为空 → 错误', () => {
    const config = {
      pretrained_model_name_or_path: '/path/to/model',
    }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message.includes('数据集路径'))).toBe(true)
  })

  test('冲突 6: 模型路径为空 → 错误', () => {
    const config = {
      train_data_dir: '/path/to/data',
    }
    const result = validateConfig(config)
    expect(result.errors.some(e => e.message.includes('模型路径'))).toBe(true)
  })

  test('建议 5: Anima 短训练 + lulynx_steady_accel=off → 警告', () => {
    const config = {
      model_train_type: 'anima-lora',
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
      model_train_type: 'anima-lora',
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
      model_train_type: 'anima-lora',
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
      model_train_type: 'anima-lora',
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
