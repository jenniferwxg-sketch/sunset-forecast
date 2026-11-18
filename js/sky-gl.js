// Physically based sky preview (WebGL).
//
// Sky: single-scattering atmosphere (Rayleigh + Mie) on a spherical Earth,
// integrated along each view ray, as in Nishita et al. (1993).
// Haze: Mie extinction set from the forecast aerosol optical depth.
// Clouds: three thin layers (low 1.5 km, mid 4 km, high 8 km) with the
// forecast cover. Each is lit by sunlight attenuated along its own path to
// the sun, so clouds turn yellow, orange, then red, and go dark when the
// Earth's shadow reaches their height. Low cloud forecast toward the sun
// dims the light reaching the higher layers.
// Cloud shapes are procedural noise: their amount comes from the forecast,
// their exact shapes do not.

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uSunElev;
uniform float uFov;
uniform float uPitch;
uniform vec3 uCover;      // low, mid, high (0..1)
uniform float uAod;
uniform float uPathT;     // light reaching mid/high clouds past low cloud toward the sun
uniform float uPathLow;
uniform float uRain;
uniform float uSeed;
uniform float uTime;
uniform float uExposure;

const float PI = 3.14159265;
const float R = 6360.0;
const float RA = 6420.0;
const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3); // Rayleigh scattering at sea level, per km
const float HR = 8.0;
const float HM = 1.2;
const float SUN = 22.0;
// Ozone absorption (Chappuis band), per km at peak density; layer centered at 25 km, 30 km wide.
// Without it, twilight skies come out gray-yellow instead of blue (Hulburt 1953).
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
float ozone(float h) { return max(0.0, 1.0 - abs(h - 25.0) / 15.0); }

vec2 sphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Mie extinction at ground, per km, from aerosol optical depth at 550 nm,
// spread across colors with the Angstrom law (exponent 1.3, a typical value).
vec3 bM() { return clamp(uAod, 0.02, 1.5) / HM * vec3(0.76, 1.0, 1.34); }

// Transmittance from p toward the sun; 0 when the Earth blocks it.
vec3 sunTrans(vec3 p, vec3 s) {
  float tA = sphere(p, s, RA).y;
  float dt = tA / 10.0;
  float odR = 0.0, odM = 0.0, odO = 0.0;
  // Lowest height the sun ray reaches: below 0 means the Earth is in the way.
  float along = dot(p, s);
  float hmin = along >= 0.0 ? length(p) - R : length(p - s * along) - R;
  for (int i = 0; i < 10; i++) {
    vec3 q = p + s * (float(i) + 0.5) * dt;
    float h = length(q) - R;
    odR += exp(-h / HR) * dt;
    odM += exp(-max(h, 0.0) / HM) * dt;
    odO += ozone(h) * dt;
  }
  vec3 tr = exp(-(BR * odR + bM() * 1.1 * odM + BO * odO));
  // Soft edge of the Earth's shadow (refraction and terrain blur it in reality).
  float lit = smoothstep(-0.6, 0.3, hmin);
  return tr * lit;
}

vec3 skyColor(vec3 ro, vec3 rd, vec3 s, float tMax) {
  float tA = sphere(ro, rd, RA).y;
  float tE = sphere(ro, rd, R).x;
  float tEnd = tA;
  if (tE > 0.0) tEnd = min(tEnd, tE);
  tEnd = min(tEnd, tMax);
  float dt = tEnd / 16.0;
  float mu = dot(rd, s);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 q = ro + rd * (float(i) + 0.5) * dt;
    float h = max(length(q) - R, 0.0);
    float dR = exp(-h / HR) * dt, dM = exp(-h / HM) * dt;
    odR += dR; odM += dM; odO += ozone(h) * dt;
    vec3 tView = exp(-(BR * odR + bM() * 1.1 * odM + BO * odO));
    vec3 tSun = sunTrans(q, s);
    sumR += dR * tView * tSun;
    sumM += dM * tView * tSun;
  }
  return SUN * (sumR * BR * pR + sumM * bM() * 0.9 * pM);
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// fbm with detail faded out where it would be smaller than a pixel (footprint fp).
float fbm(vec2 p, float fp) {
  float a = 0.5, f = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = clamp(1.5 - f * fp * 2.0, 0.0, 1.0);
    s += a * w * vnoise(p * f + float(i) * 7.13);
    s += a * (1.0 - w) * 0.5;
    n += a;
    a *= 0.5; f *= 2.03;
  }
  return s / n;
}

