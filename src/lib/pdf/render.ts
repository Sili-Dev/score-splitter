import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

/** Share of the page height, from the top, that is searched for a part name. */
export const HEADER_FRACTION = 0.25;
/** Resolution of the header strip handed to OCR. */
export const HEADER_DPI = 150;

export type OpenPdf = {
  pageCount: number;
  /** PNG of the top of the page, for OCR. */
  renderHeader(page: number): Promise<Buffer>;
  /** JPEG of the whole page, `width` pixels wide. */
  renderThumb(page: number, width: number): Promise<Buffer>;
  /** Text embedded in the page; empty for scans. */
  pageText(page: number): Promise<string>;
  close(): Promise<void>;
};

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | undefined;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Folder of a pdf.js asset set, as pdf.js wants it in Node: a plain path
 * ending in a slash. It reads these with fs, which does not take file: URLs.
 */
function assetUrl(folder: string): string {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  return join(root, folder).split(sep).join('/') + '/';
}

export async function openPdf(path: string, options: { warnings?: boolean } = {}): Promise<OpenPdf> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: assetUrl('standard_fonts'),
    cMapUrl: assetUrl('cmaps'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    verbosity: options.warnings ? 1 : 0,
  }).promise;

  /** Renders the top `fraction` of a page at `scale` (1 = 72 dpi). */
  async function render(pageIndex: number, scale: number, fraction: number) {
    const page = await doc.getPage(pageIndex + 1);
    try {
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height * fraction));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      return canvas;
    } finally {
      page.cleanup();
    }
  }

  return {
    pageCount: doc.numPages,
    async renderHeader(pageIndex) {
      const canvas = await render(pageIndex, HEADER_DPI / 72, HEADER_FRACTION);
      return canvas.toBuffer('image/png');
    },
    async renderThumb(pageIndex, width) {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const canvas = await render(pageIndex, width / base.width, 1);
      return canvas.toBuffer('image/jpeg', 82);
    },
    async pageText(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      // One label per line: a part name and a title on the same baseline are separate items.
      return content.items
        .map((item) => ('str' in item ? item.str.trim() : ''))
        .filter(Boolean)
        .join('\n');
    },
    async close() {
      await doc.loadingTask.destroy();
    },
  };
}
