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

  // ---- money + customers ----
  // Revenue comes from `payments`, never from events: an event only says someone
  // opened a checkout, while a payments row is written by pay-create and only
  // flipped to 'paid' by the verified Bayarcash callback.
  let pays = [], users = [], udata = [];
  try { pays  = await pageAll(SB_URL + '/rest/v1/payments?select=*&order=id.desc', h); } catch (e) {}
  try { udata = await pageAll(SB_URL + '/rest/v1/user_data?select=user_id,updated_at', h); } catch (e) {}
  try {
    for (let p = 1; p <= 10; p++) {
      const r = await fetch(SB_URL + '/auth/v1/admin/users?page=' + p + '&per_page=200', { headers: h });
      if (!r.ok) break;
      const b = await r.json();
      const batch = Array.isArray(b) ? b : (b.users || []);
      users = users.concat(batch);
      if (batch.length < 200) break;
    }
  } catch (e) {}

  const num = (v) => Number(v || 0) || 0;
  const when = (p) => p.paid_at || p.created_at || p.inserted_at || null;
  const paid = pays.filter(p => p.status === 'paid');
  const pending = pays.filter(p => p.status !== 'paid');
  const inWindow = (p) => { const w = when(p); return w && w >= since; };
  // a pending row older than a day means the buyer left, or a callback never landed
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const stale = pending.filter(p => { const w = when(p); return !w || w < dayAgo; });

  const byProg = {};
  paid.forEach(p => {
    const id = p.program_id || '(unknown)';
    (byProg[id] = byProg[id] || { id, orders: 0, revenue: 0 });
    byProg[id].orders++; byProg[id].revenue += num(p.amount);
  });

  const lastSync = {};
  udata.forEach(u => { if (u.user_id) lastSync[u.user_id] = u.updated_at; });

  const spend = {};
  paid.forEach(p => {
    if (!p.user_id) return;
    (spend[p.user_id] = spend[p.user_id] || { orders: 0, total: 0, programs: [] });
    spend[p.user_id].orders++; spend[p.user_id].total += num(p.amount);
    if (p.program_id && spend[p.user_id].programs.indexOf(p.program_id) === -1) spend[p.user_id].programs.push(p.program_id);
  });

  const customers = users.map(u => {
    const s = spend[u.id] || { orders: 0, total: 0, programs: [] };
    return {
      email: u.email || '(no email)',
      joined: (u.created_at || '').slice(0, 10),
      last_seen: (u.last_sign_in_at || lastSync[u.id] || '').slice(0, 10),
      orders: s.orders, spent: s.total, programs: s.programs
    };
  }).sort((a, b) => b.spent - a.spent || (a.joined < b.joined ? 1 : -1));

  const sum = (arr) => arr.reduce((t, p) => t + num(p.amount), 0);

  return json(200, {
    ok: true, days, generated_at: new Date().toISOString(),
    sales: {
      revenue_total: sum(paid),
      orders_total: paid.length,
      revenue_window: sum(paid.filter(inWindow)),
      orders_window: paid.filter(inWindow).length,
      avg_order: paid.length ? sum(paid) / paid.length : 0,
      pending: pending.length,
      stale_pending: stale.length,
      by_program: Object.values(byProg).sort((a, b) => b.revenue - a.revenue),
      recent: pays.slice(0, 20).map(p => ({
        order: p.order_number || '', program: p.program_id || '', amount: num(p.amount),
        status: p.status || '', when: (when(p) || '').replace('T', ' ').slice(0, 16)
      }))
    },
    customers: { total: users.length, paying: Object.keys(spend).length, list: customers.slice(0, 100) },
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

// PostgREST caps a single response, so walk the pages. Used for payments/user_data,
// where selecting * keeps this working even if a column is later added or renamed.
async function pageAll(baseUrl, headers) {
  let out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const url = baseUrl + (baseUrl.indexOf('?') > -1 ? '&' : '?') + 'offset=' + (p * PAGE) + '&limit=' + PAGE;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(await r.text());
    const batch = await r.json();
    out = out.concat(batch);
    if (batch.length < PAGE) break;
  }
  return out;
}
