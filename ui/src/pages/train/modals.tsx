// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/overlay'
import { Badge, Button } from '@/components/primitives'
import { Input } from '@/components/form'
import { trainApi } from '@/api/trainApi'
import { formatApiMessage, unwrap } from '@/api/transport'
import {
  buildExportBundle,
  exportBundleToDownload,
  readFileAsSavedBundle,
} from '@/lib/savedConfigIo'
import { useTrainConfigStore } from '@/stores/configStore'
import { toast } from '@/stores/toastStore'
import { useI18n } from '@/i18n/useI18n'
import { fingerprintPayload, type PreflightSnapshot } from './wizard/preflight'

/* 预检报告弹层 + 保存参数管理弹层 */

const LIST_KEYS: { key: string; labelKey: string; tone: 'danger' | 'warn' | 'ok' | undefined }[] = [
  { key: 'errors', labelKey: 'preflight.errors', tone: 'danger' },
  { key: 'blockers', labelKey: 'preflight.blockers', tone: 'danger' },
  { key: 'issues', labelKey: 'preflight.issues', tone: 'warn' },
  { key: 'warnings', labelKey: 'preflight.warnings', tone: 'warn' },
  { key: 'notes', labelKey: 'preflight.notes', tone: undefined },
  { key: 'messages', labelKey: 'preflight.messages', tone: undefined },
  { key: 'checks', labelKey: 'preflight.checks', tone: 'ok' },
]

