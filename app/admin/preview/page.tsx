import { AdminShell } from '../../../components/admin/admin-shell';
import { DesignPreview } from '../../../components/admin/design-preview';
import { requireOperatorSession } from '../../../lib/security/operator-session';

export const dynamic = 'force-dynamic';

export default async function AdminPreviewPage() {
  const operator = await requireOperatorSession();

  return (
    <AdminShell operatorEmail={operator.email} title="デザインプレビュー">
      <p className="mb-6 text-[15px] leading-relaxed text-neutral-600">
        実際の応募を作らずに、番号発行画面の見た目とアニメーションを確認できます。応募データは一切作成・送信されません。
      </p>
      <DesignPreview />
    </AdminShell>
  );
}
