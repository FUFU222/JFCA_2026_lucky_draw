-- Task 4 adds the transactional pieces the registration/verification service
-- needs: an atomic verification-send gate, a targeted outbox claim, delivery
-- attribution, and error codes that separate an unusable link from a server
-- fault.

alter table public.email_deliveries
  add column kind text not null default 'VERIFICATION'
    check (kind in ('VERIFICATION', 'RECEIPT'));

-- Every caller states the kind explicitly; the default only exists so the
-- column can be added as `not null`.
alter table public.email_deliveries alter column kind drop default;

create index email_deliveries_kind_attempted_at_idx
  on public.email_deliveries (kind, attempted_at desc);

-- The 2-minute cooldown and the 3-sends-per-token ceiling are enforced here
-- rather than in the application, so concurrent submissions cannot both read
-- the same `send_count` and both send.
create or replace function public.claim_verification_send(
  p_token_id uuid,
  p_max_sends integer,
  p_cooldown_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  token_row public.verification_tokens%rowtype;
begin
  if p_token_id is null or p_max_sends <= 0 or p_cooldown_seconds < 0 then
    raise exception 'Verification send arguments must be present and positive'
      using errcode = '22023';
  end if;

  select token.* into token_row
  from public.verification_tokens as token
  where token.id = p_token_id
  for update;

  if not found then
    return false;
  end if;

  if token_row.consumed_at is not null
    or token_row.expires_at <= clock_timestamp()
    or token_row.send_count >= p_max_sends
    or (
      token_row.last_sent_at is not null
      and token_row.last_sent_at > clock_timestamp() - make_interval(secs => p_cooldown_seconds)
    )
  then
    return false;
  end if;

  update public.verification_tokens
  set send_count = send_count + 1,
      last_sent_at = clock_timestamp()
  where id = token_row.id;

  return true;
end;
$$;

-- The inline dispatch after a confirmation needs the receipt job for one
-- specific entry. It must lease exactly like the batch claim so a cron worker
-- and a web request can never send the same mail twice.
create or replace function public.claim_email_outbox_job_for_entry(
  p_entry_id uuid,
  p_kind text
)
returns table (
  id uuid,
  entry_id uuid,
  kind text,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_id uuid;
begin
  select job.id into job_id
  from public.email_outbox as job
  where job.entry_id = p_entry_id
    and job.kind = p_kind
    and (
      (job.status in ('PENDING', 'FAILED') and job.available_at <= clock_timestamp())
      or (job.status = 'PROCESSING' and job.lease_expires_at <= clock_timestamp())
    )
  order by job.available_at, job.created_at
  for update skip locked
  limit 1;

  if job_id is null then
    return;
  end if;

  return query
  update public.email_outbox as job
  set
    status = 'PROCESSING',
    attempt_count = job.attempt_count + 1,
    leased_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + interval '5 minutes'
  where job.id = job_id
  returning job.id, job.entry_id, job.kind, job.attempt_count, job.lease_expires_at;
end;
$$;

-- Replaces the 0001 definition, which took only the two hashes.
--
-- The event slug is now an argument because the caller cannot safely check it
-- afterwards: by then the token is consumed, the number is issued, and the
-- visitor is told the link is invalid while their entry has silently moved on.
-- The campaign schedule is checked here for the same reason.
--
-- SQLSTATEs:
--   RD001 the link cannot be used and the visitor should be told so
--   RD002 this live link derives a receipt the entry does not have, which means
--         RECEIPT_TOKEN_SECRET was rotated (an operator fault, not a bad link)
drop function if exists public.confirm_raffle_verification(text, text);

create function public.confirm_raffle_verification(
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
  if verification_token.consumed_at is null
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

  assigned_number := campaign_row.next_number;

  update public.campaigns
  set next_number = next_number + 1
  where id = campaign_row.id;

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

-- Completing a job is fenced by the lease that claimed it. Without the fence a
-- worker whose lease already expired could later overwrite the result of the
-- worker that reclaimed the job.
create or replace function public.complete_email_outbox_job(
  p_job_id uuid,
  p_lease_expires_at timestamptz,
  p_sent boolean,
  p_error text,
  p_retry_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  updated_id uuid;
begin
  update public.email_outbox as job
  set
    status = case when p_sent then 'SENT' else 'FAILED' end,
    sent_at = case when p_sent then clock_timestamp() else job.sent_at end,
    available_at = case
      when p_sent then job.available_at
      else clock_timestamp() + make_interval(secs => greatest(p_retry_seconds, 0))
    end,
    leased_at = null,
    lease_expires_at = null,
    last_error = case when p_sent then null else coalesce(p_error, 'delivery failed') end
  where job.id = p_job_id
    and job.status = 'PROCESSING'
    and job.lease_expires_at = p_lease_expires_at
  returning job.id into updated_id;

  return updated_id is not null;
end;
$$;

revoke all on function public.claim_verification_send(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_email_outbox_job(uuid, timestamptz, boolean, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_email_outbox_job_for_entry(uuid, text)
  from public, anon, authenticated;
revoke all on function public.confirm_raffle_verification(text, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_verification_send(uuid, integer, integer)
  to service_role;
grant execute on function public.complete_email_outbox_job(uuid, timestamptz, boolean, text, integer)
  to service_role;
grant execute on function public.claim_email_outbox_job_for_entry(uuid, text)
  to service_role;
grant execute on function public.confirm_raffle_verification(text, text, text)
  to service_role;
