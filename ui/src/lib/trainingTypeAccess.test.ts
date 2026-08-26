// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { describe, expect, it } from 'vitest'
import {
  describeTrainingTypeAccess,
  isRegisteredTrainingType,
  isRestorableTrainingType,
  isVisibleTrainingType,
  resolveTrainingTypeId,
} from '@/lib/trainingTypeAccess'

describe('trainingTypeAccess', () => {
  it('visible types are visible and restorable', () => {
    expect(isVisibleTrainingType('sdxl-lora')).toBe(true)
    expect(isRestorableTrainingType('sdxl-lora')).toBe(true)
    expect(isRegisteredTrainingType('sdxl-lora')).toBe(true)
  })

  it('hidden legacy types are restorable but never visible', () => {
    expect(isVisibleTrainingType('sdxl-ileco')).toBe(false)
    expect(isRestorableTrainingType('sdxl-ileco')).toBe(true)
    expect(isRegisteredTrainingType('sdxl-ileco')).toBe(true)
  })

  it('hidden restorable DiT/other legacy types', () => {
    for (const id of ['anima-addift', 'lumina-lora', 'qwen-image-lora', 'hunyuan-dit-lora']) {
      expect(isVisibleTrainingType(id), `${id} should be hidden`).toBe(false)
      expect(isRestorableTrainingType(id), `${id} should be restorable`).toBe(true)
    }
  })

  it('types without any backend schema/launch route are hidden (anima-edit-model) or disabled (yolo placeholder)', () => {
    // 后端 get_training_schema('anima-edit-model') 会 404 → 入口隐藏但草稿可恢复。
    expect(isVisibleTrainingType('anima-edit-model')).toBe(false)
    expect(isRestorableTrainingType('anima-edit-model')).toBe(true)
    // 后端 yolo schema 为 registered_placeholder，启动被 400 拒绝 → 禁用。
    expect(isVisibleTrainingType('yolo')).toBe(false)
    expect(describeTrainingTypeAccess('yolo')).toBe('disabled')
  })

  it('concept-edit is registered but disabled → never visible nor restorable', () => {
    expect(isRegisteredTrainingType('concept-edit')).toBe(true)
    expect(isVisibleTrainingType('concept-edit')).toBe(false)
    expect(isRestorableTrainingType('concept-edit')).toBe(false)
  })

  it('unknown ids are not registered', () => {
    expect(isRegisteredTrainingType('no-such-type')).toBe(false)
    expect(isVisibleTrainingType('no-such-type')).toBe(false)
    expect(isRestorableTrainingType('no-such-type')).toBe(false)
    expect(resolveTrainingTypeId('no-such-type')).toBeNull()
  })

  it('resolveTrainingTypeId returns id for registered (incl. hidden), null otherwise', () => {
    expect(resolveTrainingTypeId('sdxl-ileco')).toBe('sdxl-ileco')
    expect(resolveTrainingTypeId('concept-edit')).toBe('concept-edit')
    expect(resolveTrainingTypeId('sdxl-lora')).toBe('sdxl-lora')
    expect(resolveTrainingTypeId('')).toBeNull()
    expect(resolveTrainingTypeId(null)).toBeNull()
    expect(resolveTrainingTypeId(undefined)).toBeNull()
  })
})