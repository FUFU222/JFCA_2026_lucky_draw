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
 * The domain is checked here as well as before the magic link is requested.
 * A link mailed to an operator could otherwise be replayed by anyone who
 * obtained a session another way.
 */
export async function getOperatorSession(): Promise<OperatorSession | null> {
  const { data, error } = await (await createAuthClient()).auth.getUser();
  if (error || !data.user) return null;

  const email = normalizeOperatorEmail(data.user.email);
  if (!isChairmanOperator(email)) return null;

  return { userId: data.user.id, email };
}

/** For pages: sends anyone who is not an operator to the login screen. */
export async function requireOperatorSession(): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect('/admin/login');
  return session;
}
