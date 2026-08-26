// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 把 tools/descContent/* 的文案应用到 schema 源文件的内联 zh desc。
// 规则：
//   · 仅替换 desc 字面量（单/双引号字符串），不触碰 label/options/visibleWhen/defaultValue；
//   · 变体 { only } 要求当前 desc 包含该子串才替换（家族差异锚定）；
//   · 无 desc 的定义按「最后一个无 only 变体」插入到 type: '…', 之后；
//   · 跳过 type:'hidden' 与 LEGACY_BACKEND_FIELD_HIDDEN 门控的定义；
//   · 输出每个键的命中统计与零命中清单，供人工复核。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, '..', 'src', 'schema');

const CONTENT = {};
for (const name of readdirSync(join(HERE, 'descContent')).filter((f) => f.endsWith('.mjs'))) {
  const mod = await import(pathToFileURL(join(HERE, 'descContent', name)));
  for (const [k, v] of Object.entries(mod.default ?? {})) {
    if (v == null) continue;
    const variants = Array.isArray(v) && typeof v[0] === 'object' && !Array.isArray(v[0]) ? v : [{ zh: v[0], en: v[1] }];
    if (!CONTENT[k]) CONTENT[k] = [];
    for (const item of variants) CONTENT[k].push({ zh: item.zh ?? item[0], en: item.en ?? item[1], only: item.only });
  }
}

const FILES = [
  'animaSchema.js', 'conceptEditUnifiedSchema.js', 'experimentalTrainingSchemas.js',
  'ltx2Schemas.js', 'minimaxH3Schema.js', 'otherDitSchemas.js', 'otherSchemas.js',
  'schemaCommon.js', 'schemaFieldGroups.js', 'schemaFrontierGroups.js', 'sdxlSchema.js',
  'universalDitFields.js', 'features/optimizerParams.js', 'features/settingsOptions.js',
];

const KEY_RE = /\bkey:\s*'([A-Za-z0-9_]+)'/g;
const DESC_RE = /\bdesc:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

/** 从 key 位置向前找字段对象起点 `{`，再做括号配对（跳过字符串字面量）返回对象区间。 */
function fieldObjectRange(text, keyIndex) {
  const objStart = text.lastIndexOf('{', keyIndex);
  if (objStart < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = objStart; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return [objStart, i + 1];
    }
  }
  return null;
}

function decode(raw) {
  const body = raw.slice(1, -1);
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, g) => {
    if (g.startsWith('u') || g.startsWith('x')) return String.fromCharCode(parseInt(g.slice(1), 16));
    switch (g) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '';
      default: return g; // \' \" \\ etc.
    }
  });
}

function encode(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function pickVariant(variants, currentDesc) {
  for (const v of variants) {
    if (v.only) {
      if (currentDesc && currentDesc.includes(v.only)) return v;
      continue;
    }
    return v;
  }
  // 只有带 only 的变体而当前 desc 不满足 → 不动
  return null;
}

/** 数值型字段统一「推荐范围：」/ "Recommended:" 句式；布尔/枚举保持建议式原文。 */
function adaptToType(variant, type) {
  let zh = variant.zh;
  let en = variant.en;
  if (type === 'number' || type === 'slider') {
    if (!zh.includes('推荐范围：')) {
      if (zh.includes('。建议')) zh = zh.replace(/。建议/, '。推荐范围：');
      else if (zh.startsWith('建议')) zh = zh.replace(/^建议/, '推荐范围：');
    }
    if (en && !/recommended\s*:/i.test(en)) {
      const idx = en.lastIndexOf('. ');
      if (idx >= 0) {
        const head = en.slice(0, idx + 1);
        const tail = en.slice(idx + 2);
        en = `${head} Recommended: ${tail.charAt(0).toLowerCase()}${tail.slice(1)}`;
      } else {
        en = `Recommended: ${en.charAt(0).toLowerCase()}${en.slice(1)}`;
      }
    }
  }
  return { zh, en };
}

const stats = new Map(); // key -> { replaced, inserted, skipped }
function bump(key, kind) {
  const s = stats.get(key) || { replaced: 0, inserted: 0 };
  s[kind] += 1;
  stats.set(key, s);
}

for (const rel of FILES) {
  const path = join(SCHEMA_DIR, rel);
  const text = readFileSync(path, 'utf8');
  const marks = [...text.matchAll(KEY_RE)];
  let out = '';
  let cursor = 0;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const start = m.index;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    out += text.slice(cursor, start);
    const chunk = text.slice(start, end);
    cursor = end;

    const key = m[1];
    const variants = CONTENT[key];
    if (!variants) { out += chunk; continue; }

    const range = fieldObjectRange(text, start + 4);
    if (range) {
      // 只在字段对象本体（key→闭合括号）内做类型判定与 desc 定位
      const body = chunk.slice(0, Math.max(0, range[1] - start));
      const tail = chunk.slice(Math.max(0, range[1] - start));

      const isHiddenField = /type:\s*'hidden'/.test(body);
      const isLegacyGated = /LEGACY_BACKEND_FIELD_HIDDEN/.test(body);
      if (isHiddenField || isLegacyGated) { out += chunk; continue; }

      DESC_RE.lastIndex = 0;
      const dm = DESC_RE.exec(body);
      const fieldType = (() => {
        const tm = /\btype:\s*'([a-zA-Z]+)'/.exec(body);
        return tm ? tm[1] : '';
      })();
      let nextBody = null;
      if (dm) {
        const picked = pickVariant(variants, decode(dm[1]));
        const variant = picked ? adaptToType(picked, fieldType) : null;
        if (variant && decode(dm[1]) !== variant.zh) {
          nextBody = body.slice(0, dm.index) + `desc: '${encode(variant.zh)}'` + body.slice(dm.index + dm[0].length);
          bump(key, 'replaced');
        }
      } else {
        const fallbackRaw = variants.find((v) => !v.only);
        const fallback = fallbackRaw ? adaptToType(fallbackRaw, fieldType) : null;
        const tm = /(\btype:\s*'(?:[^'\\]*)'\s*,)/.exec(body);
        if (fallback && tm) {
          nextBody = body.slice(0, tm.index + tm[0].length) + ` desc: '${encode(fallback.zh)}',` + body.slice(tm.index + tm[0].length);
          bump(key, 'inserted');
        }
      }
      out += (nextBody ?? body) + tail;
      continue;
    }
    out += chunk;
  }
  out += text.slice(cursor);
  if (out !== text) writeFileSync(path, out, 'utf8');
}

let touched = 0; const zero = [];
for (const key of Object.keys(CONTENT).sort()) {
  const s = stats.get(key);
  if (!s) zero.push(key);
  else touched += 1;
}
console.log(`content keys: ${Object.keys(CONTENT).length}, applied: ${touched}, zero-hit: ${zero.length}`);
if (zero.length) console.log(`zero-hit keys:\n${zero.join('\n')}`);
