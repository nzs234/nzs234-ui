// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * preview_groups 字段的归一化助手。
 * 字段值必须是"对象数组"(见 schemaFieldGroups.js:689);历史字符串/其他畸形值一律归为 []。
 */
export function normalizePreviewGroups(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return []
  const out: unknown[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) out.push(item)
  }
  return out
}
