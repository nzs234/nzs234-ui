// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TURBOCORE_OVERRIDE_KEYS, useTurboCoreGlobal } from './useTurboCoreGlobal'
import { turbocoreApi } from '@/api/turbocoreApi'

vi.mock('@/api/turbocoreApi', () => ({
  turbocoreApi: {
    status: vi.fn(),
  },
}))

const statusMock = vi.mocked(turbocoreApi.status)

describe('useTurboCoreGlobal', () => {
  beforeEach(() => {
    statusMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reports enabled=true when the backend global toggle is on', async () => {
    statusMock.mockResolvedValue({ enabled: true })
    const { result } = renderHook(() => useTurboCoreGlobal())
    await waitFor(() => expect(result.current.unknown).toBe(false))
    expect(result.current.enabled).toBe(true)
  })

  it('treats a missing endpoint as unknown/off (no false override warnings)', async () => {
    statusMock.mockRejectedValue(new Error('404'))
    const { result } = renderHook(() => useTurboCoreGlobal())
    await waitFor(() => expect(result.current.unknown).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('never claims authority when the payload is malformed', async () => {
    statusMock.mockResolvedValue({} as Record<string, never>)
    const { result } = renderHook(() => useTurboCoreGlobal())
    await waitFor(() => expect(result.current.unknown).toBe(false))
    expect(result.current.enabled).toBe(false)
  })
})

describe('TURBOCORE_OVERRIDE_KEYS', () => {
  it('covers exactly the three run keys entry_train overwrites from the global state', () => {
    expect([...TURBOCORE_OVERRIDE_KEYS].sort()).toEqual(
      ['execution_core', 'optimizer_backend', 'turbocore_enabled'].sort(),
    )
  })
})
