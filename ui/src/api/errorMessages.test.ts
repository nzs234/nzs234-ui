// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 错误码→i18n 映射层契约门禁。
 *
 * 后端错误面是双轨的(见 errorMessages.ts 顶部注释):/train/** 的平台 issue 带
 * 稳定 code,/api/** 信封与多数 HTTPException 只有原文。这里的断言钉住两级回退:
 * 已知码给双语文案;未知码按界面语言处理原文且绝不让信息丢失(raw/detail 恒保留)。
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  API_ERROR_CODE_KEYS,
  API_ERROR_STATUS_KEYS,
  classifyHttpStatus,
  composeApiErrorMessage,
  describeApiError,
  extractApiErrorCode,
  textHasCjk,
} from './errorMessages'
import { useLocaleStore } from '@/stores/localeStore'
import en from '@/i18n/en.json'
import zh from '@/i18n/zh.json'

function setLanguage(language: 'zh' | 'en') {
  useLocaleStore.setState({ language })
}

beforeEach(() => setLanguage('zh'))

afterEach(() => setLanguage('zh'))

// ─── extractApiErrorCode ─────────────────────────────────────────────────────

describe('extractApiErrorCode', () => {
  test('reads the compat envelope top-level code', () => {
    expect(extractApiErrorCode({ status: 'error', code: 'E_X', message: 'm' })).toBe('E_X')
  })

  test('reads /train platform-issue shapes: detail.code then detail.issue.code', () => {
    expect(extractApiErrorCode({ detail: { message: 'm', code: 'config.invalid' } })).toBe('config.invalid')
    expect(
      extractApiErrorCode({ detail: { message: 'm', code: '', issue: { code: 'request.invalid' } } }),
    ).toBe('request.invalid')
  })

  test('empty/absent/numeric/array codes yield "" instead of lying', () => {
    expect(extractApiErrorCode(null)).toBe('')
    expect(extractApiErrorCode('plain')).toBe('')
    expect(extractApiErrorCode({})).toBe('')
    expect(extractApiErrorCode({ code: '   ' })).toBe('')
    // FastAPI 校验错的 detail 是数组,不存在稳定码。
    expect(extractApiErrorCode({ detail: [{ msg: 'bad' }] })).toBe('')
    expect(extractApiErrorCode({ code: 500 })).toBe('')
  })
})

// ─── classifyHttpStatus ──────────────────────────────────────────────────────

describe('classifyHttpStatus', () => {
  test('maps every supported category', () => {
    expect(classifyHttpStatus(undefined)).toBe('')
    expect(classifyHttpStatus(Number.NaN)).toBe('')
    expect(classifyHttpStatus(401)).toBe('unauthorized')
    expect(classifyHttpStatus(403)).toBe('forbidden')
    expect(classifyHttpStatus(404)).toBe('not_found')
    expect(classifyHttpStatus(409)).toBe('conflict')
    expect(classifyHttpStatus(400)).toBe('validation')
    expect(classifyHttpStatus(422)).toBe('validation')
    expect(classifyHttpStatus(429)).toBe('rate_limited')
    expect(classifyHttpStatus(500)).toBe('server')
    expect(classifyHttpStatus(503)).toBe('server')
  })

  test('leaves unclassifiable statuses unmapped', () => {
    // 2xx/3xx 不该出现在错误路径上;405 这类冷门态没有专门文案,宁缺毋滥。
    expect(classifyHttpStatus(200)).toBe('')
    expect(classifyHttpStatus(304)).toBe('')
    expect(classifyHttpStatus(405)).toBe('')
    expect(classifyHttpStatus(418)).toBe('')
    expect(classifyHttpStatus(600)).toBe('')
  })

  test('every classified status resolves to a non-empty bundle key in both languages', () => {
    const statuses = [401, 403, 404, 409, 429, 400, 422, 500]
    for (const status of statuses) {
      const key = API_ERROR_STATUS_KEYS[classifyHttpStatus(status) as keyof typeof API_ERROR_STATUS_KEYS]
      expect(zh[key as keyof typeof zh], `zh missing ${key}`).toBeTruthy()
      expect(en[key as keyof typeof en], `en missing ${key}`).toBeTruthy()
    }
  })
})

// ─── textHasCjk ──────────────────────────────────────────────────────────────

describe('textHasCjk', () => {
  test('detects CJK but not ASCII/punctuation-only text', () => {
    expect(textHasCjk('显存不足')).toBe(true)
    expect(textHasCjk('failed: 配置文件损坏')).toBe(true)
    expect(textHasCjk('Job not found')).toBe(false)
    expect(textHasCjk('···?!')).toBe(false)
    expect(textHasCjk('')).toBe(false)
  })
})

// ─── composeApiErrorMessage ──────────────────────────────────────────────────

describe('composeApiErrorMessage: known codes are bilingual', () => {
  test.each(Object.entries(API_ERROR_CODE_KEYS))('%s maps to %s in zh', (code, key) => {
    setLanguage('zh')
    const composed = composeApiErrorMessage(`后端原文:${code}`, { detail: { message: `后端原文:${code}`, code } }, 400)
    expect(composed.message).toBe(zh[key as keyof typeof zh])
    expect(composed.code).toBe(code)
    expect(composed.raw).toBe(`后端原文:${code}`)
    expect(composed.detail).toBe('')
  })

  test.each(Object.entries(API_ERROR_CODE_KEYS))('%s maps to %s in en', (code, key) => {
    setLanguage('en')
    // 即使后端原文是中文,已知码也必须给出英文主行;
    // 原文进 raw 供上报与次要展示,不丢信息。
    const composed = composeApiErrorMessage(`中文原文 ${code}`, { detail: { message: `中文原文 ${code}`, code } }, 400)
    expect(composed.message).toBe(en[key as keyof typeof en])
    expect(composed.message).not.toMatch(/[\u4e00-\u9fff]/)
    expect(composed.raw).toBe(`中文原文 ${code}`)
  })

  test('compat default code "error" is treated as unknown, never mapped', () => {
    const composed = composeApiErrorMessage('业务失败', { status: 'error', code: 'error', message: '业务失败' }, 200)
    expect(composed.message).toBe('业务失败')
    expect(composed.code).toBe('error')
  })
})

describe('composeApiErrorMessage: unknown-code fallback', () => {
  test('zh shows the backend raw directly (it is already the right language)', () => {
    const composed = composeApiErrorMessage('配置文件损坏', { status: 'error', message: '配置文件损坏' }, 200)
    expect(composed.message).toBe('配置文件损坏')
    expect(composed.detail).toBe('')
  })

  test('en passes through readable non-CJK raw unchanged', () => {
    setLanguage('en')
    const composed = composeApiErrorMessage('Job not found', { detail: 'Job not found' }, 404)
    expect(composed.message).toBe('Job not found')
    expect(composed.detail).toBe('')
  })

  test('en with CJK-only raw falls back to the status-class generic + keeps raw as detail', () => {
    setLanguage('en')
    const composed = composeApiErrorMessage('任务不存在', { detail: '任务不存在' }, 404)
    expect(composed.message).toBe(en[API_ERROR_STATUS_KEYS.not_found as keyof typeof en])
    expect(composed.detail).toBe('任务不存在')
    expect(composed.raw).toBe('任务不存在')
  })

  test('en with CJK raw on an unclassifiable status uses request_fail as the main line', () => {
    setLanguage('en')
    const composed = composeApiErrorMessage('导入格式不支持', { status: 'error', message: '导入格式不支持' }, 200)
    expect(composed.message).toBe('Request failed:200')
    expect(composed.detail).toBe('导入格式不支持')
  })

  test('an empty raw yields an empty message for the caller fallback chain', () => {
    const composed = composeApiErrorMessage('', {}, 503)
    expect(composed.message).toBe('')
    expect(composed.detail).toBe('')
  })
})

// ─── describeApiError ────────────────────────────────────────────────────────

describe('describeApiError', () => {
  test('non-Error values degrade to their string form without throwing', () => {
    expect(describeApiError(null)).toEqual({ text: '' })
    expect(describeApiError(42).text).toBe('42')
    expect(describeApiError({ odd: true }).text).toBe('[object Object]')
  })

  test('plain Errors pass through their own message with no detail', () => {
    expect(describeApiError(new Error('boom'))).toEqual({ text: 'boom' })
  })

  test('transport-shaped errors surface the primary line plus retained secondary detail', () => {
    setLanguage('en')
    const error = new ApiErrorShape('Task not found', '任务不存在')
    const resolved = describeApiError(error)
    expect(resolved.text).toBe('Task not found')
    expect(resolved.detail).toBe('任务不存在')
  })

  test('an empty secondary line is dropped rather than shown as blank', () => {
    const error = new ApiErrorShape('配置无效', '')
    expect(describeApiError(error)).toEqual({ text: '配置无效', detail: undefined })
  })
})

/** 与 ApiError 形状一致的最小替身(errorMessages 不 import transport,避免循环)。 */
class ApiErrorShape extends Error {
  code = ''
  rawMessage: string
  detail: string
  constructor(message: string, detail: string) {
    super(message)
    this.rawMessage = message
    this.detail = detail
  }
}
