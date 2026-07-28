-- Lets an authenticated operator walk the real public entry flow — real
-- form, real Turnstile challenge, real verification email, real confirmation
-- — without the resulting entry ever being able to win: it is issued a
-- number from a separate counter, well outside the real range, and excluded
-- from every admin count and export.

alter table public.campaigns
  add column test_next_number bigint not null default 900000001;

alter table public.raffle_entries
  add column is_test boolean not null default false;

-- Every existing query filters on `campaign_id` first, so this is the
-- column that benefits from being second in a composite index rather than
-- indexed alone.
create index raffle_entries_campaign_is_test_idx
  on public.raffle_entries (campaign_id, is_test);

-- Replaces the 0002 definition. The only changes are the two `is_test`
-- branches below — everything else (token/entry/campaign locking, the event
-- slug check, idempotent re-confirmation, receipt re-queueing) is unchanged.
create or replace function public.confirm_raffle_verification(
  p_token_hash text,
  p_receipt_token_hash text,
  p_event_slug text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  verification_token public.verification_tokens%rowtype;
  entry_row public.raffle_entries%rowtype;
  campaign_row public.campaigns%rowtype;
  assigned_number bigint;
begin
  if p_receipt_token_hash is null or length(p_receipt_token_hash) = 0 then
    raise exception 'Receipt token hash is required' using errcode = '22023';
  end if;

  select vt.* into verification_token
  from public.verification_tokens as vt
  where vt.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Verification token was not found' using errcode = 'RD001';
  end if;

  select entry.* into entry_row
  from public.raffle_entries as entry
  where entry.id = verification_token.entry_id
  for update;

  if not found then
    raise exception 'Verification entry was not found' using errcode = 'RD001';
  end if;

  select campaign.* into campaign_row
  from public.campaigns as campaign
  where campaign.id = entry_row.campaign_id
  for update;

  if not found then
    raise exception 'Verification campaign was not found' using errcode = 'RD001';
  end if;

  -- Checked before anything is written, so a link posted to the wrong event
  -- cannot consume a token or issue a number.
  if campaign_row.slug is distinct from p_event_slug then
    raise exception 'Verification link belongs to another event' using errcode = 'RD001';
  end if;

  -- A number must never be issued after the draw has begun or after an
  -- operator closed the campaign. A repeat confirmation of an already issued
  -- number is still answered below, because that only reads existing state.
  -- A test entry is exempt: an operator rehearsing the flow needs it to work
  -- before the campaign opens and after it closes, not only during the
  -- window real visitors get.
  if not entry_row.is_test
    and verification_token.consumed_at is null
    and (
      campaign_row.status = 'CLOSED'
      or (campaign_row.draw_starts_at is not null
          and campaign_row.draw_starts_at <= clock_timestamp())
    )
  then
    raise exception 'Registration for this event has ended' using errcode = 'RD001';
  end if;

  -- The presented token is examined before the entry state. A stale link from
  -- an earlier expired cycle must read as unusable, not as a receipt mismatch.
  if verification_token.consumed_at is not null then
    if entry_row.state = 'VERIFIED'
      and entry_row.number is not null
      and entry_row.receipt_token_hash = p_receipt_token_hash
    then
      insert into public.email_outbox (entry_id, kind)
      values (entry_row.id, 'RECEIPT')
      on conflict (entry_id, kind) do nothing;

      return entry_row.number;
    end if;

    raise exception 'Verification token has already been consumed' using errcode = 'RD001';
  end if;

  if verification_token.expires_at <= clock_timestamp() then
    raise exception 'Verification token has expired' using errcode = 'RD001';
  end if;

  if entry_row.state = 'VERIFIED' and entry_row.number is not null then
    if entry_row.receipt_token_hash is null then
      update public.raffle_entries
      set receipt_token_hash = p_receipt_token_hash
      where id = entry_row.id;
    elsif entry_row.receipt_token_hash <> p_receipt_token_hash then
      -- This link is live and unconsumed, so it is the link that should derive
      -- the stored receipt. A mismatch means the secret changed.
      raise exception 'Receipt token hash does not match existing receipt'
        using errcode = 'RD002';
    end if;

    insert into public.email_outbox (entry_id, kind)
    values (entry_row.id, 'RECEIPT')
    on conflict (entry_id, kind) do nothing;

    return entry_row.number;
  end if;

  if entry_row.is_test then
    assigned_number := campaign_row.test_next_number;

    update public.campaigns
    set test_next_number = test_next_number + 1
    where id = campaign_row.id;
  else
    assigned_number := campaign_row.next_number;

    update public.campaigns
    set next_number = next_number + 1
    where id = campaign_row.id;
  end if;

  update public.raffle_entries
  set
    state = 'VERIFIED',
    number = assigned_number,
    verified_at = clock_timestamp(),
    receipt_token_hash = p_receipt_token_hash
  where id = entry_row.id;

  update public.verification_tokens
  set consumed_at = clock_timestamp()
  where id = verification_token.id;

  insert into public.email_outbox (entry_id, kind)
  values (entry_row.id, 'RECEIPT')
  on conflict (entry_id, kind) do nothing;

  return assigned_number;
end;
$$;
