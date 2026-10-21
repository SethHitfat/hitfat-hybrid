// Profile: progress, personal bests, history, achievements and settings.
import * as api from '../api.js';
import { state, go, back, loadRunner } from '../main.js';
import { t, setLang, lang } from '../i18n.js';
import { esc, on, mount, icon, km, dur, durWords, pace, paceOf, fmtDate, fmtTime, skeleton, errorBox, emptyState, toast, confirmSheet,
  openSheet, closeSheet, friendlyError, startOfMonth } from '../ui.js';
import { totals, thisWeek, thisMonth, weeklySeries, consistency, bests, PB_DIST } from '../stats.js';
import { ACHIEVEMENTS } from '../achievements.js';

const backBtn = `<button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button>`;

export async function render(view) {
  view.innerHTML = `<header class="topbar"><div class="row"><div class="icon-btn" style="width:52px;height:52px;background:var(--text);color:var(--bg);font-weight:800;font-size:20px">${esc((state.name || '?').charAt(0).toUpperCase())}</div>
      <div><h1 style="font-size:26px">${esc(state.name || t('home.runner'))}</h1><div class="muted small">${esc(t('level.' + (state.profile?.level || 'beginner')))}${state.profile?.goal ? ' · ' + esc(t('goal.' + state.profile.goal)) : ''}</div></div></div>
      <a class="icon-btn" href="#/settings" aria-label="${esc(t('settings.title'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></a></header>
    <div id="pr-body">${skeleton(4, 110)}</div>
    <button class="fab" data-log aria-label="${esc(t('log.title'))}">${icon('plus')}</button>`;
  view.querySelector('[data-log]').onclick = () => go('log');
  const body = view.querySelector('#pr-body');
  try {
    const [acts, earned] = await Promise.all([api.listActivities({ limit: 1000 }), api.listAchievements()]);
    const all = totals(acts), wk = thisWeek(acts), mo = thisMonth(acts), cons = consistency(acts, 4), pb = bests(acts), series = weeklySeries(acts, 8);
    const got = Object.fromEntries(earned.map(e => [e.code, e.earned_at]));
    mount(body, `
      <h2 style="margin-top:8px">${esc(t('prof.progress'))}</h2>
      <div class="card">
        <div class="metrics three">
          <div class="metric"><div class="num">${km(wk.dist, 1)}</div><div class="l">${esc(t('prof.weekKm'))}</div></div>
          <div class="metric"><div class="num">${km(mo.dist, 1)}</div><div class="l">${esc(t('prof.monthKm'))}</div></div>
          <div class="metric"><div class="num">${km(all.dist, 1)}</div><div class="l">${esc(t('prof.totalKm'))}</div></div>
          <div class="metric"><div class="num" style="font-size:22px">${esc(durWords(all.time))}</div><div class="l">${esc(t('prof.totalTime'))}</div></div>
          <div class="metric"><div class="num">${all.n}</div><div class="l">${esc(t('stat.runs'))}</div></div>
          <div class="metric"><div class="num">${cons.active}/${cons.of}</div><div class="l">${esc(t('stat.consistency'))}</div></div>
        </div>
        ${acts.length ? `<div class="chart" style="margin-top:16px" aria-label="${esc(t('prof.chart'))}">${chart(series)}</div><div class="muted tiny">${esc(t('prof.chart'))}</div>` : `<p class="muted small" style="margin:14px 0 0">${esc(t('home.noRuns'))}</p>`}
      </div>

      <h2>${esc(t('prof.bests'))}</h2>
      <div class="metrics">${PB_DIST.map(([m, l]) => `<div class="card" style="margin:0">${pb[m] ? `<a href="#/activity/${pb[m].a.id}" style="text-decoration:none">` : ''}
          <div class="eyebrow">${l}</div><div class="num" style="font-size:26px;margin-top:6px">${pb[m] ? dur(pb[m].t) : '–'}</div>
          <div class="muted tiny" style="margin-top:4px">${pb[m] ? esc(fmtDate(pb[m].a.started_at)) : esc(t('prof.notYet'))}</div>${pb[m] ? '</a>' : ''}</div>`).join('')}
        <div class="card" style="margin:0">${pb.longest ? `<a href="#/activity/${pb.longest.id}" style="text-decoration:none">` : ''}<div class="eyebrow">${esc(t('prof.longest'))}</div>
          <div class="num" style="font-size:26px;margin-top:6px">${pb.longest ? km(pb.longest.distance_m) + ' km' : '–'}</div>
          <div class="muted tiny" style="margin-top:4px">${pb.longest ? esc(fmtDate(pb.longest.started_at)) : esc(t('prof.notYet'))}</div>${pb.longest ? '</a>' : ''}</div></div>
      <p class="muted tiny" style="margin:8px 0 0">${esc(t('prof.bestsNote'))}</p>

      <h2 class="row between"><span>${esc(t('prof.recent'))}</span>${acts.length ? `<a class="link small" style="font-family:var(--font);text-transform:none" href="#/history">${esc(t('prof.all'))}</a>` : ''}</h2>
      ${acts.length ? `<div class="card list">${acts.slice(0, 5).map(activityRow).join('')}</div>` : `<div class="card">${emptyState(t('prof.noActsT'), t('prof.noActs'), `<a class="btn primary sm" href="#/log">${esc(t('log.title'))}</a>`)}</div>`}

      <h2>${esc(t('prof.badges'))} <span class="muted small" style="font-family:var(--font)">${earned.length}/${ACHIEVEMENTS.length}</span></h2>
      <div class="badges">${ACHIEVEMENTS.map(a => `<div class="badge ${got[a.code] ? 'got' : ''}"><div class="ic">${icon(a.icon)}</div>
        <div class="n">${esc(a[lang()][0])}</div><div class="d">${got[a.code] ? esc(fmtDate(got[a.code])) : esc(a[lang()][1])}</div></div>`).join('')}</div>`);
  } catch (e) { console.error(e); body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view); }
}

