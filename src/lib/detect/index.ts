import { createOcr } from '@/lib/ocr/tesseract';
import { openPdf } from '@/lib/pdf/render';
import type { PageDetection } from '@/lib/types';
import { detectPart } from './header';
import { rotationsToTry, settleRotations, staffAxis, type PageLie, type Rotation } from './orientation';

/** A reading must have this many letters, and twice as many as any other, to show which way up a page is. */
const MIN_TELLING_LETTERS = 6;

const letters = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;

/**
 * Reads the header of every page of a PDF and reports which part, if any,
 * each page starts. A page may lie any way round: it is read in each
 * orientation its staff lines allow until a part name turns up.
 * `concurrency` is the number of OCR workers.
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
    const lies: PageLie[] = new Array(pdf.pageCount);
    let next = 0;
    let done = 0;
    // The orientation of the last page that named a part; tried first on the next.
    let previous: Rotation = 0;
    await Promise.all(
      ocrs.map(async (ocr) => {
        while (next < pdf.pageCount) {
          const page = next++;
          const image = await pdf.renderForOcr(page);
          const axis = staffAxis(image.pixels(), image.width, image.height);
          let found: PageDetection | undefined;
          const readings: { rotation: Rotation; detection: PageDetection; letters: number }[] = [];
          for (const rotation of rotationsToTry(axis, previous)) {
            const detection = detectPart(await ocr.lines(image.header(rotation)));
            if (detection.partName) {
              found = detection;
              previous = rotation;
              lies[page] = { axis, named: rotation, wordy: null };
              break;
            }
            readings.push({ rotation, detection, letters: letters(detection.rawText) });
          }
          if (found) {
            results[page] = found;
          } else {
            // Without a part name, the reading with the most text: the others were the page upside down or sideways.
            readings.sort((a, b) => b.letters - a.letters);
            const [most, next] = readings;
            const telling = most.letters >= MIN_TELLING_LETTERS && most.letters >= 2 * (next?.letters ?? 0);
            results[page] = most.detection;
            lies[page] = { axis, named: null, wordy: telling ? most.rotation : null };
          }
          onPage?.(++done, pdf.pageCount);
        }
      }),
    );
    const rotations = settleRotations(lies);
    return results.map((detection, page) => ({ ...detection, rotation: rotations[page] }));
  } finally {
    await Promise.all(ocrs.map((o) => o.close()));
    await pdf.close();
  }
}
