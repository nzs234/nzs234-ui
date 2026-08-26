// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * trainingWiki 加载链 + schema 兜底文案。
 *
 * 这层决定「点问号弹出来的是什么」：manifest 别名解析错了会给用户看别的参数的
 * 说明；manifest 落后于 entries 目录时若不走直连兜底，新参数的帮助会整块消失。
 * 两者都不会抛错，只会静默错，所以这里逐条钉住 resolvedVia 与请求次数。
 *
 * schema 兜底(buildSchemaFallbackEntry)是纯函数分支表：type × desc × default
 * 决定三段文案，测的是「哪一段分支被选中」而不是文案本身好不好。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SchemaField } from '@/schema/schemaIndex'
import {
  buildSchemaFallbackEntry,
  clearTrainingWikiCache,
  loadTrainingWikiEntry,
  loadTrainingWikiManifest,
} from './trainingWiki'

const MANIFEST_URL = 'training-wiki/manifest.json'

/** url → JSON body；表里没有的 url 一律当 404(与真实静态目录一致)。 */
let routes: Map<string, unknown>
let fetchSpy: ReturnType<typeof vi.fn>

function urlsFor(prefix: string): string[] {
  return fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(prefix))
}

function field(extra: Partial<SchemaField> = {}): SchemaField {
  return { key: 'demo_key', type: 'string', ...extra } as SchemaField
}

