// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import type { SchemaField } from '@/schema/schemaIndex'
import { createDefaultConfig, getFieldDefinition, isFieldVisible } from '@/schema/schemaIndex.js'
import { buildRunConfig } from '@/schema/schemaIndex.js'
import { Button } from '@/components/primitives'
import { FieldControl } from '../FieldControl'
import { TrainingIntentProfilePreview } from '../TrainingIntentProfilePreview'
import { WeightComposerPreview } from '../WeightComposerPreview'
import { ProgressivePhaseEditor } from '../ProgressivePhaseEditor'
import { useWizardStore } from './wizardStore'
import {
  WIZARD_CATEGORY_DESCRIPTIONS,
  WIZARD_CATEGORY_LABELS,
  WIZARD_STEP_ORDER,
  buildWizardProjection,
  categoryForTrainingType,
  displayValue,
  validateWizardStep,
  visibleTypesForCategory,
  wizardCategories,
  type WizardCategory,
  type WizardStepDefinition,
  type WizardStepId,
} from './wizardModel'
import { fingerprintPayload, isPreflightCurrent, normalizePreflightReport, type PreflightSnapshot } from './preflight'
import {
  adapterCategoryForFamily,
  adapterOptions,
  adapterRestrictionNoticeKey,
  buildAdapterDeselection,
  buildAdapterSelection,
  doraToggleState,
  groupAdapterOptionsByCategory,
  ADAPTER_CATEGORIES,
  type AdapterCategoryKey,
  type AdapterOption,
} from './adapterModel'
import { getAdapterEntityConflict, normalizeAdapterEntityMutex } from '@/schema/schemaCommon.js'
import { FlaskConical } from 'lucide-react'
import {
  PreflightPanel,
  ReviewSection,
  StepCard,
  WizardContent,
  WizardFooter,
  WizardHeader,
  WizardRail,
  WizardShell,
  wizardStepLabelKey,
} from './primitives'
import { useI18n, resolveDisabledReason, resolveTypeNote, type TranslateFn } from '@/i18n/useI18n'
import './wizard.css'

interface ValidationSummary {
  errors: Array<{ message: string; fields?: string[] }>
  warnings: Array<{ message: string; fields?: string[] }>
  autoFixes?: Record<string, unknown>
}

const ADAPTER_PROJECTION_IDENTITY_KEYS = new Set([
  'lycoris_algo',
  'lora_type',
  'adapter_type',
  'network_module',
])

export interface WizardPageProps {
  typeId: string
  typeLabel: string
  draft: Record<string, unknown>
  displayDraft: Record<string, unknown>
  managedKeys: ReadonlySet<string>
  managedMessage: string
  validation: ValidationSummary
  explicitFields: string[]
  schemaRev: number
  igniting: boolean
  onTypeChange: (typeId: string) => void
  onChange: (key: string, raw: unknown) => void
  onHelp: (field: SchemaField) => void
  onApplySuggestions: (values: Record<string, unknown>) => void
  onExpert: () => void
  onPreflight: () => void
  onSaved: () => void
  onRestoreLast: () => void
  onFlushDraft: () => void
  onClearDraft: () => void
  onReset: () => void
  onLaunch: () => void
  onNavigateMonitor: () => void
}

function stepIndex(steps: WizardStepDefinition[], id: WizardStepId) {
  return steps.findIndex((step) => step.id === id)
}

function preflightMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    return String(item.message ?? item.detail ?? item.error ?? JSON.stringify(value))
  }
  return String(value)
}

function SectionBehaviors({
  step,
  config,
  explicitFields,
  onChange,
  onApplySuggestions,
}: {
  step: WizardStepDefinition
  config: Record<string, unknown>
  explicitFields: string[]
  onChange: (key: string, raw: unknown) => void
  onApplySuggestions: (values: Record<string, unknown>) => void
}) {
  return (
    <>
      {step.sourceSections.some((section) => section.id === 'training-intent-profile') ? (
        <TrainingIntentProfilePreview config={config} explicitFields={explicitFields} onApplySuggestions={onApplySuggestions} />
      ) : null}
      {step.sourceSections.some((section) => section.id === 'weight-composer') ? (
        <WeightComposerPreview config={config} onChange={onChange} />
      ) : null}
      {step.sourceSections.some((section) => section.id === 'progressive-training') && step.fields.some((field) => field.key === 'progressive_phase_schedule') ? (
        <ProgressivePhaseEditor value={config.progressive_phase_schedule} onChange={(raw) => onChange('progressive_phase_schedule', raw)} />
      ) : null}
    </>
  )
}

function StepRail({
  steps,
  active,
  completed,
  stale,
  errors,
  onSelect,
  t,
}: {
  steps: WizardStepDefinition[]
  active: WizardStepId
  completed: WizardStepId[]
  stale: WizardStepId[]
  errors: Set<WizardStepId>
  onSelect: (id: WizardStepId) => void
  t: TranslateFn
}) {
  return (
    <WizardRail>
      <div className="lx-w-rail-title">TRAINING FLOW</div>
      <ol>
        {steps.map((step, index) => {
          const isComplete = completed.includes(step.id)
          const isStale = stale.includes(step.id)
          const isLocked = index > 0 && !completed.includes(steps[index - 1]?.id)
          const status = errors.has(step.id) ? 'error' : isStale ? 'stale' : isComplete ? 'complete' : isLocked ? 'locked' : step.id === active ? 'active' : 'pending'
          const labelKey = `wizard.step.${step.id}`
          const label = t(labelKey) === labelKey ? step.label : t(labelKey)
          return (
            <StepCard
              key={step.id}
              index={String(index + 1).padStart(2, '0')}
              label={label}
              status={status}
              disabled={isLocked}
              onSelect={() => onSelect(step.id)}
            >
              <small>{t(`wizard.status.${status}`)}</small>
            </StepCard>
          )
        })}
      </ol>
    </WizardRail>
  )
}

