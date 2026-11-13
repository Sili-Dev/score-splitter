import { matchPartName } from '@/lib/parts/match';
import type { FileClass } from '@/lib/types';

const SCORE = /partitur|score|direktion|conductor/i;
const COMBINED = /stimmen|\bparts\b/i;
/** Separators between a piece title and what the file holds: "Title - Part", "Title, Part", "Title_Part". */
const SEPARATOR = /\s+-\s+|,\s+|_/;

function stem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim();
}

/** Classify by file name alone; null when the name says nothing. */
export function classifyByName(fileName: string): FileClass | null {
  const name = stem(fileName);
  if (SCORE.test(name)) return 'score';
  if (COMBINED.test(name)) return 'combined';
  if (partNameFromFileName(fileName)) return 'single';
  return null;
}

/**
 * The part a file name ends in, e.g. "Title - Bass C Trombone.pdf".
 * Only a clean match on the last segment counts, so that an instrument word
 * inside a title ("The Lost Horn.pdf") is not taken for a part.
 */
export function partNameFromFileName(fileName: string): string | null {
  const name = stem(fileName);
  if (SCORE.test(name) || COMBINED.test(name)) return null;
  const segments = name.split(SEPARATOR);
  if (segments.length < 2) return null;
  const match = matchPartName(segments[segments.length - 1]);
  return match?.exact ? match.name : null;
}

/** The part named in a page's embedded text, if a line of it is a part name. */
export function partNameFromText(text: string): string | null {
  for (const line of text.split('\n').slice(0, 12)) {
    for (const label of line.split(/\s{2,}|\t/)) {
      const match = matchPartName(label);
      if (match?.exact) return match.name;
    }
  }
  return null;
}

/** Classify a PDF from its name, then from the text of its first page. Scans without a telling name are combined. */
export function classifyFile(fileName: string, firstPageText: string): FileClass {
  return classifyByName(fileName) ?? (partNameFromText(firstPageText) ? 'single' : 'combined');
}

/** A piece title guessed from a loose file: the name without a trailing "Einzelstimmen"/"score"/part segment. */
export function pieceNameFromFileName(fileName: string): string {
  const name = stem(fileName);
  const cut = [...name.matchAll(new RegExp(SEPARATOR, 'g'))].pop();
  if (!cut || cut.index === undefined) return name;
  const tail = name.slice(cut.index + cut[0].length);
  const head = name.slice(0, cut.index).trim();
  const tailIsLabel = SCORE.test(tail) || COMBINED.test(tail) || matchPartName(tail)?.exact;
  return tailIsLabel && head ? head : name;
}
