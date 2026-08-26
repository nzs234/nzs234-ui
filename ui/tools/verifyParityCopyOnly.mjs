// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 核对 parity 快照差异全部为文案键（label/desc/title），payload hash / 默认值 / 页签不得变化。
// 用法：node tools/verifyParityCopyOnly.mjs <oldBaseline.json> <newBaseline.json>
import { readFileSync } from 'node:fs';

const [oldPath, newPath] = process.argv.slice(2);
const oldSnap = JSON.parse(readFileSync(oldPath, 'utf8'));
const newSnap = JSON.parse(readFileSync(newPath, 'utf8'));

const COPY_PROPS = new Set(['desc', 'label', 'title']);
const violations = [];
const copyChanges = [];

function walk(path, a, b) {
  if (a === b) return;
  const bothObj = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
  if (bothObj) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(`${path}.${k}`, a[k], b[k]);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { violations.push(`${path}: array length ${a.length} -> ${b.length}`); return; }
    for (let i = 0; i < a.length; i++) walk(`${path}[${i}]`, a[i], b[i]);
    return;
  }
  const prop = path.split('.').pop();
  if (COPY_PROPS.has(prop)) copyChanges.push(path);
  else violations.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`);
}

const types = new Set([...Object.keys(oldSnap), ...Object.keys(newSnap)]);
for (const type of types) {
  const o = oldSnap[type];
  const n = newSnap[type];
  if (!o || !n) { violations.push(`${type}: side missing`); continue; }
  // payload hash / 默认值 / 页签必须逐字节一致
  if (JSON.stringify(o.defaults) !== JSON.stringify(n.defaults)) violations.push(`${type}.defaults differ`);
  if (JSON.stringify(o.tabs) !== JSON.stringify(n.tabs)) violations.push(`${type}.tabs differ`);
  const labels = new Set([...Object.keys(o.runConfigs ?? {}), ...Object.keys(n.runConfigs ?? {})]);
  for (const lbl of labels) {
    if ((o.runConfigs ?? {})[lbl] !== (n.runConfigs ?? {})[lbl]) {
      violations.push(`${type}.runConfigs['${lbl}'] hash changed`);
      break;
    }
  }
  walk(`${type}.sections`, o.sections, n.sections);
}

console.log(`copy-key changes: ${copyChanges.length}`);
if (violations.length) {
  console.log(`VIOLATIONS: ${violations.length}`);
  for (const v of violations.slice(0, 20)) console.log('  ' + v);
  process.exit(1);
}
console.log('OK — diff is strictly copy-class (label/desc/title); payloads, defaults and tabs unchanged.');
