// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 一次性盘点辅助：导出全部需要文案补全的可见层字段（tier<=2）
//   key | type | tier | oldDesc(可空) | defaultValue | min/max
// 供 descContent 编写时核对锚点。用法：node tools/descInventory.mjs [outPath]
import { TRAINING_TYPES, getSectionsForType, createDefaultConfig, isFieldVisible } from '../src/schema/schemaIndex.js';
import { writeFileSync } from 'node:fs';

const STANDARD_TABS = new Set(['model', 'dataset', 'contract', 'training', 'network', 'optimizer', 'preview', 'speed']);
const RECOMMEND = '推荐范围：';
const ADVICE_RE = /(建议|推荐|优先|适合|保持默认|何时选|开启|关闭时)/;

function safe(fn, f) { try { return fn(); } catch { return f; } }
function needsWork(f) {
  const zh = String(f.desc_zh ?? f.desc ?? '').trim();
  if (!zh) return 'missing_desc';
  const t = String(f.type ?? '');
  if (t === 'number' || t === 'slider') return zh.includes(RECOMMEND) ? null : 'no_recommend';
  if (t === 'boolean' || t === 'select' || t === 'multiSelect') return ADVICE_RE.test(zh) ? null : 'no_advice';
  return null;
}

const def = new Map();
for (const type of TRAINING_TYPES) {
  const typeHidden = Boolean(type.hidden || type.disabled);
  const defaults = safe(() => createDefaultConfig(type.id), {});
  for (const sec of safe(() => getSectionsForType(type.id), [])) {
    if (sec.hidden) continue;
    const expert = sec.tab === 'advanced' || sec.tab === 'frontier' || sec.expert === true;
    for (const f of sec.fields || []) {
      if (!f || !f.key || f.type === 'hidden') continue;
      const tier = typeHidden ? 3 : (expert ? 2 : (STANDARD_TABS.has(sec.tab) && safe(() => isFieldVisible(f, defaults), false) ? 0 : 1));
      const nw = needsWork(f);
      if (!nw && tier > 2) continue;
      const k = f.key;
      if (!def.has(k)) def.set(k, { key: k, type: f.type, tier: 9, need: '', desc: '', dv: '', mm: '' });
      const e = def.get(k);
      e.tier = Math.min(e.tier, tier);
      if (nw && !e.need) e.need = nw;
      if (!e.desc && f.desc) e.desc = String(f.desc);
      e.dv = e.dv || String(f.defaultValue ?? '');
      e.mm = e.mm || `${f.min ?? ''}-${f.max ?? ''}`;
    }
  }
}
const rows = [...def.values()].filter((e) => e.tier <= 2 && e.need).sort((a, b) => a.tier - b.tier || a.key.localeCompare(b.key));
const out = rows.map((e) => [e.tier, e.key, e.type, e.need, e.mm, e.dv.slice(0, 24), e.desc].join('\t')).join('\n') + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], out, 'utf8');
else process.stdout.write(out);
console.error(`entries: ${rows.length}`);
