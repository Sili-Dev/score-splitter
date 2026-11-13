import { getConfig } from '@/lib/config';
import { exportProblems, type ExportProblems } from '@/lib/export-plan';
import type { Job, Piece, SourceFile } from '@/lib/types';

/** A file as the browser sees it: everything but its location on the server. */
export type FileView = Omit<SourceFile, 'storedPath'>;
export type PieceView = Omit<Piece, 'files'> & { files: FileView[] };

/** What the API returns for a job. */
export type JobView = Omit<Job, 'pieces'> & {
  pieces: PieceView[];
  problems: ExportProblems;
  /** When the job and its files are deleted. */
  expiresAt: string;
};

export function toJobView(job: Job): JobView {
  return {
    ...job,
    pieces: job.pieces.map((piece) => ({
      ...piece,
      files: piece.files.map(({ storedPath: _storedPath, ...file }) => file),
    })),
    problems: exportProblems(job),
    expiresAt: new Date(Date.parse(job.createdAt) + getConfig().jobTtlMs).toISOString(),
  };
}
