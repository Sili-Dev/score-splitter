// The pure half of export: what goes into the zip and what stands in the way.
// Kept free of Node-only imports so the review screen can run it in the browser.
import { isUnknownName } from '@/lib/detect/group';
import type { Job, Part, Rotation, SourceFile } from '@/lib/types';

/** `rotations`, indexed by source page, turns pages upright as they are copied. */
export type ExportEntry = { zipPath: string; srcPath: string; pages: number[] | 'all'; rotations?: Rotation[] };
export type ExportProblems = { blocking: string[]; warnings: string[] };

const SCORE_NAME = 'Partitur';

/** Makes a string safe as a file or folder name on Windows, macOS, Linux and cloud drives. */
export function safeName(s: string): string {
  const cleaned = s
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[-. ]+$/, '')
    .trim();
  return cleaned || 'Unnamed';
}

/** Hands out names, adding " (2)", " (3)" to repeats. Case-insensitive, as Windows and macOS are. */
function uniquer() {
  const used = new Set<string>();
  return (name: string): string => {
    let candidate = name;
    // Keep counting until the name is free: a part may itself be called "Solo Cornet (2)".
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

function keptPages(file: SourceFile, part: Part): number[] {
  return part.pages.filter((p) => !file.discarded.includes(p));
}

function allPages(file: SourceFile): number[] | 'all' {
  // Only a file that needs no page dropped and no page turned is copied as it is.
  if (file.discarded.length === 0 && !file.rotations) return 'all';
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
    const add = (label: string, file: SourceFile, pages: number[] | 'all') => {
      if (pages !== 'all' && pages.length === 0) return;
      const entry: ExportEntry = {
        zipPath: `${folder}/${title} - ${fileName(safeName(label))}.pdf`,
        srcPath: file.storedPath,
        pages,
      };
      if (file.rotations) entry.rotations = file.rotations;
      entries.push(entry);
    };

    const ready = piece.files.filter((f) => f.status === 'done');
    for (const file of ready.filter((f) => f.class === 'score')) add(SCORE_NAME, file, allPages(file));
    for (const file of ready.filter((f) => f.class !== 'score')) {
      if (file.class === 'single') {
        add(file.parts[0]?.name ?? 'Unbekannt 1', file, allPages(file));
      } else {
        for (const part of file.parts) add(part.name, file, keptPages(file, part));
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
