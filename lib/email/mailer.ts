import { ResendRaffleMailer, raffleEmailLink } from './resend';
import { renderRaffleEmail } from './templates';
import type { RaffleMailer } from '../raffle/service';

export type MailDeliveryMode = 'send' | 'log';

export const DEFAULT_MAIL_DELIVERY_MODE: MailDeliveryMode = 'send';

export function parseMailDeliveryMode(value: string | undefined): MailDeliveryMode {
  if (!value) return DEFAULT_MAIL_DELIVERY_MODE;
  if (value === 'send' || value === 'log') return value;
  throw new Error(`MAIL_DELIVERY_MODE must be "send" or "log", received "${value}"`);
}

export interface LoggedRaffleEmail {
  kind: 'VERIFICATION' | 'RECEIPT';
  to: string;
  subject: string;
  url: string;
}

/**
 * Renders the real template and records a successful delivery without calling a
 * provider. Staging and load tests use this so a run against 30k addresses
 * cannot send a single real message.
 */
/** A load test can drive this for hours; the recent-message buffer is bounded. */
const LOG_HISTORY_LIMIT = 100;

export class LoggingRaffleMailer implements RaffleMailer {
  readonly sent: LoggedRaffleEmail[] = [];
  private count = 0;

  constructor(
    private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '',
    private readonly log: (message: LoggedRaffleEmail) => void = (message) =>
      console.info('[mail:log] %s -> %s (%s)', message.kind, message.to, message.subject),
  ) {}

  /** Total messages this mailer has accepted, including ones no longer buffered. */
  get deliveredCount(): number {
    return this.count;
  }

  async sendVerification(input: {
    eventSlug: string;
    email: string;
    token: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }> {
    const url = raffleEmailLink(this.appUrl, input.eventSlug, 'verify', input.token);
    const { subject } = await renderRaffleEmail({
      kind: 'VERIFICATION',
      locale: input.locale,
      verificationUrl: url,
    });
    return this.record({ kind: 'VERIFICATION', to: input.email, subject, url });
  }

  async sendReceipt(input: {
    eventSlug: string;
    email: string;
    number: bigint;
    receiptToken: string;
    locale: 'en' | 'ja';
  }): Promise<{ id?: string }> {
    const url = raffleEmailLink(this.appUrl, input.eventSlug, 'number', input.receiptToken);
    const { subject } = await renderRaffleEmail({
      kind: 'RECEIPT',
      locale: input.locale,
      number: input.number,
      receiptUrl: url,
    });
    return this.record({ kind: 'RECEIPT', to: input.email, subject, url });
  }

  private record(message: LoggedRaffleEmail): { id: string } {
    this.count += 1;
    this.sent.push(message);
    if (this.sent.length > LOG_HISTORY_LIMIT) this.sent.shift();
    this.log(message);
    return { id: `log-${this.count}` };
  }
}

export function createRaffleMailer(
  mode: MailDeliveryMode = parseMailDeliveryMode(process.env.MAIL_DELIVERY_MODE),
  isProduction = process.env.NODE_ENV === 'production',
): RaffleMailer {
  // Log mode silently swallows every message. In production that would look
  // exactly like a working service while nobody receives their number.
  if (mode === 'log' && isProduction) {
    throw new Error('MAIL_DELIVERY_MODE=log is refused in production');
  }
  return mode === 'log' ? new LoggingRaffleMailer() : new ResendRaffleMailer();
}
