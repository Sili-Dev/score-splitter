import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
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

it('rejects a file that is not a PDF', async () => {
  const path = join(tmp, 'c.pdf');
  await writeFile(path, 'not a pdf');
  await expect(openPdf(path)).rejects.toThrow();
});
