// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { Suspense, lazy } from 'react'
import { useRouteStore } from '@/stores/routeStore'

const TrainPage = lazy(() => import('@/pages/train/TrainPage'))
const GeneratePage = lazy(() => import('@/pages/generate/GeneratePage'))
const MonitorPage = lazy(() => import('@/pages/monitor/MonitorPage'))
const QueuePage = lazy(() => import('@/pages/queue/QueuePage'))
const ResourceCenterPage = lazy(() => import('@/pages/resources/ResourceCenterPage'))
// dev-only 设计实验室：生产构建下 import.meta.env.DEV 常量折叠成 false，
// 这个分支连同 GalleryPage 的 chunk 一起被摇掉（路由层 isRouteAvailable 亦已拦死）。
const GalleryPage = import.meta.env.DEV ? lazy(() => import('@/pages/gallery/GalleryPage')) : null

export function PageHost() {
  const route = useRouteStore((s) => s.route)
  return (
    <Suspense fallback={<div className="lx-page-loading">Loading —</div>}>
      {route === 'train' && <TrainPage />}
      {route === 'generate' && <GeneratePage />}
      {route === 'monitor' && <MonitorPage />}
      {route === 'queue' && <QueuePage />}
      {route === 'resources' && <ResourceCenterPage />}
      {route === 'gallery' && GalleryPage ? <GalleryPage /> : null}
    </Suspense>
  )
}
