import { describe, expect, it } from 'vitest';
import { applyEdit, EditError, type EditOp } from '@/lib/jobs/edit';
import type { Job, Part, SourceFile } from '@/lib/types';

const part = (id: string, name: string, pages: number[], flags: Part['flags'] = []): Part => ({
  id,
  name,
  pages,
  confidence: flags.length ? 'low' : 'high',
  flags,
});

function makeJob(parts: Part[], over: Partial<SourceFile> = {}): Job {
  const pageCount = parts.reduce((n, p) => n + p.pages.length, 0);
  return {
    id: 'job',
    name: 'Concert',
    createdAt: new Date(0).toISOString(),
    status: 'ready',
    ignored: [],
    pieces: [
      {
        id: 'piece',
        name: 'Alladale',
        files: [
          {
            id: 'f',
            originalName: 'parts.pdf',
            storedPath: '/x/parts.pdf',
            pageCount,
            class: 'combined',
            parts,
            discarded: [],
            status: 'done',
            ...over,
          },
        ],
      },
    ],
  };
}

const base = () =>
  makeJob([part('a', 'Soprano Cornet', [0]), part('b', 'Solo Cornet', [1, 2, 3]), part('c', 'Timpani', [4])]);
const partsOf = (job: Job) => job.pieces[0].files[0].parts;
const shape = (job: Job) => partsOf(job).map((p) => [p.name, p.pages]);

describe('split', () => {
  it('cuts a part at a page and names the tail Unbekannt', () => {
    const out = applyEdit(base(), { op: 'split', fileId: 'f', partId: 'b', atPage: 2 });
    expect(shape(out)).toEqual([
      ['Soprano Cornet', [0]],
      ['Solo Cornet', [1]],
      ['Unbekannt 1', [2, 3]],
      ['Timpani', [4]],
    ]);
    expect(partsOf(out)[2]).toMatchObject({ confidence: 'low', flags: ['unknown'] });
    expect(partsOf(out)[2].id).not.toBe('b');
  });

  it('gives the new part the same id every time, so browser and server agree on it', () => {
    const op = { op: 'split', fileId: 'f', partId: 'b', atPage: 2 } as const;
    const once = partsOf(applyEdit(base(), op));
    const again = partsOf(applyEdit(base(), op));
    expect(once[2].id).toBe(again[2].id);
    expect(new Set(once.map((p) => p.id)).size).toBe(4);
  });

  it('numbers a second unknown part', () => {
    let job = applyEdit(base(), { op: 'split', fileId: 'f', partId: 'b', atPage: 2 });
    job = applyEdit(job, { op: 'split', fileId: 'f', partId: partsOf(job)[2].id, atPage: 3 });
    expect(partsOf(job).map((p) => p.name)).toEqual(['Soprano Cornet', 'Solo Cornet', 'Unbekannt 1', 'Unbekannt 2', 'Timpani']);
  });

  it.each([1, 0, 4, 99])('rejects a cut at page %i, which is not inside the part', (atPage) => {
    expect(() => applyEdit(base(), { op: 'split', fileId: 'f', partId: 'b', atPage })).toThrow(EditError);
  });
});

describe('join', () => {
  it('merges a part into the one before it, keeping that name', () => {
    const out = applyEdit(base(), { op: 'join', fileId: 'f', partId: 'b' });
    expect(shape(out)).toEqual([
      ['Soprano Cornet', [0, 1, 2, 3]],
      ['Timpani', [4]],
    ]);
  });
  it('rejects joining the first part', () => {
    expect(() => applyEdit(base(), { op: 'join', fileId: 'f', partId: 'a' })).toThrow(EditError);
  });
});

describe('rename', () => {
  it('trims the name and clears the doubt about it', () => {
    const job = makeJob([part('a', 'Solo Comet', [0], ['fuzzy']), part('b', 'Unbekannt 1', [1], ['unknown'])]);
    let out = applyEdit(job, { op: 'rename', fileId: 'f', partId: 'a', name: '  Solo Cornet ' });
    out = applyEdit(out, { op: 'rename', fileId: 'f', partId: 'b', name: '1st Horn' });
    expect(partsOf(out)).toMatchObject([
      { name: 'Solo Cornet', flags: [], confidence: 'high' },
      { name: '1st Horn', flags: [], confidence: 'high' },
    ]);
  });
  it('flags a name that now exists twice', () => {
    const out = applyEdit(base(), { op: 'rename', fileId: 'f', partId: 'c', name: 'Solo Cornet' });
    expect(partsOf(out)[1].flags).toContain('duplicate');
    expect(partsOf(out)[2].flags).toContain('duplicate');
  });
  it.each(['', '   '])('rejects the empty name %j', (name) => {
    expect(() => applyEdit(base(), { op: 'rename', fileId: 'f', partId: 'a', name })).toThrow(EditError);
  });
  it('rejects a name longer than 120 characters', () => {
    expect(() => applyEdit(base(), { op: 'rename', fileId: 'f', partId: 'a', name: 'x'.repeat(121) })).toThrow(EditError);
  });
});

