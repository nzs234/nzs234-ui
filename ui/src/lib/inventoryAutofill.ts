// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { getSectionsForType, getFieldDefinition } from '@/schema/schemaIndex.js'
import { resourceApi, type LocalResourceItem } from '@/api/resourceApi'
import { unwrap } from '@/api/transport'
import {
  applyUniqueAutofill,
  filterCandidatesForField,
  isPathEmptyForAutofill,
  normalizeResourceItems,
  type PathCandidate,
  type SchemaFieldLike,
} from '@/lib/modelPathMatch'
import { useTrainConfigStore } from '@/stores/configStore'

const CACHE_TTL_MS = 20_000
let cache: { at: number; items: PathCandidate[] } | null = null
let inflight: Promise<PathCandidate[]> | null = null

export async function loadInventoryItems(opts: { refresh?: boolean } = {}): Promise<PathCandidate[]> {
  const now = Date.now()
  if (!opts.refresh && cache && now - cache.at < CACHE_TTL_MS) return cache.items
  if (inflight && !opts.refresh) return inflight
  inflight = (async () => {
    try {
      const resp = await resourceApi.listLocalResources({ limit: 1000, refresh: Boolean(opts.refresh) })
      const data = unwrap<{ items?: LocalResourceItem[] }>(resp)
      const items = normalizeResourceItems(Array.isArray(data?.items) ? data.items : [])
      cache = { at: Date.now(), items }
      return items
    } catch {
      return cache?.items ?? []
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function modelFileFields(typeId: string): SchemaFieldLike[] {
  const sections = getSectionsForType(typeId) || []
  const out: SchemaFieldLike[] = []
  const seen = new Set<string>()
  for (const sec of sections) {
    for (const f of sec.fields || []) {
      if (!f?.key || seen.has(f.key)) continue
      if (f.type === 'file' || f.pickerType === 'model-file' || f.pickerType === 'output-model-file') {
        seen.add(f.key)
        out.push({
          key: f.key,
          type: f.type,
          pickerType: f.pickerType,
          defaultValue: f.defaultValue,
        })
      }
    }
  }
  return out
}

/** 对当前 type 空/占位字段做唯一匹配自动填; 非空不覆盖 */
export async function autofillEmptyModelPaths(opts: { refresh?: boolean } = {}): Promise<number> {
  const state = useTrainConfigStore.getState()
  const typeId = state.typeId
  const draft = state.drafts[typeId] ?? {}
  const items = await loadInventoryItems(opts)
  if (!items.length) return 0
  const fields = modelFileFields(typeId)
  const updates = applyUniqueAutofill(draft, typeId, items, fields)
  let n = 0
  for (const [key, path] of Object.entries(updates)) {
    // 再读一次,避免竞态覆盖用户刚输入
    const cur = useTrainConfigStore.getState().drafts[typeId]?.[key]
    const field = getFieldDefinition(key, typeId) as SchemaFieldLike | null
    if (!isPathEmptyForAutofill(cur, field)) continue
    useTrainConfigStore.getState().setValue(key, path)
    n += 1
  }
  return n
}

export async function candidatesForField(typeId: string, fieldKey: string, opts: { refresh?: boolean } = {}) {
  const items = await loadInventoryItems(opts)
  return filterCandidatesForField(items, typeId, fieldKey, { limit: 12 })
}

/** 空/占位字段的候选数(用于「发现 N 个→点扫描」; limit 拉高避免截断) */
export async function countCandidatesForField(
  typeId: string,
  fieldKey: string,
  opts: { refresh?: boolean } = {},
): Promise<number> {
  const items = await loadInventoryItems(opts)
  return filterCandidatesForField(items, typeId, fieldKey, { limit: 50 }).length
}
