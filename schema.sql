-- =========================================================
-- Omnignis Church Portal — Supabase schema (v2)
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
  insert into public.profiles (id, church_name, destination_emails, report_frequency)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'church_name', 'My Church'),
    coalesce(new.raw_user_meta_data->>'destination_emails', new.email),
    coalesce(new.raw_user_meta_data->>'report_frequency', 'weekly')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
