// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SAVED_CONFIG_IO_MAX_BYTES,
  buildExportBundle,
  downloadJsonFile,
  exportBundleToDownload,
  parseSavedConfigImport,
  pickImportTypeId,
  readFileAsSavedBundle,
  safeFileStem,
} from '@/lib/savedConfigIo'
import { useLocaleStore } from '@/stores/localeStore'

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

/* ------------------------------------------------------------------ *
 * 以下为文件名净化 / 导出 bundle / 导入解析分支 / File 读取的行为覆盖。
 * 这条链是「预设导出 → 用户传给别人 → 别人导入」的全程,任一环静默走歪都会
 * 让对方拿到一份缺字段或张冠李戴的配置,而不会报错。
 * ------------------------------------------------------------------ */

describe('savedConfigIo: safeFileStem', () => {
  it('保留常规名字', () => {
    expect(safeFileStem('my-preset')).toBe('my-preset')
  })

  it('Windows 非法字符替换成下划线并折叠连续下划线', () => {
    expect(safeFileStem('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(safeFileStem('a<<>>b')).toBe('a_b')
  })

  it('空格折叠成单个连字符', () => {
    expect(safeFileStem('my   cool preset')).toBe('my-cool-preset')
  })

  it('控制字符（含制表/换行）换成下划线，先于空白规则命中', () => {
    // code < 32 的判断排在 /\s/ 前面，所以 \t \n 走下划线而不是连字符。
    expect(safeFileStem('a\u0001b')).toBe('a_b')
    expect(safeFileStem('tab\there')).toBe('tab_here')
    expect(safeFileStem('line\nbreak')).toBe('line_break')
  })

  it('连续连字符折叠为一个', () => {
    expect(safeFileStem('a---b')).toBe('a-b')
  })

  it('截断到 80 字符', () => {
    expect(safeFileStem('x'.repeat(200))).toHaveLength(80)
  })

  it('空 / 空白 / nullish 落到 preset', () => {
    expect(safeFileStem('')).toBe('preset')
    expect(safeFileStem('   ')).toBe('preset')
    expect(safeFileStem(null as unknown as string)).toBe('preset')
  })

  it('CJK 与 emoji 原样保留（文件系统允许）', () => {
    expect(safeFileStem('预设一号')).toBe('预设一号')
  })
})

describe('savedConfigIo: buildExportBundle', () => {
  it('带上 schema_id/typeId 与来源标记', () => {
    const bundle = buildExportBundle({ name: 'p1', config: { a: 1 }, schemaId: 'sdxl-lora' })
    expect(bundle).toMatchObject({
      name: 'p1',
      schema_id: 'sdxl-lora',
      typeId: 'sdxl-lora',
      source: 'lulynx-webui',
    })
    expect(typeof bundle.exported_at).toBe('number')
  })

  it('config 是浅拷贝：后续改动原对象不污染 bundle', () => {
    const config: Record<string, unknown> = { a: 1 }
    const bundle = buildExportBundle({ name: 'p1', config })
    config.a = 2
    expect(bundle.config).toEqual({ a: 1 })
  })

  it('名字为空/空白时落到 preset；缺 schemaId 时两个类型字段都是 undefined', () => {
    expect(buildExportBundle({ name: '   ', config: {} }).name).toBe('preset')
    const bundle = buildExportBundle({ name: 'p', config: {} })
    expect(bundle.schema_id).toBeUndefined()
    expect(bundle.typeId).toBeUndefined()
  })

  it('名字两侧空白被 trim', () => {
    expect(buildExportBundle({ name: '  p1  ', config: {} }).name).toBe('p1')
  })

  it('config 为 nullish 时退化成空对象', () => {
    expect(buildExportBundle({ name: 'p', config: null as unknown as Record<string, unknown> }).config).toEqual({})
  })
})

describe('savedConfigIo: downloadJsonFile / exportBundleToDownload', () => {
  let createdUrls: string[]
  let revoked: string[]
  let clicked: HTMLAnchorElement[]

  beforeEach(() => {
    vi.useFakeTimers()
    createdUrls = []
    revoked = []
    clicked = []
    // jsdom 不实现 createObjectURL；这里同时用它记录调用序列。
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        const url = `blob:mock-${createdUrls.length}`
        createdUrls.push(url)
        return url
      }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn((url: string) => revoked.push(url)),
    })
    // jsdom 的 a.click() 会走导航告警；拦下来只观察调用。
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('缺 .json 后缀时自动补上，且点击后立即从 DOM 摘除', () => {
    downloadJsonFile('preset', { a: 1 })
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('preset.json')
    expect(clicked[0].rel).toBe('noopener')
    expect(document.body.contains(clicked[0])).toBe(false)
  })

  it('已有 .json 后缀不重复追加', () => {
    downloadJsonFile('preset.json', { a: 1 })
    expect(clicked[0].download).toBe('preset.json')
  })

  it('objectURL 在延迟后被回收，不泄漏', () => {
    downloadJsonFile('preset', { a: 1 })
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1500)
    expect(revoked).toEqual(createdUrls)
  })

  it('exportBundleToDownload 用净化后的 name 作为文件名', () => {
    exportBundleToDownload({ name: 'my preset:v2', config: {} })
    expect(clicked[0].download).toBe('my-preset_v2.json')
  })
})

