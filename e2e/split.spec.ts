import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import yauzl from 'yauzl';
import { makeScanPdf } from '../tests/helpers/makeScan';
import { makeRawZip } from '../tests/helpers/rawZip';

const sub = ['TEST PIECE', 'for brass band'];
const header = (left: string) => ({ left, centre: sub, right: 'A. Composer' });

async function pageCounts(zipPath: string): Promise<Record<string, number>> {
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) =>
    yauzl.open(zipPath, { lazyEntries: true }, (e, z) => (e || !z ? fail(e) : ok(z))),
  );
  const out: Record<string, number> = {};
  await new Promise<void>((done, fail) => {
    zip.on('end', done);
    zip.on('error', fail);
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err);
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', async () => {
          out[entry.fileName] = (await PDFDocument.load(Buffer.concat(chunks))).getPageCount();
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  return out;
}

test('upload a set, fix a split, download the parts', async ({ page }) => {
  // Page 4 is really the 1st Horn part, but its header is blank, as on a poor scan.
  const parts = await makeScanPdf([header('Soprano Cornet'), header('Solo Cornet'), {}, {}, header('Timpani')]);
  const score = await makeScanPdf([{ centre: sub }, {}]);
  const dir = mkdtempSync(join(tmpdir(), 'ss-e2e-'));
  const zipPath = join(dir, 'Concert.zip');
  writeFileSync(
    zipPath,
    makeRawZip([
      { name: 'Concert/Test Piece/Test Piece - parts.pdf', data: Buffer.from(parts) },
      { name: 'Concert/Test Piece/Test Piece - score.pdf', data: Buffer.from(score) },
    ]),
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(zipPath);

  await expect(page).toHaveURL(/\/jobs\/[A-Za-z0-9_-]{12}$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Concert' })).toBeVisible();

  // The unlabelled page was attached to Solo Cornet: three parts.
  const groups = page.getByTestId('part-group');
  await expect(groups).toHaveCount(3, { timeout: 120_000 });
  await expect(page.getByTestId('part-name').nth(1)).toHaveValue('Solo Cornet');
  const download = page.getByRole('button', { name: 'Download zip' });
  await expect(download).toBeEnabled();

  // Cut after the third page: the fourth becomes a part of its own, without a name.
  await page.getByTestId('cut-after-page-2').click();
  await expect(groups).toHaveCount(4);
  await expect(page.getByTestId('part-name').nth(2)).toHaveValue('Unbekannt 1');
  await expect(download).toBeDisabled();

  await page.getByTestId('part-name').nth(2).fill('1st Horn');
  await page.getByTestId('part-name').nth(2).press('Enter');
  await expect(download).toBeEnabled();

  // The edit was saved on the server, not just shown.
  await page.reload();
  await expect(page.getByTestId('part-name').nth(2)).toHaveValue('1st Horn');

  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(file.suggestedFilename()).toBe('Concert.zip');
  const saved = join(dir, 'out.zip');
  await file.saveAs(saved);

  expect(await pageCounts(saved)).toEqual({
    'Concert/Test Piece/Test Piece - Partitur.pdf': 2,
    'Concert/Test Piece/Test Piece - Soprano Cornet.pdf': 1,
    'Concert/Test Piece/Test Piece - Solo Cornet.pdf': 2,
    'Concert/Test Piece/Test Piece - 1st Horn.pdf': 1,
    'Concert/Test Piece/Test Piece - Timpani.pdf': 1,
  });
});

test('says so when the upload is not a zip or PDF', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('p[role=alert]')).toContainText(/zip file, or one or more PDFs/i);
  await expect(page).toHaveURL(/\/$/);
});

test('says so when an upload no longer exists', async ({ page }) => {
  await page.goto('/jobs/aaaaaaaaaaaa');
  await expect(page.getByText(/no longer exists/i)).toBeVisible();
});
