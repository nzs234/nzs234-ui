// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@/components/layout'
import { Badge, Button, Dot } from '@/components/primitives'
import { monitorApi, type QualityTrend, type TrainingQualityReportPayload } from '@/api/monitorApi'
import { unwrap } from '@/api/transport'

const SCHEMA_ID = 'lulynx.training_quality_report'
const TERMINAL = new Set(['completed', 'finished', 'failed', 'orphaned', 'stopped', 'terminated', 'cancelled', 'canceled'])

const latestLabels: Record<string, string> = {
  loss: 'LOSS',
  validation_loss: 'VAL LOSS',
  train_validation_gap: 'TRAIN / VAL GAP',
  train_validation_gap_ratio: 'GAP RATIO',
  gradient_norm: 'GRAD NORM',
  adapter_update_norm: 'UPDATE NORM',
  adapter_weight_norm: 'WEIGHT NORM',
}

const coverageLabels: Record<string, string> = {
  numeric: '数值', validation: '验证集', adapter_update: '更新量',
  adapter_weight: '权重范数', regions: '区域', visual: '视觉评估',
}

function isTerminal(status: string): boolean {
  return TERMINAL.has(status.trim().toLowerCase())
}

function fmt(value: unknown): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  const abs = Math.abs(number)
  if (abs > 0 && (abs < 0.001 || abs >= 10000)) return number.toExponential(3)
  return number.toFixed(4).replace(/\.?0+$/, '')
}

function fmtTime(value: string | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function tone(status: string | undefined): 'ok' | 'accent' | 'warn' | 'danger' | undefined {
  const value = String(status ?? '').toLowerCase()
  if (['available', 'observed', 'decreasing', 'not_detected'].includes(value)) return 'ok'
  if (['warning', 'increasing', 'detected'].includes(value)) return 'warn'
  if (['danger', 'failed', 'non_finite'].includes(value)) return 'danger'
  if (value) return 'accent'
  return undefined
}

function Trend({ label, trend }: { label: string; trend?: QualityTrend }) {
  const direction = String(trend?.direction ?? trend?.status ?? 'unavailable')
  return (
    <div className="lx-quality-trend">
      <span>{label}</span>
      <Badge tone={tone(direction)}>{direction.toUpperCase()}</Badge>
      <b>{fmt(trend?.start)} → {fmt(trend?.end)}</b>
      <small>{Number(trend?.point_count ?? 0)} POINTS</small>
    </div>
  )
}

type ScalarMetric = string | number | boolean

function scalarMetrics(values: Record<string, unknown>): [string, ScalarMetric][] {
  const entries: [string, ScalarMetric][] = []
  const append = (key: string, value: unknown) => {
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      entries.push([key, value as ScalarMetric])
    }
  }

  Object.entries(values).forEach(([key, value]) => {
    append(key, value)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
        append(`${key}.${childKey}`, childValue)
      })
    }
  })
  return entries.slice(0, 8)
}

function ObjectMetrics({ values }: { values: Record<string, unknown> }) {
  const entries = scalarMetrics(values)
  if (!entries.length) return <span className="lx-quality-dim">无可展示的标量</span>
  return (
    <div className="lx-quality-mini-grid">
      {entries.map(([key, value]) => <span key={key}><i>{key}</i><b>{typeof value === 'number' ? fmt(value) : String(value)}</b></span>)}
    </div>
  )
}

