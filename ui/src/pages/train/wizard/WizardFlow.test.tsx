// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 向导主链路。
 *
 * 所有查询名都从生产侧派生 —— i18n 语言包(src/test/i18n.ts)、schema 字段定义、
 * adapterModel 卡片投影(src/test/wizardQueries.ts)。测试里不再抄任何一份
 * 中/英文字面量:这样 i18n 重构改文案时用例跟着走,而"文案键必须存在"这件事
 * 由 src/i18n/i18nParity.test.ts 单独把门,不在这里重复爆红。
 *
 * 断言强度没有降低:仍然按 role + 用户可见的 accessible name 去点,只是"可见名是
 * 什么"改由生产代码回答。核心链路额外在 zh / en 两种语言下各跑一遍,顺带证明
 * 流程不依赖某一语言。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import TrainPage from '../TrainPage'
import { trainApi } from '@/api/trainApi'
import {
  ALL_TRAINING_TYPES,
  applyBackendConfigOptions,
  getFieldDefinition,
} from '@/schema/schemaIndex.js'
import { useTrainConfigStore } from '@/stores/configStore'
import { useRouteStore } from '@/stores/routeStore'
import { categoryForTrainingType } from './wizardModel'
import { useWizardStore } from './wizardStore'
import {
  I18N_LANGUAGES,
  setLanguage,
  uiText,
  uiTextOrBareKey,
  wizardCategoryLabelPrefix,
} from '@/test/i18n'
import { adapterCardLabel, adapterCardName, adapterCategoryButtonName, fieldLabelRegex, wizardStepButtonName } from '@/test/wizardQueries'
import { textPrefix } from '@/test/i18n'
import { typeCardName } from '@/test/wizardQueries'
import { currentDraft, resetStores, seedTrainApiDefaults } from '@/test/trainPageFixture'
import { resolveTypeNote } from '@/i18n/useI18n'
import type { UiLanguage } from '@/stores/localeStore'

vi.mock('@/api/trainApi', () => ({
  trainApi: {
    configOptions: vi.fn(),
    savedParams: vi.fn(),
    preflight: vi.fn(),
    resolveConfig: vi.fn(),
    trainingIntentPreview: vi.fn(),
    weightComposerPreview: vi.fn(),
    startSampleDifficultyScoring: vi.fn(),
    sampleDifficultyScoringStatus: vi.fn(),
    cancelSampleDifficultyScoring: vi.fn(),
    run: vi.fn(),
    checkOutputConflict: vi.fn(),
    checkPathExists: vi.fn(),
    pickFile: vi.fn(),
    scanAnimaFolder: vi.fn(),
    saveConfig: vi.fn(),
    listSavedConfigs: vi.fn(),
    loadSavedConfig: vi.fn(),
    deleteSavedConfig: vi.fn(),
    renameSavedConfig: vi.fn(),
    importExternalConfig: vi.fn(),
    loadTrainDrafts: vi.fn(),
    saveTrainDrafts: vi.fn(),
    clearTrainDrafts: vi.fn(),
    lastTraining: vi.fn(),
    loadRunHistory: vi.fn(),
    saveRunHistory: vi.fn(),
    runRestorableConfig: vi.fn(),
  },
}))

vi.mock('@/api/resourceApi', () => ({
  resourceApi: {
    listLocalResources: vi.fn().mockResolvedValue({ items: [] }),
  },
}))

vi.mock('@/lib/animaFolderScan', () => ({
  openAnimaFolderScanner: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/motion/useEntrance', () => ({
  usePageEntrance: () => ({ current: null }),
}))

/**
 * 后端能力是 schemaCommon 的模块级状态，用例之间必须显式归零：
 * 这里装一份"常用家族全部可用"的中性载荷，个别门禁用例再自行覆盖。
 * 家族集合只需覆盖本文件会真正选择的方法（lora/locon/loha/lokr/vera）。
 */
function installNeutralBackendCaps(): void {
  applyBackendConfigOptions({
    training_capabilities: {
      adapter_families: {
        lora: { supports_rank: true, supports_alpha: true, supports_dora: true },
        locon: { supports_rank: true },
        loha: { supports_rank: true },
        lokr: { supports_rank: true },
        vera: { supports_rank: false, supports_alpha: false },
      },
    },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  resetStores()
  seedTrainApiDefaults()
  installNeutralBackendCaps()
})

function typeMeta(typeId: string) {
  const meta = ALL_TRAINING_TYPES.find((type) => type.id === typeId)
  if (!meta) throw new Error(`unknown type ${typeId}`)
  return meta
}

/** 从 type 步开始:点分类卡片 → 点类型卡片。 */
async function beginFlow(user: UserEvent, typeId: string) {
  const category = categoryForTrainingType(typeId)
  await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix(category) }))
  await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))
}

