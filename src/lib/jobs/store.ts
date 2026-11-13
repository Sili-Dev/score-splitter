import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { getConfig } from '@/lib/config';
import type { Job } from '@/lib/types';

const JOB_ID = /^[A-Za-z0-9_-]{12}$/;

export function isJobId(id: string): boolean {
  return JOB_ID.test(id);
}

function jobsRoot(): string {
  return resolve(getConfig().dataDir, 'jobs');
}

/** Folder holding everything that belongs to one job. Throws on an id that is not ours. */
export function jobDir(id: string): string {
  if (!isJobId(id)) throw new Error('Invalid job id');
  return join(jobsRoot(), id);
}

/** Where a job's uploaded PDFs are stored. */
export function jobFilesDir(id: string): string {
  return join(jobDir(id), 'files');
}

/** Where a job's rendered page thumbnails are cached. */
export function jobThumbsDir(id: string): string {
  return join(jobDir(id), 'thumbs');
}

function jobFile(id: string): string {
  return join(jobDir(id), 'job.json');
}

async function write(job: Job): Promise<void> {
  const target = jobFile(job.id);
  const tmp = `${target}.${nanoid(6)}.tmp`;
  await writeFile(tmp, JSON.stringify(job));
  await rename(tmp, target);
}

export async function createJob(name: string): Promise<Job> {
  const job: Job = {
    id: nanoid(12),
    name,
    createdAt: new Date().toISOString(),
    status: 'processing',
    pieces: [],
    ignored: [],
  };
  await mkdir(jobFilesDir(job.id), { recursive: true });
  await write(job);
  return job;
}

export async function readJob(id: string): Promise<Job | null> {
  if (!isJobId(id)) return null;
  try {
    return JSON.parse(await readFile(jobFile(id), 'utf8')) as Job;
  } catch {
    return null;
  }
}

// One queue per job, shared by every copy of this module the server loads,
// so that an edit from the browser and a progress update from the pipeline
// never overwrite each other.
const queues: Map<string, Promise<unknown>> = ((globalThis as Record<string, unknown>).__scoreSplitterQueues ??=
  new Map()) as Map<string, Promise<unknown>>;

export class JobNotFoundError extends Error {
  constructor() {
    super('This upload no longer exists.');
    this.name = 'JobNotFoundError';
  }
}

/** Reads a job, applies `fn`, and writes the result; calls for the same job run one at a time. */
export function updateJob(id: string, fn: (job: Job) => Job): Promise<Job> {
  const run = async () => {
    const job = await readJob(id);
    if (!job) throw new JobNotFoundError();
    const next = fn(job);
    await write(next);
    return next;
  };
  const result = (queues.get(id) ?? Promise.resolve()).then(run, run);
  const tail = result.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return result;
}

export async function deleteJob(id: string): Promise<void> {
  await rm(jobDir(id), { recursive: true, force: true, maxRetries: 3 });
}

export async function listJobIds(): Promise<string[]> {
  try {
    const entries = await readdir(jobsRoot(), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && isJobId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}
