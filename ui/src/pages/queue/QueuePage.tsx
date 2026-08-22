// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import { usePageEntrance } from '@/motion/useEntrance'
import { PageHead, Panel } from '@/components/layout'
import { Badge, Bar, Button, Dot, Empty } from '@/components/primitives'
import { Modal } from '@/components/overlay'
import { queueApi, type TaskRecord } from '@/api/queueApi'
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

/* 队列/历史页:/api/tasks 聚合列表 + 终止/删除 + 本地历史参数复制 */

type Filter = 'all' | 'running' | 'completed' | 'failed'

const RUNNING_SET = new Set(['RUNNING', 'PENDING', 'QUEUED', 'STARTING'])

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

function TaskRow({ task, onDetail, onChanged }: {
  task: TaskRecord
  onDetail: (t: TaskRecord) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const id = taskId(task)
  const status = String(task.status ?? 'UNKNOWN').toUpperCase()
  const running = RUNNING_SET.has(status)
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
  }

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
              <TaskRow key={taskId(t) || i} task={t} onDetail={setDetail} onChanged={() => void refresh()} />
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
