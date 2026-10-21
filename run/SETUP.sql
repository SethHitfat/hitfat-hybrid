-- ═══════════════════════════════════════════════════════════════
-- HITFAT RUN CLUB — run once in the Supabase SQL editor.
-- Same project as HITFAT Hybrid; nothing here touches its tables.
-- ═══════════════════════════════════════════════════════════════

-- 1. Each runner's full history (routes, splits, settings). Private.
--    Kept apart from user_data because the Hybrid app rewrites that row
--    whole and would drop keys it does not know.
create table if not exists public.run_data(
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
alter table public.run_data enable row level security;
create policy "run_data_sel" on public.run_data for select using (auth.uid() = user_id);
create policy "run_data_ins" on public.run_data for insert with check (auth.uid() = user_id);
create policy "run_data_upd" on public.run_data for update using (auth.uid() = user_id);

-- 2. One summary row per run, readable by every signed-in member: this is
--    the leaderboard. No route and no location, only name, date, km, time.
create table if not exists public.run_club_runs(
  id           text primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  started_at   timestamptz not null,
  distance_m   integer not null check (distance_m between 200 and 200000),
  duration_s   integer not null check (duration_s between 1 and 86400),
  created_at   timestamptz not null default now(),
  -- nothing faster than ~2:23/km, so a GPS jump cannot top the board
  constraint run_club_runs_pace check (distance_m <= duration_s * 7));
create index if not exists run_club_runs_started_idx on public.run_club_runs(started_at);
alter table public.run_club_runs enable row level security;
create policy "rcr_sel" on public.run_club_runs for select to authenticated using (true);
create policy "rcr_ins" on public.run_club_runs for insert to authenticated with check (auth.uid() = user_id);
create policy "rcr_upd" on public.run_club_runs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rcr_del" on public.run_club_runs for delete to authenticated using (auth.uid() = user_id);

-- 3. Auth → URL Configuration → Redirect URLs: add  https://<your-domain>/run/
--    so Google sign-in can come back to the Run Club page.