/** 从当前步开始,逐字段填写并在对应步骤点击「下一步」直至 review。 */
async function walkToReview(user: UserEvent, typeId: string, fill: Record<string, string>) {
  const nextLabel = uiText('wizard.actions.next')
  let guard = 0
  while (guard++ < 40) {
    const step = useWizardStore.getState().activeStepByType[typeId]
    if (step === 'review') {
      return
    }
    for (const [key, value] of Object.entries(fill)) {
      const input = screen.queryByLabelText(fieldLabelRegex(key, typeId))
      if (input && (input as HTMLInputElement).value !== value) {
        await user.clear(input)
        await user.type(input, value)
      }
    }
    const nextButton = screen.getByRole('button', { name: nextLabel })
    if (nextButton.hasAttribute('disabled')) {
      throw new Error(`next button disabled at step ${String(step)}`)
    }
    await user.click(nextButton)
  }
  throw new Error(`failed to reach review for ${typeId}`)
}

async function runPreflightOk(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: uiText('wizard.actions.preflight') }))
  await screen.findByText(uiText('wizard.preflight.ok'))
}

describe('WizardFlow: primary flows', () => {
  test.each<UiLanguage>(I18N_LANGUAGES)(
    '[%s] LoRA full happy path: walk to review, preflight ok, launch, navigate to monitor',
    async (language) => {
      resetStores(language)
      const user = userEvent.setup()
      render(<TrainPage />)

      const typeId = 'anima-lora'
      await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
      await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))
      // 适配器选择：大类 Tab 默认选中 LoRA 系列，方法为标准 LoRA
      await screen.findByRole('tab', { name: adapterCategoryButtonName('lora') })

      await walkToReview(user, typeId, {
        pretrained_model_name_or_path: '/models/anima/dit.safetensors',
      })

      await runPreflightOk(user)
      expect(vi.mocked(trainApi.preflight)).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: uiText('wizard.actions.launch') }))
      await waitFor(() => {
        expect(vi.mocked(trainApi.run)).toHaveBeenCalledTimes(1)
        const payload = vi.mocked(trainApi.run).mock.calls[0][0] as Record<string, unknown>
        expect(payload.model_train_type).toBe(typeId)
        expect(payload.pretrained_model_name_or_path).toBe('/models/anima/dit.safetensors')
        expect(useRouteStore.getState().route).toBe('monitor')
      })
    },
  )

  test('output conflict confirm gates launch: cancel blocks, confirm launches', async () => {
    const user = userEvent.setup()
    vi.mocked(trainApi.checkOutputConflict).mockResolvedValue({ conflict: true, message: '产物已存在' })
    render(<TrainPage />)

    await beginFlow(user, 'anima-lora')
    await walkToReview(user, 'anima-lora', {
      pretrained_model_name_or_path: '/models/anima/dit.safetensors',
    })
    await runPreflightOk(user)

    const launchName = uiText('wizard.actions.launch')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: launchName }))
    await waitFor(() => {
      expect(vi.mocked(trainApi.checkOutputConflict)).toHaveBeenCalled()
    })
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trainApi.run)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: launchName }))
    await waitFor(() => {
      expect(vi.mocked(trainApi.run)).toHaveBeenCalledTimes(1)
      expect(useRouteStore.getState().route).toBe('monitor')
    })
    confirmSpy.mockRestore()
  })

  test('saved config load fills draft and leaves type unchanged', async () => {
    const user = userEvent.setup()
    vi.mocked(trainApi.listSavedConfigs).mockResolvedValue([{ name: 'cfg1' }])
    vi.mocked(trainApi.loadSavedConfig).mockResolvedValue({
      config: {
        pretrained_model_name_or_path: '/x/model.safetensors',
        train_data_dir: '/d/images',
      },
    })
    render(<TrainPage />)

    await user.click(await screen.findByRole('button', { name: uiText('wizard.actions.presets') }))
    await screen.findByText('cfg1')
    await user.click(screen.getByRole('button', { name: uiText('presets.load') }))

    await waitFor(() => {
      const draft = useTrainConfigStore.getState().drafts['anima-lora']
      expect(draft.pretrained_model_name_or_path).toBe('/x/model.safetensors')
      expect(draft.train_data_dir).toBe('/d/images')
      expect(useTrainConfigStore.getState().typeId).toBe('anima-lora')
    })
  })

  test('adapter mutex: VeRA entity toggle then the default LoRA card clears vera_enabled and sets lora_type', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
    await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))

    // 点击步骤轨进入适配器步骤
    await user.click(await screen.findByRole('button', { name: wizardStepButtonName('adapter') }))

    // VeRA 是第 3 层「实体注入器」开关，不在基础算法的方法下拉里
    const veraToggle = await screen.findByRole('checkbox', { name: 'VeRA' })
    await user.click(veraToggle)

    await waitFor(() => {
      expect(useTrainConfigStore.getState().drafts[typeId].vera_enabled).toBe(true)
      expect(useTrainConfigStore.getState().drafts[typeId].lora_type).toBe('vera')
    })

    // VeRA（实体注入器）不是基础算法：切回 LoRA 系列时方法下拉不会自动选中
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('lora') }))
    const selectLora = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    expect((selectLora as HTMLSelectElement).value).toBe('')

    // 手动选择标准 LoRA
    await user.selectOptions(selectLora, 'lora')

    await waitFor(() => {
      const draft = useTrainConfigStore.getState().drafts[typeId]
      expect(draft.vera_enabled).toBe(false)
      expect(draft.lora_type).toBe('lora')
    })
  })

  test.each<[string, Record<string, string>]>([
    ['sdxl-finetune', { pretrained_model_name_or_path: '/m/sdxl.safetensors' }],
    ['sdxl-controlnet', { pretrained_model_name_or_path: '/m/sdxl.safetensors' }],
    ['sd-textual-inversion', { pretrained_model_name_or_path: '/m/sd15.safetensors' }],
    ['sd-dreambooth', { pretrained_model_name_or_path: '/m/sd15.safetensors', train_data_dir: '/d/img' }],
    ['anima-few-step-lora', { base_model_path: '/m/anima.safetensors' }],
    ['lab-distiller', { unet_path: '/m/unet.safetensors' }],
    // 收官审计补注册的实验类型：specialized 分类卡 → 契约张量目录直通 review。
    ['universal-dit-lora', { pretrained_model_name_or_path: '/m/custom-dit', train_data_dir: '/d/precomputed-tensors' }],
  ])('representative flow %s reaches review and runs preflight', async (typeId, fill) => {
    const user = userEvent.setup()
    render(<TrainPage />)

    await beginFlow(user, typeId)
    await walkToReview(user, typeId, fill)
    expect(useWizardStore.getState().activeStepByType[typeId]).toBe('review')

    await runPreflightOk(user)
    expect(vi.mocked(trainApi.preflight)).toHaveBeenCalledTimes(1)
    expect(useTrainConfigStore.getState().typeId).toBe(typeId)
  })

  test('backend options dynamic change gates adapter cards by capability', async () => {
    applyBackendConfigOptions({
      training_capabilities: {
        adapter_families: {
          lora: { supports_rank: true, supports_alpha: true, supports_dora: false },
          vera: { supports_rank: false, supports_alpha: false },
        },
      },
    })
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
    await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))

    // 点击步骤轨进入适配器步骤
    await user.click(await screen.findByRole('button', { name: wizardStepButtonName('adapter') }))

    // LoRA 系列可用，select 中包含 lora 可选；DoRA 不是方法选项
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    const loraOpt = select.querySelector('option[value="lora"]') as HTMLOptionElement
    expect(loraOpt.disabled).toBe(false)
    expect(select.querySelector('option[value="dora"]')).toBeNull()

    // 后端声明标准 LoRA 不支持叠加时，DoRA 权重分解开关被禁用
    const doraToggle = await screen.findByRole('checkbox', { name: uiText('wizard.adapter.dora_toggle') })
    expect(doraToggle).toBeDisabled()

    // VeRA 是实体注入器开关；后端提供了 vera 能力 → 可用（不在方法下拉里）
    const veraToggle = await screen.findByRole('checkbox', { name: 'VeRA' })
    expect(veraToggle).toBeEnabled()
  })

  test('tab switching does not mutate draft config or automatically pick first option', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
    await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))

    // 点击步骤轨进入适配器步骤
    await user.click(await screen.findByRole('button', { name: wizardStepButtonName('adapter') }))

    const initialDraft = { ...useTrainConfigStore.getState().drafts[typeId] }

    // 切换到 LyCORIS tab
    const lycorisTab = await screen.findByRole('tab', { name: adapterCategoryButtonName('lycoris') })
    await user.click(lycorisTab)

    // 验证 draft 没有被更改
    expect(useTrainConfigStore.getState().drafts[typeId]).toEqual(initialDraft)

    // select 应该为空，并且摘要卡显示未选择
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select')) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByText(uiText('wizard.adapter.no_selection_summary'))).toBeInTheDocument()

    // 切换到 LoRA 系列 Tab：草稿仍不被改动；标准 LoRA 是默认赢家，方法下拉回显选中
    const loraTab = await screen.findByRole('tab', { name: adapterCategoryButtonName('lora') })
    await user.click(loraTab)
    expect(useTrainConfigStore.getState().drafts[typeId]).toEqual(initialDraft)
    expect((screen.getByLabelText(uiText('wizard.adapter.method_select')) as HTMLSelectElement).value).toBe('lora')
  })

  test('only one method control source in wizard when selecting LyCORIS algorithms and network_module is hidden', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // 切到 LyCORIS tab 并选择 lokr
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('lycoris') }))
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    await user.selectOptions(select, 'lokr')

    // 身份字段(identity)已由大类 Tab + 方法下拉代表，向导里不应再出现第二个入口。
    // 标签一律从 schema 推导，避免测试抄一份中文副本后与 schema 改名脱钩。
    for (const key of ['network_module', 'lycoris_algo']) {
      expect(screen.queryByLabelText(fieldLabelRegex(key, typeId))).not.toBeInTheDocument()
    }
  })

  test('DoRA renders as a stackable rider instead of a method option', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // sdxl-lora 的 schema 同时定义 dora_enabled(master)与 dora_wd(network_args 旧入口)，
    // 后端 normalizer 会把 dora_wd 映射成 dora_enabled/use_dora —— 两者是同一个概念。
    // 向导只保留 DoRA 叠加开关这一个入口；方法列表里没有独立的 DORA 项。
    expect(getFieldDefinition('dora_wd', typeId)).toBeTruthy()
    expect(screen.queryByLabelText(fieldLabelRegex('dora_wd', typeId))).not.toBeInTheDocument()

    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    expect(select.querySelector('option[value="dora"]')).toBeNull()

    const toggle = await screen.findByRole('checkbox', { name: uiText('wizard.adapter.dora_toggle') })
    expect(toggle).toBeEnabled()
  })

  test('DoRA rider is disabled on LyCORIS LoKr and re-enabled on native LoRA', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // 后端注入链 LyCORIS 分支先于 use_dora 分派：LoKr 路线叠加 DoRA 不生效，
    // rider 必须禁用；切回标准 LoRA 后恢复可用。
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('lycoris') }))
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    await user.selectOptions(select, 'lokr')

    const toggle = () => screen.getByRole('checkbox', { name: uiText('wizard.adapter.dora_toggle') })
    await waitFor(() => {
      expect(toggle()).toBeDisabled()
      const draft = useTrainConfigStore.getState().drafts[typeId]
      expect(draft.network_module).toBe('lycoris.kohya')
      expect(draft.lycoris_algo).toBe('lokr')
      expect(draft.lora_type).toBeUndefined()
    })

    // 切回标准 LoRA：rider 恢复可用。
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('lora') }))
    const selectLora = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    await user.selectOptions(selectLora, 'lora')

    await waitFor(() => {
      const draft = useTrainConfigStore.getState().drafts[typeId]
      expect(draft.network_module).toBe('networks.lora')
    })
    expect(toggle()).toBeEnabled()
  })

  test('phantom switch train_t5xxl renders disabled with its preflight reason (station 5)', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'flux-lora'
    await beginFlow(user, typeId)

    // flux_preflight.py 对 train_t5xxl/train_text_encoder 直接 error（FLUX LoRA
    // 恒冻结 CLIP/T5）：开关必须以 disabled+原因提示渲染，而不是放行到预检被打回。
    // 原因文案从 schema 定义派生，测试不抄字面量。
    const fieldDef = getFieldDefinition('train_t5xxl', typeId)
    expect(fieldDef?.disabled).toBe(true)
    expect(String(fieldDef?.disabledReason || '')).not.toBe('')

    // 步骤轨按完成度锁步：填完必填项逐「下一步」走到开关所在的「其它设置」步骤。
    const nextLabel = uiText('wizard.actions.next')
    let guard = 0
    while (guard++ < 40) {
      const step = useWizardStore.getState().activeStepByType[typeId]
      if (step === 'other-settings' || step === 'review') break
      for (const [key, value] of Object.entries({
        pretrained_model_name_or_path: '/models/flux/flux.safetensors',
        ae: '/models/flux/ae.safetensors',
        clip_l: '/models/flux/clip_l.safetensors',
        t5xxl: '/models/flux/t5xxl.safetensors',
        train_data_dir: '/datasets/flux',
      })) {
        const input = screen.queryByLabelText(fieldLabelRegex(key, typeId))
        if (input && (input as HTMLInputElement).value !== value) {
          await user.clear(input)
          await user.type(input, value)
        }
      }
      const nextButton = screen.getByRole('button', { name: nextLabel })
      expect(nextButton).toBeEnabled()
      await user.click(nextButton)
    }
    expect(useWizardStore.getState().activeStepByType[typeId]).toBe('other-settings')

    // FieldControl 布尔控件渲染为 role="switch"（components/form.tsx Switch）。
    const toggle = await screen.findByRole('switch', { name: fieldLabelRegex('train_t5xxl', typeId) })
    expect(toggle).toBeDisabled()
    expect(await screen.findByText(String(fieldDef?.disabledReason || ''))).toBeInTheDocument()

    // 禁用控件不落草稿：draft 保持默认关闭。
    expect(useTrainConfigStore.getState().drafts[typeId].train_t5xxl).toBeFalsy()
  })

  test('adapter card copy follows UI language switches while parked on the adapter step', async () => {
    // 评审修复：adapterOptions/doraToggleState 经 getState() 非响应式读语言，
    // memo 缺 language 依赖时停在 adapter 步切语言，卡片文案不跟随。
    resetStores('zh')
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await beginFlow(user, typeId)
    await user.click(await screen.findByRole('button', { name: wizardStepButtonName('adapter') }))

    const zhLabel = adapterCardLabel(currentDraft(typeId), typeId, 'lora')
    // 摘要卡标题（<strong>）与方法下拉 <option> 同文案，用 STRONG 标签匹配器锁定卡片。
    const summaryTitle = (label: string) => (_: string, element: Element | null) =>
      element?.tagName === 'STRONG' && element.textContent === label
    expect(await screen.findByText(summaryTitle(zhLabel))).toBeInTheDocument()

    setLanguage('en')
    const enLabel = adapterCardLabel(currentDraft(typeId), typeId, 'lora')
    expect(enLabel).not.toBe(zhLabel)
    expect(await screen.findByText(summaryTitle(enLabel))).toBeInTheDocument()
    expect(screen.queryByText(summaryTitle(zhLabel))).toBeNull()
  })

  test('[zh] review notes join with locale-neutral separators (no CJK punctuation leaks)', async () => {
    resetStores('zh')
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await beginFlow(user, typeId)
    await walkToReview(user, typeId, {
      pretrained_model_name_or_path: '/models/anima/dit.safetensors',
    })

    // 本次 diff 新增的三条 review 拼接行改用 locale 无关分隔符（': '/'; '/', '），
    // zh 界面下不再出现代码硬编码的全角冒号/顿号（bundle 内的本地化标点不在此列）。
    const review = document.querySelector('.lx-w-review')
    expect(review).toBeTruthy()
    const notes = Array.from(review!.querySelectorAll('.lx-w-review-note')).map((node) => node.textContent ?? '')
    expect(notes.some((note) => note === `${uiText('wizard.review.explicit_fields')}: pretrained_model_name_or_path`)).toBe(true)
    for (const note of notes) {
      if (note.startsWith(uiText('wizard.review.explicit_fields')) || note.startsWith(uiText('wizard.review.managed_fields'))) {
        expect(note, note).not.toContain('：')
      }
      expect(note, note).not.toContain('、')
    }
  })

  test('selecting entity injectors (LoRA-FA/T-LoRA/VeRA/FlexRank) maintains selected family without duplicate method inputs', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // 实体注入器开关：VeRA
    const veraToggle = await screen.findByRole('checkbox', { name: 'VeRA' })
    await user.click(veraToggle)

    await waitFor(() => {
      expect(useTrainConfigStore.getState().drafts[typeId].network_module).toBe('networks.vera')
      expect(useTrainConfigStore.getState().drafts[typeId].vera_enabled).toBe(true)
    })
    for (const key of ['network_module', 'lycoris_algo', 'vera_enabled']) {
      expect(screen.queryByLabelText(fieldLabelRegex(key, typeId))).not.toBeInTheDocument()
    }

    // 关掉 VeRA：身份字段回落标准 LoRA，赢家解析回 default lora
    await user.click(await screen.findByRole('checkbox', { name: 'VeRA' }))
    await waitFor(() => {
      const draft = useTrainConfigStore.getState().drafts[typeId]
      expect(draft.vera_enabled).toBe(false)
      expect(draft.network_module).toBe('networks.lora')
    })

    // 其余实体注入器仍以开关形式存在，方法下拉只保留基础算法
    for (const name of ['LoRA-FA', 'T-LoRA', 'FlexRank']) {
      expect(await screen.findByRole('checkbox', { name })).toBeInTheDocument()
    }
    const select = screen.getByLabelText(uiText('wizard.adapter.method_select')) as HTMLSelectElement
    for (const family of ['vera', 'lora-fa', 'tlora', 'flexrank']) {
      expect(select.querySelector(`option[value="${family}"]`)).toBeNull()
    }
  })
})

