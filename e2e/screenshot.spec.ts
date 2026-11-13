// Regenerates docs/screenshot.png from generated pages (never real sheet music):
//
//   UPDATE_SCREENSHOT=1 npx playwright test screenshot
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeScanPdf } from '../tests/helpers/makeScan';
import { makeRawZip } from '../tests/helpers/rawZip';

test.skip(!process.env.UPDATE_SCREENSHOT, 'only runs when UPDATE_SCREENSHOT is set');

const set = (title: string, labels: (string | null)[]) =>
  makeScanPdf(
    labels.map((left) => (left === null ? {} : { left, centre: [title, 'for brass band'], right: 'arr. A. Composer' })),
  );

test('capture the review screen', async ({ page }) => {
  const zip = makeRawZip([
    {
      name: 'Winter Concert/Northern Lights/Northern Lights - parts.pdf',
      data: Buffer.from(
        await set('NORTHERN LIGHTS', [
          'Soprano Eb Cornet',
          'Solo Bb Cornet',
          null,
          'Repiano Bb Cornet',
          '2nd Bb Cornet',
          '3rd Bb Cornet',
          'Bb Flugelhorn',
          'Solo Eb Horn',
          '1st Eb Horn',
          '1st Bb Baritone',
          '1st Bb Trombone',
          '1st Trombone',
          'Bass Trombone',
          'Bb Euphonium',
          null,
          'Eb Bass',
          'Bb Bass',
          'Timpani',
        ]),
      ),
    },
    { name: 'Winter Concert/Northern Lights/Northern Lights - score.pdf', data: Buffer.from(await set('NORTHERN LIGHTS', ['Full Score', null])) },
    {
      name: 'Winter Concert/Evening Hymn/Evening Hymn - Einzelstimmen.pdf',
      data: Buffer.from(await set('EVENING HYMN', ['Solo Cornet', 'Solo Cornet', '2nd Cornet', 'Solo Horn', 'Euphonium', 'Eb Bass'])),
    },
  ]);
  const zipPath = join(mkdtempSync(join(tmpdir(), 'ss-shot-')), 'Winter Concert.zip');
  writeFileSync(zipPath, zip);

  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(zipPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Winter Concert' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('file-reading')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('part-group').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => [...document.images].every((img) => img.complete || img.loading === 'lazy'));
  await page.screenshot({ path: 'docs/screenshot.png' });
});
