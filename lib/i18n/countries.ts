import type { Locale } from './messages';

export const DEFAULT_COUNTRY = 'CA';

/**
 * ISO 3166-1 alpha-2 codes. The code is what gets stored, so an entry means the
 * same thing whichever language it was submitted in, and the visible name is
 * produced by the platform in the visitor's own language.
 */
export const COUNTRY_CODES: readonly string[] = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AR','AT','AU','AW','AZ','BA','BB','BD','BE','BF','BG',
  'BH','BI','BJ','BM','BN','BO','BR','BS','BT','BW','BY','BZ','CA','CD','CF','CG','CH','CI','CK',
  'CL','CM','CN','CO','CR','CU','CV','CW','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG',
  'ER','ES','ET','FI','FJ','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN',
  'GP','GQ','GR','GT','GU','GW','GY','HK','HN','HR','HT','HU','ID','IE','IL','IM','IN','IQ','IR',
  'IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB',
  'LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MG','MH','MK','ML','MM','MN',
  'MO','MQ','MR','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NG','NI','NL','NO','NP','NR',
  'NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PR','PS','PT','PW','PY','QA','RE','RO','RS',
  'RU','RW','SA','SB','SC','SD','SE','SG','SI','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX',
  'SY','SZ','TC','TD','TG','TH','TJ','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US',
  'UY','UZ','VA','VC','VE','VG','VI','VN','VU','WS','XK','YE','ZA','ZM','ZW',
];

export interface CountryOption {
  code: string;
  name: string;
}

/**
 * Names come from the platform's own locale data, so nothing here has to hold a
 * hand-maintained translation of two hundred country names.
 */
export function countryOptions(locale: Locale): CountryOption[] {
  const display = new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' });
  const collator = new Intl.Collator(locale);

  return COUNTRY_CODES.map((code) => ({ code, name: display.of(code) ?? code })).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
}

export function countryName(code: string | null | undefined, locale: Locale): string | null {
  if (!code) return null;
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code;
}
