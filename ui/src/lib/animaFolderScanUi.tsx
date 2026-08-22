// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * Anima 扫描「多候选」选择弹层。
 * animaFolderScan 在发现存在歧义组件(找到但后端未给 auto_selected)时调用 openAnimaScanChooser,
 * 用户在 Modal 中逐组件单选候选路径,点「确认应用」后回传 pick 映射;取消则回 null。
 */
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Modal } from '@/components/overlay'
import { Button } from '@/components/primitives'

export interface AnimaScanComponentChoice {
  key: string
  label: string
  field: string
  candidates: string[]
}

function AnimaScanChooser({
  choices,
  onConfirm,
  onCancel,
}: {
  choices: AnimaScanComponentChoice[]
  onConfirm: (picks: Record<string, string>) => void
  onCancel: () => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const c of choices) {
      if (c.candidates.length) init[c.key] = c.candidates[0]
    }
    return init
  })

  return (
    <Modal open title="Anima 模型路径确认" onClose={onCancel}>
      <div className="lx-anima-chooser">
        <p className="lx-anima-chooser-desc">
          扫描到多个候选路径，请为每个组件选择要使用的路径后点击「确认应用」。
        </p>
        {choices.map((c) => (
          <fieldset key={c.key} className="lx-anima-chooser-comp">
            <legend className="lx-anima-chooser-comp-label">{c.label}</legend>
            <div className="lx-anima-chooser-options" role="radiogroup" aria-label={c.label}>
              {c.candidates.map((path) => (
                <label key={path} className="lx-anima-chooser-option">
                  <input
                    type="radio"
                    name={c.key}
                    value={path}
                    checked={selections[c.key] === path}
                    onChange={() => setSelections((s) => ({ ...s, [c.key]: path }))}
                  />
                  <span className="lx-anima-chooser-path" title={path}>
                    {path}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="lx-anima-chooser-actions">
          <Button variant="primary" onClick={() => onConfirm(selections)}>
            确认应用
          </Button>
          <Button onClick={onCancel}>取消</Button>
        </div>
      </div>
    </Modal>
  )
}

let mountedRoot: Root | null = null

/** 挂载多候选选择弹层;resolve 为确认的 {组件key → 路径},取消/关闭 resolve null。 */
export function openAnimaScanChooser(
  choices: AnimaScanComponentChoice[],
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoot = root
    const cleanup = () => {
      root.unmount()
      host.remove()
      if (mountedRoot === root) mountedRoot = null
    }
    root.render(
      <AnimaScanChooser
        choices={choices}
        onConfirm={(picks) => {
          cleanup()
          resolve(picks)
        }}
        onCancel={() => {
          cleanup()
          resolve(null)
        }}
      />,
    )
  })
}
