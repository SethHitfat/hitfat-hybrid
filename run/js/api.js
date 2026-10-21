// Every Supabase call the app makes lives here, so the screens never build
// queries themselves and every rule about data stays in one place.
const SUPA_URL = 'https://auth.hitfat.io';                         // shared with HITFAT Hybrid
const SUPA_KEY = 'sb_publishable_6tKH033Hb74EV7QlKBCFFA_5K_Lsxgv';  // publishable key, safe in the client

export const sb = window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;
export const session = { user: null };

const must = ({ data, error }) => { if (error) throw error; return data; };
const uid = () => { if (!session.user) throw new Error('not signed in'); return session.user.id; };

/* Read cache: the last good answer to each read is kept on the device and
   used only when the network fails, so training stays readable offline.
   Auth or permission errors are never papered over. */
const CACHE = 'hfrun_c_';
export const isNetErr = e => !navigator.onLine || /Failed to fetch|NetworkError|network|Load failed/i.test((e && e.message) || '');
async function cached(key, fn) {
  const k = CACHE + uid() + '_' + key;
  try { const v = await fn(); try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return v; }
  catch (e) { if (isNetErr(e)) { const c = localStorage.getItem(k); if (c != null) return JSON.parse(c); } throw e; }
}
export function clearCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
}

/* ───────── auth ───────── */
export const authRedirect = () => location.origin + '/run/';
export const signInGoogle = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirect() } });
export const signInEmail = (email, password) => sb.auth.signInWithPassword({ email, password });
export const signUpEmail = (email, password, name) => sb.auth.signUp({ email, password, options: { emailRedirectTo: authRedirect(), data: { full_name: name } } });
export const resetPassword = email => sb.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
export const signOut = () => { clearCache(); return sb.auth.signOut(); };

/* ───────── runner profile & roles ───────── */
export async function getProfile() {
  return cached('profile', async () => must(await sb.from('run_profiles').select('*').eq('user_id', uid()).maybeSingle()));
}
export async function saveProfile(patch) {
  return must(await sb.from('run_profiles').upsert({ ...patch, user_id: uid() }, { onConflict: 'user_id' }).select().single());
}
/** Display name: the runner's own choice, else the shared HITFAT profile, else the e-mail. */
export async function sharedName() {
  const { data } = await sb.from('profiles').select('display_name,name').eq('id', uid()).maybeSingle();
  const m = session.user.user_metadata || {};
  return (data && (data.display_name || data.name)) || m.full_name || m.name || (session.user.email || '').split('@')[0];
}
export async function myRoles() {
  return must(await sb.from('run_staff').select('role,chapter_id').eq('user_id', uid()));
}
export async function isSuperAdmin() { return must(await sb.rpc('run_is_super_admin')); }

/* ───────── programmes ───────── */
export async function listPrograms() {
  return cached('programs', async () => must(await sb.from('run_programs').select('id,slug,i18n,goal,level,weeks,sessions_per_week,target_distance_m,tier,status,sort').order('sort')));
}
export const getProgram = slug => cached('program_' + slug, async () => {
  const p = must(await sb.from('run_programs').select('*').eq('slug', slug).maybeSingle());
  if (!p) return null;
  p.workouts = must(await sb.from('run_workout_templates').select('*').eq('program_id', p.id).order('week').order('session'));
  return p;
});
export async function setProgramStatus(id, status) {
  const patch = { status, ...(status === 'published' ? { published_at: new Date().toISOString(), reviewed_by: uid() } : {}) };
  return must(await sb.from('run_programs').update(patch).eq('id', id).select().single());
}