export function PreflightModal({
  open,
  onClose,
  buildPayload,
  onReport,
  typeId,
  schemaRev,
}: {
  open: boolean
  onClose: () => void
  buildPayload: () => Record<string, unknown>
  onReport?: (snapshot: PreflightSnapshot) => void
  typeId?: string
  schemaRev?: number
}) {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [warningConfirmed, setWarningConfirmed] = useState(false)
  const snapshotRef = useRef<PreflightSnapshot | null>(null)

  useEffect(() => {
    if (!open) return
    setState('running')
    setReport(null)
    setError('')
    setWarningConfirmed(false)
    let alive = true
    const payload = buildPayload()
    void trainApi
      .preflight(payload)
      .then((resp) => {
        if (!alive) return
        const data = unwrap<Record<string, unknown>>(resp)
        const normalized = data && typeof data === 'object' ? data : { result: data }
        const snapshot: PreflightSnapshot = {
          typeId: typeId || '',
          schemaRev: schemaRev || 0,
          fingerprint: fingerprintPayload(payload),
          report: normalized,
          warningConfirmed: false,
          createdAt: Date.now(),
        }
        snapshotRef.current = snapshot
        onReport?.(snapshot)
        setReport(normalized)
        setState('done')
      })
      .catch((e: Error) => {
        if (!alive) return
        const failed: PreflightSnapshot = {
          typeId: typeId || '',
          schemaRev: schemaRev || 0,
          fingerprint: fingerprintPayload(payload),
          report: { errors: [e.message] },
          warningConfirmed: false,
          createdAt: Date.now(),
        }
        snapshotRef.current = failed
        onReport?.(failed)
        setError(e.message)
        setState('failed')
      })
    return () => {
      alive = false
    }
    // buildPayload 由父组件以最新 draft 闭包传入,open 变化时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const lists = report
    ? LIST_KEYS.map(({ key, labelKey, tone }) => {
        const raw = report[key]
        const items = Array.isArray(raw) ? raw : []
        return { key, labelKey, tone, items }
      }).filter((l) => l.items.length > 0)
    : []
  const hasProblems = lists.some((l) => l.tone === 'danger' || l.tone === 'warn')
  const hasBlocking = lists.some((l) => l.key === 'errors' || l.key === 'blockers')
  const hasWarnings = lists.some((l) => l.key === 'issues' || l.key === 'warnings')

  return (
    <Modal open={open} title={t('preflight.title')} onClose={onClose} width={640}>
      {state === 'running' ? <p className="lx-preflight-running lx-num">RUNNING CHECKS…</p> : null}
      {state === 'failed' ? <p style={{ color: 'var(--lx-danger)' }}>{error}</p> : null}
      {state === 'done' && report ? (
        <div className="lx-preflight">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {hasProblems ? <Badge tone="warn">{t('preflight.has_problems')}</Badge> : <Badge tone="ok">{t('preflight.passed')}</Badge>}
          </div>
          {(() => {
            const capabilities = (report.training_capabilities || {}) as Record<string, unknown>
            const universal = (capabilities.universal_dit || {}) as Record<string, unknown>
            if (Object.keys(universal).length === 0) return null
            const blockers = Array.isArray(universal.blocking_reasons) ? universal.blocking_reasons : []
            return (
              <div style={{ border: '1px solid var(--lx-line)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>Universal DiT</strong>
                  <Badge tone={universal.enabled ? (universal.status === 'load_only' ? 'warn' : 'ok') : undefined}>
                    {String(universal.status || 'disabled')}
                  </Badge>
                  {universal.enabled ? <span className="lx-num" style={{ color: 'var(--lx-dim)', fontSize: 11 }}>
                    probe={String(universal.probe_mode || 'auto')} · target={String(universal.target_policy || 'attention_mlp')}
                  </span> : null}
                </div>
                {blockers.length > 0 ? <ul style={{ margin: '8px 0 0 18px', color: 'var(--lx-dim)' }}>
                  {blockers.slice(0, 4).map((item, i) => <li key={i}>{String(item)}</li>)}
                </ul> : null}
              </div>
            )
          })()}
          {lists.map((l) => (
            <div key={l.key} className="lx-preflight-group">
              <h4>
                <Badge tone={l.tone}>{t(l.labelKey)}</Badge>
              </h4>
              <ul>
                {l.items.map((item, i) => (
                  <li key={i}>{formatApiMessage(item)}</li>
                ))}
              </ul>
            </div>
          ))}
          {hasWarnings && !hasBlocking ? (
            <label className="lx-w-confirm" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={warningConfirmed}
                onChange={(event) => {
                  const confirmed = event.target.checked
                  setWarningConfirmed(confirmed)
                  const current = snapshotRef.current
                  if (current) onReport?.({ ...current, warningConfirmed: confirmed })
                }}
              />
              {t('preflight.confirm_notes')}
            </label>
          ) : null}
          {!lists.length ? <p style={{ color: 'var(--lx-dim)' }}>{t('preflight.no_lists')}</p> : null}
          <details style={{ marginTop: 12 }}>
            <summary className="lx-num" style={{ cursor: 'pointer', color: 'var(--lx-dim)', fontSize: 11 }}>
              RAW REPORT JSON
            </summary>
            <pre className="lx-log" style={{ maxHeight: 260, marginTop: 8 }}>
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </Modal>
  )
}

interface SavedItem {
  name: string
  updatedAt?: string
}

function normalizeSavedList(payload: unknown): SavedItem[] {
  const data = unwrap<unknown>(payload)
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.configs)
      ? ((data as Record<string, unknown>).configs as unknown[])
      : Array.isArray((data as Record<string, unknown>)?.names)
        ? ((data as Record<string, unknown>).names as unknown[])
        : []
  return arr
    .map((item) => {
      if (typeof item === 'string') return { name: item }
      const obj = item as Record<string, unknown>
      const name = String(obj?.name ?? obj?.id ?? '')
      return name ? { name, updatedAt: obj?.updated_at ? String(obj.updated_at) : undefined } : null
    })
    .filter(Boolean) as SavedItem[]
}

export function SavedConfigsModal({
  open,
  onClose,
  currentDraft,
  currentSchemaId,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  currentDraft: () => Record<string, unknown>
  currentSchemaId?: () => string
  onLoad: (config: Record<string, unknown>, meta?: { schemaId?: string; typeId?: string }) => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<SavedItem[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const externalFileRef = useRef<HTMLInputElement | null>(null)

  const refresh = async () => {
    try {
      setItems(normalizeSavedList(await trainApi.listSavedConfigs()))
    } catch (e) {
      toast.warn((e as Error).message, t('presets.list_title'))
    }
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  const schemaId = () => useTrainConfigStore.getState().typeId

  const doSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.warn(t('presets.need_name'))
      return
    }
    setBusy(true)
    try {
      await trainApi.saveConfig(trimmed, currentDraft(), currentSchemaId?.())
      toast.ok(t('presets.saved', { name: trimmed }), 'SAVED')
      setName('')
      await refresh()
    } catch (e) {
      toast.err((e as Error).message, t('presets.save_fail'))
    } finally {
      setBusy(false)
    }
  }

  const doLoad = async (n: string) => {
    setBusy(true)
    try {
      const payload = unwrap<Record<string, unknown>>(await trainApi.loadSavedConfig(n))
      const config = (payload?.config ?? payload) as Record<string, unknown>
      if (config && typeof config === 'object') {
        const schemaId = String(payload?.schema_id ?? payload?.schemaId ?? '').trim() || undefined
        const typeId = String(payload?.typeId ?? payload?.type_id ?? '').trim() || undefined
        onLoad(config, { schemaId, typeId })
        toast.ok(t('presets.loaded', { name: n }), 'LOADED')
        onClose()
      } else {
        toast.warn(t('presets.empty_config'))
      }
    } catch (e) {
      toast.err((e as Error).message, t('presets.load_fail'))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (n: string) => {
    if (!window.confirm(t('presets.delete_confirm', { name: n }))) return
    try {
      await trainApi.deleteSavedConfig(n)
      await refresh()
    } catch (e) {
      toast.err((e as Error).message, t('presets.delete_fail'))
    }
  }

  const doRename = async (n: string) => {
    const next = window.prompt(t('presets.rename_prompt'), n)?.trim()
    if (!next || next === n) return
    try {
      await trainApi.renameSavedConfig(n, next)
      await refresh()
    } catch (e) {
      toast.err((e as Error).message, t('presets.rename_fail'))
    }
  }

  const doExportCurrent = () => {
    const n = name.trim() || String(currentDraft().output_name || schemaId() || 'preset')
    exportBundleToDownload(
      buildExportBundle({ name: n, config: currentDraft(), schemaId: schemaId() }),
    )
    toast.ok(t('presets.exported', { name: n }), 'EXPORT')
  }

  const doExportNamed = async (n: string) => {
    setBusy(true)
    try {
      const payload = unwrap<Record<string, unknown>>(await trainApi.loadSavedConfig(n))
      const config = (payload?.config ?? payload) as Record<string, unknown>
      if (!config || typeof config !== 'object') {
        toast.warn(t('presets.export_empty'))
        return
      }
      exportBundleToDownload(buildExportBundle({ name: n, config, schemaId: schemaId() }))
      toast.ok(t('presets.exported', { name: n }), 'EXPORT')
    } catch (e) {
      toast.err((e as Error).message, t('presets.export_fail'))
    } finally {
      setBusy(false)
    }
  }

  const doImportFile = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const bundle = await readFileAsSavedBundle(file)
      onLoad(bundle.config, { schemaId: bundle.schema_id })
      const alsoSave = window.confirm(
        t('presets.import_also_save', { name: bundle.name }),
      )
      if (alsoSave) {
        await trainApi.saveConfig(bundle.name, bundle.config, bundle.schema_id)
        await refresh()
        toast.ok(t('presets.import_save', { name: bundle.name }), 'IMPORT')
      } else {
        toast.ok(t('presets.import_draft', { name: bundle.name }), 'IMPORT')
      }
      onClose()
    } catch (e) {
      toast.err((e as Error).message, t('presets.import_fail'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doImportExternal = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const response = await trainApi.importExternalConfig(file)
      const data = unwrap<{
        config?: Record<string, unknown>
        notes?: string[]
        mapped_count?: number
        format_name?: string
      }>(response)
      const config = data?.config
      if (!config || typeof config !== 'object') {
        throw new Error(t('presets.external_empty'))
      }
      onLoad(config, undefined)
      const mapped = Number(data.mapped_count || Object.keys(config).length || 0)
      const notePreview = (data.notes || [])
        .filter((line) => line && !String(line).startsWith('==='))
        .slice(0, 3)
        .join('；')
      const head = t('presets.external_ok', {
        format: data.format_name || 'external',
        count: String(mapped),
      })
      toast.ok(notePreview ? `${head} ${notePreview}` : head, 'IMPORT')
      onClose()
    } catch (e) {
      toast.err(formatApiMessage(e) || (e as Error).message, t('presets.import_fail'))
    } finally {
      setBusy(false)
      if (externalFileRef.current) externalFileRef.current.value = ''
    }
  }

  return (
    <Modal open={open} title={t('presets.title')} onClose={onClose} width={560}>
      <div className="lx-saved-row" style={{ marginBottom: 10 }}>
        <Input placeholder={t('presets.name_ph')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void doSave()}>{t('presets.save_current')}</Button>
      </div>
      <div className="lx-saved-row" style={{ marginBottom: 14, gap: 6 }}>
        <Button size="sm" disabled={busy} onClick={doExportCurrent} title={t('presets.export_current')}>{t('presets.export_current_btn')}</Button>
        <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>{t('presets.import_json')}</Button>
        <Button size="sm" disabled={busy} onClick={() => externalFileRef.current?.click()} title={t('presets.import_external_hint')}>
          {t('presets.import_external')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => void doImportFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={externalFileRef}
          type="file"
          accept=".toml,.json,.yaml,.yml,application/json,application/x-yaml,text/yaml"
          style={{ display: 'none' }}
          onChange={(e) => void doImportExternal(e.target.files?.[0] ?? null)}
        />
      </div>
      {items.length ? (
        <ul className="lx-saved-list">
          {items.map((it) => (
            <li key={it.name}>
              <span className="lx-num">{it.name}</span>
              <span className="lx-saved-actions">
                <Button size="sm" disabled={busy} onClick={() => void doLoad(it.name)}>{t('presets.load')}</Button>
                <Button size="sm" disabled={busy} onClick={() => void doExportNamed(it.name)}>{t('presets.export')}</Button>
                <Button size="sm" onClick={() => void doRename(it.name)}>{t('presets.rename')}</Button>
                <Button size="sm" variant="danger" onClick={() => void doDelete(it.name)}>{t('common.delete')}</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--lx-dim)' }}>{t('presets.empty')}</p>
      )}
    </Modal>
  )
}
