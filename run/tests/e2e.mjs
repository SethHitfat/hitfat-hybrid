// End-to-end test of the Phase 1 journey against a real Postgres + PostgREST,
// with the real migrations and RLS. Only Supabase Auth is stood in for: a
// small handler that signs JWTs the same way, so every query runs as the
// signed-in user exactly as in production.
//
//   PGHOST=/tmp PGPORT=55432 PGUSER=postgres POSTGREST=/path/to/postgrest \
//   PLAYWRIGHT=/path/to/playwright node run/tests/e2e.mjs
//
// Screenshots land in $SHOTS (default: run/tests/shots, git-ignored).
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), RUN = join(HERE, '..'), SITE = join(RUN, '..');
const DB = 'hitfat_run_e2e', SECRET = 'e2e-secret-at-least-thirty-two-characters!!', REST_PORT = 31000 + Math.floor(Math.random() * 2000);
const ORIGIN = 'http://127.0.0.1:8799', SUPA = 'https://auth.hitfat.io';
const SHOTS = process.env.SHOTS || join(HERE, 'shots'); mkdirSync(SHOTS, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT || 'playwright'), { chromium } = pw.default || pw;

/* ───────── database ───────── */
const psql = (sql, db = DB) => execFileSync('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' }).trim();
const psqlFile = f => execFileSync('psql', ['-qX', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', f], { stdio: ['ignore', 'ignore', 'pipe'] });
psql(`drop database if exists ${DB} with (force)`, 'postgres'); psql(`create database ${DB}`, 'postgres');
for (const f of ['db/tests/supabase_stub.sql', 'db/001_run_club_phase1.sql', 'db/002_seed_programs.sql']) psqlFile(join(RUN, f));
psql(`grant usage on schema public to anon, authenticated; grant select on all tables in schema public to authenticated;`);

const users = new Map();   // email → { id, password, meta }
function addUser(email, password, name, extraSql = '') {
  const id = randomUUID();
  psql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${email}','{"full_name":"${name}"}'); ${extraSql.replaceAll(':id', `'${id}'`)}`);
  users.set(email, { id, password, meta: { full_name: name } }); return id;
}
const onboarded = `insert into run_profiles(user_id, goal, level, onboarded_at) values (:id, 'fitness', 'intermediate', now());`;
addUser('devi.coach@test.my', 'coach-pass-1', 'Coach Devi', onboarded + ` insert into run_staff(user_id, role) values (:id, 'head_coach');`);
addUser('chong.captain@test.my', 'captain-pass-1', 'Kapten Chong', onboarded + ` insert into run_staff(user_id, role, chapter_id) select :id, 'club_captain', id from run_chapters where slug = 'kelantan';`);

/* ───────── PostgREST ───────── */
const rest = spawn(process.env.POSTGREST || 'postgrest', [], { env: { ...process.env,
  PGRST_DB_URI: `postgres://authenticator@/${DB}?host=${process.env.PGHOST || '/tmp'}&port=${process.env.PGPORT || 5432}`,
  PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(REST_PORT), PGRST_LOG_LEVEL: 'error' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 75; i++) { try { if ((await fetch(`http://127.0.0.1:${REST_PORT}/`)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }

/* ───────── auth stand-in ───────── */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(user) {
  const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp: now + 3600, iat: now });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const userJson = (email, u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email, user_metadata: u.meta, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() });
const sessionJson = (email, u) => ({ access_token: jwt({ ...u, email }), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: userJson(email, u) });
async function authRoute(route) {
  const req = route.request(), url = new URL(req.url()), body = req.postData() ? JSON.parse(req.postData()) : {};
  const json = (status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const p = url.pathname.replace('/auth/v1', '');
  if (p === '/signup') {
    if (users.has(body.email)) return json(422, { code: 422, msg: 'User already registered' });
    addUser(body.email, body.password, body.data?.full_name || '');
    return json(200, sessionJson(body.email, users.get(body.email)));
  }
  if (p === '/token' && url.searchParams.get('grant_type') === 'password') {
    const u = users.get(body.email); if (!u || u.password !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return json(200, sessionJson(body.email, u));
  }
  if (p === '/token') { const e = [...users].find(([, u]) => 'r-' + u.id === body.refresh_token); return e ? json(200, sessionJson(e[0], e[1])) : json(400, { error: 'invalid_grant' }); }
  if (p === '/user') { const tok = (req.headers().authorization || '').split('.')[1]; const sub = tok && JSON.parse(Buffer.from(tok, 'base64url')).sub;
    const e = [...users].find(([, u]) => u.id === sub); return e ? json(200, userJson(e[0], e[1])) : json(401, { msg: 'no user' }); }
  if (p === '/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  return json(404, { msg: 'not stubbed: ' + p });
}
let networkDown = false;   // routed requests ignore setOffline(), so the stand-in drops them itself
async function restRoute(route) {
  if (networkDown) return route.abort('internetdisconnected');
  const req = route.request(), url = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const headers = { ...req.headers() }; delete headers.apikey; delete headers.host;
  // straight from Node: the browser's proxy must not see local traffic
  const res = await fetch(`http://127.0.0.1:${REST_PORT}${url.pathname.replace('/rest/v1', '')}${url.search}`,
    { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
  const out = Object.fromEntries([...res.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
  return route.fulfill({ status: res.status, headers: { ...out, 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }, body: Buffer.from(await res.arrayBuffer()) });
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
async function siteRoute(route) {
  let p = new URL(route.request().url()).pathname; if (p.endsWith('/')) p += 'index.html';
  const f = join(SITE, p); if (!existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: TYPES[extname(f)] || 'application/octet-stream', body: readFileSync(f) });
}

/* ───────── browser ───────── */
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });
let failures = 0; const errors = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures++; };
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'ms-MY', ...opts });
  await ctx.route(`${SUPA}/auth/v1/**`, authRoute); await ctx.route(`${SUPA}/rest/v1/**`, restRoute); await ctx.route(`${ORIGIN}/**`, siteRoute);
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: full });
async function signIn(page, email, password) {
  await page.goto(`${ORIGIN}/run/`); await page.fill('#au-email', email); await page.fill('#au-pass', password);
  await page.click('#auth-form [type=submit]');
}
const text = page => page.locator('#view').innerText();

try {
  /* 1. Head coach publishes the plans */
  { const { ctx, page } = await newPage();
    await signIn(page, 'devi.coach@test.my', 'coach-pass-1');
    await page.waitForSelector('text=Matlamat semasa');
    await page.click('[data-tab=training]'); await page.click('a[href="#/review"]');
    await page.waitForSelector('[data-set="published"]'); await shot(page, '01-coach-review');
    for (let left = 4; left > 0; left--) {
      await page.locator('[data-set="published"]').first().click(); await page.click('[data-a=yes]');
      await page.waitForFunction(n => document.querySelectorAll('[data-set="published"]').length === n, left - 1);
    }
    const pub = psql(`select count(*) from run_programs where status='published'`);
    check(pub === '4', `head coach published all four plans (${pub})`);
    await ctx.close(); }

  /* 2. Captain creates a community run */
  { const { ctx, page } = await newPage();
    await signIn(page, 'chong.captain@test.my', 'captain-pass-1');
    await page.waitForSelector('text=Matlamat semasa');
    await page.click('[data-tab=club]'); await page.click('a[href="#/event/new"]');
    await page.fill('#ev-title', 'Larian Pagi Sabtu');
    const d = new Date(Date.now() + 2 * 864e5); d.setHours(6, 30, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    await page.fill('#ev-start', d.toISOString().slice(0, 16));
    await page.fill('#ev-place', 'Pintu utama Stadium Sultan Muhammad IV'); await page.fill('#ev-dist', '5KM'); await page.fill('#ev-pace', '6:00, 7:00, lari/jalan');
    await page.fill('#ev-leader', 'Kapten Chong'); await page.fill('#ev-cap', '20'); await page.fill('#ev-desc', 'Bawa air. Kita mula tepat 6:30 pagi.');
    await page.click('#ev-form [type=submit]'); await page.waitForSelector('text=Alat kapten');
    check(psql(`select count(*) from run_events`) === '1', 'captain created a run');
    await ctx.close(); }

  /* 3. A new runner's whole journey */
  const { ctx, page } = await newPage();
  await page.goto(`${ORIGIN}/run/`); await page.waitForSelector('#auth-form'); await shot(page, '02-signin', false);
  await page.click('[data-mode=signup]'); await page.fill('#au-name', 'Aisyah Rahman'); await page.fill('#au-email', 'aisyah@test.my'); await page.fill('#au-pass', 'aisyah-pass-1');
  await page.click('#auth-form [type=submit]');
  await page.waitForSelector('.ob'); await shot(page, '03-onboarding-goal');
  const pick = async (sel) => { await page.click(sel); await page.click('[data-next]'); };
  await pick('[data-pick=goal][data-v=first_5k]');
  await pick('[data-pick=experience][data-v=some]');
  await page.click('[data-pick=continuous_run_min][data-v="10"]'); await shot(page, '04-onboarding-ability', false); await page.click('[data-next]');
  for (const d of [1, 3, 6]) await page.click(`[data-day="${d}"]`); await page.click('[data-next]');
  await page.waitForSelector('[data-pick=target_distance_m][aria-pressed=true]'); await page.click('[data-next]');   // 5KM preselected from the goal
  await page.click('[data-skip]');                                       // race date: optional
  await pick('[data-pick=weekly_km_recent][data-v="3"]');
  await page.click('[data-pick=has_limitations][data-v=true]');
  check(await page.locator('[data-next]').isDisabled(), 'health details cannot continue without consent');
  await page.check('#lim-consent'); check(await page.locator('[data-next]').isEnabled(), 'consent enables continue'); await page.uncheck('#lim-consent');
  await page.fill('#lim-text', 'Lutut kanan kadang-kadang sakit'); await page.check('#lim-consent'); await shot(page, '05-onboarding-health', false);
  await page.click('[data-next]');
  await pick('[data-pick=training_location][data-v=road]');
  await page.waitForSelector('#start-box [data-go]'); await shot(page, '06-recommendation');
  const recTitle = await page.locator('.hero h2').innerText();
  check(/Couch to 5KM/i.test(recTitle), `limitations + 10 min → gentler plan recommended (${recTitle})`);
  check(psql(`select health_consent_at is not null from run_profiles p join auth.users u on u.id=p.user_id where u.email='aisyah@test.my'`) === 't', 'consent timestamp stored with health info');
  // she prefers the 5K plan: browse and pick it instead
  await page.click('[data-browse]'); await page.click('a[href="#/program/road-to-5k"]'); await page.waitForSelector('#start-box [data-go]');
  await shot(page, '07-program');
  await page.click('#start-box [data-go]'); await page.waitForSelector('a.sess'); await shot(page, '08-calendar');
  const nSess = psql(`select count(*) from run_scheduled_workouts sw join auth.users u on u.id=sw.user_id where u.email='aisyah@test.my'`);
  const badDays = psql(`select count(*) from run_scheduled_workouts sw join auth.users u on u.id=sw.user_id where u.email='aisyah@test.my' and extract(dow from scheduled_date) not in (1,3,6)`);
  check(nSess === '18' && badDays === '0', `calendar: ${nSess} sessions, all on Mon/Wed/Sat`);

  await page.click('[data-tab=home]'); await page.waitForSelector('#view a.hero:has-text("Road to 5KM")'); await shot(page, '09-home-start');
  const home = await text(page);
  check(/Minggu 1 daripada 6/.test(home), 'home shows "Minggu 1 daripada 6"');
  check(/0\.0\s*km/i.test(home), 'home weekly distance starts at zero (no invented data)');

  // open the first session and complete it with a logged run
  await page.click('[data-tab=training]'); await page.locator('a.sess').first().click();
  await page.waitForSelector('[data-log]'); await shot(page, '10-workout');
  await page.click('[data-log]'); await page.waitForSelector('#log-form');
  await page.fill('#lf-dist', '2.6'); await page.fill('#lf-m', '19'); await page.fill('#lf-s', '30');
  await page.locator('#fb-rpe').fill('5'); await page.click('[data-feel=right]');
  check(/7:30/.test(await page.locator('#lf-pace').innerText()), 'live pace shown while typing (7:30 /km)');
  await shot(page, '11-log');
  await page.click('#log-form [type=submit]');
  await page.waitForSelector('.celebrate'); await shot(page, '12-achievement', false);
  const badges = await page.locator('.celebrate h2').allTextContents();
  check(badges.includes('Larian Pertama') && badges.includes('Sesi Pertama'), `first achievements awarded: ${badges.join(', ')}`);
  await page.click('[data-ok]');
  check(psql(`select status from run_scheduled_workouts where seq=1 and user_id=(select id from auth.users where email='aisyah@test.my')`) === 'completed', 'session marked completed and linked');

  // progress on home
  await page.click('[data-tab=home]'); await page.waitForSelector('#view a.hero:has-text("Road to 5KM")');
  const home2 = await text(page);
  check(/2\.6\s*km/.test(home2) && /1\/18 sesi/.test(home2), 'home progress updated (2.6 km, 1/18 sessions)');
  await shot(page, '13-home-progress');

  // duplicate guard
  await page.click('[data-log]'); await page.waitForSelector('#log-form');
  await page.fill('#lf-dist', '2.6'); await page.fill('#lf-m', '19'); await page.click('#log-form [type=submit]');
  await page.waitForSelector('[data-a=yes]'); check(/sudah ada/.test(await page.locator('#sheet-body').innerText()), 'duplicate run warning shown');
  await page.click('[data-a=no]');

  // join the community run
  await page.click('[data-tab=club]'); await page.waitForSelector('text=Larian Pagi Sabtu');
  await page.click('[data-join]'); await page.waitForSelector('text=Ahli'); await page.click('text=Larian Pagi Sabtu');
  await page.click('[data-rsvp="1"]'); await page.waitForSelector('text=Anda berdaftar'); await shot(page, '14-event');
  check(/1 akan hadir/.test(await text(page)) && /19 tempat lagi/.test(await text(page)), 'RSVP counted (1 going, 19 spots left)');

  // profile: progress, bests, badges
  await page.click('[data-tab=profile]'); await page.waitForSelector('.badges'); await shot(page, '15-profile');
  check((await page.locator('.badge.got').count()) === 2, 'profile shows 2 earned badges');

  // offline: the run is kept on the device and sent later
  await ctx.setOffline(true); networkDown = true;
  await page.evaluate(() => { location.hash = '#/log'; }); await page.waitForSelector('#log-form');
  await page.fill('#lf-dist', '3.1'); await page.fill('#lf-m', '24'); await page.click('#log-form [type=submit]');
  await page.waitForSelector('text=Disimpan dalam peranti');
  check(psql(`select count(*) from run_activities`) === '1', 'offline run not sent yet');
  await page.waitForSelector('#view a.hero:has-text("Road to 5KM")');
  check(/5\.7\s*km/.test(await text(page)), 'home still readable offline, including the queued run (5.7 km)');
  await ctx.setOffline(false); networkDown = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  check(psql(`select count(*) from run_activities`) === '2', 'offline run synced once back online');

  // English, dark theme, desktop
  await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('[data-lang=en]');
  await page.click('[data-lang=en]'); await page.waitForSelector('text=Language');
  await page.click('[data-theme=dark]'); await page.click('[data-tab=home]'); await page.waitForSelector('text=This week');
  check(/Week 1 of 6/.test(await text(page)), 'English UI after switching language');
  await shot(page, '16-home-en-dark');
  await page.setViewportSize({ width: 1280, height: 860 }); await page.waitForTimeout(300); await shot(page, '17-desktop', false);
  await ctx.close();

  /* 4. Privacy: another runner sees none of Aisyah's data through the app */
  { const { ctx, page } = await newPage();
    await signIn(page, 'chong.captain@test.my', 'captain-pass-1'); await page.waitForSelector('text=Matlamat semasa');
    await page.click('[data-tab=club]'); await page.click('text=Larian Pagi Sabtu'); await page.waitForSelector('text=Senarai hadir');
    check(/Aisyah Rahman/.test(await text(page)), 'captain sees the attendee name');
    await page.click('[data-tab=profile]'); await page.waitForSelector('.badges');
    check(/Belum ada larian/.test(await text(page)), 'captain cannot see Aisyah\'s runs');
    await ctx.close(); }
} catch (e) { console.error(e); failures++; }
finally {
  await browser.close(); rest.kill();
  try { psql(`drop database if exists ${DB} with (force)`, 'postgres'); } catch (e) {}
}
if (errors.length) { console.log('\nBrowser errors:\n' + [...new Set(errors)].join('\n')); }
check(errors.length === 0, 'no JavaScript errors');
console.log(failures ? `\n${failures} FAILED` : '\nALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
