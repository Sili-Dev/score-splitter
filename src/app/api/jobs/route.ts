import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '@/lib/config';
import { ingestLoosePdfs, ingestZip, NoPdfsError, startJob } from '@/lib/jobs/process';
import { createJob, deleteJob, jobDir, jobFilesDir } from '@/lib/jobs/store';
import { BadUploadError, receiveUpload } from '@/lib/upload';
import { UploadTooLargeError } from '@/lib/zip/unpack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HELP = 'Upload a zip file, or one or more PDFs.';

function tooLarge(): Response {
  const mb = Math.round(getConfig().maxUploadBytes / 1024 / 1024);
  return Response.json({ error: `This upload is too large. The limit is ${mb} MB.` }, { status: 413 });
}

/** Accepts one zip or any number of PDFs, and starts reading them. */
export async function POST(request: Request): Promise<Response> {
  const { maxUploadBytes } = getConfig();
  // Multipart framing adds a little to the declared length; the exact check happens while streaming.
  if (Number(request.headers.get('content-length')) > maxUploadBytes + 1024 * 1024) return tooLarge();

  const job = await createJob('Upload');
  try {
    const incoming = join(jobDir(job.id), 'incoming');
    const received = await receiveUpload(request, incoming, maxUploadBytes);
    const zips = received.filter((f) => f.kind === 'zip');
    const pdfs = received.filter((f) => f.kind === 'pdf');

    if (received.length === 0 || zips.length + pdfs.length !== received.length) throw new BadUploadError(HELP);
    if (zips.length > 1 || (zips.length === 1 && pdfs.length > 0)) throw new BadUploadError(HELP);

    if (zips.length === 1) {
      await ingestZip(job.id, zips[0].storedPath, zips[0].originalName);
    } else {
      const files = await Promise.all(
        pdfs.map(async (pdf) => {
          const storedPath = join(jobFilesDir(job.id), `${pdf.storedPath.slice(incoming.length + 1, -7)}.pdf`);
          await rename(pdf.storedPath, storedPath);
          return { originalName: pdf.originalName, storedPath };
        }),
      );
      await ingestLoosePdfs(job.id, files);
    }
    await rm(incoming, { recursive: true, force: true });
    startJob(job.id);
    return Response.json({ id: job.id }, { status: 201 });
  } catch (cause) {
    await deleteJob(job.id).catch(() => undefined);
    if (cause instanceof UploadTooLargeError) return tooLarge();
    if (cause instanceof BadUploadError || cause instanceof NoPdfsError) {
      return Response.json({ error: cause.message }, { status: 400 });
    }
    // Anything else at this point is a zip we could not open.
    return Response.json({ error: 'This zip file could not be opened. It may be damaged.' }, { status: 400 });
  }
}
