import fs from 'fs';
import path from 'path';

const cssFiles = [
  'src/app/app.css',
  'src/theme/base.css',
  'src/theme/components.css',
  'src/pages/train/train.css',
  'src/pages/train/wizard/wizard.css',
  'src/pages/generate/generate.css',
  'src/pages/monitor/monitor.css',
  'src/pages/queue/queue.css',
  'src/pages/resources/resource-center.css',
];

const FRAGMENT_FONT_SIZES = [
  { regex: /(?<![\w-])(font-size|font):\s*([^;]+);/g, type: 'prop' },
  { regex: /font:\s*([0-9\.]+\s+)?(9|9\.5|10|10\.5|11\.5|12\.5)px/g, type: 'shorthand' },
  { regex: /font-size:\s*(9|9\.5|10|10\.5|11\.5|12\.5)px/g, type: 'fontsize' }
];

let totalFragmentMatches = 0;

for (const file of cssFiles) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace fractional / tiny font sizes:
  // 9px, 9.5px, 10px, 10.5px -> var(--lx-text-xs) (11px)
  // 11.5px, 12px -> var(--lx-text-sm) (12px)
  // 12.5px, 13px -> var(--lx-text-base) (13px)
  // 14px -> var(--lx-text-md) (14px)
  // 16px -> var(--lx-text-lg) (16px)
  // 20px -> var(--lx-text-xl) (20px)
  // 24px -> var(--lx-text-2xl) (24px)

  // Replace font-size:
  content = content.replace(/font-size:\s*(9|9\.5|10|10\.5)px/g, 'font-size: var(--lx-text-xs)');
  content = content.replace(/font-size:\s*(11|11\.5)px/g, 'font-size: var(--lx-text-xs)');
  content = content.replace(/font-size:\s*12px/g, 'font-size: var(--lx-text-sm)');
  content = content.replace(/font-size:\s*(12\.5|13)px/g, 'font-size: var(--lx-text-base)');
  content = content.replace(/font-size:\s*14px/g, 'font-size: var(--lx-text-md)');
  content = content.replace(/font-size:\s*16px/g, 'font-size: var(--lx-text-lg)');
  content = content.replace(/font-size:\s*20px/g, 'font-size: var(--lx-text-xl)');
  content = content.replace(/font-size:\s*24px/g, 'font-size: var(--lx-text-2xl)');

  // Replace shorthand font:
  // e.g. font: 700 11px var(--lx-font-mono); -> font: 700 var(--lx-text-xs) var(--lx-font-mono);
  content = content.replace(/font:\s*([0-9]+\s+)?(9|9\.5|10|10\.5|11|11\.5)px(\/[0-9\.]+)?\s+var/g, 'font: $1var(--lx-text-xs)$3 var');
  content = content.replace(/font:\s*([0-9]+\s+)?12px(\/[0-9\.]+)?\s+var/g, 'font: $1var(--lx-text-sm)$3 var');
  content = content.replace(/font:\s*([0-9]+\s+)?(12\.5|13)px(\/[0-9\.]+)?\s+var/g, 'font: $1var(--lx-text-base)$3 var');
  content = content.replace(/font:\s*([0-9]+\s+)?14px(\/[0-9\.]+)?\s+var/g, 'font: $1var(--lx-text-md)$3 var');
  content = content.replace(/font:\s*([0-9]+\s+)?16px(\/[0-9\.]+)?\s+var/g, 'font: $1var(--lx-text-lg)$3 var');

  // Replace radius literals:
  // border-radius: 4px -> border-radius: var(--lx-radius-sm, 4px)
  // border-radius: 6px -> border-radius: var(--lx-radius, 6px)
  // border-radius: 8px -> border-radius: var(--lx-radius-md, 8px)
  // border-radius: 10px -> border-radius: var(--lx-radius-lg, 10px)

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated typography/radius in:', file);
  }
}
