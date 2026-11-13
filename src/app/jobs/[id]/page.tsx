'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Brand } from '@/components/brand';
import { ReviewScreen } from '@/components/review-screen';
import { useJob } from '@/lib/client/use-job';
import { t } from '@/lib/i18n/en';
import type { EditOp } from '@/lib/jobs/edit';

function Notice({ text }: { text: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 py-3 sm:px-8">
        <Brand />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
        <p className="max-w-md font-serif text-2xl text-balance">{text}</p>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.review.back}
        </Link>
      </main>
    </div>
  );
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { job, state, edit } = useJob(id);

  useEffect(() => {
    if (job) document.title = `${job.name} · ${t.appName}`;
  }, [job]);

  const onEdit = useCallback(
    (op: EditOp) => {
      void edit(op).then((error) => {
        if (error) toast.error(error === 'error' ? t.review.editFailed : error);
      });
    },
    [edit],
  );

  const onDelete = useCallback(async () => {
    if (!window.confirm(t.review.deleteConfirm)) return;
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined);
    router.push('/');
  }, [id, router]);

  const onDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = `/api/jobs/${id}/export`;
    link.download = '';
    link.click();
  }, [id]);

  const thumbSrc = useCallback(
    (fileId: string, page: number, width: number) => `/api/jobs/${id}/files/${fileId}/pages/${page}?w=${width}`,
    [id],
  );

  if (state === 'gone') return <Notice text={t.review.gone} />;
  if (state === 'failed') return <Notice text={t.review.loadFailed} />;
  if (!job) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status" aria-label={t.review.reading}>
        <Loader2 className="size-6 animate-spin text-brass" />
      </div>
    );
  }

  return <ReviewScreen job={job} onEdit={onEdit} onDelete={onDelete} onDownload={onDownload} thumbSrc={thumbSrc} />;
}
