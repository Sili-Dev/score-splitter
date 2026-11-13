import { stat } from 'node:fs/promises';
import { getConfig } from '@/lib/config';
import { deleteJob, jobDir, listJobIds, readJob } from './store';

/** Deletes every job older than the configured lifetime. Returns the ids it removed. */
export async function sweepExpiredJobs(now: number = Date.now()): Promise<string[]> {
  const { jobTtlMs } = getConfig();
  const removed: string[] = [];
  for (const id of await listJobIds()) {
    const job = await readJob(id);
    // A folder without a readable job file is a leftover; age it by the folder itself.
    const created = job ? Date.parse(job.createdAt) : await stat(jobDir(id)).then((s) => s.mtimeMs, () => now);
    if (now - created > jobTtlMs) {
      await deleteJob(id);
      removed.push(id);
    }
  }
  return removed;
}
