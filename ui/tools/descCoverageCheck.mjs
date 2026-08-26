// SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
// 核对内容表覆盖度：列出清单中尚未被任何内容模块覆盖的键。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const covered = new Set();
for (const name of readdirSync(join(HERE, 'descContent')).filter((f) => f.endsWith('.mjs'))) {
  const mod = await import(pathToFileURL(join(HERE, 'descContent', name)));
  for (const [k, v] of Object.entries(mod.default ?? {})) {
    if (v != null) covered.add(k);
  }
}
const tsv = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const missing = [];
for (const line of tsv) {
  const [tier, key, type, need] = line.split('\t');
  if (!covered.has(key)) missing.push(`${tier}\t${key}\t${type}\t${need}`);
}
console.error(`covered ${covered.size}, missing ${missing.length}`);
console.log(missing.join('\n'));
