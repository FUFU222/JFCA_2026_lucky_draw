'use client';

import { useState } from 'react';

import { ConfirmationDialog } from '../ui/confirmation-dialog';

/**
 * Export is behind a dialog because it produces a file of entrants' personal
 * data. The dialog says what leaves the system before it leaves.
 */
export function ExportButton({ eventSlug, entryCount }: { eventSlug: string; entryCount: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  function download() {
    setDialogOpen(false);
    window.location.href = `/admin/entries/export?event=${encodeURIComponent(eventSlug)}`;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="min-h-12 rounded-lg border border-neutral-300 px-5 text-base font-semibold text-neutral-900"
      >
        CSVをエクスポート
      </button>

      <ConfirmationDialog
        open={dialogOpen}
        title="応募者データをエクスポートしますか？"
        confirmLabel="CSVをダウンロード"
        cancelLabel="キャンセル"
        onCancel={() => setDialogOpen(false)}
        onConfirm={download}
      >
        <p>メールアドレスやプロフィール情報を含む{entryCount}件のデータをダウンロードします。</p>
        <p>エクスポートはあなたのアカウントに記録されます。</p>
      </ConfirmationDialog>
    </>
  );
}
