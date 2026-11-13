import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { GET as exportZip } from '@/app/api/jobs/[id]/export/route';
import { GET as thumb } from '@/app/api/jobs/[id]/files/[fileId]/pages/[page]/route';
import { DELETE as remove, GET as show, PATCH as edit } from '@/app/api/jobs/[id]/route';
import { POST as upload } from '@/app/api/jobs/route';
import type { JobView } from '@/lib/jobs/view';
import { jobDir } from '@/lib/jobs/store';
import { makeScanPdf } from '../helpers/makeScan';
import { makeRawZip } from '../helpers/rawZip';

let tmp: string;
let parts: Buffer;
let score: Buffer;

const sub = ['TEST PIECE', 'for brass band'];
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ss-api-'));
  process.env.DATA_DIR = join(tmp, 'data');
  parts = Buffer.from(
    await makeScanPdf([
      { left: 'Soprano Cornet', centre: sub, right: 'A. Composer' },
      { left: 'Solo Cornet', centre: sub, right: 'A. Composer' },
      {},
      { left: 'Timpani', centre: sub, right: 'A. Composer' },
    ]),
  );
  score = Buffer.from(await makeScanPdf([{ centre: sub }]));
}, 60_000);
afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(tmp, { recursive: true, force: true, maxRetries: 5 });
});

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const url = (path: string) => `http://localhost${path}`;

function post(files: { name: string; data: Buffer | string; type?: string }[]): Promise<Response> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.data as BlobPart], { type: f.type ?? 'application/pdf' }), f.name);
  return upload(new Request(url('/api/jobs'), { method: 'POST', body: form }));
}

const zipOf = (entries: { name: string; data: Buffer | string }[]) => ({
  name: 'Concert.zip',
  data: makeRawZip(entries),
  type: 'application/zip',
});

async function view(id: string): Promise<JobView> {
  const res = await show(new Request(url(`/api/jobs/${id}`)), ctx({ id }));
  expect(res.status).toBe(200);
  return res.json();
}