function ReportBody({ report }: { report: TrainingQualityReportPayload }) {
  const alerts = report.health?.alerts ?? []
  const coverage = Object.entries(report.coverage ?? {})
  const regions = report.regions ?? {}
  const visual = report.visual_evaluation ?? {}
  const reward = report.reward_evaluation ?? {}
  const rewardTotal = reward.total ?? {}
  const rewardComponents = reward.components ?? []
  const rewardSuite = reward.suite ?? {}
  const regionLoss = Object.entries(regions.loss ?? {})

  return (
    <div className="lx-quality-report">
      <div className="lx-quality-head">
        <Badge tone={tone(report.status)}>
          <Dot tone={report.status === 'available' ? 'ok' : 'idle'} /> {String(report.status ?? 'unknown').toUpperCase()}
        </Badge>
        <span>RUN {report.run_status ?? '--'} · {fmtTime(report.generated_at)}</span>
      </div>

      <div className="lx-quality-kpis">
        {Object.entries(latestLabels).map(([key, label]) => (
          <div key={key}><span>{label}</span><b>{fmt(report.latest?.[key])}</b></div>
        ))}
      </div>

      <div className="lx-quality-grid">
        <section>
          <h4>趋势</h4>
          <Trend label="LOSS" trend={report.trends?.loss} />
          <Trend label="VAL LOSS" trend={report.trends?.validation_loss} />
          <Trend label="GAP" trend={report.trends?.train_validation_gap} />
        </section>
        <section>
          <h4>健康状态</h4>
          <div className="lx-quality-health">
            <Badge tone={tone(report.health?.status)}>{String(report.health?.status ?? 'unknown').toUpperCase()}</Badge>
            <span>梯度 {report.health?.gradient_behavior ?? 'unknown'}</span>
            <span>权重 {report.health?.adapter_weight_growth ?? 'unknown'}</span>
            <span>NaN / Inf {report.health?.nan_inf_detected ? 'DETECTED' : 'NO'}</span>
          </div>
          {alerts.length ? (
            <ul className="lx-quality-alerts">
              {alerts.map((alert, index) => <li key={`${alert.code}-${index}`}><b>{alert.severity ?? 'notice'}</b>{alert.message ?? alert.code}</li>)}
            </ul>
          ) : <p className="lx-quality-dim">当前遥测未生成健康告警。</p>}
        </section>
      </div>

      <div className="lx-quality-grid">
        <section>
          <h4>覆盖与区域</h4>
          <div className="lx-quality-coverage">
            {coverage.map(([key, available]) => <span key={key} className={available ? 'on' : ''}>{coverageLabels[key] ?? key}</span>)}
          </div>
          {regionLoss.length
            ? <ObjectMetrics values={Object.fromEntries(regionLoss)} />
            : <p className="lx-quality-dim">区域指标不可用 · dominance {regions.gradient_dominance ?? 'unknown'}</p>}
        </section>
        <section>
          <h4>视觉评估</h4>
          <Badge tone={tone(visual.status)}>{String(visual.status ?? 'unavailable').toUpperCase()}</Badge>
          <ObjectMetrics values={visual.metrics ?? {}} />
          {visual.error ? <p className="lx-quality-error">{visual.error}</p> : null}
        </section>
      </div>

      <div className="lx-quality-grid">
        <section>
          <h4>多目标 RewardReport</h4>
          <div className="lx-quality-reward-head">
            <Badge tone={tone(reward.status)}>{String(reward.status ?? 'unavailable').toUpperCase()}</Badge>
            <b>{fmt(rewardTotal.score)}</b>
            <span>BASE {fmt(rewardTotal.base_score)} · Δ {fmt(rewardTotal.delta)}</span>
          </div>
          {rewardComponents.length ? (
            <div className="lx-quality-reward-list">
              {rewardComponents.map((component) => (
                <div key={component.name}>
                  <span>{component.name ?? 'metric'}</span>
                  <b>{fmt(component.base_value)} → {fmt(component.checkpoint_value)}</b>
                  <small>W {fmt(component.weight)} · C {fmt(component.confidence)} · N {component.sample_count ?? 0}</small>
                  {component.failure_reason ? <i>{component.failure_reason}</i> : null}
                </div>
              ))}
            </div>
          ) : <p className="lx-quality-dim">尚无 RewardReport 指标证据。</p>}
        </section>
        <section>
          <h4>固定验证套件</h4>
          <ObjectMetrics values={{
            suite_id: rewardSuite.suite_id ?? '',
            case_count: rewardSuite.case_count ?? 0,
            baseline_mode: rewardSuite.baseline_mode ?? '',
            fingerprint: rewardSuite.fingerprint ? `${rewardSuite.fingerprint.slice(0, 12)}…` : '',
          }} />
          <Trend label="REWARD" trend={reward.trends?.total} />
          {rewardTotal.failure_reason ? <p className="lx-quality-error">{rewardTotal.failure_reason}</p> : null}
        </section>
      </div>

      {report.limitations?.length ? (
        <details className="lx-quality-limitations">
          <summary>局限性 · {report.limitations.length}</summary>
          <ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </details>
      ) : null}
    </div>
  )
}

export function TrainingQualityReportPanel({ runId, runStatus }: { runId: string; runStatus: string }) {
  const [report, setReport] = useState<TrainingQualityReportPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const statusRef = useRef(runStatus)

  const load = useCallback(async () => {
    const normalized = runId.trim()
    if (!normalized) return
    const requestId = ++requestRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    try {
      const payload = unwrap<TrainingQualityReportPayload>(await monitorApi.qualityReport(normalized, controller.signal))
      if (payload.schema_id !== SCHEMA_ID || Number(payload.schema_version) !== 1) {
        throw new Error('后端返回了不受支持的训练质量报告 schema')
      }
      if (requestId === requestRef.current) setReport(payload)
    } catch (reason) {
      if (!controller.signal.aborted && requestId === requestRef.current) {
        setError((reason as Error).message || '质量报告加载失败')
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [runId])

  useEffect(() => {
    setReport(null)
    statusRef.current = runStatus
    void load()
    return () => controllerRef.current?.abort()
    // runStatus 由下一段 effect 处理，避免普通状态轮询触发报告请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, load])

  useEffect(() => {
    const previous = statusRef.current
    statusRef.current = runStatus
    if (previous !== runStatus && isTerminal(runStatus)) void load()
  }, [runStatus, load])

  return (
    <Panel
      title="训练质量报告"
      idx="04"
      panelId="QUALITY.REPORT"
      className="lx-cfg-section"
      right={<Button size="sm" onClick={() => void load()} disabled={loading}>{loading ? '加载中…' : '手动刷新'}</Button>}
    >
      {report
        ? <ReportBody report={report} />
        : error
          ? <div className="lx-quality-empty error">{error}</div>
          : <div className="lx-quality-empty">正在读取多指标质量报告…</div>}
    </Panel>
  )
}
