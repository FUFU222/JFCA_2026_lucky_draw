import Link from 'next/link';
import type { ReactNode } from 'react';

export function AdminShell({
  operatorEmail,
  title,
  children,
}: {
  operatorEmail: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main lang="ja" className="mx-auto min-h-dvh w-full max-w-4xl px-5 pb-16 pt-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Lucky Draw 管理画面
          </p>
          <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <nav className="flex gap-3">
            <Link href="/admin" className="font-medium text-neutral-700 underline-offset-2 hover:underline">
              概要
            </Link>
            <Link
              href="/admin/entries"
              className="font-medium text-neutral-700 underline-offset-2 hover:underline"
            >
              応募一覧
            </Link>
          </nav>
          <span className="text-neutral-500">{operatorEmail}</span>
        </div>
      </header>
      {children}
    </main>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
      <p className="text-sm text-neutral-600">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-neutral-900">{value}</p>
    </div>
  );
}
