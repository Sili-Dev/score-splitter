import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportProblems, planExport, safeName, writeExportZip } from '@/lib/export';
import { extractPages } from '@/lib/pdf/split';
import type { FileClass, Job, Part, SourceFile } from '@/lib/types';
import { makeScanPdf } from './helpers/makeScan';

let tmp: string;
let fivePages: string;
let onePage: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ss-export-'));
  fivePages = join(tmp, 'five.pdf');
  onePage = join(tmp, 'one.pdf');
  await writeFile(fivePages, await makeScanPdf(['A', 'B', 'C', 'D', 'E'].map((left) => ({ left }))));
  await writeFile(onePage, await makeScanPdf([{ left: 'Score' }]));
}, 60_000);
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const part = (name: string, pages: number[]): Part => ({ id: name + pages[0], name, pages, confidence: 'high', flags: [] });

function file(cls: FileClass, parts: Part[], over: Partial<SourceFile> = {}): SourceFile {
  const pageCount = parts.reduce((n, p) => n + p.pages.length, 0) || 1;
  return {
    id: `${cls}-${parts[0]?.name ?? 'x'}`,
    originalName: `${cls}.pdf`,
    storedPath: cls === 'combined' ? fivePages : onePage,
    pageCount,
    class: cls,
    parts,
    discarded: [],
    status: 'done',
    ...over,
  };
}

function job(files: SourceFile[], pieceName = 'Alladale'): Job {
  return {
    id: 'job',
    name: 'Adventskonzert',
    createdAt: new Date(0).toISOString(),
    status: 'ready',
    pieces: [{ id: 'p1', name: pieceName, files }],
    ignored: [],
  };
}

const paths = (j: Job) => planExport(j).map((e) => e.zipPath);

async function unzip(path: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) =>
    yauzl.open(path, { lazyEntries: true }, (e, z) => (e || !z ? fail(e) : ok(z))),
  );
  await new Promise<void>((done, fail) => {
    zip.on('end', done);
    zip.on('error', fail);
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err);
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          out.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  return out;
}

async function exportTo(j: Job, name: string): Promise<Map<string, Buffer>> {
  const path = join(tmp, name);
  const out = createWriteStream(path);
  await writeExportZip(j, out);
  await new Promise<void>((ok) => (out.closed ? ok() : out.on('close', () => ok())));
  return unzip(path);
}

describe('planExport', () => {
  it('plans the score first, then one file per part', () => {
    const j = job([
      file('combined', [part('Soprano Cornet', [0]), part('Solo Cornet', [1, 2])]),
      file('score', []),
    ]);
    expect(paths(j)).toEqual([
      'Adventskonzert/Alladale/Alladale - Partitur.pdf',
      'Adventskonzert/Alladale/Alladale - Soprano Cornet.pdf',
      'Adventskonzert/Alladale/Alladale - Solo Cornet.pdf',
    ]);
  });

  it('exports a single-part file whole under its part name', () => {
    const j = job([file('single', [part('Solo Cornet', [0])])]);
    expect(planExport(j)).toEqual([
      { zipPath: 'Adventskonzert/Alladale/Alladale - Solo Cornet.pdf', srcPath: onePage, pages: 'all' },
    ]);
  });

  it('appends (2) to a duplicate name', () => {
    const j = job([file('combined', [part('Solo Cornet', [0]), part('2nd Cornet', [1]), part('Solo Cornet', [2])])]);
    expect(paths(j)).toEqual([
      'Adventskonzert/Alladale/Alladale - Solo Cornet.pdf',
      'Adventskonzert/Alladale/Alladale - 2nd Cornet.pdf',
      'Adventskonzert/Alladale/Alladale - Solo Cornet (2).pdf',
    ]);
  });

  it('treats names differing only in case as duplicates, for Windows and macOS', () => {
    const j = job([file('combined', [part('Solo Cornet', [0]), part('solo cornet', [1])])]);
    expect(paths(j)[1]).toBe('Adventskonzert/Alladale/Alladale - solo cornet (2).pdf');
  });

  it('numbers a second score', () => {
    const j = job([file('score', [], { id: 'a' }), file('score', [], { id: 'b' })]);
    expect(paths(j)).toEqual([
      'Adventskonzert/Alladale/Alladale - Partitur.pdf',
      'Adventskonzert/Alladale/Alladale - Partitur (2).pdf',
    ]);
  });

  it('gives two pieces with the same name separate folders', () => {
    const j = job([file('score', [])]);
    j.pieces.push({ id: 'p2', name: 'Alladale', files: [file('score', [])] });
    expect(paths(j)).toEqual([
      'Adventskonzert/Alladale/Alladale - Partitur.pdf',
      'Adventskonzert/Alladale (2)/Alladale - Partitur.pdf',
    ]);
  });

  it('leaves out discarded pages, and a part whose pages are all discarded', () => {
    const j = job([
      file('combined', [part('Solo Cornet', [0, 1]), part('2nd Cornet', [2])], { discarded: [1, 2] }),
    ]);
    expect(planExport(j)).toEqual([
      { zipPath: 'Adventskonzert/Alladale/Alladale - Solo Cornet.pdf', srcPath: fivePages, pages: [0] },
    ]);
  });

  it('skips files that failed', () => {
    const j = job([file('combined', [], { status: 'error', error: 'broken' }), file('score', [])]);
    expect(paths(j)).toEqual(['Adventskonzert/Alladale/Alladale - Partitur.pdf']);
  });

  it('sanitises piece and part names in paths', () => {
    const j = job([file('combined', [part('Horn 1/2', [0])])], 'Victory: The "Dance"?');
    expect(paths(j)).toEqual(['Adventskonzert/Victory- The -Dance/Victory- The -Dance - Horn 1-2.pdf']);
  });
});

