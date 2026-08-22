// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { describe, expect, it } from 'vitest'
import { parseSavedConfigImport, pickImportTypeId } from '@/lib/savedConfigIo'

describe('savedConfigIo', () => {
  it('parseSavedConfigImport surfaces schema_id/typeId from a bundle', () => {
    const bundle = parseSavedConfigImport(
      JSON.stringify({ name: 'legacy-sdxl', schema_id: 'sdxl-ileco', config: { output_name: 'x' } }),
    )
    expect(bundle.name).toBe('legacy-sdxl')
    expect(bundle.schema_id).toBe('sdxl-ileco')
    expect(bundle.typeId).toBe('sdxl-ileco')
    expect(bundle.config).toEqual({ output_name: 'x' })
  })

  it('parseSavedConfigImport falls back across schemaId/typeId/type_id variants', () => {
    expect(parseSavedConfigImport(JSON.stringify({ typeId: 'anima-addift', config: { a: 1 } })).schema_id)
      .toBe('anima-addift')
    expect(parseSavedConfigImport(JSON.stringify({ schemaId: 'lumina-lora', config: { a: 1 } })).typeId)
      .toBe('lumina-lora')
    expect(parseSavedConfigImport(JSON.stringify({ type_id: 'qwen-image-lora', config: { a: 1 } })).schema_id)
      .toBe('qwen-image-lora')
  })

  it('pickImportTypeId resolves hidden registered ids', () => {
    expect(pickImportTypeId({ schema_id: 'sdxl-ileco' })).toBe('sdxl-ileco')
    expect(pickImportTypeId({ schema_id: 'anima-addift', typeId: 'anima-addift' })).toBe('anima-addift')
    expect(pickImportTypeId({})).toBeNull()
    expect(pickImportTypeId({ schema_id: '' })).toBeNull()
  })

  it('pickImportTypeId returns null for unknown ids', () => {
    expect(pickImportTypeId({ schema_id: 'totally-unknown' })).toBeNull()
    expect(pickImportTypeId({ typeId: 'totally-unknown' })).toBeNull()
  })

  it('pickImportTypeId returns the id for disabled-but-registered ids (blocking happens at restorable/launch)', () => {
    expect(pickImportTypeId({ schema_id: 'concept-edit' })).toBe('concept-edit')
  })
})