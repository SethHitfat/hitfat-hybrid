// HITFAT — Bayarcash server-to-server callback. This is what makes unlocking trustworthy:
// the browser is never believed, only a payment Bayarcash itself confirms.
// The checksum is the fast path; if it doesn't match (extra payload fields, a changed recipe)
// we ask the Bayarcash API about the order instead of silently dropping a real payment.
// Env: BAYARCASH_SECRET (API secret key), BAYARCASH_TOKEN (PAT), SUPABASE_URL, SUPABASE_SERVICE_KEY
const crypto = require('crypto');
const BC = 'https://api.console.bayar.cash/v3';

// the documented checksum fields — sorted by key, trimmed, joined with "|"
const SUM_FIELDS = ['amount', 'currency', 'exchange_reference_number', 'exchange_transaction_id',
  'order_number', 'payer_bank_name', 'status', 'status_description', 'transaction_id'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method' };
  const SECRET = process.env.BAYARCASH_SECRET;
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;

  let p = {};
  try {
    p = event.headers['content-type'] && event.headers['content-type'].includes('json')
      ? JSON.parse(event.body || '{}')
      : Object.fromEntries(new URLSearchParams(event.body || ''));
  } catch (e) { return ok('bad_payload'); }         // always 200 so Bayarcash stops retrying a broken body

  const order = p.order_number && String(p.order_number).trim();
  if (!order) return ok('no_order');

  let trusted = false;
  if (SECRET && p.checksum) {
    const payload = SUM_FIELDS.filter(k => p[k] !== undefined && p[k] !== null)
      .sort().map(k => String(p[k]).trim()).join('|');
    const mine = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    trusted = mine === p.checksum;
  }

  let paid = trusted && String(p.status) === '3';   // 3 = Success
  let tx = p.transaction_id || null;

  // unsigned, or the signature didn't match what we computed — verify with Bayarcash instead
  if (!paid) {
    const v = await bcStatus(order);
    if (!v || !v.paid) return ok(trusted ? 'ignored' : 'unverified');
    paid = true; tx = v.tx || tx;
  }

  if (paid && SB_URL && SB_KEY) {
    const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
    // flip the pending row to paid — the app reads this to unlock, so the browser can't fake it
    await fetch(SB_URL + '/rest/v1/payments?order_number=eq.' + encodeURIComponent(order) + '&status=neq.paid', {
      method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, h),
      body: JSON.stringify({ status: 'paid', transaction_id: tx, paid_at: new Date().toISOString() })
    });
  }
  return ok('ok');
};

async function bcStatus(order_number) {
  const TOKEN = process.env.BAYARCASH_TOKEN;
  if (!TOKEN) return null;
  try {
    const r = await fetch(BC + '/transactions?order_number=' + encodeURIComponent(order_number), {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d && d.data) || [];
    const hit = list.find(t => String(t.status) === '3' || String(t.status).toLowerCase() === 'success');
    return { paid: !!hit, tx: hit ? (hit.id || hit.transaction_id || null) : null };
  } catch (e) { return null; }
}

function ok(msg) { return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: msg }; }
