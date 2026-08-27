// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import { usePageEntrance } from '@/motion/useEntrance'
import { PageHead, Panel } from '@/components/layout'
import { Badge, Bar, Button, Dot, Empty } from '@/components/primitives'
import { Modal } from '@/components/overlay'
import { queueApi, type QueueReplayKind, type TaskRecord, type QueueWorkbenchPayload } from '@/api/queueApi'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { applyConfigBag, extractRunRestorable } from '@/lib/applyConfigBag'
import {
  findRunRecord,
  bootstrapRunHistory,
  type RunRecord,
} from '@/stores/historyStore'
import { useRouteStore } from '@/stores/routeStore'
import { toast } from '@/stores/toastStore'
import './queue.css'
import { useI18n } from '@/i18n/useI18n'
import { Layers } from 'lucide-react'

/* 队列/历史页:/api/tasks 聚合列表 + 终止/删除 + /train/queue 工作台控制
   (pause/resume 仅当前运行条目,reorder 仅排队条目,replay 仅终态条目) */

type Filter = 'all' | 'running' | 'completed' | 'failed'

const RUNNING_SET = new Set(['RUNNING', 'PENDING', 'QUEUED', 'STARTING'])
const PAUSED_STATUS = 'PAUSED'
/* 与后端 workbench._TERMINAL 对齐(completed/finished/failed/cancelled/canceled/stopped)。 */
const TERMINAL_SET = new Set(['COMPLETED', 'FINISHED', 'FAILED', 'ERROR', 'ORPHANED', 'STOPPED', 'CANCELLED', 'CANCELED'])
/* requeue 仅允许 failed 系(c cancelled/stopped);completed 走 rerun。 */
const REQUEUEABLE_SET = new Set(['FAILED', 'ERROR', 'ORPHANED', 'STOPPED', 'CANCELLED', 'CANCELED'])

interface QueueContext {
  /** 工作台 revision;<0 表示不可用(工作台未取到),reorder 按钮退化为禁用。 */
  revision: number
  /** 当前排队顺序(run_id 列表),来自 GET /train/queue。 */
  queuedIds: string[]
  /** 工作台认定的当前运行 run_id;pause/resume 只对该条目有效。 */
  currentIndex: string | null
  /** 当前运行是否处于挂起状态(决定显示 pause 还是 resume)。 */
  paused: boolean
}

