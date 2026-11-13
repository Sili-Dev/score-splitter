import { nanoid } from 'nanoid';
import type { PageDetection, Part, PartFlag, PartKey } from '@/lib/types';

const UNKNOWN_NAME = /^Unbekannt \d+$/;

export function isUnknownName(name: string): boolean {
  return UNKNOWN_NAME.test(name);
}

/** The next free "Unbekannt <n>" among the given names. */
export function nextUnknownName(names: string[]): string {
  let n = 1;
  while (names.includes(`Unbekannt ${n}`)) n++;
  return `Unbekannt ${n}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Recompute the flags that depend on a part's neighbours (long, duplicate,
 * unknown). "fuzzy" records how the name was detected and is left alone.
 */
export function reflag(parts: Part[]): Part[] {
  if (parts.length === 0) return [];
  const typical = median(parts.map((p) => p.pages.length));
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.name.toLowerCase(), (count.get(p.name.toLowerCase()) ?? 0) + 1);

  return parts.map((part) => {
    const flags: PartFlag[] = [];
    const unknown = isUnknownName(part.name);
    if (part.flags.includes('fuzzy') && !unknown) flags.push('fuzzy');
    if (part.pages.length > 1 && part.pages.length > 2 * typical) flags.push('long');
    if (!unknown && (count.get(part.name.toLowerCase()) ?? 0) > 1) flags.push('duplicate');
    if (unknown) flags.push('unknown');
    return { ...part, flags, confidence: flags.length ? 'low' : 'high' };
  });
}

/** Words of a header that could belong to a title: letters only, four or more. */
function titleWords(rawText: string): Set<string> {
  return new Set(rawText.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
}

/** A word must be in the header of at least this many pages to count as part of the title block. */
const MIN_TITLE_PAGES = 3;
/** ...and in at least this share of all pages. */
const MIN_TITLE_SHARE = 0.25;
/** Fewer title words than this is too little to go on. */
const MIN_TITLE_WORDS = 3;
/** Share of the title words a header must contain for the page to count as a part's first page. */
const FIRST_PAGE_SHARE = 0.6;

/**
 * For each page: does its header carry the piece's title block?
 *
 * The first page of every part repeats the title, composer and arranger;
 * continuation pages do not. So words that recur across many page headers
 * are the title block, and a page showing most of them is a first page.
 * Returns null when no title block can be made out, e.g. for a file whose
 * parts are all many pages long.
 */
export function findFirstPages(detections: PageDetection[]): boolean[] | null {
  const pages = detections.map((d) => titleWords(d.rawText));
  const seen = new Map<string, number>();
  for (const words of pages) for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1);

  const needed = Math.max(MIN_TITLE_PAGES, Math.ceil(pages.length * MIN_TITLE_SHARE));
  const title = [...seen].filter(([, n]) => n >= needed).map(([w]) => w);
  if (title.length < MIN_TITLE_WORDS) return null;

  return pages.map((words) => title.filter((w) => words.has(w)).length >= title.length * FIRST_PAGE_SHARE);
}

type Draft = Part & { key: PartKey | null };

/**
 * Parts that share a name but were printed with different keys are different
 * parts: a trombone part in Bb treble clef and the same part in C bass clef.
 * Name them after their key. Copies with the same key stay duplicates.
 */
function nameByKey(drafts: Draft[]): void {
  const byName = new Map<string, Draft[]>();
  for (const d of drafts) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  for (const group of byName.values()) {
    const keys = new Set(group.map((d) => d.key));
    if (group.length < 2 || keys.size < 2) continue;
    // By convention an unmarked part next to a Bb one is in C, and the reverse.
    const unmarked: PartKey | null = keys.has('Bb') ? 'C' : keys.has('C') ? 'Bb' : null;
    for (const d of group) {
      const key = d.key ?? unmarked;
      if (key) d.name = `${d.name} (${key})`;
    }
  }
}

/**
 * Turn per-page detections into parts.
 *
 * A page starts a new part when its header shows the title block, or names a
 * different part than the one before. Every other page continues the part
 * before it, however many pages that takes.
 */
export function groupPages(detections: PageDetection[]): Part[] {
  const firstPages = findFirstPages(detections);
  const drafts: Draft[] = [];

  const startUnknown = (page: number) => {
    drafts.push({
      id: nanoid(8),
      name: nextUnknownName(drafts.map((d) => d.name)),
      pages: [page],
      confidence: 'low',
      flags: ['unknown'],
      key: null,
    });
  };

  detections.forEach((detection, page) => {
    const current = drafts[drafts.length - 1];
    const isFirst = firstPages?.[page] ?? false;

    if (detection.partName === null) {
      if (current && !isFirst) current.pages.push(page);
      else startUnknown(page);
      return;
    }
    if (current && current.name === detection.partName && !isFirst) {
      current.pages.push(page);
      return;
    }
    drafts.push({
      id: nanoid(8),
      name: detection.partName,
      pages: [page],
      confidence: detection.confidence,
      flags: detection.confidence === 'low' ? ['fuzzy'] : [],
      key: detection.key,
    });
  });

  nameByKey(drafts);
  return reflag(drafts.map(({ key: _key, ...part }) => part));
}
