// Generates run/db/002_seed_programs.sql from the plans below.
//   node run/db/seed/programs.mjs > run/db/002_seed_programs.sql
//
// These are conservative, widely used progressions (run/walk → continuous →
// structured). They are seeded as `review`, not `published`: a HITFAT head
// coach reads them in the app and publishes them. Nothing reaches a runner
// before that.

const WARM = {
  ms: 'Jalan laju 5 minit, kemudian 30 saat setiap satu: angkat lutut, tendang punggung, ayun kaki ke depan dan ke sisi.',
  en: 'Brisk walk 5 minutes, then 30 seconds each: high knees, butt kicks, front and side leg swings.' };
const COOL = {
  ms: 'Jalan perlahan 5 minit. Regangan betis, paha depan dan belakang, 30 saat setiap sisi.',
  en: 'Easy walk 5 minutes. Stretch calves, quads and hamstrings, 30 seconds each side.' };
const EASY_COACH = {
  ms: 'Pace perbualan: kau patut boleh bercakap dalam ayat penuh. Kalau tercungap, perlahankan atau jalan sekejap.',
  en: 'Conversational pace: you should be able to talk in full sentences. If you are gasping, slow down or walk briefly.' };

const mmss = s => s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s / 60);
const minsWord = (s, lang) => s % 60 ? `${mmss(s)} ${lang === 'ms' ? 'minit' : 'min'}` : `${s / 60} ${lang === 'ms' ? 'minit' : 'min'}`;

function runWalk(week, session, run, walk, reps) {
  const total = Math.round((run + walk) * reps / 60) + 10;
  return {
    week, session, category: 'run_walk', duration_min: total, intensity: 'easy', rpe_min: 3, rpe_max: 5,
    rest_interval: `${mmss(walk)} walk`,
    steps: Array.from({ length: reps }).flatMap(() => [{ kind: 'run', sec: run }, { kind: 'walk', sec: walk }]),
    i18n: {
      ms: { title: `Lari/Jalan ${reps} × ${minsWord(run, 'ms')}`, objective: 'Biasakan badan berlari tanpa terlalu penat. Konsisten lebih penting dari laju.',
        warmup: WARM.ms, main: `Ulang ${reps} kali: lari perlahan ${minsWord(run, 'ms')}, kemudian jalan ${minsWord(walk, 'ms')}.`, cooldown: COOL.ms, coach: EASY_COACH.ms },
      en: { title: `Run/Walk ${reps} × ${minsWord(run, 'en')}`, objective: 'Get your body used to running without overdoing it. Consistency beats speed.',
        warmup: WARM.en, main: `Repeat ${reps} times: jog ${minsWord(run, 'en')}, then walk ${minsWord(walk, 'en')}.`, cooldown: COOL.en, coach: EASY_COACH.en } } };
}
function continuous(week, session, min, opts = {}) {
  return {
    week, session, category: opts.category || 'easy', duration_min: min + 10, intensity: 'easy', rpe_min: 3, rpe_max: 5,
    steps: [{ kind: 'run', sec: min * 60 }],
    i18n: {
      ms: { title: opts.ms || `Larian Santai ${min} minit`, objective: opts.objMs || 'Bina daya tahan aerobik. Larian berterusan tanpa berhenti.',
        warmup: WARM.ms, main: `Lari berterusan ${min} minit pada pace perbualan.`, cooldown: COOL.ms, coach: opts.coachMs || EASY_COACH.ms },
      en: { title: opts.en || `Easy Run ${min} min`, objective: opts.objEn || 'Build aerobic endurance. Continuous running without stopping.',
        warmup: WARM.en, main: `Run continuously for ${min} minutes at conversational pace.`, cooldown: COOL.en, coach: opts.coachEn || EASY_COACH.en } } };
}
function distanceRun(week, session, km, cat, ms, en) {
  return {
    week, session, category: cat, distance_m: Math.round(km * 1000), duration_min: Math.round(km * 7.5) + 10,
    intensity: cat === 'long' || cat === 'easy' ? 'easy' : 'moderate', rpe_min: cat === 'long' || cat === 'easy' ? 3 : 5, rpe_max: cat === 'long' || cat === 'easy' ? 5 : 7,
    i18n: {
      ms: { title: ms.title, objective: ms.obj, warmup: WARM.ms, main: ms.main, cooldown: COOL.ms, coach: ms.coach || EASY_COACH.ms },
      en: { title: en.title, objective: en.obj, warmup: WARM.en, main: en.main, cooldown: COOL.en, coach: en.coach || EASY_COACH.en } } };
}
function intervals(week, session, reps, workM, restSec, cat = 'interval') {
  const hard = cat === 'interval';
  return {
    week, session, category: cat, duration_min: Math.round(reps * (workM / 1000 * 5.5 + restSec / 60)) + 20,
    intensity: 'hard', rpe_min: hard ? 7 : 6, rpe_max: hard ? 8 : 7, rest_interval: `${mmss(restSec)} jog/walk`,
    i18n: {
      ms: { title: `Interval ${reps} × ${workM >= 1000 ? workM / 1000 + 'KM' : workM + 'm'}`, objective: 'Tingkatkan kelajuan dan kecekapan larian pada pace 5KM.',
        warmup: WARM.ms + ' Tambah 10 minit lari santai.', main: `${reps} kali ${workM} meter pada pace yang kau boleh kekalkan untuk 5KM (usaha 7–8/10). Rehat ${minsWord(restSec, 'ms')} jog atau jalan di antara.`,
        cooldown: '10 minit lari sangat santai, kemudian regangan.', coach: 'Set pertama patut rasa terkawal. Kalau set terakhir jauh lebih perlahan, set awal kau terlalu laju.' },
      en: { title: `Intervals ${reps} × ${workM >= 1000 ? workM / 1000 + 'KM' : workM + 'm'}`, objective: 'Improve speed and running economy at 5KM pace.',
        warmup: WARM.en + ' Add 10 minutes of easy running.', main: `${reps} × ${workM} m at the pace you could hold for a 5KM (effort 7–8/10). Rest ${minsWord(restSec, 'en')} jog or walk between.`,
        cooldown: '10 minutes very easy running, then stretch.', coach: 'The first rep should feel controlled. If your last rep is much slower, you started too fast.' } } };
}
function tempo(week, session, min) {
  return {
    week, session, category: 'tempo', duration_min: min + 25, intensity: 'moderate', rpe_min: 6, rpe_max: 7,
    i18n: {
      ms: { title: `Tempo ${min} minit`, objective: 'Naikkan pace yang kau boleh kekalkan lama tanpa "meletup".',
        warmup: WARM.ms + ' Tambah 10 minit lari santai.', main: `${min} minit pada usaha "selesa tapi susah" (6–7/10): boleh cakap beberapa perkataan, bukan ayat penuh.`,
        cooldown: '10 minit lari santai, kemudian regangan.', coach: 'Pace sekata dari mula hingga akhir. Tempo bukan perlumbaan.' },
      en: { title: `Tempo ${min} min`, objective: 'Raise the pace you can hold for a long time without blowing up.',
        warmup: WARM.en + ' Add 10 minutes of easy running.', main: `${min} minutes at "comfortably hard" effort (6–7/10): a few words, not full sentences.`,
        cooldown: '10 minutes easy running, then stretch.', coach: 'Even pace from start to finish. A tempo run is not a race.' } } };
}

