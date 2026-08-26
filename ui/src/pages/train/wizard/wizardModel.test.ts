// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

import {
  ALL_TRAINING_TYPES,
  TRAINING_TYPES,
  createDefaultConfig,
} from '@/schema/schemaIndex.js'
import {
  WIZARD_CATEGORY_LABELS,
  buildWizardProjection,
  categoryForTrainingType,
  displayValue,
  requiredKeysForStep,
  validateWizardStep,
  visibleTypesForCategory,
  wizardCategories,
  type WizardProjection,
  type WizardStepDefinition,
} from './wizardModel'
import { resolveTrainingInputs } from './trainingInputs'
import { useLocaleStore } from '@/stores/localeStore'
import zhBundle from '@/i18n/zh.json'
import enBundle from '@/i18n/en.json'

function stepForField(projection: WizardProjection, key: string): WizardStepDefinition | undefined {
  return projection.steps.find((step) => step.fields.some((field) => field.key === key))
}

function stepIds(projection: WizardProjection): string[] {
  return projection.steps.map((step) => step.id)
}

describe('wizardModel coverage', () => {
  test('exposes every visible registry type exactly once through wizard categories', () => {
    const visibleIds = TRAINING_TYPES
      .filter((type) => !type.hidden && !type.disabled)
      .map((type) => type.id)
    const categorizedIds = wizardCategories().flatMap((category) =>
      visibleTypesForCategory(category).map((type) => type.id),
    )

    // anima-edit-model（后端无 schema）与 yolo（registered_placeholder）已隐藏。
    // 2026-08 SDXL 桶补注册 sdxl-dreambooth / lllite / ip-adapter → 39。
    // 收官审计补注册 universal-dit-lora（后端已独立注册该 schema）→ 28。
    // webui-owned 解除隐藏：krea2/flux2/zimage/boogu/wan22 共 12 型后端已在
    // webui_owned_schemas.py 以 identity-only 薄壳补注册 → 28 + 12 = 40。
    expect(visibleIds).toHaveLength(40)
    expect(new Set(categorizedIds).size).toBe(categorizedIds.length)
    expect(new Set(categorizedIds)).toEqual(new Set(visibleIds))
    expect(wizardCategories().every((category) => WIZARD_CATEGORY_LABELS[category])).toBe(true)
  })

  test('keeps hidden legacy types out of beginner categories', () => {
    const visibleIds = new Set(TRAINING_TYPES.map((type) => type.id))
    const hiddenTypes = ALL_TRAINING_TYPES.filter((type) => type.hidden)

    expect(hiddenTypes.length).toBeGreaterThan(0)
    for (const type of hiddenTypes) {
      expect(visibleIds.has(type.id)).toBe(false)
      expect(wizardCategories().flatMap((category) => visibleTypesForCategory(category))
        .some((visibleType) => visibleType.id === type.id)).toBe(false)
    }
  })

  test('builds a non-throwing projection for all 40 visible types', () => {
    for (const type of TRAINING_TYPES) {
      const projection = buildWizardProjection(type.id, createDefaultConfig(type.id))
      const visibleKeys = projection.visibleFields.map((field) => field.key)
      const stepKeys = projection.steps.flatMap((step) => step.fields.map((field) => field.key))

      expect(projection.typeLabel).toBe(type.label)
      expect(projection.steps.length).toBeGreaterThan(0)
      expect(new Set(visibleKeys).size).toBe(visibleKeys.length)
      expect(new Set(stepKeys).size).toBe(stepKeys.length)
      expect(new Set(stepKeys)).toEqual(new Set(visibleKeys))
    }
  })

  test('retains category routing for representative training families', () => {
    expect(categoryForTrainingType('sdxl-lora')).toBe('lora')
    expect(categoryForTrainingType('sdxl-finetune')).toBe('finetune')
    expect(categoryForTrainingType('sdxl-controlnet')).toBe('controlnet')
    expect(categoryForTrainingType('sdxl-textual-inversion')).toBe('textual_inversion')
    expect(categoryForTrainingType('lab-distiller')).toBe('specialized')
    // 实验训练组（universal-dit-lora）与专项流程同属 specialized，不混入新手 LoRA 卡列表。
    expect(categoryForTrainingType('universal-dit-lora')).toBe('specialized')
    expect(categoryForTrainingType('yolo')).toBe('other')
  })

  test('derives required step keys from fields instead of a global field list', () => {
    const files = [
      { key: 'base_model_path', type: 'folder' },
      { key: 'unrelated_path', type: 'file' },
    ] as any
    const dataset = [
      { key: 'dataset_path', type: 'folder' },
      { key: 'train_data_dir', type: 'folder' },
    ] as any
    const output = [
      { key: 'output_path', type: 'folder' },
      { key: 'output_name', type: 'string' },
    ] as any

    expect(requiredKeysForStep('files', files)).toEqual(['base_model_path'])
    expect(requiredKeysForStep('dataset', dataset)).toEqual(['dataset_path'])
    expect(requiredKeysForStep('output', output)).toEqual(['output_path'])
  })

  test('validates missing required fields and accepts populated values', () => {
    const step = {
      id: 'files',
      label: '模型文件',
      description: '',
      fields: [{ key: 'pretrained_model_name_or_path', type: 'file' }],
      visible: true,
    } as WizardStepDefinition

    expect(validateWizardStep(step, {}).errors).toEqual(['pretrained_model_name_or_path 不能为空'])
    expect(validateWizardStep(step, { pretrained_model_name_or_path: 'model.safetensors' }).errors)
      .toEqual([])
  })

  /* ───────── displayValue 的语言边界 ─────────
   *
   * wizardModel 是纯 domain 层:不 import i18n、不读 localeStore。所以它的返回值
   * 只能是**语言无关的标记**(布尔 'true'/'false'、空值 '--'),本地化呈现属于 UI 层
   * —— review 摘要若要显示「开启/关闭/未设置」,应在 WizardPage 渲染处按 typeof
   * 分派到 t('value.on') / t('value.off') / t('value.unset'),而不是让 domain 函数
   * 直接吐中文。
   *
   * 为什么边界必须划在这里,而不是"顺手让 displayValue 返回中文更省事":
   *  - buildWizardProjection 及其下游都是纯函数,给 domain 层引一条 store 依赖会让
   *    投影随语言变化重算,并把 wizardModel 的可测性绑到 React/zustand 上;
   *  - 硬编码中文既不是 domain 标记也不是翻译:en 用户会在 review 里看到「开启」。
   *
   * 下面三条把这条边界从三个角度钉住。第一条是正契约,二三条是防退化:
   * 单独看第二条(跨语言不变)不足以证明"语言无关" —— 硬编码中文也是跨语言不变的。
   */

  test('CONTRACT: displayValue returns language-neutral tokens, not UI copy', () => {
    // 与语言无关的部分:数组拼接与数字透传,当前实现已满足。
    expect(displayValue(['a', 'b'])).toBe('a, b')
    expect(displayValue(12)).toBe('12')

    // 目标契约。当前生产实现返回硬编码中文('开启'/'关闭'/'未设置'),因此本断言
    // 目前失败 —— 这是已知的生产缺陷,不要靠改断言来修绿:要么 domain 层回到
    // 语言无关标记,要么把本地化上移到 WizardPage 的渲染处。
    expect(displayValue(true)).toBe('true')
    expect(displayValue(false)).toBe('false')
    expect(displayValue('')).toBe('--')
    expect(displayValue(null)).toBe('--')
    expect(displayValue(undefined)).toBe('--')
  })

  test('CONTRACT: displayValue output is identical under every UI language', () => {
    const probes: unknown[] = [true, false, '', null, undefined, 12, ['a', 'b'], 'text']
    const baseline = probes.map((value) => displayValue(value))
    const original = useLocaleStore.getState().language
    try {
      for (const language of ['zh', 'en'] as const) {
        useLocaleStore.getState().setLanguage(language)
        expect(probes.map((value) => displayValue(value)), `displayValue drifted under ${language}`)
          .toEqual(baseline)
      }
    } finally {
      // localeStore 是模块级单例,不复位会把语言泄漏给同一文件里后面的用例。
      useLocaleStore.getState().setLanguage(original)
    }
  })

  test('CONTRACT: displayValue never returns natural-language prose', () => {
    // 语言无关标记只能由 ASCII 构成。出现 CJK 就说明 domain 层混进了界面文案 ——
    // 无论它是硬编码的还是从语言包取的,对 en 用户都是坏的。
    const outputs = [displayValue(true), displayValue(false), displayValue(''), displayValue(null)]
    for (const value of outputs) {
      expect(
        /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(value),
        `displayValue returned localized prose: ${JSON.stringify(value)}`,
      ).toBe(false)
    }

    // 同时排掉"改成 t('value.on') 就算了"这条捷径:domain 输出不该等于任何语言包里的值。
    const bundleValues = new Set([...Object.values(zhBundle), ...Object.values(enBundle)])
    for (const value of outputs) {
      expect(bundleValues.has(value), `displayValue returned a translated string: ${value}`).toBe(false)
    }
  })
})