/* ───────── plan & calendar ───────── */
export async function enroll(programId, startYmd, weekdays) {
  return must(await sb.rpc('run_enroll', { p_program: programId, p_start: startYmd, p_weekdays: weekdays }));
}
export const activePlan = () => cached('plan', async () => {
  const enr = must(await sb.from('run_enrollments').select('*, program:run_programs(id,slug,i18n,weeks,sessions_per_week,target_distance_m,goal)')
    .eq('user_id', uid()).eq('status', 'active').maybeSingle());
  if (!enr) return null;
  enr.sessions = must(await sb.from('run_scheduled_workouts')
    .select('*, template:run_workout_templates(id,week,session,category,i18n,duration_min,distance_m,intensity,rpe_min,rpe_max,steps)')
    .eq('enrollment_id', enr.id).order('seq'));
  return enr;
});
export async function getSession(id) {
  return cached('session_' + id, async () => must(await sb.from('run_scheduled_workouts')
    .select('*, template:run_workout_templates(*), enrollment:run_enrollments(id,status,program:run_programs(slug,i18n,weeks))')
    .eq('id', id).maybeSingle()));
}
export async function updateSession(id, patch) {
  return must(await sb.from('run_scheduled_workouts').update(patch).eq('id', id).select().single());
}
export async function reschedule(fromYmd) { return must(await sb.rpc('run_reschedule', { p_from: fromYmd })); }
export async function stopPlan(id) {
  return must(await sb.from('run_enrollments').update({ status: 'stopped', ended_at: new Date().toISOString() }).eq('id', id));
}
export async function completePlan(id) {
  return must(await sb.from('run_enrollments').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', id));
}

/* ───────── activities (with an offline outbox) ─────────
   The id is made on the device, so a submit that is retried after a lost
   connection is an upsert of the same row, never a second run. */
const OUTBOX = 'hfrun_outbox';
const readBox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch (e) { return []; } };
const writeBox = b => { try { localStorage.setItem(OUTBOX, JSON.stringify(b)); } catch (e) {} };
export const pendingCount = () => readBox().filter(x => !session.user || x.user_id === session.user.id).length;

export async function saveActivity(act, link) {
  const row = { ...act, user_id: uid() };
  try {
    const saved = must(await sb.from('run_activities').upsert(row, { onConflict: 'id' }).select().single());
    if (link) await updateSession(link.id, { ...link.patch, activity_id: saved.id });
    return { saved, queued: false };
  } catch (e) {
    if (navigator.onLine && !/fetch|network|Failed/i.test(e.message || '')) throw e;   // a real validation error: show it
    writeBox([...readBox().filter(x => x.row.id !== row.id), { row, link, user_id: row.user_id }]);
    return { saved: row, queued: true };
  }
}
export async function flushOutbox() {
  if (!session.user || !navigator.onLine) return 0;
  let sent = 0; const left = [];
  for (const item of readBox()) {
    if (item.user_id !== session.user.id) { left.push(item); continue; }
    try {
      must(await sb.from('run_activities').upsert(item.row, { onConflict: 'id' }));
      if (item.link) await updateSession(item.link.id, { ...item.link.patch, activity_id: item.row.id });
      sent++;
    } catch (e) { left.push(item); }
  }
  writeBox(left); return sent;
}
/** The runner's latest 1000 runs (one cached copy serves every screen), plus any still in the outbox. */
export async function listActivities({ since, limit = 200 } = {}) {
  const all = await cached('acts', async () => must(await sb.from('run_activities')
    .select('id,source,started_at,distance_m,moving_time_s,elapsed_time_s,avg_pace_s_km,rpe,avg_hr,workout_type,title,notes,scheduled_workout_id')
    .eq('user_id', uid()).order('started_at', { ascending: false }).limit(1000)));
  const queued = readBox().filter(x => x.user_id === uid()).map(x => ({ ...x.row, queued: true, avg_pace_s_km: Math.round(x.row.moving_time_s * 1000 / x.row.distance_m) }));
  return [...queued.filter(q => !all.some(r => r.id === q.id)), ...all]
    .filter(a => !since || Date.parse(a.started_at) >= new Date(since).getTime())
    .sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit);
}
export const getActivity = id => cached('act_' + id, async () => must(await sb.from('run_activities').select('*').eq('id', id).maybeSingle()));
export async function deleteActivity(id) {
  writeBox(readBox().filter(x => x.row.id !== id));
  must(await sb.from('run_activities').delete().eq('id', id));
}
/** Same day and within 3 % of the distance: probably logged already. */
export async function findDuplicate(startedAt, distanceM, ignoreId) {
  const d = new Date(startedAt), from = new Date(d.getFullYear(), d.getMonth(), d.getDate()), to = new Date(from.getTime() + 864e5);
  const rows = must(await sb.from('run_activities').select('id,started_at,distance_m,moving_time_s').eq('user_id', uid())
    .gte('started_at', from.toISOString()).lt('started_at', to.toISOString()));
  return rows.find(r => r.id !== ignoreId && Math.abs(r.distance_m - distanceM) <= distanceM * 0.03) || null;
}

