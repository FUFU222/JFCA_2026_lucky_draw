import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ getOperatorSession: vi.fn() }));
const queries = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  setCampaignStatus: vi.fn(),
  exportEntries: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const authClient = vi.hoisted(() => ({
  auth: {
    exchangeCodeForSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock('../../lib/security/operator-session', () => ({
  getOperatorSession: session.getOperatorSession,
  createAuthClient: async () => authClient,
}));
vi.mock('../../lib/admin/queries', () => queries);
vi.mock('../../lib/admin/audit', () => audit);

import { GET as authCallback } from '../../app/auth/callback/route';
import { POST as campaignAction } from '../../app/admin/campaign/route';
import { GET as exportCsv } from '../../app/admin/entries/export/route';

const OPERATOR = { userId: 'user-1', email: 'a.tanaka@chairman.jp' };
const CAMPAIGN = { campaign: { id: 'campaign-1', status: 'SCHEDULED' }, verified: 0, pending: 0 };

function callbackRequest(code: string | null) {
  const url = code
    ? `https://example.test/auth/callback?code=${code}`
    : 'https://example.test/auth/callback';
  return new Request(url);
}

function campaignRequest(body: unknown) {
  return new Request('https://example.test/admin/campaign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authClient.auth.signOut.mockResolvedValue({ error: null });
});

describe('magic link callback', () => {
  it('signs an operator in and records the login', async () => {
    authClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'A.Tanaka@Chairman.jp' } },
      error: null,
    });

    const response = await authCallback(callbackRequest('valid-code'));

    expect(response.headers.get('location')).toBe('https://example.test/admin');
    expect(audit.recordAudit).toHaveBeenCalledWith({
      action: 'ADMIN_LOGIN',
      actorId: 'user-1',
      actorEmail: 'a.tanaka@chairman.jp',
    });
  });

  it('tears down a session belonging to any other domain', async () => {
    authClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-2', email: 'person@example.com' } },
      error: null,
    });

    const response = await authCallback(callbackRequest('valid-code'));

    // The session exists by this point, so refusing is not enough.
    expect(authClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toBe(
      'https://example.test/admin/login?error=forbidden',
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('sends a missing or spent code back to the login screen', async () => {
    const noCode = await authCallback(callbackRequest(null));
    expect(noCode.headers.get('location')).toBe('https://example.test/admin/login?error=link');

    authClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    });
    const spent = await authCallback(callbackRequest('spent-code'));
    expect(spent.headers.get('location')).toBe('https://example.test/admin/login?error=link');
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});

describe('operator-only endpoints', () => {
  it('refuses the export to anyone without an operator session', async () => {
    session.getOperatorSession.mockResolvedValue(null);

    const response = await exportCsv(new Request('https://example.test/admin/entries/export'));

    expect(response.status).toBe(401);
    expect(queries.exportEntries).not.toHaveBeenCalled();
  });

  it('refuses pause and resume to anyone without an operator session', async () => {
    session.getOperatorSession.mockResolvedValue(null);

    const response = await campaignAction(campaignRequest({ action: 'PAUSE' }));

    expect(response.status).toBe(401);
    expect(queries.setCampaignStatus).not.toHaveBeenCalled();
  });
});

describe('pause and resume', () => {
  beforeEach(() => {
    session.getOperatorSession.mockResolvedValue(OPERATOR);
    queries.loadDashboard.mockResolvedValue(CAMPAIGN);
  });

  it('pauses and records who did it', async () => {
    const response = await campaignAction(campaignRequest({ action: 'PAUSE' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'PAUSED' });
    expect(queries.setCampaignStatus).toHaveBeenCalledWith('campaign-1', 'PAUSED');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAUSE_REGISTRATION',
        actorEmail: 'a.tanaka@chairman.jp',
        campaignId: 'campaign-1',
      }),
    );
  });

  it('resumes back to the scheduled state', async () => {
    queries.loadDashboard.mockResolvedValue({ campaign: { id: 'campaign-1', status: 'PAUSED' } });

    const response = await campaignAction(campaignRequest({ action: 'RESUME' }));

    expect(await response.json()).toEqual({ ok: true, status: 'SCHEDULED' });
    expect(queries.setCampaignStatus).toHaveBeenCalledWith('campaign-1', 'SCHEDULED');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESUME_REGISTRATION' }),
    );
  });

  it('accepts nothing but pause and resume', async () => {
    for (const action of ['DELETE', 'REISSUE_NUMBER', '', null, 42]) {
      const response = await campaignAction(campaignRequest({ action }));

      expect(response.status, String(action)).toBe(400);
    }
    expect(queries.setCampaignStatus).not.toHaveBeenCalled();
  });
});
