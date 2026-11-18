import { fetchForecast, searchPlaces } from './api.js?v=7';
import { buildDays, labelFor } from './score.js?v=7';
import { sunPosition, compass } from './sun.js?v=7';
import { SkyRenderer } from './sky.js?v=7';

const $ = (s) => document.querySelector(s);
const state = { place: null, days: [], sel: null, offset: 0, data: null };
const sky = new SkyRenderer($('#sky'));

const DEFAULT_PLACE = { name: 'Montreal', region: 'Quebec, Canada', lat: 45.5019, lon: -73.5674 };
const PRESETS = [
  DEFAULT_PLACE,
  { name: 'San Francisco', region: 'California, United States', lat: 37.7749, lon: -122.4194 },
  { name: 'New York', region: 'New York, United States', lat: 40.7128, lon: -74.006 },
  { name: 'London', region: 'England, United Kingdom', lat: 51.5072, lon: -0.1276 },
  { name: 'Santorini', region: 'South Aegean, Greece', lat: 36.4618, lon: 25.3753 },
  { name: 'Tokyo', region: 'Japan', lat: 35.6762, lon: 139.6503 },
  { name: 'Sydney', region: 'New South Wales, Australia', lat: -33.8688, lon: 151.2093 },
];

// ---------- formatting ----------
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms, off) {
  if (!ms) return '—';
  const d = new Date(ms + off);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
}
function fmtDay(ms, off, i) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  return new Date(ms + off).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- storage ----------
function savePlace(p) { try { localStorage.setItem('glowcast.place.v2', JSON.stringify(p)); } catch {} }
function loadPlace() { try { return JSON.parse(localStorage.getItem('glowcast.place.v2')); } catch { return null; } }

// ---------- data ----------
async function load(place) {
  state.place = place;
  $('#place-name').textContent = place.name;
  $('#place-region').textContent = place.region || `${place.lat.toFixed(2)}°, ${place.lon.toFixed(2)}°`;
  setStatus('Loading the forecast…');
  try {
    const data = window.SNAPSHOT ? snapshotFor(place) : await fetchForecast(place.lat, place.lon);
    state.data = data;
    state.days = buildDays(data, place.lat, place.lon);
    savePlace(place);
    pickDefault();
    setStatus('');
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Could not load the forecast. Check your connection and try again.', true);
  }
}

function snapshotFor(place) {
  const s = window.SNAPSHOT.find((x) => x.name === place.name);
  if (!s) throw new Error('This preview only includes the sample cities. The full site searches anywhere.');
  return s.data;
}

function pickDefault() {
  const now = Date.now();
  for (let i = 0; i < state.days.length; i++) {
    for (const k of ['sunrise', 'sunset']) {
      const ev = state.days[i][k];
      if (ev && ev.t > now - 15 * 60000) { select(i, k, false); return; }
    }
  }
  select(0, 'sunset', false);
}

function select(i, kind, draw = true) {
  state.sel = { i, kind };
  const ev = state.days[i]?.[kind];
  state.offset = kind === 'sunset' ? 8 : -8;
  $('#scrub').value = state.offset;
  if (ev) sky.prepare(ev.cond, Math.floor(ev.t / 3600000) + (kind === 'sunset' ? 7 : 3));
  if (draw) renderAll();
}

// ---------- rendering ----------
function setStatus(msg, isErr = false) {
  const el = $('#status');
  el.textContent = msg;
  el.hidden = !msg;
  el.classList.toggle('err', isErr);
}

function renderAll() {
  renderHero();
  renderTimes();
  renderWhy();
  renderSpots();
  renderConditions();
  renderWeek();
}

function current() {
  const { i, kind } = state.sel;
  return { day: state.days[i], ev: state.days[i][kind], kind, i };
}

function drawSky() {
  const { ev } = current();
  if (!ev) return;
  const t = ev.t + state.offset * 60000;
  const e = sunPosition(t, state.place.lat, state.place.lon).elevation;
  sky.render(e, ev.parts);
  const off = current().day.offset;
  const rel = state.offset === 0 ? `at ${ev.kind}` : `${Math.abs(state.offset)} min ${state.offset < 0 ? 'before' : 'after'} ${ev.kind}`;
  $('#scrub-label').textContent = `${fmtTime(t, off)}, ${rel}`;
  $('#scrub-elev').textContent = `Sun ${e >= 0 ? '+' : '−'}${Math.abs(e).toFixed(1)}°`;
}

