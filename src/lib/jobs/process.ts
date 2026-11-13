import { nanoid } from 'nanoid';
import { classifyByName, classifyFile, partNameFromFileName, partNameFromText } from '@/lib/classify';
import { getConfig } from '@/lib/config';
import { detectFile as realDetectFile } from '@/lib/detect';
import { groupPages, reflag } from '@/lib/detect/group';
import { openPdf } from '@/lib/pdf/render';
import { loadForSplitting } from '@/lib/pdf/split';
import type { Job, PageDetection, Part, Piece, SourceFile } from '@/lib/types';
import { piecesFromLoosePdfs, unpackZip, type UnpackedFile, type UnpackedPiece } from '@/lib/zip/unpack';
import { jobFilesDir, listJobIds, readJob, updateJob } from './store';

/** The slow, OCR-backed step, injectable so tests can run the pipeline in milliseconds. */
export type ProcessDeps = {
  detectFile(
    path: string,
    onPage?: (done: number, total: number) => void,
    concurrency?: number,
  ): Promise<PageDetection[]>;
  /** Throws if the PDF cannot be opened by the library that splits it. Defaults to really trying. */
  checkSplittable?(path: string): Promise<unknown>;
};

const defaultDeps: ProcessDeps = { detectFile: realDetectFile };

/** How many pages of a digital PDF are read to see whether it holds more than one part. */
const TEXT_PAGES_CHECKED = 40;

/** A zip may expand to this many times the upload limit before it is refused. */
const ZIP_EXPANSION_LIMIT = 4;
const PROGRESS_INTERVAL_MS = 400;

export class NoPdfsError extends Error {
  constructor() {
    super('No PDF files were found in this upload.');
    this.name = 'NoPdfsError';
  }
}

function toPieces(unpacked: UnpackedPiece[]): Piece[] {
  return unpacked.map((piece) => ({
    id: nanoid(8),
    name: piece.name,
    files: piece.files.map(
      (file): SourceFile => ({
        id: nanoid(8),
        originalName: file.originalName,
        storedPath: file.storedPath,
        pageCount: 0,
        class: 'combined',
        parts: [],
        discarded: [],
        status: 'pending',
      }),
    ),
  }));
}

/** Unpacks an uploaded zip into the job. Throws if it is too large or holds no PDFs. */
export async function ingestZip(jobId: string, zipPath: string, uploadName: string): Promise<void> {
  const limit = getConfig().maxUploadBytes * ZIP_EXPANSION_LIMIT;
  const unpacked = await unpackZip(zipPath, jobFilesDir(jobId), limit, uploadName);
  if (unpacked.pieces.length === 0) throw new NoPdfsError();
  await updateJob(jobId, (job) => ({
    ...job,
    name: unpacked.rootName,
    status: 'processing',
    pieces: toPieces(unpacked.pieces),
    ignored: unpacked.ignored,
  }));
}

/** Adds PDFs that were uploaded without a zip, as one piece. */
export async function ingestLoosePdfs(jobId: string, files: UnpackedFile[]): Promise<void> {
  const pieces = piecesFromLoosePdfs(files);
  if (pieces.length === 0) throw new NoPdfsError();
  await updateJob(jobId, (job) => ({ ...job, name: pieces[0].name, status: 'processing', pieces: toPieces(pieces) }));
}

function patchFile(job: Job, fileId: string, patch: (file: SourceFile) => SourceFile): Job {
  return {
    ...job,
    pieces: job.pieces.map((piece) => ({
      ...piece,
      files: piece.files.map((file) => (file.id === fileId ? patch(file) : file)),
    })),
  };
}

function wholeFile(name: string, pageCount: number): Part[] {
  const pages = Array.from({ length: pageCount }, (_, i) => i);
  return reflag([{ id: nanoid(8), name, pages, confidence: 'high', flags: [] }]);
}

