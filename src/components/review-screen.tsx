'use client';

import { AlertTriangle, ArrowDown, Download, EyeOff, Link2, Scissors, Trash2, Undo2 } from 'lucide-react';
import { Fragment, useCallback, useId, useMemo, useState } from 'react';
import { Brand } from '@/components/brand';
import { PageLightbox } from '@/components/page-lightbox';
import { ThemeToggle } from '@/components/theme-toggle';
import { t } from '@/lib/i18n/en';
import type { EditOp } from '@/lib/jobs/edit';
import type { FileView, JobView, PieceView } from '@/lib/jobs/view';
import { STANDARD_PARTS } from '@/lib/parts/catalog';
import type { FileClass, Part } from '@/lib/types';

export type ReviewProps = {
  job: JobView;
  onEdit(op: EditOp): void;
  onDelete(): void;
  onDownload(): void;
  /** URL of a page image `width` pixels wide. */
  thumbSrc(fileId: string, page: number, width: number): string;
};

const THUMB_W = 124;
const THUMB_H = Math.round(THUMB_W * 1.414);

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring';

function partIsOut(file: FileView, part: Part): boolean {
  return part.pages.every((p) => file.discarded.includes(p));
}

function countParts(job: JobView) {
  let parts = 0;
  let toCheck = 0;
  for (const piece of job.pieces) {
    for (const file of piece.files) {
      for (const part of file.parts) {
        if (partIsOut(file, part)) continue;
        parts++;
        if (part.flags.length > 0) toCheck++;
      }
    }
  }
  return { parts, toCheck };
}

function expiresIn(iso: string): string {
  const hours = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3600_000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return hours >= 1 ? rtf.format(hours, 'hour') : rtf.format(Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 60_000)), 'minute');
}

/** A text field that looks like plain text until it is touched, and saves on Enter or when left. */
function InlineName({
  value,
  onCommit,
  className,
  label,
  placeholder,
  list,
  testId,
}: {
  value: string;
  onCommit(next: string): void;
  className: string;
  label: string;
  placeholder?: string;
  list?: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  // When the saved name changes under us (an edit elsewhere, the server's answer), show it.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(value);
    else if (next !== value) onCommit(next);
  };

  return (
    <input
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      list={list}
      data-testid={testId}
      // Sized to its text where the browser can; `size` is the fallback.
      size={Math.max(6, draft.length)}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={`min-w-[4ch] max-w-full [field-sizing:content] rounded-sm border-b border-transparent bg-transparent outline-none transition-colors hover:border-border focus:border-brass ${className}`}
    />
  );
}

