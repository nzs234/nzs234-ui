// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useState } from 'react'
import { Input, Select, Textarea } from '@/components/form'
import { Button } from '@/components/primitives'

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
interface JsonObject { [key: string]: JsonValue }
type Phase = JsonObject & {
  id: string
  start: number
  end: number
  lr_scale: number
}

type ParsedSchedule = {
  root: JsonObject | null
  phases: Phase[]
  invalid: string
  wasArray: boolean
}

const ALIASES: Record<string, string[]> = {
  id: ['phase_id', 'phaseId'],
  module_policy: ['modules', 'module', 'modulePolicy'],
  difficulty_policy: ['difficulty', 'curriculum', 'difficultyPolicy'],
  timestep_policy: ['timesteps', 'timestep', 'timestepPolicy'],
  resolution_hint: ['resolution', 'resolution_hints', 'resolutionHint'],
  rank_hint: ['rank', 'rank_hints', 'rankHint'],
}

const MODULE_PRESETS = [
  { value: 'none', label: '不限制', json: null },
  { value: 'attention', label: '仅 Attention', json: { train: ['attention'] } },
  { value: 'attention_mlp', label: 'Attention + MLP', json: { train: ['attention', 'mlp'] } },
  { value: 'all', label: 'Attention + MLP + Extended', json: { train: ['attention', 'mlp', 'extended'] } },
]
const DIFFICULTY_PRESETS = [
  { value: 'none', label: '不限制', json: null },
  { value: 'easy', label: '简单优先', json: { mode: 'easy', strength: 0.5 } },
  { value: 'hard', label: '困难优先', json: { mode: 'hard', strength: 1 } },
]
const TIMESTEP_PRESETS = [
  { value: 'none', label: '均匀', json: null },
  { value: 'low', label: '低时间步', json: { mode: 'low', strength: 1 } },
  { value: 'high', label: '高时间步', json: { mode: 'high', strength: 1 } },
  { value: 'middle', label: '中间时间步', json: { mode: 'middle', strength: 1 } },
  { value: 'extremes', label: '两端时间步', json: { mode: 'extremes', strength: 1 } },
]

const DEFAULT_PHASE: Phase = {
  id: 'phase-1',
  start: 0,
  end: 1,
  lr_scale: 1,
  module_policy: null,
  difficulty_policy: null,
  timestep_policy: null,
  resolution_hint: null,
  rank_hint: null,
}

function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function readField(phase: JsonObject, key: string, fallback: JsonValue = null): JsonValue {
  if (key in phase) return phase[key]
  for (const alias of ALIASES[key] ?? []) if (alias in phase) return phase[alias]
  return fallback
}

function numberOr(value: JsonValue, fallback: number): number {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : fallback
}

function toPhase(value: unknown, index: number): Phase {
  const source = asObject(value) ?? {}
  return {
    ...clone(source),
    id: String(readField(source, 'id', `phase-${index + 1}`) || `phase-${index + 1}`),
    start: numberOr(source.start, index === 0 ? 0 : 0),
    end: numberOr(source.end, index === 0 ? 1 : 1),
    lr_scale: numberOr(source.lr_scale, 1),
    module_policy: clone(readField(source, 'module_policy')),
    difficulty_policy: clone(readField(source, 'difficulty_policy')),
    timestep_policy: clone(readField(source, 'timestep_policy')),
    resolution_hint: clone(readField(source, 'resolution_hint')),
    rank_hint: clone(readField(source, 'rank_hint')),
  }
}

