// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import { usePageEntrance } from '@/motion/useEntrance'
import { PageHead, Panel } from '@/components/layout'
import { Badge, Bar, Button, Dot, Empty, Kpi } from '@/components/primitives'
import { NumberTicker } from '@/components/NumberTicker'
import { useMonitorStore, setMonitorMode, requestStopTraining } from '@/stores/monitorStore'
import { useRouteStore } from '@/stores/routeStore'
import { toast } from '@/stores/toastStore'
import type { RunStatePayload } from '@/api/monitorApi'
import { trainApi } from '@/api/trainApi'
import { findRunRecord } from '@/stores/historyStore'
import { LossChart } from './LossChart'
import { TrainingQualityReportPanel } from './TrainingQualityReportPanel'
import './monitor.css'
import { useI18n } from '@/i18n/useI18n'
import { Activity } from 'lucide-react'

/* 训练监控页:状态横幅 + 硬件 + loss/lr 曲线 + 日志终端 */

function statusTone(status: string): 'ok' | 'accent' | 'warn' | 'danger' | undefined {
  const s = status.toLowerCase()
  if (s === 'running') return 'ok'
  if (s === 'completed') return 'accent'
  if (s === 'failed' || s === 'orphaned') return 'danger'
  if (s) return 'warn'
  return undefined
}

function fmtLr(lr: number | undefined): string {
  if (!Number.isFinite(lr as number) || !lr) return '--'
  return lr >= 0.001 ? String(lr) : lr.toExponential(2)
}

function StatusBanner({ run, etaText, stepsPerSec, stopping }: {
  run: RunStatePayload
  etaText: string
  stepsPerSec: number
  stopping: boolean
}) {
  const { t } = useI18n()
  const status = String(run.status ?? 'unknown')
  const running = status.toLowerCase() === 'running'
  const step = Number(run.current_step ?? 0)
  const total = Number(run.total_steps ?? 0)
  const pct = total > 0 ? (step / total) * 100 : 0

  const navigate = useRouteStore((s) => s.navigate)
  const [retraining, setRetraining] = useState(false)

  const doStop = async () => {
    if (!window.confirm(t('monitor.terminate_confirm', { id: run.run_id ?? '' }))) return
    try {
      await requestStopTraining()
      toast.warn(t('monitor.terminate_sent'), 'STOP')
    } catch (e) {
      toast.err((e as Error).message, t('monitor.terminate_fail'))
    }
  }

  const doRetrain = async () => {
    const runId = String(run.run_id ?? '').trim()
    setRetraining(true)
    try {
      // applyConfigBag → restoreConfigService → configStore → schemaIndex 是一整条
      // 静态链;监控页是首屏默认页之一,静态 import 会把全量 schema(~740KB)拉进
      // 首屏必需的依赖图。RETRAIN 是用户点击后才发生的动作,await 一次动态 import
      // 正好落在既有的 setRetraining(true) 忙态里,不需要额外加载态。
      const { applyConfigBag, extractRunRestorable } = await import('@/lib/applyConfigBag')
      const local = findRunRecord(runId, String(run.config_name ?? ''))
      if (local?.config && Object.keys(local.config).length) {
        if (
          applyConfigBag({
            ok: true,
            typeId: local.typeId,
            schemaId: local.typeId,
            config: local.config,
            runId: local.id || runId,
            name: local.name,
            source: 'history',
          })
        ) {
          navigate('train')
        }
        return
      }
      if (!runId) {
        toast.warn(t('monitor.no_run_id'), 'RETRAIN')
        return
      }
      const resp = await trainApi.runRestorableConfig(runId)
      const bag = extractRunRestorable(resp, runId)
      if (applyConfigBag(bag, { toastTag: 'RETRAIN' })) navigate('train')
    } catch (e) {
      toast.err((e as Error).message, 'RETRAIN')
    } finally {
      setRetraining(false)
    }
  }

  return (
    <Panel title={t('monitor.current_run')} idx="01" panelId="RUN.STATE" className="lx-cfg-section">
      <div className="lx-mon-banner" role="status">
        <div className="lx-mon-id">
          <b className="lx-num">{String(run.run_id ?? '--')}</b>
          <span>
            {[run.training_type, run.model_type, run.config_name].filter(Boolean).join(' · ') || 'TRAINING RUN'}
          </span>
        </div>
        <Badge tone={statusTone(status)}>
          <Dot tone={running ? 'ok' : statusTone(status) === 'danger' ? 'danger' : 'idle'} pulse={running} /> {status.toUpperCase()}
        </Badge>
        <div className="lx-mon-stats">
          <div className="lx-mon-stat">
            <span>STEP</span>
            <b>
              <NumberTicker value={step} /> <i style={{ fontStyle: 'normal', color: 'var(--lx-dim)' }}>/ {total || '--'}</i>
            </b>
          </div>
          <div className="lx-mon-stat">
            <span>EPOCH</span>
            <b>
              {Number(run.current_epoch ?? 0)} <i style={{ fontStyle: 'normal', color: 'var(--lx-dim)' }}>/ {Number(run.total_epochs ?? 0) || '--'}</i>
            </b>
          </div>
          <div className="lx-mon-stat">
            <span>LOSS</span>
            <b className="accent">{Number.isFinite(run.last_loss as number) ? Number(run.last_loss).toFixed(4) : '--'}</b>
          </div>
          <div className="lx-mon-stat">
            <span>LR</span>
            <b>{fmtLr(run.last_lr as number | undefined)}</b>
          </div>
          <div className="lx-mon-stat">
            <span>SPEED</span>
            <b>{stepsPerSec > 0 ? `${stepsPerSec.toFixed(2)}/s` : '--'}</b>
          </div>
          <div className="lx-mon-stat">
            <span>ETA</span>
            <b>{etaText || '--'}</b>
          </div>
        </div>
        <Button size="sm" disabled={retraining || !run.run_id} onClick={() => void doRetrain()} title={t('monitor.retrain_title')}>
          {retraining ? t('monitor.retraining') : t('monitor.retrain')}
        </Button>
        {running ? (
          <Button variant="danger" size="sm" disabled={stopping} onClick={() => void doStop()}>
            {stopping ? t('monitor.stopping') : t('monitor.stop')}
          </Button>
        ) : null}
        <div className="lx-mon-progress">
          <Bar value={pct} lg shimmer={running} />
          <span className="lx-num">{pct.toFixed(1)}%</span>
        </div>
        {run.error ? <p style={{ flexBasis: '100%', color: 'var(--lx-danger)', fontSize: 12.5 }}>{String(run.error)}</p> : null}
      </div>
    </Panel>
  )
}

