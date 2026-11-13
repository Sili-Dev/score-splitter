'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { t } from '@/lib/i18n/en';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={t.theme.toggle}
      aria-label={t.theme.toggle}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Both icons are rendered so the server and the browser agree before the theme is known. */}
      <Sun className="hidden size-[1.05rem] dark:block" />
      <Moon className="size-[1.05rem] dark:hidden" />
    </button>
  );
}
