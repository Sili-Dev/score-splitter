import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { detectFile } from '@/lib/detect';
import { groupPages } from '@/lib/detect/group';
import { openPdf } from '@/lib/pdf/render';
import { makeScanPdf } from '../helpers/makeScan';

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ss-detect-'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const sub = ['ALLADALE', 'from Hymn of the Highlands', 'Flugel Horn, Horn & Baritone Trio'];

it('detects parts on an image-only PDF shaped like the Alladale scan', async () => {
  const pdf = await makeScanPdf([
    { left: 'Eb Soprano Cornet', centre: sub, right: 'Philip Sparke' },
    { left: 'Solo Bb Cornet', centre: sub, right: 'Philip Sparke' },
    {}, // continuation page
    { left: '1st Bb Baritone', centre: sub, right: 'Philip Sparke' },
  ]);
  const path = join(tmp, 'a.pdf');
  await writeFile(path, pdf);

  const progress: [number, number][] = [];
  const parts = groupPages(await detectFile(path, (done, total) => progress.push([done, total])));

  expect(parts.map((p) => [p.name, p.pages])).toEqual([
    ['Soprano Cornet', [0]],
    ['Solo Cornet', [1, 2]],
    ['1st Baritone', [3]],
  ]);
  expect(parts.every((p) => p.confidence === 'high')).toBe(true);
  expect(progress.at(-1)).toEqual([4, 4]);
}, 120_000);

it('detects parts on pages scanned sideways or upside down', async () => {
  const pdf = await makeScanPdf([
    { left: 'Eb Soprano Cornet', centre: sub, right: 'Philip Sparke', turned: 90 },
    { turned: 90 }, // continuation page
    { left: 'Solo Bb Cornet', centre: sub, right: 'Philip Sparke', turned: 180 },
    { left: '1st Bb Baritone', centre: sub, right: 'Philip Sparke', turned: 270 },
    { left: 'Timpani', centre: sub, right: 'Philip Sparke' },
  ]);
  const path = join(tmp, 'turned.pdf');
  await writeFile(path, pdf);

  const detections = await detectFile(path);
  // Turning each page by this undoes how it was scanned.
  expect(detections.map((d) => d.rotation)).toEqual([270, 270, 180, 90, 0]);
  const parts = groupPages(detections);
  expect(parts.map((p) => [p.name, p.pages])).toEqual([
    ['Soprano Cornet', [0, 1]],
    ['Solo Cornet', [2]],
    ['1st Baritone', [3]],
    ['Timpani', [4]],
  ]);
}, 180_000);

it('renders a JPEG thumbnail at the requested width', async () => {
  const path = join(tmp, 'b.pdf');
  await writeFile(path, await makeScanPdf([{ left: 'Timpani' }]));
  const pdf = await openPdf(path);
  try {
    expect(pdf.pageCount).toBe(1);
    const jpg = await pdf.renderThumb(0, 240);
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpg.length).toBeGreaterThan(1000);
  } finally {
    await pdf.close();
  }
}, 60_000);

it('renders a turned thumbnail upright', async () => {
  const path = join(tmp, 'sideways.pdf');
  await writeFile(path, await makeScanPdf([{ left: 'Timpani', turned: 90 }]));
  const pdf = await openPdf(path);
  try {
    const size = async (rotation?: 0 | 270) => {
      const png = await pdf.renderThumb(0, 240, rotation);
      // JPEG SOF0/SOF2 marker holds the height then the width.
      const at = png.findIndex((b, i) => b === 0xff && (png[i + 1] === 0xc0 || png[i + 1] === 0xc2));
      return { height: png.readUInt16BE(at + 5), width: png.readUInt16BE(at + 7) };
    };
    const asScanned = await size();
    const upright = await size(270);
    expect(asScanned.width).toBe(240);
    expect(asScanned.height).toBeLessThan(240);
    expect(upright.width).toBe(240);
    expect(upright.height).toBeGreaterThan(240);
  } finally {
    await pdf.close();
  }
}, 60_000);

it('rejects a file that is not a PDF', async () => {
  const path = join(tmp, 'c.pdf');
  await writeFile(path, 'not a pdf');
  await expect(openPdf(path)).rejects.toThrow();
});

it('finds the fonts pdf.js needs for text that does not embed its own', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  doc.addPage([595, 842]).drawText('Solo Cornet', { x: 40, y: 780, size: 14, font });
  const path = join(tmp, 'text.pdf');
  await writeFile(path, await doc.save());

  const logged: string[] = [];
  const spies = (['log', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args.join(' '))),
  );
  try {
    const pdf = await openPdf(path, { warnings: true });
    await pdf.renderThumb(0, 240);
    await pdf.close();
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
  expect(logged.filter((l) => /unable to load|font data/i.test(l))).toEqual([]);
}, 60_000);
