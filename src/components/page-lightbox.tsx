'use client';

import { ChevronLeft, ChevronRight, EyeOff, Undo2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n/en';

type Props = {
  src: string;
  page: number;
  pageCount: number;
  partName: string;
  discarded: boolean;
  onStep(delta: -1 | 1): void;
  onToggleDiscard(): void;
  onClose(): void;
};

const bar =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm text-white/85 outline-none transition-colors hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-30 disabled:hover:bg-transparent';

/** One page, large enough to read, with its neighbours a key press away. */
export function PageLightbox({ src, page, pageCount, partName, discarded, onStep, onToggleDiscard, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && page > 0) onStep(-1);
      if (e.key === 'ArrowRight' && page < pageCount - 1) onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStep, page, pageCount]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.page.label(page + 1, pageCount)}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1 text-white">
          <p className="truncate font-serif text-lg leading-tight">{partName}</p>
          <p className="text-xs text-white/60">{t.page.label(page + 1, pageCount)}</p>
        </div>
        <button type="button" className={bar} onClick={onToggleDiscard}>
          {discarded ? <Undo2 className="size-4" /> : <EyeOff className="size-4" />}
          <span className="hidden sm:inline">{discarded ? t.page.restore : t.page.discard}</span>
        </button>
        <button type="button" className={bar} onClick={() => onStep(-1)} disabled={page === 0} aria-label={t.page.previous}>
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          className={bar}
          onClick={() => onStep(1)}
          disabled={page === pageCount - 1}
          aria-label={t.page.next}
        >
          <ChevronRight className="size-5" />
        </button>
        <button ref={closeRef} type="button" className={bar} onClick={onClose} aria-label={t.page.close}>
          <X className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered on demand by our own API */}
        <img
          key={src}
          src={src}
          alt={t.page.label(page + 1, pageCount)}
          onClick={(e) => e.stopPropagation()}
          className={`max-h-full max-w-full rounded-sm bg-paper object-contain shadow-2xl ${discarded ? 'opacity-40' : ''}`}
        />
      </div>
    </div>
  );
}
