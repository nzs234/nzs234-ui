// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 把 descContent 的英文文案同步进 src/i18n/schemaFieldDescsEn.json。
// 规则：
//   · 仅写「真实存在的字段键」（避免孤儿键，i18nParity 有 orphan 门禁）；
//   · EN 取该键最后一个变体（通用变体）的 en，并按字段类型做 Recommended 归一；
//   · 键序输出、2 空格缩进、结尾换行，与现有文件格式一致。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
// 用全量注册表(含 hidden/disabled 训练类型)建字段类型表:schemaIndex.TRAINING_TYPES 只是
// 侧栏可见的 40 型,曾把 yolo/concept-edit/anima-edit-model/lumina 等隐藏类型独占的字段
// 判成"非字段键"而静默跳过 —— 那是 i18nGapScan 里 hiddenType 档 desc_en 缺口清不掉的原因。
// 孤儿门禁(i18nParity schemaFieldKeys)本来就按全量注册表判定,这里对齐即可。
import { TRAINING_TYPES } from '../src/schema/trainingTypeRegistry.js';
import { getSectionsForType } from '../src/schema/schemaIndex.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const CONTENT = {};
for (const name of readdirSync(join(HERE, 'descContent')).filter((f) => f.endsWith('.mjs'))) {
  const mod = await import(pathToFileURL(join(HERE, 'descContent', name)));
  for (const [k, v] of Object.entries(mod.default ?? {})) {
    if (v == null) continue;
    CONTENT[k] = v; // 后写覆盖：取最终定义即可（EN 只需通用变体）
  }
}

const fieldTypes = new Map();
for (const t of TRAINING_TYPES) {
  for (const sec of getSectionsForType(t.id)) {
    for (const f of sec.fields ?? []) {
      if (!f || !f.key) continue;
      if (!fieldTypes.has(f.key)) fieldTypes.set(f.key, String(f.type ?? ''));
    }
  }
}

function normEn(en, type) {
  if (!en) return en;
  if (type === 'number' || type === 'slider') {
    if (!/recommended\s*:/i.test(en)) {
      const idx = en.lastIndexOf('. ');
      if (idx >= 0) {
        const head = en.slice(0, idx + 1);
        const tail = en.slice(idx + 2);
        return `${head} Recommended: ${tail.charAt(0).toLowerCase()}${tail.slice(1)}`;
      }
      return `Recommended: ${en.charAt(0).toLowerCase()}${en.slice(1)}`;
    }
  }
  return en;
}

const PACK_PATH = join(HERE, '..', 'src', 'i18n', 'schemaFieldDescsEn.json');
const pack = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
let added = 0; let updated = 0; let skippedNonField = 0;
for (const [key, v] of Object.entries(CONTENT)) {
  if (!fieldTypes.has(key)) { skippedNonField++; continue; }
  const variants = Array.isArray(v) && typeof v[0] === 'object' ? v : [{ zh: v[0], en: v[1] }];
  const generic = [...variants].reverse().find((x) => !x.only) ?? variants[variants.length - 1];
  const en = normEn(generic.en, fieldTypes.get(key));
  if (!en) continue;
  if (pack[key] === en) continue;
  if (typeof pack[key] === 'string' && pack[key].trim()) updated++;
  else added++;
  pack[key] = en;
}
const out = JSON.stringify(pack, Object.keys(pack).sort(), 2) + '\n';
writeFileSync(PACK_PATH, out, 'utf8');
console.log(`pack size ${Object.keys(pack).length}, added ${added}, updated ${updated}, skipped non-field keys ${skippedNonField}`);
