// Log a run (manual, or the result of the experimental GPS tracker),
// and the page for one saved activity.
import * as api from '../api.js';
import { go, back } from '../main.js';
import { t, L, lang } from '../i18n.js';
import { esc, on, mount, icon, uuid, km, dur, pace, paceOf, fmtDateLong, fmtTime, localInput, skeleton, errorBox, emptyState,
  toast, confirmSheet, openSheet, closeSheet, friendlyError } from '../ui.js';
import { feedbackFields, bindFeedback, afterComplete, RUN_CATS } from './workout.js';
import { byCode } from '../achievements.js';

const TYPES = ['easy', 'recovery', 'long', 'tempo', 'threshold', 'interval', 'hill', 'run_walk', 'race', 'other'];
export const GPS_DRAFT = 'hfrun_gps_draft';

export async function render(view, _, params) {
  const swId = params.get('sw'), editId = params.get('edit'), fromGps = params.get('gps') === '1';
  view.innerHTML = `<header class="topbar"><div class="row"><button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button>
      <h1>${esc(editId ? t('log.edit') : t('log.title'))}</h1></div></header><div id="l-body">${skeleton(4, 64)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('home');
  const body = view.querySelector('#l-body');
  try {
    const [sess, existing] = await Promise.all([swId ? api.getSession(swId) : null, editId ? api.getActivity(editId) : null]);
    let gps = null; if (fromGps) { try { gps = JSON.parse(sessionStorage.getItem(GPS_DRAFT) || 'null'); } catch (e) {} }
    form(body, { sess, existing, gps });
  } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view, _, params); }
}

function form(body, { sess, existing, gps }) {
  const a = existing || {};
  const dist = a.distance_m || gps?.distance_m || sess?.template.distance_m || '';
  const mt = a.moving_time_s || gps?.moving_time_s || 0;
  const type = a.workout_type || (sess && RUN_CATS.includes(sess.template.category) ? sess.template.category : 'easy');
  const started = a.started_at || gps?.started_at || null;
  const fb = { rpe: a.rpe || sess?.rpe || null, feeling: sess?.feeling || null, feedback: sess?.feedback || '' };
  const st = { ...fb };
  const source = a.source || (gps ? 'gps' : 'manual');

  const root = mount(body, `<form id="log-form" novalidate>
    ${sess ? `<div class="card"><div class="eyebrow">${esc(t('log.forSession'))}</div><div style="font-weight:700;margin-top:4px">${esc(L(sess.template.i18n).title)}</div></div>` : ''}
    ${source === 'gps' ? `<div class="notice info small" style="margin-top:12px">${icon('gps', 'width="16" height="16"')} ${esc(t('log.fromGps'))}</div>` : ''}
    <label for="lf-start">${esc(t('log.when'))}</label><input type="datetime-local" id="lf-start" max="${localInput()}" value="${localInput(started || new Date())}" required>
    <label for="lf-dist">${esc(t('log.distance'))}</label>
    <input id="lf-dist" type="number" inputmode="decimal" step="0.01" min="0.05" max="300" placeholder="5.00" value="${dist ? (dist / 1000).toFixed(2) : ''}" required>
    <label>${esc(t('log.moving'))}</label>
    <div class="row">
      <input id="lf-h" type="number" min="0" max="47" inputmode="numeric" placeholder="${esc(t('unit.hh'))}" aria-label="${esc(t('unit.hours'))}" value="${mt ? Math.floor(mt / 3600) || '' : ''}">
      <input id="lf-m" type="number" min="0" max="59" inputmode="numeric" placeholder="${esc(t('unit.mm'))}" aria-label="${esc(t('unit.minutes'))}" value="${mt ? Math.floor(mt % 3600 / 60) : ''}">
      <input id="lf-s" type="number" min="0" max="59" inputmode="numeric" placeholder="${esc(t('unit.ss'))}" aria-label="${esc(t('unit.seconds'))}" value="${mt ? Math.round(mt % 60) : ''}"></div>
    <p class="muted small" id="lf-pace" style="margin:8px 0 0">&nbsp;</p>
    <details style="margin-top:6px"><summary class="link small" style="cursor:pointer">${esc(t('log.more'))}</summary>
      <label for="lf-elapsed">${esc(t('log.elapsed'))}</label>
      <input id="lf-elapsed" type="number" min="0" inputmode="numeric" placeholder="${esc(t('log.elapsedPh'))}" value="${a.elapsed_time_s || gps?.elapsed_time_s ? Math.round((a.elapsed_time_s || gps.elapsed_time_s) / 60) : ''}">
      <label for="lf-hr">${esc(t('log.hr'))}</label><input id="lf-hr" type="number" min="30" max="250" inputmode="numeric" placeholder="—" value="${a.avg_hr || ''}">
      <label for="lf-title">${esc(t('log.name'))}</label><input id="lf-title" maxlength="80" value="${esc(a.title || '')}" placeholder="${esc(t('log.namePh'))}">
    </details>
    <label for="lf-type">${esc(t('log.type'))}</label>
    <select id="lf-type">${TYPES.map(x => `<option value="${x}" ${x === type ? 'selected' : ''}>${esc(t('cat.' + x))}</option>`).join('')}</select>
    ${feedbackFields(fb)}
    <label for="lf-notes">${esc(t('log.notes'))}</label><textarea id="lf-notes" rows="2" maxlength="2000" placeholder="${esc(t('log.notesPh'))}">${esc(a.notes || '')}</textarea>
    <div class="error" id="lf-err" role="alert"></div>
    <button class="btn primary block" type="submit" style="margin-top:12px">${esc(sess ? t('log.saveSession') : t('common.save'))}</button>
    ${!existing && !gps ? `<button type="button" class="btn ghost block" style="margin-top:10px" data-gps>${icon('gps', 'width="18" height="18"')} ${esc(t('log.useGps'))}</button>` : ''}
  </form>`);

  bindFeedback(root, st);
  const val = () => {
    const d = Math.round(parseFloat(String(root.querySelector('#lf-dist').value).replace(',', '.')) * 1000);
    const n = id => Math.max(0, parseInt(root.querySelector(id).value, 10) || 0);
    return { d, s: n('#lf-h') * 3600 + n('#lf-m') * 60 + n('#lf-s') };
  };
  const showPace = () => { const { d, s } = val(); root.querySelector('#lf-pace').textContent = d > 0 && s > 0 ? t('log.paceIs', { p: pace(paceOf(s, d)) }) : ' '; };
  root.addEventListener('input', showPace); showPace();
  on(root, '[data-gps]', 'click', () => go('gps' + (sess ? '?sw=' + sess.id : '')));

  root.querySelector('#log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = root.querySelector('#lf-err'); err.textContent = '';
    const { d, s } = val();
    const startedAt = new Date(root.querySelector('#lf-start').value);
    const elapsedMin = parseInt(root.querySelector('#lf-elapsed').value, 10);
    const hr = parseInt(root.querySelector('#lf-hr').value, 10);
    if (!(d >= 50 && d <= 300000)) return (err.textContent = t('log.errDist'));
    if (!(s >= 30)) return (err.textContent = t('log.errTime'));
    if (s * 1000 < d * 120) return (err.textContent = t('log.errPace'));
    if (!isFinite(startedAt) || startedAt > new Date(Date.now() + 5 * 6e4)) return (err.textContent = t('log.errWhen'));
    const elapsed = elapsedMin > 0 ? elapsedMin * 60 : null;
    if (elapsed && elapsed < s) return (err.textContent = t('log.errElapsed'));
    if (hr && (hr < 30 || hr > 250)) return (err.textContent = t('log.errHr'));

    const row = { id: a.id || gps?.id || uuid(), source, started_at: startedAt.toISOString(), distance_m: d, moving_time_s: s, elapsed_time_s: elapsed,
      rpe: st.rpe || null, avg_hr: hr || null, workout_type: root.querySelector('#lf-type').value,
      title: root.querySelector('#lf-title').value.trim() || null, notes: root.querySelector('#lf-notes').value.trim() || null,
      scheduled_workout_id: sess ? sess.id : a.scheduled_workout_id || null,
      ...(gps ? { route: gps.route || null, splits_s: gps.splits_s || null } : {}) };
    const btn = e.submitter || root.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (!existing && navigator.onLine) {
        const dup = await api.findDuplicate(row.started_at, d, row.id).catch(() => null);
        if (dup && !await confirmSheet(t('log.dupQ'), t('log.dupHelp', { km: km(dup.distance_m), t: fmtTime(dup.started_at) }), t('log.dupSave'))) { btn.disabled = false; return; }
      }
      const link = sess ? { id: sess.id, patch: { status: 'completed', completed_at: new Date().toISOString(), rpe: st.rpe || null, feeling: st.feeling || null, feedback: (st.feedback || '').trim() || null } } : null;
      const { queued } = await api.saveActivity(row, link);
      try { sessionStorage.removeItem(GPS_DRAFT); } catch (x) {}
      if (queued) { toast(t('log.queued')); go('home', true); return; }
      toast(existing ? t('log.updated') : t('log.saved'));
      go('activity/' + row.id, true);          // navigate first: a route change closes any open sheet
      if (sess) await afterComplete(); else await celebrate();
    } catch (x) { err.textContent = friendlyError(x); btn.disabled = false; }
  });
}

/** Ask the server what was earned and celebrate anything new. */
export async function celebrate() {
  const codes = await api.evaluateAchievements();
  const list = codes.map(byCode).filter(Boolean);
  if (!list.length) return;
  const share = navigator.share ? `<button class="btn block" style="margin-top:10px" data-share>${esc(t('badge.share'))}</button>` : '';
  const b = openSheet(`<div class="celebrate">${list.map(x => `<div class="ic">${icon(x.icon)}</div>
      <div class="eyebrow red">${esc(t('badge.new'))}</div><h2 style="margin:6px 0 4px;font-size:30px">${esc(x[lang()][0])}</h2><p class="muted" style="margin:0 0 18px">${esc(x[lang()][1])}</p>`).join('')}
    <button class="btn primary block" data-ok>${esc(t('badge.nice'))}</button>${share}</div>`);
  b.querySelector('[data-ok]').onclick = closeSheet;
  b.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({
    title: 'HITFAT RUN CLUB', text: t('badge.shareText', { b: list.map(x => x[lang()][0]).join(', ') }), url: location.origin + '/run/' }).catch(() => {}));
}

/* ───────── one activity ───────── */
export async function detail(view, id) {
  view.innerHTML = `<header class="topbar"><button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button></header><div id="a-body">${skeleton(3, 120)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('history');
  const body = view.querySelector('#a-body');
  try {
    const a = await api.getActivity(id);
    if (!a) { body.innerHTML = `<div class="card">${emptyState(t('act.missingT'), t('act.missing'))}</div>`; return; }
    const root = mount(body, `<div class="eyebrow">${esc(fmtDateLong(a.started_at))} · ${esc(fmtTime(a.started_at))}</div>
      <h1 style="margin:6px 0 4px">${esc(a.title || t('cat.' + (a.workout_type || 'other')))}</h1>
      <div class="row wrap"><span class="chip">${esc(t('src.' + a.source))}</span>${a.scheduled_workout_id ? `<a class="chip red" href="#/workout/${a.scheduled_workout_id}" style="text-decoration:none">${esc(t('act.planSession'))}</a>` : ''}</div>
      ${a.route && a.route.length > 1 ? `<div class="map" id="a-map" style="margin-top:16px"></div>` : ''}
      <div class="num big" style="margin-top:18px">${km(a.distance_m)}</div><div class="eyebrow">${esc(t('unit.km'))}</div>
      <div class="metrics three" style="margin-top:18px">
        <div class="metric"><div class="num">${pace(a.avg_pace_s_km)}</div><div class="l">${esc(t('stat.pace'))}</div></div>
        <div class="metric"><div class="num">${dur(a.moving_time_s)}</div><div class="l">${esc(t('log.moving'))}</div></div>
        <div class="metric"><div class="num">${a.elapsed_time_s ? dur(a.elapsed_time_s) : '–'}</div><div class="l">${esc(t('log.elapsedShort'))}</div></div>
        <div class="metric"><div class="num">${a.rpe ? a.rpe + '/10' : '–'}</div><div class="l">RPE</div></div>
        <div class="metric"><div class="num">${a.avg_hr || '–'}</div><div class="l">${esc(t('log.hrShort'))}</div></div>
      </div>
      ${a.splits_s && a.splits_s.length ? `<h2>${esc(t('act.splits'))}</h2><div class="card list">${a.splits_s.map((s, i) => `<div class="row between"><span class="num">${i + 1} km</span><span class="num">${pace(s)}</span></div>`).join('')}</div>` : ''}
      ${a.notes ? `<h2>${esc(t('log.notes'))}</h2><p style="margin:0">${esc(a.notes)}</p>` : ''}
      ${a.source === 'gps' ? `<p class="muted tiny" style="margin-top:16px">${esc(t('gps.accuracyNote'))}</p>` : ''}
      <div class="row" style="margin-top:24px">${a.source !== 'strava' ? `<a class="btn block" href="#/log?edit=${a.id}">${icon('edit', 'width="18" height="18"')} ${esc(t('common.edit'))}</a>` : ''}
        <button class="btn ghost block danger" data-del>${esc(t('common.delete'))}</button></div>`);
    on(root, '[data-del]', 'click', async () => {
      if (!await confirmSheet(t('act.delQ'), t('act.delHelp'), t('common.delete'), true)) return;
      try { await api.deleteActivity(a.id); toast(t('act.deleted')); go('history', true); } catch (e) { toast(friendlyError(e)); }
    });
    if (a.route && a.route.length > 1) import('../gps.js').then(g => g.drawRoute(root.querySelector('#a-map'), a.route)).catch(() => {});
  } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => detail(view, id); }
}
