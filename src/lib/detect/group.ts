import { nanoid } from 'nanoid';
import type { PageDetection, Part, PartFlag } from '@/lib/types';

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

/**
 * Turn per-page detections into parts. A page with a part name starts a new
 * part; a page without one continues the part before it, however many pages
 * that takes.
 */
export function groupPages(detections: PageDetection[]): Part[] {
  const parts: Part[] = [];
  detections.forEach((detection, page) => {
    const current = parts[parts.length - 1];
    if (detection.partName === null) {
      if (current) current.pages.push(page);
      else parts.push({ id: nanoid(8), name: 'Unbekannt 1', pages: [page], confidence: 'low', flags: ['unknown'] });
      return;
    }
    if (current && current.name === detection.partName) {
      current.pages.push(page);
      return;
    }
    parts.push({
      id: nanoid(8),
      name: detection.partName,
      pages: [page],
      confidence: detection.confidence,
      flags: detection.confidence === 'low' ? ['fuzzy'] : [],
    });
  });
  return reflag(parts);
}
