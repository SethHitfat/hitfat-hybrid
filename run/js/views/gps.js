// The experimental GPS screen. Shows its limits before the first start.
import { go, back } from '../main.js';
import { t } from '../i18n.js';
import { esc, on, icon, km, dur, pace, toast, confirmSheet } from '../ui.js';
import { Tracker, loadLeaflet, baseMap, ACC_MAX } from '../gps.js';
import { GPS_DRAFT } from './log.js';

let tracker = null, tick = null, map = null, line = null, me = null;

export async function render(view, _, params) {
  const sw = params.get('sw');
  if (tracker && tracker.active) return live(view);
  const saved = Tracker.recoverable();
  const supported = 'geolocation' in navigator;
  view.innerHTML = `<div><header class="topbar"><div class="row"><button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button><h1>${esc(t('gps.title'))}</h1></div>
      <span class="chip warn">${esc(t('gps.experimental'))}</span></header>
    <div class="notice"><b>${esc(t('gps.limitsT'))}</b> ${esc(t('gps.compat'))}</div>
    <ul class="muted small" style="padding-left:18px;margin:14px 0">
      <li>${esc(t('gps.tip1'))}</li><li>${esc(t('gps.tip2'))}</li><li>${esc(t('gps.tip3'))}</li></ul>
    ${saved ? `<div class="card line" style="margin-bottom:12px"><b>${esc(t('gps.recoverT'))}</b><p class="muted small" style="margin:6px 0 12px">${esc(t('gps.recover', { km: km(saved.dist), t: dur(saved.acc / 1000) }))}</p>
      <div class="row"><button class="btn sm primary" data-restore>${esc(t('gps.continue'))}</button><button class="btn sm ghost" data-discard>${esc(t('gps.discard'))}</button></div></div>` : ''}
    ${supported ? `<button class="btn primary block" data-start>${icon('play', 'width="18" height="18"')} ${esc(t('gps.start'))}</button>`
      : `<div class="card">${esc(t('gps.unsupported'))}</div>`}
    <a class="btn ghost block" style="margin-top:10px" href="#/log${sw ? '?sw=' + sw : ''}">${esc(t('gps.manualInstead'))}</a></div>`;
  const root = view.firstElementChild;
  root.querySelector('[data-back]').onclick = () => back('home');
  on(root, '[data-start]', 'click', async () => {
    if (saved && !await confirmSheet(t('gps.replaceQ'), t('gps.replace'), t('gps.start'), true)) return;
    tracker = new Tracker(() => paintLive()); tracker.begin(sw); live(view);
  });
  on(root, '[data-restore]', 'click', () => { tracker = new Tracker(() => paintLive()); tracker.restore(saved); live(view); });
  on(root, '[data-discard]', 'click', () => { Tracker.discard(); render(view, _, params); });
}

