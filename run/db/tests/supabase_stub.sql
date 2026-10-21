-- Minimal stand-in for the parts of Supabase the migration relies on, so it can
-- be tested on a plain Postgres. Mirrors production: auth.uid() reads the JWT
-- claims PostgREST sets, and the Hybrid objects exist with their real shapes.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Hybrid objects (real shapes, production definitions)
create table if not exists public.clubs(id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique);
create table if not exists public.club_physical_members(id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
  user_id uuid not null, role text not null, status text not null default 'active');
create or replace function public.hitfat_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.club_physical_members m join public.clubs c on c.id = m.club_id
                  where m.user_id = auth.uid() and m.status = 'active' and m.role = 'admin' and c.slug = 'hitfat') $$;
create table if not exists public.plus_entitlements(id bigserial primary key, user_id uuid not null, sku text not null, kind text not null,
  credits_left integer, expires_at timestamptz, source text, created_at timestamptz not null default now());

-- shared HITFAT profile (production: filled by the handle_new_user trigger)
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade, email text, name text, display_name text);
alter table public.profiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_read') then
    create policy profiles_read on public.profiles for select using (auth.uid() is not null);
  end if;
end $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email) on conflict (id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
