import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  findReceipt,
  issuedReceiptToken,
  verificationLinkState,
} from '../../lib/db/public-queries';
import { SupabaseOutboxRepository, SupabaseRaffleRepository } from '../../lib/db/server';
import { EmailOutboxProcessor } from '../../lib/email/outbox';
import { SupabaseRateLimiter } from '../../lib/raffle/rate-limit';
import { RaffleService, type RaffleMailer } from '../../lib/raffle/service';

import {
  hasSupabaseCredentials,
  supabaseServiceRoleKey,
  supabaseUrl,
} from '../supabase-env';

const describeWithSupabase = hasSupabaseCredentials ? describe : describe.skip;

const VERIFICATION_SECRET = 'repository-test-verification-secret';
const RECEIPT_SECRET = 'repository-test-receipt-secret';

class FakeMailer implements RaffleMailer {
  readonly verification: Array<{ eventSlug: string; email: string; token: string }> = [];
  readonly receipts: Array<{ email: string; number: bigint; receiptToken: string }> = [];
  receiptFailure: Error | null = null;
  verificationFailure: Error | null = null;

  async sendVerification(input: { eventSlug: string; email: string; token: string }) {
    if (this.verificationFailure) throw this.verificationFailure;
    this.verification.push(input);
    return { id: `verification-${this.verification.length}` };
  }

  async sendReceipt(input: { email: string; number: bigint; receiptToken: string }) {
    if (this.receiptFailure) throw this.receiptFailure;
    this.receipts.push(input);
    return { id: `receipt-${this.receipts.length}` };
  }
}

function buildOutboxProcessor(mailer: FakeMailer) {
  return new EmailOutboxProcessor({
    repository: new SupabaseOutboxRepository(supabase),
    mailer,
    verificationTokenSecret: VERIFICATION_SECRET,
    receiptTokenSecret: RECEIPT_SECRET,
    onError: () => {},
  });
}

/**
 * The worker deliberately drains the whole queue rather than one campaign's,
 * so a job left behind by anything else — most often by a developer walking
 * the app locally before running the suite — is claimed by these tests and
 * makes them fail with counts nobody can explain. Clearing what is already
 * waiting states the precondition instead of assuming a pristine database.
 */
async function clearOutboxOutsideThisTest() {
  const { data: mine } = await supabase
    .from('raffle_entries')
    .select('id')
    .in('campaign_id', createdCampaignIds);
  const keep = (mine ?? []).map((entry) => entry.id);
  const query = supabase.from('email_outbox').delete();
  await (keep.length > 0 ? query.not('entry_id', 'in', `(${keep.join(',')})`) : query.gte('attempt_count', 0));
}

let supabase: SupabaseClient;
const createdCampaignIds: string[] = [];

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createOpenCampaign() {
  const slug = `repo-test-${uniqueSuffix()}`;
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      slug,
      title: 'Repository test',
      status: 'SCHEDULED',
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      draw_starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      terms_version: 'repo-test-v1',
    })
    .select('id, slug')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Campaign was not created');
  createdCampaignIds.push(data.id);
  return data as { id: string; slug: string };
}

function buildService(mailer: FakeMailer, verifyOperatorSession?: () => Promise<boolean>) {
  return new RaffleService({
    repository: new SupabaseRaffleRepository(supabase),
    mailer,
    turnstile: { verify: async () => true },
    rateLimiter: new SupabaseRateLimiter(supabase),
    verificationTokenSecret: VERIFICATION_SECRET,
    receiptTokenSecret: RECEIPT_SECRET,
    verifyOperatorSession,
  });
}

/**
 * Exercises the real Supabase adapter and its RPCs. The service suite proves
 * the decisions; this proves the SQL those decisions rely on actually exists
 * and behaves as the adapter assumes.
 */