function HwStrip() {
  const { t } = useI18n()
  const gpus = useMonitorStore((s) => s.gpus)
  const cpu = useMonitorStore((s) => s.cpu)
  const ram = useMonitorStore((s) => s.ram)
  if (!gpus.length && !cpu && !ram) return null
  return (
    <Panel title={t('monitor.hardware')} idx="02" panelId="HW.TELEMETRY" className="lx-cfg-section">
      <div className="lx-mon-hwgrid">
        {gpus.map((g, i) => {
          const used = Number(g.used_mb ?? 0) / 1024
          const totalGb = Number(g.total_mb ?? 0) / 1024
          const util = Number(g.utilization ?? g.utilization_pct ?? 0)
          const temp = Number(g.temperature ?? g.temperature_c ?? NaN)
          return (
            <Kpi
              key={i}
              accent
              label={`GPU${gpus.length > 1 ? i : ''} · ${String(g.name ?? '').replace(/^NVIDIA\s*/i, '') || 'VRAM'}`}
              title={String(g.name ?? '')}
              value={
                <>
                  {used.toFixed(1)}<small style={{ fontSize: 11, color: 'var(--lx-dim)' }}>/{totalGb.toFixed(0)}G</small>{' '}
                  <NumberTicker value={util} />%{Number.isFinite(temp) ? ` ${temp.toFixed(0)}°` : ''}
                </>
              }
            />
          )
        })}
        {cpu ? <Kpi label="CPU" value={<><NumberTicker value={Number(cpu.percent ?? 0)} decimals={1} />%</>} /> : null}
        {ram ? (
          <Kpi
            label={`RAM · ${Number(ram.total_gb ?? 0).toFixed(0)}G`}
            value={<><NumberTicker value={Number(ram.used_gb ?? 0)} decimals={1} />G</>}
          />
        ) : null}
      </div>
    </Panel>
  )
}

