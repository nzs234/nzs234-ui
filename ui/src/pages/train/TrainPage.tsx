// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SchemaField } from '@/schema/schemaIndex'
import {
  TRAINING_TYPES,
  applyBackendConfigOptions,
  buildRunConfig,
  getAvailableTabs,
  getSectionsForTab,
  getSectionsForType,
  isFieldVisible,
} from '@/schema/schemaIndex.js'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { autofillEmptyModelPaths } from '@/lib/inventoryAutofill'
import {
  fetchRestorableLastTraining,
  isDraftNearDefault,
  type ResumeOffer,
} from '@/lib/lastTrainingRestore'
import {
  clearCurrentTypeDraftOnDisk,
  flushTrainDraftsToDisk,
  bootstrapTrainDrafts,
  useTrainConfigStore,
  useDraft,
} from '@/stores/configStore'
import { restoreConfigIntoDraft } from '@/features/training/restoreConfigService'
import { addRunRecord } from '@/stores/historyStore'
import { useRouteStore } from '@/stores/routeStore'
import { toast } from '@/stores/toastStore'
import { usePageEntrance } from '@/motion/useEntrance'
import { PageHead, Tabs } from '@/components/layout'
import { Button } from '@/components/primitives'
import { Input } from '@/components/form'
import { SectionCard } from './SectionCard'
import { useTrainingVramProfile } from './useTrainingVramProfile'
import { HelpModal } from './HelpModal'
import { PreflightModal, SavedConfigsModal } from './modals'
import './train.css'
import { useI18n, resolveTabLabel, resolveGroupLabel } from '@/i18n/useI18n'
import { validateConfig } from '@/utils/configValidator'
import { useWizardStore } from './wizard/wizardStore'
import { WizardPage } from './wizard/WizardPage'
import './wizard/wizard.css'
import { isPreflightCurrent, normalizePreflightReport, type PreflightSnapshot } from './wizard/preflight'
import { isRestorableTrainingType } from '@/lib/trainingTypeAccess'

/* 训练配置页:类型轨 → schema 页签表单 → 预检/参数存取/启动 */

let optionsLoaded = false
/** 会话内只静默 seed 一次,避免与用户编辑抢写 */
let lastSeedAttempted = false

function useBackendOptions() {
  const bump = useTrainConfigStore((s) => s.bumpSchemaRev)
  useEffect(() => {
    if (optionsLoaded) return
    optionsLoaded = true
    trainApi
      .configOptions()
      .then((resp) => {
        if (applyBackendConfigOptions(unwrap(resp))) bump()
      })
      .catch(() => {
        optionsLoaded = false // 后端未起时静默,下次进入页面重试
      })
  }, [bump])
}

/**
 * 启动顺序:LS → 磁盘 merge → 空草稿同 type last seed → inventory 空字段 autofill
 */
function useDraftHydrateAndAutofill(typeId: string) {
  const diskHydrated = useTrainConfigStore((s) => s.diskHydrated)
  useEffect(() => {
    void bootstrapTrainDrafts()
  }, [])
  useEffect(() => {
    if (!diskHydrated) return
    let cancelled = false
    ;(async () => {
      if (!lastSeedAttempted) {
        lastSeedAttempted = true
        try {
          const last = await fetchRestorableLastTraining()
          if (!cancelled && last.ok) {
            const st = useTrainConfigStore.getState()
            const curType = st.typeId
            const sid = String(last.schemaId || '').trim()
            // 仅同 type 静默 seed;跨 type 留给显式「上次」
            if ((!sid || sid === curType) && isDraftNearDefault(curType, st.drafts[curType] ?? {})) {
              restoreConfigIntoDraft({
                config: last.config,
                typeCandidates: sid ? [sid] : [curType],
                source: 'last-training',
                runId: last.runId,
              })
            }
          }
        } catch {
          /* 静默 */
        }
      }
      if (!cancelled) void autofillEmptyModelPaths()
    })()
    return () => {
      cancelled = true
    }
  }, [diskHydrated, typeId])
}