export const activityRow = a => `<a class="row" href="#/activity/${a.id}" style="text-decoration:none">
  <div class="icon-btn" style="flex:none">${icon(a.source === 'gps' ? 'gps' : a.scheduled_workout_id ? 'training' : 'shoe')}</div>
  <div class="grow"><div class="muted tiny">${esc(fmtDate(a.started_at))} · ${esc(fmtTime(a.started_at))}${a.queued ? ' · ' + esc(t('log.pending')) : ''}</div>
    <div style="font-weight:700" class="ellipsis">${esc(a.title || t('cat.' + (a.workout_type || 'other')))}</div></div>
  <div style="text-align:right"><div class="num" style="font-size:20px">${km(a.distance_m)}<span class="small"> km</span></div><div class="muted tiny">${pace(a.avg_pace_s_km || paceOf(a.moving_time_s, a.distance_m))} /km</div></div></a>`;

function chart(series) {
  const max = Math.max(...series.map(s => s.dist), 1000), W = 320, H = 140, gap = 8, bw = (W - gap * (series.length - 1)) / series.length;
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${series.map((s, i) => {
    const h = s.dist > 0 ? Math.max(4, (H - 26) * s.dist / max) : 3, x = i * (bw + gap), last = i === series.length - 1;
    return `<rect x="${x.toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.dist > 0 ? (last ? 'var(--red)' : 'var(--text)') : 'var(--surface-2)'}"><title>${km(s.dist, 1)} km</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" font-size="10" fill="var(--faint)" text-anchor="middle">${esc(fmtDate(s.start, { day: 'numeric', month: 'numeric' }))}</text>`; }).join('')}</svg>`;
}

/* ───────── full history ───────── */
export async function history(view) {
  view.innerHTML = `<header class="topbar"><div class="row">${backBtn}<h1>${esc(t('prof.history'))}</h1></div></header><div id="hi-body">${skeleton(6, 56)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('profile');
  const body = view.querySelector('#hi-body');
  try {
    const acts = await api.listActivities({ limit: 1000 });
    if (!acts.length) { body.innerHTML = `<div class="card">${emptyState(t('prof.noActsT'), t('prof.noActs'), `<a class="btn primary sm" href="#/log">${esc(t('log.title'))}</a>`)}</div>`; return; }
    const months = {};
    acts.forEach(a => { const d = new Date(a.started_at), k = d.getFullYear() * 100 + d.getMonth(); (months[k] = months[k] || []).push(a); });
    body.innerHTML = Object.entries(months).sort((a, b) => b[0] - a[0]).map(([k, list]) => {
      const tt = list.reduce((s, a) => s + a.distance_m, 0);
      return `<h2 class="row between"><span>${esc(fmtDate(new Date(Math.floor(k / 100), k % 100, 1), { month: 'long', year: 'numeric' }))}</span><span class="muted small" style="font-family:var(--font)">${km(tt, 1)} km · ${list.length}</span></h2>
        <div class="card list">${list.map(activityRow).join('')}</div>`; }).join('');
  } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => history(view); }
}

