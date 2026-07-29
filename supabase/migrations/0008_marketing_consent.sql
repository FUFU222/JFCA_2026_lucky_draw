-- Marketing consent is recorded separately from the entry consent.
--
-- Entering the draw required one checkbox, and the terms behind it also covered
-- LIVAPON news, so entering meant accepting marketing. The event is in Toronto,
-- which puts it under CASL, and that law wants consent to marketing to be an
-- affirmative act of its own rather than a condition of getting the thing the
-- person actually came for.
--
-- `false` is the only safe default: every entry that already exists, and every
-- entry made by someone who leaves the new box alone, is not a subscriber.
alter table public.raffle_entries
  add column marketing_consent boolean not null default false;

-- CASL puts the burden of proving consent on the sender, so the moment it was
-- given is evidence, not decoration. Null whenever `marketing_consent` is
-- false; the check keeps the two from drifting apart.
alter table public.raffle_entries
  add column marketing_consent_at timestamptz;

alter table public.raffle_entries
  add constraint raffle_entries_marketing_consent_at_check
  check (
    (marketing_consent and marketing_consent_at is not null)
    or (not marketing_consent and marketing_consent_at is null)
  );

-- The export and any future segmentation both read "who may be mailed".
create index raffle_entries_campaign_marketing_consent_idx
  on public.raffle_entries (campaign_id, marketing_consent);
