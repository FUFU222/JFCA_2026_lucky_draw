import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import logo from '../../assets/LIVAPON_logo_horizontal_cropped.png';

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
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-1 bg-[var(--brand-accent)]" />
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-4">
          <Image src={logo} alt="LIVAPON" className="h-5 w-auto shrink-0" sizes="120px" />
          <div className="border-l border-neutral-200 pl-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Lucky Draw 管理画面
            </p>
            <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
          </div>
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
