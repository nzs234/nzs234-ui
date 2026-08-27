// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  generateApi,
  serializeRegions,
  type GenerationImage,
  type GenerationLogItem,
  type GenerationTask,
  type RegionSpec,
} from '@/api/generateApi'
import { useI18n } from '@/i18n/useI18n'
import { RegionCanvas } from './RegionCanvas'
import { ResultGallery } from './ResultGallery'
import './generate.css'

/* 出图页。区域多 LoRA 的 10 个参数住在这里而不是训练页 ——
   它们是 GenerationRequest 的字段,训练侧从来没有读取点。 */

const POLL_MS = 1200

interface Basic {
  prompt: string
  negative_prompt: string
  width: number
  height: number
  steps: number
  guidance_scale: number
  seed: number
  model_path: string
  vae_path: string
  control_image_path: string
  colorize_mode: 'asis' | 'lineart' | 'grayscale'
  output_dir: string
}

interface RegionalTuning {
  regional_lora_alpha: number
  regional_lora_beta: number
  regional_lora_initial_step_size: number
  regional_lora_final_step_size: number
  regional_lora_topk_ratio: number
  regional_lora_gaussian_sigma: number
  regional_lora_enable_latent_reinit: boolean
  regional_lora_enable_concept_isolation: boolean
  regional_lora_enable_concept_injection: boolean
  regional_lora_capture_block: number
}

// 与 GenerationRequest 的出厂值逐字一致。写不同的默认值会让 UI 与契约
// 悄悄分叉,这正是这些字段被从训练页搬走的原因。
const DEFAULT_TUNING: RegionalTuning = {
  regional_lora_alpha: 0.25,
  regional_lora_beta: 0.8,
  regional_lora_initial_step_size: 20,
  regional_lora_final_step_size: 5,
  regional_lora_topk_ratio: 0.3,
  regional_lora_gaussian_sigma: 1,
  regional_lora_enable_latent_reinit: true,
  regional_lora_enable_concept_isolation: true,
  regional_lora_enable_concept_injection: true,
  regional_lora_capture_block: -1,
}

const DEFAULT_BASIC: Basic = {
  prompt: '',
  negative_prompt: '',
  width: 1024,
  height: 1024,
  steps: 28,
  guidance_scale: 5,
  seed: -1,
  model_path: '',
  vae_path: '',
  control_image_path: '',
  colorize_mode: 'asis',
  output_dir: '',
}

