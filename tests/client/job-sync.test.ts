import { describe, expect, it } from 'vitest';
import { JobSync, type Transport } from '@/lib/client/job-sync';
import type { EditOp } from '@/lib/jobs/edit';
import type { JobView } from '@/lib/jobs/view';

function makeView(): JobView {
  return {
    id: 'job',
    name: 'Concert',
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(1).toISOString(),
    status: 'ready',
    ignored: [],
    problems: { blocking: [], warnings: [] },
    pieces: [
      {
        id: 'piece',
        name: 'Alladale',
        files: [
          {
            id: 'f',
            originalName: 'parts.pdf',
            pageCount: 4,
            class: 'combined',
            discarded: [],
            status: 'done',
            parts: [
              { id: 'a', name: 'Solo Cornet', pages: [0, 1], confidence: 'high', flags: [] },
              { id: 'b', name: 'Timpani', pages: [2, 3], confidence: 'high', flags: [] },
            ],
          },
        ],
      },
    ],
  };
}

const rename = (partId: string, name: string): EditOp => ({ op: 'rename', fileId: 'f', partId, name });
const names = (view: JobView | null) => view?.pieces[0].files[0].parts.map((p) => p.name);

/** A server that holds a job and can be told to fail or to answer slowly. */
function fakeServer() {
  const saved = makeView();
  let failing = false;
  let hold = false;
  const patches: EditOp[] = [];
  const gates: (() => void)[] = [];
  const transport: Transport = {
    async load() {
      return { status: 200, job: structuredClone(saved) };
    },
    async save(op) {
      patches.push(op);
      if (hold) await new Promise<void>((r) => gates.push(r));
      if (failing) return { status: 500, error: 'boom' };
      const file = saved.pieces[0].files[0];
      if (op.op === 'rename') file.parts = file.parts.map((p) => (p.id === op.partId ? { ...p, name: op.name } : p));
      return { status: 200, job: structuredClone(saved) };
    },
  };
  return {
    transport,
    patches,
    saved,
    fail: (v: boolean) => (failing = v),
    holdSaves: (v: boolean) => (hold = v),
    release: () => gates.splice(0).forEach((g) => g()),
  };
}

describe('JobSync', () => {
  it('shows an edit at once and keeps it when the server agrees', async () => {
    const server = fakeServer();
    const sync = new JobSync(server.transport);
    await sync.load();
    const done = sync.edit(rename('a', '1st Horn'));
    expect(names(sync.job)).toEqual(['1st Horn', 'Timpani']);
    expect(await done).toBeNull();
    expect(names(sync.job)).toEqual(['1st Horn', 'Timpani']);
  });

  it('goes back to what the server has when two edits in a row both fail', async () => {
    const server = fakeServer();
    const sync = new JobSync(server.transport);
    await sync.load();
    server.fail(true);
    const results = await Promise.all([sync.edit(rename('a', 'Wrong 1')), sync.edit(rename('b', 'Wrong 2'))]);
    expect(results).toEqual(['boom', 'boom']);
    expect(names(sync.job)).toEqual(['Solo Cornet', 'Timpani']);
  });

  it('keeps a later edit that succeeded when an earlier one failed', async () => {
    const server = fakeServer();
    const sync = new JobSync(server.transport);
    await sync.load();
    server.fail(true);
    const first = sync.edit(rename('a', 'Wrong'));
    await first;
    server.fail(false);
    await sync.edit(rename('b', 'Drum Set'));
    expect(names(sync.job)).toEqual(['Solo Cornet', 'Drum Set']);
  });

  it('sends edits one at a time, in order', async () => {
    const server = fakeServer();
    const sync = new JobSync(server.transport);
    await sync.load();
    server.holdSaves(true);
    const first = sync.edit(rename('a', 'One'));
    const second = sync.edit(rename('b', 'Two'));
    await new Promise((r) => setTimeout(r, 10));
    expect(server.patches).toHaveLength(1);
    expect(names(sync.job)).toEqual(['One', 'Two']);
    server.holdSaves(false);
    server.release();
    await Promise.all([first, second]);
    expect(server.patches.map((p) => (p as { name: string }).name)).toEqual(['One', 'Two']);
    expect(names(sync.job)).toEqual(['One', 'Two']);
  });

  it('ignores a refresh that was requested before an edit and answers after it', async () => {
    const server = fakeServer();
    const stale = structuredClone(server.saved);
    let answerOld: () => void = () => undefined;
    let slowNext = false;
    const transport: Transport = {
      save: server.transport.save,
      load: () =>
        slowNext
          ? new Promise((r) => (answerOld = () => r({ status: 200, job: stale })))
          : server.transport.load(),
    };
    const sync = new JobSync(transport);
    await sync.load();

    slowNext = true;
    const refresh = sync.load();
    slowNext = false;
    await sync.edit(rename('a', '1st Horn'));
    answerOld();
    await refresh;
    expect(names(sync.job)).toEqual(['1st Horn', 'Timpani']);
  });

  it('reports a job that no longer exists', async () => {
    const sync = new JobSync({ load: async () => ({ status: 404 }), save: async () => ({ status: 404, error: 'gone' }) });
    await sync.load();
    expect(sync.state).toBe('gone');
    expect(sync.job).toBeNull();
  });

  it('tells its listener about every change', async () => {
    const server = fakeServer();
    const sync = new JobSync(server.transport);
    let calls = 0;
    sync.subscribe(() => calls++);
    await sync.load();
    await sync.edit(rename('a', '1st Horn'));
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
