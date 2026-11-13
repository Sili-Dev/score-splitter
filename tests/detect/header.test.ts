import { expect, it } from 'vitest';
import { detectPart } from '@/lib/detect/header';
import type { OcrLine } from '@/lib/types';

const L = (text: string, x0: number, x1: number, y0 = 0.5): OcrLine => ({ text, x0, x1, y0, y1: y0 + 0.1 });

it('picks the left-margin part name over a subtitle naming instruments', () => {
  // The header of the Alladale scan.
  const d = detectPart([
    L('Commissioned by the Yorkshire Building Society Band', 0.3, 0.7, 0.05),
    L('ALLADALE', 0.38, 0.62, 0.25),
    L('from Hymn of the Highlands', 0.35, 0.65, 0.45),
    L('Eb Soprano Cornet', 0.04, 0.25, 0.6),
    L('Flugel Horn, Horn & Baritone Trio', 0.3, 0.7, 0.7),
    L('Philip Sparke', 0.84, 0.98, 0.6),
  ]);
  expect(d).toMatchObject({ partName: 'Soprano Cornet', confidence: 'high' });
});

it('returns null when only a multi-instrument subtitle matches', () => {
  expect(detectPart([L('Flugel Horn, Horn & Baritone Trio', 0.3, 0.7)]).partName).toBeNull();
});

it('accepts a centred part name when it is the only candidate, at low confidence', () => {
  expect(detectPart([L('Solo Cornet', 0.4, 0.6)])).toMatchObject({ partName: 'Solo Cornet', confidence: 'low' });
});

it('prefers left over right over centre', () => {
  const lines = [L('1st Horn', 0.45, 0.55), L('2nd Horn', 0.8, 0.97), L('Solo Horn', 0.03, 0.2)];
  expect(detectPart(lines).partName).toBe('Solo Horn');
  expect(detectPart(lines.slice(0, 2)).partName).toBe('2nd Horn');
});

it('is high confidence for an exact match at the right margin', () => {
  expect(detectPart([L('Timpani', 0.85, 0.97)]).confidence).toBe('high');
});

it('is low confidence on a fuzzy match', () => {
  expect(detectPart([L('Solo Comet', 0.03, 0.2)])).toMatchObject({ partName: 'Solo Cornet', confidence: 'low' });
});

it('keeps a shared part', () => {
  expect(detectPart([L('2nd & 3rd Cornet', 0.03, 0.25)]).partName).toBe('2nd + 3rd Cornet');
});

it('breaks a tie in the same zone towards the lower line', () => {
  expect(detectPart([L('Solo Horn', 0.03, 0.2, 0.2), L('1st Horn', 0.03, 0.2, 0.6)]).partName).toBe('1st Horn');
});

it('returns null and the raw text when nothing matches', () => {
  expect(detectPart([L('- 2 -', 0.45, 0.55)])).toEqual({ partName: null, confidence: 'high', rawText: '- 2 -' });
});

it('handles a page with no text', () => {
  expect(detectPart([])).toEqual({ partName: null, confidence: 'high', rawText: '' });
});
