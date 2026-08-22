// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { Suspense, lazy } from 'react'
import { useRouteStore } from '@/stores/routeStore'

const TrainPage = lazy(() => import('@/pages/train/TrainPage'))
const GeneratePage = lazy(() => import('@/pages/generate/GeneratePage'))
const MonitorPage = lazy(() => import('@/pages/monitor/MonitorPage'))
const QueuePage = lazy(() => import('@/pages/queue/QueuePage'))
const ResourceCenterPage = lazy(() => import('@/pages/resources/ResourceCenterPage'))
const GalleryPage = lazy(() => import('@/pages/gallery/GalleryPage'))

export function PageHost() {
  const route = useRouteStore((s) => s.route)
  return (
    <Suspense fallback={<div className="lx-page-loading">Loading —</div>}>
      {route === 'train' && <TrainPage />}
      {route === 'generate' && <GeneratePage />}
      {route === 'monitor' && <MonitorPage />}
      {route === 'queue' && <QueuePage />}
      {route === 'resources' && <ResourceCenterPage />}
      {route === 'gallery' && <GalleryPage />}
    </Suspense>
  )
}
