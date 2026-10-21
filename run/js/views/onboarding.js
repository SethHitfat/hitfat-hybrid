// Ten questions, asked one at a time, that adapt to the answers so far.
// Ends with a recommended plan the runner can start on the spot.
import * as api from '../api.js';
import { state, go, loadRunner } from '../main.js';
import { t, L, lang } from '../i18n.js';
import { esc, on, today, ymd, parseYmd, weekdayShort, weekdayName, fmtDateLong, toast, friendlyError } from '../ui.js';

const GOALS = ['start', 'first_5k', 'improve_5k', 'first_10k', 'improve_10k', 'half', 'marathon', 'hyrox', 'fitness'];
const EXPERIENCE = ['none', 'some', 'regular', 'experienced'];
const ABILITY = [0, 5, 10, 20, 30, 45, 60];
const VOLUME = [[0, '0'], [3, '<5'], [10, '5–15'], [22, '15–30'], [40, '30+']];
const TARGETS = [[5000, '5KM'], [10000, '10KM'], [21097, '21KM'], [42195, '42KM'], [0, 'none']];
const LOCATIONS = ['road', 'track', 'treadmill', 'trail', 'mixed'];
const GOAL_TARGET = { first_5k: 5000, improve_5k: 5000, first_10k: 10000, improve_10k: 10000, half: 21097, marathon: 42195 };

let a = null;   // answers in progress
let step = 0;

/* Which questions apply depends on earlier answers: nobody who has never run
   is asked for a recent race result. */
const STEPS = [
  { k: 'goal' }, { k: 'experience' }, { k: 'ability' }, { k: 'days' }, { k: 'target' },
  { k: 'race_date', when: () => a.target_distance_m > 0 },
  { k: 'volume', when: () => a.experience !== 'none' },
  { k: 'recent', when: () => a.experience === 'regular' || a.experience === 'experienced' },
  { k: 'limits' }, { k: 'location' }, { k: 'result' },
];
const active = () => STEPS.filter(s => !s.when || s.when());

export async function render(view, _, params) {
  if (!a || params.get('restart')) {
    const p = state.profile || {};
    a = { goal: p.goal || null, experience: p.experience || null, continuous_run_min: p.continuous_run_min ?? null,
      preferred_days: p.preferred_days || [], target_distance_m: p.target_distance_m ?? null, race_date: p.race_date || '',
      weekly_km_recent: p.weekly_km_recent ?? null, recent_race_m: p.recent_race_m || null, recent_race_s: p.recent_race_s || null,
      has_limitations: p.has_limitations ?? null, limitations: p.limitations || '', consent: !!p.health_consent_at,
      training_location: p.training_location || null };
    step = 0;
  }
  paint(view);
}

