-- ═══════════════════════════════════════════════════════════════════════
-- HITFAT RUN CLUB · Phase 1 schema
--
-- Additive only: every object is new and prefixed run_. Nothing in the
-- HITFAT Hybrid schema is altered or dropped. Two existing objects are
-- read, never written:
--   public.hitfat_is_admin()   → HITFAT platform admins are Run super admins
--   public.plus_entitlements   → paid tiers (Phase 3) map onto existing SKUs
--
-- Run it once in the Supabase SQL editor (or `supabase db push`).
-- Safe to re-run: guarded by IF NOT EXISTS / CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.run_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ───────────────────────── chapters & staff ─────────────────────────
create table if not exists public.run_chapters(
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name       text not null check (char_length(name) between 2 and 80),
  state      text,
  city       text,
  timezone   text not null default 'Asia/Kuala_Lumpur',
  is_active  boolean not null default true,
  created_at timestamptz not null default now());

-- Roles are per chapter; chapter_id null means "all chapters".
create table if not exists public.run_staff(
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('super_admin','head_coach','running_coach','club_captain')),
  chapter_id uuid references public.run_chapters(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null);
create unique index if not exists run_staff_uniq
  on public.run_staff(user_id, role, coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.run_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.hitfat_is_admin(), false)
      or exists(select 1 from public.run_staff where user_id = auth.uid() and role = 'super_admin')
$$;

