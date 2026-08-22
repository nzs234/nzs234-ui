// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
/**
 * 测试侧 i18n 查询契约。
 *
 * UI 测试一律通过这里构造查询，而不是把某一语言的字面量抄进断言。理由:
 *  - 断言仍然打在**真实可见文本**上(值取自生产语言包本体),不是降级成 testid;
 *  - 语言包改文案时测试跟着走,只有"键消失/值为空"才失败 —— 那正是要炸的场景;
 *  - 同一份用例可以在 zh 和 en 下跑,顺带证明流程不依赖某一语言。
 *
 * uiText() 在键缺失时**直接抛错**,而不是回落到裸键。生产 formatMessage() 的
 * 回落语义是 `bundle[key] ?? key`,也就是缺键时界面上会显示 `queue.go_train`
 * 这种裸键;若测试也跟着回落,断言会"通过"在一个用户看不懂的字符串上。
 */
import zh from '@/i18n/zh.json'
import en from '@/i18n/en.json'
import { useLocaleStore, type UiLanguage } from '@/stores/localeStore'
import { WIZARD_CATEGORY_LABELS, type WizardCategory } from '@/pages/train/wizard/wizardModel'

export const I18N_BUNDLES: Record<UiLanguage, Record<string, string>> = { zh, en }

/** 受支持的 UI 语言,用于 test.each 覆盖两种语言。 */
export const I18N_LANGUAGES: UiLanguage[] = ['zh', 'en']

export function activeLanguage(): UiLanguage {
  return useLocaleStore.getState().language
}

/** 切换 UI 语言(与 Topbar 走同一个 store action)。 */
export function setLanguage(language: UiLanguage): void {
  useLocaleStore.getState().setLanguage(language)
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 与生产 formatMessage 相同的插值语义:每个变量只替换第一次出现。 */
function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  let out = text
  for (const [name, value] of Object.entries(vars)) out = out.replace(`{${name}}`, String(value))
  return out
}

/** 当前语言下某个翻译键的可见文本;键缺失或为空即视为契约破裂。 */
export function uiText(key: string, vars?: Record<string, string | number>): string {
  const language = activeLanguage()
  const value = I18N_BUNDLES[language][key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `i18n key "${key}" missing/empty in ${language}.json — the UI would render the bare key instead of text`,
    )
  }
  return interpolate(value, vars)
}

/**
 * uiText 的宽松版本:精确复刻生产 formatMessage 的 `bundle[key] ?? key` 回落。
 *
 * 只在"被测行为不是这段文案本身"时使用 —— 例如要点一个按钮来验证背后的 toast 链路。
 * 键缺失时界面上真的会显示裸键,所以按裸键去找按钮匹配的是**当前真实可见文本**,
 * 不是把断言放水;而"键不许缺失"这件事由 i18nParity.test.ts 独立把门,
 * 避免同一个生产缺陷在十几个无关用例里重复爆红、把真正的回归埋掉。
 */
export function uiTextOrBareKey(key: string, vars?: Record<string, string | number>): string {
  const value = I18N_BUNDLES[activeLanguage()][key]
  return typeof value === 'string' && value.trim() ? interpolate(value, vars) : key
}

/**
 * 前缀匹配用的正则。可访问名是"标题 + 描述 + 角标"拼起来的,
 * 用 ^ 锚在标题上可以避免命中另一张卡片描述里的同名词。
 */
export function uiTextPrefix(key: string, vars?: Record<string, string | number>): RegExp {
  return new RegExp(`^${escapeRegExp(uiText(key, vars))}`)
}

/** 任意生产派生字符串(如 schema label)的前缀正则。 */
export function textPrefix(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}`)
}

/** 任意生产派生字符串的包含正则。 */
export function textContains(text: string): RegExp {
  return new RegExp(escapeRegExp(text))
}

/**
 * 向导分类标题,解析链与 WizardPage 的 CategoryChoices/TypeChoices 完全一致:
 * 命中 wizard.category.<id> 就用翻译,否则回落到生产导出的 WIZARD_CATEGORY_LABELS。
 * 这里**故意**保留回落分支(而不是像 uiText 那样抛错),因为界面上真的会显示回落值;
 * "键必须存在"由 i18nParity.test.ts 单独把门。
 */
export function wizardCategoryLabel(category: WizardCategory): string {
  const translated = I18N_BUNDLES[activeLanguage()][`wizard.category.${category}`]
  return typeof translated === 'string' && translated.trim() ? translated : WIZARD_CATEGORY_LABELS[category]
}

export function wizardCategoryLabelPrefix(category: WizardCategory): RegExp {
  return textPrefix(wizardCategoryLabel(category))
}