// One cloud layer: returns rgb in .rgb and opacity in .a
vec4 cloudLayer(vec3 ro, vec3 rd, vec3 s, float hKm, float cover, vec2 scale, float albedo, float pathT, vec3 behind, float pixAng, float k) {
  if (cover < 0.01) return vec4(0.0);
  vec2 tt = sphere(ro, rd, R + hKm);
  float t = tt.y;
  if (t <= 0.0 || t > 900.0) return vec4(0.0);
  vec3 p = ro + rd * t;
  float fp = t * pixAng / max(abs(rd.y) + 0.03, 0.03) * max(scale.x, scale.y);
  vec2 uv = p.xz * scale + vec2(uSeed * 17.0 + k * 31.0, uSeed * 7.0) + vec2(uTime * 0.002 * (1.0 + k), 0.0);
  float n = fbm(uv, fp);
  float th = mix(0.74, 0.26, cover);
  float soft = 0.045 + 0.03 * k;
  float dens = smoothstep(th - soft, th + soft, n);
  // detail inside the cloud, for thicker centers
  float core = smoothstep(th, th + 0.25, n);
  float alpha = dens * mix(0.55, 0.95, core) * (k > 1.5 ? 0.75 : 1.0);
  // distance fade into haze
  float far = exp(-t / 260.0);
  // Extensive low decks are thick and shade their own undersides.
  float selfShade = k < 0.5 ? mix(1.0, 0.35, smoothstep(0.5, 1.0, cover)) : 1.0;
  vec3 light = SUN * sunTrans(p, s) * pow(pathT, 1.5) * selfShade;
  float mu = dot(rd, s);
  float g = 0.55;
  float hg = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 lit = light * albedo * (0.06 + 0.35 * hg) * mix(1.0, 0.55, core * (2.0 - k) * 0.5);
  vec3 amb = behind * (0.55 + 0.25 * albedo) * (k < 0.5 ? mix(1.0, 0.6, cover) : 1.0);
  vec3 col = lit + amb;
  col = mix(behind, col, far);
  return vec4(col, alpha * mix(0.25, 1.0, far));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  float tx = tan(uFov * 0.5);
  vec3 f = vec3(0.0, sin(uPitch), -cos(uPitch));
  vec3 rt = vec3(1.0, 0.0, 0.0);
  vec3 up = cross(rt, f);
  vec3 rd = normalize(f + uv.x * tx * rt + uv.y * tx / aspect * up);
  vec3 ro = vec3(0.0, R + 0.05, 0.0);
  vec3 s = vec3(0.0, sin(uSunElev), -cos(uSunElev));
  float pixAng = 2.0 * tx / uRes.x;

  // distant hills: angle above the horizon by azimuth
  float az = atan(rd.x, -rd.z);
  float hill = 0.0035 + 0.0022 * sin(az * 4.0 + uSeed * 6.0) + 0.0014 * sin(az * 11.0 + 1.7) + 0.0007 * sin(az * 27.0 + uSeed * 3.0);
  float horizonY = -0.004;

  vec3 col = skyColor(ro, rd, s, 1e9);

  if (rd.y > horizonY) {
    // cloud layers, far (high) to near (low)
    vec4 c;
    c = cloudLayer(ro, rd, s, 8.0, uCover.z, vec2(0.1, 0.24), 0.95, uPathT, col, pixAng, 2.0);
    col = mix(col, c.rgb, c.a);
    c = cloudLayer(ro, rd, s, 4.0, uCover.y, vec2(0.22, 0.3), 0.85, uPathT, col, pixAng, 1.0);
    col = mix(col, c.rgb, c.a * (1.0 - 0.85 * smoothstep(0.6, 0.95, uCover.x)));
    c = cloudLayer(ro, rd, s, 1.5, uCover.x, vec2(0.45, 0.55), 0.7, 1.0 - 0.5 * uPathLow, col, pixAng, 0.0);
    col = mix(col, c.rgb, c.a);
    // sun disc
    float mu = dot(rd, s);
    if (mu > 0.99996) col += SUN * 40.0 * sunTrans(ro, s) * (1.0 - 0.95 * smoothstep(0.6, 0.95, uCover.x));
  }

  // ground: hills silhouette catching a little sky light
  // Anti-aliased edge (about 1.5 px wide) so the hill line is smooth, not stepped.
  float e = rd.y - hill;
  float px = 1.5 * uFov / uRes.y;
  if (e < px) {
    vec3 hz = skyColor(ro, normalize(vec3(rd.x, 0.02, rd.z)), s, 1e9);
    vec3 land = min(hz, vec3(1.5)) * mix(0.3, 0.1, smoothstep(0.0, 0.12, -rd.y));
    col = mix(land, col, smoothstep(-px, px, e));
  }

  // rain veil
  col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.7, 0.6 * uRain);

  // Filmic tone curve (ACES approximation, Narkowicz 2015), then sRGB gamma.
  col *= uExposure;
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function exposureFor(e) {
  // Like a camera's auto exposure: brighter as the light fades.
  const keys = [[10, 0.55], [3, 0.85], [0, 1.45], [-2, 2.8], [-4, 6], [-6, 14], [-9, 34]];
  if (e >= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (e >= keys[i][0]) {
      const [e0, x0] = keys[i - 1], [e1, x1] = keys[i];
      return lerp(x0, x1, (e0 - e) / (e0 - e1));
    }
  }
  return keys.at(-1)[1];
}