function renderHero() {
  const { day, ev, kind, i } = current();
  const hero = $('#hero');
  if (!ev) {
    hero.dataset.tone = 'poor';
    $('#hero-kind').textContent = `${fmtDay(day.start, day.offset, i)} · ${kind}`;
    $('#hero-score').textContent = '—';
    $('#hero-label').textContent = 'No forecast';
    $('#hero-line').textContent = 'The sun does not rise or set on this day here, or the forecast does not reach it yet.';
    return;
  }
  hero.dataset.tone = ev.tone;
  $('#hero-kind').textContent = `${fmtDay(day.start, day.offset, i)} · ${kind} ${fmtTime(ev.t, day.offset)}`;
  $('#hero-score').textContent = ev.score;
  $('#hero-label').textContent = ev.label;
  $('#hero-line').textContent = ev.headline;
  $('#hero-conf').textContent = `${ev.confidence.level} confidence. ${ev.confidence.note}`;
  $('#hero-dir').textContent = `Look ${compass(ev.az)} (${Math.round(ev.az)}°)`;
  requestAnimationFrame(drawSky);
}

function renderTimes() {
  const { day, kind } = current();
  const e = day.events, o = day.offset;
  const rows = kind === 'sunrise'
    ? [
        ['Civil twilight starts', fmtTime(e.civilDawn, o)],
        ['Blue hour', `${fmtTime(e.civilDawn, o)} – ${fmtTime(e.blueDawnEnd, o)}`],
        ['Sunrise', fmtTime(e.sunrise, o)],
        ['Sun rises toward', e.sunriseAz ? `${Math.round(e.sunriseAz)}° ${compass(e.sunriseAz)}` : '—'],
        ['Golden hour', `${fmtTime(e.sunrise, o)} – ${fmtTime(e.goldenMorningEnd, o)}`],
        ['Sunset', fmtTime(e.sunset, o)],
      ]
    : [
        ['Golden hour', `${fmtTime(e.goldenEveningStart, o)} – ${fmtTime(e.sunset, o)}`],
        ['Sunset', fmtTime(e.sunset, o)],
        ['Sun sets toward', e.sunsetAz ? `${Math.round(e.sunsetAz)}° ${compass(e.sunsetAz)}` : '—'],
        ['Blue hour', `${fmtTime(e.blueDuskStart, o)} – ${fmtTime(e.civilDusk, o)}`],
        ['Civil twilight ends', fmtTime(e.civilDusk, o)],
        ['Sunrise', fmtTime(e.sunrise, o)],
      ];
  $('#times').innerHTML = rows.map(([k, v]) => `<div class="trow"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

// Montreal viewpoints, each with the source that states its view direction.
const MTL = { lat: 45.5019, lon: -73.5674 };
const SPOTS = {
  sunset: [
    { name: 'Olmsted Trail "Sunset lookout", Mount Royal', note: 'Tourisme Montréal recommends this spot because it faces west. It is marked "Sunset lookout" on Google Maps.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
    { name: 'Parc René-Lévesque, Lachine', note: 'A peninsula at the western end of the Lachine Canal, with views across Lac Saint-Louis from the benches at its tip.', src: 'https://www.mtlblog.com/montreal/9-spots-to-catch-sunset-views-in-near-montreal/parc-rene-levesque-parc-st-louis-in-lachine', srcName: 'MTL Blog (2020)' },
    { name: 'Parc Jean-Drapeau, Trois Disques sculpture', note: 'Listed by Tourisme Montréal as a sunset spot, looking across the St. Lawrence to the downtown skyline.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
  ],
  sunrise: [
    { name: 'Camillien-Houde Lookout, Mount Royal', note: 'The City of Montréal describes its view of the east side of Montreal, toward the Olympic Stadium tower. Open 6 AM to 11 PM.', src: 'https://montreal.ca/en/places/camillien-houde-lookout', srcName: 'Ville de Montréal' },
    { name: 'Kondiaronk Belvedere, Mount Royal', note: 'Tourisme Montréal notes that this lookout faces east.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
  ],
};
function nearMontreal(p) {
  const dLat = (p.lat - MTL.lat) * 111, dLon = (p.lon - MTL.lon) * 111 * Math.cos(MTL.lat * Math.PI / 180);
  return Math.hypot(dLat, dLon) < 40;
}
function renderSpots() {
  const panel = $('#spots-panel');
  const { ev, kind } = current();
  panel.hidden = !nearMontreal(state.place) || !ev;
  if (panel.hidden) return;
  $('#spots-dir').innerHTML = `The sun ${kind === 'sunset' ? 'sets' : 'rises'} at <b>${Math.round(ev.az)}° (${compass(ev.az)})</b> on this day. Pick a spot with an open view that way.`;
  $('#spots').innerHTML = SPOTS[kind].map((x) => `<li><b>${x.name}</b><span>${x.note}</span><a href="${x.src}" target="_blank" rel="noopener">Source: ${x.srcName}</a></li>`).join('');
}

function renderWhy() {
  const { ev } = current();
  $('#why').innerHTML = ev
    ? ev.factors.map((f) => `<li class="fx-${f.fx}"><span class="fx-mark" aria-hidden="true">${f.fx === 'plus' ? '+' : f.fx === 'minus' ? '−' : '•'}</span><span>${f.text}</span></li>`).join('')
    : '';
  $('#models').innerHTML = ev && ev.models
    ? ev.models.map((m) => `<div class="model t-${m.tone}${m.median ? ' mid' : ''}"><span class="mn">${m.label}</span><span class="mf">${m.from}</span><b>${m.score}</b></div>`).join('')
    : '';
}

function meter(label, value, display, hint) {
  const w = value == null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="meter"><div class="mtop"><span>${label}</span><b>${display}</b></div><div class="mbar"><i style="width:${w}%"></i></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
}

function renderConditions() {
  const { ev } = current();
  if (!ev) { $('#cond').innerHTML = ''; return; }
  const c = ev.cond, P = ev.parts, dir = compass(ev.az);
  $('#cond').innerHTML = [
    meter('High cloud', c.high, pct(c.high), 'Above 6 km. Catches color longest.'),
    meter('Mid cloud', c.mid, pct(c.mid), '2 to 6 km.'),
    meter('Low cloud overhead', c.low, pct(c.low), 'Below 2 km. Too much hides the sky.'),
    meter(`Low cloud toward the sun`, P.pathLow, pct(P.pathLow), `60 to 300 km ${dir}. Blocks the light.`),
    meter('Humidity', c.rh == null ? null : c.rh / 100, c.rh == null ? '—' : `${Math.round(c.rh)}%`),
    meter('Visibility', c.vis == null ? null : Math.min(1, c.vis / 30000), c.vis == null ? '—' : `${(c.vis / 1000).toFixed(0)} km`),
    meter('Aerosol optical depth', c.aod == null ? null : Math.min(1, c.aod / 0.8), c.aod == null ? 'n/a' : c.aod.toFixed(2), c.aod == null ? 'Only forecast 5 days out.' : 'Smoke, dust, pollution.'),
    meter('Chance of rain', c.pop, pct(c.pop)),
  ].join('');
}

function chip(ev, kind, i, off) {
  const sel = state.sel.i === i && state.sel.kind === kind;
  if (!ev) return `<button class="chip none" disabled><span class="ck">${kind === 'sunrise' ? 'Rise' : 'Set'}</span><span class="cs">—</span></button>`;
  return `<button class="chip t-${ev.tone}${sel ? ' sel' : ''}${ev.past ? ' past' : ''}" data-i="${i}" data-k="${kind}" aria-pressed="${sel}">
    <span class="ck">${kind === 'sunrise' ? 'Rise' : 'Set'} <em>${fmtTime(ev.t, off)}</em></span>
    <span class="cs">${ev.score}</span><span class="cl">${ev.label}</span></button>`;
}

function renderWeek() {
  $('#week').innerHTML = state.days.map((d, i) => `
    <div class="day"><h3>${fmtDay(d.start, d.offset, i)}</h3>
      ${chip(d.sunrise, 'sunrise', i, d.offset)}${chip(d.sunset, 'sunset', i, d.offset)}
    </div>`).join('');
}

// ---------- search ----------
let searchTimer;
async function doSearch(q) {
  const list = $('#results');
  if (q.trim().length < 2) { list.hidden = true; return; }
  if (window.SNAPSHOT) {
    const r = PRESETS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    showResults(r.length ? r : PRESETS);
    return;
  }
  try { showResults(await searchPlaces(q)); }
  catch (e) { list.innerHTML = `<li class="msg">${e.message}</li>`; list.hidden = false; }
}
function showResults(r) {
  const list = $('#results');
  list.innerHTML = r.length
    ? r.map((p, k) => `<li><button data-k="${k}"><b>${p.name}</b><span>${p.region}</span></button></li>`).join('')
    : '<li class="msg">No places found. Try a city or town name.</li>';
  list.hidden = false;
  list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    list.hidden = true; $('#q').value = ''; load(r[+b.dataset.k]);
  }));
}

// ---------- wiring ----------
$('#q').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 250); });
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#results').hidden = true; });
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('#results').hidden = true; });

$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) { setStatus('Your browser does not share location. Search for a place instead.', true); return; }
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => load({ name: 'Your location', region: `${pos.coords.latitude.toFixed(2)}°, ${pos.coords.longitude.toFixed(2)}°`, lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => setStatus('Location access was blocked. Search for a place instead.', true),
    { timeout: 10000, maximumAge: 600000 },
  );
});

$('#week').addEventListener('click', (e) => {
  const b = e.target.closest('button.chip[data-i]');
  if (b) select(+b.dataset.i, b.dataset.k);
});

$('#scrub').addEventListener('input', (e) => { state.offset = +e.target.value; drawSky(); });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.sel) select(state.sel.i, state.sel.kind); }, 200);
});

$('#presets').innerHTML = PRESETS.map((p, k) => `<button data-k="${k}">${p.name}</button>`).join('');
$('#presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) load(PRESETS[+b.dataset.k]); });

load(loadPlace() && !window.SNAPSHOT ? loadPlace() : DEFAULT_PLACE);
