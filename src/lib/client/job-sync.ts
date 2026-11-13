import type { EditOp } from '@/lib/jobs/edit';
import type { JobView } from '@/lib/jobs/view';
import { applyEditToView } from './optimistic';

/** How the job is fetched and saved; the browser uses HTTP, tests use a fake. */
export type Transport = {
  load(): Promise<{ status: number; job?: JobView }>;
  save(op: EditOp): Promise<{ status: number; job?: JobView; error?: string }>;
};

export type Snapshot = {
  job: JobView | null;
  /** 'gone' once the server says the job does not exist. */
  state: 'loading' | 'ok' | 'gone' | 'failed';
};

/**
 * Keeps the job on screen in step with the server.
 *
 * What is shown is always the last state the server confirmed, with the edits
 * it has not answered yet applied on top. Edits are sent one at a time, in
 * order. An edit the server refuses is simply dropped from that list, so the
 * screen can never keep a change that was not saved.
 */
export class JobSync {
  private confirmed: JobView | null = null;
  private unanswered: EditOp[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  /** Changes whenever an edit starts or settles; a refresh requested before that is out of date. */
  private epoch = 0;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { job: null, state: 'loading' };

  constructor(private readonly transport: Transport) {}

  get job(): JobView | null {
    return this.snapshot.job;
  }

  get state(): Snapshot['state'] {
    return this.snapshot.state;
  }

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: Snapshot['state']): void {
    let job = this.confirmed;
    if (job) {
      for (const op of this.unanswered) {
        try {
          job = applyEditToView(job, op);
        } catch {
          // No longer applies to what the server has; the server will say so too.
        }
      }
    }
    this.snapshot = { job, state };
    for (const listener of this.listeners) listener();
  }

  /** Fetches the job. Safe to call at any time, e.g. on a timer while pages are still being read. */
  async load(): Promise<void> {
    const epoch = this.epoch;
    let result: Awaited<ReturnType<Transport['load']>>;
    try {
      result = await this.transport.load();
    } catch {
      if (this.state === 'loading') this.publish('failed');
      return;
    }
    if (result.status === 404) {
      this.confirmed = null;
      this.unanswered = [];
      return this.publish('gone');
    }
    if (result.status !== 200 || !result.job) {
      if (this.state === 'loading') this.publish('failed');
      return;
    }
    if (epoch !== this.epoch) return;
    this.confirmed = result.job;
    this.publish('ok');
  }

  /** Shows an edit at once and saves it. Resolves to an error message, or null when saved. */
  edit(op: EditOp): Promise<string | null> {
    if (!this.confirmed) return Promise.resolve('error');
    this.epoch++;
    this.unanswered.push(op);
    this.publish('ok');

    const send = async (): Promise<string | null> => {
      let result: Awaited<ReturnType<Transport['save']>>;
      try {
        result = await this.transport.save(op);
      } catch {
        result = { status: 0 };
      }
      this.unanswered.shift();
      this.epoch++;
      if (result.status === 200 && result.job) {
        this.confirmed = result.job;
        this.publish('ok');
        return null;
      }
      this.publish(this.state);
      // Make sure the screen shows what the server really has.
      if (this.unanswered.length === 0) await this.load();
      return result.error ?? 'error';
    };

    const sent = this.chain.then(send);
    this.chain = sent.catch(() => undefined);
    return sent;
  }
}
