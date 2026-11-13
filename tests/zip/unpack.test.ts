import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { decodeEntryName, piecesFromLoosePdfs, unpackZip, UploadTooLargeError } from '@/lib/zip/unpack';
import { makeRawZip, type RawEntry } from '../helpers/rawZip';

let tmp: string;
let n = 0;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ss-zip-'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Writes a zip and returns [zipPath, emptyDestDir]. The dest dir sits one level down so escapes are observable. */
async function setup(entries: RawEntry[]): Promise<[string, string]> {
  const base = join(tmp, `case${n++}`);
  const dest = join(base, 'dest');
  await mkdir(dest, { recursive: true });
  const zip = join(base, 'upload.zip');
  await writeFile(zip, makeRawZip(entries));
  return [zip, dest];
}

const MB = 1024 * 1024;

it('decodes UTF-8, mis-flagged UTF-8 and CP437 names', () => {
  expect(decodeEntryName(Buffer.from('O Du Fröhliche', 'utf8'), true)).toBe('O Du Fröhliche');
  expect(decodeEntryName(Buffer.from('O Du Fröhliche', 'utf8'), false)).toBe('O Du Fröhliche');
  expect(decodeEntryName(iconv.encode('O Du Fröhliche', 'cp437'), false)).toBe('O Du Fröhliche');
  expect(decodeEntryName(Buffer.from('plain.pdf'), false)).toBe('plain.pdf');
});

it('makes one piece per folder that directly holds PDFs', async () => {
  const [zip, dest] = await setup([
    { name: 'Concert/' },
    { name: 'Concert/Starlight/c.pdf', data: 'C' },
    { name: 'Concert/Alladale/b.pdf', data: 'B' },
    { name: 'Concert/Alladale/a.pdf', data: 'A' },
    { name: 'Concert/readme.txt', data: 'hi' },
  ]);
  const r = await unpackZip(zip, dest, 10 * MB, 'My Upload.zip');
  expect(r.pieces.map((p) => [p.name, p.files.map((f) => f.originalName)])).toEqual([
    ['Alladale', ['a.pdf', 'b.pdf']],
    ['Starlight', ['c.pdf']],
  ]);
  expect(r.ignored).toEqual(['Concert/readme.txt']);
  expect(r.rootName).toBe('Concert');
  expect(await readFile(r.pieces[0].files[0].storedPath, 'utf8')).toBe('A');
});

it('uses the upload name for PDFs at the root of the zip', async () => {
  const [zip, dest] = await setup([{ name: 'parts.pdf', data: 'x' }, { name: 'score.pdf', data: 'y' }]);
  const r = await unpackZip(zip, dest, 10 * MB, 'Alladale.zip');
  expect(r.pieces.map((p) => [p.name, p.files.length])).toEqual([['Alladale', 2]]);
  expect(r.rootName).toBe('Alladale');
});

it('uses the upload name as root when the zip has several top-level folders', async () => {
  const [zip, dest] = await setup([{ name: 'A/a.pdf', data: 'x' }, { name: 'B/b.pdf', data: 'y' }]);
  const r = await unpackZip(zip, dest, 10 * MB, 'Advent 2026.zip');
  expect(r.rootName).toBe('Advent 2026');
  expect(r.pieces.map((p) => p.name)).toEqual(['A', 'B']);
});

it('keeps umlauts in piece names from a legacy-encoded zip', async () => {
  const [zip, dest] = await setup([{ name: iconv.encode('K/O Du Fröhliche/Partitur.pdf', 'cp437'), data: 'x' }]);
  const r = await unpackZip(zip, dest, 10 * MB, 'k.zip');
  expect(r.pieces[0].name).toBe('O Du Fröhliche');
});

it('accepts backslash separators', async () => {
  const [zip, dest] = await setup([{ name: 'K\\Alladale\\a.pdf', data: 'x' }]);
  const r = await unpackZip(zip, dest, 10 * MB, 'k.zip');
  expect(r.pieces.map((p) => p.name)).toEqual(['Alladale']);
});

