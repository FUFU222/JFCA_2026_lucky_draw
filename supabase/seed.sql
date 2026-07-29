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
  'jfca-2026-terms-v1'
)
on conflict (slug) do nothing;
