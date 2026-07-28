-- Verification mail is sent inline so a visitor standing at the venue is not
-- waiting on a cron tick. When that inline send fails, the message still has to
-- be delivered: this arms the entry's outbox row so the retry worker picks it
-- up. It is not a plain upsert because a row that another worker currently
-- holds a live lease on must not be reset underneath it.
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
    available_at = clock_timestamp(),
    leased_at = null,
    lease_expires_at = null,
    last_error = p_error
  where job.status <> 'SENT'
    and (job.status <> 'PROCESSING' or job.lease_expires_at <= clock_timestamp())
  returning job.id into armed_id;

  return armed_id is not null;
end;
$$;

revoke all on function public.arm_email_outbox_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.arm_email_outbox_job(uuid, text, text)
  to service_role;