describe('safeName', () => {
  it('replaces characters that are illegal in file names', () => {
    expect(safeName('Horn 1/2: "solo"?')).toBe('Horn 1-2- -solo');
    expect(safeName('a\\b*c<d>e|f')).toBe('a-b-c-d-e-f');
  });
  it('trims trailing dots and spaces, which Windows drops', () => {
    expect(safeName('Victory. ')).toBe('Victory');
  });
  it('never returns an empty name', () => {
    expect(safeName('???')).toBe('Unnamed');
    expect(safeName('  ')).toBe('Unnamed');
  });
  it('keeps umlauts', () => {
    expect(safeName('O Du Fröhliche')).toBe('O Du Fröhliche');
  });
});

describe('exportProblems', () => {
  it('blocks while a part is named Unbekannt', () => {
    const j = job([file('combined', [part('Solo Cornet', [0]), part('Unbekannt 1', [1])])]);
    expect(exportProblems(j).blocking).toEqual(['Alladale: Unbekannt 1']);
  });
  it('does not block on an unknown part whose pages are all discarded', () => {
    const j = job([file('combined', [part('Solo Cornet', [0]), part('Unbekannt 1', [1])], { discarded: [1] })]);
    expect(exportProblems(j).blocking).toEqual([]);
  });
  it('blocks while a file is still being read', () => {
    const j = job([file('combined', [], { status: 'processing' })]);
    expect(exportProblems(j).blocking).toHaveLength(1);
  });
  it('blocks when there is nothing to export', () => {
    expect(exportProblems(job([])).blocking).toHaveLength(1);
  });
  it('warns about duplicates and failed files without blocking', () => {
    const j = job([
      file('combined', [part('Solo Cornet', [0]), part('Solo Cornet', [1])]),
      file('score', [], { status: 'error', error: 'broken', originalName: 'bad.pdf' }),
    ]);
    const p = exportProblems(j);
    expect(p.blocking).toEqual([]);
    expect(p.warnings).toHaveLength(2);
  });
});

describe('writeExportZip', () => {
  it('omits discarded pages and loses nothing else', async () => {
    const j = job([
      file('combined', [part('A', [0]), part('B', [1, 2]), part('C', [3, 4])], { discarded: [4], pageCount: 5 }),
      file('score', []),
    ]);
    const files = await exportTo(j, 'a.zip');
    const counts: Record<string, number> = {};
    for (const [name, data] of files) counts[name] = (await PDFDocument.load(data)).getPageCount();
    expect(counts).toEqual({
      'Adventskonzert/Alladale/Alladale - Partitur.pdf': 1,
      'Adventskonzert/Alladale/Alladale - A.pdf': 1,
      'Adventskonzert/Alladale/Alladale - B.pdf': 2,
      'Adventskonzert/Alladale/Alladale - C.pdf': 1,
    });
  }, 60_000);

  it('copies pages without re-encoding the scan', async () => {
    const source = await readFile(fivePages);
    const start = source.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    const jpegHead = source.subarray(start, start + 4000);

    const out = Buffer.from(await extractPages(fivePages, [0]));
    expect(out.includes(jpegHead)).toBe(true);
    expect(out.length).toBeLessThan(source.length / 2);
  }, 60_000);

  it('keeps the requested page order and count', async () => {
    const doc = await PDFDocument.load(await extractPages(fivePages, [1, 2, 3]));
    expect(doc.getPageCount()).toBe(3);
  });

  it('rejects a page that does not exist', async () => {
    await expect(extractPages(fivePages, [7])).rejects.toThrow();
  });
});
