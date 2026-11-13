import { applyEdit, EditError, type EditOp } from '@/lib/jobs/edit';
import { startJob } from '@/lib/jobs/process';
import { deleteJob, isJobId, jobDir, JobNotFoundError, readJob, updateJob } from '@/lib/jobs/store';
import { toJobView } from '@/lib/jobs/view';
import { closePdfsUnder } from '@/lib/pdf/thumbs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: 'This upload no longer exists.' }, { status: 404 });

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const job = await readJob((await params).id);
  return job ? Response.json(toJobView(job)) : notFound();
}

/** Applies one edit from the review screen and returns the job as it now stands. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (!isJobId(id)) return notFound();

  let op: EditOp;
  try {
    op = await request.json();
  } catch {
    return Response.json({ error: 'The edit could not be understood.' }, { status: 400 });
  }
  if (!op || typeof op !== 'object') {
    return Response.json({ error: 'The edit could not be understood.' }, { status: 400 });
  }

  try {
    const job = await updateJob(id, (current) => applyEdit(current, op));
    // An edit can queue a file for reading, e.g. when a score turns out to be a set of parts.
    if (job.status === 'processing') startJob(id);
    return Response.json(toJobView(job));
  } catch (cause) {
    if (cause instanceof JobNotFoundError) return notFound();
    if (cause instanceof EditError) return Response.json({ error: cause.message }, { status: 400 });
    throw cause;
  }
}

export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  if (!(await readJob(id))) return notFound();
  await closePdfsUnder(jobDir(id));
  await deleteJob(id);
  return new Response(null, { status: 204 });
}
