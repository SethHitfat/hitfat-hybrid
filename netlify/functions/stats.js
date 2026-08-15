// HITFAT — analytics read API for the /stats dashboard.
//
// The events table is INSERT-only from the browser (that is what makes counting
// anonymous visitors safe), so reads have to happen here, where the service role
// bypasses RLS. Because this returns business data, it is gated twice:
//   1. the caller must present a real Supabase access token, verified against
//      Supabase itself — not merely decoded here, so a forged JWT cannot pass;
//   2. that token's email must appear in ADMIN_EMAILS.
// If ADMIN_EMAILS is missing the endpoint denies everyone. Failing closed matters
// more than being convenient: an open version of this leaks the whole funnel.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_EMAILS (comma-separated)
const SITE = 'https://hybrid.hitfat.io';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const PAGE = 1000;        // PostgREST caps a single response; page through instead
const MAX_PAGES = 50;     // 50k events — far beyond current volume, but bounded

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!SB_URL || !SB_KEY) return json(500, { error: 'not_configured' });
  if (!ADMINS.length) return json(500, { error: 'no_admins_configured' });

  // ---- who is asking ----
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'no_token' });

  let email = '';
  try {
    const u = await fetch(SB_URL + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token }
    });
    if (!u.ok) return json(401, { error: 'bad_token' });
    email = String(((await u.json()) || {}).email || '').toLowerCase();
  } catch (e) { return json(401, { error: 'bad_token' }); }

  if (!email || ADMINS.indexOf(email) === -1) return json(403, { error: 'not_admin' });

  // ---- pull the window ----
  const days = Math.min(Math.max(parseInt((event.queryStringParameters || {}).days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };

  let rows = [];
  try {
    for (let p = 0; p < MAX_PAGES; p++) {
      const url = SB_URL + '/rest/v1/events?select=ts,name,props,session_id,user_id,ref'
                + '&ts=gte.' + encodeURIComponent(since) + '&order=ts.asc'
                + '&offset=' + (p * PAGE) + '&limit=' + PAGE;
      const r = await fetch(url, { headers: h });
      if (!r.ok) return json(500, { error: 'query_failed', detail: await r.text() });
      const batch = await r.json();
      rows = rows.concat(batch);
      if (batch.length < PAGE) break;
    }
  } catch (e) { return json(500, { error: 'query_failed', detail: String(e) }); }

  // ---- aggregate ----
  const uniq = (arr) => Array.from(new Set(arr)).length;
  const of = (n) => rows.filter(r => r.name === n);
  const day = (ts) => String(ts).slice(0, 10);

  // daily: sessions + opens + how many of those sessions were signed in
  const byDay = {};
  rows.forEach(r => {
    const d = day(r.ts);
    (byDay[d] = byDay[d] || { day: d, sessions: new Set(), opens: 0, users: new Set() });
    byDay[d].sessions.add(r.session_id);
    if (r.name === 'app_open') byDay[d].opens++;
    if (r.user_id) byDay[d].users.add(r.user_id);
  });
  const daily = Object.values(byDay)
    .map(d => ({ day: d.day, sessions: d.sessions.size, opens: d.opens, users: d.users.size }))
    .sort((a, b) => a.day < b.day ? -1 : 1);

  // funnel — sessions reaching each step, so one person clicking twice counts once
  const FUNNEL = ['app_open', 'program_view', 'checkout_start', 'program_unlocked'];
  const funnel = FUNNEL.map(n => ({ step: n, sessions: uniq(of(n).map(r => r.session_id)), events: of(n).length }));

  // per-program: views vs checkouts vs actual unlocks
  const prog = {};
  ['program_view', 'checkout_start', 'program_unlocked'].forEach(n => of(n).forEach(r => {
    const id = (r.props || {}).id; if (!id) return;
    (prog[id] = prog[id] || { id, views: 0, checkouts: 0, unlocked: 0 });
    if (n === 'program_view') prog[id].views++;
    else if (n === 'checkout_start') prog[id].checkouts++;
    else prog[id].unlocked++;
  }));
  const programs = Object.values(prog).sort((a, b) => b.views - a.views);

  const tally = (list, key) => {
    const m = {};
    list.forEach(r => { const k = (r.props || {})[key]; if (k) m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count);
  };

  const refs = {};
  of('app_open').forEach(r => {
    let k = '(direct)';
    if (r.ref) { try { k = new URL(r.ref).hostname.replace(/^www\./, ''); } catch (e) { k = r.ref; } }
    if (k === 'hybrid.hitfat.io') k = '(internal)';
    refs[k] = (refs[k] || 0) + 1;
  });

  return json(200, {
    ok: true, days, generated_at: new Date().toISOString(),
    truncated: rows.length >= PAGE * MAX_PAGES,
    totals: {
      events: rows.length,
      sessions: uniq(rows.map(r => r.session_id)),
      signed_in_users: uniq(rows.filter(r => r.user_id).map(r => r.user_id)),
      signin_attempts: of('signin_start').length,
      blocked_checkouts: of('checkout_blocked_signin').length
    },
    daily, funnel, programs,
    quick_workouts: tally(of('quick_workout'), 'title'),
    tabs: tally(of('tab'), 'tab'),
    referrers: Object.entries(refs).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count)
  });
};

function json(statusCode, body) { return { statusCode, headers: CORS, body: JSON.stringify(body) }; }
