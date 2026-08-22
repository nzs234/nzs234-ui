// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 向导的门禁 / 预检 / 恢复路径。
 *
 * 与 WizardFlow.test.tsx 同一套约定:查询名从生产 i18n 语言包与 schema 派生,
 * 测试里不硬编码任何界面文案。详见 src/test/i18n.ts 的说明。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import TrainPage from '../TrainPage'
import { trainApi } from '@/api/trainApi'
import { ALL_TRAINING_TYPES } from '@/schema/schemaIndex.js'
import { useTrainConfigStore } from '@/stores/configStore'
import { useToastStore } from '@/stores/toastStore'
import { categoryForTrainingType } from './wizardModel'
import { useWizardStore } from './wizardStore'
import { uiText, uiTextOrBareKey, wizardCategoryLabelPrefix } from '@/test/i18n'
import { fieldLabelRegex, typeCardName } from '@/test/wizardQueries'
import { resetStores, seedTrainApiDefaults } from '@/test/trainPageFixture'

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

async function beginFlow(user: UserEvent, typeId: string) {
  const category = categoryForTrainingType(typeId)
  await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix(category) }))
  await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta(typeId)) }))
}

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

describe('WizardFlowGating: gating / preflight / restore', () => {
  test('preflight gating: no preflight -> disabled; blocking errors -> disabled; warnings need confirm', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    await beginFlow(user, 'anima-lora')
    await walkToReview(user, 'anima-lora', {
      pretrained_model_name_or_path: '/models/anima/dit.safetensors',
    })

    const launchName = uiText('wizard.actions.launch')
    const preflightName = uiText('wizard.actions.preflight')

    // No preflight run yet -> launch disabled.
    expect(screen.getByRole('button', { name: launchName })).toBeDisabled()

    // Blocking preflight errors keep launch disabled. 这些消息是后端返回的透传文本,
    // 不走 i18n 语言包,所以此处的字面量是"契约里的后端载荷",不是硬编码 UI 文案。
    vi.mocked(trainApi.preflight).mockResolvedValueOnce({
      can_start: false,
      errors: ['磁盘空间不足'],
    })
    await user.click(screen.getByRole('button', { name: preflightName }))
    await screen.findByText('磁盘空间不足')
    expect(screen.getByRole('button', { name: launchName })).toBeDisabled()

    // Warnings with can_start true still require the confirm checkbox.
    vi.mocked(trainApi.preflight).mockResolvedValueOnce({
      can_start: true,
      warnings: ['输出目录已存在'],
    })
    await user.click(screen.getByRole('button', { name: preflightName }))
    await screen.findByText('输出目录已存在')
    expect(screen.getByRole('button', { name: launchName })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: uiText('wizard.preflight.confirm_warning') }))
    expect(screen.getByRole('button', { name: launchName })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: launchName }))
    await waitFor(() => expect(vi.mocked(trainApi.run)).toHaveBeenCalledTimes(1))
  })

  test('last-training restore switches to hidden legacy type and replaces draft', async () => {
    const user = userEvent.setup()
    vi.mocked(trainApi.lastTraining).mockResolvedValue({
      has_last_training: true,
      schema_id: 'sdxl-ileco',
      run_id: 'r9',
      restorable_config: {
        pretrained_model_name_or_path: '/legacy/sdxl.safetensors',
        train_data_dir: '/legacy/data',
      },
    })
    // isDraftNearDefault treats array-valued defaults as changed (reference
    // compare), so restoring a non-empty draft shows an overwrite confirm.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TrainPage />)

    await user.click(await screen.findByRole('button', { name: uiText('wizard.actions.last') }))

    await waitFor(() => {
      expect(useTrainConfigStore.getState().typeId).toBe('sdxl-ileco')
      expect(useTrainConfigStore.getState().drafts['sdxl-ileco'].pretrained_model_name_or_path).toBe(
        '/legacy/sdxl.safetensors',
      )
    })
    confirmSpy.mockRestore()
  })

  test('type-selection gating: model step does not advance until a type card is chosen', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    // Pick a category that mismatches the default type (anima-lora is LoRA).
    await user.click(await screen.findByRole('button', { name: wizardCategoryLabelPrefix('finetune') }))
    expect(useWizardStore.getState().activeStepByType['anima-lora']).toBe('model')

    // Clicking next without choosing a matching type must NOT advance.
    await user.click(screen.getByRole('button', { name: uiText('wizard.actions.next') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(uiText('wizard.type.choose_hint'))
    expect(useWizardStore.getState().activeStepByType['anima-lora']).toBe('model')

    // Choosing a matching card advances past the model step.
    await user.click(await screen.findByRole('button', { name: typeCardName(typeMeta('sdxl-finetune')) }))
    await waitFor(() => {
      expect(useTrainConfigStore.getState().typeId).toBe('sdxl-finetune')
      expect(useWizardStore.getState().activeStepByType['sdxl-finetune']).toBe('adapter')
    })
  })

  test('path missing hint appears for a missing model path without crashing', async () => {
    const user = userEvent.setup()
    render(<TrainPage />)

    const typeId = 'anima-lora'
    await beginFlow(user, typeId)
    await user.click(await screen.findByRole('button', { name: uiText('wizard.actions.next') }))

    vi.mocked(trainApi.checkPathExists).mockResolvedValue({ exists: false })
    const input = await screen.findByLabelText(fieldLabelRegex('pretrained_model_name_or_path', typeId))
    await user.type(input, '/missing/path/xyz-123')
    expect(await screen.findByText(uiText('path.missing'))).toBeInTheDocument()
  })

  test('pickFile rejection surfaces a toast without crashing', async () => {
    const user = userEvent.setup()
    vi.mocked(trainApi.pickFile).mockRejectedValueOnce(new Error('picker canceled'))
    render(<TrainPage />)

    await beginFlow(user, 'anima-lora')
    await user.click(await screen.findByRole('button', { name: uiText('wizard.actions.next') }))

    // 这条用例验的是 pickFile 抛错后的 toast 链路,不是按钮文案本身。
    // 浏览按钮走 t('field.browse'),该键当前在语言包里缺失(生产缺陷,由
    // i18n/i18nParity.test.ts 单独把门),formatMessage 会把裸键渲染出来。
    // uiTextOrBareKey 精确复刻这条回落,所以断言命中的仍是真实可见文本,
    // 且语言包补齐前后这条用例都不用改。
    const browseButtons = await screen.findAllByRole('button', { name: uiTextOrBareKey('field.browse') })
    expect(browseButtons.length).toBeGreaterThan(0)
    await user.click(browseButtons[0])

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === 'picker canceled')).toBe(true)
    })
  })
})
