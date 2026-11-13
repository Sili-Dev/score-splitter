import { ZipArchive } from 'archiver';
import { isUnknownName } from '@/lib/detect/group';
import { extractPages } from '@/lib/pdf/split';
import type { Job, Part, SourceFile } from '@/lib/types';

export type ExportEntry = { zipPath: string; srcPath: string; pages: number[] | 'all' };
export type ExportProblems = { blocking: string[]; warnings: string[] };

const SCORE_NAME = 'Partitur';

/** Makes a string safe as a file or folder name on Windows, macOS, Linux and cloud drives. */
export function safeName(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[-. ]+$/, '')
    .trim();
  return cleaned || 'Unnamed';
}

/** Hands out names, adding " (2)", " (3)" to repeats. Case-insensitive, as Windows and macOS are. */
function uniquer() {
  const used = new Map<string, number>();
  return (name: string): string => {
    const key = name.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    return n === 1 ? name : `${name} (${n})`;
  };
}

function keptPages(file: SourceFile, part: Part): number[] {
  return part.pages.filter((p) => !file.discarded.includes(p));
}

function allPages(file: SourceFile): number[] | 'all' {
  if (file.discarded.length === 0) return 'all';
  return Array.from({ length: file.pageCount }, (_, i) => i).filter((p) => !file.discarded.includes(p));
}

/** The files the export zip will contain, in order. Pure: reads nothing from disk. */
export function planExport(job: Job): ExportEntry[] {
  const entries: ExportEntry[] = [];
  const root = safeName(job.name);
  const folderName = uniquer();

  for (const piece of job.pieces) {
    const title = safeName(piece.name);
    const folder = `${root}/${folderName(title)}`;
    const fileName = uniquer();
    const add = (label: string, srcPath: string, pages: number[] | 'all') => {
      if (pages !== 'all' && pages.length === 0) return;
      entries.push({ zipPath: `${folder}/${title} - ${fileName(safeName(label))}.pdf`, srcPath, pages });
    };

    const ready = piece.files.filter((f) => f.status === 'done');
    for (const file of ready.filter((f) => f.class === 'score')) add(SCORE_NAME, file.storedPath, allPages(file));
    for (const file of ready.filter((f) => f.class !== 'score')) {
      if (file.class === 'single') {
        add(file.parts[0]?.name ?? 'Unbekannt 1', file.storedPath, allPages(file));
      } else {
        for (const part of file.parts) add(part.name, file.storedPath, keptPages(file, part));
      }
    }
  }
  return entries;
}

/** What stops an export (`blocking`) and what the owner should know before one (`warnings`). */
export function exportProblems(job: Job): ExportProblems {
  const blocking: string[] = [];
  const warnings: string[] = [];

  for (const piece of job.pieces) {
    const names = new Map<string, number>();
    for (const file of piece.files) {
      if (file.status === 'pending' || file.status === 'processing') {
        blocking.push(`${piece.name}: ${file.originalName} is still being read`);
        continue;
      }
      if (file.status === 'error') {
        warnings.push(`${piece.name}: ${file.originalName} could not be read and is left out`);
        continue;
      }
      if (file.class === 'score') continue;
      for (const part of file.parts) {
        const pages = file.class === 'single' ? allPages(file) : keptPages(file, part);
        if (pages !== 'all' && pages.length === 0) continue;
        if (isUnknownName(part.name)) blocking.push(`${piece.name}: ${part.name}`);
        else names.set(part.name.toLowerCase(), (names.get(part.name.toLowerCase()) ?? 0) + 1);
      }
    }
    for (const part of new Set(piece.files.flatMap((f) => f.parts.map((p) => p.name)))) {
      const n = names.get(part.toLowerCase()) ?? 0;
      if (n > 1) {
        warnings.push(`${piece.name}: ${n} parts are named ${part}; they will be numbered`);
        names.delete(part.toLowerCase());
      }
    }
  }

  if (blocking.length === 0 && planExport(job).length === 0) blocking.push('There is nothing to export yet');
  return { blocking, warnings };
}

/**
 * Streams the export zip. PDFs are stored without compression: scans are
 * already-compressed images and do not shrink.
 */
export async function writeExportZip(job: Job, out: NodeJS.WritableStream): Promise<void> {
  const archive = new ZipArchive({ store: true });
  const finished = new Promise<void>((ok, fail) => {
    archive.on('error', fail);
    archive.on('warning', fail);
    out.on('error', fail);
    out.on('finish', () => ok());
  });
  archive.pipe(out);

  for (const entry of planExport(job)) {
    if (entry.pages === 'all') archive.file(entry.srcPath, { name: entry.zipPath });
    else archive.append(Buffer.from(await extractPages(entry.srcPath, entry.pages)), { name: entry.zipPath });
  }
  await archive.finalize();
  await finished;
}