function PageThumb({
  src,
  page,
  discarded,
  onOpen,
}: {
  src: string;
  page: number;
  discarded: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t.page.open(page + 1)}
      style={{ width: THUMB_W, height: THUMB_H }}
      className={`group/thumb relative shrink-0 overflow-hidden rounded-[3px] bg-paper shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_rgb(0_0_0/0.18)] ring-1 ring-black/5 transition-transform duration-150 hover:-translate-y-0.5 ${focusRing} ${discarded ? 'page-struck' : ''}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered on demand by our own API */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={THUMB_W}
        height={THUMB_H}
        className={`size-full object-cover object-top ${discarded ? 'opacity-35 grayscale' : ''}`}
      />
      <span className="absolute right-1 bottom-1 rounded-full bg-black/55 px-1.5 text-[10px] leading-4 font-medium text-white tabular-nums">
        {page + 1}
      </span>
    </button>
  );
}

/** The gap between two pages: cut here to start a new part, or join the two parts that meet here. */
function Seam({ kind, afterPage, onClick }: { kind: 'split' | 'join'; afterPage: number; onClick(): void }) {
  const Icon = kind === 'split' ? Scissors : Link2;
  const label = kind === 'split' ? t.part.split : t.part.join;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={`cut-after-page-${afterPage}`}
      style={{ height: THUMB_H }}
      className={`group/seam relative flex shrink-0 items-center justify-center rounded-md ${kind === 'split' ? 'w-4' : 'w-7'} ${focusRing}`}
    >
      {kind === 'split' && (
        <span className="h-[70%] border-l border-dashed border-foreground/15 transition-colors group-hover/seam:border-brass group-focus-visible/seam:border-brass" />
      )}
      <span
        className={`absolute flex size-7 items-center justify-center rounded-full border bg-card text-brass shadow-sm transition-all group-hover/seam:scale-100 group-hover/seam:opacity-100 group-focus-visible/seam:scale-100 group-focus-visible/seam:opacity-100 ${
          kind === 'split' ? 'scale-75 opacity-0' : 'scale-90 border-transparent bg-transparent text-muted-foreground/60 opacity-100 shadow-none group-hover/seam:border-border group-hover/seam:bg-card group-hover/seam:text-brass group-hover/seam:shadow-sm'
        }`}
      >
        <Icon className="size-3.5" />
      </span>
    </button>
  );
}

function PartGroup({
  file,
  part,
  splittable,
  namesId,
  onEdit,
  thumbSrc,
  onOpen,
}: {
  file: FileView;
  part: Part;
  splittable: boolean;
  namesId: string;
  onEdit(op: EditOp): void;
  thumbSrc: ReviewProps['thumbSrc'];
  onOpen(page: number): void;
}) {
  const out = partIsOut(file, part);
  const flagged = part.flags.length > 0 && !out;
  const flag = part.flags.includes('unknown') ? 'unknown' : part.flags[0];

  return (
    <div
      id={`part-${part.id}`}
      data-testid="part-group"
      data-flagged={flagged || undefined}
      className="group/part flex scroll-mt-40 flex-col gap-1.5"
    >
      <div className="flex h-7 items-center gap-2 pl-2">
        <InlineName
          value={part.name}
          label={t.part.nameLabel}
          placeholder={t.part.namePlaceholder}
          list={namesId}
          testId="part-name"
          onCommit={(name) => onEdit({ op: 'rename', fileId: file.id, partId: part.id, name })}
          className={`text-sm font-medium ${out ? 'text-muted-foreground line-through' : ''} ${flag === 'unknown' && !out ? 'text-brass' : ''}`}
        />
        <button
          type="button"
          title={out ? t.part.restore : t.part.discard}
          aria-label={out ? t.part.restore : t.part.discard}
          onClick={() => onEdit({ op: 'discardPart', fileId: file.id, partId: part.id, discarded: !out })}
          className={`ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground ${focusRing} ${out ? '' : 'opacity-0 group-hover/part:opacity-100 focus-visible:opacity-100'}`}
        >
          {out ? <Undo2 className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
      </div>
      <div
        className={`flex w-fit rounded-xl p-2 transition-colors ${flagged ? 'bg-brass-soft ring-1 ring-brass/40' : 'bg-tray'}`}
      >
        {part.pages.map((page, i) => (
          <Fragment key={page}>
            {i > 0 &&
              (splittable ? (
                <Seam
                  kind="split"
                  afterPage={part.pages[i - 1]}
                  onClick={() => onEdit({ op: 'split', fileId: file.id, partId: part.id, atPage: page })}
                />
              ) : (
                <span className="w-2 shrink-0" />
              ))}
            <PageThumb
              src={thumbSrc(file.id, page, THUMB_W * 2)}
              page={page}
              discarded={file.discarded.includes(page)}
              onOpen={() => onOpen(page)}
            />
          </Fragment>
        ))}
      </div>
      {/* Zero intrinsic width: the note never makes a part wider than its pages. */}
      <p className="h-4 w-0 min-w-full truncate pl-2 text-[11px] leading-4">
        {out ? (
          <span className="text-muted-foreground">{t.part.discarded}</span>
        ) : (
          flagged && (
            <span title={part.flags.map((f) => t.part.flagHint[f]).join(' ')} className="cursor-help font-medium text-brass">
              <AlertTriangle className="mr-1 inline size-3 align-[-2px]" />
              {t.part.flag[flag]}
            </span>
          )
        )}
      </p>
    </div>
  );
}

function KindSelect({ file, onEdit }: { file: FileView; onEdit(op: EditOp): void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">{t.file.kindHint}</span>
      <select
        value={file.class}
        title={t.file.kindHint}
        onChange={(e) => onEdit({ op: 'setClass', fileId: file.id, class: e.target.value as FileClass })}
        className={`cursor-pointer rounded-md border border-transparent bg-transparent py-0.5 pr-1 pl-1 text-xs font-medium text-foreground/80 hover:border-border ${focusRing}`}
      >
        {(Object.keys(t.file.kind) as FileClass[]).map((k) => (
          <option key={k} value={k}>
            {t.file.kind[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileBlock({
  file,
  showName,
  namesId,
  onEdit,
  thumbSrc,
  onOpen,
}: {
  file: FileView;
  showName: boolean;
  namesId: string;
  onEdit(op: EditOp): void;
  thumbSrc: ReviewProps['thumbSrc'];
  onOpen(page: number): void;
}) {
  const header = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {(file.status === 'done' || file.status === 'error') && <KindSelect file={file} onEdit={onEdit} />}
      {showName && <span className="truncate">{file.originalName}</span>}
    </div>
  );

  if (file.status === 'pending' || file.status === 'processing') {
    const progress = file.progress;
    const percent = progress ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex flex-col gap-2" data-testid="file-reading">
        <div className="text-xs text-muted-foreground">{file.originalName}</div>
        <div className="rounded-xl bg-tray p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span>
              {file.status === 'pending'
                ? t.file.waiting
                : progress
                  ? t.file.readingPage(progress.done, progress.total)
                  : t.file.readingStart}
            </span>
            {progress && <span className="text-muted-foreground tabular-nums">{percent}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full bg-brass transition-[width] duration-500 ${progress ? '' : 'w-1/4 animate-pulse'}`}
              style={progress ? { width: `${percent}%` } : undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  if (file.status === 'error') {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{file.originalName}</p>
            <p className="text-muted-foreground">{file.error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (file.class === 'score') {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <div className="flex w-fit items-center gap-4 rounded-xl bg-tray p-2 pr-6">
          <PageThumb src={thumbSrc(file.id, 0, THUMB_W * 2)} page={0} discarded={false} onOpen={() => onOpen(0)} />
          <p className="text-sm text-muted-foreground">{t.file.scoreNote(file.pageCount)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {header}
      <div className="flex flex-wrap items-start gap-y-3">
        {file.parts.map((part, i) => (
          <Fragment key={part.id}>
            {i > 0 ? (
              <Seam
                kind="join"
                afterPage={file.parts[i - 1].pages[file.parts[i - 1].pages.length - 1]}
                onClick={() => onEdit({ op: 'join', fileId: file.id, partId: part.id })}
              />
            ) : null}
            <PartGroup
              file={file}
              part={part}
              splittable={file.class === 'combined'}
              namesId={namesId}
              onEdit={onEdit}
              thumbSrc={thumbSrc}
              onOpen={onOpen}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PieceSection({
  piece,
  namesId,
  onEdit,
  thumbSrc,
  onOpen,
}: {
  piece: PieceView;
  namesId: string;
  onEdit(op: EditOp): void;
  thumbSrc: ReviewProps['thumbSrc'];
  onOpen(fileId: string, page: number): void;
}) {
  const pages = piece.files.reduce((n, f) => n + f.pageCount, 0);
  const parts = piece.files.flatMap((f) => f.parts.filter((p) => !partIsOut(f, p)));
  const toCheck = parts.filter((p) => p.flags.length > 0).length;
  const reading = piece.files.some((f) => f.status === 'pending' || f.status === 'processing');
  // Scores first, as in the export.
  const files = [...piece.files].sort((a, b) => Number(b.class === 'score') - Number(a.class === 'score'));

  return (
    <section aria-label={piece.name} data-testid="piece" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3">
        <h2 className="min-w-0">
          <InlineName
            value={piece.name}
            label={t.review.renamePiece}
            onCommit={(name) => onEdit({ op: 'renamePiece', pieceId: piece.id, name })}
            className="font-serif text-[1.7rem] leading-tight font-medium tracking-tight"
          />
        </h2>
        <p className="text-sm text-muted-foreground">
          {reading ? (
            t.review.reading
          ) : (
            <>
              {t.review.pages(pages)} · {t.review.parts(parts.length)}
              {toCheck > 0 && <span className="font-medium text-brass"> · {t.review.toCheck(toCheck)}</span>}
            </>
          )}
        </p>
      </header>
      {files.map((file) => (
        <FileBlock
          key={file.id}
          file={file}
          showName={piece.files.length > 1}
          namesId={namesId}
          onEdit={onEdit}
          thumbSrc={thumbSrc}
          onOpen={(page) => onOpen(file.id, page)}
        />
      ))}
    </section>
  );
}

/** The whole review page: every piece, its parts as rows of page thumbnails, and the way out. */
export function ReviewScreen({ job, onEdit, onDelete, onDownload, thumbSrc }: ReviewProps) {
  const namesId = useId();
  const [open, setOpen] = useState<{ fileId: string; page: number } | null>(null);
  const { parts, toCheck } = useMemo(() => countParts(job), [job]);
  const blocked = job.problems.blocking.length > 0;
  const unnamed = job.pieces.flatMap((p) => p.files.flatMap((f) => f.parts.filter((x) => x.flags.includes('unknown') && !partIsOut(f, x)))).length;

  const openFile = open ? job.pieces.flatMap((p) => p.files).find((f) => f.id === open.fileId) : undefined;
  const openPart = openFile?.parts.find((p) => p.pages.includes(open!.page));

  const nextToCheck = useCallback(() => {
    const flagged = [...document.querySelectorAll<HTMLElement>('[data-flagged]')];
    if (flagged.length === 0) return;
    // The first flagged part below the middle of the window, else back to the first.
    const target = flagged.find((el) => el.getBoundingClientRect().top > window.innerHeight / 2 + 4) ?? flagged[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 pt-3 sm:px-8">
          <Brand />
          <span className="ml-auto" />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-end gap-x-6 gap-y-3 px-4 pt-1 pb-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-3xl font-medium tracking-tight sm:text-[2.1rem]">{job.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t.review.pieces(job.pieces.length)} · {t.review.parts(parts)} ·{' '}
              {toCheck > 0 ? (
                <span className="font-medium text-brass">{t.review.toCheck(toCheck)}</span>
              ) : job.status === 'processing' ? (
                t.review.reading
              ) : (
                t.review.allClear
              )}
              <span className="hidden sm:inline"> · {t.review.expires(expiresIn(job.expiresAt))}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDelete}
              title={t.review.delete}
              aria-label={t.review.delete}
              className={`inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${focusRing}`}
            >
              <Trash2 className="size-4" />
            </button>
            {toCheck > 0 && (
              <button
                type="button"
                onClick={nextToCheck}
                className={`inline-flex h-10 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted ${focusRing}`}
              >
                <ArrowDown className="size-4 text-brass" />
                {t.review.nextToCheck}
              </button>
            )}
            <button
              type="button"
              onClick={onDownload}
              disabled={blocked}
              title={blocked ? job.problems.blocking.join('\n') : undefined}
              className={`inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/85 active:translate-y-px disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none ${focusRing}`}
            >
              <Download className="size-4" />
              {t.review.download}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-12 px-4 py-8 sm:px-8">
        {(job.status === 'processing' || unnamed > 0 || job.problems.warnings.length > 0 || job.ignored.length > 0) && (
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground" data-testid="notices">
            {job.status === 'processing' && <li>{t.review.stillReading}</li>}
            {unnamed > 0 && <li className="font-medium text-brass">{t.review.blocked(unnamed)}</li>}
            {job.problems.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {job.ignored.length > 0 && <li title={job.ignored.join('\n')}>{t.review.ignored(job.ignored.length)}</li>}
          </ul>
        )}

        {job.pieces.map((piece) => (
          <PieceSection
            key={piece.id}
            piece={piece}
            namesId={namesId}
            onEdit={onEdit}
            thumbSrc={thumbSrc}
            onOpen={(fileId, page) => setOpen({ fileId, page })}
          />
        ))}
      </main>

      <datalist id={namesId}>
        {STANDARD_PARTS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {open && openFile && (
        <PageLightbox
          src={thumbSrc(openFile.id, open.page, 1600)}
          page={open.page}
          pageCount={openFile.pageCount}
          partName={openPart?.name ?? t.file.kind[openFile.class]}
          discarded={openFile.discarded.includes(open.page)}
          onStep={(delta) => setOpen({ fileId: openFile.id, page: open.page + delta })}
          onToggleDiscard={() =>
            onEdit({
              op: 'discard',
              fileId: openFile.id,
              page: open.page,
              discarded: !openFile.discarded.includes(open.page),
            })
          }
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