function LogTerminal() {
  const { t } = useI18n()
  const lines = useMonitorStore((s) => s.logLines)
  const follow = useMonitorStore((s) => s.logFollow)
  const setFollow = useMonitorStore((s) => s.setLogFollow)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [lines, follow])

  const onScroll = () => {
    const el = boxRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (nearBottom !== follow) setFollow(nearBottom)
  }

  return (
    <Panel
      title={t('monitor.logs')}
      idx="05"
      panelId="OUTPUT.LOG"
      className="lx-cfg-section"
      right={<span className="lx-num" style={{ fontSize: 10, color: 'var(--lx-dim)' }}>{lines.length} LINES</span>}
    >
      <div className="lx-logwrap">
        <div ref={boxRef} className="lx-log-terminal" role="log" aria-label="Training output log" onScroll={onScroll}>
          {lines.length ? lines.join('\n') : <span className="dim">{t('monitor.wait_logs')}</span>}
        </div>
        {!follow ? (
          <Button size="sm" className="lx-log-follow" onClick={() => setFollow(true)}>
            ↓ 回到底部
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

export default function MonitorPage() {
  const { t } = useI18n()
  const ref = usePageEntrance()
  const navigate = useRouteStore((s) => s.navigate)
  const runId = useMonitorStore((s) => s.runId)
  const run = useMonitorStore((s) => s.run)
  const queued = useMonitorStore((s) => s.queued)
  const queueDepth = useMonitorStore((s) => s.queueDepth)
  const lossPoints = useMonitorStore((s) => s.lossPoints)
  const lrPoints = useMonitorStore((s) => s.lrPoints)
  const wsOn = useMonitorStore((s) => s.wsOn)
  const etaText = useMonitorStore((s) => s.etaText)
  const stepsPerSec = useMonitorStore((s) => s.stepsPerSec)
  const stopping = useMonitorStore((s) => s.stopping)

  useEffect(() => {
    setMonitorMode('page')
    return () => setMonitorMode('bg')
  }, [])

  return (
    <div ref={ref}>
      <PageHead
        idx="02 — MONITOR"
        tag="LIVE TELEMETRY FEED"
        lines={[{ text: 'TRAINING' }, { text: 'MONITOR_', outline: true }]}
        sub={
          <>
            {wsOn ? t('monitor.live_ws') : t('monitor.live_poll')} · {t('monitor.queue_depth', { n: queueDepth })}
          </>
        }
      />

      {run && runId ? (
        <>
          <StatusBanner run={run} etaText={etaText} stepsPerSec={stepsPerSec} stopping={stopping} />
          <HwStrip />
          <Panel title={t('monitor.chart')} idx="03" panelId="CHART.SERIES" className="lx-cfg-section">
            {lossPoints.length ? (
              <LossChart loss={lossPoints} lr={lrPoints} />
            ) : (
              <p style={{ color: 'var(--lx-dim)', padding: '38px 0', textAlign: 'center', font: '500 11px var(--lx-font-mono)', letterSpacing: '0.2em' }}>
                AWAITING PROGRESS DATA…
              </p>
            )}
          </Panel>
          <TrainingQualityReportPanel runId={runId} runStatus={String(run.status ?? '')} />
          <LogTerminal />
        </>
      ) : (
        <>
          <Panel title={t('monitor.current_run')} idx="01" panelId="RUN.STANDBY" className="lx-cfg-section">
            <Empty
              icon={<Activity size={28} />}
              title={t('monitor.empty_title')}
              desc={t('monitor.empty_desc')}
              headingLevel={2}
            >
              <Button variant="primary" onClick={() => navigate('train')}>
                {t('monitor.go_train')}
              </Button>
            </Empty>
          </Panel>
          <Panel title={t('monitor.chart')} idx="03" panelId="CHART.PLACEHOLDER" className="lx-cfg-section">
            <p style={{ color: 'var(--lx-dim)', padding: '38px 0', textAlign: 'center', font: '500 11px var(--lx-font-mono)', letterSpacing: '0.2em' }}>
              INSTRUMENT CONSOLE STANDBY · WAITING FOR RUN
            </p>
          </Panel>
          {queued.length ? (
            <Panel title={t('monitor.queued')} idx="Q" panelId="QUEUE.PENDING" className="lx-cfg-section">
              <ul className="lx-mon-queue">
                {queued.map((q, i) => (
                  <li key={i}>
                    <Dot tone="warn" />
                    <span className="lx-num">{String((q as { run_id?: string }).run_id ?? `#${i + 1}`)}</span>
                    <span className="dim">QUEUED</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  )
}
