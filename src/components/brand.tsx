import Link from 'next/link';
import { t } from '@/lib/i18n/en';

/** Five staff lines with a cut through them. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {[8, 12, 16, 20, 24].map((y) => (
          <g key={y}>
            <line x1="3" y1={y} x2="13" y2={y} />
            <line x1="19" y1={y} x2="29" y2={y} />
          </g>
        ))}
      </g>
      <line x1="16" y1="4" x2="16" y2="28" stroke="var(--brass)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2.5 3" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Mark className="size-7 text-foreground" />
      <span className="font-serif text-[1.05rem] font-medium tracking-tight">{t.appName}</span>
    </Link>
  );
}
