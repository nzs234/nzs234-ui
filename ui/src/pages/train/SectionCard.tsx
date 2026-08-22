// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useMemo } from 'react'
import type { SchemaField, SchemaSection } from '@/schema/schemaIndex'
import { isFieldVisible } from '@/schema/schemaIndex.js'
import { Panel } from '@/components/layout'
import { FieldControl } from './FieldControl'
import { WeightComposerPreview } from './WeightComposerPreview'
import { TrainingIntentProfilePreview } from './TrainingIntentProfilePreview'
import { ProgressivePhaseEditor } from './ProgressivePhaseEditor'

/* 一个 schema section → 一张面板卡;字段可见性(visibleWhen)+ 搜索过滤,全部不可见则整卡隐藏 */

function matches(field: SchemaField, term: string): boolean {
  if (!term) return true
  const t = term.toLowerCase()
  return (
    field.key.toLowerCase().includes(t) ||
    (field.label ?? '').toLowerCase().includes(t) ||
    (field.title ?? '').toLowerCase().includes(t) ||
    (field.desc ?? '').toLowerCase().includes(t)
  )
}

export function SectionCard({
  section,
  idx,
  config,
  search,
  onChange,
  onHelp,
  explicitFields,
  onApplySuggestions,
  managedKeys,
  managedMessage,
  expert = false,
}: {
  section: SchemaSection
  idx: number
  config: Record<string, unknown>
  search: string
  onChange: (key: string, raw: unknown) => void
  onHelp: (field: SchemaField) => void
  explicitFields: string[]
  onApplySuggestions: (values: Record<string, unknown>) => void
  managedKeys: ReadonlySet<string>
  managedMessage: string
  expert?: boolean
}) {
  const visibleFields = useMemo(
    () =>
      section.fields.filter(
        (f) =>
          f.type !== 'hidden' &&
          f.type !== 'ui_group' &&
          isFieldVisible(f, config) &&
          matches(f, search),
      ),
    [section, config, search],
  )
  const progressiveScheduleField = section.id === 'progressive-training'
    ? visibleFields.find((field) => field.key === 'progressive_phase_schedule')
    : undefined
  const renderedFields = progressiveScheduleField
    ? visibleFields.filter((field) => field.key !== progressiveScheduleField.key)
    : visibleFields

  if (!visibleFields.length) return null

  return (
    <Panel
      title={section.title}
      idx={String(idx + 1).padStart(2, '0')}
      panelId={section.id.toUpperCase().slice(0, 18)}
      className="lx-cfg-section"
    >
      {section.description ? <p className="lx-cfg-desc">{section.description}</p> : null}
      <div className={['lx-cfg-grid', expert ? 'lx-cfg-grid--expert' : ''].filter(Boolean).join(' ')}>
        {renderedFields.map((f) => (
          <FieldControl
            key={f.key}
            field={f}
            value={config[f.key]}
            onChange={(raw) => onChange(f.key, raw)}
            onHelp={onHelp}
            disabled={managedKeys.has(f.key)}
            disabledReason={managedKeys.has(f.key) ? managedMessage : ''}
          />
        ))}
      </div>
      {progressiveScheduleField ? (
        <ProgressivePhaseEditor
          value={config.progressive_phase_schedule}
          onChange={(raw) => onChange('progressive_phase_schedule', raw)}
        />
      ) : null}
      {section.id === 'weight-composer' ? <WeightComposerPreview config={config} onChange={onChange} /> : null}
      {section.id === 'training-intent-profile' ? (
        <TrainingIntentProfilePreview config={config} explicitFields={explicitFields} onApplySuggestions={onApplySuggestions} />
      ) : null}
    </Panel>
  )
}
