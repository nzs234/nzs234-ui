// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/* 训练类型准入单一事实源:TRAINING_TYPES=可见列表,ALL_TRAINING_TYPES=注册全表(含隐藏 legacy)。
 * 隐藏 legacy 类型必须可恢复/可导入/可专家编辑,但绝不出现在新手列表、绝不启动 disabled 类型。 */
import { ALL_TRAINING_TYPES, TRAINING_TYPES, hasSchemaForType } from '@/schema/schemaIndex.js'

/** 可见且未禁用(与侧栏 TRAINING_TYPES 列表一致)。 */
export function isVisibleTrainingType(id: string): boolean {
  return TRAINING_TYPES.some((t) => t.id === id && !t.disabled)
}

/** 注册表中存在、未禁用且拥有可编辑 schema（隐藏 legacy 同样允许）。 */
export function isRestorableTrainingType(id: string): boolean {
  const entry = ALL_TRAINING_TYPES.find((t) => t.id === id)
  return !!entry && !entry.disabled && hasSchemaForType(id)
}

/** 注册、未禁用但没有前端 schema 的 legacy 类型只能保留原始记录，不能编辑/启动。 */
export function isSchemaUnavailableTrainingType(id: string): boolean {
  const entry = ALL_TRAINING_TYPES.find((t) => t.id === id)
  return !!entry && !entry.disabled && !hasSchemaForType(id)
}

/** 是否已注册(无论可见/隐藏/禁用)。 */
export function isRegisteredTrainingType(id: string): boolean {
  return ALL_TRAINING_TYPES.some((t) => t.id === id)
}

/** 已注册则原样返回 id,否则 null。 */
export function resolveTrainingTypeId(id: string | null | undefined): string | null {
  if (!id) return null
  return isRegisteredTrainingType(id) ? id : null
}

/**
 * 单个候选 id 的准入判定结果。恢复/导入必须 fail-closed,
 * 所以调用方需要知道"为什么不行",而不只是一个布尔。
 */
export type TrainingTypeAccess =
  | 'restorable'
  /** id 为空/空白。 */
  | 'missing'
  /** 不在注册表里(旧版本产物、别的分支的类型名)。 */
  | 'unregistered'
  /** 注册但被 disabled:绝不允许灌入/启动。 */
  | 'disabled'
  /** 注册且未禁用,但前端没有可编辑 schema:只能保留原始记录。 */
  | 'schema_unavailable'

export function describeTrainingTypeAccess(id: string | null | undefined): TrainingTypeAccess {
  const key = String(id ?? '').trim()
  if (!key) return 'missing'
  const entry = ALL_TRAINING_TYPES.find((t) => t.id === key)
  if (!entry) return 'unregistered'
  if (entry.disabled) return 'disabled'
  if (!hasSchemaForType(key)) return 'schema_unavailable'
  return 'restorable'
}