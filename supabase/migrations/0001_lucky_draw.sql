create extension if not exists pgcrypto;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  opens_at timestamptz,
  draw_starts_at timestamptz,
  status text not null check (status in ('DRAFT', 'SCHEDULED', 'PAUSED', 'CLOSED')),
  next_number bigint not null default 10000 check (next_number >= 10000),
  terms_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at is null or draw_starts_at is null or opens_at < draw_starts_at)
);

create table public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  email text not null check (email = btrim(email) and length(email) > 0),
  first_name text,
  last_name text,
  phone text,
  gender text,
  date_of_birth date,
  country text,
  region text,
  locale text not null check (locale in ('en', 'ja')),
  terms_version text not null,
  terms_consented_at timestamptz not null,
  state text not null check (state in ('PENDING', 'VERIFIED')),
  number bigint check (number is null or number >= 10000),
  verified_at timestamptz,
  receipt_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, number),
  check (
    (state = 'PENDING' and number is null and verified_at is null)
    or (state = 'VERIFIED' and number is not null and verified_at is not null)
  )
);

-- Email is normalized at the application boundary; the check rejects values
-- with leading/trailing whitespace and this index enforces case-insensitivity.
create unique index raffle_entries_campaign_lower_email_key
  on public.raffle_entries (campaign_id, lower(email));

create index raffle_entries_campaign_state_created_at_idx
  on public.raffle_entries (campaign_id, state, created_at desc);

create table public.verification_tokens (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.raffle_entries(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  send_count integer not null default 0 check (send_count >= 0),
  last_sent_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index verification_tokens_entry_id_idx on public.verification_tokens (entry_id);
create index verification_tokens_expires_at_idx on public.verification_tokens (expires_at);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  campaign_id uuid references public.campaigns(id),
  entry_id uuid references public.raffle_entries(id),
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_campaign_created_at_idx
  on public.admin_audit_logs (campaign_id, created_at desc);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.raffle_entries(id) on delete cascade,
  kind text not null check (kind in ('VERIFICATION', 'RECEIPT')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, kind)
);

create index email_outbox_claim_idx
  on public.email_outbox (status, available_at, created_at);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.email_outbox(id) on delete set null,
  entry_id uuid not null references public.raffle_entries(id) on delete cascade,
  provider_message_id text,
  provider_status text,
  provider_response jsonb,
  provider_error text,
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index email_deliveries_entry_attempted_at_idx
  on public.email_deliveries (entry_id, attempted_at desc);

create table public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create trigger raffle_entries_set_updated_at
before update on public.raffle_entries
for each row execute function public.set_updated_at();

create trigger email_outbox_set_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

create trigger rate_limit_buckets_set_updated_at
before update on public.rate_limit_buckets
for each row execute function public.set_updated_at();

create or replace function public.consume_raffle_rate_limit(
  key text,
  limit integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  allowed boolean;
begin
  if key is null or length(key) = 0 or limit <= 0 or window_seconds <= 0 then
    raise exception 'Rate limit arguments must be non-empty and positive' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as bucket (
    bucket_key,
    window_started_at,
    request_count
  )
  values (key, clock_timestamp(), 1)
  on conflict (bucket_key) do update
  set
    window_started_at = case
      when bucket.window_started_at + make_interval(secs => window_seconds) <= clock_timestamp()
        then clock_timestamp()
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at + make_interval(secs => window_seconds) <= clock_timestamp()
        then 1
      else bucket.request_count + 1
    end
  where bucket.window_started_at + make_interval(secs => window_seconds) <= clock_timestamp()
    or bucket.request_count < limit
  returning true into allowed;

  return coalesce(allowed, false);
end;
$$;

create or replace function public.confirm_raffle_verification(
  token_hash text,
  receipt_token_hash text
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
  if $2 is null or length($2) = 0 then
    raise exception 'Receipt token hash is required' using errcode = '22023';
  end if;

  select vt.* into verification_token
  from public.verification_tokens as vt
  where vt.token_hash = $1
  for update;

  if not found then
    raise exception 'Verification token was not found' using errcode = '22023';
  end if;

  select entry.* into entry_row
  from public.raffle_entries as entry
  where entry.id = verification_token.entry_id
  for update;

  if not found then
    raise exception 'Verification entry was not found' using errcode = '22023';
  end if;

  select campaign.* into campaign_row
  from public.campaigns as campaign
  where campaign.id = entry_row.campaign_id
  for update;

  if not found then
    raise exception 'Verification campaign was not found' using errcode = '22023';
  end if;

  if entry_row.state = 'VERIFIED' and entry_row.number is not null then
    if entry_row.receipt_token_hash is not null and entry_row.receipt_token_hash <> $2 then
      raise exception 'Receipt token hash does not match existing receipt' using errcode = '22023';
    end if;

    if entry_row.receipt_token_hash is null then
      update public.raffle_entries
      set receipt_token_hash = $2
      where id = entry_row.id;
    end if;

    insert into public.email_outbox (entry_id, kind)
    values (entry_row.id, 'RECEIPT')
    on conflict (entry_id, kind) do nothing;

    return entry_row.number;
  end if;

  if verification_token.consumed_at is not null then
    raise exception 'Verification token has already been consumed' using errcode = '22023';
  end if;

  if verification_token.expires_at <= clock_timestamp() then
    raise exception 'Verification token has expired' using errcode = '22023';
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
    receipt_token_hash = $2
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

create or replace function public.claim_email_outbox_job()
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
  where (job.status = 'PENDING' and job.available_at <= clock_timestamp())
    or (job.status = 'FAILED' and job.available_at <= clock_timestamp())
    or (job.status = 'PROCESSING' and job.lease_expires_at <= clock_timestamp())
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

alter table public.campaigns enable row level security;
alter table public.raffle_entries enable row level security;
alter table public.verification_tokens enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.rate_limit_buckets enable row level security;

revoke all on table public.campaigns, public.raffle_entries, public.verification_tokens,
  public.admin_audit_logs, public.email_outbox, public.email_deliveries,
  public.rate_limit_buckets from public, anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.consume_raffle_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.confirm_raffle_verification(text, text)
  from public, anon, authenticated;
revoke all on function public.claim_email_outbox_job()
  from public, anon, authenticated;

grant execute on function public.set_updated_at() to service_role;
grant execute on function public.consume_raffle_rate_limit(text, integer, integer)
  to service_role;
grant execute on function public.confirm_raffle_verification(text, text)
  to service_role;
grant execute on function public.claim_email_outbox_job()
  to service_role;
