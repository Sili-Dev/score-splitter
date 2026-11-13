import { describe, expect, it } from 'vitest';
import { instrumentFamilies, matchPartName } from '@/lib/parts/match';
import { STANDARD_PARTS } from '@/lib/parts/catalog';

describe('matchPartName', () => {
  const cases: [string, string][] = [
    ['Eb Soprano Cornet', 'Soprano Cornet'],
    ['E♭ Soprano Cornet', 'Soprano Cornet'],
    ['E> Soprano Cornet', 'Soprano Cornet'], // OCR of the flat sign
    ['Soprano Eb Cornet', 'Soprano Cornet'],
    ['Solo Bb Cornet', 'Solo Cornet'],
    ['Repiano Bb Cornet', 'Repiano Cornet'],
    ['2nd Bb Cornet', '2nd Cornet'],
    ['3rd Bb Cornet', '3rd Cornet'],
    ['Bb Flugelhorn', 'Flugelhorn'],
    ['Flugel Horn', 'Flugelhorn'],
    ['Solo Eb Horn', 'Solo Horn'],
    ['1st Eb Horn', '1st Horn'],
    ['1. Es-Horn', '1st Horn'],
    ['2nd Bb Baritone', '2nd Baritone'],
    ['1st Bb Trombone', '1st Trombone'],
    ['2. Posaune', '2nd Trombone'],
    ['Bass C Trombone', 'Bass Trombone'],
    ['Bass Trombone', 'Bass Trombone'],
    ['1st Bb Euphonium', '1st Euphonium'],
    ['Euphonium', 'Euphonium'],
    ['Eb Bass', 'Eb Bass'],
    ['Es-Bass', 'Eb Bass'],
    ['Bb Bass', 'Bb Bass'],
    ['Timpani', 'Timpani'],
    ['Pauken', 'Timpani'],
    ['Glockenspiel', 'Glockenspiel'],
    ['Sus. Cymbal', 'Suspended Cymbal'],
    ['Schlagzeug', 'Percussion'],
    ['Percussion 1', 'Percussion 1'],
    ['Drum Set', 'Drum Set'],
    ['2nd & 3rd Cornet', '2nd + 3rd Cornet'],
    ['Solo Comet', 'Solo Cornet'], // classic OCR slip
    ['lst Baritone', '1st Baritone'], // l for 1
    ['SOLO CORNET', 'Solo Cornet'],
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(matchPartName(input)?.name).toBe(expected);
  });

  it('marks clean input exact and slips fuzzy', () => {
    expect(matchPartName('Solo Cornet')?.exact).toBe(true);
    expect(matchPartName('Solo Bb Cornet')?.exact).toBe(true);
    expect(matchPartName('Solo Comet')?.exact).toBe(false);
    expect(matchPartName('Solo Cornat')?.exact).toBe(false);
  });

  it.each(['ALLADALE', 'Philip Sparke', 'from Hymn of the Highlands', '', 'cup mute', '- 2 -'])(
    'rejects %j',
    (t) => {
      expect(matchPartName(t)).toBeNull();
    },
  );

  it('rejects a long sentence that happens to contain an instrument', () => {
    expect(matchPartName('Commissioned by the Yorkshire Building Society Brass Band horn section')).toBeNull();
  });

  it('rejects a line naming several different instruments', () => {
    expect(matchPartName('Flugel Horn, Horn & Baritone Trio')).toBeNull();
  });
});

describe('instrumentFamilies', () => {
  it('lists distinct families in order', () => {
    expect(instrumentFamilies('Flugel Horn, Horn & Baritone Trio')).toEqual(['flugelhorn', 'horn', 'baritone']);
    expect(instrumentFamilies('2nd & 3rd Cornet')).toEqual(['cornet']);
    expect(instrumentFamilies('Bass Trombone')).toEqual(['trombone']);
    expect(instrumentFamilies('ALLADALE')).toEqual([]);
  });
});

describe('STANDARD_PARTS', () => {
  it('maps every standard name to itself', () => {
    for (const name of STANDARD_PARTS) expect(matchPartName(name)?.name, name).toBe(name);
  });
});
