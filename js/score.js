// Sky-color forecast model.
//
// Sunset and sunrise color comes from sunlight reaching clouds from below
// after it has travelled a long, low path through the atmosphere.
// Good color needs three things:
//   1. A canvas: high or mid clouds overhead (roughly 30-70% cover is ideal).
//   2. An open light path: little low cloud toward the sun, 100-300 km out.
//   3. Clean air: low humidity and moderate aerosol keep colors saturated.
// Thick low overcast hides the canvas, and rain washes everything out.

import { dayEvents, compass } from './sun.js';
import { PATH_KM } from './api.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise-linear lookup: pts = [[x,y], ...] sorted by x.
function curve(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}

function sample(src, key, tSec) {
  if (!src || !src.hourly || !src.hourly[key]) return null;
  const T = src.hourly.time, V = src.hourly[key];
  if (tSec < T[0] || tSec > T[T.length - 1]) return null;
  let i = 0;
  while (i < T.length - 1 && T[i + 1] < tSec) i++;
  const v0 = V[i], v1 = V[i + 1] ?? v0;
  if (v0 == null || v1 == null) return v0 ?? v1 ?? null;
  const f = T[i + 1] ? (tSec - T[i]) / (T[i + 1] - T[i]) : 0;
  return lerp(v0, v1, clamp(f));
}

function sumBefore(src, key, tSec, hours) {
  let s = 0;
  for (let h = 1; h <= hours; h++) s += sample(src, key, tSec - h * 3600) ?? 0;
  return s;
}

export const LABELS = [
  { min: 80, label: 'Spectacular', tone: 'fire' },
  { min: 62, label: 'Vivid', tone: 'vivid' },
  { min: 45, label: 'Good', tone: 'good' },
  { min: 28, label: 'Fair', tone: 'fair' },
  { min: 0, label: 'Poor', tone: 'poor' },
];
export const labelFor = (s) => LABELS.find((l) => s >= l.min);

export function conditionsAt(data, tMs, kind) {
  const [local, ...rest] = data.weather;
  const half = rest.length / 2;
  const path = kind === 'sunrise' ? rest.slice(0, half) : rest.slice(half);
  const t = tMs / 1000;
  const pct = (src, k) => (sample(src, k, t) ?? 0) / 100;
  return {
    low: pct(local, 'cloud_cover_low'),
    mid: pct(local, 'cloud_cover_mid'),
    high: pct(local, 'cloud_cover_high'),
    rh: sample(local, 'relative_humidity_2m', t),
    vis: sample(local, 'visibility', t),
    precip: sample(local, 'precipitation', t) ?? 0,
    pop: (sample(local, 'precipitation_probability', t) ?? 0) / 100,
    rainBefore: sumBefore(local, 'precipitation', t, 3),
    temp: sample(local, 'temperature_2m', t),
    pathLow: path.map((p) => pct(p, 'cloud_cover_low')),
    pathMid: path.map((p) => pct(p, 'cloud_cover_mid')),
    aod: sample(data.air, 'aerosol_optical_depth', t),
    dust: sample(data.air, 'dust', t),
  };
}

