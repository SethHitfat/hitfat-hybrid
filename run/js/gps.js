// Experimental browser GPS tracker. Kept apart from the training flow: a
// run recorded here ends as a pre-filled log form the runner confirms.
//
// What it will not do: invent points. When the signal drops, distance stops
// growing and the gap is left as a gap.

export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function thinRoute(pts, max = 600) {
  const src = pts.length <= max ? pts : [...Array.from({ length: max }, (_, i) => pts[Math.floor(i * pts.length / max)]), pts[pts.length - 1]];
  return src.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}

export const ACC_MAX = 35;      // metres; worse fixes are ignored
export const JUMP_MS = 9;       // faster than this is a GPS jump, not a runner
const LIVE_KEY = 'hfrun_gps_live';

export class Tracker {
  constructor(onUpdate) { this.onUpdate = onUpdate; this.s = null; this.watch = null; this.wake = null; this.lastFix = null; }
  get active() { return !!this.s; }
  begin(sw) {
    this.s = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), sw: sw || null, status: 'running', start: Date.now(),
      acc: 0, resumeAt: Date.now(), dist: 0, pts: [], trace: [], splits: [], last: null, gaps: 0 };
    this.startWatch(); this.keepAwake(); this.persist();
  }
  restore(saved) { this.s = { ...saved, status: 'paused', last: null }; this.startWatch(); this.keepAwake(); }
  startWatch() {
    if (this.watch != null || !('geolocation' in navigator)) return;
    this.watch = navigator.geolocation.watchPosition(p => this.fix(p), e => { this.error = e.code; this.onUpdate(); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  stopWatch() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; }
  async keepAwake() { try { if ('wakeLock' in navigator) this.wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
  elapsed() { const s = this.s; return s ? s.acc + (s.status === 'running' ? Date.now() - s.resumeAt : 0) : 0; }
  fix(p) {
    const s = this.s; if (!s) return;
    const c = p.coords, pt = [c.latitude, c.longitude], acc = c.accuracy || 99, now = Date.now();
    this.lastFix = { pt, acc, t: now }; this.error = null;
    if (s.status !== 'running' || acc > ACC_MAX) { this.onUpdate(); return; }
    const e = this.elapsed() / 1000;
    if (!s.last) { s.last = { pt, t: now }; s.pts.push(pt); s.trace.push([+e.toFixed(1), +s.dist.toFixed(1)]); this.onUpdate(); return; }
    const d = haversine(s.last.pt, pt), dt = (now - s.last.t) / 1000;
    if (d < Math.max(3, acc * 0.25)) { this.onUpdate(); return; }        // jitter: wait until real movement adds up
    if (dt > 0 && d / dt > JUMP_MS) { this.onUpdate(); return; }        // a jump, not running
    if (dt > 30) s.gaps++;                                                // signal was lost for a while; counted, not filled
    const prevD = s.dist, prevE = s.trace.length ? s.trace[s.trace.length - 1][0] : 0;
    s.dist += d; s.last = { pt, t: now }; s.pts.push(pt); s.trace.push([+e.toFixed(1), +s.dist.toFixed(1)]);
    while (s.dist >= (s.splits.length + 1) * 1000) {                     // km splits, interpolated to the crossing
      const mark = (s.splits.length + 1) * 1000, f = (mark - prevD) / (s.dist - prevD || 1), atE = prevE + (e - prevE) * f;
      s.splits.push(Math.round(atE - s.splits.reduce((a, b) => a + b, 0)));
    }
    this.persist(); this.onUpdate();
  }
  /** pace over the last ~20 s of moving time */
  currentPace() {
    const tr = this.s?.trace || []; if (tr.length < 2) return NaN;
    const last = tr[tr.length - 1]; let i = tr.length - 1;
    while (i > 0 && last[0] - tr[i][0] < 20) i--;
    const dd = last[1] - tr[i][1], de = last[0] - tr[i][0];
    return dd < 15 || this.elapsed() / 1000 - last[0] > 12 ? NaN : de / (dd / 1000);
  }
  pause() { const s = this.s; if (!s || s.status !== 'running') return; s.acc += Date.now() - s.resumeAt; s.status = 'paused'; s.last = null; this.persist(); this.onUpdate(); }
  resume() { const s = this.s; if (!s || s.status !== 'paused') return; s.status = 'running'; s.resumeAt = Date.now(); this.onUpdate(); }
  persist() { const s = this.s; if (!s) return; try { localStorage.setItem(LIVE_KEY, JSON.stringify({ ...s, acc: this.elapsed(), status: 'paused', savedAt: Date.now() })); } catch (e) {} }
  static recoverable() { try { const r = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); if (r && Date.now() - r.savedAt < 6 * 36e5) return r; } catch (e) {} return null; }
  static discard() { try { localStorage.removeItem(LIVE_KEY); } catch (e) {} }
  /** End the run and hand back what the log form needs. */
  finish() {
    if (this.s.status === 'running') this.pause();
    const s = this.s, out = { id: s.id, sw: s.sw, started_at: new Date(s.start).toISOString(), distance_m: Math.round(s.dist),
      moving_time_s: Math.round(s.acc / 1000), elapsed_time_s: Math.max(Math.round(s.acc / 1000), Math.round((Date.now() - s.start) / 1000)),
      route: s.pts.length > 1 ? thinRoute(s.pts) : null, splits_s: s.splits.length ? s.splits : null, gaps: s.gaps };
    this.stop(); return out;
  }
  stop() { this.stopWatch(); try { this.wake && this.wake.release(); } catch (e) {} this.wake = null; this.s = null; Tracker.discard(); }
}

/* ───────── maps (Leaflet, loaded only when a map is shown) ───────── */
let leaflet = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leaflet) return leaflet;
  leaflet = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = () => res(window.L); js.onerror = () => { leaflet = null; rej(new Error('map unavailable')); }; document.head.appendChild(js);
  });
  return leaflet;
}
export function baseMap(L, el, interactive = true) {
  const m = L.map(el, { zoomControl: false, dragging: interactive, touchZoom: interactive, scrollWheelZoom: false, doubleClickZoom: interactive, boxZoom: false, keyboard: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
  m.attributionControl.setPrefix(false);
  m.setView([6.1254, 102.2381], 14);   // Kota Bharu until a fix arrives
  return m;
}
export async function drawRoute(el, route) {
  const L = await loadLeaflet(), m = baseMap(L, el, true);
  const line = L.polyline(route, { color: '#E30613', weight: 5 }).addTo(m);
  L.circleMarker(route[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#137F3B', fillOpacity: 1 }).addTo(m);
  L.circleMarker(route[route.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#E30613', fillOpacity: 1 }).addTo(m);
  m.fitBounds(line.getBounds(), { padding: [20, 20] });
  return m;
}
