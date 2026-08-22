// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * TrainPage 流程测试的共享装置。
 *
 * `vi.mock('@/api/trainApi')` 的工厂必须留在各自的测试文件里(vitest 会把它提升到
 * import 之前,无法跨文件共享),但 mock 的**默认返回值**和 store 复位可以共用 ——
 * 这两块原本在 WizardFlow / WizardFlowGating 里各存一份,已经开始漂移。
 */
import { trainApi } from '@/api/trainApi'
import { vi } from 'vitest'
import { ALL_TRAINING_TYPES, createDefaultConfig } from '@/schema/schemaIndex.js'
import { useTrainConfigStore } from '@/stores/configStore'
import { useWizardStore } from '@/pages/train/wizard/wizardStore'
import { setLanguage } from './i18n'
import type { UiLanguage } from '@/stores/localeStore'

export const DEFAULT_FIXTURE_TYPE = 'anima-lora'

/**
 * vi.mock 的工厂返回的是裸 vi.fn(),类型上仍是 trainApi 的真实签名,
 * 所以要用 vi.mocked() 才能拿到 mock 方法,且返回值必须满足各自的声明类型。
 */
export function seedTrainApiDefaults(): void {
  vi.mocked(trainApi.configOptions).mockResolvedValue({})
  vi.mocked(trainApi.savedParams).mockResolvedValue({})
  vi.mocked(trainApi.preflight).mockResolvedValue({ can_start: true })
  vi.mocked(trainApi.resolveConfig).mockResolvedValue({})
  vi.mocked(trainApi.run).mockResolvedValue({ run_id: 'r1' })
  vi.mocked(trainApi.checkOutputConflict).mockResolvedValue({ conflict: false })
  vi.mocked(trainApi.checkPathExists).mockResolvedValue({ exists: true })
  vi.mocked(trainApi.pickFile).mockResolvedValue({})
  vi.mocked(trainApi.listSavedConfigs).mockResolvedValue([])
  vi.mocked(trainApi.loadSavedConfig).mockResolvedValue({})
  vi.mocked(trainApi.lastTraining).mockResolvedValue({})
  // train_drafts 三个方法都声明为 ApiEnvelope<TrainDraftsPayload>,裸 {} 不满足该联合。
  // data 里不带 revision = 老后端形状:rememberRevision 保持"未知",写请求不带
  // revision,compare-and-replace/409 那条路不会掺进这些 UI 流程测试里。
  vi.mocked(trainApi.loadTrainDrafts).mockResolvedValue({ status: 'success', data: {} })
  vi.mocked(trainApi.saveTrainDrafts).mockResolvedValue({ status: 'success', data: {} })
  vi.mocked(trainApi.clearTrainDrafts).mockResolvedValue({ status: 'success', data: {} })
  vi.mocked(trainApi.trainingIntentPreview).mockResolvedValue({})
  vi.mocked(trainApi.weightComposerPreview).mockResolvedValue({})
}

/**
 * 复位 config / wizard / locale store。
 *
 * language 显式传入:localeStore 从 localStorage 读初值,靠"清了 storage 所以是 zh"
 * 是隐式依赖 —— 一旦默认语言改成 en,所有断言会一起变红且看不出根因。
 */
export function resetStores(language: UiLanguage = 'zh'): void {
  setLanguage(language)
  const draft = createDefaultConfig(DEFAULT_FIXTURE_TYPE)
  // TrainPage's `s.explicitFieldsByType[typeId] || []` selector returns a fresh
  // [] for unseeded types, which triggers a useSyncExternalStore loop. Seed every
  // registered type so any type switch stays render-safe.
  const explicitSeed = Object.fromEntries(ALL_TRAINING_TYPES.map((type) => [type.id, []]))
  useTrainConfigStore.setState({
    typeId: DEFAULT_FIXTURE_TYPE,
    drafts: { [DEFAULT_FIXTURE_TYPE]: draft },
    schemaRev: 0,
    diskHydrated: false,
  })
  useWizardStore.setState({
    mode: 'wizard',
    activeStepByType: {},
    completedStepsByType: {},
    explicitFieldsByType: explicitSeed,
    staleStepsByType: {},
    categoryByType: {},
    preflightByType: {},
  })
}

/** 当前生效的草稿,用于从生产投影(adapterOptions 等)推导可见文本。 */
export function currentDraft(typeId: string): Record<string, unknown> {
  return useTrainConfigStore.getState().drafts[typeId] || createDefaultConfig(typeId)
}
