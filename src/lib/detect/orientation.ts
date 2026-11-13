import type { Rotation } from '@/lib/types';

export type { Rotation };

/** Which way the staff lines of a page run, or null when the page has too few to tell. */
export type StaffAxis = 'horizontal' | 'vertical' | null;

/** A pixel darker than this (0..255) is ink. */
const INK = 128;
/** One projection must be this many times as peaked as the other to decide. */
const AXIS_RATIO = 2;
/** Fewer ink pixels than this share of the page is a blank page: nothing to go on. */
const MIN_INK_SHARE = 0.002;

/** Squared coefficient of variation of a profile: high when ink comes in sharp lines. */
function peakedness(profile: Float64Array): number {
  let sum = 0;
  for (const v of profile) sum += v;
  const mean = sum / profile.length;
  if (mean === 0) return 0;
  let variance = 0;
  for (const v of profile) variance += (v - mean) ** 2;
  return variance / profile.length / (mean * mean);
}

/**
 * Staff lines run across the whole width of a page, so the count of ink
 * pixels per row spikes at every line, while the count per column stays
 * fairly even. On a page turned a quarter, it is the other way round.
 * `rgba` is the page as canvas image data.
 */
export function staffAxis(rgba: Uint8ClampedArray, width: number, height: number): StaffAxis {
  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  let ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Rec. 601 luma, without the division.
      if (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114 < INK * 1000) {
        rows[y]++;
        cols[x]++;
        ink++;
      }
    }
  }
  if (ink < width * height * MIN_INK_SHARE) return null;
  const across = peakedness(rows);
  const down = peakedness(cols);
  if (across > down * AXIS_RATIO) return 'horizontal';
  if (down > across * AXIS_RATIO) return 'vertical';
  return null;
}

/**
 * The rotations to try reading a page in, most likely first. Staff lines
 * leave two candidates; which of the two is upright only the text can tell.
 * `previous` is the rotation of the last page that was read successfully:
 * the pages of one scan usually lie the same way.
 */
export function rotationsToTry(axis: StaffAxis, previous: Rotation): Rotation[] {
  const all: Rotation[] = [0, 180, 90, 270];
  const candidates = axis === 'horizontal' ? [0, 180] : axis === 'vertical' ? [90, 270] : all;
  const ordered = candidates.includes(previous) ? [previous, ...candidates.filter((r) => r !== previous)] : candidates;
  return ordered as Rotation[];
}

/** What reading one page told about the way it lies. */
export type PageLie = {
  axis: StaffAxis;
  /** The rotation a part name was read in; null when none was. */
  named: Rotation | null;
  /** The rotation that gave clearly more text than the others, when one did. */
  wordy: Rotation | null;
};

/**
 * The rotation of every page. A page that named its part lies the way it
 * was read. Any other page takes the rotation that gave it clearly the most
 * text, else that of the page before it (pages of one part are scanned
 * alike) if its staff lines allow it, else the first its staff lines allow.
 */
export function settleRotations(pages: PageLie[]): Rotation[] {
  const out: Rotation[] = [];
  let last: Rotation = 0;
  for (const page of pages) {
    const allowed = rotationsToTry(page.axis, last);
    const rotation = page.named ?? (page.wordy !== null && allowed.includes(page.wordy) ? page.wordy : allowed[0]);
    out.push(rotation);
    last = rotation;
  }
  return out;
}
