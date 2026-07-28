import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ getOperatorSession: vi.fn() }));
const queries = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  exportEntryPages: vi.fn(),
  countEntriesForExport: vi.fn(),
  setCampaignStatus: vi.fn(),
}));

/** The route consumes pages, so the double has to be an async generator. */
function pagesOf(...pages: unknown[][]) {
  return async function* () {
    for (const page of pages) yield page;
  };
}
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('../../lib/security/operator-session', () => ({
  getOperatorSession: session.getOperatorSession,
  createAuthClient: async () => ({ auth: {} }),
}));
vi.mock('../../lib/admin/queries', () => queries);
vi.mock('../../lib/admin/audit', () => audit);

import { GET as exportCsv } from '../../app/admin/entries/export/route';

const OPERATOR = { userId: 'user-1', email: 'a.tanaka@chairman.jp' };

function exportRequest(eventSlug = 'jfca-2026') {
  return new Request(`https://example.test/admin/entries/export?event=${eventSlug}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  session.getOperatorSession.mockResolvedValue(OPERATOR);
  queries.loadDashboard.mockResolvedValue({ campaign: { id: 'campaign-1', status: 'SCHEDULED' } });
  queries.countEntriesForExport.mockResolvedValue(0);
  queries.exportEntryPages.mockImplementation(pagesOf());
});

describe('CSV export', () => {
  it('returns a downloadable UTF-8 file with the entry columns', async () => {
    queries.countEntriesForExport.mockResolvedValue(1);
    queries.exportEntryPages.mockImplementation(
      pagesOf([
      {
        number: 10_000,
        email: 'person@example.com',
        state: 'VERIFIED',
        verified_at: '2026-07-28T01:00:00.000Z',
        locale: 'en',
        terms_version: 'v1',
        terms_consented_at: '2026-07-28T00:59:00.000Z',
        first_name: '田中',
        last_name: '章',
        phone: null,
        gender: null,
        date_of_birth: null,
        country: 'CA',
        region: 'Ontario',
        created_at: '2026-07-28T00:59:00.000Z',
      },
      ]),
    );

    const response = await exportCsv(exportRequest());
    // Read the bytes, not the text: decoding UTF-8 strips a leading BOM by
    // specification, so `.text()` cannot see the thing Excel needs.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="jfca-2026-entries.csv"',
    );
    // A cached export of personal data on a shared machine is a leak.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toContain('person@example.com');
    expect(body).toContain('田中');
  });

  it('records who exported how much, and never the exported rows', async () => {
    queries.countEntriesForExport.mockResolvedValue(2);
    queries.exportEntryPages.mockImplementation(
      pagesOf([
        { number: 10_000, email: 'person@example.com' },
        { number: 10_001, email: 'other@example.com' },
      ]),
    );

    await exportCsv(exportRequest());

    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    const [entry] = audit.recordAudit.mock.calls[0];
    expect(entry).toEqual({
      action: 'EXPORT_CSV',
      actorId: 'user-1',
      actorEmail: 'a.tanaka@chairman.jp',
      campaignId: 'campaign-1',
      metadata: { event_slug: 'jfca-2026', row_count: 2 },
    });
    expect(JSON.stringify(entry)).not.toContain('person@example.com');
  });

  it('exports a header and no rows for an event with no entries', async () => {
    const body = await (await exportCsv(exportRequest())).text();

    expect(body.trim().split('\r\n')).toHaveLength(1);
  });

  it('answers 404 for an event that does not exist, without auditing an export', async () => {
    queries.loadDashboard.mockResolvedValue(null);

    const response = await exportCsv(exportRequest('no-such-event'));

    expect(response.status).toBe(404);
    expect(queries.exportEntryPages).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
