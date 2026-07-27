insert into public.campaigns (
  slug,
  title,
  opens_at,
  draw_starts_at,
  status,
  next_number,
  terms_version
)
values (
  'jfca-2026',
  'Japan Festival Canada 2026',
  null,
  null,
  'DRAFT',
  10000,
  'jfca-2026-terms-v1-placeholder'
)
on conflict (slug) do update
set
  title = excluded.title,
  opens_at = null,
  draw_starts_at = null,
  status = 'DRAFT',
  next_number = 10000,
  terms_version = excluded.terms_version;