function paint(view) {
  const steps = active(); step = Math.min(step, steps.length - 1);
  const s = steps[step], isResult = s.k === 'result';
  view.innerHTML = `<section class="ob">
    <div class="row between"><button class="icon-btn" data-back aria-label="${esc(t('common.back'))}" ${step === 0 ? 'style="visibility:hidden"' : ''}>${back}</button>
      <div class="wordmark">HITFAT <b>RUN</b></div><span style="width:44px"></span></div>
    <div class="progress" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="body" id="ob-body">${isResult ? '' : question(s.k)}</div>
    ${isResult ? '' : `<div class="foot">
      ${optional(s.k) ? `<button class="btn ghost" data-skip>${esc(t('ob.skip'))}</button>` : ''}
      <button class="btn primary block" data-next ${valid(s.k) ? '' : 'disabled'}>${esc(t('common.continue'))}</button></div>`}
  </section>`;
  if (isResult) return result(view);
  const host = view; view = view.firstElementChild;   // listeners bind to this render only
  const refresh = () => { const b = view.querySelector('[data-next]'); if (b) b.disabled = !valid(s.k); };
  on(view, '[data-pick]', 'click', (e, b) => {
    const [field, raw] = [b.dataset.pick, b.dataset.v];
    const v = raw === '' ? null : raw === 'true' ? true : raw === 'false' ? false : isNaN(raw) ? raw : Number(raw);
    a[field] = v;
    if (field === 'goal' && GOAL_TARGET[v] && a.target_distance_m == null) a.target_distance_m = GOAL_TARGET[v];
    view.querySelectorAll(`[data-pick="${field}"]`).forEach(x => x.setAttribute('aria-pressed', x === b));
    if (field === 'has_limitations') view.querySelector('#lim-more').classList.toggle('hide', !v);
    refresh();
  });
  on(view, '[data-day]', 'click', (e, b) => {
    const d = +b.dataset.day, set = new Set(a.preferred_days); set.has(d) ? set.delete(d) : set.add(d);
    a.preferred_days = [...set].sort(); b.setAttribute('aria-pressed', set.has(d));
    view.querySelector('#days-n').textContent = t('ob.daysN', { n: set.size }); refresh();
  });
  view.addEventListener('input', e => {
    if (e.target.id === 'race-date') a.race_date = e.target.value;
    if (e.target.id === 'lim-text') a.limitations = e.target.value;
    if (e.target.id === 'lim-consent') a.consent = e.target.checked;
    if (e.target.id === 'rr-dist') a.recent_race_m = Number(e.target.value) || null;
    if (/^rr-[hms]$/.test(e.target.id)) {
      const g = id => Number(view.querySelector(id).value) || 0;
      a.recent_race_s = g('#rr-h') * 3600 + g('#rr-m') * 60 + g('#rr-s') || null;
    }
    refresh();
  });
  view.addEventListener('change', e => { if (e.target.id === 'lim-consent') { a.consent = e.target.checked; refresh(); } });
  on(view, '[data-next]', 'click', () => { step++; paint(host); });
  on(view, '[data-skip]', 'click', () => { clearOptional(s.k); step++; paint(host); });
  on(view, '[data-back]', 'click', () => { step = Math.max(0, step - 1); paint(host); });
}

const optional = k => ['race_date', 'volume', 'recent'].includes(k);
function clearOptional(k) { if (k === 'race_date') a.race_date = ''; if (k === 'volume') a.weekly_km_recent = null; if (k === 'recent') { a.recent_race_m = null; a.recent_race_s = null; } }
function valid(k) {
  switch (k) {
    case 'goal': return !!a.goal;
    case 'experience': return !!a.experience;
    case 'ability': return a.continuous_run_min != null;
    case 'days': return a.preferred_days.length >= 1;
    case 'target': return a.target_distance_m != null;
    case 'race_date': return !a.race_date || a.race_date >= today();
    case 'volume': return a.weekly_km_recent != null;
    case 'recent': return !a.recent_race_m || (a.recent_race_s >= 120 && a.recent_race_s * 1000 >= a.recent_race_m * 120);
    case 'limits': return a.has_limitations === false || (a.has_limitations === true && a.consent);
    case 'location': return !!a.training_location;
  }
  return true;
}
const choice = (field, v, title, desc = '') =>
  `<button class="choice" data-pick="${field}" data-v="${v}" aria-pressed="${a[field] === v}"><div class="grow"><div class="t">${esc(title)}</div>${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div></button>`;

