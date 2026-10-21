// Programme catalogue, programme page, and the coach's review & publish screen.
import * as api from '../api.js';
import { state, go, back, isStaff } from '../main.js';
import { t, L } from '../i18n.js';
import { esc, on, icon, skeleton, errorBox, emptyState, toast, confirmSheet, friendlyError } from '../ui.js';
import { startForm, recommend } from './onboarding.js';
import { sessionMeta, stepBars } from './training.js';

const backBtn = `<button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button>`;

export async function render(view) {
  view.innerHTML = `<header class="topbar"><div class="row">${backBtn}<h1>${esc(t('prog.title'))}</h1></div></header><div id="p-body">${skeleton(4, 120)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('training');
  const body = view.querySelector('#p-body');
  try {
    const progs = (await api.listPrograms()).filter(p => p.status === 'published');
    if (!progs.length) { body.innerHTML = `<div class="card">${emptyState(t('prog.noneT'), t('prog.none'))}</div>`; return; }
    const rec = state.profile ? recommend({ ...state.profile }, progs).pick : null;
    body.innerHTML = progs.map(p => programCard(p, rec && rec.id === p.id)).join('');
  } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view); }
}
const programCard = (p, recommended) => `<a class="card tap" href="#/program/${p.slug}" style="text-decoration:none">
    <div class="row between"><span class="eyebrow">${esc(t('level.' + p.level))}</span>${recommended ? `<span class="chip red">${esc(t('prog.forYou'))}</span>` : p.tier !== 'free' ? `<span class="chip">${esc(p.tier.toUpperCase())}</span>` : ''}</div>
    <h3 style="margin:8px 0 6px;font-size:24px">${esc(L(p.i18n).title)}</h3>
    <p class="muted small" style="margin:0 0 10px">${esc(L(p.i18n).summary)}</p>
    <div class="row wrap small"><span class="chip">${esc(t('prog.weeks', { n: p.weeks }))}</span><span class="chip">${esc(t('prog.perWeek', { n: p.sessions_per_week }))}</span></div></a>`;

export async function detail(view, slug) {
  view.innerHTML = `<header class="topbar"><div class="row">${backBtn}</div></header><div id="p-body">${skeleton(3, 140)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('programs');
  const body = view.querySelector('#p-body');
  try {
    const p = await api.getProgram(slug);
    if (!p) { body.innerHTML = `<div class="card">${emptyState(t('prog.missingT'), t('prog.missing'))}</div>`; return; }
    const tx = L(p.i18n), weeks = groupWeeks(p.workouts);
    body.innerHTML = `<div class="eyebrow">${esc(t('level.' + p.level))}</div>
      <h1 style="margin:6px 0 10px">${esc(tx.title)}</h1>
      <p style="margin:0 0 8px">${esc(tx.summary)}</p><p class="muted small" style="margin:0 0 14px">${esc(tx.who || '')}</p>
      <div class="row wrap small"><span class="chip">${esc(t('prog.weeks', { n: p.weeks }))}</span><span class="chip">${esc(t('prog.perWeek', { n: p.sessions_per_week }))}</span>
        <span class="chip">${esc(t('prog.sessions', { n: p.workouts.length }))}</span></div>
      ${p.status !== 'published' ? `<div class="notice small" style="margin-top:14px"><b>${esc(t('status.' + p.status))}.</b> ${esc(t('review.notLive'))}</div>` : ''}
      ${p.status === 'published' && p.workouts.length ? `<div class="card" style="margin-top:18px"><h3>${esc(t('prog.start'))}</h3><div id="start-box"></div></div>` : ''}
      <h2>${esc(t('prog.inside'))}</h2>
      ${Object.entries(weeks).map(([w, list]) => `<section class="wk"><h3>${esc(t('plan.week', { w }))}</h3>
        ${list.map(x => `<div class="sess"><div class="grow"><div style="font-weight:700">${esc(L(x.i18n).title)}</div>
          <div class="muted small">${esc(t('cat.' + x.category))} · ${esc(sessionMeta(x))}</div>${stepBars(x.steps)}</div></div>`).join('')}</section>`).join('')}`;
    const box = body.querySelector('#start-box');
    if (box) startForm(box, p, state.profile?.preferred_days, () => go('training'));
  } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => detail(view, slug); }
}
const groupWeeks = ws => ws.reduce((o, x) => ((o[x.week] = o[x.week] || []).push(x), o), {});

/* ───────── coach review ─────────
   Running coaches see drafts and send them for review; only a head coach
   (or super admin) publishes. The database enforces the same rule. */
export async function review(view) {
  view.innerHTML = `<header class="topbar"><div class="row">${backBtn}<h1>${esc(t('review.title'))}</h1></div></header><div id="r-body">${skeleton(4, 90)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('training');
  const body = view.querySelector('#r-body');
  if (!isStaff(['head_coach', 'running_coach'])) { body.innerHTML = `<div class="card">${emptyState(t('review.noAccessT'), t('review.noAccess'))}</div>`; return; }
  const canPublish = isStaff(['head_coach']);
  const paint = async () => {
    const progs = await api.listPrograms();
    body.innerHTML = `<p class="muted small" style="margin-top:0">${esc(t(canPublish ? 'review.helpHead' : 'review.helpCoach'))}</p>` +
      progs.map(p => `<div class="card"><div class="row between"><span class="chip ${p.status === 'published' ? 'ok' : p.status === 'review' ? 'warn' : ''}">${esc(t('status.' + p.status))}</span>
        <span class="muted tiny">${esc(t('prog.weeks', { n: p.weeks }))} · ${esc(t('prog.perWeek', { n: p.sessions_per_week }))}</span></div>
        <h3 style="margin:10px 0 6px">${esc(L(p.i18n).title)}</h3>
        <div class="row wrap"><a class="btn sm" href="#/program/${p.slug}">${esc(t('review.read'))}</a>
          ${p.status === 'draft' ? `<button class="btn sm dark" data-set="review" data-id="${p.id}">${esc(t('review.send'))}</button>` : ''}
          ${canPublish && p.status !== 'published' ? `<button class="btn sm primary" data-set="published" data-id="${p.id}">${esc(t('review.publish'))}</button>` : ''}
          ${canPublish && p.status === 'published' ? `<button class="btn sm ghost" data-set="review" data-id="${p.id}">${esc(t('review.unpublish'))}</button>` : ''}</div></div>`).join('');
  };
  on(body, '[data-set]', 'click', async (e, b) => {
    const to = b.dataset.set;
    if (to === 'published' && !await confirmSheet(t('review.publishQ'), t('review.publishHelp'), t('review.publish'))) return;
    b.disabled = true;
    try { await api.setProgramStatus(b.dataset.id, to); toast(t('review.saved')); await paint(); }
    catch (err) { toast(friendlyError(err)); b.disabled = false; }
  });
  try { await paint(); } catch (e) { body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => review(view); }
}
