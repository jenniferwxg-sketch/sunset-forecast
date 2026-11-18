// Solar position (NOAA algorithm) and twilight event finding.
// All times are Unix milliseconds (UTC). Angles in degrees.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function sunPosition(ms, lat, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;

  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;

  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    4 * DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  const d = new Date(ms);
  const minutesUTC = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let tst = (minutesUTC + eqTime + 4 * lon) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180;

  const cosZen =
    Math.sin(lat * RAD) * Math.sin(decl * RAD) +
    Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen))) * DEG;
  const elevation = 90 - zen;

  const azDen = Math.cos(lat * RAD) * Math.sin(zen * RAD);
  let azimuth;
  if (Math.abs(azDen) > 1e-6) {
    let azRad = (Math.sin(lat * RAD) * Math.cos(zen * RAD) - Math.sin(decl * RAD)) / azDen;
    azRad = Math.min(1, Math.max(-1, azRad));
    const a = Math.acos(azRad) * DEG;
    azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  } else {
    azimuth = lat > 0 ? 180 : 0;
  }
  return { elevation, azimuth };
}

// Find the moment the sun crosses `angle` (degrees) between t0 and t1,
// rising (true) or setting (false). Returns ms or null.
function findCrossing(t0, t1, lat, lon, angle, rising) {
  const step = 5 * 60000;
  let prev = sunPosition(t0, lat, lon).elevation - angle;
  for (let t = t0 + step; t <= t1; t += step) {
    const cur = sunPosition(t, lat, lon).elevation - angle;
    const crossed = rising ? prev < 0 && cur >= 0 : prev > 0 && cur <= 0;
    if (crossed) {
      let a = t - step, b = t;
      for (let i = 0; i < 20; i++) {
        const m = (a + b) / 2;
        const v = sunPosition(m, lat, lon).elevation - angle;
        if (rising ? v < 0 : v > 0) a = m; else b = m;
      }
      return Math.round((a + b) / 2);
    }
    prev = cur;
  }
  return null;
}

// Events for the local calendar day that starts at `dayStartMs` (local midnight in UTC ms).
export function dayEvents(dayStartMs, lat, lon) {
  const a = dayStartMs, b = dayStartMs + 86400000;
  const noon = a + 12 * 3600000;
  const f = (ang, rising) =>
    rising ? findCrossing(a, noon + 2 * 3600000, lat, lon, ang, true)
           : findCrossing(noon - 2 * 3600000, b, lat, lon, ang, false);
  const sunrise = f(-0.833, true);
  const sunset = f(-0.833, false);
  return {
    sunrise,
    sunset,
    sunriseAz: sunrise ? sunPosition(sunrise, lat, lon).azimuth : null,
    sunsetAz: sunset ? sunPosition(sunset, lat, lon).azimuth : null,
    // morning
    civilDawn: f(-6, true),
    blueDawnEnd: f(-4, true),
    goldenMorningEnd: f(6, true),
    // evening
    goldenEveningStart: f(6, false),
    blueDuskStart: f(-4, false),
    civilDusk: f(-6, false),
  };
}

// Point `km` away from (lat, lon) along bearing `az` (degrees from north).
export function destination(lat, lon, az, km) {
  const R = 6371;
  const d = km / R;
  const p1 = lat * RAD, l1 = lon * RAD, th = az * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 };
}

export function compass(az) {
  const names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return names[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}
