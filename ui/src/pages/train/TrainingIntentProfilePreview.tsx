// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { Button } from '@/components/primitives'
import { toast } from '@/stores/toastStore'

interface IntentProfile {
  label?: string
  priority_regions?: unknown
  target_module_policy?: unknown
  validation_focus?: unknown
  caption_policy?: unknown
  data_policy?: unknown
  region_policy?: unknown
}

interface IntentPreviewDiff {
  field: string
  current_value?: unknown
  suggested_value?: unknown
  current?: unknown
  suggested?: unknown
  status?: string
}

interface TrainingIntentPreviewData {
  schema_version?: string
  intent?: { normalized?: string; profile?: IntentProfile }
  suggested_config?: Record<string, unknown>
  applicable_suggestions?: Record<string, unknown>
  skipped_explicit_fields?: string[]
  resolved_config_diff?: IntentPreviewDiff[]
  will_change_config?: boolean
  runtime_applies_suggestions?: boolean
}

function formatPolicy(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.map(formatPolicy).filter((item) => item !== '—').join('、') || '—'
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${formatPolicy(item)}`)
      .join('；') || '—'
  }
  return String(value)
}

function formatValue(value: unknown): string {
  if (value === undefined) return '未设置'
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

export function TrainingIntentProfilePreview({
  config,
  explicitFields,
  onApplySuggestions,
}: {
  config: Record<string, unknown>
  explicitFields: string[]
  onApplySuggestions: (values: Record<string, unknown>) => void
}) {
  const intent = String(config.training_intent || 'normal')
  const [preview, setPreview] = useState<TrainingIntentPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [appliedCount, setAppliedCount] = useState(0)

  useEffect(() => {
    setPreview(null)
    setError('')
    setAppliedCount(0)
  }, [intent])

  const applicable = preview?.applicable_suggestions || {}
  const applicableKeys = useMemo(() => Object.keys(applicable), [applicable])
  const skipped = preview?.skipped_explicit_fields || []
  const diffByField = useMemo(
    () => new Map((preview?.resolved_config_diff || []).map((item) => [item.field, item])),
    [preview],
  )

  async function requestPreview() {
    setLoading(true)
    setError('')
    setAppliedCount(0)
    try {
      const data = unwrap<TrainingIntentPreviewData>(
        await trainApi.trainingIntentPreview(config, intent, explicitFields),
      )
      setPreview(data)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '训练用途建议预览失败'
      setError(message)
      toast.err(message, 'PROFILE')
    } finally {
      setLoading(false)
    }
  }

  function applySuggestions() {
    if (intent === 'normal' || !applicableKeys.length) return
    onApplySuggestions(applicable)
    setAppliedCount(applicableKeys.length)
    toast.ok(`已应用 ${applicableKeys.length} 个未显式设置项`, 'PROFILE')
  }

  const profile = preview?.intent?.profile
  const isNormal = intent === 'normal'

  return (
    <div className="lx-intent-preview">
      <div className="lx-intent-actions">
        <Button size="sm" disabled={loading} onClick={() => void requestPreview()}>
          {loading ? '正在预览…' : '预览建议'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={loading || isNormal || !applicableKeys.length || appliedCount > 0}
          onClick={applySuggestions}
        >
          应用未设置项
        </Button>
        <span>切换用途不会自动修改配置 · 已追踪 {explicitFields.length} 个会话内显式字段</span>
      </div>

      {error ? <p className="lx-intent-error">{error}</p> : null}
      {appliedCount > 0 ? <p className="lx-intent-ok">已应用 {appliedCount} 项；建议重新预览确认最新差异。</p> : null}

      {preview ? (
        <div className="lx-intent-result">
          <div className="lx-intent-summary">
            <div><b>Profile</b><span>{profile?.label || preview.intent?.normalized || intent}</span></div>
            <div><b>优先区域</b><span>{formatPolicy(profile?.priority_regions)}</span></div>
            <div><b>目标模块</b><span>{formatPolicy(profile?.target_module_policy)}</span></div>
            <div><b>验证重点</b><span>{formatPolicy(profile?.validation_focus)}</span></div>
            <div><b>Caption 策略</b><span>{formatPolicy(profile?.caption_policy)}</span></div>
            <div><b>数据策略</b><span>{formatPolicy(profile?.data_policy)}</span></div>
            <div><b>区域策略</b><span>{formatPolicy(profile?.region_policy)}</span></div>
          </div>

          {isNormal || !Object.keys(preview.suggested_config || {}).length ? (
            <p className="lx-intent-empty">普通用途不提供参数建议，当前配置保持原样。</p>
          ) : (
            <div className="lx-intent-lists">
              <div>
                <b>将修改（{applicableKeys.length}）</b>
                {applicableKeys.length ? (
                  <ul>{applicableKeys.map((field) => {
                    const diff = diffByField.get(field)
                    return <li key={field}><code>{field}</code><span>{formatValue(diff?.current_value ?? diff?.current)} → {formatValue(applicable[field])}</span></li>
                  })}</ul>
                ) : <p>没有可应用项。</p>}
              </div>
              <div>
                <b>因显式设置跳过（{skipped.length}）</b>
                {skipped.length ? (
                  <ul>{skipped.map((field) => {
                    const diff = diffByField.get(field)
                    return <li key={field}><code>{field}</code><span>保留 {formatValue(diff?.current_value ?? diff?.current)}</span></li>
                  })}</ul>
                ) : <p>没有被保护而跳过的字段。</p>}
              </div>
            </div>
          )}
          {preview.runtime_applies_suggestions === false ? <small>运行时不会自动应用这些建议。</small> : null}
        </div>
      ) : (
        <p className="lx-intent-empty">点击“预览建议”查看 Profile 摘要、可应用项与显式字段保护结果。</p>
      )}
    </div>
  )
}