import { expect, it } from 'vitest';
import { groupPages, reflag } from '@/lib/detect/group';
import type { Confidence, PageDetection, Part } from '@/lib/types';

const D = (
  partName: string | null,
  confidence: Confidence = 'high',
  rawText = '',
  key: PageDetection['key'] = null,
): PageDetection => ({ partName, confidence, rawText, key });

/** Header text of a first page: the piece's title block plus the part name. */
const TITLE = 'Celtic Crest Basel Tattoo Christoph Walter Brass Band Transcription';
const first = (name: string | null, label: string, key: PageDetection['key'] = null) =>
  D(name, 'high', `${label} ${TITLE}`, key);
const shape = (ps: Part[]) => ps.map((p) => [p.name, p.pages]);

it('starts a part on each match and continues on null', () => {
  expect(shape(groupPages([D('Solo Cornet'), D(null), D('Repiano Cornet')]))).toEqual([
    ['Solo Cornet', [0, 1]],
    ['Repiano Cornet', [2]],
  ]);
});

it('handles a four-page part', () => {
  expect(shape(groupPages([D('Solo Cornet'), D(null), D(null), D(null), D('2nd Cornet')]))[0]).toEqual([
    'Solo Cornet',
    [0, 1, 2, 3],
  ]);
});

it('joins consecutive pages repeating the same name', () => {
  expect(shape(groupPages([D('Eb Bass'), D('Eb Bass'), D('Bb Bass')]))).toEqual([
    ['Eb Bass', [0, 1]],
    ['Bb Bass', [2]],
  ]);
});

it('puts leading unmatched pages in Unbekannt 1, flagged', () => {
  const ps = groupPages([D(null), D('Solo Cornet')]);
  expect(ps[0]).toMatchObject({ name: 'Unbekannt 1', pages: [0], confidence: 'low', flags: ['unknown'] });
  expect(ps[1]).toMatchObject({ name: 'Solo Cornet', pages: [1], confidence: 'high', flags: [] });
});

it('flags non-consecutive duplicates on both parts', () => {
  const ps = groupPages([D('Solo Cornet'), D('2nd Cornet'), D('Solo Cornet')]);
  expect(ps[0].flags).toContain('duplicate');
  expect(ps[2].flags).toContain('duplicate');
  expect(ps[1].flags).toEqual([]);
});

it('flags a part more than twice the median length', () => {
  const ps = groupPages([D('Solo Cornet'), D('Solo Horn'), D('1st Horn'), D('2nd Horn'), D(null), D(null)]);
  expect(ps[3]).toMatchObject({ pages: [3, 4, 5], flags: ['long'], confidence: 'low' });
  expect(ps[0].flags).toEqual([]);
});

it('does not flag length when every part is long', () => {
  const ps = groupPages([D('Solo Cornet'), D(null), D(null), D('Solo Horn'), D(null), D(null)]);
  expect(ps.flatMap((p) => p.flags)).toEqual([]);
});

it('carries a low-confidence detection as a fuzzy flag', () => {
  expect(groupPages([D('Solo Cornet', 'low')])[0]).toMatchObject({ confidence: 'low', flags: ['fuzzy'] });
});

it('covers every page exactly once', () => {
  const ps = groupPages([D(null), D('Solo Cornet'), D(null), D('Timpani'), D('Timpani')]);
  expect(ps.flatMap((p) => p.pages)).toEqual([0, 1, 2, 3, 4]);
});

it('gives each part a distinct id', () => {
  const ps = groupPages([D('Solo Cornet'), D('2nd Cornet'), D('3rd Cornet')]);
  expect(new Set(ps.map((p) => p.id)).size).toBe(3);
});

it('returns [] for no pages', () => {
  expect(groupPages([])).toEqual([]);
});

it('reflag recomputes duplicate and unknown but keeps fuzzy', () => {
  const ps = groupPages([D('Solo Cornet', 'low'), D('2nd Cornet'), D('Solo Cornet')]);
  ps[2] = { ...ps[2], name: '3rd Cornet' };
  const out = reflag(ps);
  expect(out[0].flags).toEqual(['fuzzy']);
  expect(out[2]).toMatchObject({ flags: [], confidence: 'high' });
});

it('starts a new part on every first page, even when the name repeats', () => {
  // Four copies of the same part, each with the full title block.
  const ps = groupPages([
    first('Solo Cornet', 'Solo Cornet'),
    first('Solo Cornet', 'Solo Cornet'),
    first('Solo Cornet', 'Solo Cornet'),
    first('2nd Cornet', '2nd Cornet'),
  ]);
  expect(shape(ps)).toEqual([
    ['Solo Cornet', [0]],
    ['Solo Cornet', [1]],
    ['Solo Cornet', [2]],
    ['2nd Cornet', [3]],
  ]);
  expect(ps[0].flags).toEqual(['duplicate']);
});

it('joins a continuation page that repeats the part name without the title block', () => {
  const ps = groupPages([
    first('Soprano Cornet', 'Soprano Cornet'),
    first('Eb Bass', 'Eb Bass'),
    D('Eb Bass', 'low', 'E> Bass 2. open'),
    first('Timpani', 'Timpani'),
  ]);
  expect(shape(ps)).toEqual([
    ['Soprano Cornet', [0]],
    ['Eb Bass', [1, 2]],
    ['Timpani', [3]],
  ]);
});

it('names same-instrument parts in different keys after their key', () => {
  const ps = groupPages([
    first('1st Trombone', '1st Bb Trombone', 'Bb'),
    first('1st Trombone', '1st Trombone'),
    first('Bass Trombone', 'Bass Trombone C', 'C'),
    first('Bass Trombone', 'Bass Trombone Bb', 'Bb'),
    first('2nd Trombone', '2nd Bb Trombone', 'Bb'),
  ]);
  expect(ps.map((p) => p.name)).toEqual([
    '1st Trombone (Bb)',
    '1st Trombone (C)',
    'Bass Trombone (C)',
    'Bass Trombone (Bb)',
    '2nd Trombone',
  ]);
  expect(ps.flatMap((p) => p.flags)).toEqual([]);
});

it('starts an unknown part on a first page with no recognised instrument', () => {
  const ps = groupPages([
    first('Percussion', 'Percussion'),
    first(null, 'Nose Flute'),
    first(null, 'Kazoo'),
    D(null, 'high', '35 mr re'),
    first('Drum Set', 'Drum Set'),
  ]);
  expect(shape(ps)).toEqual([
    ['Percussion', [0]],
    ['Unbekannt 1', [1]],
    ['Unbekannt 2', [2, 3]],
    ['Drum Set', [4]],
  ]);
});
