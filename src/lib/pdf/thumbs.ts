import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { openPdf, type OpenPdf } from './render';

/** How long an opened PDF is kept after its last thumbnail, so a screenful of pages opens the file once. */
const IDLE_MS = 20_000;
export const MIN_THUMB_WIDTH = 80;
export const MAX_THUMB_WIDTH = 1600;

type Entry = { pdf: Promise<OpenPdf>; queue: Promise<unknown>; timer?: NodeJS.Timeout };
const open: Map<string, Entry> = ((globalThis as Record<string, unknown>).__scoreSplitterPdfs ??= new Map()) as Map<
  string,
  Entry
>;

function close(path: string): Promise<void> {
  const entry = open.get(path);
  if (!entry) return Promise.resolve();
  open.delete(path);
  clearTimeout(entry.timer);
  return entry.queue
    .catch(() => undefined)
    .then(() => entry.pdf)
    .then((pdf) => pdf.close())
    .catch(() => undefined);
}

/** Closes every cached PDF under a folder. Needed before deleting it: Windows will not delete an open file. */
export async function closePdfsUnder(dir: string): Promise<void> {
  await Promise.all([...open.keys()].filter((path) => path.startsWith(dir)).map(close));
}

/** Rounds a requested width to a multiple of 40 inside the allowed range, so few variants are ever rendered. */
export function thumbWidth(requested: number): number {
  const w = Number.isFinite(requested) ? requested : 240;
  return Math.min(MAX_THUMB_WIDTH, Math.max(MIN_THUMB_WIDTH, Math.round(w / 40) * 40));
}

/**
 * A JPEG of one page, rendered once and then served from `cacheDir`.
 * Renders of the same PDF run one at a time.
 */
export async function pageThumb(
  pdfPath: string,
  cacheDir: string,
  cacheKey: string,
  page: number,
  width: number,
): Promise<Buffer> {
  const cached = join(cacheDir, `${cacheKey}-${page}-${width}.jpg`);
  try {
    return await readFile(cached);
  } catch {
    // not rendered yet
  }

  let entry = open.get(pdfPath);
  if (!entry) {
    entry = { pdf: openPdf(pdfPath), queue: Promise.resolve() };
    open.set(pdfPath, entry);
    entry.pdf.catch(() => open.delete(pdfPath));
  }
  clearTimeout(entry.timer);
  const current = entry;
  const render = current.queue.catch(() => undefined).then(async () => (await current.pdf).renderThumb(page, width));
  current.queue = render;
  try {
    const jpg = await render;
    await mkdir(cacheDir, { recursive: true });
    const tmp = `${cached}.${nanoid(6)}.tmp`;
    await writeFile(tmp, jpg);
    await rename(tmp, cached).catch(() => undefined);
    return jpg;
  } finally {
    if (open.get(pdfPath) === current) {
      clearTimeout(current.timer);
      current.timer = setTimeout(() => void close(pdfPath), IDLE_MS);
      current.timer.unref();
    }
  }
}