function TypeChoices({
  category,
  selected,
  disabled,
  onSelect,
  t,
  language,
}: {
  category?: WizardCategory
  selected: string
  disabled?: boolean
  onSelect: (id: string) => void
  t: TranslateFn
  language: string
}) {
  const categories = category ? [category] : wizardCategories()
  return (
    <div className="lx-w-type-picker">
      {categories.map((item) => {
        const types = visibleTypesForCategory(item)
        const catKey = `wizard.category.${item}`
        const descKey = `wizard.category.${item}_desc`
        const title = t(catKey) === catKey ? WIZARD_CATEGORY_LABELS[item] : t(catKey)
        const desc = t(descKey) === descKey ? WIZARD_CATEGORY_DESCRIPTIONS[item] : t(descKey)
        return (
          <section key={item} className={['lx-w-category', category === item ? 'is-selected' : ''].filter(Boolean).join(' ')}>
            <div className="lx-w-category-head">
              <div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
              <span>{types.length} plans</span>
            </div>
            <div className="lx-w-choice-grid">
              {types.map((type) => {
                // 类型级入口标注（registry note）：实验/未验证属性必须在选卡处可见，
                // 而不是只藏在 TrainPage 侧栏的 title 里。EN 走 note_en 通道。
                // 标注放在按钮**之外**并用 aria-describedby 关联：留在按钮内会被拼进
                // 可访问名（"标准 LoRA" + id + 整段标注），使卡片的名字随文案漂移。
                // 视觉上收进卡片右上角的角标，悬停/聚焦时展开悬浮窗，保持网格整齐。
                const note = resolveTypeNote(type, language)
                const noteId = `lx-w-note-${type.id}`
                return (
                  <div key={type.id} className="lx-w-choice-cell">
                    <button type="button" disabled={disabled} aria-pressed={selected === type.id} aria-describedby={note ? noteId : undefined} className={['lx-w-choice', selected === type.id ? 'is-selected' : ''].filter(Boolean).join(' ')} onClick={() => onSelect(type.id)}>
                      <strong>{type.label}</strong>
                      <small>{type.id}</small>
                      {note ? (
                        <span className="lx-w-note-dot" aria-hidden="true">
                          <FlaskConical size={11} strokeWidth={2.4} />
                        </span>
                      ) : null}
                    </button>
                    {note ? (
                      <span id={noteId} role="note" className="lx-w-note-pop">{note}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CategoryChoices({
  selected,
  disabled,
  onSelect,
  t,
}: {
  selected: WizardCategory
  disabled?: boolean
  onSelect: (category: WizardCategory) => void
  t: TranslateFn
}) {
  return (
    <div className="lx-w-category-picker">
      {wizardCategories().map((category) => {
        const catKey = `wizard.category.${category}`
        const descKey = `wizard.category.${category}_desc`
        const title = t(catKey) === catKey ? WIZARD_CATEGORY_LABELS[category] : t(catKey)
        const desc = t(descKey) === descKey ? WIZARD_CATEGORY_DESCRIPTIONS[category] : t(descKey)
        return (
          <button
            key={category}
            type="button"
            disabled={disabled}
            aria-pressed={selected === category}
            className={['lx-w-category-choice', selected === category ? 'is-selected' : ''].filter(Boolean).join(' ')}
            onClick={() => onSelect(category)}
          >
            <strong>{title}</strong>
            <span>{desc}</span>
            <small>{visibleTypesForCategory(category).length} plans</small>
          </button>
        )
      })}
    </div>
  )
}

function formatSummaryValue(value: unknown, t: TranslateFn): string {
  if (value === true) return t('wizard.value.enabled')
  if (value === false) return t('wizard.value.disabled')
  if (value === '' || value === null || value === undefined) return t('wizard.value.unset')
  return displayValue(value)
}

function renderSummary(step: WizardStepDefinition, draft: Record<string, unknown>, t: TranslateFn) {
  const fields = step.fields.filter((field) => isFieldVisible(field, draft))
  if (!fields.length) return <p className="lx-w-empty">{t('wizard.summary.empty')}</p>
  const visible = fields.slice(0, 12)
  const rest = fields.slice(12)
  return (
    <div className="lx-w-summary-grid">
      {visible.map((field) => (
        <div key={field.key} className="lx-w-summary-row">
          <span>{field.label || field.title || field.key}</span>
          <b>{formatSummaryValue(draft[field.key], t)}</b>
        </div>
      ))}
      {rest.length > 0 ? (
        <details>
          <summary>{t('wizard.summary.show_all', { n: fields.length - 12 })}</summary>
          {rest.map((field) => (
            <div key={field.key} className="lx-w-summary-row">
              <span>{field.label || field.title || field.key}</span>
              <b>{formatSummaryValue(draft[field.key], t)}</b>
            </div>
          ))}
        </details>
      ) : null}
    </div>
  )
}

export function WizardPage(props: WizardPageProps) {
  const wizard = useWizardStore()
  // language 参与依赖：adapterModel 的卡片文案经 getState() 非响应式读取当前语言，
  // memo 必须在语言切换时重算，否则停在 adapter 步切语言后卡片文案不跟随。
  const { t, language } = useI18n()
  // 「用户显式编辑过」的键集（TrainPage 会话 ref + 持久化 wizard 记录的并集）：
  // 提交层靠它区分注入默认与手填值（krea2 aggressive 预设剥除等）。
  const explicitKeySet = useMemo(() => new Set(props.explicitFields), [props.explicitFields])
  const projection = useMemo(() => {
    // schemaRev 是失效令牌:buildWizardProjection 读模块级 schema 缓存,schema 热更新后入参
    // 不变也要重算 —— 在回调里消费它,依赖保持真实。
    void props.schemaRev
    return buildWizardProjection(props.typeId, props.displayDraft)
  }, [props.typeId, props.displayDraft, props.schemaRev])
  const steps = projection.steps
  const validStepIds = steps.map((step) => step.id)
  const persistedActive = wizard.activeStepByType[props.typeId]
  const activeId = validStepIds.includes(persistedActive) ? persistedActive : 'type'
  const activeStep = steps.find((step) => step.id === activeId) || steps[0]
  const completed = wizard.completedStepsByType[props.typeId] || []
  const stale = wizard.staleStepsByType[props.typeId] || []
  const [preflightBusy, setPreflightBusy] = useState(false)
  const persistedCategory = wizard.categoryByType[props.typeId] as WizardCategory | undefined
  const [selectedCategory, setSelectedCategory] = useState<WizardCategory>(persistedCategory || projection.category)
  const [typeGateError, setTypeGateError] = useState(false)
  const [modelGateError, setModelGateError] = useState(false)
  const [showStepAlert, setShowStepAlert] = useState(false)

  const currentStepValidation = useMemo(() => {
    if (!activeStep) return { errors: [], warnings: [], requiredKeys: [] }
    return validateWizardStep(activeStep, props.displayDraft, props.typeId)
  }, [activeStep, props.displayDraft, props.typeId])

  const invalidFieldKeys = useMemo(() => {
    const set = new Set<string>()
    if (activeStep) {
      for (const err of currentStepValidation.errors) {
        for (const reqKey of currentStepValidation.requiredKeys) {
          if (err.includes(reqKey) || !String(props.displayDraft[reqKey] ?? '').trim()) {
            set.add(reqKey)
          }
        }
      }
    }
    return set
  }, [activeStep, currentStepValidation, props.displayDraft])

  const stepValidationSummary = useMemo(() => {
    if (!showStepAlert || !currentStepValidation.errors.length) return null
    return currentStepValidation.errors.map((msg) => {
      const match = currentStepValidation.requiredKeys.find((k) => msg.includes(k) || !String(props.displayDraft[k] ?? '').trim())
      return { msg, key: match }
    })
  }, [showStepAlert, currentStepValidation, props.displayDraft])

  const stepLabel = (step: WizardStepDefinition | undefined) => {
    if (!step) return t('wizard.title')
    const key = wizardStepLabelKey(step.id)
    const translated = t(key)
    return translated === key ? step.label : translated
  }

  const stepDesc = (step: WizardStepDefinition | undefined) => {
    if (!step) return ''
    const key = `wizard.step_desc.${step.id}`
    const translated = t(key)
    return translated === key ? step.description : translated
  }

  const stepErrors = useMemo(() => {
    const set = new Set<WizardStepId>()
    for (const step of steps) {
      if (step.id === 'type' || step.id === 'model' || step.id === 'review') continue
      const result = validateWizardStep(step, props.displayDraft, props.typeId)
      if (result.errors.length) set.add(step.id)
    }
    if (props.validation.errors.length) set.add('review')
    return set
  }, [steps, props.displayDraft, props.typeId, props.validation.errors])

  const currentPayload = useMemo(() => {
    // schemaRev 失效令牌,见 projection 处说明(buildRunConfig 读模块级 schema 状态)。
    void props.schemaRev
    return buildRunConfig(props.draft, props.typeId, { explicitKeys: explicitKeySet })
  }, [props.draft, props.typeId, props.schemaRev, explicitKeySet])
  const defaultsConfig = useMemo(() => createDefaultConfig(props.typeId), [props.typeId])
  const storedPreflight = wizard.preflightByType[props.typeId]
  const preflightCurrent = isPreflightCurrent(storedPreflight, props.typeId, props.schemaRev, currentPayload)
  const preflight = preflightCurrent ? storedPreflight?.report || null : null
  const preflightSummary = normalizePreflightReport(preflight)

  useEffect(() => {
    wizard.hydrateType(props.typeId, validStepIds)
  // validStepIds is derived from the schema and should not retrigger on each draft edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.typeId, props.schemaRev, validStepIds.join('|')])

  // 进入 type 步(或持久化分类/投影变化)时同步所选分类:渲染期 props→state 调整模式,
  // setState 不在 effect 体内同步触发。
  const [categorySync, setCategorySync] = useState(() => ({ activeId, persistedCategory, fallback: projection.category }))
  if (categorySync.activeId !== activeId || categorySync.persistedCategory !== persistedCategory || categorySync.fallback !== projection.category) {
    setCategorySync({ activeId, persistedCategory, fallback: projection.category })
    if (activeId === 'type') setSelectedCategory(persistedCategory || projection.category)
  }

  // 自动复检:stale 或未完成的可见步骤重新跑校验,通过后恢复完成(不再标记 stale)。
  // 仅 markComplete,绝不 markStaleFrom,避免死循环。
  useEffect(() => {
    const typeId = props.typeId
    const staleSteps = wizard.staleStepsByType[typeId] || []
    const completedSteps = wizard.completedStepsByType[typeId] || []
    const completedSet = new Set(completedSteps)
    const staleSet = new Set(staleSteps)
    const nowCompleted = new Set(completedSet)
    const nowStale = new Set(staleSet)
    for (const id of WIZARD_STEP_ORDER) {
      if (id === 'type' || id === 'model' || id === 'review') continue
      const step = steps.find((s) => s.id === id)
      if (!step) continue
      if (nowCompleted.has(id) && !nowStale.has(id)) continue
      const result = validateWizardStep(step, props.displayDraft, props.typeId)
      if (result.errors.length === 0) {
        nowCompleted.add(id)
        nowStale.delete(id)
        if (!completedSet.has(id)) wizard.markComplete(typeId, id)
      }
    }
    // review 步骤本身无字段:当前置步骤全部完成且无本地校验错误时恢复完成,
    // 避免 review 一直被标 stale 导致永远无法启动。
    const othersComplete = steps
      .filter((s) => s.id !== 'review')
      .every((s) => nowCompleted.has(s.id) && !nowStale.has(s.id))
    if (othersComplete && props.validation.errors.length === 0 && (!completedSet.has('review') || staleSet.has('review'))) {
      wizard.markComplete(typeId, 'review')
    }
  // 依赖投影/类型/版本/向导 stale 与 completed 状态变化时复检
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, props.typeId, props.schemaRev, validStepIds.join('|'), wizard.staleStepsByType[props.typeId], wizard.completedStepsByType[props.typeId]])

  const chooseType = (nextType: string) => {
    // 用目标类型自己的投影找 model 的下一可见步：finetune 等无适配器面的类型
    // adapter 步不可见，沿用当前（旧类型）投影会把 activeStep 指到隐藏步，
    // 回落 steps[0]='type' 造成"选完类型原地踏步"。
    const stepList = nextType === props.typeId ? projection.steps : buildWizardProjection(nextType, {}).steps
    wizard.setCategory(nextType, selectedCategory)
    props.onTypeChange(nextType)
    wizard.markComplete(nextType, 'type')
    wizard.markComplete(nextType, 'model')
    const modelIdx = stepIndex(stepList, 'model')
    const nextIdx = Math.max(0, Math.min(stepList.length - 1, modelIdx + 1))
    const nextStep = stepList[nextIdx]
    if (nextStep) {
      wizard.setActiveStep(nextType, nextStep.id)
      wizard.markStaleFrom(nextType, nextStep.id)
    }
    setModelGateError(false)
  }

  const canNavigateTo = (id: WizardStepId) => {
    const index = stepIndex(steps, id)
    if (index <= 0) return true
    return steps.slice(0, index).every((step) => completed.includes(step.id))
  }

  const validateCurrent = () => {
    if (!activeStep) return true
    if (activeStep.id === 'type') {
      if (!selectedCategory) {
        setTypeGateError(true)
        return false
      }
      setTypeGateError(false)
      return true
    }
    if (activeStep.id === 'model') {
      const typeOk = Boolean(props.typeId) && categoryForTrainingType(props.typeId) === selectedCategory
      if (!typeOk) {
        setModelGateError(true)
        return false
      }
      setModelGateError(false)
      const result = validateWizardStep(activeStep, props.displayDraft, props.typeId)
      if (result.errors.length) {
        setShowStepAlert(true)
        return false
      }
      setShowStepAlert(false)
      wizard.markComplete(props.typeId, 'model')
      return true
    }
    const result = validateWizardStep(activeStep, props.displayDraft, props.typeId)
    if (result.errors.length) {
      setShowStepAlert(true)
      return false
    }
    setShowStepAlert(false)
    wizard.markComplete(props.typeId, activeStep.id)
    return true
  }

  const goTo = (id: WizardStepId) => {
    if (!canNavigateTo(id)) return
    setShowStepAlert(false)
    wizard.setActiveStep(props.typeId, id)
  }

  const next = () => {
    if (!validateCurrent()) return
    setShowStepAlert(false)
    const nextIndex = Math.min(steps.length - 1, stepIndex(steps, activeId) + 1)
    const nextStep = steps[nextIndex]
    if (nextStep) wizard.setActiveStep(props.typeId, nextStep.id)
  }

  const previous = () => {
    setShowStepAlert(false)
    const previousStep = steps[Math.max(0, stepIndex(steps, activeId) - 1)]
    if (previousStep) wizard.setActiveStep(props.typeId, previousStep.id)
  }

  const runPreflight = async () => {
    setPreflightBusy(true)
    try {
      const { trainApi } = await import('@/api/trainApi')
      const { unwrap } = await import('@/api/transport')
      const payload = buildRunConfig(props.draft, props.typeId, { explicitKeys: explicitKeySet })
      const report = unwrap<Record<string, unknown>>(await trainApi.preflight(payload))
      const snapshot: PreflightSnapshot = {
        typeId: props.typeId,
        schemaRev: props.schemaRev,
        fingerprint: fingerprintPayload(payload),
        report: report && typeof report === 'object' ? report : { result: report },
        warningConfirmed: false,
        createdAt: Date.now(),
      }
      wizard.setPreflight(props.typeId, snapshot)
    } catch (error) {
      const payload = buildRunConfig(props.draft, props.typeId, { explicitKeys: explicitKeySet })
      wizard.setPreflight(props.typeId, {
        typeId: props.typeId,
        schemaRev: props.schemaRev,
        fingerprint: fingerprintPayload(payload),
        report: { errors: [(error as Error).message] },
        warningConfirmed: false,
        createdAt: Date.now(),
      })
    } finally {
      setPreflightBusy(false)
    }
  }

  const allStepsComplete = steps.filter((step) => step.id !== 'review').every((step) => completed.includes(step.id))
  const noStaleSteps = !steps.some((step) => step.id !== 'review' && stale.includes(step.id))
  const preflightErrors = preflightSummary.blocking
  const preflightWarnings = preflightSummary.confirmable
  const launchDisabled = props.validation.errors.length > 0 || !allStepsComplete || !noStaleSteps || preflightBusy || !preflightCurrent || preflightErrors.length > 0 || (preflightWarnings.length > 0 && !storedPreflight?.warningConfirmed) || props.igniting

  const adapterChoices = useMemo(() => {
    // language 失效令牌:adapterOptions 经 getState() 非响应式读取当前语言,
    // memo 必须在语言切换时重算(见组件顶部说明),故在回调里消费它。
    void language
    return activeStep?.id === 'adapter' ? adapterOptions(props.displayDraft, props.typeId) : []
  }, [activeStep?.id, props.displayDraft, props.typeId, language])

  // 三层信息架构：基础算法（Tab+方法下拉）／叠加增强／实体注入器。
  const baseGroups = useMemo(() => {
    return groupAdapterOptionsByCategory(adapterChoices.filter((opt) => opt.tier === 'base'))
  }, [adapterChoices])

  const enhanceOptions = useMemo(
    () => adapterChoices.filter((opt) => opt.tier === 'enhance'),
    [adapterChoices],
  )

  const entityOptions = useMemo(
    () => adapterChoices.filter((opt) => opt.tier === 'entity'),
    [adapterChoices],
  )

  const hasBaseTier = useMemo(
    () => ADAPTER_CATEGORIES.some((cat) => (baseGroups[cat.id] || []).length > 0),
    [baseGroups],
  )

  const selectedAdapterOption = useMemo(() => {
    // Tab 同步与摘要卡只跟随基础算法层；叠加增强/实体注入器不改变大类归属。
    return adapterChoices.find((opt) => opt.tier === 'base' && opt.selected)
  }, [adapterChoices])

  const defaultCategory = useMemo<AdapterCategoryKey>(() => {
    if (selectedAdapterOption) return adapterCategoryForFamily(selectedAdapterOption.family)
    return 'lora'
  }, [selectedAdapterOption])

  const [activeAdapterCategory, setActiveAdapterCategory] = useState<AdapterCategoryKey>(defaultCategory)

  // Sync category tab if winner changes externally (or upon entering adapter step):
  // 渲染期 props→state 调整模式,setState 不在 effect 体内同步触发。
  const selectedFamily = selectedAdapterOption?.family
  const [prevSelectedFamily, setPrevSelectedFamily] = useState(selectedFamily)
  if (prevSelectedFamily !== selectedFamily) {
    setPrevSelectedFamily(selectedFamily)
    if (selectedFamily) setActiveAdapterCategory(adapterCategoryForFamily(selectedFamily))
  }

  // Never leave the roving tab stop on an unavailable category.
  // 同为渲染期派生状态调整:回退目标必有非空分组,下一帧条件即不成立,不会循环。
  if (activeStep?.id === 'adapter' && (baseGroups[activeAdapterCategory] || []).length === 0) {
    const selected = selectedFamily ? adapterCategoryForFamily(selectedFamily) : undefined
    const fallback = selected && (baseGroups[selected] || []).length > 0
      ? selected
      : ADAPTER_CATEGORIES.find((category) => (baseGroups[category.id] || []).length > 0)?.id
    if (fallback) setActiveAdapterCategory(fallback)
  }

  // Any schema flag represented by an adapter option is a master control. Keep
  // its full schema definition for Expert mode, but avoid a second wizard input.
  // The DoRA weight-decomposition rider claims its own alias keys the same way
  // (dora_enabled/use_dora/dora_wd) — they are rendered as one toggle below.
  const adapterMasterKeys = useMemo(
    () => new Set(adapterChoices.flatMap((option) => [...option.enables, ...option.hides])),
    [adapterChoices],
  )

  const doraRider = useMemo(
    () => {
      // language 失效令牌,见 adapterChoices 处说明。
      void language
      return activeStep?.id === 'adapter' ? doraToggleState(props.displayDraft, props.typeId) : null
    },
    [activeStep?.id, props.displayDraft, props.typeId, language],
  )

  // 类型专属硬限制（FLUX 仅原生 lora / MiniMax-H3 拒 LyCORIS 与 DoRA / Anima 别名体系）
  // 用提示文案显性化，而不是静默隐藏可选项。
  const adapterRestrictionNotice = useMemo(
    () => (activeStep?.id === 'adapter' ? adapterRestrictionNoticeKey(props.typeId) : null),
    [activeStep?.id, props.typeId],
  )

  const adapterProjectionHiddenKeys = useMemo(() => {
    const keys = new Set(adapterMasterKeys)
    for (const key of doraRider?.managedKeys ?? []) keys.add(key)
    return keys
  }, [adapterMasterKeys, doraRider])

  const onDoraRiderToggle = (next: boolean) => {
    if (!doraRider?.available || !doraRider.supported || !doraRider.masterKey) return
    const values: Record<string, unknown> = {}
    for (const key of doraRider.managedKeys) values[key] = next ? key === doraRider.masterKey : false
    for (const key of Object.keys(values)) props.onChange(key, values[key])
    wizard.markStaleFrom(props.typeId, 'adapter')
    wizard.markExplicit(props.typeId, Object.keys(values))
  }

  const onAdapterChoice = (option: AdapterOption) => {
    if (option.compatibility === 'unsupported') return
    const values = buildAdapterSelection(props.displayDraft, option)
    applyAdapterValues(values, Object.keys(values))
  }

  // 叠加增强/实体注入器开关的「关」路径：旗标清零 + 身份字段回落标准 LoRA，
  // 再经互斥归一，让赢家解析回 default lora 而不是残留在旧 module 上。
  const onAdapterToggleOff = (option: AdapterOption) => {
    if (option.compatibility === 'unsupported') return
    const values = buildAdapterDeselection(props.typeId, option)
    applyAdapterValues(values, [])
  }

  const applyAdapterValues = (values: Record<string, unknown>, explicitKeys: string[]) => {
    const next = normalizeAdapterEntityMutex({ ...props.displayDraft, ...values }) as Record<string, unknown>
    for (const key of Object.keys(next)) {
      if (getFieldDefinition(key, props.typeId) && next[key] !== props.displayDraft[key]) {
        props.onChange(key, next[key] ?? '')
      }
    }
    wizard.markStaleFrom(props.typeId, 'adapter')
    wizard.markExplicit(props.typeId, explicitKeys.length > 0 ? explicitKeys : Object.keys(values))
  }

  const handleCategoryKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const enabledCategories = ADAPTER_CATEGORIES.filter((cat) => (baseGroups[cat.id] || []).length > 0)
    const currentEnabledIndex = enabledCategories.findIndex((cat) => cat.id === ADAPTER_CATEGORIES[currentIndex].id)
    if (currentEnabledIndex === -1) return

    let nextCat: AdapterCategoryKey | undefined
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const nextIndex = (currentEnabledIndex + 1) % enabledCategories.length
      nextCat = enabledCategories[nextIndex].id
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prevIndex = (currentEnabledIndex - 1 + enabledCategories.length) % enabledCategories.length
      nextCat = enabledCategories[prevIndex].id
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextCat = enabledCategories[0]?.id
    } else if (e.key === 'End') {
      e.preventDefault()
      nextCat = enabledCategories[enabledCategories.length - 1]?.id
    }

    if (nextCat) {
      setActiveAdapterCategory(nextCat)
      const tabEl = document.getElementById(`lx-adapter-category-tab-${nextCat}`)
      tabEl?.focus()
    }
  }

  const stepErrorAlert = stepValidationSummary ? (
    <div id="lx-w-step-error-alert" className="lx-w-alert is-error" role="alert" style={{ marginBottom: 16 }}>
      <b>{t('wizard.errors.step_invalid')}</b>
      {stepValidationSummary.map((err, idx) => (
        <button
          key={`${err.key || 'step'}-${idx}`}
          type="button"
          style={{
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: 'inherit',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
          }}
          onClick={() => {
            if (!err.key) return
            const target = document.getElementById(`lx-input-${err.key}`) || document.getElementById(`lx-field-ctrl-${err.key}`)
            if (!target) return
            target.scrollIntoView({ behavior: 'smooth', block: 'center' })
            target.focus()
          }}
        >
          • {err.msg}
        </button>
      ))}
    </div>
  ) : null

  return (
    <WizardShell>
      <StepRail steps={steps} active={activeId} completed={completed} stale={stale} errors={stepErrors} onSelect={goTo} t={t} />
      <WizardContent>
        <WizardHeader>
          <div>
            <span className="lx-w-eyebrow">BEGINNER TRAINING SETUP</span>
            <h1>{stepLabel(activeStep)}</h1>
            <p>{stepDesc(activeStep)}</p>
          </div>
          <div className="lx-w-header-actions">
            <Button onClick={props.onExpert}>{t('wizard.actions.expert')}</Button>
            <Button onClick={props.onSaved}>{t('wizard.actions.presets')}</Button>
            <Button onClick={props.onRestoreLast}>{t('wizard.actions.last')}</Button>
          </div>
        </WizardHeader>

        {stepErrorAlert}

        {activeId === 'type' ? (
          <>
            <CategoryChoices
              selected={selectedCategory}
              disabled={props.igniting}
              t={t}
              onSelect={(category) => {
                setSelectedCategory(category)
                wizard.setCategory(props.typeId, category)
                wizard.markComplete(props.typeId, 'type')
                wizard.markStaleFrom(props.typeId, 'type')
                wizard.setActiveStep(props.typeId, 'model')
                setTypeGateError(false)
              }}
            />
            {typeGateError ? <p className="lx-w-gate-error" role="alert">{t('wizard.type.choose_hint')}</p> : null}
          </>
        ) : null}

        {activeId === 'model' ? (
          <>
            <TypeChoices category={selectedCategory} selected={props.typeId} disabled={props.igniting} t={t} language={language} onSelect={chooseType} />
            {modelGateError ? <p className="lx-w-gate-error" role="alert">{t('wizard.type.choose_hint')}</p> : null}
          </>
        ) : null}

        {activeId === 'adapter' ? (
          <section className="lx-w-panel lx-w-fieldgroup">
            {adapterRestrictionNotice ? (
              <p className="lx-w-adapter-restriction" role="note">{t(adapterRestrictionNotice)}</p>
            ) : null}
            {hasBaseTier || enhanceOptions.length > 0 || entityOptions.length > 0 ? (
              <div className="lx-w-adapter-selector">
                {/* ── 第 1 层：基础算法（原生 LoRA / LyCORIS 家族／其他）─────────── */}
                {hasBaseTier ? (
                  <>
                    <div className="lx-w-adapter-tier-head">
                      <strong>{t('wizard.adapter.tier_base')}</strong>
                      <small>{t('wizard.adapter.tier_base_desc')}</small>
                    </div>
                    {/* 三大类分类入口 */}
                    <div className="lx-w-adapter-categories" role="tablist" aria-label={t('wizard.step.adapter')}>
                      {ADAPTER_CATEGORIES.map((cat, index) => {
                        const groupOptions = baseGroups[cat.id] || []
                        const count = groupOptions.length
                        const isSelected = activeAdapterCategory === cat.id
                        const hasActiveWinner = groupOptions.some((opt) => opt.selected)
                        return (
                          <button
                            key={cat.id}
                            id={`lx-adapter-category-tab-${cat.id}`}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            aria-controls={`lx-adapter-category-panel-${cat.id}`}
                            tabIndex={isSelected && count > 0 ? 0 : -1}
                            disabled={props.igniting || count === 0}
                            className={[
                              'lx-w-adapter-category-tab',
                              isSelected ? 'is-active' : '',
                              hasActiveWinner ? 'has-active-winner' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => {
                              setActiveAdapterCategory(cat.id)
                            }}
                            onKeyDown={(e) => handleCategoryKeyDown(e, index)}
                          >
                            <span className="lx-w-adapter-category-tab-head">
                              <strong>{t(cat.titleKey)}</strong>
                              <span className="lx-w-adapter-category-count">{count}</span>
                            </span>
                            <span className="lx-w-adapter-category-tab-desc">{t(cat.descKey)}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* 类别内具体训练方式紧凑选择器 + 摘要 */}
                    {ADAPTER_CATEGORIES.map((panelCategory) => {
                      const isActive = panelCategory.id === activeAdapterCategory
                      return (
                        <div
                          key={panelCategory.id}
                          id={`lx-adapter-category-panel-${panelCategory.id}`}
                          role="tabpanel"
                          aria-labelledby={`lx-adapter-category-tab-${panelCategory.id}`}
                          className="lx-w-adapter-method-box"
                          hidden={!isActive}
                          tabIndex={isActive ? 0 : -1}
                        >
                          {isActive && (baseGroups[panelCategory.id] || []).length > 0 ? <>
                      <div className="lx-w-adapter-method-control">
                        <label htmlFor={`lx-adapter-method-select-${panelCategory.id}`} className="lx-w-adapter-method-label">
                          <span>{t('wizard.adapter.method_select')}</span>
                          <small>{t('wizard.adapter.method_select_desc')}</small>
                        </label>
                        <select
                          id={`lx-adapter-method-select-${panelCategory.id}`}
                          aria-label={t('wizard.adapter.method_select')}
                          className="lx-field-select lx-w-adapter-select"
                          disabled={props.igniting}
                          value={
                            (baseGroups[panelCategory.id] || []).find((opt) => opt.selected)?.id || ''
                          }
                          onChange={(e) => {
                            const targetId = e.target.value
                            if (!targetId) return
                            const opt = (baseGroups[panelCategory.id] || []).find((item) => item.id === targetId)
                            if (opt) onAdapterChoice(opt)
                          }}
                        >
                          <option value="" disabled>
                            {t('wizard.adapter.method_placeholder')}
                          </option>
                          {(baseGroups[panelCategory.id] || []).map((opt) => {
                            const isUnsupported = opt.compatibility === 'unsupported'
                            return (
                              <option key={opt.id} value={opt.id} disabled={isUnsupported}>
                                {opt.label}{opt.compatibility === 'legacy' ? ' (Legacy)' : ''}{isUnsupported ? ` [${opt.disabledReason || 'Unsupported'}]` : ''}
                              </option>
                            )
                          })}
                        </select>
                      </div>

                      {/* 当前方法摘要展示卡 */}
                      {(() => {
                        const currentOpt = (baseGroups[panelCategory.id] || []).find((opt) => opt.selected)
                        if (!currentOpt) {
                          return (
                            <div className="lx-w-adapter-summary-card is-empty">
                              <div className="lx-w-adapter-summary-header">
                                <span className="lx-w-adapter-summary-badge">UNSET</span>
                                <strong>{t('wizard.adapter.method_placeholder')}</strong>
                              </div>
                              <p>{t('wizard.adapter.no_selection_summary')}</p>
                            </div>
                          )
                        }
                        const unsupported = currentOpt.compatibility === 'unsupported'
                        const desc = unsupported
                          ? `${t('wizard.adapter.option_unavailable')}${currentOpt.disabledReason || currentOpt.description}`
                          : `${currentOpt.description}${currentOpt.compatibility === 'legacy' ? t('wizard.adapter.legacy_suffix') : ''}`
                        return (
                          <div className={['lx-w-adapter-summary-card', unsupported ? 'is-unsupported' : ''].filter(Boolean).join(' ')}>
                            <div className="lx-w-adapter-summary-header">
                              <span className="lx-w-adapter-summary-badge">
                                {unsupported ? 'UNSUPPORTED' : currentOpt.compatibility === 'legacy' ? 'LEGACY' : 'ACTIVE METHOD'}
                              </span>
                              <strong>{currentOpt.label}</strong>
                            </div>
                            <p>{desc}</p>
                          </div>
                        )
                      })()}
                          </> : null}
                        </div>
                      )
                    })}
                  </>
                ) : null}

                {/* ── 第 2 层：叠加增强（不改 ΔW 实体身份）─────────────────────── */}
                {enhanceOptions.length > 0 || doraRider?.available ? (
                  <div className="lx-w-adapter-enhancers">
                    <div className="lx-w-adapter-tier-head">
                      <strong>{t('wizard.adapter.tier_enhance')}</strong>
                      <small>{t('wizard.adapter.tier_enhance_desc')}</small>
                    </div>
                    {enhanceOptions.map((opt) => {
                      const flagKey = opt.enables[0]
                      const conflictLabel = !opt.selected && flagKey
                        ? getAdapterEntityConflict(flagKey, props.displayDraft)
                        : ''
                      const unavailable = opt.compatibility === 'unsupported'
                      const reason = unavailable
                        ? (opt.disabledReason || t('wizard.adapter.option_unavailable'))
                        : conflictLabel
                          ? t('wizard.adapter.mutex_conflict', { name: conflictLabel })
                          : opt.description
                        return (
                          <label
                            key={opt.id}
                            className={['lx-w-adapter-toggle', opt.selected ? 'is-active' : '', unavailable || conflictLabel ? 'is-blocked' : ''].filter(Boolean).join(' ')}
                          >
                            <input
                              type="checkbox"
                              aria-label={opt.label}
                              checked={opt.selected}
                              disabled={props.igniting || unavailable || Boolean(conflictLabel)}
                              onChange={(event) => (event.target.checked ? onAdapterChoice(opt) : onAdapterToggleOff(opt))}
                            />
                            <span className="lx-w-adapter-toggle-body">
                              <span>{opt.label}</span>
                              <small>{reason}</small>
                            </span>
                          </label>
                        )
                    })}
                    {/* DoRA 权重分解：叠加在所选算法上的开关，不是独立算法选项 */}
                    {doraRider?.available ? (
                      <div className={['lx-w-dora-rider', doraRider.supported ? '' : 'is-unsupported'].filter(Boolean).join(' ')}>
                        <label className="lx-w-dora-rider-control">
                          <input
                            type="checkbox"
                            checked={doraRider.enabled}
                            disabled={props.igniting || !doraRider.supported}
                            aria-label={t('wizard.adapter.dora_toggle')}
                            onChange={(event) => onDoraRiderToggle(event.target.checked)}
                          />
                          <span>{t('wizard.adapter.dora_toggle')}</span>
                        </label>
                        <small>{
                          doraRider.supported
                            // 五站管线审计已全部转正（矩阵无 pending 行）：
                            // 提示文案收敛为单一实证结论。
                            ? t('wizard.adapter.dora_toggle_desc')
                            : t('wizard.adapter.dora_toggle_unsupported')
                        }</small>
                        {doraRider.supported && doraRider.familyNoteI18nKey ? (
                          <small>{t(doraRider.familyNoteI18nKey)}</small>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* ── 第 3 层：实体注入器（硬互斥）────────────────────────────── */}
                {entityOptions.length > 0 ? (
                  <div className="lx-w-adapter-entities">
                    <div className="lx-w-adapter-tier-head">
                      <strong>{t('wizard.adapter.tier_entity')}</strong>
                      <small>{t('wizard.adapter.tier_entity_desc')}</small>
                    </div>
                    <div className="lx-w-adapter-entity-grid">
                      {entityOptions.map((opt) => {
                        const flagKey = opt.enables[0]
                        const conflictLabel = !opt.selected && flagKey
                          ? getAdapterEntityConflict(flagKey, props.displayDraft)
                          : ''
                        const unavailable = opt.compatibility === 'unsupported'
                        const blocked = unavailable || Boolean(conflictLabel)
                        const reason = unavailable
                          ? (opt.disabledReason || t('wizard.adapter.option_unavailable'))
                          : conflictLabel
                            ? t('wizard.adapter.mutex_conflict', { name: conflictLabel })
                            : opt.description
                        return (
                          <label
                            key={opt.id}
                            title={blocked ? reason : undefined}
                            className={['lx-w-adapter-entity-card', opt.selected ? 'is-active' : '', blocked ? 'is-blocked' : ''].filter(Boolean).join(' ')}
                          >
                            <input
                              type="checkbox"
                              aria-label={opt.label}
                              checked={opt.selected}
                              disabled={props.igniting || blocked}
                              onChange={(event) => (event.target.checked ? onAdapterChoice(opt) : onAdapterToggleOff(opt))}
                            />
                            <span className="lx-w-adapter-toggle-body">
                              <span>{opt.label}</span>
                              <small>{reason}</small>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="lx-w-empty">{t('wizard.adapter.empty_step')}</p>
            )}

            {/* Wizard projection hides identity/master controls; Expert mode keeps the full schema. */}
            {activeStep?.fields.length ? (
              <div className="lx-w-fields lx-w-adapter-fields">
                {activeStep.fields
                  .filter((field) => !ADAPTER_PROJECTION_IDENTITY_KEYS.has(field.key) && !adapterProjectionHiddenKeys.has(field.key))
                  .map((field) => {
                    if (!isFieldVisible(field, props.displayDraft)) return null
                    const isReq = currentStepValidation.requiredKeys.includes(field.key)
                    const isErr = invalidFieldKeys.has(field.key)
                    return (
                      <FieldControl
                        key={field.key}
                        field={field}
                        value={props.displayDraft[field.key]}
                        isRequired={isReq}
                        isInvalid={isErr}
                        errorMessageId={isErr && showStepAlert ? 'lx-w-step-error-alert' : undefined}
                        onChange={(raw) => {
                          props.onChange(field.key, raw)
                          wizard.markExplicit(props.typeId, [field.key])
                          wizard.markStaleFrom(props.typeId, 'adapter')
                        }}
                        onHelp={props.onHelp}
                        disabled={props.managedKeys.has(field.key) || field.disabled === true}
                        disabledReason={
                          props.managedKeys.has(field.key) ? props.managedMessage
                          : field.disabled === true ? resolveDisabledReason(field, language)
                          : ''
                        }
                      />
                    )
                  })}
              </div>
            ) : null}
            {activeStep ? <SectionBehaviors step={activeStep} config={props.displayDraft} explicitFields={props.explicitFields} onChange={props.onChange} onApplySuggestions={props.onApplySuggestions} /> : null}
          </section>
        ) : null}

        {activeStep && !['type', 'model', 'adapter', 'review'].includes(activeStep.id) ? (
          <section className="lx-w-panel lx-w-fieldgroup">
            {activeStep.fields.length === 0 ? <p className="lx-w-empty">{t('wizard.step.no_extra_settings')}</p> : null}
            <div className="lx-w-fields">
              {activeStep.fields.filter((field) => !(field.key === 'progressive_phase_schedule' && activeStep.sourceSections.some((section) => section.id === 'progressive-training'))).map((field) => {
                if (!isFieldVisible(field, props.displayDraft)) return null
                const isReq = currentStepValidation.requiredKeys.includes(field.key)
                const isErr = invalidFieldKeys.has(field.key)
                return (
                  <FieldControl
                    key={field.key}
                    field={field}
                    value={props.displayDraft[field.key]}
                    isRequired={isReq}
                    isInvalid={isErr}
                    errorMessageId={isErr && showStepAlert ? 'lx-w-step-error-alert' : undefined}
                    onChange={(raw) => {
                      props.onChange(field.key, raw)
                      wizard.markExplicit(props.typeId, [field.key])
                      wizard.markStaleFrom(props.typeId, activeStep.id)
                    }}
                    onHelp={props.onHelp}
                    disabled={props.managedKeys.has(field.key) || field.disabled === true}
                    disabledReason={
                      props.managedKeys.has(field.key) ? props.managedMessage
                      : field.disabled === true ? String(field.disabledReason || '')
                      : ''
                    }
                  />
                )
              })}
            </div>
            <SectionBehaviors step={activeStep} config={props.displayDraft} explicitFields={props.explicitFields} onChange={props.onChange} onApplySuggestions={props.onApplySuggestions} />
          </section>
        ) : null}

        {activeId === 'review' ? (
          <section className="lx-w-review">
            <div className="lx-w-review-head">
              <div>
                <span className="lx-w-eyebrow">FINAL CHECK</span>
                <h2>{props.typeLabel}</h2>
                <p>{props.typeId} · schema rev {props.schemaRev}</p>
              </div>
              <Button onClick={() => void runPreflight()} disabled={preflightBusy}>{preflightBusy ? t('wizard.actions.preflight_running') : t('wizard.actions.preflight')}</Button>
            </div>
            <div className="lx-w-review-sections">
              {steps.filter((step) => !['type', 'model', 'review'].includes(step.id)).map((step) => {
                const fieldKeys = new Set(step.fields.map((f) => f.key))
                const explicitForStep = props.explicitFields.filter((k) => fieldKeys.has(k))
                const managedForStep = step.fields.map((f) => f.key).filter((k) => props.managedKeys.has(k))
                const diffs = step.fields
                  .filter((field) => isFieldVisible(field, props.displayDraft))
                  .map((field) => ({ field, current: props.displayDraft[field.key], def: defaultsConfig[field.key] }))
                  .filter(({ current, def }) => {
                    const nonEmpty = current !== '' && current !== null && current !== undefined
                    if (!nonEmpty) return false
                    const different = Array.isArray(current) || Array.isArray(def)
                      ? JSON.stringify(current) !== JSON.stringify(def)
                      : current !== def
                    return different
                  })
                return (
                  <ReviewSection key={step.id} title={stepLabel(step)} onEdit={() => goTo(step.id)}>
                    {renderSummary(step, props.displayDraft, t)}
                    {explicitForStep.length > 0 ? (
                      // 分隔符刻意 locale 无关：这两行是键名/字段 label 的机械拼接，
                      // 不随 UI 语言切换（zh 界面下也不使用全角标点）。
                      <div className="lx-w-review-note">{t('wizard.review.explicit_fields')}: {explicitForStep.slice(0, 5).join(', ')}{explicitForStep.length > 5 ? ` +${explicitForStep.length - 5}` : ''}</div>
                    ) : null}
                    {managedForStep.length > 0 ? (
                      <div className="lx-w-review-note">{t('wizard.review.managed_fields')}: {managedForStep.join(', ')}</div>
                    ) : null}
                    {diffs.length > 0 ? (
                      <div className="lx-w-review-note">{t('wizard.review.changed_prefix', { n: diffs.length })}{diffs.slice(0, 3).map((item) => item.field.label || item.field.title || item.field.key).join('; ')}{diffs.length > 3 ? '…' : ''}</div>
                    ) : null}
                  </ReviewSection>
                )
              })}
            </div>
            {props.validation.autoFixes ? (
              <div className="lx-w-alert is-warning"><b>{t('wizard.review.auto_fixes')}</b><span>{Object.keys(props.validation.autoFixes).join(', ')}</span></div>
            ) : null}
            {props.validation.errors.length > 0 ? <div className="lx-w-alert is-error"><b>{t('review.config_errors')}</b>{props.validation.errors.map((item) => <span key={item.message}>{item.message}</span>)}</div> : null}
            {props.validation.warnings.length > 0 ? <div className="lx-w-alert is-warning"><b>{t('review.config_warnings')}</b>{props.validation.warnings.map((item) => <span key={item.message}>{item.message}</span>)}</div> : null}
            {preflightCurrent && preflight ? (
              <PreflightPanel>
                {preflightErrors.map((item, index) => <div key={`e-${index}`} className="is-error">{preflightMessage(item)}</div>)}
                {preflightWarnings.map((item, index) => <div key={`w-${index}`} className="is-warning">{preflightMessage(item)}</div>)}
                {!preflightErrors.length && !preflightWarnings.length ? <div className="is-ok">{t('wizard.preflight.ok')}</div> : null}
                {preflightWarnings.length > 0 && !preflightErrors.length ? <label className="lx-w-confirm"><input type="checkbox" checked={Boolean(storedPreflight?.warningConfirmed)} onChange={(event) => wizard.setPreflightWarningConfirmed(props.typeId, event.target.checked)} /> {t('wizard.preflight.confirm_warning')}</label> : null}
                <details><summary>{t('review.show_raw_payload')}</summary><pre>{JSON.stringify(currentPayload, null, 2)}</pre></details>
              </PreflightPanel>
            ) : <p className="lx-w-empty">{t('wizard.preflight.expired')}</p>}
          </section>
        ) : null}

        <WizardFooter>
          <div className="lx-w-footer-tools">
            <Button onClick={props.onFlushDraft}>{t('wizard.actions.save_draft')}</Button>
            <Button onClick={props.onClearDraft}>{t('wizard.actions.clear_draft')}</Button>
            <Button onClick={props.onReset}>{t('wizard.actions.reset')}</Button>
          </div>
          <div className="lx-w-footer-nav">
            <Button onClick={previous} disabled={activeId === steps[0]?.id}>{t('wizard.actions.previous')}</Button>
            {activeId !== 'review' ? (
              <Button
                variant="primary"
                onClick={next}
                aria-describedby={stepValidationSummary ? 'lx-w-step-error-alert' : undefined}
              >
                {t('wizard.actions.next')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={launchDisabled || props.igniting}
                onClick={props.onLaunch}
              >
                {props.igniting ? t('wizard.actions.launching') : t('wizard.actions.launch')}
              </Button>
            )}
          </div>
        </WizardFooter>
      </WizardContent>
    </WizardShell>
  )
}
