-- Findings from the pre-launch review.

-- The operator session check reads this on every admin request.
create index if not exists admin_audit_logs_user_action_idx
  on public.admin_audit_logs (admin_user_id, action);

-- A verification message that the inline send lost has to be deliverable even
-- when this entry's outbox row was used for an earlier message. The row is not
-- a retry ledger; it is "the verification message currently owed to this
-- entry", and a `SENT` row simply means the previous one is done. Refusing to
-- re-arm it silently destroyed every send after the first one that the worker
-- had to deliver.
--
-- Only a live lease is protected, and a revived job starts its attempt count
-- again, because it is a new message rather than another try at an old one.
create or replace function public.arm_email_outbox_job(
  p_entry_id uuid,
  p_kind text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  armed_id uuid;
begin
  if p_kind not in ('VERIFICATION', 'RECEIPT') then
    raise exception 'Unknown outbox job kind %', p_kind using errcode = '22023';
  end if;

  insert into public.email_outbox as job (entry_id, kind, status, available_at, last_error)
  values (p_entry_id, p_kind, 'PENDING', clock_timestamp(), p_error)
  on conflict (entry_id, kind) do update
  set
    status = 'PENDING',
    attempt_count = 0,
    available_at = clock_timestamp(),
    sent_at = null,
    leased_at = null,
    lease_expires_at = null,
    last_error = p_error
  where job.status <> 'PROCESSING' or job.lease_expires_at <= clock_timestamp()
  returning job.id into armed_id;

  return armed_id is not null;
end;
$$;

-- A message the inline send delivered makes any queued copy redundant. Without
-- this, an entry whose earlier attempt was armed receives the same link twice.
create or replace function public.settle_email_outbox_job(
  p_entry_id uuid,
  p_kind text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  settled_id uuid;
begin
  update public.email_outbox as job
  set status = 'SENT',
      sent_at = clock_timestamp(),
      leased_at = null,
      lease_expires_at = null,
      last_error = null
  where job.entry_id = p_entry_id
    and job.kind = p_kind
    and job.status in ('PENDING', 'FAILED')
  returning job.id into settled_id;

  return settled_id is not null;
end;
$$;

-- The claim predicate ORs across statuses, so the composite index on
-- (status, available_at, created_at) could not be used and every claim scanned
-- and disk-sorted the whole table. These two cover the two live branches.
create index if not exists email_outbox_ready_idx
  on public.email_outbox (available_at, created_at)
  where status in ('PENDING', 'FAILED');

create index if not exists email_outbox_expired_lease_idx
  on public.email_outbox (lease_expires_at)
  where status = 'PROCESSING';

revoke all on function public.arm_email_outbox_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_email_outbox_job(uuid, text)
  from public, anon, authenticated;

grant execute on function public.arm_email_outbox_job(uuid, text, text) to service_role;
grant execute on function public.settle_email_outbox_job(uuid, text) to service_role;
