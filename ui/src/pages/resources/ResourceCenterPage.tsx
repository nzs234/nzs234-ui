import { useEffect, useMemo, useState } from 'react'
import { PageHead, Panel } from '@/components/layout'
import { Badge, Button, Empty } from '@/components/primitives'
import { toast } from '@/stores/toastStore'
import { useRouteStore } from '@/stores/routeStore'
import { trainApi } from '@/api/trainApi'
import { resourceCenterApi, buildSemanticProviderPatch, type AdapterStatus, type ProviderRole, type ResourceCatalogItem } from '@/api/resourceCenterApi'
import { useI18n } from '@/i18n/useI18n'
import { FolderArchive, RefreshCw } from 'lucide-react'
import './resource-center.css'

export default function ResourceCenterPage() {
  const { t } = useI18n()
  const navigate = useRouteStore((s) => s.navigate)
  const [items, setItems] = useState<ResourceCatalogItem[]>([])
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<ProviderRole | ''>('')
  const [status, setStatus] = useState<AdapterStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const roles: Record<ProviderRole, string> = {
    direct_semantic: t('resource.role.direct_semantic'),
    mask_proposal: t('resource.role.mask_proposal'),
    compound_grounded: t('resource.role.compound_grounded'),
    unknown: t('resource.role.unknown'),
  }
  const statuses: Record<AdapterStatus, string> = {
    ready: t('resource.status.ready'),
    gated: t('resource.status.gated'),
    'manual-review': t('resource.status.manual_review'),
    'resource-only': t('resource.status.resource_only'),
  }
  const policies: Record<string, string> = {
    ready: t('resource.policy.ready'),
    'manual-review': t('resource.policy.manual_review'),
    'resource-only': t('resource.policy.resource_only'),
    gated: t('resource.policy.gated'),
  }
  const fmt = (n: number) => n <= 0 ? t('resource.unknown') : n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`

  const load = async (roots: string[] = []) => {
    setLoading(true); setError('')
    try {
      setItems(await resourceCenterApi.listMerged(roots))
    } catch (e) {
      const msg = (e as Error).message || ''
      const statusMatch = msg.match(/(\d{3})/)
      const localizedError = statusMatch ? t('api.request_fail', { status: statusMatch[1] }) : (msg || t('api.backend_down'))
      setError(localizedError)
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  // 挂载拉取一次目录;load 闭包持有挂载时语言文案,与原行为一致,故不入依赖。
  useEffect(() => {
    // setState 发生在 load 的 await 之后,延后一拍启动避免同步级联渲染。
    const kick = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(kick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const visible = useMemo(() => items.filter((item) => {
    const haystack = `${item.title} ${item.key} ${item.provider_id} ${item.model_id}`.toLowerCase()
    return (!query || haystack.includes(query.toLowerCase())) && (!role || item.provider_role === role) && (!status || item.adapter_status === status)
  }), [items, query, role, status])
  // configStore 静态 import 会把全量 schema(~740KB)绑进本页 chunk;
  // 「设为提供方」是点击后才发生的动作,此时再取 store 即可（随后立刻跳训练页,
  // 那里本来就要加载 schema）。失败时不静默:提示与原先的 catch 分支一致。
  const select = async (item: ResourceCatalogItem) => {
    try {
      const { useTrainConfigStore } = await import('@/stores/configStore')
      useTrainConfigStore.getState().applyValues(buildSemanticProviderPatch(item))
      toast.ok(t('resource.set_ok'), 'RESOURCE')
      navigate('train')
    } catch (e) {
      toast.warn((e as Error).message, 'RESOURCE')
    }
  }
  const download = async (item: ResourceCatalogItem) => {
    const accept = item.requires_license_acceptance || item.install_policy === 'manual-review' || item.install_policy === 'gated'
    if (accept && !window.confirm(t('resource.confirm_license', { license: item.license }))) return
    const hfToken = item.requires_auth ? window.prompt(t('resource.hf_token_prompt')) || '' : ''
    try { await resourceCenterApi.download(item, { acceptLicense: accept, hfToken }); toast.ok(t('resource.download_ok'), 'RESOURCE'); await load() } catch (e) { toast.warn((e as Error).message, 'DOWNLOAD') }
  }
  const pickLocal = async () => {
    try {
      const result = await trainApi.pickFile('folder', 'semantic_segmentation_model_path')
      const path = (result as any)?.data?.path || (result as any)?.path || ''
      if (path) { toast.info(t('resource.scan_local_hint'), 'RESOURCE'); await load([path]) }
    } catch (e) { toast.warn((e as Error).message, 'PICKER') }
  }
  return <div className="lx-resource-page">
    <PageHead idx="04" tag="RESOURCE CENTER" lines={[{ text: 'SEG / SAM' }, { text: 'RESOURCES', outline: true }]} sub={t('resource.sub')} />
    <Panel title={t('resource.catalog')} idx="P9" right={<Button size="sm" onClick={() => void load()}>{t('common.refresh')}</Button>}>
      <div className="lx-resource-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('resource.search_ph')} />
        <select value={role} onChange={(e) => setRole(e.target.value as ProviderRole | '')}>
          <option value="">{t('resource.all_roles')}</option>
          {Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as AdapterStatus | '')}>
          <option value="">{t('resource.all_statuses')}</option>
          {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <Button onClick={() => void pickLocal()}>{t('resource.pick_local')}</Button>
      </div>
      {loading ? (
        <Empty icon={<RefreshCw size={28} className="lx-spin" />} title={t('resource.loading')} />
      ) : error ? (
        <Empty
          icon={<FolderArchive size={28} />}
          title={t('resource.unavailable')}
          desc={error}
          action={<Button variant="primary" onClick={() => void load()}>{t('resource.retry')}</Button>}
        />
      ) : !visible.length ? (
        <Empty icon={<FolderArchive size={28} />} title={t('resource.empty_title')} desc={t('resource.empty_desc')} />
      ) : (
        <div className="lx-resource-grid">
          {visible.map((item) => (
            <article className="lx-resource-card" key={item.key}>
              <header>
                <div>
                  <h3>{item.title}</h3>
                  <code>{item.provider_id}</code>
                </div>
                <div className="lx-resource-badges">
                  <Badge tone={item.provider_role === 'direct_semantic' ? 'ok' : 'warn'}>{roles[item.provider_role]}</Badge>
                  <Badge tone={item.adapter_status === 'ready' ? 'ok' : item.adapter_status === 'gated' ? 'warn' : 'danger'}>{statuses[item.adapter_status]}</Badge>
                </div>
              </header>
              {item.provider_role === 'mask_proposal' && <p className="lx-resource-warning">{t('resource.warn_mask_proposal')}</p>}
              {item.provider_role === 'compound_grounded' && <p className="lx-resource-warning">{t('resource.warn_compound_grounded')}</p>}
              <dl>
                <div><dt>{t('resource.lbl_model')}</dt><dd>{item.model_id}</dd></div>
                <div><dt>{t('resource.lbl_size')}</dt><dd>{fmt(item.size_bytes)}</dd></div>
                <div><dt>{t('resource.lbl_source')}</dt><dd>{item.source_label}</dd></div>
                <div><dt>{t('resource.lbl_license')}</dt><dd>{item.license}</dd></div>
                <div><dt>{t('resource.lbl_device')}</dt><dd>{item.device_requirement}</dd></div>
                <div><dt>{t('resource.lbl_regions')}</dt><dd>{item.supported_regions.join('、') || t('resource.unspecified')}</dd></div>
                <div><dt>{t('resource.lbl_policy')}</dt><dd>{policies[item.install_policy] || item.install_policy}</dd></div>
                <div><dt>{t('resource.lbl_install_status')}</dt><dd>{item.installed ? item.local_path || t('resource.installed') : t('resource.not_installed')}</dd></div>
              </dl>
              <footer>
                {item.can_select ? (
                  <Button variant="primary" onClick={() => void select(item)}>{t('resource.set_provider')}</Button>
                ) : item.can_download ? (
                  <Button onClick={() => void download(item)}>{item.install_policy === 'gated' ? t('resource.auth_and_download') : t('resource.download')}</Button>
                ) : (
                  <Button disabled>{item.installed ? t('resource.installed_standby') : statuses[item.adapter_status]}</Button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </Panel>
  </div>
}
