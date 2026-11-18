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
export const PATH_KM = [100, 250];
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

export async function fetchForecast(lat, lon) {
  const { pts } = queryPoints(lat, lon);
  const la = pts.map((p) => p.lat.toFixed(3)).join(',');
  const lo = pts.map((p) => p.lon.toFixed(3)).join(',');
  const wx = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=${HOURLY}&forecast_days=${FORECAST_DAYS}&past_days=1&timeformat=unixtime&timezone=auto`;
  const aq = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=aerosol_optical_depth,dust,pm2_5&forecast_days=5&past_days=1&timeformat=unixtime&timezone=auto`;
  const [w, a] = await Promise.all([
    fetch(wx).then((r) => (r.ok ? r.json() : Promise.reject(new Error('The weather service is not responding right now.')))),
    fetch(aq).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const arr = Array.isArray(w) ? w : [w];
  return { weather: arr, air: a, fetchedAt: Date.now() };
}
