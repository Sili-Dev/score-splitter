import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { UploadDropzone } from '@/components/upload-dropzone';
import { getConfig } from '@/lib/config';
import { t } from '@/lib/i18n/en';

// The deletion notice shows the configured lifetime, which is only known when the server runs.
export const dynamic = 'force-dynamic';

export default function Home() {
  const hours = Math.round(getConfig().jobTtlMs / 3600_000);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-3 sm:px-8">
        <Brand />
        <span className="ml-auto" />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-4 py-10 sm:px-8">
        <div className="flex flex-col gap-4 text-center">
          <h1 className="font-serif text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-[3.4rem]">
            {t.upload.heading}
          </h1>
          <p className="mx-auto max-w-xl text-lg text-pretty text-muted-foreground">{t.upload.lead}</p>
        </div>

        <UploadDropzone />

        <ol className="grid gap-6 sm:grid-cols-3">
          {t.upload.steps.map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-1.5 border-t pt-4">
              <span className="font-serif text-sm text-brass">{i + 1}</span>
              <span className="font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{text}</span>
            </li>
          ))}
        </ol>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-center text-sm text-muted-foreground sm:px-8">
        {t.upload.privacy(hours)}
      </footer>
    </div>
  );
}