describe('WizardFlow: type card notes', () => {
  test.each<UiLanguage>(I18N_LANGUAGES)(
    '[%s] type cards render the registry note for annotated types and nothing for plain ones',
    async (language) => {
      resetStores(language)
      const user = userEvent.setup()
      render(<TrainPage />)

      // 选卡处（model 步）必须暴露类型级标注：未验证的 webui-owned 薄壳与
      // 既有的 universal-dit-lora 实验标注都要能看见，且跟随 UI 语言。
      // 12 型共用同一段文案，所以按 aria-describedby 指向的元素逐类型定位，
      // 而不是 findByText（会命中 6 张 LoRA 卡）。
      await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
      const krea2Note = resolveTypeNote(typeMeta('krea2-lora'), language)
      expect(krea2Note).not.toBe('')
      // 标注挂在按钮外并由 aria-describedby 关联 —— 不能污染卡片的可访问名。
      const krea2Card = await screen.findByRole('button', { name: typeCardName(typeMeta('krea2-lora')) })
      expect(krea2Card.textContent).not.toContain(krea2Note)
      const krea2NoteId = krea2Card.getAttribute('aria-describedby')
      expect(krea2NoteId).toBe('lx-w-note-krea2-lora')
      expect(document.getElementById(krea2NoteId!)).toHaveTextContent(krea2Note)
      // 未标注类型（sdxl-lora）不带 describedby，也不渲染标注节点。
      const plainCard = await screen.findByRole('button', { name: typeCardName(typeMeta('sdxl-lora')) })
      expect(plainCard.getAttribute('aria-describedby')).toBeNull()
      expect(document.getElementById('lx-w-note-sdxl-lora')).toBeNull()

      // 既有 note 的实验类型同样显示（不是只给新 12 型加的一次性渲染）。
      // 选完分类后停在 model 步、只列该分类的卡；先点步骤轨回到 type 步换分类。
      await user.click(await screen.findByRole('button', { name: wizardStepButtonName('type') }))
      await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('specialized') }))
      const ditNote = resolveTypeNote(typeMeta('universal-dit-lora'), language)
      expect(ditNote).not.toBe('')
      const ditCard = await screen.findByRole('button', { name: typeCardName(typeMeta('universal-dit-lora')) })
      expect(document.getElementById(ditCard.getAttribute('aria-describedby')!)).toHaveTextContent(ditNote)
    },
  )
})

describe('WizardFlow: label sourcing', () => {
  test('the wizard renders translated chrome, not bare i18n keys', async () => {
    render(<TrainPage />)

    // 走 uiTextOrBareKey:键缺失时它会返回裸键,断言就会拿"裸键出现在界面上"来炸,
    // 这正是 i18n 重构最容易留下的痕迹。
    for (const key of ['wizard.actions.next', 'wizard.actions.presets', 'wizard.actions.expert']) {
      const text = uiTextOrBareKey(key)
      expect(text, `${key} rendered as a bare key`).not.toBe(key)
      expect(await screen.findByRole('button', { name: text })).toBeInTheDocument()
    }
  })
})
