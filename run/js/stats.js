// Progress numbers, always computed from the runner's own activities.
import { startOfWeek, startOfMonth, DAY_MS } from './ui.js';

export function totals(acts, since = 0, until = Infinity) {
  let dist = 0, time = 0, n = 0;
  for (const a of acts) { const t = Date.parse(a.started_at); if (t >= since && t < until) { dist += a.distance_m; time += a.moving_time_s; n++; } }
  return { dist, time, n };
}
export const thisWeek = acts => totals(acts, +startOfWeek());
export const thisMonth = acts => totals(acts, +startOfMonth());

/** Distance per week for the last `n` weeks, oldest first. */
export function weeklySeries(acts, n = 8) {
  const w0 = +startOfWeek();
  return Array.from({ length: n }, (_, i) => { const a = w0 - (n - 1 - i) * 7 * DAY_MS; return { start: a, dist: totals(acts, a, a + 7 * DAY_MS).dist }; });
}
/** Of the last `n` complete-or-current weeks, how many had at least one run. */
export function consistency(acts, n = 4) { const s = weeklySeries(acts, n); return { active: s.filter(w => w.dist > 0).length, of: n }; }

/* Personal bests. A manual log only has an average pace, so a "5KM best" is
   the fastest run of at least 5KM, scaled to 5KM — labelled as an estimate. */
export const PB_DIST = [[5000, '5K'], [10000, '10K'], [21097, '21K'], [42195, '42K']];
export function bests(acts) {
  const out = {};
  for (const [m] of PB_DIST) {
    let best = null;
    for (const a of acts) if (a.distance_m >= m) { const t = a.moving_time_s * m / a.distance_m; if (!best || t < best.t) best = { t, a }; }
    if (best) out[m] = best;
  }
  out.longest = acts.reduce((b, a) => !b || a.distance_m > b.distance_m ? a : b, null);
  return out;
}

/** Plan progress from its calendar. */
export function planProgress(plan) {
  const s = plan.sessions, done = s.filter(x => x.status === 'completed').length;
  const todayYmd = new Date(); todayYmd.setHours(0, 0, 0, 0);
  const next = s.find(x => x.status === 'planned' && new Date(x.scheduled_date + 'T00:00') >= todayYmd) || null;
  const missed = s.filter(x => x.status === 'planned' && new Date(x.scheduled_date + 'T00:00') < todayYmd);
  const cur = next || s.filter(x => x.status !== 'planned').slice(-1)[0] || s[0];
  const week = cur ? cur.template.week : 1;
  const thisWeekStart = +startOfWeek(), weekEnd = thisWeekStart + 7 * DAY_MS;
  const inWeek = s.filter(x => { const d = +new Date(x.scheduled_date + 'T00:00'); return d >= thisWeekStart && d < weekEnd; });
  return { done, total: s.length, next, missed, week, weeks: plan.program.weeks,
    weekPlanned: inWeek.length, weekDone: inWeek.filter(x => x.status === 'completed').length,
    finished: s.length > 0 && s.every(x => x.status !== 'planned') };
}
