import { request, postJson, unwrap } from './transport'

export type ProviderRole = 'direct_semantic' | 'mask_proposal' | 'compound_grounded' | 'unknown'
export type AdapterStatus = 'ready' | 'manual-review' | 'resource-only' | 'gated'
export interface ResourceCatalogItem {
  key: string
  title: string
  category: string
  model_id: string
  size_bytes: number
  license: string
  source_label: string
  device_requirement: string
  supported_regions: string[]
  provider_role: ProviderRole
  adapter_status: AdapterStatus
  install_policy: string
  provider_id: string
  runtime_provider_id: string
  local_path: string
  installed: boolean
  requires_license_acceptance: boolean
  requires_auth: boolean
  can_download: boolean
  can_select: boolean
  [key: string]: unknown
}
export interface LocalResourceItem { path?: string; name?: string; relative_path?: string; root?: string; provider_id?: string; provider_ids?: string[]; [key: string]: unknown }

const text = (value: unknown, fallback = '') => String(value ?? '').trim() || fallback
const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.map((x) => text(x)).filter(Boolean))] : typeof value === 'string' ? [...new Set(value.split(/[,;|]/).map((x) => x.trim()).filter(Boolean))] : []
const basename = (value: unknown) => text(value).replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() || ''

function requireSuccess<T = unknown>(payload: unknown): T {
  const obj = payload as Record<string, unknown> | null
  if (obj?.status === 'error') throw new Error(text(obj.message || obj.error, '资源中心请求失败'))
  return unwrap<T>(payload)
}
export function normalizeProviderRole(value: unknown): ProviderRole {
  const role = text(value).toLowerCase().replaceAll('-', '_')
  if (['direct_semantic', 'semantic', 'semantic_segmentation', 'parsing'].includes(role)) return 'direct_semantic'
  if (['mask_proposal', 'proposal', 'sam', 'sam_mask', 'instance_mask'].includes(role)) return 'mask_proposal'
  if (['compound_grounded', 'grounded', 'grounded_segmentation'].includes(role)) return 'compound_grounded'
  return 'unknown'
}

export function normalizeAdapterStatus(value: unknown, installed = false, source = false): AdapterStatus {
  const status = text(value).toLowerCase().replaceAll('_', '-')
  if (['ready', 'installed', 'available'].includes(status)) return 'ready'
  if (['gated', 'auth-required', 'requires-auth', 'license-gated'].includes(status)) return 'gated'
  if (['manual-review', 'review', 'experimental', 'needs-adapter'].includes(status)) return 'manual-review'
  if (['resource-only', 'asset-only', 'unsupported'].includes(status)) return 'resource-only'
  return installed ? 'manual-review' : source ? 'manual-review' : 'resource-only'
}

export function normalizeCatalogItem(raw: Record<string, unknown>): ResourceCatalogItem {
  const path = text(raw.local_path || raw.install_path || raw.path)
  const installed = Boolean(raw.installed || path)
  const download = (raw.download || {}) as Record<string, unknown>
  const source = (raw.source || {}) as Record<string, unknown>
  const license = (source.license || {}) as Record<string, unknown>
  const providerId = text(raw.provider_id || raw.provider || raw.id, 'unknown-provider')
  const runtimeProviderId = text(raw.runtime_provider_id || raw.runtime_provider)
  const role = normalizeProviderRole(raw.provider_role || raw.capability_class || raw.role || raw.provider_kind)
  const policy = text(raw.install_policy || download.execution_policy, 'resource_only').toLowerCase().replaceAll('_', '-')
  const hasSource = Boolean(raw.url || raw.repo_id || raw.file_path || download.url || download.repository || source.url)
  const status = normalizeAdapterStatus(raw.adapter_status || raw.status, installed, hasSource)
  const key = text(raw.key || raw.catalog_key || providerId || path, `resource-${providerId}`)
  const modelId = text(raw.model_id || download.repository)
  return {
    ...raw,
    key,
    title: text(raw.title_zh || raw.display_name || raw.title || raw.name || raw.title_en, providerId),
    category: text(raw.resource_category || raw.category || raw.task || raw.kind, 'models').toLowerCase(),
    model_id: modelId,
    size_bytes: Number(raw.size_bytes ?? raw.size ?? download.size_bytes ?? 0) || 0,
    license: text(raw.license || raw.license_name || raw.license_id || license.name || license.spdx_id, '未声明'),
    source_label: text(source.repository || source.url || raw.source_url, '未声明'),
    device_requirement: text(raw.device_requirement || raw.device || raw.accelerator || raw.framework, 'CPU / GPU 取决于模型'),
    supported_regions: list(raw.supported_regions || raw.support_regions || raw.regions),
    provider_role: role,
    adapter_status: status,
    install_policy: policy,
    provider_id: providerId,
    runtime_provider_id: runtimeProviderId,
    local_path: path,
    installed,
    requires_license_acceptance: Boolean(raw.requires_license_acceptance || download.requires_license_acceptance),
    requires_auth: Boolean(raw.requires_auth || download.requires_auth),
    can_download: !installed && ['ready', 'manual-review', 'resource-only', 'gated'].includes(policy) && Boolean(providerId && (download.repository || download.url || modelId)),
    can_select: status === 'ready' && role === 'direct_semantic' && Boolean(path) && Boolean(runtimeProviderId),
  }
}

