import { expect, it } from 'vitest';
import { groupPages, reflag } from '@/lib/detect/group';
import type { Confidence, PageDetection, Part } from '@/lib/types';

const D = (partName: string | null, confidence: Confidence = 'high'): PageDetection => ({
  partName,
  confidence,
  rawText: '',
});
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
