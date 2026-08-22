// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { request, postJson, unwrap } from './transport'

/* 出图域 API。字段名逐字对应后端 GenerationRequest —— 契约是唯一参数表,
   这里不做任何改名或映射,否则就成了第二份会静默漂移的参数表。 */

/** 归一化到 [0,1] 的区域框。后端明确拒绝像素坐标。 */
export interface RegionSpec {
  box: [number, number, number, number]
  lora: string
  prompt?: string
}

export interface GenerationRequestPayload {
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  steps?: number
  guidance_scale?: number
  seed?: number
  model_path?: string
  adapter_path?: string
  vae_path?: string
  input_image_path?: string
  output_dir?: string
  dry_run?: boolean
  /* EasyControl v2 控制图。走 model_extra(契约 extra='allow'),与 CLI 的
     --control_image / --colorize_mode 是同一条通道:渲染侧只认这两个键,
     契约的 input_image_path 在 anima 渲染链上没有读取点。
     不给控制图就整个不发,渲染退回纯 t2i 且逐位一致。 */
  control_image_path?: string
  colorize_mode?: 'asis' | 'lineart' | 'grayscale'
  /** 区域多 LoRA 的总开关:空串即关闭,没有单独的 enabled 布尔 */
  regional_lora_regions_json?: string
  regional_lora_alpha?: number
  regional_lora_beta?: number
  regional_lora_initial_step_size?: number
  regional_lora_final_step_size?: number
  regional_lora_topk_ratio?: number
  regional_lora_gaussian_sigma?: number
  regional_lora_enable_latent_reinit?: boolean
  regional_lora_enable_concept_isolation?: boolean
  regional_lora_enable_concept_injection?: boolean
  regional_lora_capture_block?: number
}

export interface GenerationTask {
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  output_dir?: string
  request_path?: string
  prompt?: string
  steps?: number
  regions?: number
  started_at?: number
  finished_at?: number
  exit_code?: number
  images?: number
  error?: string
}

export interface GenerationLogItem {
  id: number
  time: number
  message: string
}

export interface GenerationImage {
  name: string
  path: string
  size: number
  url: string
}

/** 后端把业务错误放在 200 的信封里(status:'error'),不走 HTTP 状态码。 */
interface Envelope<T> {
  status: 'success' | 'error'
  code?: string
  message?: string
  data?: T
}

function take<T>(payload: unknown): T {
  const env = payload as Envelope<T>
  if (env && env.status === 'error') {
    throw new Error(env.message || env.code || 'generation request failed')
  }
  return unwrap<T>(payload)
}

export const generateApi = {
  status: () =>
    request<Envelope<{ running: boolean; task: GenerationTask }>>('/api/generation/status').then(
      take<{ running: boolean; task: GenerationTask }>,
    ),

  logs: (sinceId = 0) =>
    request<Envelope<{ items: GenerationLogItem[]; last_id: number }>>(
      `/api/generation/logs?since_id=${sinceId}`,
    ).then(take<{ items: GenerationLogItem[]; last_id: number }>),

  results: (outputDir?: string) =>
    request<Envelope<{ output_dir: string; items: GenerationImage[]; total: number }>>(
      `/api/generation/results${outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : ''}`,
    ).then(take<{ output_dir: string; items: GenerationImage[]; total: number }>),

  start: (payload: GenerationRequestPayload) =>
    postJson<Envelope<{ task: GenerationTask }>>('/api/generation/start', payload).then(
      take<{ task: GenerationTask }>,
    ),

  stop: () =>
    postJson<Envelope<{ stopped: boolean; task: GenerationTask }>>('/api/generation/stop', {}).then(
      take<{ stopped: boolean; task: GenerationTask }>,
    ),
}

/** 区域列表 → regions_json。空列表返回空串,后端据此判定关闭。 */
export function serializeRegions(regions: RegionSpec[]): string {
  const usable = regions.filter((r) => r.lora.trim())
  if (!usable.length) return ''
  return JSON.stringify(
    usable.map((r) => ({
      box: r.box.map((v) => Number(v.toFixed(4))),
      lora: r.lora.trim(),
      ...(r.prompt?.trim() ? { prompt: r.prompt.trim() } : {}),
    })),
  )
}