describe('wizardModel ownership overrides', () => {
  test('anima-lora: gradient_checkpointing lands in performance, anima_auto_scan_folder in files', () => {
    const projection = buildWizardProjection('anima-lora', createDefaultConfig('anima-lora'))
    expect(stepForField(projection, 'gradient_checkpointing')?.id).toBe('performance')
    expect(stepForField(projection, 'anima_auto_scan_folder')?.id).toBe('files')
  })

  test('aesthetic-scorer: dropout lands in core, annotations/image_root in dataset', () => {
    const projection = buildWizardProjection('aesthetic-scorer', createDefaultConfig('aesthetic-scorer'))
    expect(stepForField(projection, 'dropout')?.id).toBe('core')
    expect(stepForField(projection, 'annotations')?.id).toBe('dataset')
    expect(stepForField(projection, 'image_root')?.id).toBe('dataset')
  })

  test('sdxl-controlnet: controlnet-owning keys land in the controlnet step', () => {
    const projection = buildWizardProjection('sdxl-controlnet', createDefaultConfig('sdxl-controlnet'))
    expect(projection.category).toBe('controlnet')
    // control_net_lr 已按幻影键治理隐藏（后端零读者），不再进入向导投影。
    expect(stepForField(projection, 'control_net_lr')).toBeUndefined()
    // conditioning data is still a dataset concern, not swallowed by the controlnet fallback.
    expect(stepForField(projection, 'conditioning_data_dir')?.id).toBe('dataset')
  })
})

