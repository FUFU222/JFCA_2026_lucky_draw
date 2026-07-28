-- The public side dropped Japanese entirely: visitors are not expected to
-- read it. The `locale` column stays (the admin CSV export and entries table
-- still show it) but only 'en' is ever written from here on, so the
-- constraint is narrowed to match rather than left permitting a value the
-- application can no longer produce.

alter table public.raffle_entries
  drop constraint raffle_entries_locale_check;

alter table public.raffle_entries
  add constraint raffle_entries_locale_check check (locale = 'en');
