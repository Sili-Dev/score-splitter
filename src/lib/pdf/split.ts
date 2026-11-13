import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

/**
 * Builds a new PDF from the given zero-based pages of a source PDF.
 * Pages are copied object for object: images keep their original bytes, so
 * a split scan is exactly as sharp as the upload.
 */
export async function extractPages(srcPath: string, pages: number[]): Promise<Uint8Array> {
  return copyPagesFrom(await loadForSplitting(srcPath), pages);
}

/** Opens a PDF with the library that does the splitting. Throws if it cannot, e.g. for a protected file. */
export async function loadForSplitting(srcPath: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(srcPath), { ignoreEncryption: false });
}

/** As `extractPages`, for a source that is already open; lets one source serve many parts. */
export async function copyPagesFrom(source: PDFDocument, pages: number[]): Promise<Uint8Array> {
  const count = source.getPageCount();
  const bad = pages.find((p) => !Number.isInteger(p) || p < 0 || p >= count);
  if (bad !== undefined) throw new RangeError(`Page ${bad + 1} does not exist; the file has ${count} pages.`);

  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, pages)) out.addPage(page);
  return out.save();
}