describe('wizardModel conditional steps', () => {
  test('sdxl-controlnet includes a visible controlnet step', () => {
    const projection = buildWizardProjection('sdxl-controlnet', createDefaultConfig('sdxl-controlnet'))
    const step = projection.steps.find((item) => item.id === 'controlnet')
    expect(step).toBeTruthy()
    expect(step!.visible).toBe(true)
  })

  test('universal-dit-lora: usable projection without empty adapter step (closing audit registration)', () => {
    const meta = ALL_TRAINING_TYPES.find((type) => type.id === 'universal-dit-lora')
    expect(meta).toBeTruthy()
    // registry note 标注实验属性；入口可见（hidden/disabled 均未设置）。
    expect(meta!.hidden).toBeFalsy()
    expect(meta!.disabled).toBeFalsy()
    expect(String((meta as typeof meta & { note?: string })?.note || '')).toContain('实验')

    const config = createDefaultConfig('universal-dit-lora')
    const projection = buildWizardProjection('universal-dit-lora', config)
    expect(projection.category).toBe('specialized')

    // 无空步：除 type/model/review 外每个可见步都必须携带字段。
    for (const step of projection.steps) {
      if (['type', 'model', 'review'].includes(step.id)) continue
      expect(step.fields.length, `step ${step.id} must not be empty`).toBeGreaterThan(0)
    }

    // network_module 恒为隐藏 networks.lora，无算法卡可选面 → 不渲染 adapter 步；
    // rank/alpha/dropout 钉进 core，与学习率同屏。
    expect(stepIds(projection)).not.toContain('adapter')
    expect(stepForField(projection, 'network_dim')?.id).toBe('core')

    // 契约段落在向导可见面（other-settings），不是被 advanced/frontier 页签藏掉。
    expect(stepForField(projection, 'universal_dit_probe_mode')?.id).toBe('other-settings')
    // forward/output 两 JSON 键仅在实际执行前向的探测模式下可见（默认 auto 不出现）。
    expect(stepForField(projection, 'universal_dit_forward_mapping_json')).toBeUndefined()
    const forwardConfig = { ...config, universal_dit_probe_mode: 'forward' }
    expect(stepForField(buildWizardProjection('universal-dit-lora', forwardConfig), 'universal_dit_forward_mapping_json')?.id)
      .toBe('other-settings')

    // 必填输入组：files=模型目录 / dataset=预计算张量目录 / output=output_dir。
    const inputs = resolveTrainingInputs('universal-dit-lora', config)
    expect(inputs.model[0]?.keys).toContain('pretrained_model_name_or_path')
    expect(inputs.dataset[0]?.keys).toContain('train_data_dir')
    expect(inputs.output[0]?.keys).toContain('output_dir')
  })

  test('sdxl-lora does NOT include a controlnet step', () => {
    const projection = buildWizardProjection('sdxl-lora', createDefaultConfig('sdxl-lora'))
    expect(stepIds(projection)).not.toContain('controlnet')
  })

  test('lab-distiller includes a visible distiller step', () => {
    const projection = buildWizardProjection('lab-distiller', createDefaultConfig('lab-distiller'))
    const step = projection.steps.find((item) => item.id === 'distiller')
    expect(step).toBeTruthy()
    expect(step!.visible).toBe(true)
  })

  test('yolo includes a visible yolo step', () => {
    const projection = buildWizardProjection('yolo', createDefaultConfig('yolo'))
    const step = projection.steps.find((item) => item.id === 'yolo')
    expect(step).toBeTruthy()
    expect(step!.visible).toBe(true)
  })

  test('few-step types include a visible fewstep step', () => {
    for (const typeId of ['newbie-few-step-lora', 'anima-few-step-lora', 'sdxl-turbo-lora']) {
      const projection = buildWizardProjection(typeId, createDefaultConfig(typeId))
      const step = projection.steps.find((item) => item.id === 'fewstep')
      expect(step, `expected fewstep for ${typeId}`).toBeTruthy()
      expect(step!.visible).toBe(true)
    }
  })
})

