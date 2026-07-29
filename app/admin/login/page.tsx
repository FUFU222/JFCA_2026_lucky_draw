import { redirect } from 'next/navigation';

import { LoginForm } from '../../../components/admin/login-form';
import { OPERATOR_DOMAIN } from '../../../lib/security/admin';
import { getOperatorSession } from '../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  link: 'このサインインリンクは使用できませんでした。もう一度リクエストしてください。',
  forbidden: `${OPERATOR_DOMAIN} のアドレスのみサインインできます。`,
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getOperatorSession()) redirect('/admin');
  const { error } = await searchParams;

  return (
    <main lang="ja" className="mx-auto min-h-dvh w-full max-w-md px-5 py-16">
      <h1 className="text-2xl font-bold text-neutral-900">Lucky Draw 管理画面</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">
        {OPERATOR_DOMAIN} のメールアドレスでサインインしてください。サインインリンクをメールでお送りします。
      </p>

      {error && ERRORS[error] && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-[#c8102e]">
          {ERRORS[error]}
        </p>
      )}

      <div className="mt-8">
        <LoginForm />
      </div>
    </main>
  );
}