beforeEach(() => {
  clearTrainingWikiCache()
  routes = new Map()
  fetchSpy = vi.fn(async (url: string) => {
    if (!routes.has(url)) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    return { ok: true, status: 200, json: async () => routes.get(url) } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearTrainingWikiCache()
})

// ─── manifest ────────────────────────────────────────────────────────────────

describe('trainingWiki: loadTrainingWikiManifest', () => {
  test('manifest 只请求一次，之后复用同一个 promise', async () => {
    routes.set(MANIFEST_URL, { entries: [{ key: 'a', entry: 'entries/a.json' }] })
    const first = await loadTrainingWikiManifest()
    const second = await loadTrainingWikiManifest()
    expect(second).toBe(first)
    expect(urlsFor('manifest.json')).toHaveLength(1)
  })

  test('manifest 缺失时降级成空表而不是抛错', async () => {
    // public/ 里没铺 manifest 的部署(或旧包)不该让帮助入口整个炸掉。
    await expect(loadTrainingWikiManifest()).resolves.toEqual({ entries: [] })
  })

  test('force-cache 请求语义保持不变', async () => {
    routes.set(MANIFEST_URL, { entries: [] })
    await loadTrainingWikiManifest()
    expect(fetchSpy).toHaveBeenCalledWith(MANIFEST_URL, { cache: 'force-cache' })
  })
})

// ─── entry 解析 ──────────────────────────────────────────────────────────────

describe('trainingWiki: loadTrainingWikiEntry 解析顺序', () => {
  test('空 key / 纯空白 key 直接返回 null 且不发请求', async () => {
    await expect(loadTrainingWikiEntry('')).resolves.toBeNull()
    await expect(loadTrainingWikiEntry('   ')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('manifest 里 key 命中 → resolvedVia=manifest_key', async () => {
    routes.set(MANIFEST_URL, { entries: [{ key: 'network_dim', entry: 'entries/network_dim.json' }] })
    routes.set('training-wiki/entries/network_dim.json', { key: 'network_dim', title: '网络维度' })
    const entry = await loadTrainingWikiEntry('network_dim')
    expect(entry).toMatchObject({ key: 'network_dim', title: '网络维度', resolvedVia: 'manifest_key' })
  })

  test('命中 aliases → resolvedVia=manifest_alias，key 回落到 manifest 的正式 key', async () => {
    routes.set(MANIFEST_URL, {
      entries: [{ key: 'network_dim', entry: 'entries/network_dim.json', aliases: ['dim', 'rank'] }],
    })
    // 条目文件本身没写 key：必须补上 manifest 的正式 key，而不是用户查询的别名。
    routes.set('training-wiki/entries/network_dim.json', { title: '网络维度' })
    const entry = await loadTrainingWikiEntry('rank')
    expect(entry).toMatchObject({ key: 'network_dim', resolvedVia: 'manifest_alias' })
  })

  test('manifest 登记的路径 404 时仍尝试 entries/{key}.json', async () => {
    // manifest 与 entries 目录不同步是常态；登记路径坏了不能等于没有帮助。
    routes.set(MANIFEST_URL, { entries: [{ key: 'lr', entry: 'entries/moved-away.json' }] })
    routes.set('training-wiki/entries/lr.json', { title: '学习率' })
    const entry = await loadTrainingWikiEntry('lr')
    expect(entry).toMatchObject({ key: 'lr', title: '学习率', resolvedVia: 'entries_direct' })
    expect(urlsFor('entries/moved-away.json')).toHaveLength(1)
  })

  test('manifest 没登记的新参数走直连兜底，key 经 encodeURIComponent', async () => {
    routes.set(MANIFEST_URL, { entries: [] })
    routes.set('training-wiki/entries/odd%20key.json', { title: '怪 key' })
    const entry = await loadTrainingWikiEntry('odd key')
    expect(entry).toMatchObject({ key: 'odd key', resolvedVia: 'entries_direct' })
  })

  test('manifest 条目没有 entry 字段时只走直连', async () => {
    routes.set(MANIFEST_URL, { entries: [{ key: 'seed' }] })
    routes.set('training-wiki/entries/seed.json', { title: '随机种子' })
    await expect(loadTrainingWikiEntry('seed')).resolves.toMatchObject({ resolvedVia: 'entries_direct' })
  })

  test('manifest.entries 不是数组时不抛，退化成直连查找', async () => {
    routes.set(MANIFEST_URL, { entries: 'oops' })
    routes.set('training-wiki/entries/seed.json', { title: '随机种子' })
    await expect(loadTrainingWikiEntry('seed')).resolves.toMatchObject({ resolvedVia: 'entries_direct' })
  })

  test('两条路径都拿不到 → null（调用方据此走 schema 兜底）', async () => {
    routes.set(MANIFEST_URL, { entries: [] })
    await expect(loadTrainingWikiEntry('nope')).resolves.toBeNull()
  })

  test('同一个 key 只解析一次；clearTrainingWikiCache 后重新解析', async () => {
    routes.set(MANIFEST_URL, { entries: [] })
    routes.set('training-wiki/entries/seed.json', { title: '随机种子' })
    await loadTrainingWikiEntry('seed')
    await loadTrainingWikiEntry('seed')
    expect(urlsFor('entries/seed.json')).toHaveLength(1)

    clearTrainingWikiCache()
    await loadTrainingWikiEntry('seed')
    expect(urlsFor('entries/seed.json')).toHaveLength(2)
    // manifest 缓存也一并失效。
    expect(urlsFor('manifest.json')).toHaveLength(2)
  })
})

// ─── schema 兜底：summary / title ────────────────────────────────────────────

describe('trainingWiki: buildSchemaFallbackEntry 基本结构', () => {
  test('没有 field 时返回 null', () => {
    expect(buildSchemaFallbackEntry(null)).toBeNull()
    expect(buildSchemaFallbackEntry(undefined)).toBeNull()
  })

  test('title 去掉 label 尾部的括号后缀', () => {
    const entry = buildSchemaFallbackEntry(field({ label: '学习率（lr）' }))
    expect(entry?.title).toBe('学习率')
  })

  test('desc 优先作为 summary；标记为 fallback / schema_fallback', () => {
    const entry = buildSchemaFallbackEntry(field({ desc: '控制网络秩。' }))
    expect(entry).toMatchObject({
      key: 'demo_key',
      category: '训练参数',
      advanced: null,
      relatedConfigs: [],
      fallback: true,
      resolvedVia: 'schema_fallback',
    })
    expect(entry?.standard?.summary).toBe('控制网络秩。')
  })

  test('没有 desc 时 summary 由 label + key 拼出', () => {
    const entry = buildSchemaFallbackEntry(field({ key: 'network_dim', label: '网络维度' }))
    expect(entry?.standard?.summary).toContain('网络维度')
    expect(entry?.standard?.summary).toContain('network_dim')
  })

  test('连 key 都没有时用通用兜底句，不留空 summary', () => {
    const entry = buildSchemaFallbackEntry(field({ key: '' }))
    expect(entry?.key).toBe('')
    expect(entry?.standard?.summary).toBe('这个参数来自当前训练 schema，完整 Wiki 条目还在补充中。')
  })

  test('desc 为空时回落到 importantDesc', () => {
    const entry = buildSchemaFallbackEntry(field({ desc: '', importantDesc: '高亮提示。' }))
    expect(entry?.standard?.summary).toBe('高亮提示。')
  })
})

// ─── schema 兜底：effect 分支 ───────────────────────────────────────────────

describe('trainingWiki: effect 行分支', () => {
  test('有 desc 且有默认值 → 追加 schema 默认', () => {
    const entry = buildSchemaFallbackEntry(field({ type: 'number', desc: '批大小。', defaultValue: 4 }))
    expect(entry?.standard?.effect).toBe('批大小。（schema 默认：4）')
  })

  test('有 desc 但没有默认值 → 原样输出', () => {
    const entry = buildSchemaFallbackEntry(field({ desc: '批大小。' }))
    expect(entry?.standard?.effect).toBe('批大小。')
  })

  test('boolean 默认 true / false 给出方向相反的说明', () => {
    const on = buildSchemaFallbackEntry(field({ type: 'boolean', label: '缓存潜变量', defaultValue: true }))
    const off = buildSchemaFallbackEntry(field({ type: 'boolean', label: '缓存潜变量', defaultValue: false }))
    expect(on?.standard?.effect).toContain('默认开启')
    expect(off?.standard?.effect).toContain('默认关闭')
  })

  test('select 有/无默认值两种措辞', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'select', defaultValue: 'fp16' }))?.standard?.effect)
      .toContain('fp16')
    expect(buildSchemaFallbackEntry(field({ type: 'select' }))?.standard?.effect)
      .toBe('从下拉选项中选择合适的取值。')
  })

  test('number 有/无默认值两种措辞', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'number', defaultValue: 0 }))?.standard?.effect)
      .toContain('schema 默认 0')
    expect(buildSchemaFallbackEntry(field({ type: 'number' }))?.standard?.effect)
      .toBe('数值参数；建议小步调整并短测。')
  })

  test('未知 type 落到通用句', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'folder' }))?.standard?.effect)
      .toBe('具体效果取决于当前训练类型和后端运行时解析。')
  })

  test('默认值格式化：null / 长字符串 / 对象 / 不可序列化', () => {
    const read = (defaultValue: unknown) =>
      String(buildSchemaFallbackEntry(field({ type: 'number', desc: 'd', defaultValue }))?.standard?.effect)

    expect(read(null)).toBe('d（schema 默认：null）')
    // undefined 视为"没有默认值"，不进括号。
    expect(read(undefined)).toBe('d')
    expect(read('x'.repeat(100))).toContain('…')
    expect(read({ a: 1 })).toBe('d（schema 默认：{"a":1}）')
    expect(read([1, 2])).toBe('d（schema 默认：[1,2]）')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    // JSON.stringify 抛错时按"无默认值"处理，不能把异常冒到帮助面板。
    expect(read(circular)).toBe('d')
  })

  test('长 JSON 默认值被截断到 80 字符内', () => {
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    const effect = String(buildSchemaFallbackEntry(field({ type: 'number', desc: 'd', defaultValue: big }))?.standard?.effect)
    expect(effect).toContain('…')
    expect(effect.length).toBeLessThan(110)
  })
})

