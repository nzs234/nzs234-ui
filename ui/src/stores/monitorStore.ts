// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { create } from 'zustand'
import {
  monitorApi,
  type ActivePayload,
  type ChartPayload,
  type GpuInfo,
  type LogPayload,
  type RunStatePayload,
  type SystemMonitorPayload,
} from '@/api/monitorApi'
import { unwrap } from '@/api/transport'
import { useThemeStore } from './themeStore'

/* 监控引擎:WS /ws/events 即时信号 + REST 轮询兜底。
   page 模式(监控页挂载):status/log 2.5s + chart/hw 5s + WS;
   bg 模式(离开页面):仅 15s 活跃探测,维持 trainingActive 动效降档联动。 */

const LOG_CAP = 800
const TERMINAL = new Set(['completed', 'failed', 'orphaned', 'stopped', 'cancelled'])

export interface ChartPoint {
  step: number
  value: number
}

interface MonitorState {
  runId: string | null
  run: RunStatePayload | null
  queued: Record<string, unknown>[]
  queueDepth: number
  logLines: string[]
  logFollow: boolean
  lossPoints: ChartPoint[]
  lrPoints: ChartPoint[]
  gpus: GpuInfo[]
  cpu: { percent?: number; count?: number } | null
  ram: { total_gb?: number; used_gb?: number; percent?: number } | null
  wsOn: boolean
  stopping: boolean
  etaText: string
  stepsPerSec: number
  setLogFollow(v: boolean): void
}

export const useMonitorStore = create<MonitorState>((set) => ({
  runId: null,
  run: null,
  queued: [],
  queueDepth: 0,
  logLines: [],
  logFollow: true,
  lossPoints: [],
  lrPoints: [],
  gpus: [],
  cpu: null,
  ram: null,
  wsOn: false,
  stopping: false,
  etaText: '',
  stepsPerSec: 0,
  setLogFollow: (logFollow) => set({ logFollow }),
}))

const S = useMonitorStore

/* ---------------- 引擎内部状态 ---------------- */

type Mode = 'off' | 'bg' | 'page'
let mode: Mode = 'off'
let timers: number[] = []
let ws: WebSocket | null = null
let wsRetry: number | undefined
let logOffset = 0
let finalLogDone = false
let samples: { t: number; step: number }[] = []
let wsKickAt = 0
let requestGeneration = 0

function isRunning(run: RunStatePayload | null): boolean {
  return !!run && !TERMINAL.has(String(run.status ?? '').toLowerCase())
}

function fmtEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 90) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function resetRunData() {
  requestGeneration += 1
  logOffset = 0
  finalLogDone = false
  samples = []
  S.setState({ logLines: [], lossPoints: [], lrPoints: [], run: null, etaText: '', stepsPerSec: 0 })
}

/* tickRun 里跨 await 的模块级变量写经由此处落地(值分别来自服务器响应与终态判定,
 * 与函数早前读到的快照无关;独立函数也消除了 require-atomic-updates 的误报面)。 */
function adoptLogOffset(value: number) {
  logOffset = value
}

function markFinalLogsDone() {
  finalLogDone = true
}

const EVENT_CURSOR_PREFIX = 'lulynx:training-event-cursor:'

function readEventCursor(runId: string): string {
  try {
    return window.sessionStorage.getItem(EVENT_CURSOR_PREFIX + runId) ?? ''
  } catch {
    return ''
  }
}

function writeEventCursor(runId: string, cursor: string) {
  if (!cursor) return
  try {
    window.sessionStorage.setItem(EVENT_CURSOR_PREFIX + runId, cursor)
  } catch {
    /* storage may be unavailable in a restricted webview */
  }
}

function restartWsForRun() {
  const socket = ws
  ws = null
  S.setState({ wsOn: false })
  try {
    socket?.close()
  } catch {
    /* ignore */
  }
  openWs()
}

/* ---------------- 轮询 tick ---------------- */

async function tickActive() {
  try {
    const data = unwrap<ActivePayload>(await monitorApi.active())
    const nextId = data?.current_run_id || data?.runs?.[0]?.run_id || null
    const prevId = S.getState().runId
    if (nextId && nextId !== prevId) {
      resetRunData()
      S.setState({ runId: nextId })
      if (mode === 'page') restartWsForRun()
      if (mode === 'page') void tickRun()
    } else if (!nextId && prevId && !S.getState().run) {
      S.setState({ runId: null })
      if (mode === 'page') restartWsForRun()
    }
    S.setState({ queued: data?.queued_runs ?? [], queueDepth: data?.queue_depth ?? 0 })
    useThemeStore.getState().setTrainingActive((data?.runs?.length ?? 0) > 0)
  } catch {
    /* 后端未起:静默,探活由顶栏负责 */
  }
}

