// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import {
  postJson,
  request,
  requestNative,
  type ApiEnvelope,
  type TransportOptions,
} from './transport'

export interface TrainDraftsPayload {
  version?: number
  /**
   * train_drafts_adapter 的乐观并发标记。
   * GET 回读当前值;PUT/DELETE 带上它即启用 compare-and-replace(不匹配 → HTTP 409);
   * 每次成功的写操作返回 revision+1,调用方必须用响应值刷新本地记录,
   * 否则第二次写必然再撞 409。
   */
  revision?: number
  client_revision?: number
  typeId?: string
  updated_at?: number
  drafts?: Record<string, Record<string, unknown>>
}

/**
 * PUT/DELETE /api/train_drafts 撞上 409 时,detail 里带回磁盘当前 revision
 * (FastAPI 把 HTTPException(detail=dict) 序列化成 {detail:{...}})。
 *
 * 识别 409 / 取出 current_revision 的运行时逻辑在 @/features/training/draftRevision:
 * 那是纯逻辑,而 configStore 的测试会整体 mock 本模块,从这里导出运行时值会拿到 undefined。
 */
export interface TrainDraftConflictDetail {
  code?: string
  message?: string
  current_revision?: number
}

/** 409 响应体:readDraftConflictRevision 消费的就是这个形状。 */
export interface TrainDraftConflictPayload {
  detail?: TrainDraftConflictDetail
}

export interface RunHistoryDiskPayload {
  version?: number
  updated_at?: number
  records?: unknown[]
}

/** GET /api/runs/:id/restorable_config 的 data 形状(run_restorable_adapter)。 */
export interface RunRestorableConfigPayload {
  ok?: boolean
  schema_id?: string
  config?: Record<string, unknown>
  run_id?: string
  reason?: string
  source?: string
}

/** GET /train/last-training 的裸 payload(last_training_query)。 */
export interface LastTrainingPayload {
  has_last_training?: boolean
  schema_id?: string
  training_type?: string
  run_id?: string
  error?: string
  restorable_config?: Record<string, unknown>
  config?: Record<string, unknown>
  suggested_resume?: string | null
  resume_offer?: Record<string, unknown>
  [extra: string]: unknown
}

/* 训练配置域 API(与旧 UI 完全同形:flat spread + allow_attention_fallback) */
export const trainApi = {
  configOptions: () => request('/api/config/options'),
  savedParams: () => request('/api/config/saved_params'),

  preflight: (config: Record<string, unknown>) =>
    postJson('/api/train/preflight', { allow_attention_fallback: true, ...config }),

  resolveConfig: (schemaId: string, config: Record<string, unknown>) =>
    postJson('/api/train/config/resolve', {
      schema_id: schemaId,
      config,
      include_trainer_config_preview: false,
    }),

  trainingIntentPreview: (config: Record<string, unknown>, intent: string, explicitFields: string[]) =>
    postJson('/api/train/training-intent/preview', { config, intent, explicit_fields: explicitFields }),

  weightComposerPreview: (config: Record<string, unknown>, points = 65) =>
    postJson('/api/train/weight-composer/preview', { config, points }),

  startSampleDifficultyScoring: (payload: Record<string, unknown>) =>
    postJson('/api/train/sample-difficulty/score', payload),

  sampleDifficultyScoringStatus: (jobId: string) =>
    request(`/api/train/sample-difficulty/score/${encodeURIComponent(jobId)}`),

  cancelSampleDifficultyScoring: (jobId: string) =>
    postJson(`/api/train/sample-difficulty/score/${encodeURIComponent(jobId)}/cancel`, {}),

  run: (config: Record<string, unknown>) =>
    postJson('/api/run', { allow_attention_fallback: true, ...config }),

  checkOutputConflict: (outputDir: string, outputName: string) =>
    postJson('/api/check_output_conflict', { output_dir: outputDir, output_name: outputName }),

  checkPathExists: (path: string) => postJson<{ exists?: boolean; type?: string }>('/api/check_path_exists', { path }),

  pickFile: (pickerType: string, context = '') => {
    const params = [`picker_type=${encodeURIComponent(pickerType)}`]
    if (context) params.push(`context=${encodeURIComponent(context)}`)
    return request(`/api/pick_file?${params.join('&')}`)
  },

  /** Anima 模型根目录智能识别（与 legacy /api/scan_anima_folder 同形） */
  scanAnimaFolder: (folderPath: string) =>
    request(`/api/scan_anima_folder?folder_path=${encodeURIComponent(folderPath)}`, {
      method: 'POST',
    }),

  saveConfig: (name: string, config: Record<string, unknown>, schemaId?: string) =>
    postJson('/api/saved_configs/save', { name, config, ...(schemaId ? { schema_id: schemaId, typeId: schemaId } : {}) }),
  listSavedConfigs: () => request('/api/saved_configs/list'),
  loadSavedConfig: (name: string) => request(`/api/saved_configs/load?name=${encodeURIComponent(name)}`),
  deleteSavedConfig: (name: string) => request(`/api/saved_configs/delete?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  renameSavedConfig: (oldName: string, newName: string) => postJson('/api/saved_configs/rename', { oldName, newName }),

  /** Kohya TOML / ai-toolkit YAML → flat lulynx fields + notes (does not start training) */
  importExternalConfig: (file: File) => {
    const form = new FormData()
    form.append('file', file, file.name || 'config.bin')
    return request('/api/import_external_config', { method: 'POST', body: form })
  },

  /* 磁盘草稿 working set(与 saved_configs 命名空间隔离) */
  loadTrainDrafts: () => request<ApiEnvelope<TrainDraftsPayload>>('/api/train_drafts'),
  /** PUT 返回的 data 是写后的完整 payload(含新 revision),调用方须据此刷新本地记录。 */
  saveTrainDrafts: (payload: TrainDraftsPayload, options: TransportOptions = {}) =>
    request<ApiEnvelope<TrainDraftsPayload>>('/api/train_drafts', {
      ...options,
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  /** revision 为数字时启用乐观并发(后端 query 参数 revision);省略则无条件删除。 */
  clearTrainDrafts: (typeId?: string, revision?: number | null) => {
    const params: string[] = []
    if (typeId) params.push(`type_id=${encodeURIComponent(typeId)}`)
    if (typeof revision === 'number' && Number.isFinite(revision) && revision >= 0) {
      params.push(`revision=${encodeURIComponent(String(Math.trunc(revision)))}`)
    }
    const q = params.length ? `?${params.join('&')}` : ''
    return request<ApiEnvelope<TrainDraftsPayload>>(`/api/train_drafts${q}`, { method: 'DELETE' })
  },

  /**
   * L-F11 上次训练。
   * 真实挂载点是 backend_native 的 `GET /train/last-training`(router prefix `/train`);
   * `/last-training` 从未被挂载过,旧写法在生产上恒 404 → 回落 saved_params,
   * resume banner / 跨类型恢复因此永久不可用。
   * 该路由返回裸 payload(其 `status`-ish 字段属业务语义),必须走 native 语义。
   */
  lastTraining: () => requestNative<LastTrainingPayload>('/train/last-training'),

  /* 运行历史磁盘 + 按 run 回填 */
  loadRunHistory: () => request<ApiEnvelope<RunHistoryDiskPayload>>('/api/run_history'),
  saveRunHistory: (payload: RunHistoryDiskPayload) =>
    request('/api/run_history', { method: 'PUT', body: JSON.stringify(payload) }),
  runRestorableConfig: (runId: string) =>
    request<ApiEnvelope<RunRestorableConfigPayload>>(`/api/runs/${encodeURIComponent(runId)}/restorable_config`),
}