function live(view) {
  view.innerHTML = `<div class="gps-live" id="gl">
    <div class="row between"><span class="acc" id="gl-acc"><i></i><span>${esc(t('gps.searching'))}</span></span>
      <span class="tiny" style="font-weight:800;letter-spacing:.1em" id="gl-state">${esc(t('gps.running'))}</span>
      <button class="tiny" style="font-weight:800;color:#fff" data-map>${esc(t('gps.map'))}</button></div>
    <div class="mapbox hide" id="gl-map"></div>
    <div class="main"><div class="num huge" id="gl-km">0.00</div><div class="eyebrow" style="color:#B5B5B5">${esc(t('unit.km'))}</div>
      <div class="trio"><div><div class="num" id="gl-pace">–</div><div class="l">${esc(t('gps.pace'))}</div></div>
        <div><div class="num" id="gl-time">0:00</div><div class="l">${esc(t('gps.time'))}</div></div>
        <div><div class="num" id="gl-avg">–</div><div class="l">${esc(t('gps.avg'))}</div></div></div></div>
    <div class="ctrls" id="gl-run"><button class="round" data-pause aria-label="${esc(t('gps.pause'))}">${icon('pause')}</button></div>
    <div class="ctrls hide" id="gl-paused">
      <button class="round sm hold" data-end aria-label="${esc(t('gps.holdEnd'))}"><span class="fill"></span>${icon('stop')}</button>
      <button class="round white" data-resume aria-label="${esc(t('gps.resume'))}">${icon('play')}</button></div>
    <p class="tiny" style="text-align:center;color:#B5B5B5;min-height:16px;margin:12px 0 0" id="gl-hint"></p></div>`;
  const root = view.firstElementChild;
  document.body.style.overflow = 'hidden';
  on(root, '[data-pause]', 'click', () => tracker.pause());
  on(root, '[data-resume]', 'click', () => tracker.resume());
  on(root, '[data-map]', 'click', () => toggleMap(root));
  // hold to end, so a pocket tap never ends a run
  const end = root.querySelector('[data-end]'), fill = end.querySelector('.fill'); let h = null, t0 = 0;
  const up = () => { clearInterval(h); h = null; fill.style.transform = 'scaleY(0)'; };
  end.addEventListener('pointerdown', e => { e.preventDefault(); t0 = Date.now(); root.querySelector('#gl-hint').textContent = t('gps.keepHolding');
    h = setInterval(() => { const f = Math.min(1, (Date.now() - t0) / 1000); fill.style.transform = `scaleY(${f})`; if (f >= 1) { up(); finish(); } }, 30); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => end.addEventListener(ev, up));
  clearInterval(tick); tick = setInterval(paintLive, 500);
  window.addEventListener('hashchange', leave, { once: true });
  paintLive();
}
function leave() { clearInterval(tick); tick = null; document.body.style.overflow = ''; if (map) { map.remove(); map = line = me = null; } if (tracker && tracker.active) { tracker.pause(); toast(t('gps.leftPaused')); } }

function paintLive() {
  const el = document.getElementById('gl'); if (!el || !tracker || !tracker.active) return;
  const s = tracker.s, e = tracker.elapsed() / 1000, f = tracker.lastFix;
  el.classList.toggle('paused', s.status === 'paused');
  el.querySelector('#gl-km').textContent = km(s.dist);
  el.querySelector('#gl-time').textContent = dur(e);
  el.querySelector('#gl-pace').textContent = pace(tracker.currentPace());
  el.querySelector('#gl-avg').textContent = s.dist > 50 ? pace(e / (s.dist / 1000)) : '–';
  el.querySelector('#gl-state').textContent = s.status === 'paused' ? t('gps.paused') : t('gps.running');
  el.querySelector('#gl-run').classList.toggle('hide', s.status !== 'running');
  el.querySelector('#gl-paused').classList.toggle('hide', s.status !== 'paused');
  const acc = el.querySelector('#gl-acc'), stale = !f || Date.now() - f.t > 15000;
  const cls = tracker.error === 1 ? 'bad' : stale ? 'bad' : f.acc <= 15 ? 'good' : f.acc <= ACC_MAX ? 'ok' : 'bad';
  acc.className = 'acc ' + cls;
  acc.querySelector('span').textContent = tracker.error === 1 ? t('gps.denied') : stale ? t('gps.searching') : t('gps.accuracy', { m: Math.round(f.acc) });
  el.querySelector('#gl-hint').textContent = s.status === 'paused' ? t('gps.holdEnd') : tracker.error === 1 ? t('gps.deniedHelp') : '';
  if (map && f) { line.setLatLngs(s.pts); me ? me.setLatLng(f.pt) : (me = window.L.circleMarker(f.pt, { radius: 8, color: '#fff', weight: 3, fillColor: '#E30613', fillOpacity: 1 }).addTo(map)); }
}
async function toggleMap(root) {
  const box = root.querySelector('#gl-map'); box.classList.toggle('hide');
  if (box.classList.contains('hide') || map) { map && map.invalidateSize(); return; }
  try { const L = await loadLeaflet(); map = baseMap(L, box, true); line = L.polyline(tracker.s.pts, { color: '#E30613', weight: 5 }).addTo(map);
    if (tracker.lastFix) map.setView(tracker.lastFix.pt, 16); }
  catch (e) { box.classList.add('hide'); toast(t('gps.noMap')); }
}

async function finish() {
  const s = tracker.s;
  if (s.dist < 50) {
    if (!await confirmSheet(t('gps.shortQ'), t('gps.short'), t('gps.discard'), true)) return;
    tracker.stop(); leave(); go('home', true); return;
  }
  const out = tracker.finish();
  try { sessionStorage.setItem(GPS_DRAFT, JSON.stringify(out)); } catch (e) {}
  leave();
  if (out.gaps) toast(t('gps.gaps', { n: out.gaps }));
  go('log?gps=1' + (out.sw ? '&sw=' + out.sw : ''), true);
}