-- true when the caller holds any of `roles` for this chapter (or for all chapters)
create or replace function public.run_has_role(roles text[], p_chapter uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.run_is_super_admin()
      or exists(select 1 from public.run_staff s
                 where s.user_id = auth.uid() and s.role = any(roles)
                   and (s.chapter_id is null or s.chapter_id = p_chapter))
$$;

create or replace function public.run_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.run_is_super_admin() or exists(select 1 from public.run_staff where user_id = auth.uid())
$$;

-- ───────────────────────── runner profile (onboarding) ─────────────────────────
create table if not exists public.run_profiles(
  user_id             uuid primary key references auth.users(id) on delete cascade,
  display_name        text check (char_length(display_name) between 1 and 40),
  language            text not null default 'ms' check (language in ('ms','en')),
  goal                text check (goal in ('start','first_5k','improve_5k','first_10k','improve_10k','half','marathon','hyrox','fitness')),
  experience          text check (experience in ('none','some','regular','experienced')),
  level               text check (level in ('beginner','intermediate','advanced')),
  continuous_run_min  smallint check (continuous_run_min between 0 and 600),
  days_per_week       smallint check (days_per_week between 1 and 7),
  preferred_days      smallint[] check (preferred_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  target_distance_m   integer check (target_distance_m between 1000 and 100000),
  race_date           date,
  weekly_km_recent    numeric(5,1) check (weekly_km_recent between 0 and 300),
  recent_race_m       integer check (recent_race_m between 1000 and 100000),
  recent_race_s       integer check (recent_race_s between 120 and 86400),
  has_limitations     boolean not null default false,
  limitations         text check (char_length(limitations) <= 1000),
  -- health information is only kept with explicit consent (see run_profiles_health_consent)
  health_consent_at   timestamptz,
  training_location   text check (training_location in ('road','track','treadmill','trail','mixed')),
  chapter_id          uuid references public.run_chapters(id) on delete set null,
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint run_profiles_health_consent check (not has_limitations and limitations is null or health_consent_at is not null));
drop trigger if exists run_profiles_touch on public.run_profiles;
create trigger run_profiles_touch before update on public.run_profiles for each row execute function public.run_touch();

-- ───────────────────────── training programmes ─────────────────────────
create table if not exists public.run_programs(
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  -- {"ms":{"title","summary","who"},"en":{...}}
  i18n              jsonb not null,
  goal              text not null,
  level             text not null check (level in ('beginner','intermediate','advanced')),
  weeks             smallint not null check (weeks between 1 and 30),
  sessions_per_week smallint not null check (sessions_per_week between 1 and 7),
  target_distance_m integer,
  tier              text not null default 'free' check (tier in ('free','plus','coach')),
  status            text not null default 'draft' check (status in ('draft','review','published','archived')),
  sort              smallint not null default 100,
  author_id         uuid references auth.users(id) on delete set null,
  reviewed_by       uuid references auth.users(id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint run_programs_i18n check (i18n ? 'ms' and i18n->'ms' ? 'title'));
drop trigger if exists run_programs_touch on public.run_programs;
create trigger run_programs_touch before update on public.run_programs for each row execute function public.run_touch();

create table if not exists public.run_workout_templates(
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references public.run_programs(id) on delete cascade,
  week          smallint not null check (week >= 1),
  session       smallint not null check (session >= 1),
  category      text not null check (category in ('easy','recovery','long','tempo','threshold','interval','hill','run_walk','strength','mobility','rest','cross')),
  -- {"ms":{"title","objective","warmup","main","cooldown","coach"},"en":{...}}
  i18n          jsonb not null,
  duration_min  smallint check (duration_min between 1 and 400),
  distance_m    integer check (distance_m between 100 and 100000),
  intensity     text check (intensity in ('easy','moderate','hard')),
  rpe_min       smallint check (rpe_min between 1 and 10),
  rpe_max       smallint check (rpe_max between 1 and 10),
  hr_zone       smallint check (hr_zone between 1 and 5),
  rest_interval text,
  video_url     text check (video_url ~ '^https://'),
  -- structured blocks for guided playback later: [{"kind":"run|walk","sec":60}, ...]
  steps         jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(program_id, week, session),
  constraint run_wt_rpe check (rpe_min is null or rpe_max is null or rpe_min <= rpe_max),
  constraint run_wt_i18n check (i18n ? 'ms' and i18n->'ms' ? 'title'));
drop trigger if exists run_wt_touch on public.run_workout_templates;
create trigger run_wt_touch before update on public.run_workout_templates for each row execute function public.run_touch();

-- Paid tiers map to existing HITFAT+ SKUs, so no second billing system is needed.
create table if not exists public.run_tier_skus(
  tier text not null check (tier in ('plus','coach')),
  sku  text not null,
  primary key (tier, sku));

create or replace function public.run_entitled(p_tier text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_tier = 'free'
      or public.run_is_staff()
      or exists(select 1 from public.plus_entitlements e
                  join public.run_tier_skus t on t.sku = e.sku
                 where e.user_id = auth.uid()
                   and (e.expires_at is null or e.expires_at > now())
                   -- coach tier includes plus
                   and (t.tier = p_tier or (p_tier = 'plus' and t.tier = 'coach')))
$$;

-- ───────────────────────── enrolment & calendar ─────────────────────────
create table if not exists public.run_enrollments(
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  program_id   uuid not null references public.run_programs(id) on delete restrict,
  start_date   date not null,
  weekdays     smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  status       text not null default 'active' check (status in ('active','completed','stopped')),
  created_at   timestamptz not null default now(),
  ended_at     timestamptz);
create unique index if not exists run_enrollments_one_active on public.run_enrollments(user_id) where status = 'active';

create table if not exists public.run_scheduled_workouts(
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.run_enrollments(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  template_id    uuid not null references public.run_workout_templates(id) on delete restrict,
  seq            smallint not null,
  scheduled_date date not null,
  status         text not null default 'planned' check (status in ('planned','completed','skipped')),
  completed_at   timestamptz,
  activity_id    uuid,               -- fk added below, after run_activities exists
  rpe            smallint check (rpe between 1 and 10),
  feeling        text check (feeling in ('too_easy','right','too_hard','pain')),
  feedback       text check (char_length(feedback) <= 1000),
  updated_at     timestamptz not null default now(),
  unique(enrollment_id, seq));
create index if not exists run_sw_user_date on public.run_scheduled_workouts(user_id, scheduled_date);
drop trigger if exists run_sw_touch on public.run_scheduled_workouts;
create trigger run_sw_touch before update on public.run_scheduled_workouts for each row execute function public.run_touch();

-- ───────────────────────── running activities ─────────────────────────
create table if not exists public.run_activities(
  -- client-generated, so a retried submit is an upsert and never a duplicate
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source           text not null default 'manual' check (source in ('manual','gps','strava')),
  external_id      text,
  started_at       timestamptz not null check (started_at > '2000-01-01' and started_at < now() + interval '1 day'),
  distance_m       integer not null check (distance_m between 50 and 300000),
  moving_time_s    integer not null check (moving_time_s between 30 and 172800),
  elapsed_time_s   integer check (elapsed_time_s between 30 and 172800),
  avg_pace_s_km    integer generated always as (round(moving_time_s * 1000.0 / distance_m)) stored,
  rpe              smallint check (rpe between 1 and 10),
  avg_hr           smallint check (avg_hr between 30 and 250),
  workout_type     text check (workout_type in ('easy','recovery','long','tempo','threshold','interval','hill','run_walk','race','other')),
  title            text check (char_length(title) <= 80),
  notes            text check (char_length(notes) <= 2000),
  -- GPS only: thinned [[lat,lng],...] and per-km splits in seconds. Private to the owner.
  route            jsonb,
  splits_s         integer[],
  scheduled_workout_id uuid references public.run_scheduled_workouts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- nothing faster than 2:00/km is a run
  constraint run_act_pace check (moving_time_s * 1000 >= distance_m * 120),
  constraint run_act_elapsed check (elapsed_time_s is null or elapsed_time_s >= moving_time_s));
create unique index if not exists run_act_external on public.run_activities(user_id, source, external_id) where external_id is not null;
create index if not exists run_act_user_started on public.run_activities(user_id, started_at desc);
drop trigger if exists run_act_touch on public.run_activities;
create trigger run_act_touch before update on public.run_activities for each row execute function public.run_touch();

do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'run_sw_activity_fk') then
    alter table public.run_scheduled_workouts add constraint run_sw_activity_fk
      foreign key (activity_id) references public.run_activities(id) on delete set null;
  end if;
end $$;

-- ───────────────────────── club: membership & events ─────────────────────────
create table if not exists public.run_club_members(
  chapter_id uuid not null references public.run_chapters(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (chapter_id, user_id));

create table if not exists public.run_events(
  id             uuid primary key default gen_random_uuid(),
  chapter_id     uuid not null references public.run_chapters(id) on delete cascade,
  title          text not null check (char_length(title) between 3 and 100),
  description    text check (char_length(description) <= 3000),
  starts_at      timestamptz not null,
  duration_min   smallint not null default 60 check (duration_min between 10 and 600),
  meeting_point  text not null check (char_length(meeting_point) between 3 and 200),
  map_url        text check (map_url ~ '^https://'),
  distance_text  text check (char_length(distance_text) <= 80),
  pace_groups    text check (char_length(pace_groups) <= 200),
  leader_name    text check (char_length(leader_name) <= 80),
  capacity       integer check (capacity between 1 and 5000),
  status         text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now());
create index if not exists run_events_chapter_start on public.run_events(chapter_id, starts_at);
drop trigger if exists run_events_touch on public.run_events;
create trigger run_events_touch before update on public.run_events for each row execute function public.run_touch();

create table if not exists public.run_event_registrations(
  event_id      uuid not null references public.run_events(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'going' check (status in ('going','cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  checked_in_at timestamptz,             -- Phase 4: QR check-in
  primary key (event_id, user_id));
drop trigger if exists run_er_touch on public.run_event_registrations;
create trigger run_er_touch before update on public.run_event_registrations for each row execute function public.run_touch();

-- ───────────────────────── achievements ─────────────────────────
-- Definitions live in the app (bilingual copy); the server decides who earned what.
create table if not exists public.run_user_achievements(
  user_id   uuid not null references auth.users(id) on delete cascade,
  code      text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  earned_at timestamptz not null default now(),
  primary key (user_id, code));

-- ═══════════════════════ RPCs ═══════════════════════

-- Enrol in a programme and lay its sessions on the runner's chosen weekdays.
-- Choosing fewer days than the plan expects stretches the plan; it never stacks sessions.
create or replace function public.run_enroll(p_program uuid, p_start date, p_weekdays smallint[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_enr uuid; v_tier text; v_status text; v_day date := p_start; v_seq int := 0; t record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_start < current_date - 1 or p_start > current_date + 60 then raise exception 'start date out of range' using errcode = '22023'; end if;
  if coalesce(cardinality(p_weekdays),0) = 0 then raise exception 'choose at least one day' using errcode = '22023'; end if;
  select tier, status into v_tier, v_status from public.run_programs where id = p_program;
  if v_status is distinct from 'published' then raise exception 'programme not available' using errcode = '22023'; end if;
  if not public.run_entitled(v_tier) then raise exception 'programme requires %', v_tier using errcode = '42501'; end if;

  update public.run_enrollments set status = 'stopped', ended_at = now() where user_id = v_uid and status = 'active';
  insert into public.run_enrollments(user_id, program_id, start_date, weekdays)
       values (v_uid, p_program, p_start, p_weekdays) returning id into v_enr;

  for t in select id from public.run_workout_templates where program_id = p_program order by week, session loop
    while not (extract(dow from v_day)::smallint = any(p_weekdays)) loop v_day := v_day + 1; end loop;
    v_seq := v_seq + 1;
    insert into public.run_scheduled_workouts(enrollment_id, user_id, template_id, seq, scheduled_date)
         values (v_enr, v_uid, t.id, v_seq, v_day);
    v_day := v_day + 1;
  end loop;
  if v_seq = 0 then raise exception 'programme has no workouts' using errcode = '22023'; end if;
  return v_enr;
end $$;

-- Move every unfinished session of the active plan forward from a date (missed a week, holiday).
create or replace function public.run_reschedule(p_from date)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_enr uuid; v_days smallint[]; v_day date := greatest(p_from, current_date); v_n int := 0; r record;
begin
  select id, weekdays into v_enr, v_days from public.run_enrollments where user_id = auth.uid() and status = 'active';
  if v_enr is null then return 0; end if;
  for r in select id from public.run_scheduled_workouts where enrollment_id = v_enr and status = 'planned' order by seq loop
    while not (extract(dow from v_day)::smallint = any(v_days)) loop v_day := v_day + 1; end loop;
    update public.run_scheduled_workouts set scheduled_date = v_day where id = r.id;
    v_day := v_day + 1; v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- RSVP with an atomic capacity check. Returns the new status.
create or replace function public.run_rsvp(p_event uuid, p_going boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); e record; v_taken int;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into e from public.run_events where id = p_event for update;
  if not found or e.status <> 'scheduled' then raise exception 'event not open' using errcode = '22023'; end if;
  if not p_going then
    update public.run_event_registrations set status = 'cancelled' where event_id = p_event and user_id = v_uid;
    return 'cancelled';
  end if;
  if e.starts_at + make_interval(mins => e.duration_min) < now() then raise exception 'event has finished' using errcode = '22023'; end if;
  if e.capacity is not null then
    select count(*) into v_taken from public.run_event_registrations
     where event_id = p_event and status = 'going' and user_id <> v_uid;
    if v_taken >= e.capacity then raise exception 'event is full' using errcode = 'P0001', hint = 'full'; end if;
  end if;
  insert into public.run_event_registrations(event_id, user_id, status) values (p_event, v_uid, 'going')
    on conflict (event_id, user_id) do update set status = 'going';
  -- joining a run joins the chapter
  insert into public.run_club_members(chapter_id, user_id) values (e.chapter_id, v_uid) on conflict do nothing;
  return 'going';
end $$;

-- Counts only: members can see how full a run is without seeing who is going.
create or replace function public.run_event_counts(p_events uuid[])
returns table(event_id uuid, going integer) language sql stable security definer set search_path = public as $$
  select r.event_id, count(*)::int from public.run_event_registrations r
   where r.event_id = any(p_events) and r.status = 'going' and auth.uid() is not null
   group by r.event_id
$$;

-- Award achievements from the caller's own records. Returns the codes newly earned.
create or replace function public.run_evaluate_achievements()
returns setof text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_codes text[] := '{}';
  n_runs int; max_m int; n_done int; n_rsvp int; wk_streak int; best_month numeric; plan_done boolean;
begin
  if v_uid is null then return; end if;
  select count(*), coalesce(max(distance_m),0) into n_runs, max_m from public.run_activities where user_id = v_uid;
  select count(*) into n_done from public.run_scheduled_workouts where user_id = v_uid and status = 'completed';
  select count(*) into n_rsvp from public.run_event_registrations r join public.run_events e on e.id = r.event_id
   where r.user_id = v_uid and r.status = 'going' and e.status = 'scheduled' and e.starts_at < now();
  select coalesce(max(km),0) into best_month from (
    select sum(distance_m)/1000.0 km from public.run_activities where user_id = v_uid
     group by date_trunc('month', started_at at time zone 'Asia/Kuala_Lumpur')) m;
  -- longest run of consecutive ISO weeks with at least one activity
  select coalesce(max(len),0) into wk_streak from (
    select count(*) len from (
      select wk, wk - (row_number() over (order by wk))::int * 7 grp from (
        select distinct (date_trunc('week', started_at at time zone 'Asia/Kuala_Lumpur'))::date wk
          from public.run_activities where user_id = v_uid) w) g group by grp) s;
  select exists(select 1 from public.run_enrollments en where en.user_id = v_uid
     and not exists(select 1 from public.run_scheduled_workouts sw where sw.enrollment_id = en.id and sw.status <> 'completed')
     and exists(select 1 from public.run_scheduled_workouts sw where sw.enrollment_id = en.id)) into plan_done;

  if n_runs >= 1       then v_codes := array_append(v_codes, 'first_run'); end if;
  if max_m >= 5000     then v_codes := array_append(v_codes, 'first_5k'); end if;
  if max_m >= 10000    then v_codes := array_append(v_codes, 'first_10k'); end if;
  if max_m >= 21097    then v_codes := array_append(v_codes, 'first_half'); end if;
  if n_done >= 1       then v_codes := array_append(v_codes, 'first_workout'); end if;
  if n_done >= 10      then v_codes := array_append(v_codes, 'workouts_10'); end if;
  if wk_streak >= 4    then v_codes := array_append(v_codes, 'consistency_4w'); end if;
  if n_rsvp >= 1       then v_codes := array_append(v_codes, 'first_club_run'); end if;
  if best_month >= 50  then v_codes := array_append(v_codes, 'month_50k'); end if;
  if best_month >= 100 then v_codes := array_append(v_codes, 'month_100k'); end if;
  if plan_done         then v_codes := array_append(v_codes, 'plan_complete'); end if;

  return query
    with ins as (insert into public.run_user_achievements(user_id, code)
                 select v_uid, c from unnest(v_codes) c
                 on conflict do nothing
                 returning run_user_achievements.code)
    select ins.code from ins;
end $$;

-- Erase everything HITFAT RUN holds for the caller. The shared HITFAT account itself stays.
create or replace function public.run_delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.run_user_achievements where user_id = v_uid;
  delete from public.run_event_registrations where user_id = v_uid;
  delete from public.run_club_members where user_id = v_uid;
  delete from public.run_scheduled_workouts where user_id = v_uid;
  delete from public.run_activities where user_id = v_uid;
  delete from public.run_enrollments where user_id = v_uid;
  delete from public.run_profiles where user_id = v_uid;
end $$;

-- ═══════════════════════ Row Level Security ═══════════════════════
alter table public.run_chapters            enable row level security;
alter table public.run_staff               enable row level security;
alter table public.run_profiles            enable row level security;
alter table public.run_programs            enable row level security;
alter table public.run_workout_templates   enable row level security;
alter table public.run_tier_skus           enable row level security;
alter table public.run_enrollments         enable row level security;
alter table public.run_scheduled_workouts  enable row level security;
alter table public.run_activities          enable row level security;
alter table public.run_club_members        enable row level security;
alter table public.run_events              enable row level security;
alter table public.run_event_registrations enable row level security;
alter table public.run_user_achievements   enable row level security;

do $$ declare p record; begin
  -- re-runnable: drop this migration's own policies before recreating them
  for p in select policyname, tablename from pg_policies where schemaname = 'public' and tablename like 'run\_%' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- chapters: anyone signed in can read; super admins manage
create policy run_chapters_read  on public.run_chapters for select to authenticated using (true);
create policy run_chapters_admin on public.run_chapters for all to authenticated using (public.run_is_super_admin()) with check (public.run_is_super_admin());

-- staff: you can see your own roles; super admins see and manage all
create policy run_staff_read  on public.run_staff for select to authenticated using (user_id = auth.uid() or public.run_is_super_admin());
create policy run_staff_admin on public.run_staff for all to authenticated using (public.run_is_super_admin()) with check (public.run_is_super_admin());

-- profiles: owner only (holds health-related answers). Coaches get nothing in Phase 1.
create policy run_profiles_own on public.run_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- programmes: published ones are listed to every member; coaches see drafts and author
create policy run_programs_read on public.run_programs for select to authenticated
  using (status = 'published' or public.run_has_role(array['head_coach','running_coach'], null));
create policy run_programs_write on public.run_programs for insert to authenticated
  with check (public.run_has_role(array['head_coach','running_coach'], null) and (status in ('draft','review') or public.run_has_role(array['head_coach'], null)));
create policy run_programs_update on public.run_programs for update to authenticated
  using (public.run_has_role(array['head_coach','running_coach'], null))
  with check (status in ('draft','review') or public.run_has_role(array['head_coach'], null));   -- only a head coach publishes

-- workout content: readable when the programme is published and the tier is owned
create policy run_wt_read on public.run_workout_templates for select to authenticated
  using (exists(select 1 from public.run_programs p where p.id = program_id
                 and ((p.status = 'published' and public.run_entitled(p.tier))
                      or public.run_has_role(array['head_coach','running_coach'], null))));
create policy run_wt_write on public.run_workout_templates for all to authenticated
  using (public.run_has_role(array['head_coach','running_coach'], null))
  with check (public.run_has_role(array['head_coach','running_coach'], null));

create policy run_tier_skus_read  on public.run_tier_skus for select to authenticated using (true);
create policy run_tier_skus_admin on public.run_tier_skus for all to authenticated using (public.run_is_super_admin()) with check (public.run_is_super_admin());

-- the runner's own plan, calendar, activities and achievements
create policy run_enr_own on public.run_enrollments for select to authenticated using (user_id = auth.uid());
create policy run_enr_upd on public.run_enrollments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- no insert policy: enrolment goes through run_enroll(), which checks the tier

create policy run_sw_own on public.run_scheduled_workouts for select to authenticated using (user_id = auth.uid());
create policy run_sw_upd on public.run_scheduled_workouts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy run_act_own on public.run_activities for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy run_ach_own on public.run_user_achievements for select to authenticated using (user_id = auth.uid());
-- no insert policy: only run_evaluate_achievements() awards

-- club membership: your own rows; staff see their chapter
create policy run_cm_read on public.run_club_members for select to authenticated
  using (user_id = auth.uid() or public.run_has_role(array['head_coach','running_coach','club_captain'], chapter_id));
create policy run_cm_join  on public.run_club_members for insert to authenticated with check (user_id = auth.uid());
create policy run_cm_leave on public.run_club_members for delete to authenticated using (user_id = auth.uid());

-- events: members read; captains and coaches of that chapter manage
create policy run_events_read on public.run_events for select to authenticated using (true);
create policy run_events_ins on public.run_events for insert to authenticated
  with check (public.run_has_role(array['head_coach','running_coach','club_captain'], chapter_id) and created_by = auth.uid());
create policy run_events_upd on public.run_events for update to authenticated
  using (public.run_has_role(array['head_coach','running_coach','club_captain'], chapter_id))
  with check (public.run_has_role(array['head_coach','running_coach','club_captain'], chapter_id));
create policy run_events_del on public.run_events for delete to authenticated
  using (public.run_has_role(array['head_coach','club_captain'], chapter_id));

-- registrations: your own; staff of that chapter see the list. Writes go through run_rsvp().
create policy run_er_read on public.run_event_registrations for select to authenticated
  using (user_id = auth.uid() or exists(select 1 from public.run_events e where e.id = event_id
          and public.run_has_role(array['head_coach','running_coach','club_captain'], e.chapter_id)));

-- nothing in HITFAT RUN is public: signed-out visitors get no table access at all
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'run\_%' loop
    execute format('revoke all on public.%I from anon', r.tablename);
  end loop;
end $$;

-- a runner may only end a plan, and only record results on a session
revoke update on public.run_enrollments from authenticated, anon;
grant update (status, ended_at) on public.run_enrollments to authenticated;
revoke update on public.run_scheduled_workouts from authenticated, anon;
grant update (status, completed_at, activity_id, rpe, feeling, feedback, scheduled_date) on public.run_scheduled_workouts to authenticated;

-- functions are callable by signed-in users only
revoke all on function public.run_enroll(uuid, date, smallint[]) from public, anon;
revoke all on function public.run_reschedule(date) from public, anon;
revoke all on function public.run_rsvp(uuid, boolean) from public, anon;
revoke all on function public.run_event_counts(uuid[]) from public, anon;
revoke all on function public.run_evaluate_achievements() from public, anon;
revoke all on function public.run_delete_my_data() from public, anon;
grant execute on function public.run_enroll(uuid, date, smallint[]), public.run_reschedule(date), public.run_rsvp(uuid, boolean),
  public.run_event_counts(uuid[]), public.run_evaluate_achievements(), public.run_delete_my_data() to authenticated;

-- seed the first chapter
insert into public.run_chapters(slug, name, state, city) values ('kelantan', 'HITFAT Run Club Kelantan', 'Kelantan', 'Kota Bharu')
  on conflict (slug) do nothing;

commit;
