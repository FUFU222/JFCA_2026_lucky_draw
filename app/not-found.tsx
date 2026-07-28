/** Shown for an unknown event, and for a receipt link that matches nothing. */
export default function NotFound() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pt-16">
      <h1 className="text-2xl font-bold text-neutral-900">Not found / ページが見つかりません</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
        Check the address on the QR code or in your email. For help, contact{' '}
        <a href="mailto:info@chairman.jp" className="font-medium underline underline-offset-2">
          info@chairman.jp
        </a>
        .
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
        QRコードまたはメールのアドレスをご確認ください。
      </p>
    </main>
  );
}
