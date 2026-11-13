'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { EditOp } from '@/lib/jobs/edit';
import type { JobView } from '@/lib/jobs/view';
import { JobSync, type Snapshot, type Transport } from './job-sync';

const POLL_MS = 1500;

function http(id: string): Transport {
  const url = `/api/jobs/${id}`;
  return {
    async load() {
      const res = await fetch(url, { cache: 'no-store' });
      return { status: res.status, job: res.ok ? ((await res.json()) as JobView) : undefined };
    },
    async save(op) {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(op),
      });
      const body = (await res.json().catch(() => null)) as (JobView & { error?: string }) | null;
      return res.ok && body ? { status: 200, job: body } : { status: res.status, error: body?.error };
    },
  };
}

export type UseJob = Snapshot & {
  /** Applies an edit at once and saves it; resolves to an error message, or null. */
  edit(op: EditOp): Promise<string | null>;
};

/** Loads a job, keeps it fresh while the server is still reading pages, and saves edits. */
export function useJob(id: string): UseJob {
  const sync = useMemo(() => new JobSync(http(id)), [id]);
  const { job, state } = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);

  useEffect(() => {
    void sync.load();
  }, [sync]);

  const processing = job?.status === 'processing';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void sync.load(), POLL_MS);
    return () => clearInterval(timer);
  }, [processing, sync]);

  const edit = useMemo(() => sync.edit.bind(sync), [sync]);
  return { job, state, edit };
}