describe('wizardModel validateWizardStep anyOf', () => {
  function filesStep(): WizardStepDefinition {
    return {
      id: 'files',
      label: '模型文件',
      description: '',
      fields: [],
      sourceSections: [],
      fieldSources: {},
      visible: true,
    }
  }

  test('sdxl-lora files step: empty config errors, any one base key clears them', () => {
    const step = filesStep()
    const empty = validateWizardStep(step, {}, 'sdxl-lora')
    expect(empty.errors.some((message) => message.includes('至少需要填写一项'))).toBe(true)
    expect(empty.requiredKeys).toContain('pretrained_model_name_or_path')

    const filled = validateWizardStep(step, { pretrained_model_name_or_path: '/models/sdxl' }, 'sdxl-lora')
    expect(filled.errors).toEqual([])
  })

  test('newbie-lora files step: transformer_path alone is not enough, base is required', () => {
    const step = filesStep()
    const baseKey = resolveTrainingInputs('newbie-lora', {}).model.find((group) => group.id === 'base-model')!.keys[0]

    const transformerOnly = validateWizardStep(step, { transformer_path: '/models/transformer' }, 'newbie-lora')
    expect(transformerOnly.errors.some((message) => message.includes('不能为空'))).toBe(true)

    const baseFilled = validateWizardStep(step, { transformer_path: '/models/transformer', [baseKey]: '/models/base' }, 'newbie-lora')
    expect(baseFilled.errors).toEqual([])
  })
})