/* ───────── settings ───────── */
export async function settings(view) {
  const theme = (() => { try { return localStorage.getItem('hfrun_theme') || 'system'; } catch (e) { return 'system'; } })();
  view.innerHTML = `<div><header class="topbar"><div class="row">${backBtn}<h1>${esc(t('settings.title'))}</h1></div></header>
    <div class="card list" id="st">
      <div><label style="margin-top:0">${esc(t('settings.language'))}</label><div class="seg"><button data-lang="ms" aria-pressed="${lang() === 'ms'}">Bahasa Malaysia</button><button data-lang="en" aria-pressed="${lang() === 'en'}">English</button></div></div>
      <div><label style="margin-top:0">${esc(t('settings.theme'))}</label><div class="seg">${['system', 'light', 'dark'].map(x => `<button data-theme="${x}" aria-pressed="${theme === x}">${esc(t('theme.' + x))}</button>`).join('')}</div></div>
      <div class="row between"><div><div style="font-weight:700">${esc(t('settings.name'))}</div><div class="muted small">${esc(state.name)}</div></div><button class="btn sm" data-name>${esc(t('common.edit'))}</button></div>
      <div class="row between"><div><div style="font-weight:700">${esc(t('settings.runProfile'))}</div><div class="muted small">${esc(t('settings.runProfileHelp'))}</div></div><button class="btn sm" data-ob>${esc(t('common.edit'))}</button></div>
    </div>
    <h2>${esc(t('settings.gps'))}</h2>
    <div class="notice small">${esc(t('gps.compat'))}</div>
    <h2>${esc(t('settings.privacy'))}</h2>
    <div class="card list">
      <div><div style="font-weight:700">${esc(t('settings.whoSees'))}</div><div class="muted small" style="margin-top:4px">${esc(t('settings.whoSeesHelp'))}</div></div>
      <div class="row between"><div><div style="font-weight:700">${esc(t('settings.delete'))}</div><div class="muted small">${esc(t('settings.deleteHelp'))}</div></div><button class="btn sm danger" data-delete>${esc(t('common.delete'))}</button></div>
      <div><a class="link small" href="/privacy">${esc(t('auth.privacy'))}</a> · <a class="link small" href="/terms">${esc(t('auth.terms'))}</a></div>
    </div>
    <button class="btn block" style="margin-top:20px" data-out>${esc(t('settings.signOut'))}</button>
    <p class="faint tiny" style="text-align:center;margin-top:16px">HITFAT RUN CLUB · ${esc(api.session.user?.email || '')}</p></div>`;
  const root = view.firstElementChild;   // listeners bind to this render only
  root.querySelector('[data-back]').onclick = () => back('profile');
  on(root, '[data-lang]', 'click', async (e, b) => {
    setLang(b.dataset.lang);
    try { await api.saveProfile({ language: b.dataset.lang }); await loadRunner(); } catch (x) {}
    settings(view);
  });
  on(root, '[data-theme]', 'click', (e, b) => {
    const v = b.dataset.theme;
    try { v === 'system' ? localStorage.removeItem('hfrun_theme') : localStorage.setItem('hfrun_theme', v); } catch (x) {}
    if (v === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
    root.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  on(root, '[data-name]', 'click', () => {
    const b = openSheet(`<h3>${esc(t('settings.name'))}</h3><p class="muted small">${esc(t('settings.nameHelp'))}</p>
      <input id="nm" maxlength="40" value="${esc(state.name)}"><div class="error" id="nm-err"></div><button class="btn primary block" style="margin-top:12px" data-save>${esc(t('common.save'))}</button>`);
    b.querySelector('[data-save]').onclick = async () => {
      const v = b.querySelector('#nm').value.trim(); if (!v) return (b.querySelector('#nm-err').textContent = t('settings.nameErr'));
      try { await api.saveProfile({ display_name: v }); await loadRunner(); closeSheet(); settings(view); } catch (x) { b.querySelector('#nm-err').textContent = friendlyError(x); }
    };
  });
  on(root, '[data-ob]', 'click', () => go('onboarding?restart=1'));
  on(root, '[data-delete]', 'click', async () => {
    if (!await confirmSheet(t('settings.deleteQ'), t('settings.deleteConfirm'), t('settings.deleteGo'), true)) return;
    try { await api.deleteMyRunData(); await loadRunner(); toast(t('settings.deleted')); go('onboarding', true); } catch (x) { toast(friendlyError(x)); }
  });
  on(root, '[data-out]', 'click', async () => { if (await confirmSheet(t('settings.signOutQ'), t('settings.signOutHelp'), t('settings.signOut'))) api.signOut(); });
}
