// HITFAT — the app asks THIS for what a buyer owns, instead of SELECTing payments in the browser
// (that depended on RLS) — and it double-checks pending orders against Bayarcash itself, so a
// callback that never arrives or fails its checksum can no longer strand a real payment.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, BAYARCASH_TOKEN
const SITE = 'https://hybrid.hitfat.io';
const BC = 'https://api.console.bayar.cash/v3';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: 'not_configured' });
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  const q = event.queryStringParameters || {};

  // health view — counts and the newest rows, with no buyer identity in the response
  if (q.diag === '1') {
    const rows = await sb(SB_URL, h, 'payments?select=order_number,program_id,amount,status,created_at,paid_at&order=created_at.desc&limit=8');
    if (!Array.isArray(rows)) return json(502, { error: 'query_failed', detail: rows });
    const by = {};
    rows.forEach(x => { by[x.status] = (by[x.status] || 0) + 1; });
    return json(200, { shown: rows.length, by_status: by, rows });
  }

  // setup check: which portals exist, which channels each has, and which key we are configured to use
  if (q.portals === '1') {
    const TOKEN = process.env.BAYARCASH_TOKEN;
    if (!TOKEN) return json(500, { error: 'no_token' });
    const r = await fetch(BC + '/portals', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) return json(502, { error: 'http_' + r.status });
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d && d.data) || [];
    const inUse = process.env.BAYARCASH_PORTAL_KEY || '';
    return json(200, {
      configured_key_tail: inUse.slice(-6),
      portals: list.map(p => ({
        name: p.portal_name || p.name,
        key_tail: String(p.portal_key || '').slice(-6),
        is_configured: p.portal_key === inUse,
        matches_query: q.key ? p.portal_key === q.key : undefined,
        channels: (p.payment_channels || []).map(c => c.id + ':' + (c.name || c.code))
      }))
    });
  }

  // support/debug: what does Bayarcash itself say about one order?
  if (q.verify) {
    const v = await bcStatus(q.verify);
    if (v && v.paid) await markPaid(SB_URL, h, q.verify, v.tx);
    return json(200, { order_number: q.verify, bayarcash: v });
  }

  const user_id = q.user_id;
  if (!user_id) return json(400, { error: 'missing_user_id' });

  // any order still pending might simply have lost its callback — ask Bayarcash directly
  const pend = await sb(SB_URL, h, 'payments?select=order_number&status=eq.pending&user_id=eq.' + enc(user_id) + '&order=created_at.desc&limit=10');
  if (Array.isArray(pend)) {
    for (const row of pend) {
      const v = await bcStatus(row.order_number);
      if (v && v.paid) await markPaid(SB_URL, h, row.order_number, v.tx);
    }
  }

  const rows = await sb(SB_URL, h, 'payments?select=program_id&status=eq.paid&user_id=eq.' + enc(user_id));
  if (!Array.isArray(rows)) return json(502, { error: 'query_failed', detail: rows });
  return json(200, { programs: [...new Set(rows.map(x => x.program_id).filter(Boolean))] });
};

// 3 = Success (0 New · 1 Pending · 2 Failed · 4 Cancelled)
async function bcStatus(order_number) {
  const TOKEN = process.env.BAYARCASH_TOKEN;
  if (!TOKEN || !order_number) return null;
  try {
    const r = await fetch(BC + '/transactions?order_number=' + enc(order_number), {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }
    });
    if (!r.ok) return { error: 'http_' + r.status };
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d && d.data) || [];
    const hit = list.find(t => String(t.status) === '3' || String(t.status).toLowerCase() === 'success');
    return { found: list.length, paid: !!hit, tx: hit ? (hit.id || hit.transaction_id || null) : null, statuses: list.map(t => t.status) };
  } catch (e) { return { error: String(e && e.message) }; }
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