export function scoreSky(c) {
  // 1. Canvas: high cloud counts fully, mid cloud nearly so.
  const canvas = 1 - (1 - c.high) * (1 - 0.85 * c.mid);
  const canvasQ = curve(canvas, [[0, 0], [0.1, 0.12], [0.2, 0.4], [0.35, 0.85], [0.45, 1], [0.7, 1], [0.9, 0.82], [1, 0.68]]);

  // 2. Light path toward the sun.
  const pathLow = 0.6 * (c.pathLow[0] ?? 0) + 0.4 * (c.pathLow[1] ?? 0);
  const pathMid = Math.max(c.pathMid[0] ?? 0, c.pathMid[1] ?? 0);
  const transmit = clamp((1 - 0.95 * Math.pow(pathLow, 1.1)) * (1 - 0.35 * Math.pow(pathMid, 2.5)));

  // 3. Local low cloud: scattered low cloud can glow, overcast hides the sky.
  const lowMult = curve(c.low, [[0, 1], [0.25, 1.05], [0.45, 0.9], [0.7, 0.5], [0.9, 0.22], [1, 0.12]]);

  // 4. Air clarity.
  const rhF = c.rh == null ? 0.9 : curve(c.rh, [[0, 1], [55, 1], [75, 0.82], [90, 0.62], [100, 0.5]]);
  const visKm = c.vis == null ? 30 : c.vis / 1000;
  const visF = curve(visKm, [[1, 0.45], [5, 0.65], [10, 0.82], [20, 0.95], [30, 1]]);
  // Some aerosol deepens reds; heavy smoke/dust mutes them.
  const aodF = c.aod == null ? 1 : curve(c.aod, [[0, 0.95], [0.08, 1], [0.2, 1.06], [0.35, 1.02], [0.6, 0.85], [1.2, 0.6]]);
  const clarity = clamp(rhF * visF);

  // 5. Rain.
  const rainF = c.precip > 0.2 ? clamp(1 - 0.8 * c.pop - 0.1) : clamp(1 - 0.35 * Math.max(0, c.pop - 0.3));
  const clearing = c.rainBefore > 0.3 && c.precip < 0.1 && c.low < 0.55 ? 0.08 : 0;

  const cloudColor = canvasQ * transmit * lowMult;
  const clearBase = 0.28 * Math.pow(1 - canvas, 1.5) * lowMult; // clean gradient on a clear evening
  const raw = clamp(((clearBase + 0.62 * cloudColor) * (0.35 + 0.65 * clarity) * aodF * rainF + clearing) / 0.85);
  const score = Math.round(100 * raw);

  return {
    score,
    ...labelFor(score),
    parts: { canvas, canvasQ, transmit, pathLow, pathMid, lowMult, clarity, rhF, visF, aodF, rainF, clearing, cloudColor },
  };
}

const p = (x) => `${Math.round(x * 100)}%`;

export function explain(c, r, kind, az) {
  const dir = compass(az);
  const P = r.parts;
  const f = [];
  // Canvas
  if (P.canvas < 0.1) f.push({ fx: 'neutral', text: `Almost no high or mid cloud (${p(P.canvas)}). Color will stay in a band along the horizon.` });
  else if (P.canvasQ > 0.8) f.push({ fx: 'plus', text: `${p(P.canvas)} high and mid cloud overhead. That is a good canvas for color.` });
  else if (P.canvas >= 0.9) f.push({ fx: 'neutral', text: `High and mid cloud covers ${p(P.canvas)} of the sky. It can light up fully if the light gets underneath.` });
  else f.push({ fx: 'neutral', text: `Thin high and mid cloud (${p(P.canvas)}). Some color is possible.` });
  // Path
  if (P.canvas >= 0.1) {
    if (P.pathLow > 0.55) f.push({ fx: 'minus', text: `Low cloud ${p(P.pathLow)} along the light path ${PATH_KM[0]}-${PATH_KM[1]} km ${dir}. It may block the sun's light before it reaches your clouds.` });
    else if (P.pathLow < 0.2) f.push({ fx: 'plus', text: `Clear light path toward the sun (${dir}): ${P.pathLow < 0.03 ? 'no' : 'only ' + p(P.pathLow)} low cloud out to ${PATH_KM[1]} km.` });
    else f.push({ fx: 'neutral', text: `Some low cloud toward the sun (${p(P.pathLow)}, ${dir}). Light may get through in gaps.` });
  }
  // Local low
  if (c.low > 0.65) f.push({ fx: 'minus', text: `Low overcast overhead (${p(c.low)}) will hide most of the sky.` });
  else if (c.low > 0.12 && c.low < 0.4) f.push({ fx: 'plus', text: `Scattered low cloud (${p(c.low)}) can catch deep red light right at the horizon.` });
  // Air
  if (c.rh != null && c.rh >= 80) f.push({ fx: 'minus', text: `Humidity ${Math.round(c.rh)}% will soften and wash out colors.` });
  else if (c.rh != null && c.rh <= 55) f.push({ fx: 'plus', text: `Dry air (${Math.round(c.rh)}% humidity) keeps colors crisp.` });
  if (c.vis != null && c.vis < 10000) f.push({ fx: 'minus', text: `Visibility ${(c.vis / 1000).toFixed(1)} km. Haze or fog will mute the light.` });
  if (c.aod != null) {
    if (c.aod > 0.5) f.push({ fx: 'minus', text: `Heavy aerosol (optical depth ${c.aod.toFixed(2)}): smoke or dust will dim the sun into a red disc.` });
    else if (c.aod >= 0.15) f.push({ fx: 'plus', text: `Moderate aerosol (optical depth ${c.aod.toFixed(2)}) can deepen the reds.` });
  }
  // Rain
  if (c.precip > 0.2) f.push({ fx: 'minus', text: `Rain likely (${Math.round(c.pop * 100)}% chance, ${c.precip.toFixed(1)} mm/h).` });
  if (P.clearing) f.push({ fx: 'plus', text: `Rain clearing just before ${kind}. Clean, freshly washed air often gives standout color.` });
  return f;
}

