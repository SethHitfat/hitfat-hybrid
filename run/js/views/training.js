// Training: the active plan as a week-by-week calendar.
import * as api from '../api.js';
import { state, go, isStaff } from '../main.js';
import { t, L } from '../i18n.js';
import { esc, on, mount, icon, today, fmtDate, fmtDateLong, weekdayName, skeleton, errorBox, emptyState, toast, confirmSheet, friendlyError } from '../ui.js';
import { planProgress } from '../stats.js';

export const sessionTitle = s => L(s.template.i18n).title;
export function sessionMeta(tp) {
  const bits = [];
  if (tp.duration_min) bits.push(t('wo.mins', { n: tp.duration_min }));
  if (tp.distance_m) bits.push((tp.distance_m / 1000).toFixed(tp.distance_m % 1000 ? 1 : 0) + ' km');
  if (tp.rpe_min) bits.push(t('wo.rpe', { a: tp.rpe_min, b: tp.rpe_max }));
  return bits.join(' · ');
}
export function stepBars(steps) {
  if (!steps || steps.length < 2) return '';
  const tot = steps.reduce((s, x) => s + x.sec, 0);
  return `<div class="steps" aria-hidden="true">${steps.map(x => `<i class="${x.kind}" style="width:${(x.sec / tot * 100).toFixed(2)}%"></i>`).join('')}</div>`;
}

export async function render(view) {
  view.innerHTML = `<header class="topbar"><h1>${esc(t('tab.training'))}</h1>
      ${isStaff(['head_coach', 'running_coach']) ? `<a class="btn sm" href="#/review">${icon('coach', 'width="16" height="16"')} ${esc(t('review.title'))}</a>` : ''}</header>
    <div id="t-body">${skeleton(5, 64)}</div>`;
  const body = view.querySelector('#t-body');
  try { await paint(body); }
  catch (e) { console.error(e); body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view); }
}

async function paint(body) {
  const plan = await api.activePlan();
  if (!plan) {
    body.innerHTML = `<div class="card">${emptyState(t('train.none'), t('train.noneHelp'), `<a class="btn primary" href="#/programs">${esc(t('home.choosePlan'))}</a>`)}</div>`;
    return;
  }
  const pp = planProgress(plan), td = today();
  const byWeek = {};
  plan.sessions.forEach(s => (byWeek[s.template.week] = byWeek[s.template.week] || []).push(s));

  const root = mount(body, `<div class="hero">
      <div class="eyebrow" style="color:#B5B5B5">${esc(t('train.current'))}</div>
      <h2 style="margin:6px 0 4px;font-size:28px">${esc(L(plan.program.i18n).title)}</h2>
      <div class="muted small">${esc(t('train.since', { d: fmtDateLong(plan.start_date) }))} · ${esc(plan.weekdays.map(d => weekdayName(d)).join(', '))}</div>
      <div class="bar" style="margin-top:14px"><i style="width:${(pp.done / pp.total * 100).toFixed(1)}%"></i></div>
      <div class="row between small" style="margin-top:8px"><span>${esc(t('home.weekOf', { w: pp.week, n: pp.weeks }))}</span><span>${esc(t('home.sessionsDone', { d: pp.done, n: pp.total }))}</span></div>
    </div>
    ${pp.missed.length ? `<div class="notice" style="margin-top:12px"><b>${esc(t('plan.missed', { n: pp.missed.length }))}</b> ${esc(t('plan.missedHelp'))}
      <div style="margin-top:10px"><button class="btn sm dark" data-resched>${esc(t('plan.reschedule'))}</button></div></div>` : ''}
    <div class="row wrap" style="margin-top:12px">
      <a class="btn sm" href="#/programs">${esc(t('train.change'))}</a>
      <button class="btn sm ghost" data-resched>${esc(t('plan.reschedule'))}</button>
      <button class="btn sm ghost danger" data-stop>${esc(t('train.stop'))}</button>
    </div>
    ${Object.keys(byWeek).map(w => `<section class="wk"><h3><span>${esc(t('plan.week', { w }))}</span>
        <span class="muted small" style="font-family:var(--font);text-transform:none">${byWeek[w].filter(s => s.status === 'completed').length}/${byWeek[w].length}</span></h3>
      ${byWeek[w].map(s => {
        const missed = s.status === 'planned' && s.scheduled_date < td;
        return `<a class="sess ${s.status} ${missed ? 'missed' : ''} ${s.scheduled_date === td && s.status === 'planned' ? 'today' : ''}" href="#/workout/${s.id}" style="text-decoration:none">
          <div class="date"><div class="w">${esc(fmtDate(s.scheduled_date, { weekday: 'short' }))}</div><div class="d">${new Date(s.scheduled_date + 'T00:00').getDate()}</div></div>
          <div class="grow"><div style="font-weight:700" class="ellipsis">${esc(sessionTitle(s))}</div>
            <div class="muted small">${esc(t('cat.' + s.template.category))} · ${esc(sessionMeta(s.template))}</div></div>
          <div class="st" aria-label="${esc(t('status.' + (missed ? 'missed' : s.status)))}">${s.status === 'completed' ? icon('check', 'width="16" height="16"') : s.status === 'skipped' ? '–' : ''}</div></a>`;
      }).join('')}</section>`).join('')}`);

  on(root, '[data-resched]', 'click', async (e, b) => {
    b.disabled = true;
    try { const n = await api.reschedule(td); toast(t('plan.rescheduled', { n })); await paint(body); }
    catch (err) { toast(friendlyError(err)); b.disabled = false; }
  });
  on(root, '[data-stop]', 'click', async () => {
    if (!await confirmSheet(t('train.stopQ'), t('train.stopHelp'), t('train.stop'), true)) return;
    try { await api.stopPlan(plan.id); toast(t('train.stopped')); await paint(body); } catch (err) { toast(friendlyError(err)); }
  });
}
