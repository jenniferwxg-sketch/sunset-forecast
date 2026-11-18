import { fetchForecast, searchPlaces } from './api.js?v=17';
import { buildDays, labelFor } from './score.js?v=17';
import { sunPosition, compass } from './sun.js?v=17';
import { SkyRenderer } from './sky.js?v=17';
import { GLSky } from './sky-gl.js?v=17';

const $ = (s) => document.querySelector(s);
const state = { place: null, days: [], sel: null, offset: 0, data: null };
function makeSky(cv) {
  try { if (GLSky.supported(cv)) return new GLSky(cv); } catch (e) { console.warn('WebGL sky unavailable, using the simple sky.', e); }
  return new SkyRenderer(cv);
}
const sky = makeSky($('#sky'));

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
  $('#search').hidden = true;
  $('#place-name').textContent = place.name;
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
  state.offset = kind === 'sunset' ? 4 : -4;
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
  renderSummary();
  renderFacts();
  renderSpots();
  renderDetails();
  renderWeek();
}

function current() {
  const { i, kind } = state.sel;
  return { day: state.days[i], ev: state.days[i][kind], kind, i };
}

const DIRS = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };
const dirWords = (az) => DIRS[compass(az)];
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

function whenText(i, kind, day) {
  if (i === 0) return kind === 'sunset' ? 'Tonight’s sunset' : 'This morning’s sunrise';
  if (i === 1) return kind === 'sunset' ? 'Tomorrow’s sunset' : 'Tomorrow’s sunrise';
  return `${new Date(day.start + day.offset + 43200000).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} ${kind}`;
}

function drawSky() {
  const { ev, day } = current();
  if (!ev) return;
  const t = ev.t + state.offset * 60000;
  const e = sunPosition(t, state.place.lat, state.place.lon).elevation;
  sky.render(e, ev.parts);
  const rel = state.offset === 0 ? `at ${ev.kind}` : `${Math.abs(state.offset)} min ${state.offset < 0 ? 'before' : 'after'} ${ev.kind}`;
  $('#scrub-label').textContent = `${fmtTime(t, day.offset)}, ${rel}`;
}

function renderSummary() {
  const { day, ev, kind, i } = current();
  const v = $('#verdict');
  $('#v-when').textContent = whenText(i, kind, day);
  if (!ev) {
    v.dataset.tone = 'poor';
    $('#v-label').textContent = 'No forecast';
    $('#v-line').textContent = 'The sun does not rise or set here on this day, or the forecast does not reach it yet.';
    $('#why').textContent = ''; $('#v-conf').textContent = '';
    return;
  }
  v.dataset.tone = ev.tone;
  $('#v-label').textContent = ev.label;
  $('#v-line').textContent = ev.headline;
  $('#why').textContent = ev.factors.slice(0, 3).map((f) => f.text).join(' ');
  $('#v-conf').textContent = `${ev.confidence.level} confidence. ${ev.confidence.note}`;
  requestAnimationFrame(drawSky);
}

function renderFacts() {
  const { day, kind } = current();
  const e = day.events, o = day.offset;
  const range = (a, b) => (a && b ? `${fmtTime(a, o)} – ${fmtTime(b, o)}` : '—');
  const rows = kind === 'sunrise'
    ? [
        ['Sunrise', fmtTime(e.sunrise, o)],
        ['Look toward', e.sunriseAz ? cap(dirWords(e.sunriseAz)) : '—', e.sunriseAz ? `${Math.round(e.sunriseAz)}°` : ''],
        ['Blue hour', range(e.civilDawn, e.blueDawnEnd)],
        ['Golden hour', range(e.sunrise, e.goldenMorningEnd)],
      ]
    : [
        ['Sunset', fmtTime(e.sunset, o)],
        ['Look toward', e.sunsetAz ? cap(dirWords(e.sunsetAz)) : '—', e.sunsetAz ? `${Math.round(e.sunsetAz)}°` : ''],
        ['Golden hour', range(e.goldenEveningStart, e.sunset)],
        ['Blue hour', range(e.blueDuskStart, e.civilDusk)],
      ];
  $('#facts').innerHTML = rows.map(([k, v, x]) => `<div><dt>${k}</dt><dd>${v}${x ? ` <small>${x}</small>` : ''}</dd></div>`).join('');
}