function question(k) {
  const Q = (title, sub, body) => `<h1 class="q">${esc(title)}</h1>${sub ? `<p class="muted" style="margin:0 0 20px">${esc(sub)}</p>` : '<div style="height:12px"></div>'}${body}`;
  switch (k) {
    case 'goal': return Q(t('ob.goal.q'), t('ob.goal.sub'), `<div class="choices">${GOALS.map(g => choice('goal', g, t('goal.' + g), t('goal.' + g + '.d'))).join('')}</div>`);
    case 'experience': return Q(t('ob.exp.q'), '', `<div class="choices">${EXPERIENCE.map(x => choice('experience', x, t('exp.' + x), t('exp.' + x + '.d'))).join('')}</div>`);
    case 'ability': return Q(t('ob.ability.q'), t('ob.ability.sub'), `<div class="choices two">${ABILITY.map(m => choice('continuous_run_min', m, m === 0 ? t('ob.ability.none') : m === 60 ? t('ob.ability.60') : t('ob.ability.min', { m }))).join('')}</div>`);
    case 'days': return Q(t('ob.days.q'), t('ob.days.sub'),
      `<div class="days" role="group">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button data-day="${d}" aria-pressed="${a.preferred_days.includes(d)}" aria-label="${esc(weekdayName(d))}">${esc(weekdayShort(d))}</button>`).join('')}</div>
       <p class="muted small" id="days-n" style="margin-top:14px">${esc(t('ob.daysN', { n: a.preferred_days.length }))}</p>
       <div class="notice info small" style="margin-top:12px">${esc(t('ob.days.tip'))}</div>`);
    case 'target': return Q(t('ob.target.q'), t('ob.target.sub'), `<div class="choices two">${TARGETS.map(([m, l]) => choice('target_distance_m', m, m ? l : t('ob.target.none'))).join('')}</div>`);
    case 'race_date': return Q(t('ob.race.q'), t('ob.race.sub'), `<label for="race-date">${esc(t('ob.race.label'))}</label><input type="date" id="race-date" min="${today()}" value="${esc(a.race_date)}">`);
    case 'volume': return Q(t('ob.vol.q'), t('ob.vol.sub'), `<div class="choices two">${VOLUME.map(([v, l]) => choice('weekly_km_recent', v, l + ' km')).join('')}</div>`);
    case 'recent': {
      const s = a.recent_race_s || 0;
      return Q(t('ob.recent.q'), t('ob.recent.sub'), `<label for="rr-dist">${esc(t('ob.recent.dist'))}</label>
        <select id="rr-dist"><option value="">—</option>${[[5000, '5KM'], [10000, '10KM'], [21097, '21KM'], [42195, '42KM']].map(([m, l]) => `<option value="${m}" ${a.recent_race_m === m ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>${esc(t('ob.recent.time'))}</label>
        <div class="row"><input id="rr-h" type="number" min="0" max="12" inputmode="numeric" placeholder="${esc(t('unit.hh'))}" value="${s ? Math.floor(s / 3600) || '' : ''}" aria-label="${esc(t('unit.hours'))}">
          <input id="rr-m" type="number" min="0" max="59" inputmode="numeric" placeholder="${esc(t('unit.mm'))}" value="${s ? Math.floor(s % 3600 / 60) : ''}" aria-label="${esc(t('unit.minutes'))}">
          <input id="rr-s" type="number" min="0" max="59" inputmode="numeric" placeholder="${esc(t('unit.ss'))}" value="${s ? s % 60 : ''}" aria-label="${esc(t('unit.seconds'))}"></div>`);
    }
    case 'limits': return Q(t('ob.lim.q'), t('ob.lim.sub'), `<div class="choices">${choice('has_limitations', false, t('ob.lim.no'))}${choice('has_limitations', true, t('ob.lim.yes'))}</div>
      <div id="lim-more" class="${a.has_limitations ? '' : 'hide'}">
        <label for="lim-text">${esc(t('ob.lim.what'))}</label><textarea id="lim-text" rows="3" maxlength="1000" placeholder="${esc(t('ob.lim.ph'))}">${esc(a.limitations)}</textarea>
        <label class="row" style="color:var(--text);font-weight:600;align-items:flex-start;gap:10px"><input type="checkbox" id="lim-consent" style="width:22px;min-height:22px;margin-top:2px" ${a.consent ? 'checked' : ''}><span>${esc(t('ob.lim.consent'))}</span></label>
        <div class="notice" style="margin-top:12px"><b>${esc(t('ob.lim.noteT'))}</b> ${esc(t('ob.lim.note'))}</div>
      </div>`);
    case 'location': return Q(t('ob.loc.q'), '', `<div class="choices two">${LOCATIONS.map(x => choice('training_location', x, t('loc.' + x))).join('')}</div>`);
  }
  return '';
}

/* ───────── recommendation ─────────
   Rule-based and deliberately conservative: when in doubt, the easier plan. */