export function headline(c, r, kind) {
  const P = r.parts;
  if (c.precip > 0.3 && c.pop > 0.5) return `Rain is likely around ${kind}. The sky will probably stay gray.`;
  if (c.low > 0.75) return `Thick low cloud. Expect a gray ${kind}, maybe a brief glow at the edges.`;
  if (P.canvas < 0.1) return `Mostly clear. A clean orange-to-blue gradient along the horizon, without much cloud color.`;
  if (P.pathLow > 0.55) return `Clouds overhead, but a cloud bank toward the sun may cut off the light.`;
  if (r.score >= 80) return `High clouds with an open path to the sun. Good odds of the whole sky turning pink and orange.`;
  if (r.score >= 62) return `A promising setup. Clouds overhead should catch strong color.`;
  if (r.score >= 45) return `Decent odds of some color on the clouds.`;
  return `Muted colors are most likely.`;
}

function confidence(tMs) {
  const h = (tMs - Date.now()) / 3600000;
  if (h < 30) return { level: 'High', note: 'Forecast within about a day.' };
  if (h < 78) return { level: 'Medium', note: 'Cloud forecasts shift a lot 2 to 3 days out.' };
  return { level: 'Low', note: 'Cloud forecasts this far out are a rough guide.' };
}

// Build the list of days with sunrise/sunset forecasts.
export function buildDays(data, lat, lon) {
  const off = data.weather[0].utc_offset_seconds * 1000;
  const now = Date.now();
  const firstLocalMidnight = Math.floor((now + off) / 86400000) * 86400000 - off;
  const days = [];
  const lastT = data.weather[0].hourly.time.at(-1) * 1000;
  for (let i = 0; i < 7; i++) {
    const start = firstLocalMidnight + i * 86400000;
    const ev = dayEvents(start, lat, lon);
    const day = { start, events: ev, offset: off };
    for (const kind of ['sunrise', 'sunset']) {
      const t = ev[kind];
      if (!t || t > lastT) { day[kind] = null; continue; }
      const az = kind === 'sunrise' ? ev.sunriseAz : ev.sunsetAz;
      const c = conditionsAt(data, t, kind);
      const r = scoreSky(c);
      day[kind] = {
        kind, t, az, cond: c, ...r,
        past: t < now - 20 * 60000,
        headline: headline(c, r, kind),
        factors: explain(c, r, kind, az),
        confidence: confidence(t),
      };
    }
    days.push(day);
  }
  return days;
}
