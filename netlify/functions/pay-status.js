// HITFAT — the app asks THIS for what a buyer owns, instead of SELECTing payments in the browser
// (that depended on RLS) — and it double-checks pending orders against Bayarcash itself, so a
// callback that never arrives or fails its checksum can no longer strand a real payment.
// The caller must present their own Supabase access token: purchases are answered for the
// user that token belongs to, never for a user_id named in the URL.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, BAYARCASH_TOKEN
const SITE = 'https://hybrid.hitfat.io';
const BC = 'https://api.console.bayar.cash/v3';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: 'not_configured' });
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  const q = event.queryStringParameters || {};

  // support/debug: what does Bayarcash itself say about one order?
  if (q.verify) {
    const row = await sb(SB_URL, h, 'payments?select=amount&order_number=eq.' + enc(q.verify) + '&limit=1');
    const v = await bcStatus(q.verify, Array.isArray(row) && row[0] ? row[0].amount : null);
    if (v && v.paid) await markPaid(SB_URL, h, q.verify, v.tx);
    return json(200, { order_number: q.verify, bayarcash: v });
  }

  // who is asking — verified against Supabase itself (same as stats.js), so a forged JWT cannot pass.
  // Any ?user_id= in the URL is ignored: it used to let anyone read anyone's purchases.
  const user_id = await userFromToken(SB_URL, SB_KEY, event.headers || {});
  if (!user_id) return json(401, { error: 'no_session' });

  // any order still pending might simply have lost its callback — ask Bayarcash directly
  const pend = await sb(SB_URL, h, 'payments?select=order_number,amount&status=eq.pending&user_id=eq.' + enc(user_id) + '&order=created_at.desc&limit=10');
  if (Array.isArray(pend)) {
    for (const row of pend) {
      const v = await bcStatus(row.order_number, row.amount);
      if (v && v.paid) await markPaid(SB_URL, h, row.order_number, v.tx);
    }
  }

  const rows = await sb(SB_URL, h, 'payments?select=program_id&status=eq.paid&user_id=eq.' + enc(user_id));
  if (!Array.isArray(rows)) return json(502, { error: 'query_failed', detail: rows });
  return json(200, { programs: [...new Set(rows.map(x => x.program_id).filter(Boolean))] });
};

// 3 = Success (0 New · 1 Pending · 2 Failed · 4 Cancelled)
// A success only counts if it is for THIS order and paid at least the order's amount. The response
// shape isn't documented, so a field that is missing is not held against the buyer — only a field
// that is present and disagrees.
async function bcStatus(order_number, expected) {
  const TOKEN = process.env.BAYARCASH_TOKEN;
  if (!TOKEN || !order_number) return null;
  try {
    const r = await fetch(BC + '/transactions?order_number=' + enc(order_number), {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }
    });
    if (!r.ok) return { error: 'http_' + r.status };
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d && d.data) || [];
    const hit = list.find(t => (String(t.status) === '3' || String(t.status).toLowerCase() === 'success')
      && sameOrder(t, order_number) && enoughPaid(t.amount, expected));
    return { found: list.length, paid: !!hit, tx: hit ? (hit.id || hit.transaction_id || null) : null, statuses: list.map(t => t.status) };
  } catch (e) { return { error: String(e && e.message) }; }
}

function sameOrder(t, order_number) {
  return t.order_number === undefined || t.order_number === null || String(t.order_number).trim() === String(order_number);
}
function enoughPaid(paid, expected) {
  const want = money(expected), got = money(paid);
  if (want === null || got === null) return true;          // unknown on either side — don't strand a real buyer
  return got + 0.005 >= want;
}
function money(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

async function userFromToken(SB_URL, SB_KEY, headers) {
  const token = String(headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token } });
    if (!u.ok) return null;
    return ((await u.json()) || {}).id || null;
  } catch (e) { return null; }
}

async function markPaid(SB_URL, h, order_number, tx) {
  await fetch(SB_URL + '/rest/v1/payments?order_number=eq.' + enc(order_number) + '&status=neq.paid', {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, h),
    body: JSON.stringify({ status: 'paid', transaction_id: tx || null, paid_at: new Date().toISOString() })
  });
}

async function sb(SB_URL, h, path) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, { headers: h });
  return r.json();
}
function enc(s) { return encodeURIComponent(s); }
function json(code, obj) { return { statusCode: code, headers: CORS, body: JSON.stringify(obj) }; }
