// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * pathExistsCheck save-target 逻辑 + 工具函数单测(node 友好,无 DOM)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkPathExists: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({
  trainApi: { checkPathExists: mocks.checkPathExists },
}))

import { checkPathStatus, isSaveTargetField, parentDirOf } from './pathExistsCheck'

describe('isSaveTargetField', () => {
  it('flags output-model-file picker fields', () => {
    expect(isSaveTargetField({ type: 'file', key: 'network_weights', pickerType: 'output-model-file' })).toBe(true)
  })
  it('flags keys ending with output_path', () => {
    expect(isSaveTargetField({ type: 'string', key: 'compression_companion_bootstrap_output_path' })).toBe(true)
  })
  it('flags output_dir', () => {
    expect(isSaveTargetField({ type: 'folder', key: 'output_dir', pickerType: 'folder' })).toBe(true)
  })
  it('does not flag regular model-file / folder fields', () => {
    expect(isSaveTargetField({ type: 'file', key: 'pretrained_model_name_or_path', pickerType: 'model-file' })).toBe(false)
    expect(isSaveTargetField({ type: 'folder', key: 'train_data_dir', pickerType: 'folder' })).toBe(false)
    expect(isSaveTargetField(null)).toBe(false)
    expect(isSaveTargetField(undefined)).toBe(false)
  })
})

describe('parentDirOf', () => {
  it('splits posix path', () => {
    expect(parentDirOf('D:/out/model.safetensors')).toBe('D:/out')
  })
  it('splits windows path', () => {
    expect(parentDirOf('C:\\a\\b\\file.txt')).toBe('C:\\a\\b')
  })
  it('strips trailing slashes', () => {
    expect(parentDirOf('D:/out/')).toBe('D:/')
  })
  it('falls back to root', () => {
    expect(parentDirOf('model.safetensors')).toBe('/')
  })
})

describe('checkPathStatus save-target semantics', () => {
  beforeEach(() => {
    mocks.checkPathExists.mockReset()
  })

  it('ok + create-file hint when parent directory exists', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: true, type: 'dir' })
    const r = await checkPathStatus('D:/out/foo.safetensors', {
      type: 'file',
      key: 'network_weights',
      pickerType: 'output-model-file',
      defaultValue: '',
    })
    expect(r.status).toBe('ok')
    expect(r.message).toContain('将在该目录创建输出文件')
    expect(mocks.checkPathExists).toHaveBeenCalledWith('D:/out')
  })

  it('missing when parent directory does not exist', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: false })
    const r = await checkPathStatus('D:/nowhere/foo.safetensors', {
      type: 'file',
      key: 'network_weights',
      pickerType: 'output-model-file',
      defaultValue: '',
    })
    expect(r.status).toBe('missing')
  })

  it('missing when parent exists as a file', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: true, type: 'file' })
    const r = await checkPathStatus('D:/notadir/foo.safetensors', {
      type: 'file',
      key: 'output_path',
      pickerType: 'output-model-file',
      defaultValue: '',
    })
    expect(r.status).toBe('missing')
  })
})

describe('checkPathStatus non-save-target semantics', () => {
  beforeEach(() => {
    mocks.checkPathExists.mockReset()
  })

  it('ok for an existing model file', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: true, type: 'file' })
    const r = await checkPathStatus('D:/models/model.safetensors', {
      type: 'file',
      key: 'pretrained_model_name_or_path',
      pickerType: 'model-file',
      defaultValue: '',
    })
    expect(r.status).toBe('ok')
    expect(r.message).toBe('')
    expect(mocks.checkPathExists).toHaveBeenCalledWith('D:/models/model.safetensors')
  })

  it('type_mismatch when a folder is expected but a file is given (allowModelDirectory)', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: true, type: 'file' })
    const r = await checkPathStatus('D:/qwen3', {
      type: 'file',
      key: 'qwen3',
      pickerType: 'model-file',
      allowModelDirectory: true,
      defaultValue: '',
    })
    expect(r.status).toBe('type_mismatch')
  })

  it('ok when allowModelDirectory points at an existing directory', async () => {
    mocks.checkPathExists.mockResolvedValue({ exists: true, type: 'dir' })
    const r = await checkPathStatus('D:/qwen3-dir', {
      type: 'file',
      key: 'qwen3',
      pickerType: 'model-file',
      allowModelDirectory: true,
      defaultValue: '',
    })
    expect(r.status).toBe('ok')
  })

  it('idle for empty or placeholder-default paths', async () => {
    const r = await checkPathStatus('', { type: 'file', key: 'x' })
    expect(r.status).toBe('idle')
    expect(mocks.checkPathExists).not.toHaveBeenCalled()
  })
})
