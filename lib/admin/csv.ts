/** Excel needs this to read a UTF-8 file as UTF-8 rather than as the system codepage. */
export const UTF8_BOM = '﻿';

/**
 * Columns are the fields the service design lists as collected, in the order an
 * operator reads them: the number first, because that is what a support request
 * arrives with.
 */
export const ENTRY_COLUMNS = [
  'number',
  'email',
  'state',
  'verified_at',
  'locale',
  'terms_version',
  'terms_consented_at',
  'marketing_consent',
  'marketing_consent_at',
  'first_name',
  'last_name',
  'phone',
  'gender',
  'date_of_birth',
  'country',
  'region',
  'created_at',
] as const;

export type EntryColumn = (typeof ENTRY_COLUMNS)[number];
export type ExportableEntry = Partial<Record<EntryColumn, unknown>>;

const NEEDS_QUOTING = /[",\r\n]/;
/**
 * A leading `=`, `+`, `-` or `@` makes a spreadsheet treat the cell as a
 * formula. Entrants control their own names and addresses, so the export
 * prefixes those values rather than handing an operator something executable.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function field(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(field).join(',')];
  for (const row of rows) lines.push(row.map(field).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export function entriesToCsv(entries: readonly ExportableEntry[]): string {
  return toCsv(
    ENTRY_COLUMNS,
    entries.map((entry) => ENTRY_COLUMNS.map((column) => entry[column])),
  );
}

/** Header line, byte order mark included, for a streamed export. */
export function entryCsvHeader(): string {
  return `${UTF8_BOM}${ENTRY_COLUMNS.map(field).join(',')}\r\n`;
}

/** One record line, for a streamed export. */
export function entryCsvRow(entry: ExportableEntry): string {
  return `${ENTRY_COLUMNS.map((column) => field(entry[column])).join(',')}\r\n`;
}