async function processFile(jobId: string, file: SourceFile, deps: ProcessDeps): Promise<void> {
  // A file that has been read before is here because the owner changed its kind; keep their choice.
  const chosenClass = file.pageCount > 0 ? file.class : null;
  await updateJob(jobId, (job) => patchFile(job, file.id, (f) => ({ ...f, status: 'processing' })));

  let pageCount: number;
  let firstPageText: string;
  // Part names found in the text of the pages, for PDFs that are not scans.
  const namesInText = new Set<string>();
  try {
    const pdf = await openPdf(file.storedPath);
    try {
      pageCount = pdf.pageCount;
      firstPageText = pageCount > 0 ? await pdf.pageText(0) : '';
      for (let page = 0; firstPageText.trim() && page < Math.min(pageCount, TEXT_PAGES_CHECKED); page++) {
        const name = partNameFromText(page === 0 ? firstPageText : await pdf.pageText(page));
        if (name) namesInText.add(name);
      }
    } finally {
      await pdf.close();
    }
    if (pageCount === 0) throw new Error('no pages');
  } catch (cause) {
    const locked = /password/i.test(String(cause));
    throw new Error(
      locked
        ? 'This PDF could not be read: it is password-protected.'
        : 'This PDF could not be read. It may be damaged or not a PDF at all.',
    );
  }

  // The viewer and the splitter are different libraries. A PDF protected against
  // editing opens in the first and not in the second; better to say so now than
  // to fail when the owner presses download.
  try {
    await (deps.checkSplittable ?? loadForSplitting)(file.storedPath);
  } catch {
    throw new Error('This PDF could not be read for splitting. It may be protected against editing.');
  }

  let cls = chosenClass ?? classifyFile(file.originalName, firstPageText);
  // A file whose name says nothing and whose pages name different parts is a set of parts, not one part.
  if (!chosenClass && cls === 'single' && classifyByName(file.originalName) === null && namesInText.size > 1) {
    cls = 'combined';
  }
  let parts: Part[] = [];
  // Kept from an earlier reading unless this one reads the pages again.
  let rotations: SourceFile['rotations'] | 'keep' = 'keep';
  if (cls === 'single') {
    const name = partNameFromFileName(file.originalName) ?? partNameFromText(firstPageText) ?? 'Unbekannt 1';
    parts = wholeFile(name, pageCount);
  } else if (cls === 'combined') {
    let last = 0;
    const detections = await deps.detectFile(
      file.storedPath,
      (done, total) => {
        const now = Date.now();
        if (now - last < PROGRESS_INTERVAL_MS && done < total) return;
        last = now;
        void updateJob(jobId, (job) =>
          patchFile(job, file.id, (f) => (f.status === 'processing' ? { ...f, progress: { done, total } } : f)),
        ).catch(() => undefined);
      },
      getConfig().ocrConcurrency,
    );
    parts = groupPages(detections);
    const turns = detections.map((d) => d.rotation ?? 0);
    rotations = turns.some(Boolean) ? turns : undefined;
  }

  await updateJob(jobId, (job) =>
    patchFile(job, file.id, (f) => {
      const { progress: _progress, error: _error, ...rest } = f;
      const done: SourceFile = { ...rest, class: cls, pageCount, parts, status: 'done' };
      if (rotations === 'keep') return done;
      const { rotations: _old, ...fresh } = done;
      return rotations ? { ...fresh, rotations } : fresh;
    }),
  );
}

function unfinished(job: Job): SourceFile[] {
  return job.pieces.flatMap((p) => p.files).filter((f) => f.status === 'pending' || f.status === 'processing');
}

const running: Set<string> = ((globalThis as Record<string, unknown>).__scoreSplitterRunning ??= new Set()) as Set<string>;

/**
 * Reads every file of a job that has not been read yet, one after another.
 * A file that fails is marked and skipped; the job always ends up ready.
 */
export async function processJob(jobId: string, deps: ProcessDeps = defaultDeps): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    for (;;) {
      const job = await readJob(jobId);
      if (!job) return;
      const [next] = unfinished(job);
      if (!next) break;
      try {
        await processFile(jobId, next, deps);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const error = /could not be read/i.test(message) ? message : `This file could not be processed (${message}).`;
        await updateJob(jobId, (j) =>
          patchFile(j, next.id, (f) => {
            const { progress: _progress, ...rest } = f;
            return { ...rest, status: 'error', error };
          }),
        );
      }
    }
    await updateJob(jobId, (job) => (unfinished(job).length === 0 ? { ...job, status: 'ready' } : job));
  } catch (cause) {
    // The job was deleted while it was being read; nothing left to do.
    if ((cause as Error)?.name !== 'JobNotFoundError') throw cause;
  } finally {
    running.delete(jobId);
  }
}

/** Starts reading a job in the background and returns at once. */
export function startJob(jobId: string): void {
  void processJob(jobId).catch((cause) => console.error(`job ${jobId} failed`, cause));
}

/** After a restart: picks up every job that was still being read. */
export async function resumeUnfinishedJobs(deps: ProcessDeps = defaultDeps): Promise<void> {
  for (const id of await listJobIds()) {
    const job = await readJob(id);
    if (job && (job.status === 'processing' || unfinished(job).length > 0) && job.pieces.length > 0) {
      await processJob(id, deps);
    }
  }
}
