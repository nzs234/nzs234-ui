// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 输出目录同名冲突预检。
 *
 * 这层是「启动前是否弹覆盖确认」的唯一判据。漏判 = 用户的上一个 LoRA 被静默覆盖
 * (不可逆)；误判 = 每次启动都白弹一次确认框。后端字段有三种表达冲突的方式
 * (conflict / exists / existing_files)，任一为真都必须算冲突。
 *
 * 模块级缓存(12s TTL)是共享状态：每个用例用独立的 dir/name，避免相互命中。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkOutputConflict: vi.fn(),
}))

vi.mock('@/api/trainApi', () => ({
  trainApi: { checkOutputConflict: mocks.checkOutputConflict },
}))

const { checkOutputConflictStatus, shouldCheckOutputConflict } = await import('./outputConflictCheck')
const { useLocaleStore } = await import('@/stores/localeStore')

/** 缓存按 `${dir}::${name}` 建键；每个用例换 dir 就等于换缓存槽。 */
let dirSeq = 0
function freshDir() {
  dirSeq += 1
  return `D:/out/case-${dirSeq}-${Math.random().toString(36).slice(2)}`
}

beforeEach(() => {
  vi.clearAllMocks()
  useLocaleStore.setState({ language: 'zh' })
})

// ─── shouldCheckOutputConflict ───────────────────────────────────────────────

describe('outputConflictCheck: shouldCheckOutputConflict', () => {
  test('dir 与 name 都非空才值得发请求', () => {
    expect(shouldCheckOutputConflict('D:/out', 'my-lora')).toBe(true)
  })

  test('任一为空/空白/nullish 都不发请求', () => {
    expect(shouldCheckOutputConflict('', 'my-lora')).toBe(false)
    expect(shouldCheckOutputConflict('D:/out', '')).toBe(false)
    expect(shouldCheckOutputConflict('   ', 'my-lora')).toBe(false)
    expect(shouldCheckOutputConflict('D:/out', '   ')).toBe(false)
    expect(shouldCheckOutputConflict(null, undefined)).toBe(false)
  })

  test('非字符串输入按字符串化后判定', () => {
    expect(shouldCheckOutputConflict(0, 1)).toBe(true)
  })
})

// ─── 无需请求的短路 ─────────────────────────────────────────────────────────

describe('outputConflictCheck: 空输入短路', () => {
  test('dir 或 name 为空时直接返回"无冲突"且不调后端', async () => {
    for (const [dir, name] of [['', 'n'], ['d', ''], ['  ', '  ']]) {
      await expect(checkOutputConflictStatus(dir, name)).resolves.toEqual({
        conflict: false,
        message: '',
        existing: [],
      })
    }
    expect(mocks.checkOutputConflict).not.toHaveBeenCalled()
  })
})

// ─── 冲突判定 ───────────────────────────────────────────────────────────────

describe('outputConflictCheck: 后端字段 → conflict', () => {
  test('conflict:true 判冲突，并 trim 后透传给后端', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    const dir = freshDir()
    const result = await checkOutputConflictStatus(`  ${dir}  `, '  my-lora  ')
    expect(result.conflict).toBe(true)
    expect(mocks.checkOutputConflict).toHaveBeenCalledWith(dir, 'my-lora')
  })

  test('exists:true 同样判冲突（后端两套字段名并存）', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ exists: true })
    expect((await checkOutputConflictStatus(freshDir(), 'n')).conflict).toBe(true)
  })

  test('只有 existing_files 非空也判冲突，并转成字符串数组', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ existing_files: ['a.safetensors', 1] })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.conflict).toBe(true)
    expect(result.existing).toEqual(['a.safetensors', '1'])
  })

  test('布尔字段必须严格为 true：字符串 "true" 不算冲突', async () => {
    // 宽松判定会让每次启动都弹确认框；这里保持 fail-open 而非 fail-closed 是
    // 因为下游还有真正的覆盖保护，误弹的代价是每次训练都被打断。
    mocks.checkOutputConflict.mockResolvedValue({ conflict: 'true', exists: 1 })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result).toEqual({ conflict: false, message: '', existing: [] })
  })

  test('existing_files 不是数组时退化为空数组', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true, existing_files: 'a.safetensors' })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.conflict).toBe(true)
    expect(result.existing).toEqual([])
  })

  test('空数组 existing_files + 无冲突标记 → 无冲突且无文案', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ existing_files: [] })
    expect(await checkOutputConflictStatus(freshDir(), 'n')).toEqual({
      conflict: false,
      message: '',
      existing: [],
    })
  })

  test('信封响应经 unwrap 拆包后判定', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ status: 'success', data: { conflict: true } })
    expect((await checkOutputConflictStatus(freshDir(), 'n')).conflict).toBe(true)
  })

  test('响应不是对象时按无冲突处理，不抛', async () => {
    mocks.checkOutputConflict.mockResolvedValue(null)
    expect(await checkOutputConflictStatus(freshDir(), 'n')).toEqual({
      conflict: false,
      message: '',
      existing: [],
    })
  })
})

