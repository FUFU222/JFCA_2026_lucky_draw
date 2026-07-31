-- The receipt email is no longer sent, so this function no longer arms it.
--
-- `818c271` made a used verification link redirect to the number it issued, and
-- that lookup does not check the token's expiry — it only asks whether a
-- receipt exists. The confirmation email in the visitor's inbox is therefore
-- already a permanent way back to their number, and a second email carrying
-- the same link stopped being the durable copy and became a duplicate of one.
--
-- Removing the send alone would not have worked: this function inserted the
-- `RECEIPT` outbox row inside the same transaction that issues the number, at
-- three points, so the retry worker would have picked it up and sent it about
-- an hour and a half later. Those three inserts are what this migration
-- removes. Nothing else in the function changes — it is `0009`'s definition
-- with those nine lines taken out, generated from that file rather than
-- retyped.
--
-- The `RECEIPT` kind, the worker's handling of it and the mailer are all left
-- in place on purpose. Production already holds receipt rows from before this
-- change, and a worker that could no longer settle them would leave
-- 送信待ちメール数 and /api/health reporting a queue that never drains.

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

  -- A number must never be issued while the campaign is not taking entries.
  -- A repeat confirmation of an already issued number is still answered below,
  -- because that only reads existing state. A test entry is exempt: an
  -- operator rehearsing the flow needs it to work before the campaign opens
  -- and after it closes, not only during the window real visitors get.
  --
  -- DRAFT joins CLOSED here. It is not reachable from the dashboard, but it is
  -- the status somebody reaches for in the Supabase table editor to stop
  -- everything, and the visitor's page already says "Entries are not open yet"
  -- for it — a screen that says intake is shut while confirmations quietly
  -- keep consuming numbers is the worst of both. PAUSED deliberately stays
  -- out: someone who entered while it was open keeps their link.
  if not entry_row.is_test
    and verification_token.consumed_at is null
    and (
      campaign_row.status in ('CLOSED', 'DRAFT')
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


  return assigned_number;
end;
$$;
