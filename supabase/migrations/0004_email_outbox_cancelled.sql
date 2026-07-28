-- Some jobs can never succeed: a verification retry whose link expired before
-- the worker reached it has nothing left to send. Recording those as `FAILED`
-- keeps them in the retry rotation forever and buries the failures an operator
-- actually needs to see, so they get a terminal state of their own.
alter table public.email_outbox drop constraint email_outbox_status_check;

alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'));

-- `arm_email_outbox_job` already refuses to revive a `SENT` job; a cancelled one
-- must be revivable, because a fresh submission issues a new link and genuinely
-- has something to deliver again.
create or replace function public.complete_email_outbox_job(
  p_job_id uuid,
  p_lease_expires_at timestamptz,
  p_outcome text,
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
  if p_outcome not in ('SENT', 'FAILED', 'CANCELLED') then
    raise exception 'Unknown outbox outcome %', p_outcome using errcode = '22023';
  end if;

  update public.email_outbox as job
  set
    status = p_outcome,
    sent_at = case when p_outcome = 'SENT' then clock_timestamp() else job.sent_at end,
    available_at = case
      when p_outcome = 'FAILED'
        then clock_timestamp() + make_interval(secs => greatest(p_retry_seconds, 0))
      else job.available_at
    end,
    leased_at = null,
    lease_expires_at = null,
    last_error = case when p_outcome = 'SENT' then null else coalesce(p_error, 'delivery failed') end
  where job.id = p_job_id
    and job.status = 'PROCESSING'
    and job.lease_expires_at = p_lease_expires_at
  returning job.id into updated_id;

  return updated_id is not null;
end;
$$;

drop function if exists public.complete_email_outbox_job(uuid, timestamptz, boolean, text, integer);

revoke all on function public.complete_email_outbox_job(uuid, timestamptz, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.complete_email_outbox_job(uuid, timestamptz, text, text, integer)
  to service_role;
