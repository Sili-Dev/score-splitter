import { jobThumbsDir, readJob } from '@/lib/jobs/store';
import { pageThumb, thumbWidth } from '@/lib/pdf/thumbs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; fileId: string; page: string }> };

const notFound = () => new Response('Not found', { status: 404 });

/** A JPEG of one page of an uploaded PDF. `?w=` sets the width in pixels. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id, fileId, page: pageParam } = await params;
  const job = await readJob(id);
  const file = job?.pieces.flatMap((p) => p.files).find((f) => f.id === fileId);
  if (!file || !/^\d{1,5}$/.test(pageParam)) return notFound();

  const page = Number(pageParam);
  if (page >= file.pageCount) return notFound();

  const requested = Number(new URL(request.url).searchParams.get('w') ?? 240);
  try {
    const jpg = await pageThumb(file.storedPath, jobThumbsDir(id), file.id, page, thumbWidth(requested), file.rotations?.[page] ?? 0);
    return new Response(new Uint8Array(jpg), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400, immutable' },
    });
  } catch {
    return new Response('This page could not be rendered', { status: 500 });
  }
}
