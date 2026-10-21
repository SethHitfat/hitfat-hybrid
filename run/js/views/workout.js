// One scheduled session: what to do, why, and how it went.
import * as api from '../api.js';
import { go, back } from '../main.js';
import { t, L } from '../i18n.js';
import { esc, on, mount, icon, fmtDateLong, today, skeleton, errorBox, emptyState, toast, confirmSheet, openSheet, closeSheet, friendlyError } from '../ui.js';
import { stepBars } from './training.js';

export const RUN_CATS = ['easy', 'recovery', 'long', 'tempo', 'threshold', 'interval', 'hill', 'run_walk'];

export async function render(view, id) {
  view.innerHTML = `<header class="topbar"><button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button></header><div id="w-body">${skeleton(3, 120)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('training');
  const body = view.querySelector('#w-body');
  try { await paint(body, id); }
  catch (e) { console.error(e); body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view, id); }
}

async function paint(body, id) {
  const s = await api.getSession(id);
  if (!s) { body.innerHTML = `<div class="card">${emptyState(t('wo.missingT'), t('wo.missing'))}</div>`; return; }
  const tp = s.template, x = L(tp.i18n), prog = s.enrollment?.program, isRun = RUN_CATS.includes(tp.category);
  const missed = s.status === 'planned' && s.scheduled_date < today();
  const act = s.activity_id ? await api.getActivity(s.activity_id).catch(() => null) : null;

  const root = mount(body, `
    <div class="eyebrow">${esc(prog ? L(prog.i18n).title : '')} · ${esc(t('plan.weekSession', { w: tp.week, s: tp.session }))}</div>
    <h1 style="margin:6px 0 8px">${esc(x.title)}</h1>
    <div class="row wrap"><span class="chip red">${esc(t('cat.' + tp.category))}</span>
      <span class="chip ${s.status === 'completed' ? 'ok' : missed ? 'warn' : ''}">${esc(t('status.' + (missed ? 'missed' : s.status)))}</span>
      <span class="muted small">${esc(fmtDateLong(s.scheduled_date))}</span></div>

    <div class="card" style="margin-top:16px"><div class="metrics">
      ${tp.duration_min ? `<div class="metric"><div class="num">${tp.duration_min}<span class="small"> min</span></div><div class="l">${esc(t('wo.duration'))}</div></div>` : ''}
      ${tp.distance_m ? `<div class="metric"><div class="num">${(tp.distance_m / 1000).toFixed(tp.distance_m % 1000 ? 1 : 0)}<span class="small"> km</span></div><div class="l">${esc(t('wo.distance'))}</div></div>` : ''}
      ${tp.intensity ? `<div class="metric"><div class="num" style="font-size:22px">${esc(t('int.' + tp.intensity))}</div><div class="l">${esc(t('wo.intensity'))}</div></div>` : ''}
      ${tp.rpe_min ? `<div class="metric"><div class="num">${tp.rpe_min}–${tp.rpe_max}<span class="small"> /10</span></div><div class="l">${esc(t('wo.rpeTarget'))}</div></div>` : ''}
      ${tp.hr_zone ? `<div class="metric"><div class="num">Z${tp.hr_zone}</div><div class="l">${esc(t('wo.hrZone'))}</div></div>` : ''}
      ${tp.rest_interval ? `<div class="metric"><div class="num" style="font-size:20px">${esc(tp.rest_interval)}</div><div class="l">${esc(t('wo.rest'))}</div></div>` : ''}
    </div>${stepBars(tp.steps)}</div>

    ${x.objective ? `<h2>${esc(t('wo.objective'))}</h2><p style="margin:0">${esc(x.objective)}</p>` : ''}
    <h2>${esc(t('wo.howto'))}</h2>
    ${x.warmup ? `<div class="wblock"><div class="eyebrow">${esc(t('wo.warmup'))}</div>${esc(x.warmup)}</div>` : ''}
    ${x.main ? `<div class="wblock main"><div class="eyebrow red">${esc(t('wo.main'))}</div>${esc(x.main)}</div>` : ''}
    ${x.cooldown ? `<div class="wblock"><div class="eyebrow">${esc(t('wo.cooldown'))}</div>${esc(x.cooldown)}</div>` : ''}
    ${x.coach ? `<div class="card" style="margin-top:16px"><div class="row" style="align-items:flex-start">${icon('coach', 'width="22" height="22" style="flex:none;color:var(--red)"')}
      <div><div class="eyebrow">${esc(t('wo.coach'))}</div><div style="margin-top:4px">${esc(x.coach)}</div></div></div></div>` : ''}
    ${tp.video_url ? video(tp.video_url) : ''}

    <div style="margin-top:24px">
    ${s.status === 'planned' ? `
      ${isRun ? `<button class="btn primary block" data-log>${icon('check', 'width="18" height="18"')} ${esc(t('wo.doneLog'))}</button>
        <button class="btn block" style="margin-top:10px" data-gps>${icon('gps', 'width="18" height="18"')} ${esc(t('wo.gps'))}</button>`
        : `<button class="btn primary block" data-done>${esc(t('wo.markDone'))}</button>`}
      <button class="btn ghost block" style="margin-top:10px" data-skip>${esc(t('wo.skip'))}</button>`
    : s.status === 'completed' ? `<div class="card">
        <div class="eyebrow">${esc(t('wo.result'))}</div>
        <div class="row wrap" style="margin-top:8px">${s.rpe ? `<span class="chip">RPE ${s.rpe}/10</span>` : ''}${s.feeling ? `<span class="chip">${esc(t('feel.' + s.feeling))}</span>` : ''}</div>
        ${s.feedback ? `<p style="margin:10px 0 0">${esc(s.feedback)}</p>` : ''}
        ${act ? `<a class="btn sm" style="margin-top:12px" href="#/activity/${act.id}">${esc(t('wo.seeRun', { km: (act.distance_m / 1000).toFixed(2) }))}</a>` : ''}
        ${coachTip(s)}
      </div><button class="btn ghost block" style="margin-top:10px" data-undo>${esc(t('wo.undo'))}</button>`
    : `<button class="btn block" data-undo>${esc(t('wo.unskip'))}</button>`}
    </div>`);

  on(root, '[data-log]', 'click', () => go('log?sw=' + s.id));
  on(root, '[data-gps]', 'click', () => go('gps?sw=' + s.id));
  on(root, '[data-skip]', 'click', async () => {
    if (!await confirmSheet(t('wo.skipQ'), t('wo.skipHelp'), t('wo.skip'))) return;
    try { await api.updateSession(s.id, { status: 'skipped' }); toast(t('wo.skipped')); await paint(body, id); } catch (e) { toast(friendlyError(e)); }
  });
  on(root, '[data-undo]', 'click', async () => {
    try { await api.updateSession(s.id, { status: 'planned', completed_at: null, rpe: null, feeling: null, feedback: null, activity_id: null }); await paint(body, id); }
    catch (e) { toast(friendlyError(e)); }
  });
  on(root, '[data-done]', 'click', () => feedbackSheet(async patch => {
    await api.updateSession(s.id, { status: 'completed', completed_at: new Date().toISOString(), ...patch });
    await afterComplete(); await paint(body, id);
  }));
}

/* Feedback shapes the next message, never the plan itself: plan changes stay
   with the coach until rule-based adjustments are validated. */
function coachTip(s) {
  const k = s.feeling === 'pain' ? 'pain' : s.feeling === 'too_hard' || (s.rpe && s.template.rpe_max && s.rpe > s.template.rpe_max + 1) ? 'hard'
    : s.feeling === 'too_easy' ? 'easy' : null;
  return k ? `<div class="notice ${k === 'easy' ? 'info' : ''} small" style="margin-top:12px">${esc(t('tip.' + k))}</div>` : '';
}

export function feedbackFields(pre = {}) {
  return `<label for="fb-rpe">${esc(t('log.rpe'))}: <b id="fb-rpe-v">${pre.rpe || 5}</b>/10 · <span id="fb-rpe-l">${esc(t('rpe.' + (pre.rpe || 5)))}</span></label>
    <input type="range" id="fb-rpe" min="1" max="10" value="${pre.rpe || 5}">
    <label>${esc(t('log.feeling'))}</label>
    <div class="choices two">${['too_easy', 'right', 'too_hard', 'pain'].map(f => `<button type="button" class="choice" data-feel="${f}" aria-pressed="${pre.feeling === f}"><span class="t">${esc(t('feel.' + f))}</span></button>`).join('')}</div>
    <div id="fb-pain" class="notice small ${pre.feeling === 'pain' ? '' : 'hide'}" style="margin-top:10px">${esc(t('tip.pain'))}</div>
    <label for="fb-text">${esc(t('log.feedback'))}</label><textarea id="fb-text" rows="2" maxlength="1000">${esc(pre.feedback || '')}</textarea>`;
}
export function bindFeedback(root, st) {
  st.rpe = st.rpe || 5;
  root.addEventListener('input', e => { if (e.target.id === 'fb-rpe') { st.rpe = +e.target.value; root.querySelector('#fb-rpe-v').textContent = st.rpe; root.querySelector('#fb-rpe-l').textContent = t('rpe.' + st.rpe); } if (e.target.id === 'fb-text') st.feedback = e.target.value; });
  on(root, '[data-feel]', 'click', (e, b) => { st.feeling = st.feeling === b.dataset.feel ? null : b.dataset.feel;
    root.querySelectorAll('[data-feel]').forEach(x => x.setAttribute('aria-pressed', x.dataset.feel === st.feeling));
    root.querySelector('#fb-pain').classList.toggle('hide', st.feeling !== 'pain'); });
}
function feedbackSheet(save) {
  const st = {};
  const b = openSheet(`<h3>${esc(t('wo.howWas'))}</h3>${feedbackFields()}<div class="error" id="fb-err"></div>
    <button class="btn primary block" style="margin-top:14px" data-save>${esc(t('common.save'))}</button>`);
  bindFeedback(b, st);
  b.querySelector('[data-save]').onclick = async e => {
    e.target.disabled = true;
    try { await save({ rpe: st.rpe, feeling: st.feeling || null, feedback: (st.feedback || '').trim() || null }); closeSheet(); }
    catch (err) { b.querySelector('#fb-err').textContent = friendlyError(err); e.target.disabled = false; }
  };
}

/** Close the plan when its last session is done, then check for new badges. */
export async function afterComplete() {
  try {
    const plan = await api.activePlan();
    if (plan && plan.sessions.length && plan.sessions.every(x => x.status !== 'planned')) await api.completePlan(plan.id);
  } catch (e) { console.warn(e); }
  const { celebrate } = await import('./log.js');
  await celebrate();
}

function video(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `<div style="margin-top:16px;border-radius:var(--r);overflow:hidden;aspect-ratio:16/9;background:#000">
      <iframe src="https://player.vimeo.com/video/${m[1]}?dnt=1&title=0&byline=0&portrait=0" style="width:100%;height:100%;border:0" allow="fullscreen; picture-in-picture" title="${esc(t('wo.video'))}" loading="lazy"></iframe></div>`
    : `<a class="btn sm" style="margin-top:16px" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('wo.video'))}</a>`;
}
