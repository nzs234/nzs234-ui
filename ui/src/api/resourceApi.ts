// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { request } from './transport'

/* 本地资源 inventory: 同源 GET /api/resources/local */

export interface LocalResourceItem {
  name?: string
  path?: string
  relative_path?: string
  root?: string
  category?: string
  kind?: string
  model_type?: string
  artifact_kind?: string
  model_family?: string
  detection_source?: string
  tags?: string[]
  size?: number
  modified_at?: string
  [key: string]: unknown
}

export interface LocalResourcesPayload {
  items?: LocalResourceItem[]
  roots?: string[]
  counts?: Record<string, number>
  total_size?: number
  truncated?: boolean
  cached?: boolean
  [key: string]: unknown
}

export const resourceApi = {
  listLocalResources: (opts: { limit?: number; summary?: boolean; refresh?: boolean } = {}) => {
    const params = new URLSearchParams()
    params.set('limit', String(opts.limit ?? 1000))
    if (opts.summary) params.set('summary', 'true')
    if (opts.refresh) params.set('refresh', 'true')
    return request(`/api/resources/local?${params.toString()}`)
  },
}
