import { ZipArchive } from 'archiver';
import { planExport } from '@/lib/export-plan';
import { extractPages } from '@/lib/pdf/split';
import type { Job } from '@/lib/types';

export { exportProblems, planExport, safeName, type ExportEntry, type ExportProblems } from '@/lib/export-plan';

/**
 * Streams the export zip. PDFs are stored without compression: scans are
 * already-compressed images and do not shrink.
 */
export async function writeExportZip(job: Job, out: NodeJS.WritableStream): Promise<void> {
  const archive = new ZipArchive({ store: true });
  const finished = new Promise<void>((ok, fail) => {
    archive.on('error', fail);
    archive.on('warning', fail);
    out.on('error', fail);
    out.on('finish', () => ok());
  });
  archive.pipe(out);

  for (const entry of planExport(job)) {
    if (entry.pages === 'all') archive.file(entry.srcPath, { name: entry.zipPath });
    else archive.append(Buffer.from(await extractPages(entry.srcPath, entry.pages)), { name: entry.zipPath });
  }
  await archive.finalize();
  await finished;
}
