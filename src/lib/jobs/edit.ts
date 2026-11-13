import { nanoid } from 'nanoid';
import { nextUnknownName, reflag } from '@/lib/detect/group';
import type { FileClass, Job, Part, Piece, SourceFile } from '@/lib/types';

/** A change the owner makes in the review screen. */
export type EditOp =
  | { op: 'rename'; fileId: string; partId: string; name: string }
  | { op: 'split'; fileId: string; partId: string; atPage: number }
  | { op: 'join'; fileId: string; partId: string }
  | { op: 'discard'; fileId: string; page: number; discarded: boolean }
  | { op: 'discardPart'; fileId: string; partId: string; discarded: boolean }
  | { op: 'setClass'; fileId: string; class: FileClass }
  | { op: 'renamePiece'; pieceId: string; name: string };

/** The edit makes no sense for the job as it stands; the message is shown to the owner. */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

const MAX_NAME = 120;
const CLASSES: FileClass[] = ['score', 'single', 'combined'];

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new EditError('A name is required.');
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new EditError('A name is required.');
  if (trimmed.length > MAX_NAME) throw new EditError(`Names can be at most ${MAX_NAME} characters long.`);
  return trimmed;
}

function withFile(job: Job, fileId: unknown, change: (file: SourceFile) => SourceFile): Job {
  let found = false;
  const pieces = job.pieces.map((piece): Piece => ({
    ...piece,
    files: piece.files.map((file) => {
      if (file.id !== fileId) return file;
      found = true;
      return change(file);
    }),
  }));
  if (!found) throw new EditError('That file is not part of this upload.');
  return { ...job, pieces };
}

function ready(file: SourceFile): void {
  if (file.status !== 'done') throw new EditError('This file is not ready to be edited yet.');
}

function partIndex(file: SourceFile, partId: unknown): number {
  const index = file.parts.findIndex((p) => p.id === partId);
  if (index === -1) throw new EditError('That part no longer exists.');
  return index;
}

function setDiscarded(file: SourceFile, pages: number[], discarded: boolean): SourceFile {
  const set = new Set(file.discarded);
  for (const page of pages) {
    if (discarded) set.add(page);
    else set.delete(page);
  }
  return { ...file, discarded: [...set].sort((a, b) => a - b) };
}

/**
 * Applies one edit and returns the new job; the input is not modified.
 * Splits and joins only move the boundaries between neighbouring parts, so
 * every page stays in exactly one part and in its original order.
 */
export function applyEdit(job: Job, op: EditOp): Job {
  switch (op?.op) {
    case 'rename': {
      const name = cleanName(op.name);
      return withFile(job, op.fileId, (file) => {
        ready(file);
        const index = partIndex(file, op.partId);
        const parts = file.parts.map((p, i) =>
          i === index ? { ...p, name, flags: p.flags.filter((f) => f !== 'fuzzy') } : p,
        );
        return { ...file, parts: reflag(parts) };
      });
    }

    case 'split':
      return withFile(job, op.fileId, (file) => {
        ready(file);
        if (file.class !== 'combined') throw new EditError('Only a file holding several parts can be split.');
        const index = partIndex(file, op.partId);
        const part = file.parts[index];
        const at = part.pages.indexOf(op.atPage);
        if (at <= 0) throw new EditError('A part can only be cut between two of its own pages.');
        const head: Part = { ...part, pages: part.pages.slice(0, at) };
        const tail: Part = {
          id: nanoid(8),
          name: nextUnknownName(file.parts.map((p) => p.name)),
          pages: part.pages.slice(at),
          confidence: 'low',
          flags: ['unknown'],
        };
        return { ...file, parts: reflag([...file.parts.slice(0, index), head, tail, ...file.parts.slice(index + 1)]) };
      });

    case 'join':
      return withFile(job, op.fileId, (file) => {
        ready(file);
        const index = partIndex(file, op.partId);
        if (index === 0) throw new EditError('The first part has nothing before it to join.');
        const before = file.parts[index - 1];
        const merged: Part = { ...before, pages: [...before.pages, ...file.parts[index].pages] };
        return { ...file, parts: reflag([...file.parts.slice(0, index - 1), merged, ...file.parts.slice(index + 1)]) };
      });

    case 'discard':
      return withFile(job, op.fileId, (file) => {
        ready(file);
        if (!Number.isInteger(op.page) || op.page < 0 || op.page >= file.pageCount) {
          throw new EditError('That page is not part of this file.');
        }
        return setDiscarded(file, [op.page], Boolean(op.discarded));
      });

    case 'discardPart':
      return withFile(job, op.fileId, (file) => {
        ready(file);
        return setDiscarded(file, file.parts[partIndex(file, op.partId)].pages, Boolean(op.discarded));
      });

    case 'setClass': {
      if (!CLASSES.includes(op.class)) throw new EditError('Unknown kind of file.');
      let queued = false;
      const next = withFile(job, op.fileId, (file) => {
        if (file.status !== 'done' && file.status !== 'error') ready(file);
        if (file.class === op.class && file.status === 'done') return file;
        if (op.class === 'score') return { ...file, class: 'score', parts: [] };
        if (op.class === 'single') {
          const whole: Part = {
            id: nanoid(8),
            name: file.parts[0]?.name ?? 'Unbekannt 1',
            pages: Array.from({ length: file.pageCount }, (_, i) => i),
            confidence: 'high',
            flags: [],
          };
          return { ...file, class: 'single', parts: reflag([whole]) };
        }
        // Becoming a set of parts means the pages have to be read; the pipeline picks it up.
        queued = true;
        const { error: _error, ...rest } = file;
        return { ...rest, class: 'combined', parts: [], status: 'pending' };
      });
      return queued ? { ...next, status: 'processing' } : next;
    }

    case 'renamePiece': {
      const name = cleanName(op.name);
      if (!job.pieces.some((p) => p.id === op.pieceId)) throw new EditError('That piece is not part of this upload.');
      return { ...job, pieces: job.pieces.map((p) => (p.id === op.pieceId ? { ...p, name } : p)) };
    }

    default:
      throw new EditError('Unknown edit.');
  }
}
