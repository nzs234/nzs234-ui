// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// i18n 大盘扫描:对照 schema 定义与 en 语言包,统计
//   1) 缺 label_en / desc_en 的字段(按 向导可见 > 常用页签 > advanced/expert > 隐藏类型 分级)
//   2) 仅中文的 option(select/multiSelect)
//   3) 孤儿键:schemaFieldLabelsEn / schemaFieldDescsEn / schemaFieldOptionsEn 里
//      指不到任何真实字段(或 字段|值)的条目;zh/en bundle 死键
//
// 用法:
//   node tools/i18nGapScan.mjs                    # 汇总统计
//   node tools/i18nGapScan.mjs --json             # 全量 JSON
//   node tools/i18nGapScan.mjs --capture-baseline # 固化缺口基线(F5 门禁快照)
//
// 本文件同时被 src/i18n/i18nGapRegression.test.ts 直接 import(取 gapSummary),
// 以免门禁与扫描器的判定链分叉;被 import 时不打印(见文件末尾的 isCli 判定)。
import { TRAINING_TYPES as ALL_TRAINING_TYPES } from '../src/schema/trainingTypeRegistry.js';
import { getSectionsForType, createDefaultConfig, isFieldVisible } from '../src/schema/schemaIndex.js';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const labelsEn = require('../src/i18n/schemaFieldLabelsEn.json');
const descsEn = require('../src/i18n/schemaFieldDescsEn.json');
const optionsEn = require('../src/i18n/schemaFieldOptionsEn.json');
const tabsEn = require('../src/i18n/schemaTabsEn.json');
const groupsEn = require('../src/i18n/schemaGroupsEn.json');
const zhBundle = require('../src/i18n/zh.json');
const enBundle = require('../src/i18n/en.json');

const CJK = /[\u4e00-\u9fff]/;
const TIER_NAME = ['wizard', 'standard', 'expertTab', 'hiddenType'];
const STANDARD_TABS = new Set(['model', 'dataset', 'contract', 'training', 'network', 'optimizer', 'preview', 'speed']);

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function visibleAt(field, config) {
  return safe(() => isFieldVisible(field, config), false);
}

function optionEntries(field, config) {
  const raw = safe(() => (typeof field.options === 'function' ? field.options(config) : field.options), null);
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : Array.from(raw);
  const out = [];
  for (const item of values) {
    if (item && typeof item === 'object') {
      out.push({
        value: String(item.value ?? '').trim(),
        label: String(item.label ?? item.label_zh ?? '').trim(),
        hasInlineEn: Boolean(String(item.label_en ?? '').trim()),
      });
    } else {
      out.push({ value: String(item ?? '').trim(), label: '', hasInlineEn: false });
    }
  }
  return out.filter((o) => o.value);
}

// ── 字段面收集(key 级聚合,tier 取最小值:0=向导可见 1=常用页签 2=advanced/expert 3=隐藏类型)──
const fieldsByKey = new Map();
const optionUsage = new Map();