export class GLSky {
  static supported(canvas) {
    try { return !!(canvas.getContext('webgl', { preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl')); } catch { return false; }
  }

  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uSunElev', 'uFov', 'uPitch', 'uCover', 'uAod', 'uPathT', 'uPathLow', 'uRain', 'uSeed', 'uTime', 'uExposure']) this.u[n] = gl.getUniformLocation(prog, n);
    this.cond = null;
  }

  prepare(cond, seed) {
    this.cond = cond;
    this.seed = (seed % 97) / 97;
  }

  // e: sun elevation in degrees. time: seconds, for optional cloud drift (0 = still).
  render(e, parts, time = 0) {
    if (!this.cond) return;
    const { gl, canvas, u, cond } = this;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = rect.width < 700 ? 0.55 : 0.75; // lighter on phones
    const w = Math.max(1, Math.min(1800, Math.round(rect.width * dpr * scale)));
    const h = Math.max(1, Math.round(w * (rect.height / Math.max(1, rect.width))));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uSunElev, (e * Math.PI) / 180);
    // Keep the vertical view fixed (about 30 degrees) so resizing the window shows more or less
    // sky at the sides instead of zooming or squashing the clouds. Limits for very narrow/wide screens.
    const tx = Math.min(Math.tan((55 * Math.PI) / 180), Math.max(Math.tan(Math.PI / 6), Math.tan((15 * Math.PI) / 180) * (w / h)));
    const fov = 2 * Math.atan(tx);
    // Tilt the view so the horizon sits near the bottom: a thin strip of land, mostly sky.
    const pitch = Math.atan(0.86 * Math.tan(fov / 2) / (w / h));
    gl.uniform1f(u.uFov, fov);
    gl.uniform1f(u.uPitch, pitch);
    gl.uniform3f(u.uCover, clamp(cond.low), clamp(cond.mid), clamp(cond.high));
    gl.uniform1f(u.uAod, cond.aod ?? 0.1);
    gl.uniform1f(u.uPathT, parts.transmit);
    gl.uniform1f(u.uPathLow, parts.pathLow);
    gl.uniform1f(u.uRain, cond.precip > 0.2 ? clamp(cond.pop) : 0);
    gl.uniform1f(u.uSeed, this.seed);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uExposure, exposureFor(e));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
