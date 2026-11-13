import { join } from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import type { OcrLine } from '@/lib/types';

export type Ocr = {
  lines(png: Buffer): Promise<OcrLine[]>;
  close(): Promise<void>;
};

type Box = { x0: number; y0: number; x1: number; y1: number };
type Word = { text: string; bbox: Box; confidence: number };

/** Words below this Tesseract confidence are noise (staff lines, smudges). */
const MIN_WORD_CONFIDENCE = 30;
/**
 * Two words further apart than this many line-heights belong to different
 * labels. A scan often has the part name and the composer on one baseline at
 * opposite margins; Tesseract reports them as a single line.
 */
const GAP_IN_LINE_HEIGHTS = 1.5;

/** Splits one OCR line into the separate labels printed on it. */
export function splitLine(words: Word[], width: number, height: number): OcrLine[] {
  const kept = words.filter((w) => w.text.trim() && w.confidence >= MIN_WORD_CONFIDENCE);
  if (kept.length === 0) return [];
  const lineHeight = Math.max(...kept.map((w) => w.bbox.y1 - w.bbox.y0));
  const groups: Word[][] = [[kept[0]]];
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].bbox.x0 - kept[i - 1].bbox.x1;
    if (gap > lineHeight * GAP_IN_LINE_HEIGHTS) groups.push([]);
    groups[groups.length - 1].push(kept[i]);
  }
  return groups.map((group) => ({
    text: group.map((w) => w.text.trim()).join(' '),
    x0: Math.min(...group.map((w) => w.bbox.x0)) / width,
    x1: Math.max(...group.map((w) => w.bbox.x1)) / width,
    y0: Math.min(...group.map((w) => w.bbox.y0)) / height,
    y1: Math.max(...group.map((w) => w.bbox.y1)) / height,
  }));
}

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** One Tesseract worker. Language data is read from ./tessdata; nothing is downloaded. */
export async function createOcr(): Promise<Ocr> {
  const langPath = process.env.TESSDATA_DIR || join(process.cwd(), 'tessdata');
  const worker = await createWorker(['eng', 'deu'], 1, {
    langPath,
    gzip: false,
    cacheMethod: 'none',
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });

  return {
    async lines(png) {
      const { width, height } = pngSize(png);
      const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
      const out: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) out.push(...splitLine(line.words, width, height));
        }
      }
      return out;
    },
    async close() {
      await worker.terminate();
    },
  };
}
