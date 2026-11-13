import { instrumentFamilies, matchPartName } from '@/lib/parts/match';
import type { OcrLine, PageDetection, PartMatch } from '@/lib/types';

/** A line starting left of this fraction of the page width is at the left margin. */
const LEFT_EDGE = 0.15;
/** A line ending right of this fraction is at the right margin. */
const RIGHT_EDGE = 0.85;

type Zone = 'left' | 'right' | 'centre';
const ZONE_RANK: Record<Zone, number> = { left: 0, right: 1, centre: 2 };

function zoneOf(line: OcrLine): Zone {
  if (line.x0 < LEFT_EDGE) return 'left';
  if (line.x1 > RIGHT_EDGE) return 'right';
  return 'centre';
}

/**
 * Decide which line of a page header, if any, is the part name.
 *
 * Part names sit at a margin; titles and subtitles are centred. A subtitle
 * can list instruments ("Flugel Horn, Horn & Baritone Trio"), so a line that
 * names more than one instrument is never taken as the part name.
 */
export function detectPart(lines: OcrLine[]): PageDetection {
  const rawText = lines.map((l) => l.text).join('\n');

  const candidates: { line: OcrLine; match: PartMatch; zone: Zone }[] = [];
  for (const line of lines) {
    if (instrumentFamilies(line.text).length >= 2) continue;
    const match = matchPartName(line.text);
    if (match) candidates.push({ line, match, zone: zoneOf(line) });
  }
  if (candidates.length === 0) return { partName: null, confidence: 'high', rawText, key: null };

  // Margin before centre, a clean reading before a doubtful one, and the
  // upper line before a lower one: playing instructions sit below the title block.
  candidates.sort(
    (a, b) =>
      ZONE_RANK[a.zone] - ZONE_RANK[b.zone] ||
      Number(b.match.exact) - Number(a.match.exact) ||
      a.line.y0 - b.line.y0,
  );
  const best = candidates[0];
  const confident = best.match.exact && best.zone !== 'centre';
  return { partName: best.match.name, confidence: confident ? 'high' : 'low', rawText, key: best.match.key };
}