it('skips entries that would escape the destination', async () => {
  const [zip, dest] = await setup([
    { name: '../evil.pdf', data: 'x' },
    { name: '/abs.pdf', data: 'x' },
    { name: 'C:/win.pdf', data: 'x' },
    { name: 'ok/../../evil2.pdf', data: 'x' },
    { name: 'ok/a.pdf', data: 'x' },
  ]);
  const r = await unpackZip(zip, dest, 10 * MB, 'k.zip');
  expect(r.ignored.sort()).toEqual(['../evil.pdf', '/abs.pdf', 'C:/win.pdf', 'ok/../../evil2.pdf']);
  expect(r.pieces.map((p) => [p.name, p.files.length])).toEqual([['ok', 1]]);
  expect(existsSync(join(dest, '..', 'evil.pdf'))).toBe(false);
  expect(existsSync(join(dest, '..', '..', 'evil2.pdf'))).toBe(false);
  expect(await readdir(dest)).toHaveLength(1);
});

it('never uses the original file name on disk', async () => {
  const [zip, dest] = await setup([{ name: 'ok/CON.pdf', data: 'x' }]);
  await unpackZip(zip, dest, 10 * MB, 'k.zip');
  const [stored] = await readdir(dest);
  expect(stored).toMatch(/^[A-Za-z0-9_-]+\.pdf$/);
  expect(stored).not.toBe('CON.pdf');
});

it('silently skips __MACOSX and dotfiles', async () => {
  const [zip, dest] = await setup([
    { name: '__MACOSX/A/._a.pdf', data: 'x' },
    { name: 'A/.DS_Store', data: 'x' },
    { name: 'A/._a.pdf', data: 'x' },
    { name: 'A/a.pdf', data: 'x' },
  ]);
  const r = await unpackZip(zip, dest, 10 * MB, 'k.zip');
  expect(r.ignored).toEqual([]);
  expect(r.pieces[0].files).toHaveLength(1);
});

it('treats the .PDF extension case-insensitively', async () => {
  const [zip, dest] = await setup([{ name: 'A/SCAN.PDF', data: 'x' }]);
  expect((await unpackZip(zip, dest, 10 * MB, 'k.zip')).pieces[0].files).toHaveLength(1);
});

it('throws UploadTooLargeError once extracted bytes pass the limit', async () => {
  const [zip, dest] = await setup([
    { name: 'A/a.pdf', data: Buffer.alloc(600) },
    { name: 'A/b.pdf', data: Buffer.alloc(600) },
  ]);
  await expect(unpackZip(zip, dest, 1000, 'k.zip')).rejects.toBeInstanceOf(UploadTooLargeError);
});

it('rejects a file that is not a zip', async () => {
  const base = join(tmp, `case${n++}`);
  await mkdir(join(base, 'dest'), { recursive: true });
  await writeFile(join(base, 'upload.zip'), 'definitely not a zip');
  await expect(unpackZip(join(base, 'upload.zip'), join(base, 'dest'), MB, 'k.zip')).rejects.toThrow();
});

it('returns no pieces for a zip without PDFs', async () => {
  const [zip, dest] = await setup([{ name: 'notes.txt', data: 'x' }]);
  const r = await unpackZip(zip, dest, MB, 'k.zip');
  expect(r.pieces).toEqual([]);
  expect(r.ignored).toEqual(['notes.txt']);
});

it('names loose PDFs after the first file', () => {
  const pieces = piecesFromLoosePdfs([
    { originalName: 'Alladale - Einzelstimmen.pdf', storedPath: 'x' },
    { originalName: 'Alladale - Partitur.pdf', storedPath: 'y' },
  ]);
  expect(pieces).toHaveLength(1);
  expect(pieces[0].name).toBe('Alladale');
  expect(pieces[0].files).toHaveLength(2);
  expect(piecesFromLoosePdfs([{ originalName: 'scan0001.pdf', storedPath: 'x' }])[0].name).toBe('scan0001');
});
