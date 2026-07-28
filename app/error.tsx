'use client';

/**
 * The last thing a visitor sees when something unexpected fails. It stays
 * bilingual and gives them the one address that can actually help, because a
 * bare "Application error" at a festival booth is a dead end.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pt-16">
      <h1 className="text-2xl font-bold text-neutral-900">
        Something went wrong / エラーが発生しました
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
        Please try again. If it keeps happening, contact{' '}
        <a href="mailto:info@chairman.jp" className="font-medium underline underline-offset-2">
          info@chairman.jp
        </a>
        .
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
        もう一度お試しください。繰り返す場合は上記までご連絡ください。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 min-h-12 rounded-lg bg-neutral-900 px-6 text-base font-semibold text-white"
      >
        Try again / 再試行
      </button>
    </main>
  );
}
