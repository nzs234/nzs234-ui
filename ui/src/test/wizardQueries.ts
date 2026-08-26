// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 向导 UI 的查询名构造器。
 *
 * 所有名字都从**生产代码本身**推导(i18n 语言包 / schema 定义 / adapterModel 卡片
 * 投影),测试里不再出现旧版中英文字面量。断言仍然打在用户真正看得见的文本上:
 * 只是"这段文本是什么"由生产侧回答,而不是由测试抄一份副本。
 */
import { getFieldDefinition } from '@/schema/schemaIndex.js'
import type { TrainingTypeMeta } from '@/schema/schemaIndex'
import { resolveFieldLabel } from '@/i18n/useI18n'
import { ADAPTER_CATEGORIES, adapterOptions } from '@/pages/train/wizard/adapterModel'
import { wizardStepLabelKey } from '@/pages/train/wizard/primitives'
import { activeLanguage, textContains, textPrefix, uiText, uiTextPrefix } from './i18n'

/**
 * 分类卡片下的训练方案卡片:`<strong>{type.label}</strong><small>{type.id}</small>`。
 * 可访问名以 label 开头、并且一定含有 type.id;用函数匹配器同时钉住这两段,
 * 既保证命中的是真实可见 label,又不会因为 label 撞名(LoRA 分类里有多张 SDXL/FLUX
 * 前缀卡)而误选到别的方案。
 */
export function typeCardName(meta: TrainingTypeMeta): (accessibleName: string) => boolean {
  // id 必须是完整 token（后随字符不得还是 id 字符），否则 'sdxl-controlnet' 会
  // 同时命中 'SDXL' 与 'SDXL LLLite / sdxl-controlnet-lllite' 两张卡。
  const idPattern = new RegExp(`${meta.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`)
  return (accessibleName: string) =>
    accessibleName.startsWith(meta.label) && idPattern.test(accessibleName)
}

/**
 * 适配器卡片标题。取自 adapterOptions() 的投影,也就是 WizardPage 渲染 ChoiceCard
 * 时用的同一个 label(schema option label 优先,其次 adapterModel 的 FAMILY_LABELS;
 * 两者都按当前 UI 语言解析,与生产渲染同链路)。
 */
export function adapterCardLabel(
  config: Record<string, unknown>,
  typeId: string,
  family: string,
): string {
  const option = adapterOptions(config, typeId).find((item) => item.family === family)
  if (!option) {
    const offered = adapterOptions(config, typeId).map((item) => item.family).join(', ')
    throw new Error(`adapter family "${family}" not offered for ${typeId} (offered: ${offered || 'none'})`)
  }
  return option.label
}

export function adapterCardName(
  config: Record<string, unknown>,
  typeId: string,
  family: string,
): RegExp {
  return textPrefix(adapterCardLabel(config, typeId, family))
}

/**
 * 适配器大类 Tab 的可访问名。
 *
 * 标题从生产侧的 ADAPTER_CATEGORIES.titleKey + 语言包取值,测试里不抄任何语言的
 * 字面量;分类集合变了/键缺了都在这里炸,而不是在 findByRole('tab') 处报一个
 * 看不出根因的超时。
 */
export function adapterCategoryButtonName(categoryKey: string): RegExp {
  const category = ADAPTER_CATEGORIES.find((item) => item.id === categoryKey)
  if (!category) {
    const offered = ADAPTER_CATEGORIES.map((item) => item.id).join(', ')
    throw new Error(`adapter category "${categoryKey}" not defined (offered: ${offered})`)
  }
  return uiTextPrefix(category.titleKey)
}

/**
 * 步骤轨上某一步的按钮名。解析链与 WizardPage.stepLabel 一致:wizard.step.<id>。
 *
 * 这里用**包含**匹配而不是前缀:StepCard 把序号(`01`/`03`)渲染在标题之前,
 * 可访问名形如 `03 适配器方法 已完成`,前缀锚会永远匹配不上。键缺失时 uiText
 * 会抛错 —— 那正是"界面显示裸键"的场景,不该让断言悄悄通过。
 */
export function wizardStepButtonName(stepId: string): RegExp {
  return textContains(uiText(wizardStepLabelKey(stepId)))
}

/**
 * schema 字段在当前 UI 语言下的可见标签。
 *
 * 字段被改名/移走时要在这里炸掉,而不是拿 undefined 去 resolve 出一个空标签,
 * 然后在 getByLabelText 处报一个看不出根因的错。语言取自 localeStore,与
 * FieldControl 的 resolveFieldLabel(field, language) 保持同一条解析链。
 */
export function fieldLabel(key: string, typeId: string): string {
  const field = getFieldDefinition(key, typeId)
  if (!field) throw new Error(`schema field ${typeId}.${key} not found`)
  const label = resolveFieldLabel(field, activeLanguage())
  if (!label.trim()) throw new Error(`schema field ${typeId}.${key} resolved to an empty label`)
  return label
}

export function fieldLabelRegex(key: string, typeId: string): RegExp {
  return textPrefix(fieldLabel(key, typeId))
}
