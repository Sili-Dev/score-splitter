'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditOp } from '@/lib/jobs/edit';
import type { JobView } from '@/lib/jobs/view';
import { applyEditToView } from './optimistic';

const POLL_MS = 1500;

export type UseJob = {
  job: JobView | null;
  /** 'gone' once the server says the job does not exist. */
  state: 'loading' | 'ok' | 'gone' | 'failed';
  /** Applies an edit at once and saves it; resolves to an error message, or null. */
  edit(op: EditOp): Promise<string | null>;
};

/** Loads a job, keeps it fresh while the server is still reading pages, and saves edits. */
export function useJob(id: string): UseJob {
  const [job, setJob] = useState<JobView | null>(null);
  const [state, setState] = useState<UseJob['state']>('loading');
  // Edits in flight: a poll result that arrives meanwhile is older than what is on screen.
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${id}`, { cache: 'no-store' });
      if (res.status === 404) return setState('gone');
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as JobView;
      if (pending.current === 0) setJob(next);
      setState('ok');
    } catch {
      setState((s) => (s === 'loading' ? 'failed' : s));
    }
  }, [id]);

  useEffect(() => {
    // Fetch on arrival; the state changes it makes all happen after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const processing = job?.status === 'processing';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  const edit = useCallback(
    async (op: EditOp): Promise<string | null> => {
      let before: JobView | null = null;
      setJob((current) => {
        before = current;
        if (!current) return current;
        try {
          return applyEditToView(current, op);
        } catch {
          return current;
        }
      });
      pending.current++;
      try {
        const res = await fetch(`/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(op),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          if (pending.current === 1) setJob(before);
          return (body as { error?: string } | null)?.error ?? 'error';
        }
        if (pending.current === 1) setJob(body as JobView);
        return null;
      } catch {
        if (pending.current === 1) setJob(before);
        return 'error';
      } finally {
        pending.current--;
      }
    },
    [id],
  );

  return { job, state, edit };
}
