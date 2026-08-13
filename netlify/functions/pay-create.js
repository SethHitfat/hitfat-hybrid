// HITFAT — create a Bayarcash payment intent (server-side so the access token never reaches the browser).
// Env: BAYARCASH_TOKEN (Personal Access Token), BAYARCASH_PORTAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
const API = 'https://api.console.bayar.cash/v3/payment-intents';
const SITE = 'https://hybrid.hitfat.io';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const PRICES = { 'first-timer': 19, 'race-8': 99, 'race-12': 149, 'road-kl': 199, 'foundation-13': 79 };
const CHANNELS = [1, 6];               // 1 = FPX Online Banking, 6 = DuitNow QR

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const TOKEN = process.env.BAYARCASH_TOKEN, PORTAL = process.env.BAYARCASH_PORTAL_KEY;
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!TOKEN || !PORTAL) return json(500, { error: 'not_configured' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) {}
  const { program_id, user_id, name, email } = b;
  const amount = PRICES[program_id];
  if (!amount || !user_id || !email) return json(400, { error: 'missing_fields' });
  // only channels this portal actually offers — anything else would fail at Bayarcash
  const channel = CHANNELS.indexOf(Number(b.channel)) > -1 ? Number(b.channel) : 1;

  // one order number per attempt — the callback uses it to find the row again
  const order_number = 'HF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  // record the attempt first, so a callback can never arrive for an unknown order
  if (SB_URL && SB_KEY) {
    const r = await fetch(SB_URL + '/rest/v1/payments', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ order_number, user_id, program_id, amount, status: 'pending' })
    });
    if (!r.ok) return json(500, { error: 'order_record_failed', detail: await r.text() });
  }

  // Ringgit with 2 decimals — Bayarcash responses and the existing BCL forms both use "199.00",
  // so sending a bare 19 risks being read as cents.
  const amt = Number(amount).toFixed(2);
  const payer_name = (name || 'HITFAT athlete').slice(0, 60);
  const intent = {
    payment_channel: channel,                  // 1 = FPX Online Banking · 6 = DuitNow QR
    portal_key: PORTAL,
    order_number,
    amount: amt,
    payer_name,
    payer_email: email,
    return_url: SITE + '/?paid=' + encodeURIComponent(program_id),
    callback_url: SITE + '/.netlify/functions/pay-callback',
    metadata: program_id
  };

  // optional but recommended: HMAC over payment_channel/order_number/amount/payer_name/payer_email,
  // sorted by key and joined with "|"
  const SECRET = process.env.BAYARCASH_SECRET;
  if (SECRET) {
    const parts = { payment_channel: channel, order_number, amount: amt, payer_name, payer_email: email };
    const payload = Object.keys(parts).sort().map(k => String(parts[k]).trim()).join('|');
    intent.checksum = require('crypto').createHmac('sha256', SECRET).update(payload).digest('hex');
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(intent)
    });
    const d = await res.json();
    if (!res.ok || !d || !d.url) return json(502, { error: 'intent_failed', detail: d });
    return json(200, { url: d.url, order_number });
  } catch (e) {
    return json(500, { error: 'exception', detail: String(e && e.message) });
  }
};

function json(code, obj) { return { statusCode: code, headers: CORS, body: JSON.stringify(obj) }; }
