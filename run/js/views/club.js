// Club: chapters, upcoming community runs, RSVP, and the captain's tools.
import * as api from '../api.js';
import { state, go, back, isStaff, canManageChapter } from '../main.js';
import { t } from '../i18n.js';
import { esc, on, mount, icon, fmtDate, fmtDateLong, fmtTime, localInput, skeleton, errorBox, emptyState, toast, confirmSheet, friendlyError } from '../ui.js';

const backBtn = `<button class="icon-btn" data-back aria-label="${esc(t('common.back'))}">${icon('back')}</button>`;

export async function render(view) {
  view.innerHTML = `<header class="topbar"><h1>${esc(t('tab.club'))}</h1>
      ${isStaff() ? `<a class="btn sm primary" href="#/event/new">${icon('plus', 'width="16" height="16"')} ${esc(t('club.create'))}</a>` : ''}</header>
    <div id="c-body">${skeleton(4, 100)}</div>`;
  const body = view.querySelector('#c-body');
  try { await paint(body); }
  catch (e) { console.error(e); body.innerHTML = errorBox(e, true); body.querySelector('[data-retry]').onclick = () => render(view); }
}

async function paint(body) {
  const [chapters, mine, events, history] = await Promise.all([api.listChapters(), api.myChapters(), api.listEvents({ limit: 40 }), api.myRunHistory().catch(() => [])]);
  const ids = events.map(e => e.id);
  const [counts, regs] = await Promise.all([api.eventCounts(ids), api.myRegistrations(ids)]);
  const going = new Set(regs.filter(r => r.status === 'going').map(r => r.event_id));
  const member = new Set(mine.map(m => m.chapter_id));
  const past = history.filter(h => h.event && Date.parse(h.event.starts_at) < Date.now()).sort((a, b) => b.event.starts_at.localeCompare(a.event.starts_at));

  const root = mount(body, `
    ${chapters.map(c => `<div class="hero ${member.has(c.id) ? '' : 'red'}" style="margin-bottom:12px">
      <div class="eyebrow" style="color:${member.has(c.id) ? '#B5B5B5' : '#FFE3E5'}">${esc(t('club.chapter'))}</div>
      <h2 style="margin:6px 0 4px;font-size:26px">${esc(c.name)}</h2>
      <div class="muted small">${esc([c.city, c.state].filter(Boolean).join(', '))}</div>
      <div style="margin-top:14px">${member.has(c.id)
        ? `<span class="chip ok">${icon('check', 'width="14" height="14"')} ${esc(t('club.member'))}</span> <button class="btn sm ghost" style="color:#fff;border-color:#444;margin-left:6px" data-leave="${c.id}">${esc(t('club.leave'))}</button>`
        : `<button class="btn sm" style="background:#fff;color:#111" data-join="${c.id}">${esc(t('club.join'))}</button>`}</div></div>`).join('')}

    <h2>${esc(t('club.upcoming'))}</h2>
    ${events.length ? events.map(e => eventCard(e, counts[e.id] || 0, going.has(e.id))).join('')
      : `<div class="card">${emptyState(t('club.noEventsT'), t('club.noEvents'))}</div>`}

    <h2>${esc(t('club.myRuns'))}</h2>
    ${past.length ? `<div class="card list">${past.map(h => `<a href="#/event/${h.event.id}" class="row between" style="text-decoration:none">
        <div class="grow"><div style="font-weight:700" class="ellipsis">${esc(h.event.title)}</div><div class="muted small">${esc(fmtDate(h.event.starts_at))} · ${esc(h.event.meeting_point)}</div></div>
        <span class="chip ${h.checked_in_at ? 'ok' : ''}">${esc(h.checked_in_at ? t('club.attended') : t('club.rsvped'))}</span></a>`).join('')}</div>`
      : `<div class="card muted">${esc(t('club.noHistory'))}</div>`}`);

  on(root, '[data-join]', 'click', async (e, b) => { b.disabled = true; try { await api.joinChapter(b.dataset.join); toast(t('club.joined')); await paint(body); } catch (x) { toast(friendlyError(x)); b.disabled = false; } });
  on(root, '[data-leave]', 'click', async (e, b) => {
    if (!await confirmSheet(t('club.leaveQ'), t('club.leaveHelp'), t('club.leave'))) return;
    try { await api.leaveChapter(b.dataset.leave); await paint(body); } catch (x) { toast(friendlyError(x)); }
  });
}