export function recommend(ans, programs) {
  const cm = ans.continuous_run_min || 0, g = ans.goal;
  let slug, note = '';
  if (g === 'start' || g === 'fitness' || cm < 10) slug = 'couch-to-5k';
  else if (g === 'first_5k') slug = 'road-to-5k';
  else if (g === 'improve_5k') slug = cm >= 30 ? 'improve-5k' : 'road-to-5k';
  else slug = cm >= 30 ? 'road-to-10k' : 'road-to-5k';
  if (['half', 'marathon', 'hyrox'].includes(g)) note = t('ob.rec.notYet', { goal: t('goal.' + g) });
  if (g === 'improve_10k' && slug === 'road-to-10k') note = t('ob.rec.improve10');
  if (ans.has_limitations && slug !== 'couch-to-5k' && cm < 20) slug = 'couch-to-5k';
  const pub = programs.filter(p => p.status === 'published' && p.tier === 'free');
  const pick = pub.find(p => p.slug === slug) || null;
  return { pick, others: pub.filter(p => p !== pick), note, wanted: slug };
}
const levelOf = ans => (ans.continuous_run_min || 0) >= 60 && ans.experience === 'experienced' ? 'advanced'
  : (ans.continuous_run_min || 0) >= 30 && ans.experience !== 'none' ? 'intermediate' : 'beginner';

async function result(view) {
  const body = view.querySelector('#ob-body');
  body.innerHTML = `<div class="skel" style="height:220px"></div>`;
  const level = levelOf(a);
  try {
    await api.saveProfile({
      goal: a.goal, experience: a.experience, level, continuous_run_min: a.continuous_run_min,
      days_per_week: a.preferred_days.length, preferred_days: a.preferred_days,
      target_distance_m: a.target_distance_m || null, race_date: a.target_distance_m && a.race_date ? a.race_date : null,
      weekly_km_recent: a.weekly_km_recent, recent_race_m: a.recent_race_m, recent_race_s: a.recent_race_m ? a.recent_race_s : null,
      has_limitations: !!a.has_limitations, limitations: a.has_limitations ? (a.limitations.trim() || null) : null,
      health_consent_at: a.has_limitations ? (state.profile?.health_consent_at || new Date().toISOString()) : null,
      training_location: a.training_location, language: lang(),
      onboarded_at: state.profile?.onboarded_at || new Date().toISOString(),
    });
    await loadRunner();
  } catch (e) { body.innerHTML = `<div class="error">${esc(friendlyError(e))}</div><button class="btn" data-retry>${esc(t('common.retry'))}</button>`; body.querySelector('[data-retry]').onclick = () => result(view); return; }

  let programs = [];
  try { programs = await api.listPrograms(); } catch (e) {}
  const rec = recommend(a, programs);
  const weeksToRace = a.race_date ? Math.floor((parseYmd(a.race_date) - parseYmd(today())) / 6048e5) : null;
  const p = rec.pick;

  body.innerHTML = `<div class="eyebrow">${esc(t('ob.rec.eyebrow'))}</div>
    <h1 class="q" style="margin-top:6px">${esc(t('ob.rec.title', { name: state.name.split(' ')[0] || '' }))}</h1>
    <p class="muted">${esc(t('level.' + level + '.long'))}</p>
    ${a.has_limitations ? `<div class="notice" style="margin:14px 0"><b>${esc(t('ob.lim.noteT'))}</b> ${esc(t('ob.rec.limits'))}</div>` : ''}
    ${p ? `<div class="hero" style="margin-top:16px">
        <div class="eyebrow" style="color:#B5B5B5">${esc(t('ob.rec.for'))}</div>
        <h2 style="margin:6px 0 6px;font-size:30px">${esc(L(p.i18n).title)}</h2>
        <p class="muted" style="margin:0 0 12px">${esc(L(p.i18n).summary)}</p>
        <div class="row wrap small"><span class="chip">${esc(t('prog.weeks', { n: p.weeks }))}</span><span class="chip">${esc(t('prog.perWeek', { n: p.sessions_per_week }))}</span><span class="chip">${esc(t('level.' + p.level))}</span></div>
      </div>
      ${rec.note ? `<div class="notice info small" style="margin-top:12px">${esc(rec.note)}</div>` : ''}
      ${weeksToRace != null && weeksToRace < p.weeks ? `<div class="notice small" style="margin-top:12px">${esc(t('ob.rec.raceSoon', { w: Math.max(0, weeksToRace), n: p.weeks }))}</div>` : ''}
      <div id="start-box" style="margin-top:20px"></div>
      ${rec.others.length ? `<button class="btn ghost block" style="margin-top:10px" data-browse>${esc(t('ob.rec.other'))}</button>` : ''}
      <button class="btn ghost block" style="margin-top:10px" data-home>${esc(t('ob.rec.later'))}</button>`
    : `<div class="card" style="margin-top:16px">${esc(t('ob.rec.none'))}</div>
       <button class="btn primary block" style="margin-top:16px" data-home>${esc(t('ob.rec.home'))}</button>`}`;
  on(body, '[data-browse]', 'click', () => go('programs'));
  on(body, '[data-home]', 'click', () => go('home'));
  if (p) startForm(body.querySelector('#start-box'), p, a.preferred_days, () => { a = null; go('home'); });
}

