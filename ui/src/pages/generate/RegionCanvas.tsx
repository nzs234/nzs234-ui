// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useCallback, useRef, useState } from 'react'
import type { RegionSpec } from '@/api/generateApi'
import { useI18n } from '@/i18n/useI18n'

/* 画框组件:在画布上拖出矩形 → 每框绑一个 LoRA 与局部 prompt。

   坐标自始至终是归一化的 [0,1],从不经过像素中间态。后端
   parse_regional_lora_regions 与 GenerationRequest 都明确拒绝像素坐标 ——
   在这里存像素、提交前再除,等于把一个必然出错的形状多留一道工序。 */

const MIN_SIZE = 0.02

interface Props {
  regions: RegionSpec[]
  onChange(regions: RegionSpec[]): void
  /** 画布宽高比,跟随出图尺寸,保证框的形状与成图一致 */
  aspect: number
  loras: string[]
}

interface Drag {
  x1: number
  y1: number
  x2: number
  y2: number
}

const PALETTE = ['#4f8cff', '#ff7a59', '#3ec9a7', '#c07aff', '#ffc247', '#ff5c8a']

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function normalise(drag: Drag): [number, number, number, number] {
  return [
    clamp01(Math.min(drag.x1, drag.x2)),
    clamp01(Math.min(drag.y1, drag.y2)),
    clamp01(Math.max(drag.x1, drag.x2)),
    clamp01(Math.max(drag.y1, drag.y2)),
  ]
}

export function RegionCanvas({ regions, onChange, aspect, loras }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selected, setSelected] = useState<number>(-1)

  const toLocal = useCallback((event: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const { x, y } = toLocal(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ x1: x, y1: y, x2: x, y2: y })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const { x, y } = toLocal(event)
    setDrag({ ...drag, x2: x, y2: y })
  }

  const onPointerUp = () => {
    if (!drag) return
    const box = normalise(drag)
    setDrag(null)
    // 一次误点击会产生一个零面积的框,后端会因 x2 > x1 不成立而拒绝整个请求。
    // 在这里丢弃,比让用户提交后收到一条校验错误好。
    if (box[2] - box[0] < MIN_SIZE || box[3] - box[1] < MIN_SIZE) return
    onChange([...regions, { box, lora: loras[0] ?? '', prompt: '' }])
    setSelected(regions.length)
  }

  const update = (index: number, patch: Partial<RegionSpec>) => {
    onChange(regions.map((region, i) => (i === index ? { ...region, ...patch } : region)))
  }

  const remove = (index: number) => {
    onChange(regions.filter((_, i) => i !== index))
    setSelected(-1)
  }

  const preview = drag ? normalise(drag) : null

  return (
    <div className="lx-region-canvas">
      <div
        ref={canvasRef}
        className="lx-region-canvas__stage"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {regions.map((region, index) => {
          const [x1, y1, x2, y2] = region.box
          const colour = PALETTE[index % PALETTE.length]
          return (
            <div
              key={index}
              role="button"
              tabIndex={0}
              aria-label={`Select region ${index + 1}`}
              className={`lx-region-canvas__box${selected === index ? ' is-selected' : ''}`}
              style={{
                left: `${x1 * 100}%`,
                top: `${y1 * 100}%`,
                width: `${(x2 - x1) * 100}%`,
                height: `${(y2 - y1) * 100}%`,
                borderColor: colour,
                background: `${colour}22`,
              }}
              onPointerDown={(event) => {
                event.stopPropagation()
                setSelected(index)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelected(index)
                }
              }}
            >
              <span className="lx-region-canvas__tag" style={{ background: colour }}>
                {index + 1}
              </span>
            </div>
          )
        })}
        {preview && (
          <div
            className="lx-region-canvas__box is-preview"
            style={{
              left: `${preview[0] * 100}%`,
              top: `${preview[1] * 100}%`,
              width: `${(preview[2] - preview[0]) * 100}%`,
              height: `${(preview[3] - preview[1]) * 100}%`,
            }}
          />
        )}
        {!regions.length && !preview && (
          <div className="lx-region-canvas__hint">{t('generate.canvas_hint')}</div>
        )}
      </div>

      <div className="lx-region-canvas__list">
        {regions.map((region, index) => (
          <div
            key={index}
            className={`lx-region-row${selected === index ? ' is-selected' : ''}`}
            onFocus={() => setSelected(index)}
          >
            <div className="lx-region-row__primary">
              <span
                className="lx-region-row__index"
                style={{ background: PALETTE[index % PALETTE.length] }}
              >
                {index + 1}
              </span>
              <select
                className="lx-region-row__lora"
                value={region.lora}
                onChange={(e) => update(index, { lora: e.target.value })}
                aria-label={`LoRA for region ${index + 1}`}
              >
                <option value="">{t('generate.pick_lora')}</option>
                {loras.map((lora) => (
                  <option key={lora} value={lora}>
                    {lora.split(/[\\/]/).pop()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="lx-region-row__remove"
                onClick={() => remove(index)}
                aria-label={`Remove region ${index + 1}`}
              >
                ×
              </button>
            </div>
            <div className="lx-region-row__secondary">
              <input
                className="lx-region-row__prompt"
                placeholder={t('generate.region_prompt')}
                value={region.prompt ?? ''}
                onChange={(e) => update(index, { prompt: e.target.value })}
                aria-label={`Prompt for region ${index + 1}`}
              />
              <code className="lx-region-row__box">
                {region.box.map((v) => v.toFixed(2)).join(', ')}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
