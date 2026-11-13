import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sweepExpiredJobs } from '@/lib/jobs/cleanup';
import { ingestLoosePdfs, ingestZip, processJob, resumeUnfinishedJobs, type ProcessDeps } from '@/lib/jobs/process';
import { createJob, deleteJob, jobDir, jobFilesDir, readJob, updateJob } from '@/lib/jobs/store';
import type { Job, PageDetection, SourceFile } from '@/lib/types';
import { UploadTooLargeError } from '@/lib/zip/unpack';
import { makeScanPdf } from '../helpers/makeScan';
import { makeRawZip } from '../helpers/rawZip';

let tmp: string;
let scan4: Buffer;
let scan1: Buffer;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ss-jobs-'));
  process.env.DATA_DIR = join(tmp, 'data');
  scan4 = Buffer.from(await makeScanPdf([{}, {}, {}, {}]));
  scan1 = Buffer.from(await makeScanPdf([{}]));
}, 60_000);
afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(tmp, { recursive: true, force: true });
});

const D = (partName: string | null): PageDetection => ({ partName, confidence: 'high', rawText: '', key: null });

/** Detection without OCR: every page of a combined file gets the next name from the list. */
function fakeDeps(names: (string | null)[], calls: string[] = []): ProcessDeps {
  return {
    async detectFile(path, onPage) {
      calls.push(path);
      names.forEach((_, i) => onPage?.(i + 1, names.length));
      return names.map(D);
    },
  };
}

async function writeZip(name: string, entries: { name: string; data: Buffer | string }[]): Promise<string> {
  const path = join(tmp, name);
  await writeFile(path, makeRawZip(entries));
  return path;
}

const files = (job: Job) => job.pieces.flatMap((p) => p.files);
const byName = (job: Job, name: string) => files(job).find((f) => f.originalName === name) as SourceFile;

it('creates, reads, updates and deletes a job', async () => {
  const job = await createJob('Advent');
  expect(job.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(await readJob(job.id)).toEqual(job);
  const updated = await updateJob(job.id, (j) => ({ ...j, name: 'Advent 2026' }));
  expect(updated.name).toBe('Advent 2026');
  expect((await readJob(job.id))?.name).toBe('Advent 2026');
  await deleteJob(job.id);
  expect(await readJob(job.id)).toBeNull();
  expect(existsSync(jobDir(job.id))).toBe(false);
});

it('does not read or delete outside the jobs folder', async () => {
  expect(await readJob('../../etc')).toBeNull();
  expect(await readJob('')).toBeNull();
  await expect(deleteJob('..')).rejects.toThrow();
});

it('applies concurrent updates one after another without losing any', async () => {
  const job = await createJob('Counter');
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => updateJob(job.id, (j) => ({ ...j, ignored: [...j.ignored, String(i)] }))),
  );
  expect((await readJob(job.id))?.ignored).toHaveLength(25);
});

it('processes a zip into a ready job', async () => {
  const zip = await writeZip('ok.zip', [
    { name: 'Concert/Alladale/Alladale - Partitur.pdf', data: scan1 },
    { name: 'Concert/Alladale/Alladale - Einzelstimmen.pdf', data: scan4 },
    { name: 'Concert/Alladale/Alladale - Solo Cornet.pdf', data: scan1 },
    { name: 'Concert/notes.txt', data: 'x' },
  ]);
  const job = await createJob('upload');
  await ingestZip(job.id, zip, 'Concert.zip');

  const ingested = (await readJob(job.id)) as Job;
  expect(ingested).toMatchObject({ name: 'Concert', status: 'processing', ignored: ['Concert/notes.txt'] });
  expect(files(ingested).every((f) => f.status === 'pending')).toBe(true);

  await processJob(job.id, fakeDeps(['Soprano Cornet', 'Solo Cornet', null, 'Timpani']));
  const done = (await readJob(job.id)) as Job;

  expect(done.status).toBe('ready');
  expect(done.pieces.map((p) => p.name)).toEqual(['Alladale']);
  expect(byName(done, 'Alladale - Partitur.pdf')).toMatchObject({ class: 'score', status: 'done', pageCount: 1, parts: [] });
  expect(byName(done, 'Alladale - Solo Cornet.pdf')).toMatchObject({ class: 'single', status: 'done' });
  expect(byName(done, 'Alladale - Solo Cornet.pdf').parts.map((p) => [p.name, p.pages])).toEqual([['Solo Cornet', [0]]]);
  const combined = byName(done, 'Alladale - Einzelstimmen.pdf');
  expect(combined).toMatchObject({ class: 'combined', status: 'done', pageCount: 4 });
  expect(combined.parts.map((p) => [p.name, p.pages])).toEqual([
    ['Soprano Cornet', [0]],
    ['Solo Cornet', [1, 2]],
    ['Timpani', [3]],
  ]);
  expect(combined.progress).toBeUndefined();
  expect(combined.storedPath.startsWith(jobFilesDir(job.id))).toBe(true);
}, 60_000);

it('marks a PDF that cannot be read as an error and finishes the rest', async () => {
  const zip = await writeZip('bad.zip', [
    { name: 'P/broken - parts.pdf', data: 'this is not a pdf' },
    { name: 'P/empty - parts.pdf', data: '' },
    { name: 'P/P - Partitur.pdf', data: scan1 },
  ]);
  const job = await createJob('upload');
  await ingestZip(job.id, zip, 'bad.zip');
  await processJob(job.id, fakeDeps(['Solo Cornet']));

  const done = (await readJob(job.id)) as Job;
  expect(done.status).toBe('ready');
  for (const name of ['broken - parts.pdf', 'empty - parts.pdf']) {
    expect(byName(done, name).status).toBe('error');
    expect(byName(done, name).error).toMatch(/could not be read/i);
  }
  expect(byName(done, 'P - Partitur.pdf').status).toBe('done');
}, 60_000);