function eventCard(e, n, going) {
  const left = e.capacity ? Math.max(0, e.capacity - n) : null;
  return `<a class="card tap" href="#/event/${e.id}" style="text-decoration:none">
    <div class="row between"><span class="chip red">${esc(fmtDate(e.starts_at))} · ${esc(fmtTime(e.starts_at))}</span>
      ${e.status === 'cancelled' ? `<span class="chip warn">${esc(t('club.cancelled'))}</span>` : going ? `<span class="chip ok">${icon('check', 'width="14" height="14"')} ${esc(t('club.going'))}</span>` : left === 0 ? `<span class="chip">${esc(t('club.fullShort'))}</span>` : ''}</div>
    <h3 style="margin:10px 0 4px;font-size:20px">${esc(e.title)}</h3>
    <div class="muted small row" style="gap:6px">${icon('pin', 'width="16" height="16" style="flex:none"')}<span class="ellipsis">${esc(e.meeting_point)}</span></div>
    <div class="muted small" style="margin-top:4px">${esc(t('club.goingN', { n }))}${left != null ? ' · ' + esc(t('club.spots', { n: left })) : ''}${e.distance_text ? ' · ' + esc(e.distance_text) : ''}</div></a>`;
}

/* ───────── one event ───────── */
export async function event(view, id) {
  view.innerHTML = `<header class="topbar">${backBtn}</header><div id="e-body">${skeleton(3, 120)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('club');
  const body = view.querySelector('#e-body');
  const paintE = async () => {
    const e = await api.getEvent(id);
    if (!e) { body.innerHTML = `<div class="card">${emptyState(t('club.missingT'), t('club.missing'))}</div>`; return; }
    const [counts, regs] = await Promise.all([api.eventCounts([e.id]), api.myRegistrations([e.id])]);
    const n = counts[e.id] || 0, going = regs.some(r => r.status === 'going'), left = e.capacity ? Math.max(0, e.capacity - n) : null;
    const ended = Date.parse(e.starts_at) + e.duration_min * 6e4 < Date.now();
    const staff = canManageChapter(e.chapter_id);
    const guests = staff ? await api.guestList(e.id).catch(() => null) : null;
    const root = mount(body, `<div class="eyebrow">${esc(e.chapter?.name || '')}</div>
      <h1 style="margin:6px 0 12px">${esc(e.title)}</h1>
      ${e.status === 'cancelled' ? `<div class="notice" style="margin-bottom:12px"><b>${esc(t('club.cancelled'))}.</b> ${esc(t('club.cancelledHelp'))}</div>` : ''}
      <div class="card list">
        <div class="row">${icon('calendar', 'width="20" height="20" style="flex:none;color:var(--red)"')}<div><div style="font-weight:700">${esc(fmtDateLong(e.starts_at))}</div><div class="muted small">${esc(fmtTime(e.starts_at))} · ${esc(t('wo.mins', { n: e.duration_min }))}</div></div></div>
        <div class="row">${icon('pin', 'width="20" height="20" style="flex:none;color:var(--red)"')}<div class="grow"><div style="font-weight:700">${esc(e.meeting_point)}</div>
          ${e.map_url ? `<a class="link small" href="${esc(e.map_url)}" target="_blank" rel="noopener">${esc(t('club.openMap'))}</a>` : ''}</div></div>
        ${e.distance_text || e.pace_groups ? `<div class="row">${icon('route', 'width="20" height="20" style="flex:none;color:var(--red)"')}<div>${e.distance_text ? `<div style="font-weight:700">${esc(e.distance_text)}</div>` : ''}${e.pace_groups ? `<div class="muted small">${esc(t('club.paceGroups'))}: ${esc(e.pace_groups)}</div>` : ''}</div></div>` : ''}
        ${e.leader_name ? `<div class="row">${icon('coach', 'width="20" height="20" style="flex:none;color:var(--red)"')}<div><div class="muted small">${esc(t('club.leader'))}</div><div style="font-weight:700">${esc(e.leader_name)}</div></div></div>` : ''}
        <div class="row">${icon('people', 'width="20" height="20" style="flex:none;color:var(--red)"')}<div>${esc(t('club.goingN', { n }))}${left != null ? ` · ${esc(t('club.spots', { n: left }))}` : ''}</div></div>
      </div>
      ${e.description ? `<h2>${esc(t('club.instructions'))}</h2><p style="margin:0;white-space:pre-line">${esc(e.description)}</p>` : ''}
      <div class="error" id="e-err" role="alert"></div>
      <div style="margin-top:20px">${e.status !== 'scheduled' || ended ? '' : going
        ? `<div class="card row" style="background:var(--ok-soft)">${icon('check', 'width="22" height="22" style="color:var(--ok)"')}<div class="grow" style="font-weight:700">${esc(t('club.youreIn'))}</div></div>
           <button class="btn ghost block" style="margin-top:10px" data-rsvp="0">${esc(t('club.cancelRsvp'))}</button>`
        : left === 0 ? `<button class="btn block" disabled>${esc(t('club.full'))}</button>`
        : `<button class="btn primary block" data-rsvp="1">${esc(t('club.rsvp'))}</button>`}
        ${ended && going ? `<div class="card muted">${esc(t('club.thanks'))}</div>` : ''}</div>
      ${staff ? `<h2>${esc(t('club.staffTools'))}</h2>
        <div class="row wrap"><a class="btn sm" href="#/event/${e.id}/edit">${icon('edit', 'width="16" height="16"')} ${esc(t('common.edit'))}</a>
          ${e.status === 'scheduled' ? `<button class="btn sm ghost danger" data-cancel>${esc(t('club.cancelEvent'))}</button>` : `<button class="btn sm ghost" data-restore>${esc(t('club.restore'))}</button>`}</div>
        <h3 style="margin:18px 0 8px">${esc(t('club.guests', { n: guests ? guests.length : 0 }))}</h3>
        ${guests && guests.length ? `<div class="card list">${guests.map((g, i) => `<div class="row between"><span>${i + 1}. ${esc(g.name)}</span><span class="muted tiny">${esc(fmtDate(g.created_at))}</span></div>`).join('')}</div>` : `<div class="card muted small">${esc(t('club.noGuests'))}</div>`}` : ''}`);
    on(root, '[data-rsvp]', 'click', async (ev, b) => {
      const yes = b.dataset.rsvp === '1'; b.disabled = true;
      if (!yes && !await confirmSheet(t('club.cancelQ'), t('club.cancelHelp'), t('club.cancelRsvp'))) { b.disabled = false; return; }
      try {
        await api.rsvp(e.id, yes); toast(yes ? t('club.rsvpDone') : t('club.rsvpCancelled'));
        await paintE();
        if (yes) { const { celebrate } = await import('./log.js'); celebrate(); }
      } catch (x) { root.querySelector('#e-err').textContent = friendlyError(x); b.disabled = false; }
    });
    on(root, '[data-cancel]', 'click', async () => {
      if (!await confirmSheet(t('club.cancelEventQ'), t('club.cancelEventHelp'), t('club.cancelEvent'), true)) return;
      try { await api.updateEvent(e.id, { status: 'cancelled' }); await paintE(); } catch (x) { toast(friendlyError(x)); }
    });
    on(root, '[data-restore]', 'click', async () => { try { await api.updateEvent(e.id, { status: 'scheduled' }); await paintE(); } catch (x) { toast(friendlyError(x)); } });
  };
  try { await paintE(); } catch (x) { body.innerHTML = errorBox(x, true); body.querySelector('[data-retry]').onclick = () => event(view, id); }
}

/* ───────── create / edit (captains & coaches) ───────── */
export async function edit(view, id) {
  view.innerHTML = `<header class="topbar"><div class="row">${backBtn}<h1>${esc(id ? t('club.editTitle') : t('club.create'))}</h1></div></header><div id="ed-body">${skeleton(5, 56)}</div>`;
  view.querySelector('[data-back]').onclick = () => back('club');
  const body = view.querySelector('#ed-body');
  try {
    const [chapters, e] = await Promise.all([api.listChapters(), id ? api.getEvent(id) : null]);
    const allowed = chapters.filter(c => canManageChapter(c.id));
    if (!allowed.length || (id && (!e || !canManageChapter(e.chapter_id)))) { body.innerHTML = `<div class="card">${emptyState(t('review.noAccessT'), t('club.noAccess'))}</div>`; return; }
    const v = e || { duration_min: 60, chapter_id: allowed[0].id };
    const root = mount(body, `<form id="ev-form" novalidate>
      <label for="ev-chapter">${esc(t('club.chapter'))}</label><select id="ev-chapter">${allowed.map(c => `<option value="${c.id}" ${c.id === v.chapter_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label for="ev-title">${esc(t('club.f.title'))}</label><input id="ev-title" maxlength="100" required value="${esc(v.title || '')}" placeholder="${esc(t('club.f.titlePh'))}">
      <div class="row"><div class="grow"><label for="ev-start">${esc(t('club.f.start'))}</label><input id="ev-start" type="datetime-local" required value="${v.starts_at ? localInput(v.starts_at) : ''}"></div>
        <div style="width:110px"><label for="ev-dur">${esc(t('club.f.duration'))}</label><input id="ev-dur" type="number" min="10" max="600" inputmode="numeric" value="${v.duration_min}"></div></div>
      <label for="ev-place">${esc(t('club.f.place'))}</label><input id="ev-place" maxlength="200" required value="${esc(v.meeting_point || '')}" placeholder="${esc(t('club.f.placePh'))}">
      <label for="ev-map">${esc(t('club.f.map'))}</label><input id="ev-map" type="url" inputmode="url" value="${esc(v.map_url || '')}" placeholder="https://maps.app.goo.gl/…">
      <label for="ev-dist">${esc(t('club.f.distance'))}</label><input id="ev-dist" maxlength="80" value="${esc(v.distance_text || '')}" placeholder="${esc(t('club.f.distancePh'))}">
      <label for="ev-pace">${esc(t('club.paceGroups'))}</label><input id="ev-pace" maxlength="200" value="${esc(v.pace_groups || '')}" placeholder="${esc(t('club.f.pacePh'))}">
      <label for="ev-leader">${esc(t('club.leader'))}</label><input id="ev-leader" maxlength="80" value="${esc(v.leader_name || '')}">
      <label for="ev-cap">${esc(t('club.f.capacity'))}</label><input id="ev-cap" type="number" min="1" max="5000" inputmode="numeric" value="${v.capacity || ''}" placeholder="${esc(t('club.f.noLimit'))}">
      <label for="ev-desc">${esc(t('club.instructions'))}</label><textarea id="ev-desc" rows="4" maxlength="3000" placeholder="${esc(t('club.f.descPh'))}">${esc(v.description || '')}</textarea>
      <div class="error" id="ev-err" role="alert"></div>
      <button class="btn primary block" type="submit" style="margin-top:12px">${esc(id ? t('common.save') : t('club.publish'))}</button></form>`);
    root.querySelector('#ev-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const g = s => root.querySelector(s).value.trim(), err = root.querySelector('#ev-err');
      const start = new Date(g('#ev-start')), cap = parseInt(g('#ev-cap'), 10), durMin = parseInt(g('#ev-dur'), 10) || 60;
      if (g('#ev-title').length < 3) return (err.textContent = t('club.f.errTitle'));
      if (!isFinite(start)) return (err.textContent = t('club.f.errStart'));
      if (!id && start < Date.now()) return (err.textContent = t('club.f.errPast'));
      if (g('#ev-place').length < 3) return (err.textContent = t('club.f.errPlace'));
      if (g('#ev-map') && !/^https:\/\//.test(g('#ev-map'))) return (err.textContent = t('club.f.errMap'));
      const row = { chapter_id: g('#ev-chapter'), title: g('#ev-title'), starts_at: start.toISOString(), duration_min: durMin, meeting_point: g('#ev-place'),
        map_url: g('#ev-map') || null, distance_text: g('#ev-dist') || null, pace_groups: g('#ev-pace') || null, leader_name: g('#ev-leader') || null,
        capacity: cap > 0 ? cap : null, description: g('#ev-desc') || null };
      const btn = ev.submitter || root.querySelector('[type=submit]'); btn.disabled = true;
      try { const saved = id ? await api.updateEvent(id, row) : await api.createEvent(row); toast(t('club.saved')); go('event/' + saved.id, true); }
      catch (x) { err.textContent = friendlyError(x); btn.disabled = false; }
    });
  } catch (x) { body.innerHTML = errorBox(x, true); body.querySelector('[data-retry]').onclick = () => edit(view, id); }
}