/* Shared with the programme page: choose days and a start date, then enrol. */
export function startForm(box, program, days, done) {
  let chosen = [...(days && days.length ? days : [1, 3, 6])];
  const firstDay = () => { const d = parseYmd(today()); for (let i = 0; i < 7; i++) { if (chosen.includes(d.getDay())) return ymd(d); d.setDate(d.getDate() + 1); } return today(); };
  const weeksNeeded = () => Math.ceil(program.weeks * program.sessions_per_week / Math.max(1, chosen.length));
  const paintS = (startVal) => {
    const start = startVal || firstDay();
    box.innerHTML = `<label>${esc(t('start.days', { n: program.sessions_per_week }))}</label>
      <div class="days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button data-sd="${d}" aria-pressed="${chosen.includes(d)}" aria-label="${esc(weekdayName(d))}">${esc(weekdayShort(d))}</button>`).join('')}</div>
      ${chosen.length < program.sessions_per_week ? `<div class="notice small" style="margin-top:10px">${esc(t('start.fewer', { w: weeksNeeded() }))}</div>`
        : chosen.length > program.sessions_per_week ? `<div class="notice info small" style="margin-top:10px">${esc(t('start.more', { n: program.sessions_per_week }))}</div>` : ''}
      <label for="sd-date">${esc(t('start.date'))}</label><input type="date" id="sd-date" min="${today()}" max="${ymd(Date.now() + 60 * 864e5)}" value="${start}">
      <p class="muted small" style="margin:8px 0 0">${esc(t('start.first', { d: fmtDateLong(start) }))}</p>
      <div class="error" id="sd-err" role="alert"></div>
      <button class="btn primary block" style="margin-top:8px" data-go ${chosen.length ? '' : 'disabled'}>${esc(t('start.go'))}</button>`;
  };
  paintS();
  on(box, '[data-sd]', 'click', (e, b) => {
    const d = +b.dataset.sd; chosen = chosen.includes(d) ? chosen.filter(x => x !== d) : [...chosen, d].sort();
    paintS(box.querySelector('#sd-date').value);
  });
  box.addEventListener('change', e => { if (e.target.id === 'sd-date') paintS(e.target.value); });
  on(box, '[data-go]', 'click', async (e, b) => {
    b.disabled = true; box.querySelector('#sd-err').textContent = '';
    try {
      // the first session lands on the first chosen weekday on or after this date
      await api.enroll(program.id, box.querySelector('#sd-date').value || today(), chosen);
      toast(t('start.done', { p: L(program.i18n).title }));
      done && done();
    } catch (err) { box.querySelector('#sd-err').textContent = friendlyError(err); b.disabled = false; }
  });
}
const back = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
