import type { PartKey, PartMatch } from '@/lib/types';
import { FILLER, INSTRUMENTS, RANKS, type Instrument, type Rank } from './catalog';

type Hit = { instrument: Instrument; start: number; end: number; exact: boolean };

/** Longest part name we accept; anything longer is a sentence, not a label. */
const MAX_TOKENS = 7;
/** Unrecognised words tolerated around a part name before we give up. */
const MAX_UNKNOWN = 2;

const ALIAS_INDEX: { words: string[]; instrument: Instrument; exact: boolean }[] = INSTRUMENTS.flatMap(
  (instrument) => [
    ...instrument.aliases.map((a) => ({ words: a.split(' '), instrument, exact: true })),
    ...(instrument.slips ?? []).map((a) => ({ words: a.split(' '), instrument, exact: false })),
  ],
).sort((a, b) => b.words.length - a.words.length);

const RANK_INDEX = new Map<string, { rank: Rank; exact: boolean }>();
for (const rank of RANKS) {
  for (const a of rank.aliases) RANK_INDEX.set(a, { rank, exact: true });
  for (const a of rank.slips ?? []) RANK_INDEX.set(a, { rank, exact: false });
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/♭/g, 'b')
    .replace(/(\d)\./g, '$1 ')
    .replace(/[&+|]/g, ' $& ')
    .replace(/[^\p{L}\p{N}&+|]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Edit distance, capped: returns 2 for anything further apart than 1. */
function nearDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function findHits(tokens: string[]): Hit[] {
  const hits: Hit[] = [];
  let i = 0;
  while (i < tokens.length) {
    const alias = ALIAS_INDEX.find((a) => a.words.every((w, k) => tokens[i + k] === w));
    if (alias) {
      hits.push({ instrument: alias.instrument, start: i, end: i + alias.words.length, exact: alias.exact });
      i += alias.words.length;
      continue;
    }
    const token = tokens[i];
    if (token.length >= 5) {
      const near = ALIAS_INDEX.find(
        (a) => a.exact && a.words.length === 1 && a.words[0].length >= 5 && nearDistance(token, a.words[0]) <= 1,
      );
      if (near) hits.push({ instrument: near.instrument, start: i, end: i + 1, exact: false });
    }
    i++;
  }
  // "Bass Trombone" is a trombone, not a bass followed by a trombone.
  return hits.filter((h, k) => !(h.instrument.family === 'bass' && hits[k + 1]?.instrument.family === 'trombone'));
}

/** Distinct instrument families named in a line, in order of appearance. */
export function instrumentFamilies(text: string): string[] {
  const families: string[] = [];
  for (const hit of findHits(tokenize(text))) {
    if (!families.includes(hit.instrument.family)) families.push(hit.instrument.family);
  }
  return families;
}

function keyOf(token: string): PartKey | null {
  if (token === 'eb' || token === 'es' || token === 'e') return 'Eb';
  if (token === 'bb' || token === 'b') return 'Bb';
  if (token === 'c') return 'C';
  return null;
}

/** A digit after the instrument numbers the part: "Percussion 2", "Solo Cornet 1&2". OCR reads a lone 1 as | or l. */
function partNumber(token: string): string | null {
  if (/^\d$/.test(token)) return token;
  if (token === '|' || token === 'l') return '1';
  return null;
}

export function matchPartName(text: string): PartMatch | null {
  const tokens = tokenize(text);
  const words = tokens.filter((t) => t !== '|');
  if (words.length === 0 || words.length > MAX_TOKENS) return null;

  const hits = findHits(tokens);
  if (hits.length === 0) return null;
  if (new Set(hits.map((h) => h.instrument.family)).size > 1) return null;

  const hit = hits[0];
  const { instrument } = hit;
  const used = new Set<number>();
  for (const h of hits) for (let i = h.start; i < h.end; i++) used.add(i);

  let exact = hits.every((h) => h.exact);
  const ranks: Rank[] = [];
  const numbers: string[] = [];
  let key: PartKey | null = null;
  let bassRank = false;
  let unknown = 0;

  tokens.forEach((token, i) => {
    if (used.has(i) || FILLER.has(token)) return;

    if (i >= hit.end) {
      const n = partNumber(token);
      if (n) {
        numbers.push(n);
        return;
      }
    }
    if (token === '|') return;
    if (instrument.family === 'trombone' && token === 'bass') {
      bassRank = true;
      return;
    }
    const rank = instrument.kind === 'numbered' ? undefined : RANK_INDEX.get(token);
    if (rank) {
      if (!ranks.includes(rank.rank)) ranks.push(rank.rank);
      if (!rank.exact) exact = false;
      return;
    }
    const k = keyOf(token);
    if (k) {
      key = k;
      return;
    }
    // Other short leftovers are OCR debris from a flat sign.
    if (token.length > 2) unknown++;
  });

  if (unknown > MAX_UNKNOWN) return null;
  if (unknown > 0) exact = false;

  ranks.sort((a, b) => a.order - b.order);
  const prefix = [
    ...(bassRank ? ['Bass'] : []),
    ...(instrument.kind === 'keyed' && key ? [key] : []),
    ...(ranks.length ? [ranks.map((r) => r.display).join(' + ')] : []),
  ];
  const suffix = numbers.length ? ` ${numbers.join('+')}` : '';
  return { name: [...prefix, instrument.display].join(' ') + suffix, exact, key };
}