// ─── schema 兜底：whenToUse / avoidWhen 分支 ────────────────────────────────

describe('trainingWiki: whenToUse 行分支', () => {
  test('desc 提到调试/实验 → 调试场景建议', () => {
    expect(buildSchemaFallbackEntry(field({ desc: '仅用于 debug 诊断。' }))?.standard?.whenToUse)
      .toBe('主要用于调试/实验场景；确认问题后再考虑长期打开。')
  })

  test('desc 提到磁盘/缓存 → 介质建议', () => {
    expect(buildSchemaFallbackEntry(field({ desc: 'HDD 上建议整片读取。' }))?.standard?.whenToUse)
      .toContain('HDD 更宜整片')
  })

  test('boolean + 默认 false → 需要时再开', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'boolean', defaultValue: false }))?.standard?.whenToUse)
      .toContain('需要对应能力时再开启')
  })

  test('boolean + 默认 true → 保持开启', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'boolean', defaultValue: true }))?.standard?.whenToUse)
      .toContain('通常保持开启')
  })

  test('其余情况给保守默认建议', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'number', defaultValue: 8 }))?.standard?.whenToUse)
      .toBe('不确定时先保持默认值，小步数短测确认再调整。')
  })
})

describe('trainingWiki: avoidWhen 行分支', () => {
  test('没有任何风险线索时给通用提示', () => {
    expect(buildSchemaFallbackEntry(field({ type: 'string' }))?.standard?.avoidWhen)
      .toBe('如果它与其它选项互斥、预检提示冲突，优先按预检建议处理。')
  })

  test('有 visibleWhen 的字段提醒显隐约束', () => {
    const entry = buildSchemaFallbackEntry(field({ type: 'string', visibleWhen: () => true }))
    expect(entry?.standard?.avoidWhen).toContain('显隐/互斥约束')
  })

  test('desc 里写了互斥/冲突时追加一条', () => {
    const entry = buildSchemaFallbackEntry(field({ type: 'string', desc: '与 xformers 互斥。' }))
    expect(entry?.standard?.avoidWhen).toContain('描述中已提示互斥或风险')
  })

  test('boolean 追加"优先关实验开关"，多条线索用分号连接并以句号收尾', () => {
    const entry = buildSchemaFallbackEntry(
      field({ type: 'boolean', desc: '禁止与 fp8 同时开启。', visibleWhen: () => true }),
    )
    const avoid = String(entry?.standard?.avoidWhen)
    expect(avoid.split('；')).toHaveLength(3)
    expect(avoid).toContain('优先关实验开关')
    expect(avoid.endsWith('。')).toBe(true)
  })
})