// ─── 文案 ───────────────────────────────────────────────────────────────────

describe('outputConflictCheck: message 组装', () => {
  test('后端给了 message 就原样用', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true, message: '后端自定义提示' })
    expect((await checkOutputConflictStatus(freshDir(), 'n')).message).toBe('后端自定义提示')
  })

  test('后端 message 为空串时回落到本地文案', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true, message: '' })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.message).not.toBe('')
    expect(result.message).toContain('已存在同名产物')
  })

  test('本地文案把命中的文件名列进括号', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ existing_files: ['a.safetensors', 'b.safetensors'] })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.message).toContain('(a.safetensors, b.safetensors)')
  })

  test('没有文件名时括号整段省略，不留空 ()', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.message).not.toContain('(')
  })

  test('EN 语言下走英文文案', async () => {
    useLocaleStore.setState({ language: 'en' })
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    const result = await checkOutputConflictStatus(freshDir(), 'n')
    expect(result.message).toContain('Output dir already has artifacts')
  })
})

// ─── 失败与缓存 ─────────────────────────────────────────────────────────────

describe('outputConflictCheck: 失败与缓存', () => {
  test('后端失败时按无冲突返回，不阻塞启动', async () => {
    mocks.checkOutputConflict.mockRejectedValue(new Error('backend down'))
    await expect(checkOutputConflictStatus(freshDir(), 'n')).resolves.toEqual({
      conflict: false,
      message: '',
      existing: [],
    })
  })

  test('业务错误信封被 unwrap 抛出后同样降级', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ status: 'error', message: 'nope' })
    await expect(checkOutputConflictStatus(freshDir(), 'n')).resolves.toMatchObject({ conflict: false })
  })

  test('同一 dir/name 在 TTL 内只请求一次', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    const dir = freshDir()
    const first = await checkOutputConflictStatus(dir, 'n')
    const second = await checkOutputConflictStatus(dir, 'n')
    // 命中缓存时连结果对象都是同一个引用。
    expect(second).toBe(first)
    expect(mocks.checkOutputConflict).toHaveBeenCalledTimes(1)
  })

  test('缓存键含 name：换名字要重新问后端', async () => {
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    const dir = freshDir()
    await checkOutputConflictStatus(dir, 'a')
    await checkOutputConflictStatus(dir, 'b')
    expect(mocks.checkOutputConflict).toHaveBeenCalledTimes(2)
  })

  test('失败结果不进缓存：下一次仍会重试', async () => {
    const dir = freshDir()
    mocks.checkOutputConflict.mockRejectedValueOnce(new Error('down'))
    await checkOutputConflictStatus(dir, 'n')
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    expect((await checkOutputConflictStatus(dir, 'n')).conflict).toBe(true)
    expect(mocks.checkOutputConflict).toHaveBeenCalledTimes(2)
  })

  test('TTL 过期后重新请求', async () => {
    const dir = freshDir()
    mocks.checkOutputConflict.mockResolvedValue({ conflict: true })
    await checkOutputConflictStatus(dir, 'n')
    // 12s TTL：把 Date.now 往后推 13s 而不是真的等。
    const nowSpy = vi.spyOn(Date, 'now')
    try {
      nowSpy.mockReturnValue(Date.now() + 13_000)
      await checkOutputConflictStatus(dir, 'n')
    } finally {
      nowSpy.mockRestore()
    }
    expect(mocks.checkOutputConflict).toHaveBeenCalledTimes(2)
  })
})
