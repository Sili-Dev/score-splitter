'use client';

import { FileUp, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n/en';

type State = { kind: 'idle' } | { kind: 'uploading'; percent: number } | { kind: 'unpacking' } | { kind: 'error'; message: string };

function send(files: File[], onProgress: (percent: number) => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(form);
  });
}

/** The whole window is the drop target; the box in the middle says so and offers a file picker. */
export function UploadDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const busy = state.kind === 'uploading' || state.kind === 'unpacking';

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || busy) return;
      setState({ kind: 'uploading', percent: 0 });
      try {
        const { status, body } = await send(files, (percent) =>
          setState(percent >= 100 ? { kind: 'unpacking' } : { kind: 'uploading', percent }),
        );
        const data = body as { id?: string; error?: string } | null;
        if (status === 201 && data?.id) return router.push(`/jobs/${data.id}`);
        setState({ kind: 'error', message: data?.error ?? t.upload.failed });
      } catch {
        setState({ kind: 'error', message: t.upload.failed });
      }
      if (input.current) input.current.value = '';
    },
    [busy, router],
  );

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const dragover = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void upload([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragover);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('drop', drop);
    };
  }, [upload]);

  return (
    <div className="flex flex-col gap-3">
      <label
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-all focus-within:ring-2 focus-within:ring-ring sm:py-20 ${
          over ? 'scale-[1.01] border-brass bg-brass-soft' : 'border-border bg-card hover:border-brass/60'
        } ${busy ? 'pointer-events-none' : ''}`}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept=".zip,.pdf,application/zip,application/pdf"
          data-testid="file-input"
          disabled={busy}
          onChange={(e) => void upload([...(e.target.files ?? [])])}
          className="sr-only"
        />
        <span
          className={`flex size-14 items-center justify-center rounded-full transition-colors ${over ? 'bg-brass text-background' : 'bg-tray text-brass'}`}
        >
          {busy ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
        </span>
        {state.kind === 'uploading' || state.kind === 'unpacking' ? (
          <div className="flex w-full max-w-xs flex-col gap-3" role="status">
            <p className="font-serif text-2xl">
              {state.kind === 'uploading' ? t.upload.uploading(state.percent) : t.upload.unpacking}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={`h-full rounded-full bg-brass transition-[width] duration-300 ${state.kind === 'unpacking' ? 'animate-pulse' : ''}`}
                style={{ width: `${state.kind === 'uploading' ? state.percent : 100}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="font-serif text-2xl sm:text-[1.7rem]">{over ? t.upload.dropActive : t.upload.drop}</p>
            <span className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/85">
              {t.upload.browse}
            </span>
          </>
        )}
      </label>
      {state.kind === 'error' && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
