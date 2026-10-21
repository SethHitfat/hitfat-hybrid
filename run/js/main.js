// Boot, auth gate, hash router and the tab bar.
import * as api from './api.js';
import { t, setLang, lang } from './i18n.js';
import { $, esc, icon, toast, closeSheet, errorBox } from './ui.js';

export const state = { profile: null, roles: [], superAdmin: false, name: '', ready: false };
export const isStaff = (roles = ['head_coach', 'running_coach', 'club_captain']) => state.superAdmin || state.roles.some(r => roles.includes(r.role));
export const canManageChapter = id => state.superAdmin || state.roles.some(r => ['head_coach', 'running_coach', 'club_captain'].includes(r.role) && (!r.chapter_id || r.chapter_id === id));

const ROUTES = [
  [/^home$/, () => import('./views/home.js')],
  [/^training$/, () => import('./views/training.js')],
  [/^programs$/, () => import('./views/programs.js')],
  [/^program\/([\w-]+)$/, () => import('./views/programs.js'), 'detail'],
  [/^workout\/([\w-]+)$/, () => import('./views/workout.js')],
  [/^log$/, () => import('./views/log.js')],
  [/^activity\/([\w-]+)$/, () => import('./views/log.js'), 'detail'],
  [/^club$/, () => import('./views/club.js')],
  [/^event\/new$/, () => import('./views/club.js'), 'edit'],
  [/^event\/([\w-]+)\/edit$/, () => import('./views/club.js'), 'edit'],
  [/^event\/([\w-]+)$/, () => import('./views/club.js'), 'event'],
  [/^profile$/, () => import('./views/profile.js')],
  [/^history$/, () => import('./views/profile.js'), 'history'],
  [/^settings$/, () => import('./views/profile.js'), 'settings'],
  [/^onboarding$/, () => import('./views/onboarding.js')],
  [/^review$/, () => import('./views/programs.js'), 'review'],
  [/^gps$/, () => import('./views/gps.js')],
];
const TABS = [['home', 'home'], ['training', 'training'], ['club', 'club'], ['profile', 'profile']];
const TAB_OF = { home: 'home', training: 'training', programs: 'training', program: 'training', review: 'training', workout: 'training',
  club: 'club', event: 'club', profile: 'profile', history: 'profile', settings: 'profile', activity: 'profile', log: 'home', gps: 'home' };

export function go(path, replace) {
  const h = '#/' + path.replace(/^#?\/?/, '');
  if (replace) history.replaceState(null, '', h); else if (location.hash !== h) { location.hash = h; return; }
  route();
}
export function back(fallback) { if (history.length > 1) history.back(); else go(fallback || 'home'); }

function paintTabs(current) {
  const nav = $('#tabs');
  nav.innerHTML = `<div class="wordmark">HITFAT <b>RUN</b></div>` + TABS.map(([k, ic]) =>
    `<button data-tab="${k}" ${current === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(t('tab.' + k))}</span></button>`).join('');
  nav.classList.remove('hide');
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

let routeSeq = 0;
export async function route() {
  const seq = ++routeSeq;
  closeSheet();
  if (!state.ready) return;
  if (!api.session.user) { $('#tabs').classList.add('hide'); return (await import('./views/auth.js')).render($('#view')); }
  let path = decodeURIComponent((location.hash || '').replace(/^#\/?/, '').split('?')[0]) || 'home';
  if (!state.profile || !state.profile.onboarded_at) path = 'onboarding';
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const hit = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const m = path.match(hit[0]) || [];
  const tab = TAB_OF[path.split('/')[0]] || 'home';
  if (path === 'onboarding') $('#tabs').classList.add('hide'); else paintTabs(tab);
  // a fresh element per route, so no screen inherits another's listeners
  const old = $('#view'), view = old.cloneNode(false); old.replaceWith(view);
  try {
    const mod = await hit[1]();
    if (seq !== routeSeq) return;
    window.scrollTo(0, 0);
    await mod[hit[2] || 'render'](view, m[1], params);
    view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    if (seq !== routeSeq) return;
    view.innerHTML = `<div style="padding-top:20px">${errorBox(e, true)}</div>`;
    view.querySelector('[data-retry]')?.addEventListener('click', route);
  }
}
window.addEventListener('hashchange', route);

/* ───────── session ───────── */
export async function loadRunner() {
  const [profile, roles, superAdmin, name] = await Promise.all([
    api.getProfile(), api.myRoles().catch(() => []), api.isSuperAdmin().catch(() => false), api.sharedName().catch(() => ''),
  ]);
  Object.assign(state, { profile, roles: roles || [], superAdmin: !!superAdmin, name: (profile && profile.display_name) || name });
  if (profile && profile.language) setLang(profile.language);
}
let signedInAs = null;
async function onSession(sess) {
  const id = sess && sess.user ? sess.user.id : null;
  if (id === signedInAs && state.ready) return;
  signedInAs = id; api.session.user = sess ? sess.user : null;
  if (id) {
    try { await loadRunner(); }
    catch (e) { console.error(e); state.ready = true; $('#view').innerHTML = errorBox(e, true); $('#view [data-retry]')?.addEventListener('click', () => location.reload()); return; }
    api.flushOutbox().then(n => n && toast(t('log.synced', { n })));
  } else Object.assign(state, { profile: null, roles: [], superAdmin: false, name: '' });
  state.ready = true;
  // a fresh OAuth return carries tokens in the URL; drop them once read
  if (/access_token|refresh_token|[?&]code=/.test(location.href)) history.replaceState(null, '', location.pathname + '#/home');
  route();
}

function netBanner() {
  const el = $('#offline');
  if (navigator.onLine) { el.classList.add('hide'); api.flushOutbox().then(n => n && toast(t('log.synced', { n }))); }
  else { el.textContent = t('net.offline'); el.classList.remove('hide'); }
}
window.addEventListener('online', netBanner); window.addEventListener('offline', netBanner);

async function boot() {
  try { const l = localStorage.getItem('hfrun_lang'); if (l) setLang(l); } catch (e) {}
  document.documentElement.lang = lang();
  netBanner();
  if (!api.sb) { state.ready = true; $('#view').innerHTML = errorBox(new Error(t('err.nolib')), true); $('#view [data-retry]')?.addEventListener('click', () => location.reload()); return; }
  api.sb.auth.onAuthStateChange((ev, s) => { if (ev === 'INITIAL_SESSION' || ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') onSession(s); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/run/sw.js', { scope: '/run/' }).catch(e => console.warn('sw', e));
}
window.addEventListener('error', e => console.error('JS error', e.message, e.filename, e.lineno));
boot();
