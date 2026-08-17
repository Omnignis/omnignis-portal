-- =========================================================
-- Omnignis Church Portal: Supabase schema (v2)
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run: tables use IF NOT EXISTS, columns use
-- idempotent ALTERs, and policies are guarded with DO blocks.
-- =========================================================

-- 1. Profiles: one row per church account (linked to auth.users)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  church_name        text not null,
  destination_emails text not null,               -- comma-separated recipient emails
  report_frequency   text not null default 'weekly'
                     check (report_frequency in ('daily','weekly','monthly')),
  last_report_at     timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.profiles add column if not exists business_address text;
alter table public.profiles add column if not exists phone text;

-- 2. Facebook connection: encrypted tokens per church.
--    page_id / token_ciphertext are NULLABLE because the OAuth callback may land
--    before the church has picked which page to report on (multi-page accounts).
--    A connection is "complete" when page_id AND token_ciphertext are both set.
create table if not exists public.facebook_connections (
  profile_id            uuid primary key references auth.users(id) on delete cascade,
  page_id               text,
  page_name             text,
  token_ciphertext      text,                     -- AES-256-GCM encrypted PAGE token
  fb_user_id            text,                     -- for revoke + deletion webhook
  user_token_ciphertext text,                     -- AES-256-GCM encrypted USER token
  connected_at          timestamptz not null default now()
);
-- Upgrading from v1 (where these were NOT NULL / missing):
alter table public.facebook_connections alter column page_id drop not null;
alter table public.facebook_connections alter column token_ciphertext drop not null;
alter table public.facebook_connections add column if not exists fb_user_id text;
alter table public.facebook_connections add column if not exists user_token_ciphertext text;
create index if not exists fb_connections_fb_user_idx on public.facebook_connections (fb_user_id);

-- 3. Short-lived OAuth states (CSRF protection for the Facebook connect flow).
--    Rows are single-use: the callback deletes on read and rejects anything
--    older than 10 minutes. /api/facebook/start also clears the user's old rows.
create table if not exists public.oauth_states (
  state       text primary key,
  profile_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---- Row Level Security ----
alter table public.profiles enable row level security;
alter table public.facebook_connections enable row level security;
alter table public.oauth_states enable row level security;

-- Policies, guarded so this file can be re-run without "already exists" errors.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own') then
    create policy "profiles_select_own" on public.profiles
      for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own') then
    create policy "profiles_update_own" on public.profiles
      for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facebook_connections' and policyname='fb_select_own') then
    -- A church can read its own connection status. The browser only ever selects
    -- page_id/page_name/connected_at/token presence; ciphertext never leaves the server path by design.
    create policy "fb_select_own" on public.facebook_connections
      for select using (auth.uid() = profile_id);
  end if;
end $$;

-- oauth_states + all WRITES to facebook_connections happen server-side with the
-- service role, which bypasses RLS. No anon policies for those, by design.

-- ---- Auto-create a profile row when a user signs up ----
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, church_name, destination_emails, report_frequency, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'church_name', 'My Church'),
    coalesce(new.raw_user_meta_data->>'destination_emails', new.email),
    coalesce(new.raw_user_meta_data->>'report_frequency', 'weekly'),
    coalesce(nullif(new.raw_user_meta_data->>'timezone', ''), 'America/Chicago')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- Backfill: profiles for users who signed up before this schema existed ----
-- The trigger above only fires on INSERT into auth.users, so any account created
-- before the schema was applied has no profiles row and the dashboard renders
-- empty. Idempotent: the LEFT JOIN means re-running inserts nothing.
insert into public.profiles (id, church_name, destination_emails, report_frequency)
select u.id,
       coalesce(u.raw_user_meta_data->>'church_name', 'My Church'),
       coalesce(u.raw_user_meta_data->>'destination_emails', u.email),
       coalesce(u.raw_user_meta_data->>'report_frequency', 'weekly')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ============================================================
-- Column-level grants (added after security review, 2026-08-14)
--
-- RLS in Postgres is ROW level, not COLUMN level. The fb_select_own policy
-- above correctly limits a user to their own row, but Supabase's default
-- table-wide SELECT grant meant that row included token_ciphertext and
-- user_token_ciphertext. The dashboard was in fact selecting the ciphertext.
--
-- These grants enforce the boundary the comments above already claimed.
-- Re-runnable: grant/revoke are idempotent.
-- service_role is unaffected and keeps full access for the server routes
-- and the scheduled report job.
-- ============================================================

revoke select on public.facebook_connections from authenticated;
grant  select (profile_id, page_id, page_name, connected_at)
  on public.facebook_connections to authenticated;

-- last_report_at is scheduling state owned by report.py. A client that could
-- write it could silently stop its own reports, or force a huge back-fill.
revoke update on public.profiles from authenticated;
grant  update (church_name, destination_emails, report_frequency, business_address, phone)
  on public.profiles to authenticated;

-- ============================================================
-- On-demand reports (added 2026-08-17)
-- The portal's "Send report now" button triggers the GitHub Actions job for a
-- single church. This column is the server-side rate limit and is deliberately
-- NOT in the authenticated UPDATE grant above, so a client cannot reset its own
-- cooldown. Only report.py and the API route (service_role) write it.
-- ============================================================
alter table public.profiles add column if not exists last_manual_report_at timestamptz;

-- ============================================================
-- Per-church delivery schedule and export formats (added 2026-08-17)
--
-- Previously every report went out on one fixed UTC cron, and dates came from
-- the raw UTC timestamp, so a Sunday evening service was dated Monday for every
-- church west of Greenwich. The workflow now runs hourly and report.py decides
-- who is due in their own local time.
-- ============================================================
alter table public.profiles add column if not exists timezone text not null default 'America/Chicago';
alter table public.profiles add column if not exists send_hour int not null default 13;
alter table public.profiles add column if not exists send_weekday int not null default 6;   -- Mon=0 .. Sun=6
alter table public.profiles add column if not exists report_formats text not null default 'xlsx';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_send_hour_range') then
    alter table public.profiles add constraint profiles_send_hour_range
      check (send_hour between 0 and 23);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_send_weekday_range') then
    alter table public.profiles add constraint profiles_send_weekday_range
      check (send_weekday between 0 and 6);
  end if;
end $$;

-- Re-grant UPDATE to include the new columns. last_report_at and
-- last_manual_report_at stay server-owned and are deliberately absent.
revoke update on public.profiles from authenticated;
grant  update (church_name, destination_emails, report_frequency, business_address,
               phone, timezone, send_hour, send_weekday, report_formats)
  on public.profiles to authenticated;
