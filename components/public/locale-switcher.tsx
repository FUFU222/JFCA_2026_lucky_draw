'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { rememberLocale } from '../../lib/i18n/locale';
import { LOCALES, messagesFor, type Locale } from '../../lib/i18n/messages';

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const t = messagesFor(locale).localeSwitcher;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    // The choice is remembered on the device so the server renders the right
    // language on the next first paint, with no flash of the other one.
    rememberLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t.label}>
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            disabled={pending}
            onClick={() => choose(option)}
            className={
              active
                ? 'min-h-9 rounded-full bg-neutral-900 px-3 text-sm font-semibold text-white'
                : 'min-h-9 rounded-full px-3 text-sm font-medium text-neutral-600'
            }
          >
            {t[option]}
          </button>
        );
      })}
    </div>
  );
}
