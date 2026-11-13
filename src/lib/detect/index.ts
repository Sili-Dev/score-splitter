import { createOcr } from '@/lib/ocr/tesseract';
import { openPdf } from '@/lib/pdf/render';
import type { PageDetection } from '@/lib/types';
import { detectPart } from './header';

/**
 * Reads the header of every page of a PDF and reports which part, if any,
 * each page starts. `concurrency` is the number of OCR workers.
 */
export async function detectFile(
  path: string,
  onPage?: (done: number, total: number) => void,
  concurrency = 1,
): Promise<PageDetection[]> {
  const pdf = await openPdf(path);
  const workers = Math.max(1, Math.min(concurrency, pdf.pageCount));
  const ocrs = await Promise.all(Array.from({ length: workers }, () => createOcr()));
  try {
    const results: PageDetection[] = new Array(pdf.pageCount);
    let next = 0;
    let done = 0;
    await Promise.all(
      ocrs.map(async (ocr) => {
        while (next < pdf.pageCount) {
          const page = next++;
          results[page] = detectPart(await ocr.lines(await pdf.renderHeader(page)));
          onPage?.(++done, pdf.pageCount);
        }
      }),
    );
    return results;
  } finally {
    await Promise.all(ocrs.map((o) => o.close()));
    await pdf.close();
  }
}
