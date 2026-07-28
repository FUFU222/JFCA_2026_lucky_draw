'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useState } from 'react';

import { OPERATOR_DOMAIN, isChairmanOperator } from '../../lib/security/admin';

type Status = 'idle' | 'sending' | 'sent';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();

    // Checked before the link is requested as well as after the callback, so a
    // non-operator address never even causes Supabase to send mail.
    if (!isChairmanOperator(email)) {
      setError(`Use your ${OPERATOR_DOMAIN} address.`);
      return;
    }

    setError(null);
    setStatus('sending');
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
      setStatus('sent');
    } catch {
      setError('The link could not be sent. Try again in a moment.');
      setStatus('idle');
    }
  }

  if (status === 'sent') {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-neutral-900">Check your email</h2>
        <p className="text-[15px] leading-relaxed text-neutral-700">
          A sign-in link is on its way to {email.trim().toLowerCase()}.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={requestLink} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="operator-email" className="block text-sm font-medium text-neutral-800">
          Operator email address
        </label>
        <input
          id="operator-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-base"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c8102e]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="min-h-12 w-full rounded-lg bg-neutral-900 px-5 text-base font-semibold text-white disabled:opacity-50"
      >
        {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}