describeWithSupabase('SupabaseRaffleRepository', () => {
  beforeAll(() => {
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  });

  afterEach(async () => {
    const campaignIds = createdCampaignIds.splice(0, createdCampaignIds.length);
    if (campaignIds.length === 0) return;

    const { data: entries } = await supabase
      .from('raffle_entries')
      .select('id')
      .in('campaign_id', campaignIds);
    const entryIds = (entries ?? []).map((entry) => entry.id);

    if (entryIds.length > 0) {
      await supabase.from('email_deliveries').delete().in('entry_id', entryIds);
      await supabase.from('email_outbox').delete().in('entry_id', entryIds);
      await supabase.from('verification_tokens').delete().in('entry_id', entryIds);
    }
    await supabase.from('raffle_entries').delete().in('campaign_id', campaignIds);
    await supabase.from('campaigns').delete().in('id', campaignIds);
  });

  it('carries a submission through to an issued number and a sent receipt', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    const email = `flow-${uniqueSuffix()}@example.com`;

    await expect(
      service.requestVerification({
        eventSlug: campaign.slug,
        email: email.toUpperCase(),
        termsConsent: true,
        turnstileToken: 'captcha',
        ipAddress: '203.0.113.10',
        firstName: 'Ada',
        country: 'Canada',
        region: 'Ontario',
      }),
    ).resolves.toEqual({ accepted: true });

    expect(mailer.verification).toHaveLength(1);
    const { data: entry } = await supabase
      .from('raffle_entries')
      .select('email, state, locale, first_name, region')
      .eq('campaign_id', campaign.id)
      .single();
    expect(entry).toMatchObject({
      email,
      state: 'PENDING',
      locale: 'en',
      first_name: 'Ada',
      region: 'Ontario',
    });

    const confirmed = await service.confirmVerification({
      eventSlug: campaign.slug,
      token: mailer.verification[0].token,
    });

    expect(confirmed?.number).toBe(BigInt(10_000));
    expect(mailer.receipts).toHaveLength(1);
    expect(mailer.receipts[0].receiptToken).toBe(confirmed?.receiptToken);

    const { data: verified } = await supabase
      .from('raffle_entries')
      .select('state, number, receipt_token_hash')
      .eq('campaign_id', campaign.id)
      .single();
    expect(verified).toMatchObject({ state: 'VERIFIED', number: 10_000 });
    expect(verified?.receipt_token_hash).not.toBe(confirmed?.receiptToken);

    const { data: outbox } = await supabase
      .from('email_outbox')
      .select('status')
      .eq('entry_id', (await entryId(campaign.id)) ?? '');
    expect(outbox).toEqual([{ status: 'SENT' }]);
  });

  it('resets a verified test entry so the same address can rehearse the whole journey again', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer, async () => true);
    const email = `rehearsal-${uniqueSuffix()}@example.com`;
    const request = {
      eventSlug: campaign.slug,
      email,
      termsConsent: true as const,
      turnstileToken: '',
      isTest: true,
    };

    await expect(service.requestVerification(request)).resolves.toEqual({ accepted: true });
    const firstConfirmation = await service.confirmVerification({
      eventSlug: campaign.slug,
      token: mailer.verification[0].token,
    });
    expect(firstConfirmation?.number).toBe(BigInt(900_000_001));

    // The operator rehearses again with the same address, exactly as they
    // would by resubmitting the public form a second time.
    await expect(service.requestVerification(request)).resolves.toEqual({ accepted: true });
    const { data: reset } = await supabase
      .from('raffle_entries')
      .select('state, number, verified_at, receipt_token_hash, is_test')
      .eq('campaign_id', campaign.id)
      .single();
    expect(reset).toMatchObject({
      state: 'PENDING',
      number: null,
      verified_at: null,
      receipt_token_hash: null,
      is_test: true,
    });
    expect(mailer.verification).toHaveLength(2);

    const secondConfirmation = await service.confirmVerification({
      eventSlug: campaign.slug,
      token: mailer.verification[1].token,
    });
    expect(secondConfirmation?.number).toBe(BigInt(900_000_002));
    // The number reaching the screen proves nothing about the mail: the receipt
    // job the first run marked as sent has to be released too, or the rehearsal
    // silently stops exercising the one email the operator most wants to see.
    expect(mailer.receipts).toHaveLength(2);
    expect(mailer.receipts[1].number).toBe(BigInt(900_000_002));
  });

  it('refuses a rehearsal on an address a real entry holds, and hands a rehearsal address back to a real visitor', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer, async () => true);
    const base = { eventSlug: campaign.slug, termsConsent: true as const, turnstileToken: 'captcha' };

    const realAddress = `real-${uniqueSuffix()}@example.com`;
    await service.requestVerification({ ...base, email: realAddress, firstName: 'RealVisitor' });
    await expect(
      service.requestVerification({ ...base, email: realAddress, turnstileToken: '', isTest: true }),
    ).resolves.toEqual({ accepted: false, reason: 'test_address_conflict' });

    const { data: untouched } = await supabase
      .from('raffle_entries')
      .select('is_test, first_name')
      .eq('campaign_id', campaign.id)
      .eq('email', realAddress)
      .single();
    expect(untouched).toMatchObject({ is_test: false, first_name: 'RealVisitor' });

    // The other direction: an address an operator rehearsed with must not lock
    // a real visitor out of it.
    const sharedAddress = `shared-${uniqueSuffix()}@example.com`;
    await service.requestVerification({
      ...base,
      email: sharedAddress,
      turnstileToken: '',
      isTest: true,
    });
    await service.requestVerification({ ...base, email: sharedAddress });

    const { data: reclaimed } = await supabase
      .from('raffle_entries')
      .select('is_test, state')
      .eq('campaign_id', campaign.id)
      .eq('email', sharedAddress)
      .single();
    expect(reclaimed).toMatchObject({ is_test: false, state: 'PENDING' });
  });

  it('matches an address exactly, so a wildcard character cannot reach another entry', async () => {
    const campaign = await createOpenCampaign();
    const repository = new SupabaseRaffleRepository(supabase);
    const suffix = uniqueSuffix();
    const stored = `a_b-${suffix}@example.com`;

    await repository.createPendingEntry({
      campaign_id: campaign.id,
      email: stored,
      locale: 'en',
      terms_version: 'repo-test-v1',
      terms_consented_at: new Date().toISOString(),
      is_test: false,
      marketing_consent: false,
      marketing_consent_at: null,
      first_name: null,
      last_name: null,
      phone: null,
      gender: null,
      date_of_birth: null,
      country: null,
      region: null,
    });

    await expect(repository.findEntryByEmail(campaign.id, stored)).resolves.toMatchObject({
      email: stored,
    });
    // `_` is a single-character wildcard in a pattern match but must be literal here.
    await expect(
      repository.findEntryByEmail(campaign.id, `axb-${suffix}@example.com`),
    ).resolves.toBeNull();
  });

  it('issues one number and one receipt for concurrent confirmations of the same link', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `concurrent-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    const token = mailer.verification[0].token;

    const results = await Promise.all([
      service.confirmVerification({ eventSlug: campaign.slug, token }),
      service.confirmVerification({ eventSlug: campaign.slug, token }),
    ]);

    expect(results.map((result) => result?.number)).toEqual([BigInt(10_000), BigInt(10_000)]);
    expect(mailer.receipts).toHaveLength(1);

    const { data: campaignAfter } = await supabase
      .from('campaigns')
      .select('next_number')
      .eq('id', campaign.id)
      .single();
    expect(campaignAfter?.next_number).toBe(10_001);
  });

  it('leaves a failed receipt retryable without invalidating the number', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `failed-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    mailer.receiptFailure = new Error('resend unavailable');

    const confirmed = await service.confirmVerification({
      eventSlug: campaign.slug,
      token: mailer.verification[0].token,
    });

    expect(confirmed?.number).toBe(BigInt(10_000));

    const entry = await entryId(campaign.id);
    const { data: job } = await supabase
      .from('email_outbox')
      .select('status, attempt_count, last_error, available_at')
      .eq('entry_id', entry ?? '')
      .single();
    expect(job).toMatchObject({
      status: 'FAILED',
      attempt_count: 1,
      last_error: 'resend unavailable',
    });
    expect(new Date(job?.available_at ?? '').getTime()).toBeGreaterThan(Date.now());

    const { data: deliveries } = await supabase
      .from('email_deliveries')
      .select('kind, provider_status, provider_error')
      .eq('entry_id', entry ?? '')
      .eq('kind', 'RECEIPT');
    expect(deliveries).toEqual([
      { kind: 'RECEIPT', provider_status: 'FAILED', provider_error: 'resend unavailable' },
    ]);
  });

  it('sends once per cooldown and never more than three times for one token', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    const email = `cooldown-${uniqueSuffix()}@example.com`;
    const request = {
      eventSlug: campaign.slug,
      email,
      termsConsent: true as const,
      turnstileToken: 'captcha',
    };

    await service.requestVerification(request);
    await service.requestVerification(request);

    // The second submission is inside the 2-minute cooldown, so it reuses the
    // token without sending again.
    expect(mailer.verification).toHaveLength(1);

    const entry = await entryId(campaign.id);
    const { data: tokens } = await supabase
      .from('verification_tokens')
      .select('id, send_count')
      .eq('entry_id', entry ?? '');
    expect(tokens).toHaveLength(1);
    expect(tokens?.[0].send_count).toBe(1);
  });

  it('rejects a link posted to another event without consuming it', async () => {
    const campaign = await createOpenCampaign();
    const other = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `slug-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    const token = mailer.verification[0].token;

    await expect(
      service.confirmVerification({ eventSlug: other.slug, token }),
    ).resolves.toBeNull();

    // The refusal must happen before anything is written, or the visitor is
    // told the link is broken while their number has already been issued.
    const entry = await entryId(campaign.id);
    const { data: after } = await supabase
      .from('raffle_entries')
      .select('state, number')
      .eq('id', entry ?? '')
      .single();
    expect(after).toMatchObject({ state: 'PENDING', number: null });
    const { data: campaignAfter } = await supabase
      .from('campaigns')
      .select('next_number')
      .eq('id', campaign.id)
      .single();
    expect(campaignAfter?.next_number).toBe(10_000);

    // The link still works for its own event afterwards.
    await expect(
      service.confirmVerification({ eventSlug: campaign.slug, token }),
    ).resolves.toMatchObject({ number: BigInt(10_000) });
  });

  it('refuses to issue a number once the draw has started', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `late-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });

    await supabase
      .from('campaigns')
      .update({ draw_starts_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('id', campaign.id);

    await expect(
      service.confirmVerification({
        eventSlug: campaign.slug,
        token: mailer.verification[0].token,
      }),
    ).resolves.toBeNull();
  });

  it('hands a used link back to the number it issued, instead of calling it unusable', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `reopen-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    const { token } = mailer.verification[0];

    const confirmed = await service.confirmVerification({ eventSlug: campaign.slug, token });
    expect(confirmed).toMatchObject({ number: BigInt(10_000) });

    // The link is spent, and that is exactly the person who must not be told
    // to start over: the number is theirs and this is the link that issued it.
    await expect(verificationLinkState(campaign.slug, token)).resolves.toBe('unusable');
    const receiptToken = await issuedReceiptToken(campaign.slug, token, RECEIPT_SECRET);
    expect(receiptToken).toBe(confirmed?.receiptToken);
    await expect(findReceipt(campaign.slug, receiptToken ?? '')).resolves.toMatchObject({
      number: BigInt(10_000),
    });

    // A link that never issued anything stays a dead end, and so does a
    // correct link read with the wrong secret.
    await expect(
      issuedReceiptToken(campaign.slug, 'z'.repeat(43), RECEIPT_SECRET),
    ).resolves.toBeNull();
    await expect(
      issuedReceiptToken(campaign.slug, token, 'a-different-receipt-secret'),
    ).resolves.toBeNull();

    // The event check is the one security-relevant guard on this path, and it
    // lives inside `findReceipt` rather than at the call site. Pinned here so
    // a refactor of that function cannot quietly turn this into a cross-event
    // read of somebody else's number.
    const otherCampaign = await createOpenCampaign();
    await expect(issuedReceiptToken(otherCampaign.slug, token, RECEIPT_SECRET)).resolves.toBeNull();
  });

  it('refuses to issue a number while the campaign is DRAFT, but still lets a rehearsal through', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer, async () => true);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `draft-real-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `draft-test-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
      isTest: true,
    });
    const [realLink, testLink] = mailer.verification;

    // The status somebody reaches for in the table editor to stop everything.
    // The visitor's page already reads "Entries are not open yet" for it, so a
    // number issued underneath that is a number nobody can account for.
    await supabase.from('campaigns').update({ status: 'DRAFT' }).eq('id', campaign.id);

    await expect(
      service.confirmVerification({ eventSlug: campaign.slug, token: realLink.token }),
    ).resolves.toBeNull();
    await expect(
      service.confirmVerification({ eventSlug: campaign.slug, token: testLink.token }),
    ).resolves.toMatchObject({ number: BigInt(900_000_001) });

    // `confirmVerification` collapses every RD001 to null, so a null on its own
    // would also be satisfied by a gate that raised *after* taking a number.
    // What the gate is for is the counter, so the counter is what is asserted.
    const { data: after } = await supabase
      .from('campaigns')
      .select('next_number')
      .eq('id', campaign.id)
      .single();
    expect(after?.next_number).toBe(10_000);
  });

  it('tells a link holder the event is over rather than that their link expired', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer, async () => true);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `over-real-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `over-test-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
      isTest: true,
    });
    const [realLink, testLink] = mailer.verification;

    await expect(verificationLinkState(campaign.slug, realLink.token)).resolves.toBe('usable');

    await supabase.from('campaigns').update({ status: 'CLOSED' }).eq('id', campaign.id);

    // Still a perfectly good link. What changed is the event, and that is what
    // the page has to say — "enter again to get a new link" walks the holder
    // into "Entries are closed" one tap later.
    await expect(verificationLinkState(campaign.slug, realLink.token)).resolves.toBe('event_over');
    // A rehearsal after closing is exactly what test mode is for.
    await expect(verificationLinkState(campaign.slug, testLink.token)).resolves.toBe('usable');

    // Expired as well as closed still reads as the event being over. Checking
    // expiry first would send this holder back to the entry form and into
    // "Entries are closed" one tap later — the wall this state removes.
    const { data: entries } = await supabase
      .from('raffle_entries')
      .select('id')
      .eq('campaign_id', campaign.id);
    await supabase
      .from('verification_tokens')
      .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
      .in('entry_id', (entries ?? []).map((e) => e.id));
    await expect(verificationLinkState(campaign.slug, realLink.token)).resolves.toBe('event_over');
  });

  it('answers a stale link from an earlier cycle as unusable, not as a server fault', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    const email = `stale-${uniqueSuffix()}@example.com`;
    const request = {
      eventSlug: campaign.slug,
      email,
      termsConsent: true as const,
      turnstileToken: 'captcha',
    };

    await service.requestVerification(request);
    const firstToken = mailer.verification[0].token;

    // Expire the first token and let a second submission issue a new link.
    const entry = await entryId(campaign.id);
    await supabase
      .from('verification_tokens')
      .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('entry_id', entry ?? '');
    await service.requestVerification(request);
    const secondToken = mailer.verification[1].token;
    expect(secondToken).not.toBe(firstToken);

    await expect(
      service.confirmVerification({ eventSlug: campaign.slug, token: secondToken }),
    ).resolves.toMatchObject({ number: BigInt(10_000) });

    // Clicking the older email must not raise a receipt-mismatch fault.
    await expect(
      service.confirmVerification({ eventSlug: campaign.slug, token: firstToken }),
    ).resolves.toBeNull();
  });

  it('lets one of two concurrent first submissions win without failing the other', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    const request = {
      eventSlug: campaign.slug,
      email: `race-${uniqueSuffix()}@example.com`,
      termsConsent: true as const,
      turnstileToken: 'captcha',
    };

    const results = await Promise.all([
      service.requestVerification(request),
      service.requestVerification(request),
    ]);

    expect(results).toEqual([{ accepted: true }, { accepted: true }]);

    const { data: entries } = await supabase
      .from('raffle_entries')
      .select('id')
      .eq('campaign_id', campaign.id);
    expect(entries).toHaveLength(1);
  });

  it('hands a verification email the provider refused to the retry worker', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    mailer.verificationFailure = new Error('provider unavailable');

    await expect(
      service.requestVerification({
        eventSlug: campaign.slug,
        email: `retry-${uniqueSuffix()}@example.com`,
        termsConsent: true,
        turnstileToken: 'captcha',
      }),
    ).resolves.toEqual({ accepted: true });

    const entry = await entryId(campaign.id);
    const { data: queued } = await supabase
      .from('email_outbox')
      .select('kind, status, last_error')
      .eq('entry_id', entry ?? '')
      .single();
    expect(queued).toMatchObject({
      kind: 'VERIFICATION',
      status: 'PENDING',
      last_error: 'provider unavailable',
    });

    // The allowance was spent on the message, so the visitor keeps their three
    // sends and the worker delivers the same link.
    const { data: token } = await supabase
      .from('verification_tokens')
      .select('send_count')
      .eq('entry_id', entry ?? '')
      .single();
    expect(token?.send_count).toBe(1);

    mailer.verificationFailure = null;
    await clearOutboxOutsideThisTest();
    const summary = await buildOutboxProcessor(mailer).process();

    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(mailer.verification).toHaveLength(1);

    const { data: after } = await supabase
      .from('email_outbox')
      .select('status, attempt_count, lease_expires_at')
      .eq('entry_id', entry ?? '')
      .single();
    expect(after).toMatchObject({ status: 'SENT', attempt_count: 1 });
    expect(after?.lease_expires_at).toBeNull();
  });

  it('delivers a receipt the inline send could not, on the next worker run', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `receipt-retry-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    mailer.receiptFailure = new Error('provider unavailable');

    const confirmed = await service.confirmVerification({
      eventSlug: campaign.slug,
      token: mailer.verification[0].token,
    });
    expect(confirmed?.number).toBe(BigInt(10_000));
    expect(mailer.receipts).toHaveLength(0);

    // A failed job is not immediately claimable; it becomes available after the
    // backoff the worker recorded.
    const entry = await entryId(campaign.id);
    await supabase
      .from('email_outbox')
      .update({ available_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('entry_id', entry ?? '');

    mailer.receiptFailure = null;
    await clearOutboxOutsideThisTest();
    const summary = await buildOutboxProcessor(mailer).process();

    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(mailer.receipts).toHaveLength(1);
    // The permanent link is rebuilt from the stored hash, not carried over.
    expect(mailer.receipts[0].receiptToken).toBe(confirmed?.receiptToken);
    expect(mailer.receipts[0].number).toBe(BigInt(10_000));

    const { data: after } = await supabase
      .from('email_outbox')
      .select('status, attempt_count')
      .eq('entry_id', entry ?? '')
      .single();
    expect(after).toMatchObject({ status: 'SENT', attempt_count: 2 });
  });

  it('does not re-arm a job another worker currently holds', async () => {
    const campaign = await createOpenCampaign();
    const mailer = new FakeMailer();
    const service = buildService(mailer);
    const repository = new SupabaseRaffleRepository(supabase);

    await service.requestVerification({
      eventSlug: campaign.slug,
      email: `armed-${uniqueSuffix()}@example.com`,
      termsConsent: true,
      turnstileToken: 'captcha',
    });
    const entry = await entryId(campaign.id);

    await repository.armOutboxJob(entry ?? '', 'VERIFICATION', 'first failure');
    await supabase
      .from('email_outbox')
      .update({
        status: 'PROCESSING',
        leased_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .eq('entry_id', entry ?? '');

    await repository.armOutboxJob(entry ?? '', 'VERIFICATION', 'second failure');

    const { data: job } = await supabase
      .from('email_outbox')
      .select('status, last_error')
      .eq('entry_id', entry ?? '')
      .single();
    expect(job).toMatchObject({ status: 'PROCESSING', last_error: 'first failure' });
  });

  it('reports an unknown link as unusable rather than as a server fault', async () => {
    const service = buildService(new FakeMailer());

    await expect(
      service.confirmVerification({ eventSlug: 'jfca-2026', token: 'z'.repeat(43) }),
    ).resolves.toBeNull();
  });
});

async function entryId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('raffle_entries')
    .select('id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
