import { NextResponse } from 'next/server';

import { recordAudit } from '../../../lib/admin/audit';
import { isChairmanOperator, normalizeOperatorEmail } from '../../../lib/security/admin';
import { createAuthClient } from '../../../lib/security/operator-session';

/**
 * Where the magic link lands. The domain is checked again here: the link was
 * mailed to an operator, but a session created through any other route must
 * still not become an operator session.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/admin/login?error=link', url.origin));

  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL('/admin/login?error=link', url.origin));
  }

  const email = normalizeOperatorEmail(data.user.email);
  if (!isChairmanOperator(email)) {
    // The session exists at this point, so it has to be torn down rather than
    // merely refused.
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/admin/login?error=forbidden', url.origin));
  }

  await recordAudit({ action: 'ADMIN_LOGIN', actorId: data.user.id, actorEmail: email });

  return NextResponse.redirect(new URL('/admin', url.origin));
}
