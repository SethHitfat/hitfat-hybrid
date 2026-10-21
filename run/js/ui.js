// Small DOM, formatting and dialog helpers shared by every screen.
import { t, lang } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

/* ---------- numbers ---------- */
export const km = (m, dp = 2) => (m / 1000).toFixed(dp);
export function dur(s) {
  s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function durWords(s) {
  s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
  return h ? `${h}${t('unit.h')} ${m}${t('unit.m')}` : `${m} ${t('unit.min')}`;
}
export function pace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
  const s = Math.round(secPerKm); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const paceOf = (sec, m) => m > 0 ? sec / (m / 1000) : NaN;

/* ---------- dates (device local time; the club runs in MYT) ---------- */
export const DAY_MS = 864e5;
export function ymd(d) { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const today = () => ymd(new Date());
export function startOfWeek(d = new Date()) { d = new Date(d); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; }
export function startOfMonth(d = new Date()) { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), 1); }
const loc = () => lang() === 'en' ? 'en-MY' : 'ms-MY';
export const fmtDate = (d, o) => new Date(typeof d === 'string' && d.length === 10 ? parseYmd(d) : d).toLocaleDateString(loc(), o || { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDateLong = d => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtTime = d => new Date(d).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
export const weekdayShort = i => new Date(2024, 0, 7 + i).toLocaleDateString(loc(), { weekday: 'narrow' }); // 2024-01-07 is a Sunday
export const weekdayName = i => new Date(2024, 0, 7 + i).toLocaleDateString(loc(), { weekday: 'long' });
export function localInput(d = new Date()) { d = new Date(d); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

/* ---------- toast, sheet, confirm ---------- */
export function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600); }
let _onClose = null;
/** Returns a fresh element per sheet, so one sheet's listeners never fire in the next. */
export function openSheet(html, onClose) {
  const prev = _onClose; _onClose = null; prev && prev();
  const box = mount($('#sheet-body'), html); $('#sheet').classList.remove('hide'); _onClose = onClose || null;
  const f = box.querySelector('input,select,textarea,button'); f && setTimeout(() => f.focus({ preventScroll: true }), 50);
  return box;
}
export function closeSheet() { $('#sheet').classList.add('hide'); $('#sheet-body').innerHTML = ''; const c = _onClose; _onClose = null; c && c(); }
document.addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hide')) closeSheet(); });
export function confirmSheet(title, body, okLabel, danger) {
  return new Promise(res => {
    let done = false; const finish = v => { if (!done) { done = true; res(v); } };
    const b = openSheet(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="row" style="margin-top:18px"><button class="btn block" data-a="no">${esc(t('common.cancel'))}</button>
      <button class="btn block ${danger ? 'primary' : 'dark'}" data-a="yes">${esc(okLabel || t('common.ok'))}</button></div>`, () => finish(false));
    b.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; finish(a.dataset.a === 'yes'); closeSheet(); });
  });
}

/* ---------- misc ---------- */
/** Replace `el`'s content with a new wrapper, so listeners bound to it die with the next paint. */
export function mount(el, html) { const d = document.createElement('div'); d.innerHTML = html; el.replaceChildren(d); return d; }
export function on(root, sel, ev, fn) { root.addEventListener(ev, e => { const el = e.target.closest(sel); if (el && root.contains(el)) fn(e, el); }); }
export const skeleton = (n = 3, h = 84) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-bottom:12px"></div>`).join('');
export const emptyState = (title, body, action = '') => `<div class="empty"><b>${esc(title)}</b>${esc(body)}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
export function errorBox(err, retry) {
  const msg = friendlyError(err);
  return `<div class="card line"><b>${esc(t('err.title'))}</b><p class="muted small" style="margin:6px 0 12px">${esc(msg)}</p>
    ${retry ? `<button class="btn sm" data-retry>${esc(t('common.retry'))}</button>` : ''}</div>`;
}
export function friendlyError(err) {
  if (!navigator.onLine) return t('err.offline');
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || '');
  if (/full/i.test(m) || (err && err.hint === 'full')) return t('club.full');
  if (/JWT|not signed in|401/i.test(m)) return t('err.session');
  if (/relation .* does not exist|schema cache|PGRST20[25]/i.test(m)) return t('err.setup');
  return m || t('err.generic');
}

/* Icons: simple stroked glyphs, drawn for this app. */
const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  training: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/>',
  club: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20a6 6 0 0 1 12 0M14.5 20a4.5 4.5 0 0 1 7-3.7"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.2 3.2 0 0 1 0 6.3M21 20a6 6 0 0 0-4-5.6"/>',
  shoe: '<path d="M3 16c0-3 1-7 3-9l3 3c2 1 4 1 6 1 3 0 6 2 6 5v1H3z"/><path d="M3 19h18"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
  gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  coach: '<path d="M4 6h16v10H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 3h7L13 9.5h-2zM12 12v6M9 15h6"/>',
};
export function icon(name, extra = '') {
  const filled = name === 'play' || name === 'pause' || name === 'stop';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} ${extra}>${P[name] || ''}</svg>`;
}
