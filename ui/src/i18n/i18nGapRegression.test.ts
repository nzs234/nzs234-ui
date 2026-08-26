// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * i18n 覆盖缺口回归门禁（F5）。
 *
 * i18nParity.test.ts 守的是「语言包自身自洽」（键集/空值/占位符/孤儿/死键）；
 * 它管不到另一半：**schema 侧新增字段却没补 EN**。那种缺口在 UI 上表现为 EN
 * 界面裸露中文 label/desc/option —— 类型系统与 parity 门禁都拦不住。
 *
 * 判定语义刻意是「相对基线不得新增」，不是「绝对为零」：
 *  · 基线 tools/.i18n-gap-baseline.json 由 `npm run i18n:gap:capture` 固化，
 *    当前状态是 0/0/0（F4 收口后）；
 *  · 并行改 schema 的人可以合法新增字段键 —— 那会让缺口从 0 涨起来，此时门禁
 *    报的是**具体新增了哪些键**，而不是一个含义模糊的数字比较；
 *  · 反向（缺口被补掉）不 fail，只在基线明显落后时提示重新 capture。
 *
 * 判定链与 tools/i18nGapScan.mjs 同源（直接 import gapSummary），避免门禁与
 * 扫描器各写一套 tier/CJK 判定后悄悄分叉。
 */
import { describe, expect, test } from 'vitest'
import { gapFingerprint, readGapBaseline } from '../../tools/i18nGapScan.mjs'

interface GapFingerprint {
  missingLabelEn: string[]
  missingDescEn: string[]
  cjkOptions: string[]
}

const baseline = readGapBaseline() as GapFingerprint
const current = gapFingerprint() as GapFingerprint

const KINDS = ['missingLabelEn', 'missingDescEn', 'cjkOptions'] as const

function added(kind: (typeof KINDS)[number]): string[] {
  const known = new Set(baseline[kind])
  return current[kind].filter((key) => !known.has(key)).sort()
}

describe('i18n coverage gap regression', () => {
  test('baseline file has the expected shape', () => {
    for (const kind of KINDS) {
      expect(Array.isArray(baseline[kind]), `baseline.${kind} must be an array`).toBe(true)
      expect(Array.isArray(current[kind]), `current.${kind} must be an array`).toBe(true)
    }
  })

  test('no schema field newly loses its English label', () => {
    const regressions = added('missingLabelEn')
    expect(
      regressions,
      `fields whose label_en coverage regressed vs baseline (add them to src/i18n/schemaFieldLabelsEn.json, then re-run "npm run i18n:gap:capture"):\n  ${regressions.join('\n  ')}`,
    ).toEqual([])
  })

  test('no schema field newly loses its English description', () => {
    const regressions = added('missingDescEn')
    expect(
      regressions,
      `fields whose desc_en coverage regressed vs baseline (add a tools/descContent entry and run "node tools/syncDescEnPack.mjs", then "npm run i18n:gap:capture"):\n  ${regressions.join('\n  ')}`,
    ).toEqual([])
  })

  test('no select/multiSelect option newly ships a CJK-only label', () => {
    const regressions = added('cjkOptions')
    expect(
      regressions,
      `options rendering Chinese under the EN locale (add "fieldKey|value" entries to src/i18n/schemaFieldOptionsEn.json, then re-run "npm run i18n:gap:capture"):\n  ${regressions.join('\n  ')}`,
    ).toEqual([])
  })

  test('baseline is not stale by more than the tolerated slack', () => {
    // 缺口被补掉不该 fail，但基线长期落后会让门禁越来越松（已修的键还留在
    // 白名单里，同名键日后回潮就抓不到）。留 25 个键的余量给在途改动。
    const stale = KINDS.flatMap((kind) => {
      const live = new Set(current[kind])
      return baseline[kind].filter((key) => !live.has(key)).map((key) => `${kind}:${key}`)
    })
    expect(
      stale.length,
      `baseline lists ${stale.length} gaps that no longer exist — re-run "npm run i18n:gap:capture" to tighten the gate:\n  ${stale.join('\n  ')}`,
    ).toBeLessThanOrEqual(25)
  })
})