export default function GeneratePage() {
  const { t } = useI18n()
  const [basic, setBasic] = useState<Basic>(DEFAULT_BASIC)
  const [tuning, setTuning] = useState<RegionalTuning>(DEFAULT_TUNING)
  const [regions, setRegions] = useState<RegionSpec[]>([])
  const [loraInput, setLoraInput] = useState('')
  const [loras, setLoras] = useState<string[]>([])
  const [task, setTask] = useState<GenerationTask>({})
  const [logs, setLogs] = useState<GenerationLogItem[]>([])
  const [images, setImages] = useState<GenerationImage[]>([])
  const [error, setError] = useState('')
  const [showTuning, setShowTuning] = useState(false)
  const lastLogId = useRef(0)
  const pollGeneration = useRef(0)

  const running = task.status === 'running'

  const poll = useCallback(async () => {
    const generation = pollGeneration.current
    try {
      const { task: current } = await generateApi.status()
      if (generation !== pollGeneration.current) return
      setTask(current)
      const { items, last_id } = await generateApi.logs(lastLogId.current)
      if (generation !== pollGeneration.current) return
      if (items.length) {
        // 值来自服务器响应而非 ref 旧读;并发由 pollGeneration 守卫,写入不会基于过期状态。
        // eslint-disable-next-line require-atomic-updates
        lastLogId.current = last_id
        setLogs((prev) => [...prev, ...items].slice(-400))
      }
      if (current.status && current.status !== 'running' && current.output_dir) {
        const result = await generateApi.results(current.output_dir)
        if (generation !== pollGeneration.current) return
        setImages(result.items)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // 挂载即对时一次任务状态(可能后端已在跑);setState 发生在 poll 的 await 之后,
  // 延后一拍启动以避免同步级联渲染。
  useEffect(() => {
    const kick = window.setTimeout(() => void poll(), 0)
    return () => window.clearTimeout(kick)
  }, [poll])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void poll(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, poll])

  const addLora = () => {
    const path = loraInput.trim()
    if (!path || loras.includes(path)) return
    setLoras([...loras, path])
    setLoraInput('')
  }

  const start = async () => {
    pollGeneration.current += 1
    setError('')
    lastLogId.current = 0
    setLogs([])
    setImages([])
    const regionsJson = serializeRegions(regions)
    const { control_image_path, colorize_mode, ...rest } = basic
    try {
      const { task: started } = await generateApi.start({
        ...rest,
        // 没有控制图就一个键都不发。渲染侧据此走纯 t2i 并保持逐位一致,
        // 发一个空的 control_image_path 会把它推上 EasyControl 分支。
        ...(control_image_path.trim() ? { control_image_path: control_image_path.trim(), colorize_mode } : {}),
        // 区域为空时只发空串。带上那 9 个调参却没有区域,读起来像功能开着,
        // 实际上什么都不会发生。
        regional_lora_regions_json: regionsJson,
        ...(regionsJson ? tuning : {}),
      })
      setTask(started)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const statusMatch = msg.match(/(\d{3})/)
      const localizedError = statusMatch ? t('api.request_fail', { status: statusMatch[1] }) : (msg || t('api.backend_down'))
      setError(localizedError)
    }
  }

  const stop = async () => {
    pollGeneration.current += 1
    try {
      const { task: stopped } = await generateApi.stop()
      setTask(stopped)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const num = (key: keyof Basic) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBasic({ ...basic, [key]: Number(e.target.value) })
  const text = (key: keyof Basic) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBasic({ ...basic, [key]: e.target.value })
  const tune = (key: keyof RegionalTuning) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setTuning({
      ...tuning,
      [key]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value),
    })

  return (
    <div className="lx-generate">
      <header className="lx-generate__head">
        <h1>{t('generate.title')}</h1>
        <div className="lx-generate__actions">
          <button type="button" className="lx-btn primary" disabled={running} onClick={() => void start()}>
            {running ? t('generate.running') : t('generate.start')}
          </button>
          <button type="button" className="lx-btn danger" disabled={!running} onClick={() => void stop()}>
            {t('generate.stop')}
          </button>
        </div>
      </header>

      {error && <div className="lx-generate__error">{error}</div>}

      <div className="lx-generate__body">
        <section className="lx-generate__panel">
          <label className="lx-field">
            <span>{t('generate.prompt')}</span>
            <textarea rows={3} value={basic.prompt} onChange={text('prompt')} />
          </label>
          <label className="lx-field">
            <span>{t('generate.negative_prompt')}</span>
            <textarea rows={2} value={basic.negative_prompt} onChange={text('negative_prompt')} />
          </label>
          <div className="lx-field-row">
            <label className="lx-field">
              <span>{t('generate.width')}</span>
              <input type="number" step={8} value={basic.width} onChange={num('width')} />
            </label>
            <label className="lx-field">
              <span>{t('generate.height')}</span>
              <input type="number" step={8} value={basic.height} onChange={num('height')} />
            </label>
          </div>
          <div className="lx-field-row">
            <label className="lx-field">
              <span>{t('generate.steps')}</span>
              <input type="number" value={basic.steps} onChange={num('steps')} />
            </label>
            <label className="lx-field">
              <span>{t('generate.guidance')}</span>
              <input type="number" step={0.1} value={basic.guidance_scale} onChange={num('guidance_scale')} />
            </label>
            <label className="lx-field">
              <span>{t('generate.seed')}</span>
              <input type="number" value={basic.seed} onChange={num('seed')} />
            </label>
          </div>
          <label className="lx-field">
            <span>{t('generate.model_path')}</span>
            <input value={basic.model_path} onChange={text('model_path')} />
          </label>
          <label className="lx-field">
            <span>{t('generate.vae_path')}</span>
            <input value={basic.vae_path} onChange={text('vae_path')} />
          </label>
          <label className="lx-field">
            <span>{t('generate.control_image')}</span>
            <input value={basic.control_image_path} onChange={text('control_image_path')} />
          </label>
          {basic.control_image_path.trim() && (
            <label className="lx-field">
              <span>{t('generate.colorize_mode')}</span>
              <select
                value={basic.colorize_mode}
                onChange={(e) =>
                  setBasic({ ...basic, colorize_mode: e.target.value as Basic['colorize_mode'] })
                }
              >
                <option value="asis">{t('generate.colorize_asis')}</option>
                <option value="lineart">{t('generate.colorize_lineart')}</option>
                <option value="grayscale">{t('generate.colorize_grayscale')}</option>
              </select>
            </label>
          )}
          <label className="lx-field">
            <span>{t('generate.output_dir')}</span>
            <input value={basic.output_dir} onChange={text('output_dir')} />
          </label>
        </section>

        <section className="lx-generate__panel">
          <h2>{t('generate.regions')}</h2>
          <p className="lx-generate__note">{t('generate.regions_note')}</p>

          <div className="lx-field-row">
            <label className="lx-field lx-field--grow">
              <span>{t('generate.lora_path')}</span>
              <input
                value={loraInput}
                onChange={(e) => setLoraInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addLora()
                  }
                }}
              />
            </label>
            <button type="button" className="lx-btn" onClick={addLora}>
              {t('generate.add_lora')}
            </button>
          </div>

          <RegionCanvas
            regions={regions}
            onChange={setRegions}
            aspect={basic.width / Math.max(1, basic.height)}
            loras={loras}
          />

          <button type="button" className="lx-generate__toggle" onClick={() => setShowTuning((v) => !v)}>
            {showTuning ? '▾' : '▸'} {t('generate.advanced')}
          </button>
          {showTuning && (
            <div className="lx-generate__tuning">
              {(
                [
                  ['regional_lora_alpha', 0.05],
                  ['regional_lora_beta', 0.05],
                  ['regional_lora_initial_step_size', 1],
                  ['regional_lora_final_step_size', 1],
                  ['regional_lora_topk_ratio', 0.05],
                  ['regional_lora_gaussian_sigma', 0.1],
                  ['regional_lora_capture_block', 1],
                ] as const
              ).map(([key, step]) => (
                <label key={key} className="lx-field">
                  <span>{t(`generate.${key}`)}</span>
                  <input type="number" step={step} value={tuning[key] as number} onChange={tune(key)} />
                </label>
              ))}
              {(
                [
                  'regional_lora_enable_latent_reinit',
                  'regional_lora_enable_concept_isolation',
                  'regional_lora_enable_concept_injection',
                ] as const
              ).map((key) => (
                <label key={key} className="lx-field lx-field--check">
                  <input type="checkbox" checked={tuning[key]} onChange={tune(key)} />
                  <span>{t(`generate.${key}`)}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>

      <ResultGallery images={images} logs={logs} task={task} />
    </div>
  )
}
