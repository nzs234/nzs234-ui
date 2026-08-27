// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import type { SchemaField, SchemaFieldOption } from '@/schema/schemaIndex'
import { FieldShell, Input, Select, Slider, Switch, Textarea } from '@/components/form'
import { Button } from '@/components/primitives'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { candidatesForField, countCandidatesForField } from '@/lib/inventoryAutofill'
import type { PathCandidate } from '@/lib/modelPathMatch'
import { isPathEmptyForAutofill } from '@/lib/modelPathMatch'
import {
  checkPathStatus,
  isSaveTargetField,
  type PathCheckStatus,
} from '@/lib/pathExistsCheck'
import { normalizePreviewGroups } from '@/lib/previewGroups'
import {
  checkOutputConflictStatus,
  shouldCheckOutputConflict,
} from '@/lib/outputConflictCheck'
import {
  collectRecentDatasetPaths,
  isDatasetFolderField,
} from '@/lib/recentDatasetPaths'
import { useTrainConfigStore, useDraft } from '@/stores/configStore'
import { toast } from '@/stores/toastStore'
import {
  useI18n,
  translate,
  resolveDisabledReason,
} from '@/i18n/useI18n'
// 按 field.key 索引的 EN 大包(~300KB)只在这里被读到,单独成模块以免进启动链。
import {
  resolveFieldLabel,
  resolveFieldDesc,
  resolveOptionLabel,
} from '@/i18n/schemaFieldI18n'

/* schema 字段 → 控件。11 种字段类型的统一渲染入口。 */

function optionsOf(
  field: SchemaField,
  language: string,
  config: Record<string, unknown>,
): { value: string; label: string; disabled?: boolean; title?: string }[] {
  const source = typeof field.options === 'function' ? field.options(config) : field.options
  const rows = source && typeof source !== 'string' && Symbol.iterator in Object(source)
    ? Array.from(source)
    : []
  return rows.map((o) => {
    if (o && typeof o === 'object') {
      const opt = o as SchemaFieldOption
      const value = String(opt.value)
      return {
        value,
        label: resolveOptionLabel(field.key, opt, language),
        disabled: Boolean(opt.disabled),
        title: resolveDisabledReason(opt, language),
      }
    }
    const value = String(o)
    return {
      value,
      label: resolveOptionLabel(field.key, { value, label: value }, language),
    }
  })
}

async function browsePath(field: SchemaField, onChange: (v: unknown) => void) {
  const pickerType = field.pickerType || (field.type === 'folder' ? 'folder' : 'file')
  try {
    const payload = unwrap<Record<string, unknown>>(await trainApi.pickFile(pickerType, field.key))
    const path =
      (typeof payload === 'string' && payload) ||
      (payload && typeof payload === 'object' && (payload.path ?? payload.file ?? payload.folder))
    if (typeof path === 'string' && path) onChange(path)
    else toast.info(translate('field.path_unselected'))
  } catch (e) {
    toast.warn((e as Error).message, 'PICKER')
  }
}

async function browsePathAs(field: SchemaField, pickerType: string, onChange: (v: unknown) => void) {
  await browsePath({ ...field, pickerType }, onChange)
}

