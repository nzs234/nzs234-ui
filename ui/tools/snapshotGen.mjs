// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 生成当前快照 JSON 到指定路径（复用 schemaParitySnapshot 的构建逻辑，不经 --check/--capture 分支）。
import { writeFileSync } from 'node:fs';

// 去掉 CLI 分支后按模块求值：直接 import 会执行 CLI，因此这里复制核心逻辑。
import { TRAINING_TYPES, getSectionsForType, createDefaultConfig, getAvailableTabs, buildRunConfig } from '../src/schema/schemaIndex.js';
import { createHash } from 'node:crypto';

const fnReplacer = (_k, v) => (typeof v === 'function' ? '\u0192' : v);
function fieldsOf(typeId) {
  const out = [];
  for (const section of getSectionsForType(typeId)) for (const f of section.fields || []) out.push(f);
  return out;
}
function optionValue(opt) { return opt && typeof opt === 'object' ? opt.value : opt; }
function optionsFor(field, config) {
  const raw = typeof field.options === 'function' ? field.options(config) : field.options;
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : Array.from(raw);
}
function permutations(typeId) {
  const base = createDefaultConfig(typeId);
  const variants = [['default', base]];
  for (const f of fieldsOf(typeId)) {
    if (!f || !f.key) continue;
    if (f.type === 'boolean') variants.push([`bool:${f.key}=${!base[f.key]}`, { ...base, [f.key]: !base[f.key] }]);
    else if (f.type === 'select') for (const opt of optionsFor(f, base)) variants.push([`sel:${f.key}=${optionValue(opt)}`, { ...base, [f.key]: optionValue(opt) }]);
  }
  return variants;
}
function safe(fn) { try { return { ok: fn() }; } catch (e) { return { err: String(e && e.message ? e.message : e) }; } }
function sha256Json(value) { return createHash('sha256').update(JSON.stringify(value, fnReplacer), 'utf8').digest('hex'); }

const snap = {};
for (const t of TRAINING_TYPES) {
  const typeId = t.id;
  const runConfigs = {};
  for (const [label, cfg] of permutations(typeId)) runConfigs[label] = sha256Json(safe(() => buildRunConfig(cfg, typeId)));
  snap[typeId] = {
    sections: safe(() => getSectionsForType(typeId)),
    defaults: safe(() => createDefaultConfig(typeId)),
    tabs: safe(() => getAvailableTabs(typeId)),
    runConfigs,
  };
}
const out = JSON.stringify(snap, fnReplacer, 1);
writeFileSync(process.argv[2], out, 'utf8');
console.log(`snapshot written: ${process.argv[2]} (${out.length} bytes)`);