function TypeRail({ typeId, onSelect }: { typeId: string; onSelect: (id: string) => void }) {
  const { t: tt, language } = useI18n()
  const groups = useMemo(() => {
    const m = new Map<string, typeof TRAINING_TYPES>()
    for (const t of TRAINING_TYPES) {
      if (t.hidden) continue
      const g = t.group || tt('common.other')
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(t)
    }
    return [...m.entries()]
  }, [tt])

  let n = 0
  return (
    <aside className="lx-typerail">
      {groups.map(([group, types]) => (
        <div key={group} className="lx-typerail-group">
          <h3>{resolveGroupLabel(group, language)}</h3>
          {types.map((t) => {
            n += 1
            return (
              <button
                key={t.id}
                type="button"
                className={['lx-type-btn', t.id === typeId ? 'on' : ''].filter(Boolean).join(' ')}
                disabled={t.disabled}
                title={t.disabled ? t.disabledReason || tt('common.unavailable') : (t.note || t.id)}
                onClick={() => onSelect(t.id)}
              >
                <i>{String(n).padStart(2, '0')}</i>
                {t.label}
              </button>
            )
          })}
        </div>
      ))}
    </aside>
  )
}

export default function TrainPage() {
  const ref = usePageEntrance()
  const { t: tt, language } = useI18n()
  const VRAM_PROFILE_MANAGED_MESSAGE = tt('train.profile_managed_msg')
  useBackendOptions()

  const typeId = useTrainConfigStore((s) => s.typeId)
  useDraftHydrateAndAutofill(typeId)
  const schemaRev = useTrainConfigStore((s) => s.schemaRev)
  const setType = useTrainConfigStore((s) => s.setType)
  const setValue = useTrainConfigStore((s) => s.setValue)
  const applyValues = useTrainConfigStore((s) => s.applyValues)
  const resetDraft = useTrainConfigStore((s) => s.resetDraft)
  const draft = useDraft()
  const { displayDraft, managedKeys } = useTrainingVramProfile(typeId, draft)
  const navigate = useRouteStore((s) => s.navigate)
  const wizardMode = useWizardStore((s) => s.mode)
  const setWizardMode = useWizardStore((s) => s.setMode)
  const persistedWizardExplicitFields = useWizardStore((s) => s.explicitFieldsByType[typeId]) || []

  const [tab, setTab] = useState('model')
  const [search, setSearch] = useState('')
  const [helpField, setHelpField] = useState<SchemaField | null>(null)
  const [showPreflight, setShowPreflight] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [igniting, setIgniting] = useState(false)
  /** P0-A: incomplete last run banner (never auto-enqueue). */
  const [resumeBanner, setResumeBanner] = useState<ResumeOffer | null>(null)
  const [resumeBannerDismissed, setResumeBannerDismissed] = useState(false)

  // P2: 配置冲突检测 + 自动修正
  const validation = useMemo(() => validateConfig(displayDraft, typeId), [displayDraft, typeId])

  useEffect(() => {
    if (validation.autoFixes) {
      const allowed = Object.fromEntries(
        Object.entries(validation.autoFixes).filter(([key]) => !managedKeys.has(key)),
      )
      if (Object.keys(allowed).length) {
        useWizardStore.getState().clearPreflight(typeId)
        applyValues(allowed)
        useWizardStore.getState().markStaleFrom(typeId, 'files')
      }
    }
  }, [validation.autoFixes, applyValues, managedKeys, typeId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const last = await fetchRestorableLastTraining()
        if (cancelled) return
        const offer = last.resumeOffer
        if (offer?.show_banner) {
          setResumeBanner(offer)
        } else {
          setResumeBanner(null)
        }
      } catch {
        if (!cancelled) setResumeBanner(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const explicitFieldsByType = useRef(new Map<string, Set<string>>())
  const explicitFields = explicitFieldsByType.current.get(typeId) || new Set<string>()
  if (!explicitFieldsByType.current.has(typeId)) explicitFieldsByType.current.set(typeId, explicitFields)

  const markExplicit = useCallback((keys: Iterable<string>) => {
    const fields = explicitFieldsByType.current.get(typeId) || new Set<string>()
    const list = [...keys]
    for (const key of list) fields.add(key)
    explicitFieldsByType.current.set(typeId, fields)
    useWizardStore.getState().markExplicit(typeId, list)
  }, [typeId])

  const updateExplicitValue = useCallback((key: string, raw: unknown) => {
    if (managedKeys.has(key)) return
    markExplicit([key])
    useWizardStore.getState().clearPreflight(typeId)
    setValue(key, raw)
  }, [managedKeys, markExplicit, setValue])

  const applySuggestedValues = useCallback((values: Record<string, unknown>) => {
    const allowed = Object.fromEntries(Object.entries(values).filter(([key]) => !managedKeys.has(key)))
    if (Object.keys(allowed).length) {
      useWizardStore.getState().clearPreflight(typeId)
      applyValues(allowed)
      useWizardStore.getState().markStaleFrom(typeId, 'files')
    }
  }, [applyValues, managedKeys, typeId])
  const tabs = useMemo(() => getAvailableTabs(typeId, displayDraft), [typeId, displayDraft, schemaRev])
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? 'model')
  const expertMode = !!displayDraft.performance_expert_mode

  // 切到标准后 advanced/frontier 被藏：把 state tab 同步回合法页签，避免残留
  useEffect(() => {
    if (tab !== activeTab) setTab(activeTab)
  }, [tab, activeTab])

  const setExpertMode = useCallback(
    (on: boolean) => {
      useWizardStore.getState().clearPreflight(typeId)
      setValue('performance_expert_mode', on)
    },
    [setValue, typeId],
  )

  const sections = useMemo(() => {
    if (search.trim()) {
      // 搜索时跨页签全局匹配,但不越过 expertOnly 页签的可见性
      const allowed = new Set(tabs.map((t) => t.key))
      return getSectionsForType(typeId).filter((s) => allowed.has(s.tab))
    }
    return getSectionsForTab(activeTab, typeId)
  }, [search, activeTab, typeId, tabs, schemaRev])

  const visibleFieldCount = useMemo(
    () =>
      sections.reduce(
        (acc, s) => acc + s.fields.filter((f) => f.type !== 'hidden' && isFieldVisible(f, displayDraft)).length,
        0,
      ),
    [sections, displayDraft],
  )

  const typeLabel = TRAINING_TYPES.find((t) => t.id === typeId)?.label ?? typeId

  const buildPayload = () => {
    const state = useTrainConfigStore.getState()
    // 「用户显式编辑过」的键集（会话 ref + 持久化 wizard 记录取并集）：
    // 提交层靠它区分注入默认与手填值（krea2 aggressive 预设剥除等）。
    const explicitKeys = new Set<string>([
      ...(explicitFieldsByType.current.get(state.typeId) ?? []),
      ...(useWizardStore.getState().explicitFieldsByType[state.typeId] ?? []),
    ])
    return buildRunConfig(state.drafts[state.typeId] ?? {}, state.typeId, { explicitKeys })
  }

  const doIgnite = async () => {
    setIgniting(true)
    try {
      const payload = buildPayload()
      const submittedDraft = draftSnapshot()
      if (validation.errors.length > 0) {
        toast.err(tt('train.config_error_toast'), 'CONFIG')
        return
      }
      const preflightSnapshot = useWizardStore.getState().preflightByType[typeId]
      if (!isPreflightCurrent(preflightSnapshot, typeId, schemaRev, payload)) {
        toast.warn(tt('train.preflight_stale_toast'), 'PREFLIGHT')
        return
      }
      const preflightReport = normalizePreflightReport(preflightSnapshot?.report)
      if (preflightReport.blocking.length > 0) {
        toast.err(tt('train.preflight_block_toast'), 'PREFLIGHT')
        return
      }
      if (preflightReport.confirmable.length > 0 && !preflightSnapshot?.warningConfirmed) {
        toast.warn(tt('train.preflight_confirm_toast'), 'PREFLIGHT')
        return
      }
      // 输出目录同名产物冲突提示(检查失败不阻断提交)
      const dir = String(payload.output_dir ?? payload.output_path ?? '')
      const name = String(payload.output_name ?? '')
      if (dir && name) {
        try {
          const c = unwrap<Record<string, unknown>>(await trainApi.checkOutputConflict(dir, name))
          const conflict = c?.conflict === true || c?.exists === true
          if (conflict) {
            const msg = typeof c?.message === 'string' && c.message ? c.message : tt('train.outdir_exists', { name })
            if (!window.confirm(msg)) return
          }
        } catch {
          /* ignore */
        }
      }
      const resp = unwrap(await trainApi.run(payload))
      addRunRecord(typeId, submittedDraft, resp)
      toast.ok(tt('train.submitted', { type: typeLabel }), 'IGNITED')
      useWizardStore.getState().clearPreflight(typeId)
      navigate('monitor')
    } catch (e) {
      toast.err((e as Error).message, tt('train.submit_fail'))
    } finally {
      setIgniting(false)
    }
  }

  const doReset = () => {
    if (window.confirm(tt('train.reset_confirm', { type: typeLabel }))) {
      resetDraft()
      explicitFields.clear()
      useWizardStore.getState().resetType(typeId)
      toast.info(tt('train.reset_ok'), 'RESET')
    }
  }

  const doFlushDraft = async () => {
    try {
      await flushTrainDraftsToDisk()
      toast.ok(tt('train.draft_ok'), 'DRAFT')
    } catch (e) {
      toast.err((e as Error).message, 'DRAFT')
    }
  }

  const doClearTypeDraft = async () => {
    if (!window.confirm(tt('train.clear_draft_confirm', { type: typeLabel }))) return
    try {
      await clearCurrentTypeDraftOnDisk()
      explicitFields.clear()
      useWizardStore.getState().resetType(typeId)
      toast.ok(tt('train.clear_draft_ok'), 'CLEAR')
    } catch (e) {
      toast.err((e as Error).message, 'CLEAR')
    }
  }

  const doRestoreLast = async () => {
    try {
      const last = await fetchRestorableLastTraining()
      if (!last.ok) {
        const hint =
          last.reason === 'raw_config_unavailable'
            ? tt('train.last_no_raw')
            : tt('train.last_none')
        toast.warn(hint, 'LAST')
        return
      }
      const sid = String(last.schemaId || '').trim()
      const target = sid && isRestorableTrainingType(sid) ? sid : typeId
      const near = isDraftNearDefault(target, useTrainConfigStore.getState().drafts[target] ?? {})
      if (!near) {
        const label = TRAINING_TYPES.find((t) => t.id === target)?.label ?? target
        if (!window.confirm(tt('train.last_overwrite', { type: label }))) return
      }

      const result = restoreConfigIntoDraft({
        config: last.config,
        typeCandidates: sid ? [sid] : [typeId],
        source: 'last-training',
        runId: last.runId,
      })

      if (!result.ok) {
        if (result.reason === 'type_unavailable' && sid) {
          toast.warn(tt('train.last_type_fallback', { id: sid }), 'LAST')
        } else {
          toast.err(tt('train.last_none'), 'LAST')
        }
        return
      }

      const restoredTypeId = result.typeId
      explicitFieldsByType.current.set(restoredTypeId, new Set(result.appliedKeys))
      const src = last.source === 'last-training' ? tt('train.last_source') : 'saved_params'
      toast.ok(`${tt('train.restored', { source: src })}${last.runId ? ` · ${last.runId}` : ''}`, 'LAST')
    } catch (e) {
      toast.err((e as Error).message, 'LAST')
    }
  }

  const openExpertMode = () => {
    setWizardMode('expert')
    useWizardStore.getState().clearPreflight(typeId)
    setValue('performance_expert_mode', true)
  }

  const closeExpertMode = () => {
    setWizardMode('wizard')
    setExpertMode(false)
  }

  const handleTypeChange = useCallback((nextTypeId: string) => {
    if (igniting) return
    useWizardStore.getState().clearPreflight(typeId)
    setType(nextTypeId)
    // 专家模式下切型后保持高级页签可见
    if (wizardMode === 'expert') setValue('performance_expert_mode', true)
  }, [setType, setValue, typeId, wizardMode, igniting])

  const handlePreflightSnapshot = useCallback((snapshot: PreflightSnapshot) => {
    useWizardStore.getState().setPreflight(snapshot.typeId, snapshot)
  }, [])

  const allExplicitFields = useMemo(
    () => [...new Set([...explicitFields, ...persistedWizardExplicitFields])],
    [explicitFields, persistedWizardExplicitFields],
  )

  if (wizardMode === 'wizard') {
    return (
      <div ref={ref}>
        <WizardPage
          typeId={typeId}
          typeLabel={typeLabel}
          draft={draft}
          displayDraft={displayDraft}
          managedKeys={managedKeys}
          managedMessage={VRAM_PROFILE_MANAGED_MESSAGE}
          validation={validation}
          explicitFields={allExplicitFields}
          schemaRev={schemaRev}
          igniting={igniting}
          onTypeChange={handleTypeChange}
          onChange={updateExplicitValue}
          onHelp={setHelpField}
          onApplySuggestions={applySuggestedValues}
          onExpert={openExpertMode}
          onPreflight={() => setShowPreflight(true)}
          onSaved={() => setShowSaved(true)}
          onRestoreLast={() => void doRestoreLast()}
          onFlushDraft={() => void doFlushDraft()}
          onClearDraft={() => void doClearTypeDraft()}
          onReset={doReset}
          onLaunch={() => void doIgnite()}
          onNavigateMonitor={() => navigate('monitor')}
        />
        <HelpModal field={helpField} onClose={() => setHelpField(null)} />
        <SavedConfigsModal
          open={showSaved}
          onClose={() => setShowSaved(false)}
          currentDraft={draftSnapshot}
          currentSchemaId={() => useTrainConfigStore.getState().typeId}
          onLoad={(config, meta) => {
            const candidates = [meta?.schemaId, meta?.typeId]
            const result = restoreConfigIntoDraft({
              config,
              typeCandidates: candidates,
              source: 'saved_params',
            })
            if (result.ok) {
              explicitFieldsByType.current.set(result.typeId, new Set(result.appliedKeys))
              toast.ok(tt('train.restored', { source: 'saved_params' }), 'PRESETS')
            } else {
              toast.err(tt('train.last_none'), 'PRESETS')
            }
          }}
        />
      </div>
    )
  }

  return (
    <div ref={ref}>
      <PageHead
        idx="01 — TRAIN"
        tag="DIFFUSION TRAINER CONSOLE"
        lines={[{ text: 'CONFIGURE' }, { text: 'TRAINING_', outline: true }]}
        sub={tt('train.current_type_sub', { type: typeLabel, count: visibleFieldCount })}
      />

      <div className="lx-train-layout">
        <TypeRail typeId={typeId} onSelect={handleTypeChange} />

        <div>
          {resumeBanner && !resumeBannerDismissed ? (
            <div className="lx-resume-banner" role="status">
              <p>
                <span className="lx-resume-banner-heading">
                  <span className={`lx-resume-level is-${resumeBanner.resume_level || 'unknown'}`}>
                    {resumeBanner.resume_level === 'full'
                      ? tt('train.resume_level_full')
                      : resumeBanner.resume_level === 'weights_only'
                        ? tt('train.resume_level_weights')
                        : tt('train.resume_level_unknown')}
                  </span>
                  <span>
                    {tt('train.resume_banner', {
                      run: resumeBanner.run_id ? ` · ${resumeBanner.run_id}` : '',
                      status: resumeBanner.run_status || resumeBanner.hint || 'incomplete',
                    })}
                  </span>
                </span>
                <span className="lx-resume-banner-detail">
                  {resumeBanner.resume_level === 'full'
                    ? tt('train.resume_level_full_detail')
                    : resumeBanner.resume_level === 'weights_only'
                      ? tt('train.resume_level_weights_detail')
                      : tt('train.resume_level_unknown_detail')}
                </span>
              </p>
              <div className="lx-resume-banner-actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    void doRestoreLast().then(() => setResumeBannerDismissed(true))
                  }}
                >
                  {tt('train.resume_banner_action')}
                </Button>
                <Button onClick={() => setResumeBannerDismissed(true)}>
                  {tt('train.resume_banner_dismiss')}
                </Button>
              </div>
            </div>
          ) : null}

          {/* P2: 配置冲突/警告横幅 */}
          {validation.errors.length > 0 && (
            <div className="lx-validation-banner lx-validation-error" role="alert">
              <div className="lx-validation-icon">⚠️</div>
              <div className="lx-validation-content">
                <strong>{tt('train.config_errors')}</strong>
                <ul>
                  {validation.errors.map((err, i) => (
                    <li key={i}>{err.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="lx-validation-banner lx-validation-warning" role="status">
              <div className="lx-validation-icon">💡</div>
              <div className="lx-validation-content">
                <strong>{tt('train.config_warnings')}</strong>
                <ul>
                  {validation.warnings.map((warn, i) => (
                    <li key={i}>{warn.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="lx-cfg-toolbar">
            <Tabs
              tabs={tabs.map((tab, i) => ({ id: tab.key, label: resolveTabLabel(tab, language), idx: String(i + 1).padStart(2, '0') }))}
              active={activeTab}
              onChange={setTab}
            />
            <div className="lx-mode-toggle" role="group" aria-label={tt('train.mode_label')}>
              <button
                type="button"
                aria-pressed={!expertMode}
                className={['lx-mode-btn', !expertMode ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={closeExpertMode}
              >
                {tt('train.mode_standard')}
              </button>
              <button
                type="button"
                aria-pressed={expertMode}
                className={['lx-mode-btn', expertMode ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={() => setExpertMode(true)}
              >
                {tt('train.mode_advanced')}
              </button>
            </div>
            <Input
              className="lx-cfg-search"
              aria-label={tt('train.search_fields')}
              placeholder={tt('train.search_fields')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {tabs.map((tab) => {
            const isActive = tab.key === activeTab
            return (
              <div
                key={tab.key}
                id={`lx-tab-panel-${tab.key}`}
                role="tabpanel"
                aria-labelledby={`lx-tab-${tab.key}`}
                hidden={!isActive}
              >
                {isActive ? sections.map((s, i) => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    idx={i}
                    config={displayDraft}
                    search={search.trim()}
                    onChange={updateExplicitValue}
                    onHelp={setHelpField}
                    explicitFields={[...explicitFields]}
                    onApplySuggestions={applySuggestedValues}
                    managedKeys={managedKeys}
                    managedMessage={VRAM_PROFILE_MANAGED_MESSAGE}
                    expert={expertMode}
                  />
                )) : null}
              </div>
            )
          })}
          {search.trim() && !sections.some((s) => s.fields.some((f) => isFieldVisible(f, displayDraft))) ? (
            <p className="lx-wiki-fallback" style={{ padding: '28px 0', textAlign: 'center' }}>
              {tt('train.no_match', { search })}
            </p>
          ) : null}

          <div className="lx-actionbar">
            <div className="lx-actionbar-meta">
              <b>{typeLabel}</b>
              <span className="lx-num">{typeId} · REV {schemaRev}</span>
            </div>
            <div className="lx-actionbar-primary">
              <Button variant="primary" disabled={igniting || validation.errors.length > 0} onClick={() => void doIgnite()}>
                {igniting ? tt('train.submitting') : tt('train.ignite')}
              </Button>
            </div>
            <details className="lx-actionbar-more">
              <summary className="lx-btn sm">{tt('common.other')} ▾</summary>
              <div className="lx-actionbar-menu">
                <Button size="sm" onClick={() => setShowPreflight(true)}>{tt('train.preflight')}</Button>
                <Button size="sm" onClick={() => setShowSaved(true)}>{tt('train.presets')}</Button>
                <Button size="sm" onClick={() => void doRestoreLast()} title={tt('train.restore_last_title')}>{tt('train.last')}</Button>
                <Button size="sm" onClick={() => void doFlushDraft()} title={tt('train.flush_draft_title')}>{tt('train.flush')}</Button>
                <Button size="sm" onClick={() => void doClearTypeDraft()} title={tt('train.clear_draft_title')}>{tt('train.clear_type')}</Button>
                <Button size="sm" onClick={doReset}>{tt('train.reset')}</Button>
              </div>
            </details>
            <div className="lx-actionbar-desktop">
              <Button onClick={() => setShowPreflight(true)}>{tt('train.preflight')}</Button>
              <Button onClick={() => setShowSaved(true)}>{tt('train.presets')}</Button>
              <Button onClick={() => void doRestoreLast()} title={tt('train.restore_last_title')}>{tt('train.last')}</Button>
              <Button onClick={() => void doFlushDraft()} title={tt('train.flush_draft_title')}>{tt('train.flush')}</Button>
              <Button onClick={() => void doClearTypeDraft()} title={tt('train.clear_draft_title')}>{tt('train.clear_type')}</Button>
              <Button onClick={doReset}>{tt('train.reset')}</Button>
            </div>
          </div>
        </div>
      </div>

      <HelpModal field={helpField} onClose={() => setHelpField(null)} />
      <PreflightModal open={showPreflight} onClose={() => setShowPreflight(false)} buildPayload={buildPayload} onReport={handlePreflightSnapshot} typeId={typeId} schemaRev={schemaRev} />
      <SavedConfigsModal
        open={showSaved}
        onClose={() => setShowSaved(false)}
        currentDraft={draftSnapshot}
        onLoad={(config, meta) => {
          const candidates = [meta?.schemaId, meta?.typeId]
          const result = restoreConfigIntoDraft({
            config,
            typeCandidates: candidates,
            source: 'saved_params',
          })
          if (result.ok) {
            explicitFieldsByType.current.set(result.typeId, new Set(result.appliedKeys))
            toast.ok(tt('train.restored', { source: 'saved_params' }), 'PRESETS')
          } else {
            toast.err(tt('train.last_none'), 'PRESETS')
          }
        }}
      />
    </div>
  )
}

/** 保存参数时取草稿的即时快照(读 store 最新态,避免闭包过期) */
function draftSnapshot(): Record<string, unknown> {
  const s = useTrainConfigStore.getState()
  return { ...(s.drafts[s.typeId] ?? {}) }
}
