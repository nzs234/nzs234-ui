// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useRef, useState } from 'react'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { Button } from '@/components/primitives'
import { toast } from '@/stores/toastStore'

type PreviewPayload = {
  x?: number[]
  curves?: Record<string, number[]>
  active_components?: string[]
  stats?: Record<string, { min?: number; max?: number; mean?: number }>
  warnings?: string[]
}

type ScoreStatus = {
  job_id?: string
  status?: string
  progress?: number
  error?: string | null
  result?: {
    report_path?: string
    sidecar_path?: string | null
    sidecar_generated?: boolean
    processed?: number
    score_min?: number
    score_max?: number
  } | null
}

const COLORS: Record<string, string> = {
  timestep: '#38bdf8',
  noise: '#a78bfa',
  sample_difficulty: '#f59e0b',
  combined_raw: '#94a3b8',
  combined_normalized: '#22c55e',
}
const LABELS: Record<string, string> = {
  timestep: '时间步',
  noise: '噪声',
  sample_difficulty: '样本难度',
  combined_raw: '原始乘积',
  combined_normalized: '均值归一化',
}
const RELEVANT_KEYS = [
  'timestep_weighting_enabled', 'timestep_weighting_mode', 'timestep_weighting_strength',
  'noise_weighting_enabled', 'noise_weighting_mode', 'noise_weighting_strength',
  'sample_difficulty_weighting_enabled', 'sample_difficulty_weighting_mode',
  'sample_difficulty_weighting_strength', 'sample_difficulty_weighting_min',
  'sample_difficulty_weighting_max', 'masked_loss', 'alpha_mask_enabled',
  'semantic_region_weighting_enabled',
]

