// HITFAT — Strava OAuth callback. Exchanges the ?code for tokens using the
// server-side Client Secret, then redirects back to the app with the tokens in
// the URL fragment (never sent to a server). The OAuth `state` the app sent to Strava is
// passed back in that fragment untouched; the app only accepts tokens whose state matches
// the one it stored before leaving, so a crafted link cannot plant someone else's account.
// Requires Netlify env vars:
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
const APP = 'https://hybrid.hitfat.io';

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const CID = process.env.STRAVA_CLIENT_ID;
  const SECRET = process.env.STRAVA_CLIENT_SECRET;

  if (q.error) return redirect(APP + '/?strava=denied');          // user cancelled on Strava
  if (!q.code) return redirect(APP + '/?strava=error');
  if (!CID || !SECRET) return redirect(APP + '/?strava=notconfigured');
  // the app generates 32 hex chars; without a state the app would refuse the tokens anyway,
  // so don't spend the code on an exchange nobody can use
  const state = /^[A-Za-z0-9_-]{8,128}$/.test(q.state || '') ? q.state : '';
  if (!state) return redirect(APP + '/?strava=error');

  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CID, client_secret: SECRET,
        code: q.code, grant_type: 'authorization_code'
      })
    });
    const d = await res.json();
    if (!d || !d.access_token) return redirect(APP + '/?strava=error');

    const name = d.athlete
      ? ((d.athlete.firstname || '') + ' ' + (d.athlete.lastname || '')).trim()
      : '';
    const payload = encodeURIComponent(JSON.stringify({
      a: d.access_token, r: d.refresh_token, e: d.expires_at,
      n: name || 'Strava', id: d.athlete && d.athlete.id, s: state
    }));
    return redirect(APP + '/#strava=' + payload);
  } catch (e) {
    return redirect(APP + '/?strava=error');
  }
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
}