const PROGRAMS = [
  { slug: 'couch-to-5k', goal: 'start', level: 'beginner', weeks: 9, sessions_per_week: 3, target_distance_m: 5000, sort: 10,
    i18n: {
      ms: { title: 'Couch to 5KM', summary: 'Dari sifar ke 30 minit lari tanpa henti dalam 9 minggu. Bermula dengan lari/jalan selang-seli.', who: 'Untuk yang belum pernah lari atau baru bermula semula.' },
      en: { title: 'Couch to 5KM', summary: 'From zero to 30 minutes of non-stop running in 9 weeks, starting with run/walk intervals.', who: 'For people who have never run, or are starting again.' } },
    workouts: (() => {
      const w = [];
      const rw = [[1, 60, 90, 8], [2, 90, 120, 6], [3, 120, 120, 5], [4, 180, 120, 4], [5, 300, 180, 3]];
      rw.forEach(([wk, r, wl, n]) => { for (let s = 1; s <= 3; s++) w.push(runWalk(wk, s, r, wl, n)); });
      w.push(runWalk(6, 1, 480, 180, 2), runWalk(6, 2, 600, 180, 2), continuous(6, 3, 15));
      w.push(continuous(7, 1, 20), continuous(7, 2, 22), continuous(7, 3, 25));
      w.push(continuous(8, 1, 25), continuous(8, 2, 28), continuous(8, 3, 28));
      w.push(continuous(9, 1, 30), continuous(9, 2, 30),
        distanceRun(9, 3, 5, 'long',
          { title: 'Larian Tamat: 5KM', obj: 'Tamatkan 5KM pertama kau. Masa tak penting.', main: 'Lari 5KM pada pace perbualan. Jalan sekejap kalau perlu, kemudian sambung.', coach: 'Kau dah buat 26 sesi untuk sampai sini. Nikmati.' },
          { title: 'Graduation Run: 5KM', obj: 'Finish your first 5KM. Time does not matter.', main: 'Run 5KM at conversational pace. Walk briefly if you need to, then carry on.', coach: 'You did 26 sessions to get here. Enjoy it.' }));
      return w; })() },

  { slug: 'road-to-5k', goal: 'first_5k', level: 'beginner', weeks: 6, sessions_per_week: 3, target_distance_m: 5000, sort: 20,
    i18n: {
      ms: { title: 'Road to 5KM', summary: 'Enam minggu ke 5KM pertama tanpa berhenti, untuk yang dah boleh lari 10 hingga 15 minit.', who: 'Untuk pelari baru yang boleh lari 10–15 minit berterusan.' },
      en: { title: 'Road to 5KM', summary: 'Six weeks to your first non-stop 5KM, for runners who can already jog 10 to 15 minutes.', who: 'For new runners who can jog 10–15 minutes continuously.' } },
    workouts: (() => {
      const w = [], longKm = [2.5, 3, 3.5, 3, 4, 5], easy = [15, 18, 20, 18, 22, 20];
      for (let wk = 1; wk <= 6; wk++) {
        w.push(continuous(wk, 1, easy[wk - 1]));
        w.push(wk === 4 ? continuous(wk, 2, 15, { category: 'recovery', ms: 'Larian Pemulihan 15 minit', en: 'Recovery Run 15 min', objMs: 'Minggu ringan: biar badan menyerap latihan.', objEn: 'Lighter week: let your body absorb the training.' })
          : runWalk(wk, 2, 120 + wk * 30, 60, 5));
        w.push(wk === 6
          ? distanceRun(wk, 3, 5, 'long',
            { title: '5KM Pertama', obj: 'Lari 5KM berterusan.', main: 'Lari 5KM pada pace selesa. Mula perlahan, kekal sekata.', coach: 'Separuh pertama patut rasa terlalu senang. Itu tandanya betul.' },
            { title: 'Your First 5KM', obj: 'Run 5KM continuously.', main: 'Run 5KM at a comfortable pace. Start slow, stay even.', coach: 'The first half should feel too easy. That means you are doing it right.' })
          : distanceRun(wk, 3, longKm[wk - 1], 'long',
            { title: `Larian Jauh ${longKm[wk - 1]}KM`, obj: 'Panjangkan jarak sedikit demi sedikit.', main: `Lari ${longKm[wk - 1]}KM pada pace perbualan. Jalan 1 minit kalau perlu.` },
            { title: `Long Run ${longKm[wk - 1]}KM`, obj: 'Extend your distance step by step.', main: `Run ${longKm[wk - 1]}KM at conversational pace. Walk 1 minute if needed.` }));
      }
      return w; })() },

  { slug: 'improve-5k', goal: 'improve_5k', level: 'intermediate', weeks: 6, sessions_per_week: 3, target_distance_m: 5000, sort: 30,
    i18n: {
      ms: { title: 'Improve Your 5KM', summary: 'Enam minggu interval, tempo dan larian jauh untuk catat masa 5KM yang lebih baik.', who: 'Untuk yang dah boleh lari 5KM dan mahu lebih laju.' },
      en: { title: 'Improve Your 5KM', summary: 'Six weeks of intervals, tempo and long runs to set a better 5KM time.', who: 'For runners who can already run 5KM and want to get faster.' } },
    workouts: (() => {
      const w = [], q = [[6, 400, 90], [5, 600, 120], [4, 800, 120], [6, 400, 75], [3, 1000, 150], [4, 400, 90]];
      const tem = [12, 15, 18, 12, 20, 10], lng = [6, 6.5, 7, 6, 8, 0];
      for (let wk = 1; wk <= 6; wk++) {
        w.push(intervals(wk, 1, ...q[wk - 1]));
        w.push(tempo(wk, 2, tem[wk - 1]));
        w.push(wk === 6
          ? distanceRun(wk, 3, 5, 'threshold',
            { title: 'Ujian Masa 5KM', obj: 'Ukur kemajuan kau.', main: 'Selepas warm-up penuh, lari 5KM sekuat yang kau boleh kekalkan. Catat masa.', coach: 'Mula sedikit lebih perlahan dari target, laju di kilometer terakhir.' },
            { title: '5KM Time Trial', obj: 'Measure your progress.', main: 'After a full warm-up, run 5KM as hard as you can sustain. Record your time.', coach: 'Start slightly slower than target, push the final kilometre.' })
          : distanceRun(wk, 3, lng[wk - 1], 'long',
            { title: `Larian Jauh ${lng[wk - 1]}KM`, obj: 'Daya tahan untuk kekalkan pace 5KM hingga hujung.', main: `${lng[wk - 1]}KM pada pace santai.` },
            { title: `Long Run ${lng[wk - 1]}KM`, obj: 'Endurance to hold 5KM pace to the finish.', main: `${lng[wk - 1]}KM at easy pace.` }));
      }
      return w; })() },

  { slug: 'road-to-10k', goal: 'first_10k', level: 'intermediate', weeks: 8, sessions_per_week: 3, target_distance_m: 10000, sort: 40,
    i18n: {
      ms: { title: 'Road to 10KM', summary: 'Lapan minggu dari 5KM ke 10KM, dengan satu minggu ringan di tengah.', who: 'Untuk yang boleh lari 5KM atau 30 minit berterusan.' },
      en: { title: 'Road to 10KM', summary: 'Eight weeks from 5KM to 10KM, with a lighter week in the middle.', who: 'For runners who can run 5KM or 30 minutes continuously.' } },
    workouts: (() => {
      const w = [], lng = [6, 7, 7.5, 6, 8, 9, 9.5, 10], easy = [30, 30, 35, 25, 35, 40, 35, 25];
      for (let wk = 1; wk <= 8; wk++) {
        w.push(continuous(wk, 1, easy[wk - 1]));
        w.push(wk === 4 || wk === 8 ? continuous(wk, 2, 20, { category: 'recovery', ms: 'Larian Pemulihan 20 minit', en: 'Recovery Run 20 min', objMs: 'Minggu ringan: kurangkan beban supaya badan pulih.', objEn: 'Lighter week: reduce load so your body recovers.' })
          : wk % 2 ? intervals(wk, 2, 4 + Math.floor(wk / 3), 800, 120) : tempo(wk, 2, 15 + wk));
        const km = lng[wk - 1];
        w.push(wk === 8
          ? distanceRun(wk, 3, 10, 'long',
            { title: '10KM Pertama', obj: 'Lari 10KM penuh.', main: 'Lari 10KM pada pace santai dan sekata. Minum air setiap 20–30 minit jika panas.', coach: 'Lima kilometer pertama simpan tenaga. Lima kilometer terakhir milik kau.' },
            { title: 'Your First 10KM', obj: 'Run the full 10KM.', main: 'Run 10KM at an easy, even pace. Drink every 20–30 minutes if it is hot.', coach: 'Save energy in the first five. The last five are yours.' })
          : distanceRun(wk, 3, km, 'long',
            { title: `Larian Jauh ${km}KM`, obj: 'Bina daya tahan ke arah 10KM.', main: `${km}KM pada pace perbualan.`, coach: 'Cuaca Kelantan panas: lari awal pagi atau lewat petang, dan bawa air.' },
            { title: `Long Run ${km}KM`, obj: 'Build endurance toward 10KM.', main: `${km}KM at conversational pace.`, coach: 'Kelantan is hot: run early morning or late evening, and carry water.' }));
      }
      return w; })() },
];

