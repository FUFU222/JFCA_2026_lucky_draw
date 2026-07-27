import { Resend } from 'resend';

import type { RaffleMailer } from '../raffle/service';

/** Minimal server-only adapter. Task 5 owns email rendering and scheduled outbox processing. */
export class ResendRaffleMailer implements RaffleMailer {
  private readonly client: Resend | null;

  constructor(
    apiKey = process.env.RESEND_API_KEY,
    private readonly from = process.env.RAFFLE_EMAIL_FROM ?? 'LIVAPON <info@chairman.jp>',
    private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '',
  ) {
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  async sendVerification(input: {
    eventSlug: string;
    email: string;
    token: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }> {
    const url = this.link(input.eventSlug, 'verify', input.token);
    return this.send({
      to: input.email,
      subject:
        input.locale === 'ja' ? 'メールアドレスを確認してください' : 'Verify your email address',
      text:
        input.locale === 'ja'
          ? `抽選番号を受け取るには、24時間以内に次のリンクでメールアドレスを確認してください: ${url}`
          : `Confirm your email within 24 hours to receive your Lucky Draw number: ${url}`,
      kind: 'verification',
    });
  }

  async sendReceipt(input: {
    eventSlug: string;
    email: string;
    number: bigint;
    receiptToken: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }> {
    const url = this.link(input.eventSlug, 'number', input.receiptToken);
    const number = `No. ${input.number.toString()}`;
    return this.send({
      to: input.email,
      subject: input.locale === 'ja' ? '抽選番号のお知らせ' : 'Your Lucky Draw number',
      text:
        input.locale === 'ja'
          ? `あなたの抽選番号は ${number} です。番号確認ページ: ${url}`
          : `Your Lucky Draw Number is ${number}. Your number page: ${url}`,
      kind: 'receipt',
    });
  }

  private link(eventSlug: string, segment: 'verify' | 'number', token: string): string {
    return `${this.appUrl}/${eventSlug}/${segment}/${token}`;
  }

  private async send(message: {
    to: string;
    subject: string;
    text: string;
    kind: 'verification' | 'receipt';
  }): Promise<{ id?: string }> {
    if (!this.client) throw new Error('RESEND_API_KEY is not configured');
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      tags: [{ name: 'kind', value: message.kind }],
    });
    if (error) throw new Error(error.message);
    return { id: data?.id };
  }
}
