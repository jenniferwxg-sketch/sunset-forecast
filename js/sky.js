// Procedural sky preview: gradient from sun elevation, three cloud decks
// sized by the forecast, each lit (or not) depending on its height,
// the sun's depression below the horizon, and the light path toward the sun.

const DEG = 180 / Math.PI;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Sky colors by sun elevation: [zenith, middle, horizon]
const SKY_KEYS = [
  [12, ['#3d6db0', '#7ea6d8', '#e9e4cf']],
  [5, ['#39609f', '#8aa5cc', '#f4d3a0']],
  [1.5, ['#324f88', '#9b97b8', '#f8ac66']],
  [-1, ['#2a3f74', '#8f7398', '#f0803f']],
  [-3, ['#1e2c5a', '#6e4f80', '#d65b3c']],
  [-5, ['#151f48', '#433568', '#9b4150']],
  [-8, ['#0b1331', '#1e2148', '#3a2a4c']],
  [-12, ['#060a1d', '#0c1230', '#171a36']],
].map(([e, c]) => [e, c.map(hex)]);

function skyAt(e) {
  if (e >= SKY_KEYS[0][0]) return SKY_KEYS[0][1];
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const [e1, c1] = SKY_KEYS[i];
    if (e >= e1) {
      const [e0, c0] = SKY_KEYS[i - 1];
      const t = (e0 - e) / (e0 - e1);
      return c0.map((c, k) => mix(c, c1[k], t));
    }
  }
  return SKY_KEYS.at(-1)[1];
}

// Color of sunlight reaching a cloud, by how far the sun sits above that cloud's horizon.
const LIGHT_KEYS = [
  [8, hex('#fff3e2')], [4, hex('#ffd59a')], [2, hex('#ffa95c')],
  [1, hex('#ff7a45')], [0.4, hex('#f2556a')], [0, hex('#c4466e')],
];
function lightAt(el) {
  if (el >= LIGHT_KEYS[0][0]) return LIGHT_KEYS[0][1];
  for (let i = 1; i < LIGHT_KEYS.length; i++) {
    if (el >= LIGHT_KEYS[i][0]) {
      const [e0, c0] = LIGHT_KEYS[i - 1], [e1, c1] = LIGHT_KEYS[i];
      return mix(c0, c1, (e0 - el) / (e0 - e1));
    }
  }
  return LIGHT_KEYS.at(-1)[1];
}

