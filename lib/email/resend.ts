import { Resend } from 'resend';

import { RAFFLE_EMAIL_SENDER, renderRaffleEmail, type RaffleEmailKind } from './templates';
import type { RaffleMailer } from '../raffle/service';

/**
 * The Resend SDK exposes no request timeout, so the call is raced against one.
 * A stalled provider must not hold a serverless invocation open while a visitor
 * waits at a venue. The underlying request may still complete after the race is
 * lost; the outbox treats that as a retryable failure, which can produce a
 * duplicate message but never a lost one.
 */
const SEND_TIMEOUT_MS = 10_000;

export function raffleEmailLink(
  appUrl: string,
  eventSlug: string,
  segment: 'verify' | 'number',
  token: string,
): string {
  return `${appUrl.replace(/\/+$/, '')}/${eventSlug}/${segment}/${encodeURIComponent(token)}`;
}

export class ResendRaffleMailer implements RaffleMailer {
  private readonly client: Resend | null;

  constructor(
    apiKey = process.env.RESEND_API_KEY,
    private readonly from = process.env.RAFFLE_EMAIL_FROM || RAFFLE_EMAIL_SENDER,
    private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '',
  ) {
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  async sendVerification(input: {
    eventSlug: string;
    email: string;
    token: string;
  }): Promise<{ id?: string }> {
    const message = await renderRaffleEmail({
      kind: 'VERIFICATION',
      verificationUrl: raffleEmailLink(this.appUrl, input.eventSlug, 'verify', input.token),
    });
    return this.send(input.email, message, 'verification');
  }

  async sendReceipt(input: {
    eventSlug: string;
    email: string;
    number: bigint;
    receiptToken: string;
  }): Promise<{ id?: string }> {
    const message = await renderRaffleEmail({
      kind: 'RECEIPT',
      number: input.number,
      receiptUrl: raffleEmailLink(this.appUrl, input.eventSlug, 'number', input.receiptToken),
    });
    return this.send(input.email, message, 'receipt');
  }

  private async send(
    to: string,
    message: { subject: string; html: string; text: string },
    tag: Lowercase<RaffleEmailKind>,
  ): Promise<{ id?: string }> {
    if (!this.client) throw new Error('RESEND_API_KEY is not configured');

    const { data, error } = await withTimeout(
      this.client.emails.send({
        from: this.from,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'kind', value: tag }],
      }),
      SEND_TIMEOUT_MS,
    );
    if (error) throw new Error(error.message);
    return { id: data?.id };
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Mail provider did not respond in ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
