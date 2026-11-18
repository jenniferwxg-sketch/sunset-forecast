// Data from Open-Meteo (free, no API key, CORS-enabled).
import { dayEvents, destination } from './sun.js';

const HOURLY = [
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover',
  'relative_humidity_2m', 'visibility', 'precipitation', 'precipitation_probability',
  'weather_code', 'temperature_2m',
].join(',');

// Distances (km) toward the sun where low cloud can block the light
// that colors clouds overhead. A cloud at 6-8 km is lit by rays that
// skim the horizon roughly 250-300 km away.
export const PATH_KM = [60, 150, 300];

// Independent weather models, compared like a forecaster would.
// gem_seamless uses Canada's 2.5 km HRDPS over North America.
export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF', from: 'Europe' },
  { id: 'gfs_seamless', label: 'GFS', from: 'United States' },
  { id: 'icon_seamless', label: 'ICON', from: 'Germany' },
  { id: 'gem_seamless', label: 'GEM / HRDPS', from: 'Canada' },
];
export const FORECAST_DAYS = 7;

export async function searchPlaces(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Place search is not responding right now.');
  const j = await r.json();
  return (j.results || []).map((p) => ({
    name: p.name,
    region: [p.admin1, p.country].filter(Boolean).join(', '),
    lat: p.latitude,
    lon: p.longitude,
  }));
}

// Coordinates queried in one request: [local, sunrise path..., sunset path...]
export function queryPoints(lat, lon) {
  const today = Date.now();
  const ev = dayEvents(today - (today % 86400000), lat, lon);
  const riseAz = ev.sunriseAz ?? 90;
  const setAz = ev.sunsetAz ?? 270;
  const pts = [{ lat, lon }];
  for (const km of PATH_KM) pts.push(destination(lat, lon, riseAz, km));
  for (const km of PATH_KM) pts.push(destination(lat, lon, setAz, km));
  return { pts, riseAz, setAz };
}

const VARS = HOURLY.split(',');

// Split a multi-model response into one view per model, each with plain
// variable names. A model missing a variable borrows it from the others.
function splitModels(points) {
  const views = [];
  for (const m of MODELS) {
    const has = points[0].hourly[`cloud_cover_low_${m.id}`];
    if (!has || has.every((v) => v == null)) continue;
    views.push({ ...m, weather: points.map((p) => ({ ...p, hourly: { time: p.hourly.time } })) });
  }
  for (const v of views) {
    v.weather.forEach((p, i) => {
      const src = points[i].hourly;
      for (const k of VARS) {
        const own = src[`${k}_${v.id}`] || [];
        const others = views.map((o) => src[`${k}_${o.id}`]).filter(Boolean);
        // Fill gaps (a variable the model lacks, or hours past its range) from the other models.
        p.hourly[k] = p.hourly.time.map((_, j) => {
          if (own[j] != null) return own[j];
          const alt = others.map((a) => a[j]).filter((x) => x != null);
          return alt.length ? alt.reduce((x, y) => x + y, 0) / alt.length : (src[k]?.[j] ?? null);
        });
      }
    });
  }
  return views;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('The weather service is not responding right now.');
  return r.json();
}

export async function fetchForecast(lat, lon) {
  const { pts } = queryPoints(lat, lon);
  const la = pts.map((p) => p.lat.toFixed(3)).join(',');
  const lo = pts.map((p) => p.lon.toFixed(3)).join(',');
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=${HOURLY}&forecast_days=${FORECAST_DAYS}&past_days=1&timeformat=unixtime&timezone=auto`;
  const aq = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=aerosol_optical_depth,dust,pm2_5&forecast_days=5&past_days=1&timeformat=unixtime&timezone=auto`;
  const air = getJSON(aq).catch(() => null);
  let views = [];
  try {
    const w = await getJSON(`${base}&models=${MODELS.map((m) => m.id).join(',')}`);
    views = splitModels(Array.isArray(w) ? w : [w]);
  } catch (e) { console.warn('Multi-model request failed, using the default model.', e); }
  if (!views.length) {
    const w = await getJSON(base);
    views = [{ id: 'best_match', label: 'Best match', from: 'Open-Meteo', weather: Array.isArray(w) ? w : [w] }];
  }
  return { views, air: await air, fetchedAt: Date.now() };
}
