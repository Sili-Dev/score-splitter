// Runs part detection over a folder of PDFs and prints what it found.
// For tuning detection against real scans, which must stay out of the repo:
//
//   npm run probe -- <folder> [--raw] [--all]
//
// --raw  also print the OCR text of each page header
// --all  include files that look like scores or single parts
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { detectFile } from '@/lib/detect';
import { groupPages } from '@/lib/detect/group';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.name.toLowerCase().endsWith('.pdf')) out.push(path);
  }
  return out.sort();
}

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const raw = args.includes('--raw');
const all = args.includes('--all');
if (!root) {
  console.error('usage: npm run probe -- <folder> [--raw] [--all]');
  process.exit(1);
}

const combined = /stimmen|parts/i;
for (const file of await walk(root)) {
  if (!all && !combined.test(basename(file))) continue;
  const started = Date.now();
  const detections = await detectFile(file, undefined, 2);
  const parts = groupPages(detections);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== ${file}`);
  console.log(`    ${detections.length} pages, ${parts.length} parts, ${seconds}s`);
  if (raw) {
    detections.forEach((d, i) => {
      const text = d.rawText.replace(/\s+/g, ' ').slice(0, 110);
      console.log(`    p${String(i + 1).padStart(2)} ${(d.partName ?? '-').padEnd(20)} ${d.confidence.padEnd(4)} | ${text}`);
    });
  }
  for (const p of parts) {
    const pages = p.pages.map((n) => n + 1).join(',');
    console.log(`    ${p.confidence === 'low' ? '?' : ' '} ${p.name.padEnd(22)} p${pages}  ${p.flags.join(' ')}`);
  }
}
