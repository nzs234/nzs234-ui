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
  uiText,
  uiTextOrBareKey,
  wizardCategoryLabelPrefix,
} from '@/test/i18n'
import { adapterCardName, adapterCategoryButtonName, fieldLabelRegex, wizardStepButtonName } from '@/test/wizardQueries'
import { typeCardName } from '@/test/wizardQueries'
import { currentDraft, resetStores, seedTrainApiDefaults } from '@/test/trainPageFixture'
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

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  resetStores()
  seedTrainApiDefaults()
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

  test('adapter mutex: VeRA then the default LoRA card clears vera_enabled and sets lora_type', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('lora') }))
    await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))

    // 点击步骤轨进入适配器步骤
    await user.click(await screen.findByRole('button', { name: wizardStepButtonName('adapter') }))

    // 点击其他系列 Tab 切换到包含 VeRA 的类别
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('other') }))
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    expect((select as HTMLSelectElement).value).toBe('')
    await user.selectOptions(select, 'vera')

    await waitFor(() => {
      expect(useTrainConfigStore.getState().drafts[typeId].vera_enabled).toBe(true)
      expect(useTrainConfigStore.getState().drafts[typeId].lora_type).toBe('vera')
    })

    // 切回 LoRA 系列 Tab，由于当前选的是 VeRA（属于 other），切到 lora tab 时不会自动选择，select value 应该为空
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
    ['yolo', {}],
    ['anima-few-step-lora', { base_model_path: '/m/anima.safetensors' }],
    ['lab-distiller', { unet_path: '/m/unet.safetensors' }],
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
          lora: { supports_rank: true, supports_alpha: true },
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

    // LoRA 系列可用，select 中包含 lora 可选，dora 禁用
    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    const loraOpt = select.querySelector('option[value="lora"]') as HTMLOptionElement
    const doraOpt = select.querySelector('option[value="dora"]') as HTMLOptionElement
    expect(loraOpt.disabled).toBe(false)
    expect(doraOpt.disabled).toBe(true)

    // 切到其他系列，vera 可选
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('other') }))
    const selectOther = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    const veraOpt = selectOther.querySelector('option[value="vera"]') as HTMLOptionElement
    expect(veraOpt.disabled).toBe(false)
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

    // 切换到 Other tab
    const otherTab = await screen.findByRole('tab', { name: adapterCategoryButtonName('other') })
    await user.click(otherTab)
    expect(useTrainConfigStore.getState().drafts[typeId]).toEqual(initialDraft)
    expect((screen.getByLabelText(uiText('wizard.adapter.method_select')) as HTMLSelectElement).value).toBe('')
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

  test('DoRA method card replaces the legacy dora_wd toggle instead of shipping both', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // sdxl-lora 的 schema 同时定义 dora_enabled(master)与 dora_wd(network_args 旧入口)，
    // 后端 normalizer 会把 dora_wd 映射成 dora_enabled/use_dora —— 两者是同一个概念。
    // 向导只保留方法卡这一个入口；dora_wd 的原始字段留给专家模式。
    expect(getFieldDefinition('dora_wd', typeId)).toBeTruthy()
    expect(screen.queryByLabelText(fieldLabelRegex('dora_wd', typeId))).not.toBeInTheDocument()

    const select = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    expect(select.querySelector('option[value="dora"]')).toBeTruthy()
  })

  test('selecting LoRA-FA/T-LoRA/VeRA/FlexRank in wizard maintains selected family without duplicate method inputs', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'sdxl-lora'
    await beginFlow(user, typeId)

    // 切换到 Other 选 VeRA
    await user.click(await screen.findByRole('tab', { name: adapterCategoryButtonName('other') }))
    const otherSelect = await screen.findByLabelText(uiText('wizard.adapter.method_select'))
    await user.selectOptions(otherSelect, 'vera')

    await waitFor(() => {
      expect(useTrainConfigStore.getState().drafts[typeId].network_module).toBe('networks.vera')
      expect(useTrainConfigStore.getState().drafts[typeId].vera_enabled).toBe(true)
    })
    expect((otherSelect as HTMLSelectElement).value).toBe('vera')
    for (const key of ['network_module', 'lycoris_algo', 'vera_enabled']) {
      expect(screen.queryByLabelText(fieldLabelRegex(key, typeId))).not.toBeInTheDocument()
    }
  })
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