/* ───────── achievements ───────── */
export async function evaluateAchievements() {
  try { return (must(await sb.rpc('run_evaluate_achievements')) || []).map(r => typeof r === 'string' ? r : r.run_evaluate_achievements); }
  catch (e) { console.warn('achievements', e); return []; }
}
export async function listAchievements() {
  return cached('badges', async () => must(await sb.from('run_user_achievements').select('code,earned_at').eq('user_id', uid()).order('earned_at')));
}

/* ───────── club ───────── */
export const listChapters = () => cached('chapters', async () => must(await sb.from('run_chapters').select('*').eq('is_active', true).order('name')));
export const myChapters = () => cached('mychapters', async () => must(await sb.from('run_club_members').select('chapter_id,joined_at').eq('user_id', uid())));
export async function joinChapter(id) { must(await sb.from('run_club_members').upsert({ chapter_id: id, user_id: uid() }, { onConflict: 'chapter_id,user_id', ignoreDuplicates: true })); }
export async function leaveChapter(id) { must(await sb.from('run_club_members').delete().eq('chapter_id', id).eq('user_id', uid())); }

export const listEvents = (o = {}) => cached('events_' + JSON.stringify(o), () => listEventsLive(o));
async function listEventsLive({ chapterId, upcoming = true, limit = 30 } = {}) {
  let q = sb.from('run_events').select('*, chapter:run_chapters(slug,name)').limit(limit);
  if (chapterId) q = q.eq('chapter_id', chapterId);
  // an event stays "upcoming" until it has finished, so runners can still find it on the day
  q = upcoming ? q.gte('starts_at', new Date(Date.now() - 6 * 36e5).toISOString()).order('starts_at') : q.lt('starts_at', new Date().toISOString()).order('starts_at', { ascending: false });
  return must(await q);
}
export const getEvent = id => cached('event_' + id, async () => must(await sb.from('run_events').select('*, chapter:run_chapters(slug,name)').eq('id', id).maybeSingle()));
export async function eventCounts(ids) {
  if (!ids.length) return {};
  const rows = await cached('counts_' + ids.join(','), async () => must(await sb.rpc('run_event_counts', { p_events: ids })));
  return Object.fromEntries((rows || []).map(r => [r.event_id, r.going]));
}
export async function myRegistrations(ids) {
  let q = sb.from('run_event_registrations').select('event_id,status,created_at,checked_in_at').eq('user_id', uid());
  if (ids) q = q.in('event_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  return cached('regs_' + (ids || []).join(','), async () => must(await q));
}
export async function myRunHistory() {
  return cached('runhist', async () => must(await sb.from('run_event_registrations').select('status,created_at,checked_in_at, event:run_events(id,title,starts_at,meeting_point,status)')
    .eq('user_id', uid()).eq('status', 'going')));
}
export async function rsvp(eventId, going) { return must(await sb.rpc('run_rsvp', { p_event: eventId, p_going: going })); }
export async function createEvent(ev) { return must(await sb.from('run_events').insert({ ...ev, created_by: uid() }).select().single()); }
export async function updateEvent(id, patch) { return must(await sb.from('run_events').update(patch).eq('id', id).select().single()); }
/** Staff only (RLS): who is going, with names from the shared HITFAT profile. */
export async function guestList(eventId) {
  const regs = must(await sb.from('run_event_registrations').select('user_id,status,created_at').eq('event_id', eventId).eq('status', 'going').order('created_at'));
  if (!regs.length) return [];
  const profs = must(await sb.from('profiles').select('id,display_name,name').in('id', regs.map(r => r.user_id)));
  const names = Object.fromEntries(profs.map(p => [p.id, p.display_name || p.name]));
  return regs.map(r => ({ ...r, name: names[r.user_id] || '—' }));
}

/* ───────── privacy ───────── */
export async function deleteMyRunData() {
  must(await sb.rpc('run_delete_my_data'));
  writeBox(readBox().filter(x => x.user_id !== uid())); clearCache();
}