const q = v => v == null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const j = v => v == null ? 'null' : `${q(JSON.stringify(v))}::jsonb`;

let out = `-- GENERATED by run/db/seed/programs.mjs — edit that file, not this one.
-- Seeds the Phase 1 programmes as 'review'. A head coach publishes them from
-- the app (or: update run_programs set status='published', published_at=now() where slug in (...)).
-- Re-running updates content in place and never touches runners' schedules.
begin;
`;
for (const p of PROGRAMS) {
  out += `
insert into public.run_programs(slug, i18n, goal, level, weeks, sessions_per_week, target_distance_m, tier, status, sort)
values (${q(p.slug)}, ${j(p.i18n)}, ${q(p.goal)}, ${q(p.level)}, ${p.weeks}, ${p.sessions_per_week}, ${q(p.target_distance_m)}, 'free', 'review', ${p.sort})
on conflict (slug) do update set i18n = excluded.i18n, goal = excluded.goal, level = excluded.level, weeks = excluded.weeks,
  sessions_per_week = excluded.sessions_per_week, target_distance_m = excluded.target_distance_m, sort = excluded.sort;
`;
  for (const w of p.workouts) {
    out += `insert into public.run_workout_templates(program_id, week, session, category, i18n, duration_min, distance_m, intensity, rpe_min, rpe_max, rest_interval, steps)
select id, ${w.week}, ${w.session}, ${q(w.category)}, ${j(w.i18n)}, ${q(w.duration_min)}, ${q(w.distance_m)}, ${q(w.intensity)}, ${q(w.rpe_min)}, ${q(w.rpe_max)}, ${q(w.rest_interval)}, ${j(w.steps)}
  from public.run_programs where slug = ${q(p.slug)}
on conflict (program_id, week, session) do update set category = excluded.category, i18n = excluded.i18n, duration_min = excluded.duration_min,
  distance_m = excluded.distance_m, intensity = excluded.intensity, rpe_min = excluded.rpe_min, rpe_max = excluded.rpe_max,
  rest_interval = excluded.rest_interval, steps = excluded.steps;
`;
  }
  const n = p.weeks * p.sessions_per_week;
  if (p.workouts.length !== n) throw new Error(`${p.slug}: ${p.workouts.length} workouts, expected ${n}`);
}
out += '\ncommit;\n';
process.stdout.write(out);