for (const type of ALL_TRAINING_TYPES) {
  const typeHidden = Boolean(type.hidden || type.disabled);
  const defaults = safe(() => createDefaultConfig(type.id), {});
  const sections = safe(() => getSectionsForType(type.id), []);
  for (const section of sections) {
    if (section.hidden) continue;
    const expertSection = section.tab === 'advanced' || section.tab === 'frontier' || section.expert === true;
    for (const field of section.fields || []) {
      if (!field || !field.key) continue;
      const hiddenControl = field.type === 'hidden' || field.type === 'ui_group';
      let tier;
      if (typeHidden) tier = 3;
      else if (hiddenControl || expertSection) tier = 2;
      else if (!STANDARD_TABS.has(section.tab) || !visibleAt(field, defaults)) tier = 1;
      else tier = 0;

      const entry = fieldsByKey.get(field.key) || {
        key: field.key,
        bestTier: 9,
        types: new Set(),
        hiddenTypes: new Set(),
        sampleLabel: '',
      };
      entry.bestTier = Math.min(entry.bestTier, tier);
      if (typeHidden) entry.hiddenTypes.add(type.id);
      else entry.types.add(type.id);
      if (!entry.sampleLabel) entry.sampleLabel = String(field.label_zh ?? field.label ?? field.title ?? field.key);
      fieldsByKey.set(field.key, entry);

      if (field.type === 'select' || field.type === 'multiSelect') {
        for (const opt of optionEntries(field, defaults)) {
          const optKey = `${field.key}|${opt.value}`;
          const usage = optionUsage.get(optKey) || {
            key: optKey,
            fieldKey: field.key,
            value: opt.value,
            label: opt.label,
            hasInlineEn: opt.hasInlineEn,
            visibleTypes: new Set(),
            wizardVisible: false,
          };
          usage.hasInlineEn = usage.hasInlineEn || opt.hasInlineEn;
          if (!typeHidden && tier <= 1) usage.wizardVisible = true;
          if (!typeHidden) usage.visibleTypes.add(type.id);
          optionUsage.set(optKey, usage);
        }
      }
    }
  }
}

// ── desc 质量审计:功能说明 + 推荐范围 ──────────────────────────────────────
// 每个用户可见字段的 zh desc 应包含:
//   · 数值型(number/slider):固定前缀「推荐范围：」
//   · 布尔/枚举(boolean/select/multiSelect):选择建议(「建议」或「推荐」字样)
//   · 路径/文本(file/folder/string/text/textarea):至少有功能说明(desc 非空)
const RECOMMEND_PREFIX = '推荐范围：';
const ADVICE_RE = /(建议|推荐|优先|适合|保持默认|何时选|开启|关闭时)/;

function descNeedsWork(field) {
  const zh = String(field.desc_zh ?? field.desc ?? '').trim();
  if (!zh) return 'missing_desc';
  const t = String(field.type ?? '');
  if (t === 'number' || t === 'slider') {
    return zh.includes(RECOMMEND_PREFIX) ? null : 'no_recommend';
  }
  if (t === 'boolean' || t === 'select' || t === 'multiSelect') {
    return ADVICE_RE.test(zh) ? null : 'no_advice';
  }
  return null;
}

// descNeed: { tier -> { missing_desc:Set, no_recommend:Set, no_advice:Set } }
const descNeed = { 0: emptyNeed(), 1: emptyNeed(), 2: emptyNeed(), 3: emptyNeed() };
function emptyNeed() { return { missing_desc: new Set(), no_recommend: new Set(), no_advice: new Set() }; }
const descMeta = new Map(); // key -> { type, desc, defaultValue, min, max }
for (const type of ALL_TRAINING_TYPES) {
  const typeHidden = Boolean(type.hidden || type.disabled);
  for (const section of safe(() => getSectionsForType(type.id), [])) {
    if (section.hidden) continue;
    const expertSection = section.tab === 'advanced' || section.tab === 'frontier' || section.expert === true;
    for (const field of section.fields || []) {
      if (!field || !field.key || field.type === 'hidden') continue;
      const tier = typeHidden ? 3 : (expertSection ? 2 : (STANDARD_TABS.has(section.tab) && visibleAt(field, defaults0(type.id)) ? 0 : 1));
      const need = descNeedsWork(field);
      if (need && !descMeta.has(field.key)) {
        descMeta.set(field.key, {
          types: [type.id],
          tier,
          type: field.type,
          desc: String(field.desc_zh ?? field.desc ?? ''),
          defaultValue: field.defaultValue,
          min: field.min,
          max: field.max,
        });
      } else if (need && descMeta.has(field.key)) {
        const meta = descMeta.get(field.key);
        meta.tier = Math.min(meta.tier, tier);
        if (!meta.types.includes(type.id)) meta.types.push(type.id);
        if (!meta.desc && field.desc) meta.desc = String(field.desc);
      }
      if (need && !descNeed[tier][need].has(field.key)) descNeed[tier][need].add(field.key);
    }
  }
}
function defaults0(typeId) { return safe(() => createDefaultConfig(typeId), {}); }