describe('savedConfigIo: parseSavedConfigImport 体积与格式闸门', () => {
  beforeEach(() => {
    useLocaleStore.setState({ language: 'zh' })
  })

  it('byteLength 超限时先拒（不必先解析大字符串）', () => {
    expect(() => parseSavedConfigImport('{}', SAVED_CONFIG_IO_MAX_BYTES + 1)).toThrow('文件过大')
  })

  it('文本长度超限时同样拒绝', () => {
    const huge = `"${'x'.repeat(SAVED_CONFIG_IO_MAX_BYTES)}"`
    expect(() => parseSavedConfigImport(huge)).toThrow('文件过大')
  })

  it('恰好等于上限时放行体积闸门', () => {
    expect(() => parseSavedConfigImport('{"a":1}', SAVED_CONFIG_IO_MAX_BYTES)).not.toThrow()
  })

  it('非法 JSON 报"不是合法 JSON"', () => {
    expect(() => parseSavedConfigImport('{oops')).toThrow('不是合法 JSON')
  })

  it('根节点是数组 / 标量 / null 时报"根节点必须是对象"', () => {
    for (const text of ['[1,2]', '42', '"str"', 'null']) {
      expect(() => parseSavedConfigImport(text), text).toThrow('根节点必须是对象')
    }
  })

  it('EN 语言下抛英文消息', () => {
    useLocaleStore.setState({ language: 'en' })
    expect(() => parseSavedConfigImport('{oops')).toThrow('Not valid JSON')
    expect(() => parseSavedConfigImport('[]')).toThrow('Root must be an object')
  })
})

