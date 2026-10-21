// Every key the code uses exists in Bahasa Malaysia and English, and both
// dictionaries hold the same keys.   node run/tests/i18n.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.document = { documentElement: {} }; globalThis.localStorage = { setItem() {}, getItem() {} };
const { D } = await import('../js/i18n.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = (function walk(d) { return readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []); })(root);
const src = files.map(f => readFileSync(f, 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?!\s*\+)/g)].map(m => m[1]));
// keys built at runtime: prefix + every value it can take
const families = {
  'auth.': ['signin', 'signup', 'reset'],
  'cat.': ['easy', 'recovery', 'long', 'tempo', 'threshold', 'interval', 'hill', 'run_walk', 'strength', 'mobility', 'rest', 'cross', 'race', 'other'],
  'exp.': ['none', 'some', 'regular', 'experienced'].flatMap(x => [x, x + '.d']),
  'feel.': ['too_easy', 'right', 'too_hard', 'pain'],
  'goal.': ['start', 'first_5k', 'improve_5k', 'first_10k', 'improve_10k', 'half', 'marathon', 'hyrox', 'fitness'].flatMap(x => [x, x + '.d']),
  'int.': ['easy', 'moderate', 'hard'], 'level.': ['beginner', 'intermediate', 'advanced'].flatMap(x => [x, x + '.long']),
  'loc.': ['road', 'track', 'treadmill', 'trail', 'mixed'], 'rpe.': Array.from({ length: 10 }, (_, i) => String(i + 1)),
  'src.': ['manual', 'gps', 'strava'], 'status.': ['planned', 'completed', 'skipped', 'missed', 'draft', 'review', 'published', 'archived'],
  'tab.': ['home', 'training', 'club', 'profile'], 'theme.': ['system', 'light', 'dark'], 'tip.': ['pain', 'hard', 'easy'],
};
for (const [p, vals] of Object.entries(families)) vals.forEach(v => used.add(p + v));
let bad = 0;
for (const k of used) for (const l of ['ms', 'en']) if (!(k in D[l])) { console.error(`missing ${l}: ${k}`); bad++; }
for (const k of Object.keys(D.ms)) if (!(k in D.en)) { console.error(`en lacks ${k}`); bad++; }
for (const k of Object.keys(D.en)) if (!(k in D.ms)) { console.error(`ms lacks ${k}`); bad++; }
for (const l of ['ms', 'en']) for (const [k, v] of Object.entries(D[l])) {
  const a = (v.match(/\{\w+\}/g) || []).sort().join(), b = (D[l === 'ms' ? 'en' : 'ms'][k] || '').match(/\{\w+\}/g)?.sort().join() || '';
  if (a !== b) { console.error(`placeholders differ for ${k}: ${a} vs ${b}`); bad++; }
}
if (bad) { console.error(`${bad} i18n problems`); process.exit(1); }
console.log(`i18n ok: ${used.size} keys used, ${Object.keys(D.ms).length} defined in each language`);
