import { ZipArchive } from 'archiver';
import { planExport } from '@/lib/export-plan';
import type { PDFDocument } from 'pdf-lib';
import { copyPagesFrom, loadForSplitting } from '@/lib/pdf/split';
import type { Job } from '@/lib/types';

export { exportProblems, planExport, safeName, type ExportEntry, type ExportProblems } from '@/lib/export-plan';

/** A file that has to be split could not be opened for splitting; the message names it. */
export class ExportSourceError extends Error {
  constructor(fileName: string) {
    super(`${fileName} cannot be split. It may be damaged or protected against editing.`);
    this.name = 'ExportSourceError';
  }
}

function fileNameOf(job: Job, srcPath: string): string {
  const file = job.pieces.flatMap((p) => p.files).find((f) => f.storedPath === srcPath);
  return file?.originalName ?? 'A file';
}

/**
 * Opens every file that has to be split, then returns the function that
 * streams the zip. Throws ExportSourceError before anything is written, so a
 * download never starts and then breaks half-way.
 *
 * PDFs are stored without compression: scans are already-compressed images
 * and do not shrink.
 */
export async function prepareExport(job: Job): Promise<(out: NodeJS.WritableStream) => Promise<void>> {
  const entries = planExport(job);
  const sources = new Map<string, PDFDocument>();
  for (const entry of entries) {
    if (entry.pages === 'all' || sources.has(entry.srcPath)) continue;
    try {
      sources.set(entry.srcPath, await loadForSplitting(entry.srcPath));
    } catch {
      throw new ExportSourceError(fileNameOf(job, entry.srcPath));
    }
  }

  return async (out) => {
    const archive = new ZipArchive({ store: true });
    const finished = new Promise<void>((ok, fail) => {
      archive.on('error', fail);
      archive.on('warning', fail);
      out.on('error', fail);
      out.on('finish', () => ok());
    });
    // A download cancelled while a part is still being built must not surface as an unhandled rejection.
    finished.catch(() => undefined);
    archive.pipe(out);

    for (const entry of entries) {
      if (entry.pages === 'all') {
        archive.file(entry.srcPath, { name: entry.zipPath });
      } else {
        const source = sources.get(entry.srcPath) as PDFDocument;
        archive.append(Buffer.from(await copyPagesFrom(source, entry.pages, entry.rotations)), { name: entry.zipPath });
      }
    }
    await archive.finalize();
    await finished;
  };
}

/** Writes the export zip to `out`. */
export async function writeExportZip(job: Job, out: NodeJS.WritableStream): Promise<void> {
  const write = await prepareExport(job);
  await write(out);
}
