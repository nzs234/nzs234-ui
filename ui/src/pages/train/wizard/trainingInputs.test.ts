// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0

import { resolveTrainingInputs } from './trainingInputs'

describe('resolveTrainingInputs', () => {
  test('sdxl-lora (default LoRA): missing when pretrained path empty; anyOf clears with any one key', () => {
    const empty = resolveTrainingInputs('sdxl-lora', {})
    const baseModel = empty.model.find((group) => group.id === 'base-model')
    expect(baseModel).toBeTruthy()
    expect(baseModel!.required).toBe(true)
    expect(baseModel!.anyOf).toBe(true)
    expect(baseModel!.keys).toEqual(['pretrained_model_name_or_path'])

    const missingBase = empty.missing.find((item) => item.group.id === 'base-model')
    expect(missingBase).toBeTruthy()
    expect(missingBase!.keys).toEqual(['pretrained_model_name_or_path'])
    expect(missingBase!.group.keys).toEqual(['pretrained_model_name_or_path'])

    // anyOf: filling ANY one of the group keys clears missing for that group.
    const filled = resolveTrainingInputs('sdxl-lora', { pretrained_model_name_or_path: '/models/sdxl.safetensors' })
    expect(filled.missing.some((item) => item.group.id === 'base-model')).toBe(false)
  })

  test('newbie-lora: base model required, transformer_path NOT required', () => {
    const baseGroup = resolveTrainingInputs('newbie-lora', {}).model.find((group) => group.id === 'base-model')
    expect(baseGroup).toBeTruthy()
    expect(baseGroup!.required).toBe(true)
    // base_model_path / transformer_path are not the available base key for this type.
    expect(baseGroup!.keys).toContain('pretrained_model_name_or_path')
    expect(baseGroup!.keys).not.toContain('transformer_path')
    expect(baseGroup!.keys).not.toContain('base_model_path')

    const missingBase = resolveTrainingInputs('newbie-lora', {}).missing.find((item) => item.group.id === 'base-model')
    expect(missingBase!.keys).toEqual(['pretrained_model_name_or_path'])
    expect(missingBase!.group.keys).toEqual(['pretrained_model_name_or_path'])

    // Filling the base key alone clears the model requirement; transformer_path stays empty and is not required.
    const filledBase = resolveTrainingInputs('newbie-lora', { pretrained_model_name_or_path: '/models/newbie' })
    expect(filledBase.missing.some((item) => item.group.id === 'base-model')).toBe(false)
  })

  test('yolo: train_data_dir required; yolo_data_config_path optional', () => {
    const resolution = resolveTrainingInputs('yolo', {})
    const dataGroup = resolution.dataset.find((group) => group.id === 'yolo-data')
    const configGroup = resolution.dataset.find((group) => group.id === 'yolo-config')
    expect(dataGroup).toBeTruthy()
    expect(dataGroup!.required).toBe(true)
    expect(dataGroup!.keys).toEqual(['train_data_dir'])
    expect(configGroup).toBeTruthy()
    expect(configGroup!.required).toBe(false)
    expect(configGroup!.keys).toEqual(['yolo_data_config_path'])

    const missingData = resolution.missing.find((item) => item.group.id === 'yolo-data')
    expect(missingData!.keys).toEqual(['train_data_dir'])
    expect(missingData!.group.keys).toEqual(['train_data_dir'])

    // Filling only train_data_dir clears the yolo-data requirement; the optional config never shows as missing.
    const filled = resolveTrainingInputs('yolo', { train_data_dir: '/data/images' })
    const missingIds = filled.missing.map((item) => item.group.id)
    expect(missingIds).not.toContain('yolo-data')
    expect(missingIds).not.toContain('yolo-config')
  })

  test('aesthetic-scorer: annotations required; image_root optional', () => {
    const resolution = resolveTrainingInputs('aesthetic-scorer', {})
    const annotationsGroup = resolution.dataset.find((group) => group.id === 'scorer-annotations')
    const imagesGroup = resolution.dataset.find((group) => group.id === 'scorer-images')
    expect(annotationsGroup).toBeTruthy()
    expect(annotationsGroup!.required).toBe(true)
    expect(annotationsGroup!.keys).toEqual(['annotations'])
    expect(imagesGroup).toBeTruthy()
    expect(imagesGroup!.required).toBe(false)
    expect(imagesGroup!.keys).toEqual(['image_root'])

    const missingAnnotations = resolution.missing.find((item) => item.group.id === 'scorer-annotations')
    expect(missingAnnotations!.keys).toEqual(['annotations'])
    expect(missingAnnotations!.group.keys).toEqual(['annotations'])

    // annotations filled, image_root empty -> annotations requirement satisfied, image_root never required.
    const filled = resolveTrainingInputs('aesthetic-scorer', { annotations: '/data/annotations.jsonl' })
    const missingIds = filled.missing.map((item) => item.group.id)
    expect(missingIds).not.toContain('scorer-annotations')
    expect(missingIds).not.toContain('scorer-images')
  })

  test.each([
    ['anima-few-step-lora', 'base_model_path'],
    ['newbie-few-step-lora', 'base_model_path'],
  ])('%s: base_model_path required; teacher_adapter_path optional', (typeId, baseKey) => {
    const resolution = resolveTrainingInputs(typeId, {})
    const baseGroup = resolution.model.find((group) => group.id === 'fewstep-base')
    const teacherGroup = resolution.model.find((group) => group.id === 'fewstep-teacher')
    expect(baseGroup).toBeTruthy()
    expect(baseGroup!.required).toBe(true)
    expect(baseGroup!.keys).toEqual([baseKey])
    expect(teacherGroup).toBeTruthy()
    expect(teacherGroup!.required).toBe(false)
    expect(teacherGroup!.keys).toEqual(['teacher_adapter_path'])

    const missingBase = resolution.missing.find((item) => item.group.id === 'fewstep-base')
    expect(missingBase!.keys).toEqual([baseKey])
    expect(missingBase!.group.keys).toEqual([baseKey])

    // Filling base alone -> no model missing (teacher optional and empty).
    const filled = resolveTrainingInputs(typeId, { [baseKey]: '/models/base' })
    expect(filled.missing.some((item) => item.group.id === 'fewstep-base')).toBe(false)
    expect(filled.missing.some((item) => item.group.id === 'fewstep-teacher')).toBe(false)
  })

  test('lab-distiller: unet_path required; teacher group optional', () => {
    const resolution = resolveTrainingInputs('lab-distiller', {})
    const unetGroup = resolution.model.find((group) => group.id === 'distiller-unet')
    const teacherGroup = resolution.model.find((group) => group.id === 'distiller-teacher')
    expect(unetGroup).toBeTruthy()
    expect(unetGroup!.required).toBe(true)
    expect(unetGroup!.keys).toEqual(['unet_path'])
    expect(teacherGroup).toBeTruthy()
    expect(teacherGroup!.required).toBe(false)
    expect(teacherGroup!.anyOf).toBe(true)
    expect(teacherGroup!.keys).toEqual(expect.arrayContaining(['teacher_path', 'lora_path', 'llm_path']))

    const missingUnet = resolution.missing.find((item) => item.group.id === 'distiller-unet')
    expect(missingUnet!.keys).toEqual(['unet_path'])
    expect(missingUnet!.group.keys).toEqual(['unet_path'])

    // Filling unet_path alone -> no model missing; teacher left empty is fine.
    const filled = resolveTrainingInputs('lab-distiller', { unet_path: '/models/unet' })
    const missingIds = filled.missing.map((item) => item.group.id)
    expect(missingIds).not.toContain('distiller-unet')
    expect(missingIds).not.toContain('distiller-teacher')
  })

  test('minimax-h3-lora: h3_transformer_path required', () => {
    const resolution = resolveTrainingInputs('minimax-h3-lora', {})
    const h3Group = resolution.model.find((group) => group.id === 'h3-transformer')
    expect(h3Group).toBeTruthy()
    expect(h3Group!.required).toBe(true)
    expect(h3Group!.keys).toEqual(['h3_transformer_path'])

    const missingH3 = resolution.missing.find((item) => item.group.id === 'h3-transformer')
    expect(missingH3!.keys).toEqual(['h3_transformer_path'])
    expect(missingH3!.group.keys).toEqual(['h3_transformer_path'])

    const filled = resolveTrainingInputs('minimax-h3-lora', { h3_transformer_path: '/models/h3' })
    expect(filled.missing.some((item) => item.group.id === 'h3-transformer')).toBe(false)
  })
})
