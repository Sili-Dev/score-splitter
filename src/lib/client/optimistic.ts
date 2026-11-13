import { exportProblems } from '@/lib/export-plan';
import { applyEdit, type EditOp } from '@/lib/jobs/edit';
import type { JobView } from '@/lib/jobs/view';
import type { Job } from '@/lib/types';

/**
 * Applies an edit in the browser with the same code the server runs, so the
 * screen changes at once. The server's answer replaces it a moment later.
 * Throws EditError if the edit is not possible.
 */
export function applyEditToView(view: JobView, op: EditOp): JobView {
  // The view lacks only `storedPath`, which no edit reads.
  const next = applyEdit(view as unknown as Job, op);
  return { ...(next as unknown as JobView), problems: exportProblems(next), expiresAt: view.expiresAt };
}