async function tickRun() {
  const runId = S.getState().runId
  if (!runId) return
  const generation = requestGeneration
  try {
    const run = unwrap<RunStatePayload>(await monitorApi.status(runId))
    if (generation !== requestGeneration || S.getState().runId !== runId) return
    const terminal = !isRunning(run)
    if (terminal && finalLogDone) {
      S.setState({ run })
      return
    }
    const logP = unwrap<LogPayload>(await monitorApi.log(runId, logOffset))
    if (generation !== requestGeneration || S.getState().runId !== runId) return
    const incoming = logP?.lines ?? []
    if (typeof logP?.offset === 'number') adoptLogOffset(logP.offset)
    if (incoming.length) {
      const merged = [...S.getState().logLines, ...incoming]
      S.setState({ logLines: merged.length > LOG_CAP ? merged.slice(-LOG_CAP) : merged })
    }
    if (terminal) markFinalLogsDone()

    const step = Number(run?.current_step ?? 0)
    const now = Date.now()
    if (step > 0 && (samples.length === 0 || step > samples[samples.length - 1].step)) {
      samples.push({ t: now, step })
      if (samples.length > 30) samples = samples.slice(-30)
    }
    let etaText = ''
    let stepsPerSec = 0
    const total = Number(run?.total_steps ?? 0)
    if (samples.length >= 2) {
      const a = samples[0]
      const b = samples[samples.length - 1]
      const rate = (b.step - a.step) / Math.max(1, b.t - a.t) // steps per ms
      stepsPerSec = rate * 1000
      if (rate > 0 && total > step && !terminal) etaText = fmtEta((total - step) / rate)
    }
    S.setState({ run, etaText, stepsPerSec })
  } catch {
    /* run 目录尚未建立等瞬态,下一轮重试 */
  }
}

async function tickChart() {
  const { runId, run } = S.getState()
  if (!runId) return
  const generation = requestGeneration
  if (!isRunning(run) && S.getState().lossPoints.length > 0 && finalLogDone) return
  try {
    const [loss, lr] = await Promise.all([
      monitorApi.chartSeries(runId, 'loss'),
      monitorApi.chartSeries(runId, 'lr'),
    ])
    if (generation !== requestGeneration || S.getState().runId !== runId) return
    S.setState({
      lossPoints: unwrap<ChartPayload>(loss)?.points ?? [],
      lrPoints: unwrap<ChartPayload>(lr)?.points ?? [],
    })
  } catch {
    /* ignore */
  }
}

async function tickHw() {
  try {
    const data = unwrap<SystemMonitorPayload>(await monitorApi.systemMonitor())
    S.setState({ gpus: data?.gpu?.gpus ?? [], cpu: data?.cpu ?? null, ram: data?.ram ?? null })
  } catch {
    /* ignore */
  }
}

/* ---------------- WebSocket 即时信号 ---------------- */

function wsKick() {
  // WS 只是"有新东西了"的信号;800ms 节流后立即拉一轮
  const now = Date.now()
  if (now - wsKickAt < 800) return
  wsKickAt = now
  void tickRun()
  void tickActive()
}

function openWs() {
  if (ws || mode !== 'page') return
  const runId = S.getState().runId
  if (!runId) return
  try {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({ run_id: runId })
    const cursor = readEventCursor(runId)
    if (cursor) params.set('cursor', cursor)
    const socket = new WebSocket(`${proto}://${window.location.host}/ws/events?${params}`)
    ws = socket
    socket.onopen = () => S.setState({ wsOn: true })
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string
          event?: string
          run_id?: string
          cursor?: string
          next_cursor?: string
        }
        if (msg.run_id && msg.run_id !== S.getState().runId) return
        const t = msg?.type ?? ''
        if (t === 'training_event' && msg.cursor) {
          writeEventCursor(runId, msg.cursor)
          wsKick()
        } else if (t === 'stream_resync' && msg.next_cursor) {
          writeEventCursor(runId, msg.next_cursor)
          wsKick()
        } else if (t === 'training_progress' || t === 'job_progress' || t === 'job_finished' || t === 'event') {
          wsKick()
        }
      } catch {
        /* 非 JSON 消息忽略 */
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      S.setState({ wsOn: false })
      if (mode === 'page') {
        window.clearTimeout(wsRetry)
        wsRetry = window.setTimeout(openWs, 5000)
      }
    }
    socket.onerror = () => socket.close()
  } catch {
    ws = null
  }
}

function closeWs() {
  window.clearTimeout(wsRetry)
  const sock = ws
  ws = null
  try {
    sock?.close()
  } catch {
    /* ignore */
  }
  S.setState({ wsOn: false })
}

/* ---------------- 引擎档位 ---------------- */

function clearTimers() {
  for (const t of timers) window.clearInterval(t)
  timers = []
}

export function setMonitorMode(next: Exclude<Mode, 'off'>) {
  if (mode === next) return
  mode = next
  clearTimers()
  if (next === 'page') {
    void tickActive()
    void tickRun()
    void tickChart()
    void tickHw()
    timers = [
      window.setInterval(() => void tickActive(), 3000),
      window.setInterval(() => void tickRun(), 2500),
      window.setInterval(() => void tickChart(), 5000),
      window.setInterval(() => void tickHw(), 5000),
    ]
    openWs()
  } else {
    closeWs()
    void tickActive()
    timers = [window.setInterval(() => void tickActive(), 15000)]
  }
}

/** 终止当前训练(确认由 UI 层负责) */
export async function requestStopTraining(): Promise<void> {
  S.setState({ stopping: true })
  try {
    await monitorApi.stop()
    void tickActive()
    void tickRun()
  } finally {
    S.setState({ stopping: false })
  }
}
