import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { Rotation } from '@/lib/detect/orientation';

/** Share of the page height, from the top, that is searched for a part name. */
export const HEADER_FRACTION = 0.25;
/** Resolution of the header strip handed to OCR. */
export const HEADER_DPI = 150;

/** A whole page at OCR resolution, from which the header can be cut in any orientation. */
export type PageImage = {
  width: number;
  height: number;
  /** RGBA pixels of the page as it lies in the PDF. */
  pixels(): Uint8ClampedArray;
  /** PNG of the top of the page after turning it `rotation` degrees clockwise. */
  header(rotation: Rotation): Buffer;
};

export type OpenPdf = {
  pageCount: number;
  /** The page at the resolution OCR reads headers at. */
  renderForOcr(page: number): Promise<PageImage>;
  /** JPEG of the whole page turned `rotation` degrees clockwise, `width` pixels wide. */
  renderThumb(page: number, width: number, rotation?: Rotation): Promise<Buffer>;
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

  /** Renders the top `fraction` of a page at `scale` (1 = 72 dpi), turned `rotation` degrees further clockwise. */
  async function render(pageIndex: number, scale: number, fraction: number, rotation: Rotation = 0) {
    const page = await doc.getPage(pageIndex + 1);
    try {
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
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
    async renderForOcr(pageIndex) {
      return pageImage(await render(pageIndex, HEADER_DPI / 72, 1));
    },
    async renderThumb(pageIndex, width, rotation = 0) {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const canvas = await render(pageIndex, width / base.width, 1, rotation);
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

function pageImage(page: Canvas): PageImage {
  const { width, height } = page;
  return {
    width,
    height,
    pixels: () => page.getContext('2d').getImageData(0, 0, width, height).data,
    header(rotation) {
      const quarter = rotation === 90 || rotation === 270;
      const turnedWidth = quarter ? height : width;
      const turnedHeight = quarter ? width : height;
      const strip = createCanvas(turnedWidth, Math.max(1, Math.round(turnedHeight * HEADER_FRACTION)));
      const ctx = strip.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, strip.width, strip.height);
      // Turn about the centre of the turned page; whatever falls below the strip is cut off.
      ctx.translate(turnedWidth / 2, turnedHeight / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(page, -width / 2, -height / 2);
      return strip.toBuffer('image/png');
    },
  };
}