// Montreal viewpoints, each with the source that states its view direction.
const MTL = { lat: 45.5019, lon: -73.5674 };
const SPOTS = {
  sunset: [
    { name: 'Sunset lookout, Olmsted Trail, Mount Royal', note: 'Faces west. Marked “Sunset lookout” on Google Maps.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
    { name: 'Parc René-Lévesque, Lachine', note: 'Benches at the tip look out over Lac Saint-Louis.', src: 'https://www.mtlblog.com/montreal/9-spots-to-catch-sunset-views-in-near-montreal/parc-rene-levesque-parc-st-louis-in-lachine', srcName: 'MTL Blog' },
    { name: 'Trois Disques sculpture, Parc Jean-Drapeau', note: 'Looks across the river to the downtown skyline.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
  ],
  sunrise: [
    { name: 'Camillien-Houde Lookout, Mount Royal', note: 'Looks over the east side of the city. Open from 6 AM.', src: 'https://montreal.ca/en/places/camillien-houde-lookout', srcName: 'Ville de Montréal' },
    { name: 'Kondiaronk Belvedere, Mount Royal', note: 'Faces east.', src: 'https://www.mtl.org/en/experience/best-places-montreal-to-watch-sunset', srcName: 'Tourisme Montréal' },
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
  $('#spots-dir').textContent = `The sun ${kind === 'sunset' ? 'sets' : 'rises'} in the ${dirWords(ev.az)}. These spots have an open view that way.`;
  $('#spots').innerHTML = SPOTS[kind].map((x) => `<li><b>${x.name}</b> <span>${x.note}</span> <a href="${x.src}" target="_blank" rel="noopener">${x.srcName}</a></li>`).join('');
}

function renderDetails() {
  const { ev } = current();
  if (!ev) { $('#models').innerHTML = ''; $('#cond').innerHTML = ''; $('#score-line').textContent = ''; return; }
  $('#score-line').textContent = `Score: ${ev.score} out of 100 (${ev.label}).`;
  $('#models').innerHTML = ev.models.map((m) => `<span class="model${m.median ? ' mid' : ''}">${m.label} <b>${m.score}</b></span>`).join('');
  const c = ev.cond, P = ev.parts;
  const rows = [
    ['High clouds', pct(c.high)], ['Middle clouds', pct(c.mid)], ['Low clouds above you', pct(c.low)],
    [`Low clouds toward the sun`, pct(P.pathLow)],
    ['Humidity', c.rh == null ? '—' : `${Math.round(c.rh)}%`],
    ['Visibility', c.vis == null ? '—' : `${(c.vis / 1000).toFixed(0)} km`],
    ['Smoke and dust (aerosol)', c.aod == null ? 'not available' : c.aod.toFixed(2)],
    ['Chance of rain', pct(c.pop)],
  ];
  $('#cond').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function slot(ev, kind, i, off) {
  const sel = state.sel.i === i && state.sel.kind === kind;
  const name = kind === 'sunrise' ? 'Rise' : 'Set';
  if (!ev) return `<button class="slot none" disabled aria-label="${kind}: no forecast"><i></i><span>${name}</span></button>`;
  return `<button class="slot t-${ev.tone}${sel ? ' sel' : ''}${ev.past ? ' past' : ''}" data-i="${i}" data-k="${kind}" aria-pressed="${sel}"
    aria-label="${kind} ${fmtTime(ev.t, off)}: ${ev.label}" title="${kind === 'sunrise' ? 'Sunrise' : 'Sunset'} ${fmtTime(ev.t, off)} · ${ev.label}"><i></i><span>${name}</span></button>`;
}

function renderWeek() {
  $('#week').innerHTML = state.days.map((d, i) => `
    <div class="day"><h4>${fmtDay(d.start, d.offset, i)}</h4>
      <div class="pair">${slot(d.sunrise, 'sunrise', i, d.offset)}${slot(d.sunset, 'sunset', i, d.offset)}</div>
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
    list.hidden = true; $('#q').value = ''; $('#search').hidden = true; load(r[+b.dataset.k]);
  }));
}

// ---------- wiring ----------
$('#q').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 250); });
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#results').hidden = true; $('#search').hidden = true; $('#city').focus(); } });
document.addEventListener('click', (e) => { if (!e.target.closest('.search') && !e.target.closest('.where')) { $('#results').hidden = true; if (!$('#q').value) $('#search').hidden = true; } });

function openSearch() {
  $('#search').hidden = false;
  $('#q').focus();
}
$('#city').addEventListener('click', openSearch);
$('#change').addEventListener('click', openSearch);

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
  const b = e.target.closest('button.slot[data-i]');
  if (b) select(+b.dataset.i, b.dataset.k);
});

$('#scrub').addEventListener('input', (e) => { state.offset = +e.target.value; drawSky(); });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.sel) select(state.sel.i, state.sel.kind); }, 200);
});


load(loadPlace() && !window.SNAPSHOT ? loadPlace() : DEFAULT_PLACE);
