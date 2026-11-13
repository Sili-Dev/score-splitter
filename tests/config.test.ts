import { expect, it } from 'vitest';
import { getConfig } from '@/lib/config';

it('uses defaults', () => {
  expect(getConfig({})).toEqual({
    dataDir: './data',
    maxUploadBytes: 500 * 1024 * 1024,
    jobTtlMs: 24 * 3600_000,
    ocrConcurrency: 2,
  });
});

it('reads overrides', () => {
  const c = getConfig({ MAX_UPLOAD_MB: '10', JOB_TTL_HOURS: '1', OCR_CONCURRENCY: '4', DATA_DIR: '/data' });
  expect(c).toEqual({ dataDir: '/data', maxUploadBytes: 10 * 1024 * 1024, jobTtlMs: 3600_000, ocrConcurrency: 4 });
});

it('falls back to the default on a non-numeric or non-positive value', () => {
  expect(getConfig({ MAX_UPLOAD_MB: 'abc', OCR_CONCURRENCY: '0' })).toMatchObject({
    maxUploadBytes: 500 * 1024 * 1024,
    ocrConcurrency: 2,
  });
});
