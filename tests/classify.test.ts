import { expect, it } from 'vitest';
import { classifyFile, partNameFromFileName, pieceNameFromFileName } from '@/lib/classify';

it.each([
  ['Alladale - Partitur.pdf', 'score'],
  ['17896 - celtic-crest - score.pdf', 'score'],
  ['My Love is Alwys Here_260707 - Full Score.pdf', 'score'],
  ['Direktion.pdf', 'score'],
  ['Alladale - Einzelstimmen.pdf', 'combined'],
  ['Einzelstimmen.pdf', 'combined'],
  ['17896 - celtic-crest - parts.pdf', 'combined'],
  ['Victory (Lord of the Dance), Einzelstimmen.pdf', 'combined'],
  ['Victory (Lord of the Dance), Solo Cornet.pdf', 'single'],
  ['My Love is Alwys Here_260707 - 2nd Bb Trombone.pdf', 'single'],
  ['My Love is Alwys Here_260707 - Sus. Cymbal.pdf', 'single'],
  ['My Love is Alwys Here_260707 - Bb Bass.pdf', 'single'],
] as const)('%s → %s', (name, cls) => {
  expect(classifyFile(name, '')).toBe(cls);
});

it('falls back to the first page text', () => {
  expect(classifyFile('scan0001.pdf', 'My Love is Always Here\nSolo Bb Cornet\nMusic by Alexandre Desplat')).toBe('single');
});

it('defaults to combined', () => {
  expect(classifyFile('scan0001.pdf', '')).toBe('combined');
});

it('does not take an instrument word in a title for a part', () => {
  expect(classifyFile('The Lost Horn.pdf', '')).toBe('combined');
});

it('extracts the part from a file name', () => {
  expect(partNameFromFileName('My Love is Alwys Here_260707 - Bass C Trombone.pdf')).toBe('Bass Trombone');
  expect(partNameFromFileName('Victory (Lord of the Dance), Solo Cornet.pdf')).toBe('Solo Cornet');
  expect(partNameFromFileName('Alladale - Partitur.pdf')).toBeNull();
});

it('derives a piece name from a loose file name', () => {
  expect(pieceNameFromFileName('Alladale - Einzelstimmen.pdf')).toBe('Alladale');
  expect(pieceNameFromFileName('17896 - celtic-crest - parts.pdf')).toBe('17896 - celtic-crest');
  expect(pieceNameFromFileName('Einzelstimmen.pdf')).toBe('Einzelstimmen');
});
