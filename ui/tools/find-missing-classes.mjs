import fs from 'fs';
import path from 'path';

const cssClasses = new Set();
function scanCss(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git') scanCss(full);
    } else if (full.endsWith('.css')) {
      const txt = fs.readFileSync(full, 'utf8');
      const matches = txt.match(/\.([a-zA-Z0-9_-]+)/g);
      if (matches) {
        matches.forEach(m => cssClasses.add(m.slice(1)));
      }
    }
  }
}
scanCss('./src');

const usedClasses = new Set();
function scanJsx(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git') scanJsx(full);
    } else if (full.endsWith('.tsx') || full.endsWith('.jsx')) {
      const txt = fs.readFileSync(full, 'utf8');
      const m1 = txt.match(/className=(?:["']([^"']+)["']|\{`([^`]+)`\}|\[([^\]]+)\])/g);
      if (m1) {
        m1.forEach(c => {
          const raw = c.replace(/className=/, '').replace(/^["'{\[]+/, '').replace(/["'}\]]+$/, '');
          const words = raw.match(/[a-zA-Z0-9_-]+/g);
          if (words) {
            words.forEach(w => {
              if (w.startsWith('lx-')) usedClasses.add(w);
            });
          }
        });
      }
    }
  }
}
scanJsx('./src');

const missing = [];
for (const cls of usedClasses) {
  if (cls.startsWith('lx-') && !cssClasses.has(cls)) {
    missing.push(cls);
  }
}
console.log('Missing lx-* CSS classes count:', missing.length);
console.log('Missing lx-* CSS classes:', missing.sort());