describe('savedConfigIo: parseSavedConfigImport 配置形状兼容', () => {
  beforeEach(() => {
    useLocaleStore.setState({ language: 'zh' })
  })

  it('{ data: { config } } 三层信封被拆到 config', () => {
    const bundle = parseSavedConfigImport(JSON.stringify({ data: { config: { network_dim: 8 } } }))
    expect(bundle.config).toEqual({ network_dim: 8 })
  })

  it('{ data: {...} } 里没有 config 时把 data 整体当配置', () => {
    const bundle = parseSavedConfigImport(JSON.stringify({ data: { network_dim: 8 } }))
    expect(bundle.config).toEqual({ network_dim: 8 })
  })

  it('root.config 优先于 root.data', () => {
    const bundle = parseSavedConfigImport(JSON.stringify({ config: { from: 'config' }, data: { from: 'data' } }))
    expect(bundle.config).toEqual({ from: 'config' })
  })

  it('嵌套配置但缺 name 时用 title，再退到 imported', () => {
    expect(parseSavedConfigImport(JSON.stringify({ title: '我的预设', config: { a: 1 } })).name).toBe('我的预设')
    expect(parseSavedConfigImport(JSON.stringify({ config: { a: 1 } })).name).toBe('imported')
  })

  it('name 缺失时可回落到 id', () => {
    expect(parseSavedConfigImport(JSON.stringify({ id: 'preset-7', config: { a: 1 } })).name).toBe('preset-7')
  })

  it('扁平 config 被收拢，元字段被剔除', () => {
    const bundle = parseSavedConfigImport(
      JSON.stringify({
        name: 'flat',
        schema_id: 'sdxl-lora',
        exported_at: 123,
        source: 'x',
        version: 2,
        network_dim: 32,
        output_name: 'o',
      }),
    )
    expect(bundle.config).toEqual({ network_dim: 32, output_name: 'o' })
    expect(bundle.name).toBe('flat')
    expect(bundle.schema_id).toBe('sdxl-lora')
  })

  it('扁平形状缺 name 时落到 imported', () => {
    expect(parseSavedConfigImport(JSON.stringify({ network_dim: 32 })).name).toBe('imported')
  })

  it('只有元字段的扁平对象报"未找到 config 字段"', () => {
    expect(() => parseSavedConfigImport(JSON.stringify({ name: 'x', schema_id: 'sdxl-lora', version: 1 })))
      .toThrow('未找到 config 字段')
  })

  it('config 是数组/标量/空对象时报"未找到可用 config"', () => {
    for (const root of [{ config: [] }, { config: 1 }, { config: {} }]) {
      expect(() => parseSavedConfigImport(JSON.stringify(root)), JSON.stringify(root))
        .toThrow('未找到可用 config')
    }
  })

  it('空对象 {} 报"未找到可用 config"', () => {
    expect(() => parseSavedConfigImport('{}')).toThrow('未找到可用 config')
  })

  it('schema_id 缺失时两个类型字段都是 undefined 而不是空串', () => {
    const bundle = parseSavedConfigImport(JSON.stringify({ config: { a: 1 } }))
    expect(bundle.schema_id).toBeUndefined()
    expect(bundle.typeId).toBeUndefined()
  })

  it('config 是浅拷贝：与解析出的原对象不共享引用', () => {
    const bundle = parseSavedConfigImport(JSON.stringify({ config: { nested: { a: 1 } } }))
    expect(bundle.config.nested).toEqual({ a: 1 })
  })
})

describe('savedConfigIo: readFileAsSavedBundle', () => {
  beforeEach(() => {
    useLocaleStore.setState({ language: 'zh' })
  })

  function jsonFile(name: string, payload: unknown): File {
    return new File([JSON.stringify(payload)], name, { type: 'application/json' })
  }

  it('正常读取并保留 bundle 里的 name', async () => {
    const bundle = await readFileAsSavedBundle(jsonFile('whatever.json', { name: 'inside', config: { a: 1 } }))
    expect(bundle.name).toBe('inside')
    expect(bundle.config).toEqual({ a: 1 })
  })

  it('bundle 没有 name 时用文件名去掉扩展名兜底', async () => {
    const bundle = await readFileAsSavedBundle(jsonFile('My Preset.JSON', { config: { a: 1 } }))
    expect(bundle.name).toBe('My Preset')
  })

  it('bundle name 恰好是 imported 时也用文件名替换', async () => {
    const bundle = await readFileAsSavedBundle(jsonFile('from-disk.json', { name: 'imported', config: { a: 1 } }))
    expect(bundle.name).toBe('from-disk')
  })

  it('文件名去掉扩展后为空时保留 imported', async () => {
    const bundle = await readFileAsSavedBundle(jsonFile('.json', { config: { a: 1 } }))
    expect(bundle.name).toBe('imported')
  })

  it('超过体积上限时在读取内容之前就拒绝', async () => {
    const file = jsonFile('big.json', { config: { a: 1 } })
    Object.defineProperty(file, 'size', { value: SAVED_CONFIG_IO_MAX_BYTES + 1 })
    const textSpy = vi.spyOn(file, 'text')
    await expect(readFileAsSavedBundle(file)).rejects.toThrow('文件过大')
    expect(textSpy).not.toHaveBeenCalled()
  })

  it('内容非法时把解析错误原样抛给调用方', async () => {
    const file = new File(['{oops'], 'bad.json', { type: 'application/json' })
    await expect(readFileAsSavedBundle(file)).rejects.toThrow('不是合法 JSON')
  })
})