function parseSchedule(value: unknown): ParsedSchedule {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (!value.trim()) return { root: {}, phases: [clone(DEFAULT_PHASE)], invalid: '', wasArray: false }
    try {
      parsed = JSON.parse(value)
    } catch {
      return { root: {}, phases: [clone(DEFAULT_PHASE)], invalid: 'JSON 格式无效，当前编辑不会覆盖原始内容。', wasArray: false }
    }
  }
  if (Array.isArray(parsed)) {
    const phases = parsed.length ? parsed.map(toPhase) : [clone(DEFAULT_PHASE)]
    return { root: null, phases, invalid: '', wasArray: true }
  }
  const root = asObject(parsed)
  if (root && Array.isArray(root.phases)) {
    const phases = root.phases.length ? root.phases.map(toPhase) : [clone(DEFAULT_PHASE)]
    return { root, phases, invalid: '', wasArray: false }
  }
  if (root && ('start' in root || 'end' in root || 'lr_scale' in root)) {
    return { root: {}, phases: [toPhase(root, 0)], invalid: '', wasArray: false }
  }
  return { root: {}, phases: [clone(DEFAULT_PHASE)], invalid: '', wasArray: false }
}

function scheduleText(parsed: ParsedSchedule): string {
  const payload = parsed.wasArray
    ? parsed.phases
    : { ...(parsed.root ?? {}), phases: parsed.phases }
  return JSON.stringify(payload, null, 2)
}