describe('wizardModel duplicate conflict winner', () => {
  test('anima-lora has zero in-type duplicate keys after ANIMA bucket single-sourcing', () => {
    // 2026-08 ANIMA 桶把 timestep_sampling / discrete_flow_shift / flow_logit_* /
    // mode_scale / anima_train_llm_adapter / data_backend 等双份挂载收敛为单一入口，
    // 向导投影不再出现「后渲染 section 静默覆盖前渲染 section」的冲突。
    const projection = buildWizardProjection('anima-lora', createDefaultConfig('anima-lora'))
    expect(projection.duplicateFieldConflicts.map((conflict) => `${conflict.key}@${conflict.sectionIds.join('+')}`)).toEqual([])
  })

  test('conflict winners are always one of the candidate sections across representative types', () => {
    const representative = [
      'sdxl-lora',
      'anima-lora',
      'newbie-lora',
      'yolo',
      'aesthetic-scorer',
      'lab-distiller',
      'anima-few-step-lora',
      'sdxl-controlnet',
      'sdxl-textual-inversion',
    ]
    for (const typeId of representative) {
      const projection = buildWizardProjection(typeId, createDefaultConfig(typeId))
      for (const conflict of projection.duplicateFieldConflicts) {
        expect(conflict.sectionIds, `sectionIds for ${typeId}:${conflict.key}`).toContain(conflict.winnerSectionId)
      }
    }
  })
})

describe('wizardModel unmapped coverage', () => {
  const representative = [
    'sdxl-lora',
    'anima-lora',
    'newbie-lora',
    'yolo',
    'aesthetic-scorer',
    'lab-distiller',
    'anima-few-step-lora',
    'sdxl-controlnet',
    'sdxl-textual-inversion',
  ]

  test('every visible field key appears exactly once across steps (Set equality)', () => {
    for (const typeId of representative) {
      const projection = buildWizardProjection(typeId, createDefaultConfig(typeId))
      const visibleKeys = projection.visibleFields.map((field) => field.key)
      const stepKeys = projection.steps.flatMap((step) => step.fields.map((field) => field.key))
      expect(new Set(stepKeys), `Set equality for ${typeId}`).toEqual(new Set(visibleKeys))
      expect(stepKeys.length, `no duplicate step keys for ${typeId}`).toBe(visibleKeys.length)
    }
  })

  test('conditional steps are present where expected', () => {
    const expectations: Array<[string, string]> = [
      ['sdxl-controlnet', 'controlnet'],
      ['lab-distiller', 'distiller'],
      ['yolo', 'yolo'],
      ['anima-few-step-lora', 'fewstep'],
      ['newbie-few-step-lora', 'fewstep'],
      ['sdxl-textual-inversion', 'ti-token'],
    ]
    for (const [typeId, stepId] of expectations) {
      const projection = buildWizardProjection(typeId, createDefaultConfig(typeId))
      expect(stepIds(projection), `expected ${stepId} for ${typeId}`).toContain(stepId)
    }
    const sdxlLora = buildWizardProjection('sdxl-lora', createDefaultConfig('sdxl-lora'))
    expect(stepIds(sdxlLora)).not.toContain('controlnet')
  })
})