// ── 缺口 ────────────────────────────────────────────────────────────────────
const missingLabelByTier = { 0: [], 1: [], 2: [], 3: [] };
const missingDescByTier = { 0: [], 1: [], 2: [], 3: [] };
for (const entry of fieldsByKey.values()) {
  const packLabel = typeof labelsEn[entry.key] === 'string' && labelsEn[entry.key].trim();
  const packDesc = typeof descsEn[entry.key] === 'string' && descsEn[entry.key].trim();
  if (!packLabel) missingLabelByTier[entry.bestTier].push(entry.key);
  if (!packDesc) missingDescByTier[entry.bestTier].push(entry.key);
}
const countAll = (m) => Object.values(m).reduce((a, b) => a + b.length, 0);

const zhOnlyOptions = [...optionUsage.values()].filter((opt) => {
  if (opt.hasInlineEn) return false;
  const hit = optionsEn[opt.key];
  return !(typeof hit === 'string' && hit.trim());
});
const cjkOptions = zhOnlyOptions.filter((opt) => CJK.test(opt.label));

// ── 孤儿键 ──────────────────────────────────────────────────────────────────
const orphanLabels = Object.keys(labelsEn).filter((key) => !fieldsByKey.has(key));
const orphanDescs = Object.keys(descsEn).filter((key) => !fieldsByKey.has(key));
const orphanOptions = Object.keys(optionsEn).filter((key) => !optionUsage.has(key));

// ── 组名/页签 en 覆盖 ───────────────────────────────────────────────────────
const groupNames = new Set();
for (const type of ALL_TRAINING_TYPES) if (type.group) groupNames.add(String(type.group));
const groupsMissingEn = [...groupNames].filter((g) => !(typeof groupsEn[g] === 'string' && groupsEn[g].trim()));
const usedTabKeys = new Set();
for (const type of ALL_TRAINING_TYPES) {
  for (const section of safe(() => getSectionsForType(type.id), [])) {
    if (!section.hidden && section.tab) usedTabKeys.add(section.tab);
  }
}
const tabsMissingEn = [...usedTabKeys].filter((tab) => !(typeof tabsEn[tab] === 'string' && tabsEn[tab].trim()));