function sameJson(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function presetValue(value: JsonValue, presets: readonly { value: string; json: JsonValue }[]): string {
  return presets.find((preset) => sameJson(value, preset.json))?.value ?? '__custom__'
}

function clampProgress(value: string, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function policyOptions(presets: readonly { value: string; label: string }[]) {
  return [...presets.map(({ value, label }) => ({ value, label })), { value: '__custom__', label: '自定义（JSON fallback）' }]
}

function PolicySelect({
  value,
  presets,
  onChange,
}: {
  value: JsonValue
  presets: readonly { value: string; label: string; json: JsonValue }[]
  onChange: (value: JsonValue) => void
}) {
  const selected = presetValue(value, presets)
  return (
    <Select
      aria-label="phase policy"
      value={selected}
      options={policyOptions(presets)}
      onChange={(event) => {
        const next = presets.find((preset) => preset.value === event.target.value)
        if (next) onChange(clone(next.json))
      }}
    />
  )
}

function ValueInput({
  value,
  onChange,
  placeholder,
}: {
  value: JsonValue
  onChange: (value: JsonValue) => void
  placeholder?: string
}) {
  const isCustom = value !== null && typeof value === 'object'
  return (
    <Input
      type={isCustom ? 'text' : 'number'}
      inputMode={isCustom ? 'text' : 'numeric'}
      value={isCustom ? JSON.stringify(value) : value == null ? '' : String(value)}
      placeholder={placeholder ?? '留空'}
      readOnly={isCustom}
      title={isCustom ? '复杂值请在 JSON fallback 中编辑' : undefined}
      onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
    />
  )
}

function phaseLabel(index: number, id: string): string {
  return `${String(index + 1).padStart(2, '0')} · ${id || '未命名'}`
}

export function ProgressivePhaseEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: string) => void
}) {
  const parsed = useMemo(() => parseSchedule(value), [value])
  const [jsonDraft, setJsonDraft] = useState(() => typeof value === 'string' ? value : scheduleText(parsed))
  const [jsonError, setJsonError] = useState('')

  useEffect(() => {
    setJsonDraft(parsed.invalid ? String(value ?? '') : scheduleText(parsed))
    setJsonError('')
  }, [parsed, value])

  const commit = (phases: Phase[]) => {
    const next = parsed.wasArray ? phases : { ...(parsed.root ?? {}), phases }
    onChange(JSON.stringify(next))
  }

  const updatePhase = (index: number, patch: Partial<Phase>) => {
    const phases: Phase[] = parsed.phases.map((phase, phaseIndex) => phaseIndex === index ? Object.assign({}, phase, patch) as Phase : phase)
    commit(phases)
  }

  const addPhase = () => {
    const previous = parsed.phases[parsed.phases.length - 1] ?? DEFAULT_PHASE
    const start = Math.min(1, Math.max(0, previous.end))
    commit([...parsed.phases, { ...clone(DEFAULT_PHASE), id: `phase-${parsed.phases.length + 1}`, start, end: 1 }])
  }

  const removePhase = (index: number) => {
    if (parsed.phases.length <= 1) return
    commit(parsed.phases.filter((_, phaseIndex) => phaseIndex !== index))
  }

  const importJson = () => {
    try {
      const next = parseSchedule(jsonDraft)
      if (next.invalid || (typeof JSON.parse(jsonDraft) !== 'object' && !Array.isArray(JSON.parse(jsonDraft)))) throw new Error('invalid')
      const payload = next.wasArray ? next.phases : { ...(next.root ?? {}), phases: next.phases }
      onChange(JSON.stringify(payload))
      setJsonError('')
    } catch {
      setJsonError('无法导入：请输入 JSON 数组或包含 phases 数组的对象。')
    }
  }

  return (
    <div className="lx-progressive-editor">
      <div className="lx-progressive-editor-head">
        <div>
          <b>Phase Editor</b>
          <span>结构化编辑会写回 progressive_phase_schedule；未知字段会随 JSON 一起保留。</span>
        </div>
        <Button size="sm" onClick={addPhase}>＋ 添加 Phase</Button>
      </div>

      <div className="lx-progressive-phase-list">
        {parsed.phases.map((phase, index) => {
          const invalidRange = phase.start < 0 || phase.end > 1 || phase.start >= phase.end
          return (
            <div className="lx-progressive-phase-row" key={`${phase.id}-${index}`}>
              <div className="lx-progressive-phase-title">
                <span className="lx-num">{phaseLabel(index, phase.id)}</span>
                <button type="button" className="lx-progressive-remove" onClick={() => removePhase(index)} disabled={parsed.phases.length <= 1} aria-label={`删除 ${phase.id}`}>−</button>
              </div>
              <label><span>ID</span><Input value={phase.id} onChange={(event) => updatePhase(index, { id: event.target.value })} /></label>
              <label><span>Start</span><Input type="number" min={0} max={1} step={0.01} value={phase.start} onChange={(event) => updatePhase(index, { start: clampProgress(event.target.value, phase.start) })} /></label>
              <label><span>End</span><Input type="number" min={0} max={1} step={0.01} value={phase.end} onChange={(event) => updatePhase(index, { end: clampProgress(event.target.value, phase.end) })} /></label>
              <label><span>LR Scale</span><Input type="number" min={0} step={0.05} value={phase.lr_scale} onChange={(event) => updatePhase(index, { lr_scale: numberOr(event.target.value, phase.lr_scale) })} /></label>
              <label><span>Module</span><PolicySelect value={phase.module_policy} presets={MODULE_PRESETS} onChange={(next) => updatePhase(index, { module_policy: next })} /></label>
              <label><span>Difficulty</span><PolicySelect value={phase.difficulty_policy} presets={DIFFICULTY_PRESETS} onChange={(next) => updatePhase(index, { difficulty_policy: next })} /></label>
              <label><span>Timestep</span><PolicySelect value={phase.timestep_policy} presets={TIMESTEP_PRESETS} onChange={(next) => updatePhase(index, { timestep_policy: next })} /></label>
              <label><span>Resolution</span><ValueInput value={phase.resolution_hint} onChange={(next) => updatePhase(index, { resolution_hint: next })} /></label>
              <label><span>Rank</span><ValueInput value={phase.rank_hint} onChange={(next) => updatePhase(index, { rank_hint: next })} /></label>
              {invalidRange ? <small className="lx-progressive-phase-warning">Start / End 需要覆盖 0~1 且 Start &lt; End</small> : null}
            </div>
          )
        })}
      </div>

      <details className="lx-progressive-json-fallback">
        <summary>JSON 导入 / 导出 fallback</summary>
        <p>用于复杂 policy、别名字段和未识别字段的精确 round-trip。点击“导出当前”刷新为结构化编辑器当前值。</p>
        <Textarea rows={8} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} />
        <div className="lx-progressive-json-actions">
          <Button size="sm" onClick={() => { setJsonDraft(scheduleText(parsed)); setJsonError('') }}>导出当前</Button>
          <Button size="sm" variant="primary" onClick={importJson}>应用 JSON</Button>
          {jsonError || parsed.invalid ? <span className="lx-progressive-json-error">{jsonError || parsed.invalid}</span> : null}
        </div>
      </details>
    </div>
  )
}

