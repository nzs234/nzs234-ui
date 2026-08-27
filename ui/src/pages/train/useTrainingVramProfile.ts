// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useMemo, useRef, useState } from 'react'
import { trainApi } from '@/api/trainApi'
import { unwrap } from '@/api/transport'
import { useTrainConfigStore } from '@/stores/configStore'

const OFF = 'off'

type JsonBag = Record<string, unknown>

interface ManagedResolution {
  managedValues: JsonBag
  managedKeys: ReadonlySet<string>
}

const EMPTY_RESOLUTION: ManagedResolution = {
  managedValues: {},
  managedKeys: new Set<string>(),
}

function bag(value: unknown): JsonBag {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonBag : {}
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function parseResolution(payload: unknown): ManagedResolution & { detectedVramGb: number } {
  const root = bag(unwrap<JsonBag>(payload))
  const decision = bag(
    root.training_vram_profile_decision
      ?? root.profile_decision
      ?? root.vram_profile_decision,
  )
  const effective = String(decision.effective ?? '').trim().toLowerCase()
  const evidenceStatus = String(decision.evidence_status ?? '').trim().toLowerCase()
  const enabled = decision.enabled === true || (!!effective && effective !== OFF && effective !== 'auto')
  const unsupported = decision.supported === false || evidenceStatus === 'unsupported' || evidenceStatus === 'disabled'
  const sourceValues = bag(decision.managed_values ?? decision.changes)
  const resolvedValues = bag(root.values)
  const declaredKeys = Array.isArray(decision.managed_keys)
    ? decision.managed_keys.map(String).filter(Boolean)
    : Object.keys(sourceValues)
  const managedValues: JsonBag = {}
  const managedKeys = new Set<string>()

  if (enabled && !unsupported) {
    for (const key of declaredKeys) {
      if (Object.hasOwn(sourceValues, key)) managedValues[key] = sourceValues[key]
      else if (Object.hasOwn(resolvedValues, key)) managedValues[key] = resolvedValues[key]
      else continue
      managedKeys.add(key)
    }
  }

  return {
    managedValues,
    managedKeys,
    detectedVramGb: positiveNumber(
      decision.detected_vram_gb
        ?? bag(decision.constraints).detected_vram_gb
        ?? root.detected_vram_gb,
    ),
  }
}

/**
 * Resolve the backend-owned VRAM preset into a read-only presentation layer.
 * Managed values never overwrite the user's draft; switching back to off therefore
 * reveals the original values immediately. Failed/unsupported previews fail open.
 */
export function useTrainingVramProfile(typeId: string, draft: JsonBag) {
  const profile = String(draft.training_vram_profile ?? OFF).trim().toLowerCase() || OFF
  const variant = String(
    draft.wan22_model_variant
      ?? draft.model_variant
      ?? draft.checkpoint_variant
      ?? '',
  )
  const latestDraft = useRef(draft)
  const generation = useRef(0)
  const [resolution, setResolution] = useState<ManagedResolution>(EMPTY_RESOLUTION)

  // 最新 draft 经 effect 落 ref(渲染期不写 ref);放在主 effect 之前保证其先执行。
  useEffect(() => {
    latestDraft.current = draft
  })

  // 档位/类型/变体变化时立即清空旧托管值:渲染期 props→state 调整模式,
  // setState 不在 effect 体内同步触发;挂载首帧与初始 EMPTY 无异,行为不变。
  const resolveKey = `${profile}\u0000${typeId}\u0000${variant}`
  const [lastResolveKey, setLastResolveKey] = useState(resolveKey)
  if (lastResolveKey !== resolveKey) {
    setLastResolveKey(resolveKey)
    setResolution(EMPTY_RESOLUTION)
  }

  useEffect(() => {
    const requestGeneration = ++generation.current
    if (profile === OFF) return

    const config = {
      ...latestDraft.current,
      model_train_type: typeId,
      training_vram_profile: profile,
      training_vram_profile_control: 'managed',
    }

    void trainApi.resolveConfig(typeId, config).then((payload) => {
      if (generation.current !== requestGeneration) return
      const next = parseResolution(payload)
      setResolution({ managedValues: next.managedValues, managedKeys: next.managedKeys })

      if (profile === 'auto' && next.detectedVramGb > 0) {
        const store = useTrainConfigStore.getState()
        const currentDraft = store.drafts[store.typeId] ?? {}
        if (
          store.typeId === typeId
          && String(currentDraft.training_vram_profile ?? OFF).trim().toLowerCase() === 'auto'
          && positiveNumber(currentDraft.detected_vram_gb) !== next.detectedVramGb
        ) {
          store.setValue('detected_vram_gb', next.detectedVramGb)
        }
      }
    }).catch(() => {
      if (generation.current === requestGeneration) setResolution(EMPTY_RESOLUTION)
    })
  }, [profile, typeId, variant])

  const displayDraft = useMemo(
    () => resolution.managedKeys.size ? { ...draft, ...resolution.managedValues } : draft,
    [draft, resolution],
  )

  return {
    displayDraft,
    managedKeys: resolution.managedKeys,
  }
}
