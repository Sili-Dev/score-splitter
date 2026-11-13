import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

export type ScanPage = {
  left?: string;
  centre?: string[];
  right?: string;
  /** The sheet was scanned turned this many degrees clockwise, with no /Rotate to undo it. */
  turned?: 90 | 180 | 270;
};

const W = 1240;
const H = 1754;

/**
 * Builds a PDF that looks like a scanned set of parts: every page is one
 * JPEG with no text layer. Header texts are drawn where the Alladale scan
 * has them: title block centred, part name at the left margin, composer at
 * the right. Used instead of real (copyrighted) sheet music in tests.
 */
export async function makeScanPdf(pages: ScanPage[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const spec of pages) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111111';

    ctx.textAlign = 'center';
    (spec.centre ?? []).forEach((text, i) => {
      ctx.font = i === 0 ? 'bold 52px Arial, Helvetica, sans-serif' : '30px Arial, Helvetica, sans-serif';
      ctx.fillText(text, W / 2, 110 + i * 56);
    });
    ctx.font = '32px Arial, Helvetica, sans-serif';
    if (spec.left) {
      ctx.textAlign = 'left';
      ctx.fillText(spec.left, 56, 205);
    }
    if (spec.right) {
      ctx.textAlign = 'right';
      ctx.fillText(spec.right, W - 56, 205);
    }

    // Staves, so that the page is not just a header on white.
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    for (let system = 0; system < 8; system++) {
      const top = 330 + system * 170;
      for (let line = 0; line < 5; line++) {
        ctx.beginPath();
        ctx.moveTo(110, top + line * 14);
        ctx.lineTo(W - 70, top + line * 14);
        ctx.stroke();
      }
    }

    const turned = spec.turned ?? 0;
    const quarter = turned === 90 || turned === 270;
    const scan = createCanvas(quarter ? H : W, quarter ? W : H);
    const sctx = scan.getContext('2d');
    sctx.translate(scan.width / 2, scan.height / 2);
    sctx.rotate((turned * Math.PI) / 180);
    sctx.drawImage(canvas, -W / 2, -H / 2);

    const jpg = await pdf.embedJpg(scan.toBuffer('image/jpeg', 85));
    const [w, h] = quarter ? [842, 595] : [595, 842];
    const page = pdf.addPage([w, h]);
    page.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
  }
  return pdf.save();
}