// ── bundle 死键:字面量引用 + 模板前缀 + 已知动态展开族之外的全部键 ───────────
function literalBundleRefs() {
  const refs = new Set();
  const stems = new Set();
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
      if (/\.test\.[jt]sx?$/.test(entry.name)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      const text = readFileSync(full, 'utf8');
      // 源码里出现的任何点分小写字符串都算"可能被动态拼接的引用",宁滥勿缺。
      for (const m of text.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)) refs.add(m[1]);
      // 模板字面量键前缀(t(`generate.status_${s}`) 这类);只收带点的 i18n 形状,
      // 排除 lx-input- 等 DOM id 前缀。与 src/i18n/i18nParity.test.ts 门禁同规则。
      for (const m of text.matchAll(/`([a-zA-Z][a-zA-Z0-9._-]*)\$\{/g)) {
        if (m[1].includes('.')) stems.add(m[1]);
      }
    }
  };
  walk(join(HERE, '..', 'src'));
  return { refs, stems };
}

const dynWizardRefs = new Set();
{
  // 动态展开:wizard.step.<id> / wizard.step_desc.<id> / wizard.status.<s> /
  // wizard.category.<c>(_desc) / wizard.adapter_group.<g>(_desc)
  const stepIds = ['type', 'model', 'adapter', 'files', 'dataset', 'controlnet', 'yolo', 'goal', 'core',
    'ti-token', 'fewstep', 'distiller', 'performance', 'preview', 'dataset-intelligence',
    'optional', 'output', 'other-settings', 'review'];
  const statuses = ['locked', 'active', 'complete', 'warning', 'error', 'stale', 'pending'];
  const categories = ['lora', 'finetune', 'controlnet', 'textual_inversion', 'specialized', 'other'];
  const adapterGroups = ['lora', 'lycoris', 'other'];
  for (const id of stepIds) {
    dynWizardRefs.add(`wizard.step.${id}`);
    dynWizardRefs.add(`wizard.step_desc.${id}`);
  }
  for (const s of statuses) dynWizardRefs.add(`wizard.status.${s}`);
  for (const c of categories) {
    dynWizardRefs.add(`wizard.category.${c}`);
    dynWizardRefs.add(`wizard.category.${c}_desc`);
  }
  for (const g of adapterGroups) {
    dynWizardRefs.add(`wizard.adapter_group.${g}`);
    dynWizardRefs.add(`wizard.adapter_group.${g}_desc`);
  }
}

const { refs: litRefs, stems } = literalBundleRefs();
function deadKeysOf(bundle) {
  return Object.keys(bundle).filter((key) => {
    if (litRefs.has(key)) return false;
    if (dynWizardRefs.has(key)) return false;
    if ([...stems].some((stem) => key.startsWith(stem))) return false;
    return true;
  });
}
const deadZh = deadKeysOf(zhBundle);
const deadEn = deadKeysOf(enBundle);
const deadOnlyInOne = deadZh.filter((key) => !deadEn.includes(key))
  .concat(deadEn.filter((key) => !deadZh.includes(key)));

const descNeedCounts = Object.fromEntries(['missing_desc', 'no_recommend', 'no_advice'].map((kind) => [
  kind,
  Object.fromEntries(Object.entries(descNeed).map(([tier, m]) => [TIER_NAME[tier], m[kind].size])),
]));
const descNeedItems = Object.fromEntries(Object.entries(descNeed).map(([tier, m]) => [TIER_NAME[tier], {
  missing_desc: [...m.missing_desc].sort(),
  no_recommend: [...m.no_recommend].sort(),
  no_advice: [...m.no_advice].sort(),
}]));

// ── 输出 ────────────────────────────────────────────────────────────────────
const summary = {
  fieldsTotal: fieldsByKey.size,
  optionsTotal: optionUsage.size,
  missingLabelEn: {
    total: countAll(missingLabelByTier),
    byTier: Object.fromEntries(Object.entries(missingLabelByTier).map(([tier, keys]) => [TIER_NAME[tier], keys.length])),
    lists: Object.fromEntries(Object.entries(missingLabelByTier).map(([tier, keys]) => [TIER_NAME[tier], keys.sort()])),
  },
  missingDescEn: {
    total: countAll(missingDescByTier),
    byTier: Object.fromEntries(Object.entries(missingDescByTier).map(([tier, keys]) => [TIER_NAME[tier], keys.length])),
    lists: Object.fromEntries(Object.entries(missingDescByTier).map(([tier, keys]) => [TIER_NAME[tier], keys.sort()])),
  },
  optionsZhOnly: {
    total: zhOnlyOptions.length,
    cjkLabelTotal: cjkOptions.length,
    items: zhOnlyOptions.sort((a, b) => a.key.localeCompare(b.key)).map((o) => ({
      key: o.key,
      label: o.label,
      wizardVisible: o.wizardVisible,
      types: o.visibleTypes.size,
    })),
  },
  descAudit: {
    counts: descNeedCounts,
    items: descNeedItems,
    meta: Object.fromEntries([...descMeta.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v])),
  },
  orphans: {
    labelsEn: orphanLabels.sort(),
    descsEn: orphanDescs.sort(),
    optionsEn: orphanOptions.sort(),
  },
  groupCoverage: {
    groupsMissingEn: groupsMissingEn.sort(),
    tabsMissingEn: tabsMissingEn.sort(),
    allGroups: [...groupNames].sort(),
  },
  bundleDeadKeys: {
    zh: deadZh.sort(),
    en: deadEn.sort(),
    asymmetric: deadOnlyInOne.sort(),
  },
};

// 门禁消费面(src/i18n/i18nGapRegression.test.ts):导出扫描结果与基线读写,
// 让"相对基线不得新增缺口"的判定复用同一条判定链,而不是在测试里重写一遍。
export const gapSummary = summary;

export const GAP_BASELINE_PATH = join(HERE, '.i18n-gap-baseline.json');

/** 缺口基线的最小形状:只留键清单,不含计数(计数由清单派生,避免两处打架)。 */
export function gapFingerprint(sum = summary) {
  const tiers = ['wizard', 'standard', 'expertTab', 'hiddenType'];
  return {
    missingLabelEn: tiers.flatMap((tier) => sum.missingLabelEn.lists[tier]).sort(),
    missingDescEn: tiers.flatMap((tier) => sum.missingDescEn.lists[tier]).sort(),
    cjkOptions: sum.optionsZhOnly.items.filter((o) => CJK.test(o.label)).map((o) => o.key).sort(),
  };
}

export function readGapBaseline() {
  return JSON.parse(readFileSync(GAP_BASELINE_PATH, 'utf8'));
}

// import 时不产出任何输出;只有直接 node 执行才走 CLI 分支。
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli && process.argv.includes('--capture-baseline')) {
  const fingerprint = gapFingerprint();
  writeFileSync(GAP_BASELINE_PATH, `${JSON.stringify(fingerprint, null, 2)}\n`, 'utf8');
  console.log(`captured gap baseline: ${GAP_BASELINE_PATH}`);
  console.log(`  missing label_en ${fingerprint.missingLabelEn.length}, missing desc_en ${fingerprint.missingDescEn.length}, CJK options ${fingerprint.cjkOptions.length}`);
} else if (isCli && process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else if (isCli) {
  const t = summary.missingLabelEn.byTier;
  console.log(`fields(total unique keys): ${summary.fieldsTotal}`);
  console.log(`missing label_en: ${summary.missingLabelEn.total}  (wizard ${t.wizard} / standard ${t.standard} / expert ${t.expertTab} / hiddenType ${t.hiddenType})`);
  const d = summary.missingDescEn.byTier;
  console.log(`missing desc_en:  ${summary.missingDescEn.total}  (wizard ${d.wizard} / standard ${d.standard} / expert ${d.expertTab} / hiddenType ${d.hiddenType})`);
  console.log(`options zh-only:  ${summary.optionsZhOnly.total} (with CJK label: ${summary.optionsZhOnly.cjkLabelTotal})`);
  console.log(`orphans: labelsEn ${summary.orphans.labelsEn.length}, descsEn ${summary.orphans.descsEn.length}, optionsEn ${summary.orphans.optionsEn.length}`);
  console.log(`groups missing en: ${JSON.stringify(summary.groupCoverage.groupsMissingEn)}`);
  console.log(`tabs missing en:   ${JSON.stringify(summary.groupCoverage.tabsMissingEn)}`);
  console.log(`bundle dead keys: zh ${deadZh.length}, en ${deadEn.length}${deadOnlyInOne.length ? ` (asymmetric: ${deadOnlyInOne.join(', ')})` : ''}`);
  console.log('\n-- desc 质量审计(功能说明+推荐范围) --');
  for (const [kind, byTier] of Object.entries(descNeedCounts)) {
    const total = Object.values(byTier).reduce((a, b) => a + b, 0);
    console.log(`${kind}: ${total}  (wizard ${byTier.wizard} / standard ${byTier.standard} / expert ${byTier.expertTab} / hiddenType ${byTier.hiddenType})`);
  }
  console.log('\n-- wizard-tier missing label_en --');
  console.log(summary.missingLabelEn.lists.wizard.join(', ') || '(none)');
  console.log('\n-- wizard-tier missing desc_en --');
  console.log(summary.missingDescEn.lists.wizard.join(', ') || '(none)');
  console.log('\n-- dead keys (zh) --');
  console.log(deadZh.sort().join(', ') || '(none)');
}