async function ready(id: string): Promise<JobView> {
  for (let i = 0; i < 600; i++) {
    const job = await view(id);
    if (job.status === 'ready') return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('job never became ready');
}

async function patch(id: string, body: unknown): Promise<Response> {
  return edit(
    new Request(url(`/api/jobs/${id}`), { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    ctx({ id }),
  );
}

async function jobsOnDisk(): Promise<string[]> {
  const dir = join(tmp, 'data', 'jobs');
  return existsSync(dir) ? readdir(dir) : [];
}

it('answers the health check', async () => {
  const res = await health();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

describe('a zip upload, start to finish', () => {
  let id: string;
  let job: JobView;

  it('accepts the upload and reads it in the background', async () => {
    const res = await post([
      zipOf([
        { name: 'Concert/Test Piece/Test Piece - parts.pdf', data: parts },
        { name: 'Concert/Test Piece/Test Piece - score.pdf', data: score },
      ]),
    ]);
    expect(res.status).toBe(201);
    ({ id } = await res.json());
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);

    job = await ready(id);
    expect(job.name).toBe('Concert');
    expect(job.pieces).toHaveLength(1);
    const combined = job.pieces[0].files.find((f) => f.class === 'combined')!;
    expect(combined.parts.map((p) => [p.name, p.pages])).toEqual([
      ['Soprano Cornet', [0]],
      ['Solo Cornet', [1, 2]],
      ['Timpani', [3]],
    ]);
    expect(job.problems.blocking).toEqual([]);
    expect(Date.parse(job.expiresAt) - Date.parse(job.createdAt)).toBe(24 * 3600_000);
  }, 180_000);

  it('does not reveal where files are stored on the server', () => {
    expect(JSON.stringify(job)).not.toContain('storedPath');
    expect(JSON.stringify(job)).not.toContain(tmp.replace(/\\/g, '\\\\'));
  });

  it('serves a page thumbnail, and caches it', async () => {
    const fileId = job.pieces[0].files.find((f) => f.class === 'combined')!.id;
    const get = (page: string, query = '') =>
      thumb(new Request(url(`/api/jobs/${id}/files/${fileId}/pages/${page}${query}`)), ctx({ id, fileId, page }));

    const res = await get('1', '?w=240');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('private');
    const first = Buffer.from(await res.arrayBuffer());
    expect(first.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(Buffer.from(await (await get('1', '?w=240')).arrayBuffer()).equals(first)).toBe(true);

    expect((await get('4')).status).toBe(404);
    expect((await get('-1')).status).toBe(404);
    expect((await get('abc')).status).toBe(404);
    expect((await get('1', '?w=999999')).status).toBe(200);
    expect(
      (await thumb(new Request(url(`/api/jobs/${id}/files/nope/pages/0`)), ctx({ id, fileId: 'nope', page: '0' }))).status,
    ).toBe(404);
  }, 60_000);

  it('applies an edit and reports what now blocks the export', async () => {
    const file = job.pieces[0].files.find((f) => f.class === 'combined')!;
    const res = await patch(id, { op: 'split', fileId: file.id, partId: file.parts[1].id, atPage: 2 });
    expect(res.status).toBe(200);
    job = await res.json();
    expect(job.problems.blocking).toEqual(['Test Piece: Unbekannt 1']);

    const blocked = await exportZip(new Request(url(`/api/jobs/${id}/export`)), ctx({ id }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).blocking).toEqual(['Test Piece: Unbekannt 1']);
  });

  it('rejects an edit that makes no sense, with a message', async () => {
    const file = job.pieces[0].files.find((f) => f.class === 'combined')!;
    const res = await patch(id, { op: 'join', fileId: file.id, partId: file.parts[0].id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/first part/i);
    expect((await patch(id, 'not an object')).status).toBe(400);
    const broken = await edit(new Request(url(`/api/jobs/${id}`), { method: 'PATCH', body: '{' }), ctx({ id }));
    expect(broken.status).toBe(400);
  });

  it('exports a zip once every part is named', async () => {
    const file = job.pieces[0].files.find((f) => f.class === 'combined')!;
    const unknown = file.parts.find((p) => p.name === 'Unbekannt 1')!;
    expect((await patch(id, { op: 'rename', fileId: file.id, partId: unknown.id, name: '1st Horn' })).status).toBe(200);

    const res = await exportZip(new Request(url(`/api/jobs/${id}/export`)), ctx({ id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('Concert.zip');
    const zip = Buffer.from(await res.arrayBuffer());
    for (const name of ['Soprano Cornet', 'Solo Cornet', '1st Horn', 'Timpani', 'Partitur']) {
      expect(zip.includes(Buffer.from(`Concert/Test Piece/Test Piece - ${name}.pdf`))).toBe(true);
    }
  }, 60_000);

  it('deletes the job and everything stored for it', async () => {
    const res = await remove(new Request(url(`/api/jobs/${id}`), { method: 'DELETE' }), ctx({ id }));
    expect(res.status).toBe(204);
    expect(existsSync(jobDir(id))).toBe(false);
    expect((await show(new Request(url(`/api/jobs/${id}`)), ctx({ id }))).status).toBe(404);
  });
});

describe('uploads that are refused', () => {
  it('answers 413 over the size limit and stores nothing', async () => {
    const before = await jobsOnDisk();
    process.env.MAX_UPLOAD_MB = '0.01';
    try {
      const res = await post([{ name: 'big.pdf', data: Buffer.alloc(200_000) }]);
      expect(res.status).toBe(413);
      expect((await res.json()).error).toMatch(/too large|larger/i);
    } finally {
      delete process.env.MAX_UPLOAD_MB;
    }
    expect(await jobsOnDisk()).toEqual(before);
  });

  it('answers 400 for a zip without PDFs, for other file types, and for a mix', async () => {
    const before = await jobsOnDisk();
    expect((await post([zipOf([{ name: 'notes.txt', data: 'x' }])])).status).toBe(400);
    expect((await post([{ name: 'photo.png', data: 'x', type: 'image/png' }])).status).toBe(400);
    expect((await post([zipOf([{ name: 'a/a.pdf', data: score }]), { name: 'b.pdf', data: score }])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await upload(new Request(url('/api/jobs'), { method: 'POST', body: 'hello' }))).status).toBe(400);
    expect(await jobsOnDisk()).toEqual(before);
  });

  it('answers 400 for a file named .zip that is not a zip', async () => {
    expect((await post([{ name: 'fake.zip', data: 'nope', type: 'application/zip' }])).status).toBe(400);
  });
});

describe('loose PDFs', () => {
  it('become one piece', async () => {
    const res = await post([
      { name: 'Test Piece - Einzelstimmen.pdf', data: parts },
      { name: 'Test Piece - Partitur.pdf', data: score },
    ]);
    expect(res.status).toBe(201);
    const job = await ready((await res.json()).id);
    expect(job.name).toBe('Test Piece');
    expect(job.pieces.map((p) => [p.name, p.files.length])).toEqual([['Test Piece', 2]]);

    const zip = await exportZip(new Request(url(`/api/jobs/${job.id}/export`)), ctx({ id: job.id }));
    const doc = await PDFDocument.load(score);
    expect(zip.status).toBe(200);
    expect(doc.getPageCount()).toBe(1);
    await remove(new Request(url(`/api/jobs/${job.id}`), { method: 'DELETE' }), ctx({ id: job.id }));
  }, 180_000);
});

describe('unknown jobs', () => {
  it.each(['../x', 'aaaaaaaaaaaa', '%2e%2e'])('answers 404 for %s', async (id) => {
    expect((await show(new Request(url('/api/jobs/x')), ctx({ id }))).status).toBe(404);
    expect((await patch(id, { op: 'join', fileId: 'f', partId: 'p' })).status).toBe(404);
    expect((await exportZip(new Request(url('/api/jobs/x/export')), ctx({ id }))).status).toBe(404);
    expect((await remove(new Request(url('/api/jobs/x'), { method: 'DELETE' }), ctx({ id }))).status).toBe(404);
  });
});
