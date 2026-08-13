// HITFAT — Bayarcash server-to-server callback. This is what makes unlocking trustworthy:
// the browser is never believed, only a HMAC-verified payload from Bayarcash.
// Env: BAYARCASH_SECRET (API secret key), SUPABASE_URL, SUPABASE_SERVICE_KEY
const crypto = require('crypto');

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

  // verify: all fields except checksum, sorted by key, joined with "|", HMAC-SHA256 with the secret
  if (SECRET) {
    const { checksum, ...rest } = p;
    const payload = Object.keys(rest).sort().map(k => rest[k]).join('|');
    const mine = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (!checksum || mine !== checksum) return ok('bad_checksum');   // ignore spoofed calls
  }

  const paid = String(p.status) === '3';                              // 3 = Success
  if (!paid || !p.order_number) return ok('ignored');

  if (SB_URL && SB_KEY) {
    const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
    // flip the pending row to paid — the app reads this to unlock, so the browser can't fake it
    await fetch(SB_URL + '/rest/v1/payments?order_number=eq.' + encodeURIComponent(p.order_number), {
      method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, h),
      body: JSON.stringify({
        status: 'paid',
        transaction_id: p.transaction_id || null,
        paid_at: new Date().toISOString()
      })
    });
  }
  return ok('ok');
};

function ok(msg) { return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: msg }; }
