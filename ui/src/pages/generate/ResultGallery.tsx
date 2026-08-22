// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useRef, useState } from 'react'
import type { GenerationImage, GenerationLogItem, GenerationTask } from '@/api/generateApi'
import { useI18n } from '@/i18n/useI18n'
import { Image as ImageIcon } from 'lucide-react'

/* 出图结果与运行日志。新建而非复用 GalleryPage —— 那是组件样张页,
   展示的是 UI 控件本身,与出图产物无关。 */

interface Props {
  images: GenerationImage[]
  logs: GenerationLogItem[]
  task: GenerationTask
}

const STATUS_CLASS: Record<string, string> = {
  running: 'is-running',
  completed: 'is-ok',
  failed: 'is-bad',
  cancelled: 'is-warn',
}

export function ResultGallery({ images, logs, task }: Props) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<GenerationImage | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const status = task.status ?? 'idle'

  return (
    <section className="lx-generate__results">
      <header className="lx-results__head">
        <h2>{t('generate.results')}</h2>
        <span className={`lx-results__status ${STATUS_CLASS[status] ?? ''}`}>
          {t(`generate.status_${status}`)}
        </span>
        {typeof task.regions === 'number' && task.regions > 0 && (
          <span className="lx-results__meta">{t('generate.region_count', { n: task.regions })}</span>
        )}
        {task.output_dir && <code className="lx-results__dir">{task.output_dir}</code>}
      </header>

      <div className="lx-results__body">
        <div className="lx-results__grid">
          {images.map((image) => (
            <button
              type="button"
              key={image.path}
              className="lx-results__thumb"
              onClick={() => setPreview(image)}
            >
              <img src={image.url} alt={image.name} loading="lazy" />
              <span>{image.name}</span>
            </button>
          ))}
          {!images.length && (
            <div className="lx-results__empty">
              <ImageIcon size={24} style={{ opacity: 0.6, marginBottom: 4 }} />
              <div>{t('generate.no_images')}</div>
            </div>
          )}
        </div>

        <pre ref={logRef} className="lx-results__log">
          {logs.map((item) => item.message).join('\n')}
        </pre>
      </div>

      {preview && (
        <div className="lx-results__lightbox" onClick={() => setPreview(null)}>
          <img src={preview.url} alt={preview.name} />
        </div>
      )}
    </section>
  )
}