// Seeded value noise
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => rnd());
  const v = (x, y) => val[perm[(perm[x & 255] + y) & 255]];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), u), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
  };
  return (x, y, oct = 5) => {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += a * n2(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

const LAYERS = {
  high: { km: 8, sx: 0.9, sy: 7, top: 0, bottom: 0.97, oct: 5 },
  mid: { km: 4, sx: 2.4, sy: 9, top: 0.04, bottom: 0.985, oct: 5 },
  low: { km: 1.2, sx: 3.5, sy: 6, top: 0.32, bottom: 1, oct: 4 },
};

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.cache = null;
    this.ground = null;
  }

  // Prepare cloud density fields for a given forecast (expensive; done once per event).
  prepare(cond, seed) {
    const W = 480, H = Math.round(W * this.aspect());
    const horizon = Math.round(H * 0.8);
    const lowOver = smooth(0.55, 0.95, cond.low);
    const fields = {};
    for (const [name, L] of Object.entries(LAYERS)) {
      const cover = clamp(cond[name]);
      const noise = makeNoise(seed + name.length * 977);
      const raw = new Float32Array(W * horizon);
      for (let y = 0; y < horizon; y++) {
        const yy = y / horizon;
        // Perspective: depth grows toward the horizon.
        const depth = 14 * Math.tanh(1 / (1.03 - yy) / 14);
        for (let x = 0; x < W; x++) {
          const u = ((x / W) - 0.5) * depth * L.sx * (name === 'high' ? 0.35 : 1);
          const v = depth * L.sy * 0.18 + (name === 'high' ? u * 0.25 : 0);
          raw[y * W + x] = noise(u + 13.1, v, L.oct);
        }
      }
      // Threshold at the quantile that gives the forecast coverage.
      const sorted = Float32Array.from(raw.filter((_, i) => i % 7 === 0)).sort();
      const th = cover <= 0.01 ? 2 : sorted[Math.floor((1 - cover) * (sorted.length - 1))];
      const soft = name === 'high' ? 0.08 : 0.05;
      const dens = new Float32Array(W * horizon);
      for (let y = 0; y < horizon; y++) {
        const yy = y / horizon;
        const top = name === 'low' ? lerp(L.top, -0.2, lowOver) : L.top;
        const band = smooth(top, top + 0.15, yy) * (1 - smooth(L.bottom - 0.02, L.bottom, yy));
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          dens[i] = smooth(th - soft, th + soft, raw[i]) * band * (name === 'high' ? 0.75 : 0.92);
        }
      }
      fields[name] = dens;
    }
    const gnoise = makeNoise(seed + 5);
    const ground = new Float32Array(W);
    for (let x = 0; x < W; x++) ground[x] = horizon - Math.max(0, gnoise(x / 90, 0.5, 4) - 0.35) * H * 0.12;
    this.cache = { W, H, horizon, fields, ground, cond };
  }

  aspect() {
    const r = this.canvas.getBoundingClientRect();
    return r.width > 0 ? clamp(r.height / r.width, 0.35, 1.4) : 0.5;
  }

  // Draw the sky with the sun at elevation `e` (degrees).
  render(e, parts) {
    if (!this.cache) return;
    const { W, H, horizon, fields, ground, cond } = this.cache;
    const img = new ImageData(W, H);
    const d = img.data;
    const [zen, midc, hor] = skyAt(e);
    const clarity = parts.clarity;
    const haze = (1 - clarity) * 0.55 + (cond.precip > 0.2 ? 0.3 : 0);
    const hazeCol = mix(hex('#a9a3a0'), hor, 0.35);
    const sunX = W / 2;
    const sunY = horizon - e * (H / 34);
    const lowOver = smooth(0.55, 0.95, cond.low);

    const light = {};
    for (const [name, L] of Object.entries(LAYERS)) {
      // Depression angle at which a cloud at height km loses direct sun.
      const dip = Math.sqrt((2 * L.km) / 6371) * DEG;
      const el = e + dip;
      // Low cloud toward the sun shades the higher decks; low deck is shaded by the overcast itself.
      const pathT = name === 'low' ? 1 - 0.5 * parts.pathLow : parts.transmit;
      // Under a low overcast the higher decks are hidden, and rain dulls everything.
      const under = name === 'low' ? 1 - 0.75 * lowOver : 1;
      const lit = smooth(-0.3, 0.6, el) * pathT * under * (cond.precip > 0.2 ? 0.25 : 1);
      light[name] = { col: lightAt(el), lit, el };
    }
    const sunlit = smooth(-6, 2, e);

    for (let y = 0; y < H; y++) {
      const yy = y / horizon;
      let base;
      if (y < horizon) {
        const t = Math.pow(clamp(yy), 1.6);
        base = t < 0.55 ? mix(zen, midc, t / 0.55) : mix(midc, hor, (t - 0.55) / 0.45);
        base = mix(base, hazeCol, haze * Math.pow(clamp(yy), 2));
        // Overcast flattens the gradient to gray.
        base = mix(base, mix(hex('#6d7080'), hor, 0.25).map((v) => v * (0.35 + 0.65 * sunlit)), lowOver * 0.8);
      }
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (y >= horizon) {
          // ground silhouette
          const g = mix(hex('#5e5040'), hor, 0.18 + 0.08 * sunlit).map((v) => v * (0.6 + 0.4 * sunlit));
          d[i] = g[0]; d[i + 1] = g[1]; d[i + 2] = g[2]; d[i + 3] = 255;
          continue;
        }
        let c = base.slice();
        // sun glow
        const dx = (x - sunX) / W, dy = (y - sunY) / H;
        const r2 = dx * dx * 1.2 + dy * dy * 3;
        const glow = Math.exp(-r2 * 14) * smooth(-7, 1, e) * (0.55 + 0.45 * clarity);
        c = mix(c, mix(hex('#ffcf8a'), hex('#ff7a3d'), smooth(4, -2, e)), clamp(glow * 0.75));
        const fwd = Math.exp(-(dx * dx) * 6); // forward scattering near the sun's azimuth
        for (const name of ['high', 'mid', 'low']) {
          const den = fields[name][y * W + x] * (name === 'low' ? 1 : 1 - 0.9 * lowOver);
          if (den <= 0.003) continue;
          const L = light[name];
          const shade = mix(base, hex('#3b3e4f'), name === 'low' ? 0.55 : 0.35).map((v) => v * (0.45 + 0.55 * sunlit));
          let lc = mix(shade, L.col.map((v) => v * (0.75 + 0.25 * fwd)), L.lit * (0.55 + 0.45 * clarity));
          if (name === 'low' && L.el > 0.2) lc = mix(lc, shade, 0.35);
          c = mix(c, lc, den);
        }
        // sun disc
        const sd = Math.hypot((x - sunX), (y - sunY) * 1.06);
        if (e > -1 && sd < W * 0.012) {
          const vis = 1 - lowOver * 0.95 - fields.low[y * W + x] * 0.9 - fields.mid[y * W + x] * 0.6;
          c = mix(c, mix(hex('#fff2c8'), hex('#ff6a2e'), smooth(6, -0.5, e)), clamp(vis));
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }

    this.buf.width = W; this.buf.height = H;
    this.buf.getContext('2d').putImageData(img, 0, 0);
    const cv = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(rect.width * dpr));
    cv.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.buf, 0, 0, cv.width, cv.height);
    // Smooth hill silhouette drawn at full resolution.
    const g = mix(hex('#5e5040'), hor, 0.18 + 0.08 * sunlit).map((v) => v * (0.6 + 0.4 * sunlit));
    const sx = cv.width / W, sy = cv.height / H;
    ctx.fillStyle = `rgb(${g.map(Math.round).join(',')})`;
    ctx.beginPath();
    ctx.moveTo(0, cv.height);
    for (let x = 0; x < W; x++) ctx.lineTo(x * sx, ground[x] * sy);
    ctx.lineTo(cv.width, ground[W - 1] * sy);
    ctx.lineTo(cv.width, cv.height);
    ctx.closePath();
    ctx.fill();
    if (cond.precip > 0.2) {
      ctx.strokeStyle = 'rgba(200,205,220,0.18)';
      ctx.lineWidth = dpr;
      for (let k = 0; k < 160; k++) {
        const x = ((k * 97.3) % 1) * cv.width + (k * 37) % cv.width;
        const y = (k * 53) % (cv.height * 0.75);
        ctx.beginPath(); ctx.moveTo(x % cv.width, y); ctx.lineTo((x % cv.width) - 4 * dpr, y + 18 * dpr); ctx.stroke();
      }
    }
  }
}