describe('discard', () => {
  it('toggles a page without changing any part', () => {
    let out = applyEdit(base(), { op: 'discard', fileId: 'f', page: 3, discarded: true });
    out = applyEdit(out, { op: 'discard', fileId: 'f', page: 1, discarded: true });
    out = applyEdit(out, { op: 'discard', fileId: 'f', page: 1, discarded: true });
    expect(out.pieces[0].files[0].discarded).toEqual([1, 3]);
    expect(shape(out)).toEqual(shape(base()));
    out = applyEdit(out, { op: 'discard', fileId: 'f', page: 3, discarded: false });
    expect(out.pieces[0].files[0].discarded).toEqual([1]);
  });
  it('rejects a page outside the file', () => {
    expect(() => applyEdit(base(), { op: 'discard', fileId: 'f', page: 5, discarded: true })).toThrow(EditError);
  });
  it('discards and restores a whole part', () => {
    let out = applyEdit(base(), { op: 'discardPart', fileId: 'f', partId: 'b', discarded: true });
    expect(out.pieces[0].files[0].discarded).toEqual([1, 2, 3]);
    out = applyEdit(out, { op: 'discardPart', fileId: 'f', partId: 'b', discarded: false });
    expect(out.pieces[0].files[0].discarded).toEqual([]);
  });
});

describe('setClass', () => {
  it('collapses a combined file into a score', () => {
    const out = applyEdit(base(), { op: 'setClass', fileId: 'f', class: 'score' });
    expect(out.pieces[0].files[0]).toMatchObject({ class: 'score', parts: [], status: 'done' });
  });
  it('collapses a combined file into a single part covering every page', () => {
    const out = applyEdit(base(), { op: 'setClass', fileId: 'f', class: 'single' });
    expect(shape(out)).toEqual([['Soprano Cornet', [0, 1, 2, 3, 4]]]);
  });
  it('queues the file for detection when it becomes combined', () => {
    const job = makeJob([], { class: 'score', pageCount: 5 });
    const out = applyEdit(job, { op: 'setClass', fileId: 'f', class: 'combined' });
    expect(out.pieces[0].files[0]).toMatchObject({ class: 'combined', status: 'pending', parts: [] });
    expect(out.status).toBe('processing');
  });
  it('does nothing when the class is unchanged', () => {
    const job = base();
    expect(applyEdit(job, { op: 'setClass', fileId: 'f', class: 'combined' })).toEqual(job);
  });
});

describe('renamePiece', () => {
  it('renames the piece', () => {
    expect(applyEdit(base(), { op: 'renamePiece', pieceId: 'piece', name: ' Alladale (Sparke) ' }).pieces[0].name).toBe(
      'Alladale (Sparke)',
    );
  });
  it('rejects an empty name', () => {
    expect(() => applyEdit(base(), { op: 'renamePiece', pieceId: 'piece', name: ' ' })).toThrow(EditError);
  });
});

describe('guards', () => {
  it('rejects unknown ids', () => {
    expect(() => applyEdit(base(), { op: 'join', fileId: 'nope', partId: 'b' })).toThrow(EditError);
    expect(() => applyEdit(base(), { op: 'join', fileId: 'f', partId: 'nope' })).toThrow(EditError);
    expect(() => applyEdit(base(), { op: 'renamePiece', pieceId: 'nope', name: 'x' })).toThrow(EditError);
  });
  it('rejects an op it does not know', () => {
    expect(() => applyEdit(base(), { op: 'explode' } as unknown as EditOp)).toThrow(EditError);
  });
  it('rejects part edits on a file that is still being read', () => {
    const job = makeJob([part('a', 'A', [0, 1])], { status: 'processing' });
    expect(() => applyEdit(job, { op: 'split', fileId: 'f', partId: 'a', atPage: 1 })).toThrow(EditError);
  });
  it('does not mutate its input', () => {
    const job = base();
    const before = JSON.stringify(job);
    applyEdit(job, { op: 'split', fileId: 'f', partId: 'b', atPage: 2 });
    applyEdit(job, { op: 'discard', fileId: 'f', page: 0, discarded: true });
    expect(JSON.stringify(job)).toBe(before);
  });
});

it('keeps every page in exactly one part through any sequence of splits and joins', () => {
  let job = makeJob([part('a', 'A', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]);
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 200; i++) {
    const parts = partsOf(job);
    const target = parts[rand(parts.length)];
    const op: EditOp =
      rand(2) === 0
        ? { op: 'split', fileId: 'f', partId: target.id, atPage: target.pages[rand(target.pages.length)] }
        : { op: 'join', fileId: 'f', partId: target.id };
    try {
      job = applyEdit(job, op);
    } catch (e) {
      expect(e).toBeInstanceOf(EditError);
    }
    expect(partsOf(job).flatMap((p) => p.pages)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(partsOf(job).map((p) => p.id)).size).toBe(partsOf(job).length);
  }
});