function newRequestId(): string {
  /* 后端仅放行 [A-Za-z0-9_-](自动清洗+截断到 128);这里直接产出安全形态。 */
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function statusTone(status: string): 'ok' | 'accent' | 'warn' | 'danger' | undefined {
  const s = status.toUpperCase()
  if (s === 'RUNNING') return 'ok'
  if (s === 'COMPLETED' || s === 'FINISHED') return 'accent'
  if (s === 'FAILED' || s === 'ERROR' || s === 'ORPHANED') return 'danger'
  if (s) return 'warn'
  return undefined
}

function taskId(task: TaskRecord): string {
  return String(task.task_id ?? task.id ?? '')
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString()
}

function matchFilter(task: TaskRecord, f: Filter): boolean {
  const s = String(task.status ?? '').toUpperCase()
  if (f === 'all') return true
  if (f === 'running') return RUNNING_SET.has(s)
  if (f === 'completed') return s === 'COMPLETED' || s === 'FINISHED'
  return s === 'FAILED' || s === 'ERROR' || s === 'ORPHANED'
}

function TaskRow({ task, ctx, onDetail, onChanged }: {
  task: TaskRecord
  ctx: QueueContext
  onDetail: (t: TaskRecord) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const id = taskId(task)
  const status = String(task.status ?? 'UNKNOWN').toUpperCase()
  const running = RUNNING_SET.has(status)
  const pausedNow = status === PAUSED_STATUS || ctx.paused
  const queuedIndex = id ? ctx.queuedIds.indexOf(id) : -1
  const isQueued = queuedIndex >= 0
  /* pause/resume 只对工作台当前运行条目有效(后端对其他条目一律 409)。 */
  const isCurrent = Boolean(id) && ctx.currentIndex === id
  const canPause = isCurrent && !pausedNow
  const canResume = isCurrent && pausedNow
  /* replay 只对终态条目开放;failed 系走 requeue,completed 走 rerun。 */
  const canReplay = Boolean(id) && TERMINAL_SET.has(status)
  const progress = Math.round(Number(task.progress ?? 0))
  const meta = task.metadata ?? {}
  const label = String(task.name ?? (meta as { config_name?: string }).config_name ?? id)

  const doTerminate = async () => {
    if (!window.confirm(t('queue.terminate_confirm', { label }))) return
    try {
      unwrap(await queueApi.terminate(id))
      toast.warn(t('queue.terminate_sent'), 'TERMINATE')
      onChanged()
    } catch (e) {
      toast.err((e as Error).message, t('queue.terminate_fail'))
    }
  }

  const doDelete = async () => {
    if (!window.confirm(t('queue.delete_confirm', { label }))) return
    try {
      unwrap(await queueApi.deleteTask(id))
      onChanged()
    } catch (e) {
      toast.err((e as Error).message, t('queue.delete_fail'))
    }
  }

  /* 挂起/恢复:轻量操作不打断用户,成功与否交给刷新后的状态按钮体现。 */
  const doControl = async (action: 'pause' | 'resume') => {
    try {
      unwrap(await (action === 'pause' ? queueApi.pause(id) : queueApi.resume(id)))
    } catch (e) {
      toast.err((e as Error).message, action === 'pause' ? t('queue.pause_fail') : t('queue.resume_fail'))
    }
    onChanged()
  }

  /* 上移/下移 → 全量重排接口:ordered_run_ids 必须是全部排队 run_id 的排列。 */
  const doMove = async (dir: -1 | 1) => {
    if (ctx.revision < 0 || !isQueued) return
    const to = queuedIndex + dir
    if (to < 0 || to >= ctx.queuedIds.length) return
    const next = [...ctx.queuedIds]
    ;[next[queuedIndex], next[to]] = [next[to], next[queuedIndex]]
    try {
      unwrap(await queueApi.reorder(ctx.revision, next))
    } catch (e) {
      toast.err((e as Error).message, t('queue.reorder_fail'))
    }
    /* 无论成败都回读:revision/顺序可能已被并发操作推进。 */
    onChanged()
  }

  const doReplay = async () => {
    if (!window.confirm(t('queue.replay_confirm', { label }))) return
    const kind: QueueReplayKind = REQUEUEABLE_SET.has(status) ? 'requeue' : 'rerun'
    try {
      unwrap(await queueApi.replay(id, kind, newRequestId()))
      toast.info(t('queue.replay_sent'), 'REPLAY')
      onChanged()
    } catch (e) {
      toast.err((e as Error).message, t('queue.replay_fail'))
    }
  }

  return (
    <li className="lx-task-row">
      <Dot tone={running ? 'ok' : statusTone(status) === 'danger' ? 'danger' : statusTone(status) === 'accent' ? 'accent' : 'idle'} pulse={running} />
      <div className="lx-task-main">
        <b>{label}</b>
        <span className="lx-num">
          {id || '--'} · {fmtTime(task.created_at)}
          {task.queue_position != null ? ` · ${t('queue.position', { n: task.queue_position })}` : ''}
        </span>
        {task.error ? <span className="lx-task-err">{String(task.error)}</span> : null}
      </div>
      {running && progress > 0 ? (
        <div className="lx-task-progress">
          <Bar value={progress} thin />
          <span className="lx-num">{progress}%</span>
        </div>
      ) : null}
      <Badge tone={statusTone(status)}>{status}</Badge>
      <div className="lx-task-actions">
        <Button size="sm" onClick={() => onDetail(task)}>{t('common.detail')}</Button>
        {canPause ? (
          <Button size="sm" onClick={() => void doControl('pause')}>{t('queue.pause')}</Button>
        ) : null}
        {canResume ? (
          <Button size="sm" onClick={() => void doControl('resume')}>{t('queue.resume')}</Button>
        ) : null}
        {isQueued ? (
          <>
            <Button size="sm" disabled={ctx.revision < 0 || queuedIndex <= 0} onClick={() => void doMove(-1)}>
              {t('queue.move_up')}
            </Button>
            <Button size="sm" disabled={ctx.revision < 0 || queuedIndex >= ctx.queuedIds.length - 1} onClick={() => void doMove(1)}>
              {t('queue.move_down')}
            </Button>
          </>
        ) : null}
        {canReplay ? (
          <Button size="sm" onClick={() => void doReplay()}>{t('queue.replay')}</Button>
        ) : null}
        {running ? (
          <Button size="sm" variant="danger" onClick={() => void doTerminate()}>{t('queue.terminate')}</Button>
        ) : (
          <Button size="sm" variant="danger" onClick={() => void doDelete()}>{t('common.delete')}</Button>
        )}
      </div>
    </li>
  )
}

function DetailModal({ task, onClose }: { task: TaskRecord | null; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useRouteStore((s) => s.navigate)
  const [busy, setBusy] = useState(false)
  const record: RunRecord | undefined = useMemo(() => {
    if (!task) return undefined
    return findRunRecord(taskId(task), String(task.name ?? ''))
  }, [task])

  const copyParams = async () => {
    if (!task) return
    setBusy(true)
    try {
      if (record?.config && Object.keys(record.config).length) {
        applyConfigBag({
          ok: true,
          typeId: record.typeId,
          schemaId: record.typeId,
          config: record.config,
          runId: record.id,
          name: record.name,
          source: 'history',
        })
        onClose()
        navigate('train')
        return
      }
      const id = taskId(task)
      if (!id) {
        toast.warn(t('queue.no_task_id'), 'PARAMS')
        return
      }
      const resp = await trainApi.runRestorableConfig(id)
      const bag = extractRunRestorable(resp, id)
      if (!applyConfigBag(bag)) return
      onClose()
      navigate('train')
    } catch (e) {
      toast.err((e as Error).message, 'PARAMS')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!task} title={t('queue.detail_title', { id: task ? String(task.name ?? taskId(task)) : '' })} onClose={onClose} width={640}>
      {task ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void copyParams()}>
              {busy
                ? t('common.loading')
                : record
                  ? t('queue.copy_params', { type: record.typeId })
                  : t('queue.backfill')}
            </Button>
            {!record ? (
              <p style={{ color: 'var(--lx-dim)', fontSize: 12, marginTop: 8 }}>
                {t('queue.no_local_snapshot')}
              </p>
            ) : null}
          </div>
          <pre className="lx-log" style={{ maxHeight: 380 }}>{JSON.stringify(task, null, 2)}</pre>
        </>
      ) : null}
    </Modal>
  )
}

export default function QueuePage() {
  const ref = usePageEntrance()
  const { t } = useI18n()
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [queueInfo, setQueueInfo] = useState<QueueWorkbenchPayload | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [detail, setDetail] = useState<TaskRecord | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void bootstrapRunHistory()
  }, [])

  const refresh = async () => {
    try {
      const data = unwrap<{ tasks?: TaskRecord[] }>(await queueApi.tasks())
      const list = [...(data?.tasks ?? [])]
      list.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      setTasks(list)
    } catch {
      /* 后端未起,顶栏已示警 */
    } finally {
      setLoaded(true)
    }
    /* 工作台投影独立获取:失败只退化掉控制按钮,不拖垮任务列表刷新。 */
    const wb = await queueApi.workbench().catch(() => null)
    if (wb) setQueueInfo(wb)
  }

  /* reorder/pause/resume/replay 共用的后端状态快照(见 backend workbench 语义)。 */
  const queueCtx = useMemo<QueueContext>(() => {
    const revisionRaw = Number(queueInfo?.revision)
    return {
      revision: Number.isFinite(revisionRaw) && revisionRaw >= 0 ? Math.trunc(revisionRaw) : -1,
      queuedIds: (queueInfo?.queued_runs ?? [])
        .map((entry) => String(entry.run_id ?? ''))
        .filter(Boolean),
      currentIndex: queueInfo?.current_run_id ? String(queueInfo.current_run_id) : null,
      paused: String(queueInfo?.current_status ?? '').trim().toLowerCase() === 'paused',
    }
  }, [queueInfo])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(t)
  }, [])

  const doClear = async () => {
    if (!window.confirm(t('queue.clear_confirm'))) return
    try {
      unwrap(await queueApi.deleteAll())
      toast.info(t('queue.cleared'), 'CLEARED')
      void refresh()
    } catch (e) {
      toast.err((e as Error).message, t('queue.clear_fail'))
    }
  }

  const shown = tasks.filter((t) => matchFilter(t, filter))
  const counts: Record<Filter, number> = {
    all: tasks.length,
    running: tasks.filter((t) => matchFilter(t, 'running')).length,
    completed: tasks.filter((t) => matchFilter(t, 'completed')).length,
    failed: tasks.filter((t) => matchFilter(t, 'failed')).length,
  }
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: t('common.all') },
    { id: 'running', label: t('common.running_queued') },
    { id: 'completed', label: t('common.completed') },
    { id: 'failed', label: t('common.failed') },
  ]

  return (
    <div ref={ref}>
      <PageHead
        idx="03 — QUEUE"
        tag="MISSION ARCHIVE"
        lines={[{ text: 'QUEUE &' }, { text: 'HISTORY_', outline: true }]}
        sub={t('queue.sub', { running: counts.running, total: tasks.length })}
      />

      <Panel
        title={t('queue.records_title')}
        idx="01"
        panelId="TASKS.ARCHIVE"
        right={
          <div className="lx-queue-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={['lx-filter-btn', filter === f.id ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <i>{counts[f.id]}</i>
              </button>
            ))}
            <Button size="sm" onClick={() => void doClear()}>{t('queue.clear_records')}</Button>
          </div>
        }
      >
        {shown.length ? (
          <ul className="lx-task-list">
            {shown.map((t, i) => (
              <TaskRow key={taskId(t) || i} task={t} ctx={queueCtx} onDetail={setDetail} onChanged={() => void refresh()} />
            ))}
          </ul>
        ) : (
          <Empty
            icon={<Layers size={28} />}
            title={loaded ? t('queue.empty_title') : t('common.loading')}
            desc={loaded ? t('queue.empty_desc') : undefined}
            headingLevel={3}
          >
            {loaded && (
              <Button variant="primary" onClick={() => useRouteStore.getState().navigate('train')}>
                {t('queue.go_train')}
              </Button>
            )}
          </Empty>
        )}
      </Panel>

      <DetailModal task={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