function formatSize(n: number): string {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}G`
}

function PathFieldRow({
  field,
  value,
  onChange,
  disabled = false,
  isRequired = false,
  isInvalid = false,
  errorMessageId,
  labelId,
}: {
  field: SchemaField
  value: string
  onChange: (raw: unknown) => void
  disabled?: boolean
  isRequired?: boolean
  isInvalid?: boolean
  errorMessageId?: string
  labelId?: string
}) {
  const { t } = useI18n()
  const typeId = useTrainConfigStore((s) => s.typeId)
  const showScan =
    field.type === 'file' &&
    (field.pickerType === 'model-file' ||
      field.pickerType === 'output-model-file' ||
      field.key === 'pretrained_model_name_or_path' ||
      field.key === 'vae' ||
      field.key === 'qwen3' ||
      field.key === 'network_weights' ||
      field.key === 'llm_adapter_path')
  const showRecent = field.type === 'folder' && isDatasetFolderField(field.key)
  const allowModelDirectory = field.allowModelDirectory === true
  const saveTarget = isSaveTargetField(field)

  const [open, setOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PathCandidate[]>([])
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [pathStatus, setPathStatus] = useState<PathCheckStatus>('idle')
  const [pathHint, setPathHint] = useState('')
  const [multiHint, setMultiHint] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const checkGen = useRef(0)

  useEffect(() => {
    if (!open && !recentOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setRecentOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, recentOpen])

  /* 非空非占位路径: debounce 校验存在性(不阻断编辑) */
  useEffect(() => {
    const gen = ++checkGen.current
    const text = String(value ?? '').trim()
    if (!text) {
      setPathStatus('idle')
      setPathHint('')
      return
    }
    setPathStatus('checking')
    setPathHint('')
    const t = window.setTimeout(() => {
      void checkPathStatus(text, {
        type: field.type,
        key: field.key,
        defaultValue: field.defaultValue,
        pickerType: field.pickerType,
        allowModelDirectory: field.allowModelDirectory,
      }).then((r) => {
        if (checkGen.current !== gen) return
        setPathStatus(r.status)
        setPathHint(r.message || '')
      })
    }, 520)
    return () => window.clearTimeout(t)
  }, [value, field.key, field.type, field.defaultValue, field.pickerType, field.allowModelDirectory])

  /* 空/占位 + 可扫描: 多候选灰字提示(复用 inventory 缓存) */
  useEffect(() => {
    if (!showScan) {
      setMultiHint('')
      return
    }
    const empty = isPathEmptyForAutofill(value, {
      key: field.key,
      type: field.type,
      pickerType: field.pickerType,
      defaultValue: field.defaultValue,
    })
    if (!empty) {
      setMultiHint('')
      return
    }
    let cancelled = false
    void countCandidatesForField(typeId, field.key).then((n) => {
      if (cancelled) return
      setMultiHint(n >= 2 ? t('field.multi_hint', { n }) : '')
    })
    return () => {
      cancelled = true
    }
  }, [showScan, value, typeId, field.key, field.type, field.pickerType, field.defaultValue])

  const openScan = async (refresh = false) => {
    setRecentOpen(false)
    setOpen(true)
    setLoading(true)
    try {
      const list = await candidatesForField(typeId, field.key, { refresh })
      setItems(list)
      if (!list.length) toast.info(t('field.scan_empty'), 'SCAN')
    } catch (e) {
      toast.warn((e as Error).message, 'SCAN')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const openRecent = () => {
    setOpen(false)
    const list = collectRecentDatasetPaths()
    setRecentPaths(list)
    setRecentOpen(true)
    if (!list.length) toast.info(t('field.recent_empty'), 'RECENT')
  }

  const bad = pathStatus === 'missing' || pathStatus === 'type_mismatch'
  const rowClass = ['lx-path-row', bad ? 'is-missing' : '', pathStatus === 'ok' ? 'is-ok' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className="lx-path-field" ref={rootRef}>
      <div className={rowClass}>
        <Input
          id={`lx-input-${field.key}`}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder || (field.type === 'folder' ? t('common.path_dir') : t('common.path_file'))}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={(bad || isInvalid) ? 'true' : undefined}
          aria-required={isRequired ? 'true' : undefined}
          aria-labelledby={labelId}
          aria-errormessage={(bad || isInvalid) ? errorMessageId : undefined}
        />
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => (saveTarget ? void browsePathAs(field, 'folder', onChange) : void browsePath(field, onChange))}
          title={saveTarget ? t('field.outdir_parent_title') : undefined}
        >
          {allowModelDirectory ? t('field.pick_file') : t('field.browse')}
        </Button>
        {allowModelDirectory ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void browsePathAs(field, 'folder', onChange)}>
            {t('field.pick_dir')}
          </Button>
        ) : null}
        {showScan ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void openScan(false)} title={t('field.scan_title')}>{t('field.scan')}</Button>
        ) : null}
        {showRecent ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={openRecent} title={t('field.recent_title')}>{t('field.recent')}</Button>
        ) : null}
      </div>
      {pathHint ? (
        <div className={['lx-path-hint', bad ? 'is-bad' : pathStatus === 'error' ? 'is-warn' : ''].filter(Boolean).join(' ')}>
          {pathHint}
        </div>
      ) : multiHint ? (
        <div className="lx-path-hint lx-path-hint-multi">{multiHint}</div>
      ) : null}
      {open && showScan ? (
        <div className="lx-scan-pop" role="region" aria-label={t('field.scan_results')}>
          <div className="lx-scan-pop-head">
            <span>{t('field.scan_results')}</span>
            <button type="button" className="lx-scan-refresh" onClick={() => void openScan(true)} disabled={loading}>
              {loading ? '…' : t('common.refresh')}
            </button>
          </div>
          {loading && !items.length ? <div className="lx-scan-empty">{t('field.scan_loading')}</div> : null}
          {!loading && !items.length ? <div className="lx-scan-empty">{t('field.scan_no_match')}</div> : null}
          <ul className="lx-scan-list">
            {items.map((it) => (
              <li key={it.path}>
                <button
                  type="button"
                  className="lx-scan-item"
                  title={it.path}
                  onClick={() => {
                    onChange(it.path)
                    setOpen(false)
                    toast.ok(t('field.filled', { name: it.name }), 'SCAN')
                  }}
                >
                  <b>{it.name}</b>
                  <span>
                    {[it.model_family, it.artifact_kind || it.model_type, formatSize(it.size)].filter(Boolean).join(' · ')}
                  </span>
                  <i>{it.path}</i>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recentOpen && showRecent ? (
        <div className="lx-scan-pop" role="region" aria-label={t('field.recent_paths')}>
          <div className="lx-scan-pop-head">
            <span>{t('field.recent_paths')}</span>
            <button type="button" className="lx-scan-refresh" onClick={openRecent}>{t('common.refresh')}</button>
          </div>
          {!recentPaths.length ? (
            <div className="lx-scan-empty">{t('field.recent_no_record')}</div>
          ) : (
            <ul className="lx-scan-list">
              {recentPaths.map((p) => {
                const leaf = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
                return (
                  <li key={p}>
                    <button
                      type="button"
                      className="lx-scan-item"
                      title={p}
                      onClick={() => {
                        onChange(p)
                        setRecentOpen(false)
                        toast.ok(t('field.filled', { name: leaf }), 'RECENT')
                      }}
                    >
                      <b>{leaf}</b>
                      <i>{p}</i>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** output_name 边输边检(依赖同 draft 的 output_dir) */
function OutputNameField({
  field,
  value,
  onChange,
  disabled = false,
  labelId,
}: {
  field: SchemaField
  value: string
  onChange: (raw: unknown) => void
  disabled?: boolean
  labelId?: string
}) {
  const { t } = useI18n()
  const draft = useDraft()
  const outputDir = String(draft.output_dir ?? '')
  const [hint, setHint] = useState('')
  const gen = useRef(0)

  useEffect(() => {
    const id = ++gen.current
    if (!shouldCheckOutputConflict(outputDir, value)) {
      setHint('')
      return
    }
    const t = window.setTimeout(() => {
      void checkOutputConflictStatus(outputDir, String(value ?? '')).then((r) => {
        if (gen.current !== id) return
        setHint(r.conflict ? r.message : '')
      })
    }, 500)
    return () => window.clearTimeout(t)
  }, [outputDir, value])

  return (
    <div className="lx-output-name-field">
      <Input id="lx-input-output_name" aria-labelledby={labelId} disabled={disabled} value={value} placeholder={field.placeholder || t('common.output_name_ph')} onChange={(e) => onChange(e.target.value)} />
      {hint ? <div className="lx-path-hint is-warn">{hint}</div> : null}
    </div>
  )
}

/* action handler 注册表:未实现的工具一律渲染按钮 + 占位提示,绝不返回 null */
type ActionHandler = (field: SchemaField, language: string) => void

function placeholderAction(field: SchemaField, language: string): void {
  const desc = resolveFieldDesc(field, language)
  const suffix = desc ? `：${desc}` : ''
  const msg = language === 'en'
    ? `Feature will be available in a later version (${String(field.handler || '')})${suffix}`
    : `功能将在后续版本提供（${String(field.handler || '')}）${suffix}`
  toast.info(msg, 'ACTION')
}

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  openAnimaFolderScanner: () => {
    void import('@/lib/animaFolderScan')
      .then((m) => m.openAnimaFolderScanner())
      .catch((e) => toast.warn((e as Error).message || 'scan failed', 'SCAN'))
  },
  openFimScanTool: placeholderAction,
  openLoraMetaReader: placeholderAction,
  openGoalForecastTool: placeholderAction,
  openCopilotTool: placeholderAction,
}

function parseObjectText(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function groupName(item: Record<string, unknown>, index: number, fallbackLabel: string): string {
  const name = String(item.name ?? '').trim()
  if (name) return name
  const prompt = String(item.prompt ?? '').trim()
  if (prompt) return prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt
  return fallbackLabel
}

/** preview_groups:可折叠 JSON 可编辑列表;值恒为对象数组,非法 JSON 不写回 */
function PreviewGroupsEditor({
  value,
  onChange,
  disabled = false,
  labelId,
  inputId,
}: {
  value: unknown
  onChange: (raw: unknown) => void
  disabled?: boolean
  labelId?: string
  inputId?: string
}) {
  const { t } = useI18n()
  const items = normalizePreviewGroups(value) as Record<string, unknown>[]
  const [drafts, setDrafts] = useState<string[]>(() => items.map((it) => JSON.stringify(it, null, 2)))

  useEffect(() => {
    setDrafts(items.map((it) => JSON.stringify(it, null, 2)))
    // 外部值变化才重同步;用户输入非法 JSON 不触发 onChange,草稿保留错误样式
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handleEdit = (index: number, text: string) => {
    const next = drafts.slice()
    next[index] = text
    setDrafts(next)
    const obj = parseObjectText(text)
    if (!obj) return
    const arr = items.slice()
    arr[index] = obj
    onChange(arr)
  }

  const handleAdd = () => {
    const arr = items.slice()
    arr.push({ name: '', mode: 'lora', prompt: '' })
    onChange(arr)
  }

  const handleRemove = (index: number) => {
    const arr = items.slice()
    arr.splice(index, 1)
    onChange(arr)
  }

  return (
    <div id={inputId} className="lx-preview-groups" role="group" aria-labelledby={labelId} tabIndex={-1}>
      {items.length === 0 ? <div className="lx-preview-groups-empty">{t('field.test_groups_empty')}</div> : null}
      {items.map((item, i) => {
        const error = parseObjectText(drafts[i] ?? '') == null
        const itemName = groupName(item, i, t('field.test_group_name', { n: i + 1 }))
        return (
          <details
            key={i}
            className={['lx-preview-group', error ? 'is-error' : ''].filter(Boolean).join(' ')}
          >
            <summary className="lx-preview-group-summary">
              <span className="lx-preview-group-name">{itemName}</span>
              <button
                type="button"
                className="lx-preview-group-remove"
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleRemove(i)
                }}
              >
                {t('field.remove')}
              </button>
            </summary>
            <div className="lx-preview-group-body">
              <Textarea
                rows={8}
                spellCheck={false}
                disabled={disabled}
                className={error ? 'is-invalid' : undefined}
                aria-label={itemName}
                value={drafts[i] ?? ''}
                onChange={(e) => handleEdit(i, e.target.value)}
              />
              {error ? <div className="lx-preview-group-error">{t('field.json_must_object')}</div> : null}
            </div>
          </details>
        )
      })}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={handleAdd}>
        {t('field.add_test_group')}
      </Button>
    </div>
  )
}

export function FieldControl({
  field,
  value,
  onChange,
  onHelp,
  disabled = false,
  disabledReason = '',
  isInvalid = false,
  isRequired = false,
  errorMessageId,
}: {
  field: SchemaField
  value: unknown
  onChange: (raw: unknown) => void
  onHelp: (field: SchemaField) => void
  disabled?: boolean
  disabledReason?: string
  isInvalid?: boolean
  isRequired?: boolean
  errorMessageId?: string
}) {
  const { t, language } = useI18n()
  const draft = useDraft()
  if (field.type === 'hidden') return null

  const label = resolveFieldLabel(field, language)
  const fieldId = `lx-field-ctrl-${field.key}`

  if (field.type === 'ui_group') {
    const desc = resolveFieldDesc(field, language)
    return (
      <div className="lx-ui-group-heading">
        <h4>{label}</h4>
        {desc ? <p>{desc}</p> : null}
      </div>
    )
  }

  const helpBtn = (
    <button
      type="button"
      className="lx-help"
      aria-label={`${t('field.help_title')}: ${label}`}
      title={t('field.help_title')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onHelp(field)
      }}
    >
      ?
    </button>
  )

  if (field.type === 'boolean') {
    return (
      <FieldShell
        id={fieldId}
        as="div"
        label={label}
        required={isRequired}
        right={helpBtn}
        className={[
          'lx-field-control',
          'lx-field-bool',
          'lx-field-bool-shell',
          disabled ? 'is-profile-managed' : '',
          isInvalid ? 'is-invalid' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="lx-field-bool-slot" title={resolveFieldDesc(field, language) || field.key}>
          <Switch
            id={`lx-input-${field.key}`}
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(v) => onChange(v)}
            ariaLabel={label}
            ariaRequired={isRequired}
            ariaInvalid={isInvalid}
            ariaErrorMessage={isInvalid ? errorMessageId : undefined}
          />
          {disabledReason ? <span className="lx-profile-managed-note">{disabledReason}</span> : null}
        </div>
      </FieldShell>
    )
  }

  if (field.type === 'action') {
    const buttonText = String(field.buttonLabel || field.title || label)
    const handler = String(field.handler || '')
    const run = ACTION_HANDLERS[handler] || placeholderAction
    const onAction = () => run(field, language)
    return (
      <FieldShell
        id={fieldId}
        as="div"
        label={label}
        right={helpBtn}
        className={['lx-field-control', 'lx-field-action-shell', disabled ? 'is-profile-managed' : ''].filter(Boolean).join(' ')}
      >
        <div className="lx-field-action-slot" title={field.desc || ''}>
          <Button size="sm" disabled={disabled} onClick={onAction}>
            {buttonText}
          </Button>
          {disabledReason ? <span className="lx-profile-managed-note">{disabledReason}</span> : null}
        </div>
      </FieldShell>
    )
  }

  let control: React.ReactNode
  const str = value == null ? '' : String(value)

  switch (field.type) {
    case 'select': {
      const opts = optionsOf(field, language, draft)
      control = (
        <Select
          id={`lx-input-${field.key}`}
          disabled={disabled}
          value={str}
          options={opts}
          onChange={(e) => onChange(e.target.value)}
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={isInvalid ? 'true' : undefined}
          aria-required={isRequired ? 'true' : undefined}
          aria-errormessage={isInvalid ? errorMessageId : undefined}
        />
      )
      break
    }
    case 'multiSelect': {
      const opts = optionsOf(field, language, draft)
      const selected = new Set(Array.isArray(value) ? value.map(String) : [])
      control = (
        <div
          id={`lx-input-${field.key}`}
          className={['lx-multi-select', isInvalid ? 'is-invalid' : ''].filter(Boolean).join(' ')}
          role="group"
          tabIndex={-1}
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={isInvalid ? 'true' : undefined}
          aria-required={isRequired ? 'true' : undefined}
          aria-errormessage={isInvalid ? errorMessageId : undefined}
        >
          {opts.map((option) => (
            <label key={option.value} className="lx-multi-select-option">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  const next = new Set(selected)
                  if (event.target.checked) next.add(option.value)
                  else next.delete(option.value)
                  onChange(Array.from(next))
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )
      break
    }
    case 'number':
      control = (
        <Input
          id={`lx-input-${field.key}`}
          inputMode="decimal"
          disabled={disabled}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={isInvalid ? 'true' : undefined}
          aria-required={isRequired ? 'true' : undefined}
          aria-errormessage={isInvalid ? errorMessageId : undefined}
        />
      )
      break
    case 'slider': {
      const num = typeof value === 'number' ? value : Number(value) || Number(field.min ?? 0)
      control = (
        <div className="lx-slider-row">
          <Slider
            id={`lx-range-${field.key}`}
            min={Number(field.min ?? 0)}
            max={Number(field.max ?? 100)}
            step={Number(field.step ?? 1)}
            value={num}
            disabled={disabled}
            ariaLabelledby={`${fieldId}-label`}
            onChange={(v) => onChange(v)}
          />
          <Input
            id={`lx-input-${field.key}`}
            className="lx-slider-num"
            inputMode="decimal"
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            aria-label={t('field.exact_value', { label })}
            aria-invalid={isInvalid ? 'true' : undefined}
            aria-required={isRequired ? 'true' : undefined}
            aria-errormessage={isInvalid ? errorMessageId : undefined}
          />
        </div>
      )
      break
    }
    case 'textarea':
      control = (
        <Textarea
          id={`lx-input-${field.key}`}
          rows={3}
          disabled={disabled}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-labelledby={`${fieldId}-label`}
          aria-invalid={isInvalid ? 'true' : undefined}
          aria-required={isRequired ? 'true' : undefined}
          aria-errormessage={isInvalid ? errorMessageId : undefined}
        />
      )
      break
    case 'file':
    case 'folder':
      control = <PathFieldRow field={field} value={str} onChange={onChange} disabled={disabled} isRequired={isRequired} isInvalid={isInvalid} errorMessageId={errorMessageId} labelId={`${fieldId}-label`} />
      break
    case 'preview_groups':
      control = <PreviewGroupsEditor value={value} onChange={onChange} disabled={disabled} labelId={`${fieldId}-label`} inputId={`lx-input-${field.key}`} />
      break
    default:
      if (field.key === 'output_name') {
        control = <OutputNameField field={field} value={str} onChange={onChange} disabled={disabled} labelId={`${fieldId}-label`} />
      } else {
        // string / text / 未知类型兜底
        control = (
          <Input
            id={`lx-input-${field.key}`}
            disabled={disabled}
            value={str}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            aria-labelledby={`${fieldId}-label`}
            aria-invalid={isInvalid ? 'true' : undefined}
            aria-required={isRequired ? 'true' : undefined}
            aria-errormessage={isInvalid ? errorMessageId : undefined}
          />
        )
      }
  }

  return (
    <FieldShell
      id={fieldId}
      as="div"
      label={label}
      required={isRequired}
      right={helpBtn}
      className={[
        'lx-field-control',
        field.type === 'textarea' || field.type === 'preview_groups'
          ? 'lx-span-full'
          : field.type === 'file' || field.type === 'folder'
            ? 'lx-span-2'
            : '',
        disabled ? 'is-profile-managed' : '',
        isInvalid ? 'is-invalid' : '',
      ].filter(Boolean).join(' ') || undefined}
    >
      <div className="lx-field-control-slot" title={resolveFieldDesc(field, language) || ''}>
        {control}
        {disabledReason ? <span className="lx-profile-managed-note">{disabledReason}</span> : null}
      </div>
    </FieldShell>
  )
}