it('marks a file as an error when detection fails, and carries on', async () => {
  const zip = await writeZip('fail.zip', [
    { name: 'P/a - parts.pdf', data: scan4 },
    { name: 'P/P - score.pdf', data: scan1 },
  ]);
  const job = await createJob('upload');
  await ingestZip(job.id, zip, 'fail.zip');
  await processJob(job.id, {
    async detectFile() {
      throw new Error('OCR engine crashed');
    },
  });
  const done = (await readJob(job.id)) as Job;
  expect(done.status).toBe('ready');
  expect(byName(done, 'a - parts.pdf')).toMatchObject({ status: 'error' });
  expect(byName(done, 'P - score.pdf').status).toBe('done');
}, 60_000);

it('rejects a zip over the size limit and one with no PDFs', async () => {
  const big = await writeZip('big.zip', [{ name: 'P/a.pdf', data: Buffer.alloc(3 * 1024 * 1024) }]);
  process.env.MAX_UPLOAD_MB = '0.5';
  try {
    const job = await createJob('upload');
    await expect(ingestZip(job.id, big, 'big.zip')).rejects.toBeInstanceOf(UploadTooLargeError);
  } finally {
    delete process.env.MAX_UPLOAD_MB;
  }
  const none = await writeZip('none.zip', [{ name: 'readme.txt', data: 'x' }]);
  const job = await createJob('upload');
  await expect(ingestZip(job.id, none, 'none.zip')).rejects.toThrow(/no pdf/i);
});

it('ingests loose PDFs as one piece', async () => {
  const job = await createJob('upload');
  const dir = jobFilesDir(job.id);
  await mkdir(dir, { recursive: true });
  const a = join(dir, 'a.pdf');
  const b = join(dir, 'b.pdf');
  await writeFile(a, scan4);
  await writeFile(b, scan1);
  await ingestLoosePdfs(job.id, [
    { originalName: 'Alladale - Einzelstimmen.pdf', storedPath: a },
    { originalName: 'Alladale - Partitur.pdf', storedPath: b },
  ]);
  const ingested = (await readJob(job.id)) as Job;
  expect(ingested.name).toBe('Alladale');
  expect(ingested.pieces.map((p) => [p.name, p.files.length])).toEqual([['Alladale', 2]]);
});

it('resumes files left unfinished by a restart, and only those', async () => {
  const zip = await writeZip('resume.zip', [
    { name: 'P/a - parts.pdf', data: scan4 },
    { name: 'P/b - parts.pdf', data: scan4 },
    { name: 'P/c - parts.pdf', data: scan4 },
  ]);
  const job = await createJob('upload');
  await ingestZip(job.id, zip, 'resume.zip');
  // State as a crash would leave it: one file finished, one mid-way, one not started.
  await updateJob(job.id, (j) => {
    const [a, b] = j.pieces[0].files;
    a.status = 'done';
    a.class = 'combined';
    a.pageCount = 4;
    a.parts = [{ id: 'kept', name: 'Kept', pages: [0, 1, 2, 3], confidence: 'high', flags: [] }];
    b.status = 'processing';
    b.progress = { done: 2, total: 4 };
    return j;
  });

  const calls: string[] = [];
  await resumeUnfinishedJobs(fakeDeps(['Solo Cornet', null, null, null], calls));

  const done = (await readJob(job.id)) as Job;
  // Other tests leave unfinished jobs in the same data folder; count this job's files only.
  expect(calls.filter((c) => c.startsWith(jobFilesDir(job.id)))).toHaveLength(2);
  expect(done.status).toBe('ready');
  expect(byName(done, 'a - parts.pdf').parts[0].name).toBe('Kept');
  expect(byName(done, 'b - parts.pdf')).toMatchObject({ status: 'done' });
  expect(byName(done, 'c - parts.pdf').parts.map((p) => p.name)).toEqual(['Solo Cornet']);
}, 60_000);

it('keeps the class the owner chose when a file is queued again', async () => {
  const zip = await writeZip('reclass.zip', [{ name: 'P/P - Partitur.pdf', data: scan4 }]);
  const job = await createJob('upload');
  await ingestZip(job.id, zip, 'reclass.zip');
  await processJob(job.id, fakeDeps([]));
  expect(byName((await readJob(job.id)) as Job, 'P - Partitur.pdf').class).toBe('score');

  await updateJob(job.id, (j) => {
    Object.assign(j.pieces[0].files[0], { class: 'combined', status: 'pending', parts: [] });
    return { ...j, status: 'processing' };
  });
  await processJob(job.id, fakeDeps(['Solo Cornet', null, 'Timpani', null]));
  const file = byName((await readJob(job.id)) as Job, 'P - Partitur.pdf');
  expect(file).toMatchObject({ class: 'combined', status: 'done' });
  expect(file.parts.map((p) => p.name)).toEqual(['Solo Cornet', 'Timpani']);
}, 60_000);

it('deletes jobs older than the lifetime and keeps newer ones', async () => {
  const old = await createJob('old');
  const fresh = await createJob('fresh');
  const day = 24 * 3600_000;
  await updateJob(fresh.id, (j) => ({ ...j, createdAt: new Date(Date.parse(old.createdAt) + day).toISOString() }));

  const deleted = await sweepExpiredJobs(Date.parse(old.createdAt) + day + 1);
  expect(deleted).toContain(old.id);
  expect(deleted).not.toContain(fresh.id);
  expect(await readJob(old.id)).toBeNull();
  expect(await readJob(fresh.id)).not.toBeNull();
});
