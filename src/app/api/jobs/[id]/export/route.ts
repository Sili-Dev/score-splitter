import { PassThrough, Readable } from 'node:stream';
import { exportProblems, safeName, writeExportZip } from '@/lib/export';
import { readJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Streams the finished zip, or says what still stands in the way. */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const job = await readJob((await params).id);
  if (!job) return Response.json({ error: 'This upload no longer exists.' }, { status: 404 });

  const { blocking } = exportProblems(job);
  if (blocking.length > 0) {
    return Response.json({ error: 'Some parts still need attention.', blocking }, { status: 409 });
  }

  const pipe = new PassThrough();
  writeExportZip(job, pipe).catch((cause) => pipe.destroy(cause as Error));

  const name = `${safeName(job.name)}.zip`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return new Response(Readable.toWeb(pipe) as unknown as ReadableStream, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  });
}