export function normalizeCatalogPayload(payload: unknown): ResourceCatalogItem[] {
  const data = unwrap<Record<string, unknown> | unknown[]>(payload)
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.providers) ? data.providers : []
  return (items as Record<string, unknown>[]).map(normalizeCatalogItem)
}

function localMatch(item: ResourceCatalogItem, local: LocalResourceItem) {
  const keys = [local.provider_id, ...(local.provider_ids || []), local.path, local.name].map((x) => text(x).toLowerCase()).filter(Boolean)
  if (keys.includes(item.key.toLowerCase()) || keys.includes(item.provider_id.toLowerCase())) return true
  const names = [item.file_path, item.filename, item.repo_id, item.model_id, item.provider_id].map(basename).filter(Boolean)
  const localNames = [local.path, local.relative_path, local.name].map(basename).filter(Boolean)
  return names.some((name) => localNames.includes(name))
}

export function mergeCatalogWithLocalResources(items: ResourceCatalogItem[], locals: LocalResourceItem[]) {
  return items.map((item) => {
    const local = locals.find((candidate) => localMatch(item, candidate))
    return local ? normalizeCatalogItem({ ...item, local_path: local.path || local.root, installed: true }) : item
  })
}

export function buildSemanticProviderPatch(item: ResourceCatalogItem) {
  if (!item.can_select) throw new Error('只有 ready / direct_semantic 且已安装的资源可以设为当前 provider')
  return { semantic_region_weighting_enabled: true, semantic_segmentation_provider: item.runtime_provider_id, semantic_segmentation_model_path: item.local_path }
}

export function buildCatalogDownloadPayload(item: ResourceCatalogItem, options: { acceptLicense?: boolean; hfToken?: string } = {}) {
  if (!item.can_download) throw new Error(`资源状态 ${item.adapter_status} / 安装策略 ${item.install_policy} 不允许下载`)
  return { provider_id: item.provider_id, allow_network: true, accept_license: Boolean(options.acceptLicense), hf_token: options.hfToken || '' }
}

export const resourceCenterApi = {
  async listCatalog() { return normalizeCatalogPayload(requireSuccess(await request('/api/dataset/semantic-segmentation/providers'))) },
  async listLocalResources(roots: string[] = []) {
    const response = await postJson('/api/dataset/semantic-segmentation/local-scan', { roots, limit: 1000, include_hash: false })
    return requireSuccess<{ resources?: LocalResourceItem[]; items?: LocalResourceItem[] }>(response)
  },
  async listMerged(roots: string[] = []) {
    const [catalog, local] = await Promise.all([this.listCatalog(), this.listLocalResources(roots)])
    return mergeCatalogWithLocalResources(catalog, local.resources || local.items || [])
  },
  async download(item: ResourceCatalogItem, options: { acceptLicense?: boolean; hfToken?: string } = {}) {
    const response = await postJson('/api/dataset/semantic-segmentation/download', buildCatalogDownloadPayload(item, options))
    const result = requireSuccess<Record<string, unknown>>(response)
    if (!['completed', 'reused'].includes(text(result.status))) throw new Error(text(result.error, '资源下载未完成'))
    return result
  },
}
