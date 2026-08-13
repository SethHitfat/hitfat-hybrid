// HITFAT — read a buyer's confirmed purchases with the service key, so unlocking never
// depends on the browser being allowed to SELECT the payments table (RLS policies, key type).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
const SITE = 'https://hybrid.hitfat.io';
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
    const r = await fetch(SB_URL + '/rest/v1/payments?select=order_number,program_id,amount,status,created_at,paid_at&order=created_at.desc&limit=8', { headers: h });
    const rows = await r.json();
    if (!Array.isArray(rows)) return json(502, { error: 'query_failed', detail: rows });
    const by = {};
    rows.forEach(x => { by[x.status] = (by[x.status] || 0) + 1; });
    return json(200, { shown: rows.length, by_status: by, rows });
  }

  const user_id = q.user_id;
  if (!user_id) return json(400, { error: 'missing_user_id' });
  const r = await fetch(SB_URL + '/rest/v1/payments?select=program_id&status=eq.paid&user_id=eq.' + encodeURIComponent(user_id), { headers: h });
  const rows = await r.json();
  if (!Array.isArray(rows)) return json(502, { error: 'query_failed', detail: rows });
  return json(200, { programs: [...new Set(rows.map(x => x.program_id).filter(Boolean))] });
};

function json(code, obj) { return { statusCode: code, headers: CORS, body: JSON.stringify(obj) }; }
