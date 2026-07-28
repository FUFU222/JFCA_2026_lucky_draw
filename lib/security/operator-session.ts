import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isChairmanOperator, normalizeOperatorEmail } from './admin';

export interface OperatorSession {
  userId: string;
  email: string;
}

/**
 * The auth cookies are the visitor's, so this client runs as the signed-in user
 * and never with the service role. It only ever answers "who is this".
 */
export async function createAuthClient() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase public configuration is missing');

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          try {
            store.set(name, value, options);
          } catch {
            // Reading a session inside a Server Component cannot set cookies;
            // the callback route and the middleware-free login flow do that.
          }
        }
      },
    },
  });
}

/**
 * Three things must all hold, because the email domain on its own is not a
 * credential.
 *
 * Supabase Auth will issue a session to anyone who calls `signUp` with the
 * public anon key, for any address they type — including one at the operator
 * domain. Requiring email confirmation in the project settings closes that,
 * but a project setting is not something this code can see, so the last check
 * does not depend on it: the session must belong to a user who has completed
 * the emailed sign-in link through `/auth/callback`, which is the only place
 * an `ADMIN_LOGIN` record is written. A self-registered account has none.
 */
export async function getOperatorSession(): Promise<OperatorSession | null> {
  const { data, error } = await (await createAuthClient()).auth.getUser();
  if (error || !data.user) return null;

  const email = normalizeOperatorEmail(data.user.email);
  if (!isChairmanOperator(email)) return null;
  if (!data.user.email_confirmed_at) return null;
  if (!(await hasCompletedMagicLinkSignIn(data.user.id))) return null;

  return { userId: data.user.id, email };
}

async function hasCompletedMagicLinkSignIn(userId: string): Promise<boolean> {
  const { createServiceRoleClient } = await import('../db/server');
  const { data, error } = await createServiceRoleClient()
    .from('admin_audit_logs')
    .select('id')
    .eq('admin_user_id', userId)
    .eq('action', 'ADMIN_LOGIN')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/** For pages: sends anyone who is not an operator to the login screen. */
export async function requireOperatorSession(): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect('/admin/login');
  return session;
}