function pathFor(values: number[], yMin: number, yMax: number): string {
  const span = Math.max(yMax - yMin, 1e-6)
  return values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 620
    const y = 150 - ((value - yMin) / span) * 130
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

export function WeightComposerPreview({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (key: string, raw: unknown) => void
}) {
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [mapping, setMapping] = useState('neutral')
  const [minimum, setMinimum] = useState(0.5)
  const [maximum, setMaximum] = useState(1.5)
  const [strength, setStrength] = useState(1.0)
  const [overwrite, setOverwrite] = useState(false)
  const [previewOnly, setPreviewOnly] = useState(false)
  const [job, setJob] = useState<ScoreStatus | null>(null)
  const generation = useRef(0)
  const onChangeRef = useRef(onChange)
  // 最新回调经 effect 落 ref(渲染期不写 ref);定时器/异步回调读取时总是最新值。
  useEffect(() => {
    onChangeRef.current = onChange
  })
  const relevant = useMemo(
    () => JSON.stringify(Object.fromEntries(RELEVANT_KEYS.map((key) => [key, config[key]]))),
    [config],
  )

  useEffect(() => {
    const id = ++generation.current
    const timer = window.setTimeout(() => {
      void trainApi.weightComposerPreview(config).then((response) => {
        if (id !== generation.current) return
        setPreview(unwrap<PreviewPayload>(response))
        setPreviewError('')
      }).catch((error: Error) => {
        if (id !== generation.current) return
        setPreviewError(error.message)
      })
    }, 180)
    return () => window.clearTimeout(timer)
    // config is represented by the stable relevant-key snapshot above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant])

  useEffect(() => {
    const jobId = job?.job_id
    if (!jobId || !['pending', 'running'].includes(String(job.status))) return
    const timer = window.setInterval(() => {
      void trainApi.sampleDifficultyScoringStatus(jobId).then((response) => {
        const next = unwrap<ScoreStatus>(response)
        setJob(next)
        if (next.status === 'completed') {
          window.clearInterval(timer)
          if (next.result?.sidecar_path) onChangeRef.current('sample_difficulty_metadata_path', next.result.sidecar_path)
          toast.ok(next.result?.sidecar_generated ? '评分与难度权重文件已生成' : '质量评分报告已生成', 'DATASET')
        } else if (next.status === 'failed') {
          window.clearInterval(timer)
          toast.warn(next.error || '离线评分失败', 'DATASET')
        }
      }).catch(() => {})
    }, 800)
    return () => window.clearInterval(timer)
  }, [job?.job_id, job?.status])

  const curves = preview?.curves ?? {}
  const visibleCurves = Object.entries(curves).filter(([key]) => key !== 'combined_raw' || Object.keys(curves).length > 2)
  const allValues = visibleCurves.flatMap(([, values]) => values).filter(Number.isFinite)
  const yMin = Math.min(...allValues, 0.9)
  const yMax = Math.max(...allValues, 1.1)
  const normalizedStats = preview?.stats?.combined_normalized
  const datasetDir = String(config.train_data_dir ?? '')
  const running = ['pending', 'running'].includes(String(job?.status ?? ''))

  async function startScoring() {
    if (!datasetDir.trim()) {
      toast.warn('请先设置训练数据集目录', 'DATASET')
      return
    }
    if (maximum < minimum) {
      toast.warn('终止权重不能小于起始权重', 'DATASET')
      return
    }
    try {
      const response = await trainApi.startSampleDifficultyScoring({
        dataset_dir: datasetDir,
        mapping,
        minimum,
        maximum,
        strength,
        recursive: true,
        overwrite,
        preview_only: previewOnly,
      })
      setJob(unwrap<ScoreStatus>(response))
    } catch (error) {
      toast.warn((error as Error).message, 'DATASET')
    }
  }

  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 12 }}>
      <div style={{ border: '1px solid var(--line, #334155)', borderRadius: 10, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <b>WeightComposer 组合预览</b>
          {normalizedStats ? <small>归一化均值 {normalizedStats.mean?.toFixed(3)} · {normalizedStats.min?.toFixed(3)}–{normalizedStats.max?.toFixed(3)}</small> : null}
        </div>
        {previewError ? <small style={{ color: '#ef4444' }}>{previewError}</small> : null}
        <svg viewBox="0 0 620 170" role="img" aria-label="权重组合曲线" style={{ width: '100%', minHeight: 170 }}>
          <line x1="0" y1="150" x2="620" y2="150" stroke="currentColor" opacity=".2" />
          <line x1="0" y1="20" x2="0" y2="150" stroke="currentColor" opacity=".2" />
          {visibleCurves.map(([key, values]) => (
            <path key={key} d={pathFor(values, yMin, yMax)} fill="none" stroke={COLORS[key] || '#e2e8f0'} strokeWidth={key === 'combined_normalized' ? 3 : 1.7} opacity={key === 'combined_raw' ? .55 : 1} />
          ))}
        </svg>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {visibleCurves.map(([key]) => <small key={key} style={{ color: COLORS[key] || 'inherit' }}>● {LABELS[key] || key}</small>)}
          {!preview?.active_components?.length ? <small>当前没有有效的一维权重轴</small> : null}
        </div>
        {preview?.warnings?.map((warning) => <small key={warning} style={{ display: 'block', color: '#f59e0b', marginTop: 6 }}>{warning}</small>)}
      </div>

      <div style={{ border: '1px solid var(--line, #334155)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
        <div><b>离线质量评分 → 样本难度文件</b><br /><small>质量分数与训练难度不是同一概念；默认“仅评分”不会生成训练权重。</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={mapping} onChange={(e) => setMapping(e.target.value)}>
            <option value="neutral">仅质量评分（推荐）</option>
            <option value="inverse">低分样本权重更高（谨慎，可能放大污染）</option>
            <option value="direct">高分样本权重更高</option>
            <option value="center">中间分样本权重更高</option>
            <option value="extremes">两端样本权重更高</option>
          </select>
          <label>最小 <input type="number" min="0" max="16" step="0.05" value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} style={{ width: 72 }} /></label>
          <label>最大 <input type="number" min="0.01" max="64" step="0.05" value={maximum} onChange={(e) => setMaximum(Number(e.target.value))} style={{ width: 72 }} /></label>
          <label>映射强度 <input type="number" min="0" max="1" step="0.05" value={strength} onChange={(e) => setStrength(Number(e.target.value))} style={{ width: 72 }} /></label>
          <label><input type="checkbox" checked={previewOnly} onChange={(e) => setPreviewOnly(e.target.checked)} /> 只预览</label>
          <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 覆盖已有文件</label>
          <Button onClick={() => void startScoring()} disabled={running}>{running ? `评分中 ${Math.round((job?.progress || 0) * 100)}%` : '启动离线评分'}</Button>
        </div>
        {job?.result ? <small>报告：{job.result.report_path || '-'}{job.result.sidecar_path ? ` · 权重：${job.result.sidecar_path}` : ''}</small> : null}
      </div>
    </div>
  )
}

