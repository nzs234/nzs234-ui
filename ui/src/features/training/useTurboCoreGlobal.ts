// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { useEffect, useState } from 'react'
import { turbocoreApi } from '@/api/turbocoreApi'

/**
 * 全局 TurboCore 开关状态（顶栏偏好，同一状态文件被 entry_train 在启动时消费）。
 *
 * 后端事实：entry_train.py:508 无条件用全局状态覆写每个 run 的
 * execution_core / turbocore_enabled / optimizer_backend——run 级配置在这三项上
 * 没有权威。UI 只能在受影响字段上加覆盖警示（disabledReason 同款 note）。
 *
 * 状态未知（后端旧版本无 /api/turbocore/status、断连、非 JSON）按「未开启」处理，
 * 不制造假警报；但 unknown=true 时调用方不得宣称「一定不会覆盖」。
 */
export interface TurboCoreGlobalState {
  /** 全局开关处于开启态（经 HTTP 直读确认）。 */
  enabled: boolean
  /** 无法读取状态（端点缺失/断连）。 */
  unknown: boolean
}

const INITIAL: TurboCoreGlobalState = { enabled: false, unknown: true }
let cached: TurboCoreGlobalState | null = null

export function useTurboCoreGlobal(): TurboCoreGlobalState {
  const [state, setState] = useState<TurboCoreGlobalState>(cached ?? INITIAL)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await turbocoreApi.status()
        if (cancelled) return
        cached = { enabled: status?.enabled === true, unknown: false }
      } catch {
        if (cancelled) return
        cached = { enabled: false, unknown: true }
      }
      setState(cached)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/**
 * 全局开启时会被覆写的 run 配置键。
 * 覆写逻辑在 entry_train.apply_global_turbocore_state（三键强写，CLI 参数除外）。
 */
export const TURBOCORE_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  'turbocore_enabled',
  'execution_core',
  'optimizer_backend',
])
