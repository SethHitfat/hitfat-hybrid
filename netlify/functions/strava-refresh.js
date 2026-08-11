// HITFAT — Strava token refresh. The client POSTs its refresh_token; we exchange
// it for a fresh access_token using the server-side Client Secret and return the
// new tokens as JSON. Requires env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://hybrid.hitfat.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const CID = process.env.STRAVA_CLIENT_ID;
  const SECRET = process.env.STRAVA_CLIENT_SECRET;
  if (!CID || !SECRET) return json(500, { error: 'not_configured' });

  let refresh_token;
  try { refresh_token = JSON.parse(event.body || '{}').refresh_token; } catch (e) {}
  if (!refresh_token) return json(400, { error: 'missing_refresh_token' });

  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CID, client_secret: SECRET,
        grant_type: 'refresh_token', refresh_token: refresh_token
      })
    });
    const d = await res.json();
    if (!d || !d.access_token) return json(400, { error: 'refresh_failed' });
    return json(200, { a: d.access_token, r: d.refresh_token, e: d.expires_at });
  } catch (e) {
    return json(500, { error: 'exception' });
  }
};

function json(code, obj) { return { statusCode: code, headers: CORS, body: JSON.stringify(obj) }; }
