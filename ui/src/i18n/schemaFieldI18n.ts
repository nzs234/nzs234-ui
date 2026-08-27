// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * schema 字段的 EN 文案解析(label / desc / option label)。
 *
 * 刻意从 useI18n 拆出来:这三个解析器背后是三份按 field.key 索引的大 EN 包
 * (schemaFieldLabelsEn / schemaFieldDescsEn / schemaFieldOptionsEn,合计 ~300KB
 * 源码),而它们**只**在渲染 schema 字段时被读到 —— 也就是只有训练页/向导需要。
 * 留在 useI18n 里,启动链(main → AppShell → Topbar → useI18n)会把这三份包
 * 静态拖进入口 chunk,首屏无论进哪个路由都得先下 300KB 字段文案;中文界面下
 * 这几份包一个字节都不会被读到(resolve* 只在 preferEn 时查包)。
 *
 * 解析语义与拆分前逐字一致(同步读包、同样的优先级回落),只是"谁被迫下载它"
 * 变了:现在跟着 schema 消费方(FieldControl / 测试查询构造器)进按需 chunk。
 *
 * 通用 UI 文案(zh.json / en.json)与 tab/group 小包仍在 useI18n —— 那些是
 * 全站都要用的,拆出去只会多一次请求。
 */
import schemaFieldLabelsEn from './schemaFieldLabelsEn.json'
import schemaFieldDescsEn from './schemaFieldDescsEn.json'
import schemaFieldOptionsEn from './schemaFieldOptionsEn.json'

/** Schema field label/desc resolver (label_zh/label_en with label fallback). */
export function resolveFieldLabel(
  field: { key?: string; label?: string; label_zh?: string; label_en?: string; [k: string]: unknown },
  language: string,
): string {
  const preferEn = language === 'en'
  const primary = preferEn ? field.label_en : field.label_zh
  const secondary = preferEn ? field.label_zh : field.label_en
  if (typeof primary === 'string' && primary.trim()) return primary
  if (preferEn && field.key && typeof (schemaFieldLabelsEn as Record<string, string>)[field.key] === 'string') {
    return (schemaFieldLabelsEn as Record<string, string>)[field.key]
  }
  if (typeof secondary === 'string' && secondary.trim()) return secondary
  if (typeof field.label === 'string' && field.label.trim()) return field.label
  return String(field.key ?? '')
}

export function resolveFieldDesc(
  field: {
    key?: string
    desc?: string
    desc_zh?: string
    desc_en?: string
    title?: string
    [k: string]: unknown
  },
  language: string,
): string {
  const preferEn = language === 'en'
  const primary = preferEn ? field.desc_en : field.desc_zh
  const secondary = preferEn ? field.desc_zh : field.desc_en
  if (typeof primary === 'string' && primary.trim()) return primary
  if (
    preferEn &&
    field.key &&
    typeof (schemaFieldDescsEn as Record<string, string>)[field.key] === 'string'
  ) {
    return (schemaFieldDescsEn as Record<string, string>)[field.key]
  }
  if (typeof secondary === 'string' && secondary.trim()) return secondary
  if (typeof field.desc === 'string' && field.desc.trim()) return field.desc
  if (typeof field.title === 'string' && field.title.trim()) return field.title
  return ''
}

/** Resolve select/multiSelect option label for current language. */
export function resolveOptionLabel(
  fieldKey: string | undefined,
  option: { value?: string | number; label?: string; label_en?: string; label_zh?: string },
  language: string,
): string {
  const preferEn = language === 'en'
  const value = option.value == null ? '' : String(option.value)
  if (preferEn) {
    if (typeof option.label_en === 'string' && option.label_en.trim()) return option.label_en
    if (fieldKey && value) {
      const hit = (schemaFieldOptionsEn as Record<string, string>)[`${fieldKey}|${value}`]
      if (typeof hit === 'string' && hit.trim()) return hit
    }
  } else if (typeof option.label_zh === 'string' && option.label_zh.trim()) {
    return option.label_zh
  }
  if (typeof option.label === 'string' && option.label.trim()) return option.label
  return value
}
