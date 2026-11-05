/* eslint-disable */
// The Naksha engraver: draws every plate on the website from code, with real hatching whose lines
// swell with tone. It runs only at build time, through scripts/bake-plates.mjs, and never ships to a
// browser. Ported unchanged from the design prototype so the art stays the same drawing.
// Interim art: a commissioned plate can replace any baked file with no code change.
function ENGRAVER() {
  'use strict';
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, v) => { v = clamp((v - a) / (b - a)); return v * v * (3 - 2 * v); };
  let _s = 1;
  const srand = (s) => { _s = s >>> 0 || 1; };
  const rnd = () => { _s = (Math.imul(_s, 1664525) + 1013904223) >>> 0; return _s / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();
  const hash = (a, b) => {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  srand(7);
  const G = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) G[i] = rnd();
  const RT = new Float32Array(1 << 18);
  for (let i = 0; i < 1 << 18; i++) RT[i] = rnd();
  function vn(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = G[x0 + y0], b = G[x1 + y0], c = G[x0 + y1], d = G[x1 + y1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // Cell noise: stones. Returns [nearest, second nearest, id].
  const _w = [0, 0, 0];
  function worley(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, h1 = hash(cx + 91, cy + 17), h2 = hash(cx + 13, cy + 71);
      const dx = cx + h1 - x, dy = cy + h2 - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = h1; } else if (d < f2) f2 = d;
    }
    _w[0] = f1; _w[1] = f2; _w[2] = id;
    return _w;
  }
  const fbm = (x, y) => vn(x, y) * 0.58 + vn(x * 2.13 + 7, y * 2.13 + 3) * 0.28 + vn(x * 4.31 + 11, y * 4.31 + 5) * 0.14;

  function createPlate(W, H, cfg) {
    const I = new Float32Array(W * H), A = new Float32Array(W * H);
    const NIGHT = !!cfg.night;
    const WB = NIGHT ? new Float32Array(W * H) : null, WL = NIGHT ? new Float32Array(W * H) : null;
    const P = cfg.pitch, AA = 2 / P;
    let ALPHA = 1, BW = 0, LW = 0;
    const row = new Float32Array(W + 2);

    function cov(c, w) {
      const f = c - Math.floor(c), d = Math.abs(f - 0.5) * 2, v = (w - d) / AA + 0.5;
      if (v <= 0) return 0;
      const q = v >= 1 ? 1 : v, thin = w / (AA * 0.72);
      return thin < 1 ? q * thin : q;
    }
    function h3(t, c1, c2, c3) {
      if (t <= 0.004) return 0;
      if (t > 1) t = 1;
      const w1 = t < 0.6 ? t * 1.12 : 0.672 + (t - 0.6) * 0.5;
      let v = cov(c1, w1);
      if (t > 0.34) {
        const v2 = cov(c2, (t - 0.34) * 1.15);
        if (v2 > v) v = v2;
        if (t > 0.68) {
          const v3 = cov(c3, (t - 0.68) * 2.5);
          if (v3 > v) v = v3;
        }
      }
      return v;
    }
    // Night: the plate turns into scratchboard, lines are light. glow is a baked map of lamp light.
    let glowMap = null, GW = 0, GH = 0;
    function glowAt(x, y) {
      if (!glowMap) return 0;
      const gx = x / 8, gy = y / 8, xi = gx | 0, yi = gy | 0, fx = gx - xi, fy = gy - yi, i = xi + yi * GW;
      const a = glowMap[i] || 0, b = glowMap[i + 1] || 0, c = glowMap[i + GW] || 0, d = glowMap[i + GW + 1] || 0;
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function S(t, c1, c2, c3, x, y) {
      if (NIGHT) {
        const g = glowAt(x, y);
        LW = g;
        t = (1 - clamp(t)) * (cfg.moon || 0.2) + g * 0.66;
      }
      // lines swell and thin along their length, and each one wanders a little: nobody rules these by hand
      const m = 0.56 + 0.44 * vn(x * 0.052, y * 0.41) + 0.44 * vn(x * 0.41, y * 0.052);
      const wob = 0.42 * vn(x * 0.024, y * 0.024) + 0.1 * vn(x * 0.13, y * 0.13);
      return h3(t * m, c1 + wob, c2 + wob * 0.6, c3);
    }
    function put(i, a, v) {
      const oa = A[i];
      if (a >= 0.999) { I[i] = v; A[i] = 1; }
      else { const na = a + oa * (1 - a); if (na <= 0) return; I[i] = (v * a + I[i] * oa * (1 - a)) / na; A[i] = na; }
      if (NIGHT) { if (a > 0.5 || BW > 0) WB[i] = BW; WL[i] = LW; }
    }
    // Anti-aliased polygon fill: four sub-scanlines per row, shader called once per covered pixel.
    function poly(p, shade) {
      const n = p.length / 2;
      let ymin = 1e9, ymax = -1e9;
      for (let i = 0; i < n; i++) { const y = p[i * 2 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(H - 1, Math.ceil(ymax));
      const xs = [];
      for (let y = y0; y <= y1; y++) {
        let mn = W, mx = -1;
        for (let s = 0; s < 4; s++) {
          const sy = y + (s + 0.5) / 4;
          xs.length = 0;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const ay = p[i * 2 + 1], by = p[j * 2 + 1];
            if (ay <= sy !== by <= sy) xs.push(p[i * 2] + ((sy - ay) / (by - ay)) * (p[j * 2] - p[i * 2]));
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const a = Math.max(0, xs[k]), b = Math.min(W, xs[k + 1]);
            if (b <= a) continue;
            const ia = Math.floor(a), ib = Math.min(W - 1, Math.floor(b));
            if (ia < mn) mn = ia;
            if (ib > mx) mx = ib;
            if (ia === ib) row[ia] += (b - a) * 0.25;
            else {
              row[ia] += (ia + 1 - a) * 0.25;
              for (let x = ia + 1; x < ib; x++) row[x] += 0.25;
              row[ib] += (b - ib) * 0.25;
            }
          }
        }
        for (let x = mn; x <= mx; x++) {
          const c = row[x];
          if (c <= 0) continue;
          row[x] = 0;
          ALPHA = 1; BW = 0; LW = 0;
          const v = shade(x, y);
          const a = (c > 1 ? 1 : c) * ALPHA;
          if (a > 0) put(x + y * W, a, v);
        }
      }
    }
    // A tapered ink stroke, cut with a slight wobble.
    function stroke(x0, y0, x1, y1, w0, w1, v = 1, wob = 0.25) {
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L < 0.01) return;
      const steep = Math.abs(dy) > Math.abs(dx), n = Math.ceil(steep ? Math.abs(dy) : Math.abs(dx));
      const nf = steep ? L / Math.abs(dy || 1) : L / Math.abs(dx || 1);
      for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 0, cx = x0 + dx * t, cy = y0 + dy * t;
        const wn = (lerp(w0, w1, t) * (1 + wob * (vn(cx * 0.09, cy * 0.09) - 0.5))) * nf * 0.5;
        if (steep) {
          const yy = Math.round(cy);
          if (yy < 0 || yy >= H) continue;
          for (let x = Math.floor(cx - wn - 1); x <= Math.ceil(cx + wn + 1); x++) {
            if (x < 0 || x >= W) continue;
            const c = clamp(wn - Math.abs(x + 0.5 - cx) + 0.5);
            if (c > 0) { BW = 0; LW = NIGHT ? glowAt(x, yy) : 0; put(x + yy * W, c, v); }
          }
        } else {
          const xx = Math.round(cx);
          if (xx < 0 || xx >= W) continue;
          for (let y = Math.floor(cy - wn - 1); y <= Math.ceil(cy + wn + 1); y++) {
            if (y < 0 || y >= H) continue;
            const c = clamp(wn - Math.abs(y + 0.5 - cy) + 0.5);
            if (c > 0) { BW = 0; LW = NIGHT ? glowAt(xx, y) : 0; put(xx + y * W, c, v); }
          }
        }
      }
    }
    // A round pole: shaded across its width, with bamboo nodes along it when node > 0.
    function pole(x0, y0, x1, y1, r0, r1, base, node) {
      const night = NIGHT;
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L < 0.5) return;
      const nx = -dy / L, ny = dx / L;
      const mr = Math.max(r0, r1) + 1;
      const pts = [x0 + nx * r0, y0 + ny * r0, x1 + nx * r1, y1 + ny * r1, x1 - nx * r1, y1 - ny * r1, x0 - nx * r0, y0 - ny * r0];
      poly(pts, (x, y) => {
        const px = x + 0.5 - x0, py = y + 0.5 - y0;
        const al = (px * dx + py * dy) / (L * L), ac = (px * nx + py * ny) / lerp(r0, r1, clamp(al));
        let t = base + (ac > 0 ? ac * ac * 0.8 : ac * ac * 0.34);
        const aq = ac * ac;
        if (aq > 0.62) t += 0.5;
        if (node > 0) {
          const q = al * L / node + hash(Math.round(x0), Math.round(y0)) * 3, f = q - Math.floor(q);
          if (f < 2 / node) t += 0.7;
        }
        if (mr < 3.4) return ac > -0.25 || mr < 2 ? (night ? 0.55 : 1) : (night ? 0.2 : 0.34);
        return S(t, (ac * mr) / (P * 0.62), al * L / P, (al * L + ac * mr) / P, x, y);
      });
    }
    return { W, H, I, A, WB, WL, P, AA, cov, h3, S, poly, stroke, pole, put,
      setGlow(m, gw, gh) { glowMap = m; GW = gw; GH = gh; },
      setA(a) { ALPHA = a; }, setBW(b) { BW = b; }, setLW(l) { LW = l; }, NIGHT };
  }

  // Turn the ink buffer into pixels. paper and ink are [r,g,b].
  function toRGBA(pl, paper, ink, warm) {
    const { W, H, I, A, WB, WL } = pl;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const a = A[i];
      if (a <= 0.002) continue;
      const v = I[i];
      if (WB) {
        const b = WB[i], l = WL[i];
        const br = paper[0] + (warm[0] - paper[0]) * b, bg = paper[1] + (warm[1] - paper[1]) * b, bb = paper[2] + (warm[2] - paper[2]) * b;
        const lk = l > 1 ? 1 : l;
        const dark = b > 0.5;
        const lr = dark ? 42 : ink[0] + (warm[0] - ink[0]) * lk, lg = dark ? 26 : ink[1] + (warm[1] - ink[1]) * lk, lb = dark ? 8 : ink[2] + (warm[2] - ink[2]) * lk;
        out[j] = br + (lr - br) * v; out[j + 1] = bg + (lg - bg) * v; out[j + 2] = bb + (lb - bb) * v;
      } else {
        out[j] = paper[0] + (ink[0] - paper[0]) * v; out[j + 1] = paper[1] + (ink[1] - paper[1]) * v; out[j + 2] = paper[2] + (ink[2] - paper[2]) * v;
      }
      out[j + 3] = a * 255;
    }
    return out;
  }

  /* ---------- The house ---------- */
  const HW = 9.6, HD = 13, LV = [0.5, 3.8, 7.1, 10.4], COLX = [0, 3.2, 6.4, 9.6], COLZ = [0, 4.33, 8.67, 13];

  // Stage table. Each storey is: 0 nothing, 1 columns, 2 open frame, 3 raw brick, 4 half plaster, 5 plaster, 6 finished.
  const STAGES = {
    hero: { st: [3, 3, 2], slabs: 3, scaffold: 11.5, hoist: 1, roof: 1, tank: 1, bars: 1, ground: 1, props: 2, nazar: 1 },
    1: { st: [0, 0, 0], slabs: 0, cages: 1, pits: 1, ground: 1, thread: 1, heaps: 1 },
    2: { st: [1, 0, 0], slabs: 0, plinth: 1, ground: 1, heaps: 2, shutterCol: 1 },
    3: { st: [3, 0, 0], slabs: 0, plinth: 1, scaffold: 4.4, ground: 1, heaps: 3, nazar: 1, wallTo: 3.0 },
    4: { st: [3, 2, 0], slabs: 2, plinth: 1, scaffold: 7.8, props: 1, deck: 1, ground: 1, heaps: 4, hoist2: 1, nazar: 1, wet: 1 },
    5: { st: [3, 4, 5], slabs: 3, plinth: 1, scaffold: 11.6, roof: 2, bars: 1, ground: 1, heaps: 5, nazar: 1 },
    6: { st: [6, 6, 6], slabs: 3, plinth: 1, roof: 2, tank: 1, bars: 1, ground: 2, final: 1, trees: 1 },
  };

  function renderScene(key, W, H, opts) {
    const st = STAGES[key];
    const night = !!opts.night;
    const pl = createPlate(W, H, { pitch: opts.pitch, night, moon: 0.125 });
    const { poly, stroke, pole, S, cov, P } = pl;
    const K = opts.k; // device pixels per metre at reference depth
    const DREF = 30, F = K * DREF;
    const C = { ex: 22.6, ey: opts.eye || 2.3, ez: -24, cos: 0.857, sin: -0.514, cx: opts.cx, hy: opts.hy };
    const pr = (x, y, z) => {
      const dx = x - C.ex, dz = z - C.ez, xc = dx * C.cos - dz * C.sin, zc = dx * C.sin + dz * C.cos;
      return [C.cx + (F * xc) / zc, C.hy - (F * (y - C.ey)) / zc, zc];
    };
    const LOD = K > 62 ? 2 : K > 36 ? 1 : 0; // detail tiers: brick joints need pixels to live in

    let LU = 1, LY = 1, FL = 1;
    function face(x0, z0, x1, z1, y0, y1, sh) {
      const a = pr(x0, y0, z0), b = pr(x1, y0, z1), c = pr(x1, y1, z1), e = pr(x0, y1, z0);
      const len = Math.hypot(x1 - x0, z1 - z0), sa = a[0], sb = b[0], ia = 1 / a[2], ib = 1 / b[2], den = sb - sa || 1;
      const lu = (Math.abs(sb - sa) / (len || 1)) / P, ly = F / ((a[2] + b[2]) * 0.5) / P;
      let lx = -1, d = 0, u = 0;
      poly([a[0], a[1], b[0], b[1], c[0], c[1], e[0], e[1]], (x, y) => {
        if (x !== lx) {
          lx = x;
          const s = clamp((x + 0.5 - sa) / den), id = ia + (ib - ia) * s;
          d = 1 / id; u = ((s * ib) / id) * len;
        }
        LU = lu; LY = ly; FL = len;
        return sh(x, y, u, C.ey + ((C.hy - (y + 0.5)) * d) / F, d);
      });
    }
    // A flat horizontal quad at height Y (undersides, tops, decks).
    function flat(x0, z0, x1, z1, Y, sh) {
      const a = pr(x0, Y, z0), b = pr(x1, Y, z0), c = pr(x1, Y, z1), e = pr(x0, Y, z1);
      poly([a[0], a[1], b[0], b[1], c[0], c[1], e[0], e[1]], sh);
    }

    /* Materials. Light comes from the upper left, in front of the house. */
    const concF = (u0, v) => (x, y, u, Y) => {
      const e = u / FL, stain = sstep(0.5, 0.82, fbm(u * 1.1 + u0, Y * 0.55));
      let t = 0.012 + stain * 0.2 + (v ? sstep(0.58, 0.98, e) * 0.26 : 0);
      if (v) { const q = Y / 0.62, pl2 = Math.floor(q); if (q - pl2 < 0.035) t += 0.42; }
      return S(t, v ? u * LU * 1.2 : Y * LY, Y * LY, (u * LU + Y * LY) * 0.7, x, y);
    };
    const concR = (x, y, u, Y) => S(0.62 + vn(u, Y) * 0.18, x / P, Y * LY + (x / P) * 0.56, Y * LY - (x / P) * 0.56, x, y);
    const under = (b) => (x, y) => S(b + vn(x * 0.03, y * 0.03) * 0.1, y / (P * 0.86), (x * 0.84 + y * 0.54) / P, (x * 0.84 - y * 0.54) / (P * 1.1), x, y);
    function brickTone(u, Y, base, joint, sp) {
      const ch = 0.085, r = Y / ch, ro = Math.floor(r), ofs = ro & 1 ? 0.5 : 0, bx = u / 0.245 + ofs, co = Math.floor(bx);
      const fy = r - ro, fx = bx - co;
      const h = hash(co + 31, ro + 7);
      if (LOD < 2) return base + (hash(ro, 3) - 0.5) * 0.14 + (h - 0.5) * sp;
      const mortar = fy < 0.12 || fx < 0.05;
      return mortar ? joint : base + (h - 0.5) * sp + (h > 0.9 ? 0.26 : 0);
    }
    const brickF = (shadeFn) => (x, y, u, Y) => {
      const wash = fbm(u * 0.26 + 3, Y * 0.3);
      let t = brickTone(u, Y, (LOD < 2 ? 0.2 : 0.1) + wash * 0.32, 0.86, LOD < 2 ? 0.34 : 0.2) + (u / HW) * 0.1;
      if (shadeFn) t += shadeFn(u, Y);
      return S(t, LOD < 2 ? Y / 0.085 + 0.5 : Y * LY, u * LU, (u * LU + Y * LY) * 0.7, x, y);
    };
    const brickR = (shadeFn) => (x, y, u, Y) => {
      const wash = fbm(u * 0.2 + 9, Y * 0.3);
      let t = brickTone(u, Y, 0.66 + wash * 0.2 + (1 - u / HD) * 0.12, 0.96, 0.12);
      if (shadeFn) t += shadeFn(u, Y);
      return S(t, x / P, Y * LY + (x / P) * 0.56, Y * LY - (x / P) * 0.56, x, y);
    };
    const plasterF = (shadeFn, fin) => (x, y, u, Y) => {
      const b = fbm(u * 0.8, Y * 0.8);
      let t = fin ? 0.06 + b * 0.05 : 0.04 + sstep(0.45, 0.8, b) * 0.26;
      if (shadeFn) t += shadeFn(u, Y);
      return S(t, Y * LY, u * LU, (u * LU + Y * LY) * 0.7, x, y);
    };
    const plasterR = (shadeFn, fin) => (x, y, u, Y) => {
      const b = fbm(u * 0.8 + 5, Y * 0.8);
      let t = (fin ? 0.5 : 0.46) + b * 0.12;
      if (shadeFn) t += shadeFn(u, Y);
      return S(t, x / P, Y * LY + (x / P) * 0.56, Y * LY - (x / P) * 0.56, x, y);
    };
    const voidTone = (b) => (x, y, u, Y) => S(b, y / (P * 0.8), (x * 0.84 + y * 0.54) / (P * 0.9), (x * 0.84 - y * 0.54) / (P * 1.1), x, y);

    function box(x0, x1, y0, y1, z0, z1, f, r, top, bot) {
      if (bot && y0 > C.ey) flat(x0, z0, x1, z1, y0, bot);
      if (top && y1 < C.ey) flat(x0, z0, x1, z1, y1, top);
      if (r) face(x1, z0, x1, z1, y0, y1, r);
      if (f) face(x0, z0, x1, z0, y0, y1, f);
    }
    // Edge lines are sparse: only where a real engraver would cut one.
    function edge(x0, y0, z0, x1, y1, z1, w = 1.4, v = 1) {
      const a = pr(x0, y0, z0), b = pr(x1, y1, z1), s = K / 100 + 0.4;
      stroke(a[0], a[1], b[0], b[1], w * s, w * s * 0.8, v);
    }

    const windowsF = [[0.95, 2.35, 0.95, 2.35], [7.2, 8.8, 0.95, 2.35]];
    const doorF = [4.0, 5.6, 0.02, 2.4];
    const windowsR = [[1.5, 2.9], [5.9, 7.2], [10.2, 11.5]];

    const lights = [];
    const lampOf = (i, j) => { // which windows are lit at night; not all of them, this is a home
      return !opts.lightsOff && hash(i * 7 + 3, j * 5 + 1) > 0.26;
    };

    // A lit window: mostly warm glass, a light grill, sometimes a curtain, once in a while a person.
    function litGlass(u, Y, a, b, y0, y1, seed) {
      const nu = (u - a) / (b - a), nv = (Y - y0) / (y1 - y0);
      pl.setBW(1);
      const curtain = hash(seed, 3);
      if (curtain > 0.42) {
        const edgeU = lerp(0.14, 0.34, hash(seed, 9)) + 0.018 * Math.sin(nv * 26);
        if (nu < edgeU) pl.setBW(0.78 + 0.1 * Math.sin(u * 90));
      }
      if (seed === 9) {
        // someone at the window
        const du = u - lerp(a, b, 0.62), dy = Y - lerp(y0, y1, 0.68);
        if (du * du + dy * dy < 0.13 * 0.13) return 1;
        const sh = Y - (lerp(y0, y1, 0.68) - 0.12);
        if (sh < 0 && Math.abs(du) < 0.27 - sh * -0.12) return 1;
      }
      const bars = Math.abs((((u + 0.01) / 0.22) % 1) - 0.5) < 0.05 || Math.abs((((Y + 0.01) / 0.7) % 1) - 0.5) < 0.012;
      const frame = nu < 0.014 || nu > 0.986 || nv < 0.014 || nv > 0.986;
      return bars || frame ? 1 : cov(Y * LY, 0.03 + sstep(0.35, 1, nv) * 0.2);
    }
    let litSeed = 0;
    function openingF(a, b, y0, y1, mode, lit, isDoor) {
      const dep = 0.22, sd = ++litSeed;
      face(a, 0, b, 0, y0, y1, voidTone(mode >= 5 ? 0.965 : 0.86));
      if (mode >= 5) {
        if (lit && night) {
          const pa = pr(a, y0, 0), pb = pr(b, y1, 0);
          lights.push({ x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2, r: Math.abs(pb[0] - pa[0]) * (isDoor ? 3.4 : 2.5), s: isDoor ? 1.1 : 0.9 });
          if (isDoor) {
            const pb2 = pr((a + b) / 2, y0 - 0.5, -0.9);
            lights.push({ x: pb2[0], y: pb2[1], r: K * 3.2, s: 0.8 });
            face(a, 0, b, 0, y0, y1, (x, y, u, Y) => {
              pl.setBW(1);
              // the door stands open: one dark leaf, warm light beyond it
              const w = b - a;
              if (u < w * 0.26) { pl.setBW(0); return S(0.72, y / P, x / P, 0, x, y); }
              if (u < w * 0.275) return 1;
              // the family, at the door on the first evening: two shapes against the light
              const Yr = Y - y0, du = u - w * 0.52, dc = u - w * 0.8;
              if (du * du + (Yr - 1.56) * (Yr - 1.56) < 0.0121) return 1;
              if (Yr < 1.46 && Yr > 0.8) { const half = 0.1 + 0.095 * sstep(1.0, 1.36, Yr) - 0.05 * sstep(1.36, 1.46, Yr); if (Math.abs(du) < half) return 1; }
              if (Yr <= 0.8 && Math.abs(du) < 0.115 + (0.8 - Yr) * 0.05 && (Math.abs(du) > 0.012 || Yr > 0.52)) return 1;
              if (dc * dc + (Yr - 0.92) * (Yr - 0.92) < 0.0064) return 1;
              if (Yr < 0.84 && Math.abs(dc) < 0.078 + (0.84 - Yr) * 0.03) return 1;
              // and the hand between them
              if (Yr > 0.66 && Yr < 0.71 && u > w * 0.52 && u < w * 0.8) return 1;
              return 0;
            });
          } else {
            face(a, 0, b, 0, y0, y1, (x, y, u, Y) => litGlass(u, Y, 0, b - a, y0, y1, sd));
          }
        } else if (!night) {
          face(a, 0, b, 0, y0, y1, (x, y, u, Y) => S(0.72 + vn(u * 2, Y * 2) * 0.2, Y * LY, u * LU, (u * LU + Y * LY) * 0.7, x, y));
        }
      }
      // the jamb that faces the camera, the sill and the head
      face(a, 0, a, dep, y0, y1, (x, y, u, Y) => S(mode >= 5 ? 0.14 : 0.24, Y * LY, u * 30, 0, x, y));
      if (y1 > C.ey) flat(a, 0, b, dep, y1, under(0.78));
      if (y0 < C.ey) flat(a, 0, b, dep, y0, (x, y) => S(0.06, y / P, x / P, 0, x, y));
      if (mode >= 5) {
        if (!(lit && night)) {
          // an unlit window keeps its iron grill
          const n = Math.round((b - a) / 0.2);
          for (let k = 1; k < n; k++) edge(a + ((b - a) * k) / n, y0, -0.02, a + ((b - a) * k) / n, y1, -0.02, 1, 0.75);
          edge(a, y0 + (y1 - y0) * 0.5, -0.02, b, y0 + (y1 - y0) * 0.5, -0.02, 1, 0.75);
        }
        // and a chajja: every Patna window has one
        box(a - 0.2, b + 0.2, y1 + 0.06, y1 + 0.16, -0.5, 0, concF(3, 0), concR, null, under(0.82));
      } else {
        edge(a, y1, 0, b, y1, 0, 1.1, 0.8);
      }
    }
    function openingR(a, b, y0, y1, mode, lit) {
      const dep = 0.22, x = HW, sd = ++litSeed;
      face(x, a, x, b, y0, y1, voidTone(0.9));
      if (lit && night) {
        const pa = pr(x, y0, a), pb = pr(x, y1, b);
        lights.push({ x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2, r: Math.abs(pb[0] - pa[0]) * 3, s: 0.62 });
        face(x, a, x, b, y0, y1, (px, py, u, Y) => litGlass(u, Y, 0, b - a, y0, y1, sd + 40));
      }
      face(x, b, x - dep, b, y0, y1, (px, py, u, Y) => S(0.4, Y * LY, u * 30, 0, px, py));
      if (y1 > C.ey) face(x, a, x, b, y1 - 0.06, y1, (px, py) => S(0.92, py / P, px / P, 0, px, py));
      if (mode >= 5) box(x, x + 0.45, y1 + 0.06, y1 + 0.15, a - 0.16, b + 0.16, null, concR, null, under(0.86));
    }

    function shadeFront(i, balconyAbove) {
      return (u, Y) => {
        let s = 0;
        const top = LV[i + 1] - 0.4;
        if (Y > top - 0.2) s += 0.34;
        for (let c = 0; c < 4; c++) {
          const du = u - (COLX[c] + 0.16);
          if (du > 0 && du < 0.1) s += 0.34;
        }
        if (balconyAbove && u > 3.2 && u < HW + 0.5) {
          const L = 1.35 - (u - 3.2) * 0.02;
          if (Y > top + 0.4 - L) s += 0.42;
        }
        if (Y < LV[i] + 0.1) s += 0.2;
        return s;
      };
    }
    function shadeSide(i) {
      return (u, Y) => (Y > LV[i + 1] - 0.62 ? 0.18 : 0);
    }

    function column(cx, cz, y0, y1) {
      const a = 0.17;
      box(cx - a, cx + a, y0, y1, cz - a, cz + a, concF(cx * 3 + cz, 1), concR);
      if (LOD >= 1) {
        edge(cx + a, y0, cz - a, cx + a, y1, cz - a, 1.2, 0.85);
        edge(cx - a, y0, cz - a, cx - a, y1, cz - a, 0.8, 0.5);
      }
    }

    function drawBars(cx, cz, y0, y1, seedN) {
      srand(seedN * 97 + 13);
      const offs = [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09], [0, -0.1], [0.1, 0]];
      const w = Math.max(1.1, 0.021 * K);
      for (const [ox, oz] of offs) {
        const top = y1 + rr(-0.22, 0.2);
        const a = pr(cx + ox, y0, cz + oz), bx = rr(-0.1, 0.1), bz = rr(-0.08, 0.08);
        const m = pr(cx + ox + bx * 0.25, (y0 + top) * 0.5, cz + oz + bz * 0.25), b = pr(cx + ox + bx, top, cz + oz + bz);
        stroke(a[0], a[1], m[0], m[1], w, w, 1, 0.1);
        stroke(m[0], m[1], b[0], b[1], w, w * 0.9, 1, 0.1);
        // the bent tip every starter bar has
        const hk = pr(cx + ox + bx + rr(-0.12, 0.12), top - rr(0.02, 0.08), cz + oz + bz + 0.05);
        stroke(b[0], b[1], hk[0], hk[1], w * 0.9, w * 0.7, 1, 0.1);
      }
      // ties
      const tn = Math.floor((y1 - y0) / 0.26);
      for (let k = 1; k < tn; k++) {
        const y = y0 + k * 0.26;
        if (y > y1 - 0.45) break;
        const a = pr(cx - 0.1, y, cz - 0.1), b = pr(cx + 0.1, y, cz - 0.1), c = pr(cx + 0.1, y, cz + 0.1);
        stroke(a[0], a[1], b[0], b[1], w * 0.6, w * 0.6, 0.9, 0.1);
        stroke(b[0], b[1], c[0], c[1], w * 0.6, w * 0.6, 0.9, 0.1);
      }
    }

    function openFrameInterior(i) {
      const b = LV[i], t = LV[i + 1];
      // Nothing is built in this storey yet but the frame, so the eye goes straight through to the sky.
      if (t > C.ey) flat(0, 0, HW, HD, t - 0.1, under(0.8));
      if (b < C.ey) flat(0, 0, HW, HD, b, under(0.5));
      for (let zi = 3; zi >= 1; zi--) for (let xi = 0; xi < 3; xi++) column(COLX[xi], COLZ[zi], b, t - 0.1);
    }
    function NIGHT_DIM() { return 0.7; }

    function propsForest(i, density) {
      const b = LV[i], t = LV[i + 1] - 0.14;
      srand(50 + i);
      const r = Math.max(0.8, 0.026 * K);
      const zs = density === 2 ? [0.9, 3.0, 5.1] : [0.7, 2.1, 3.5, 4.9];
      for (let zi = zs.length - 1; zi >= 0; zi--) {
        for (let k = 0; k < (density === 2 ? 7 : 9); k++) {
          const x = 0.5 + (k / (density === 2 ? 6 : 8)) * (HW - 1) + rr(-0.14, 0.14), z = zs[zi] + rr(-0.15, 0.15);
          const a = pr(x, b, z), c = pr(x + rr(-0.04, 0.04), t, z + rr(-0.04, 0.04));
          pole(a[0], a[1], c[0], c[1], r, r * 0.86, 0.04, 0);
        }
      }
      // ledger planks across the top of the props
      for (let k = 0; k < 3; k++) {
        const y = lerp(b + 1.1, t - 0.25, k / 2);
        if (k === 2) {
          const a = pr(0.1, y, 0.6), c = pr(HW - 0.1, y, 0.6);
          pole(a[0], a[1], c[0], c[1], r * 0.9, r * 0.9, 0.08, 0);
        }
      }
    }

    function storey(i, mode) {
      const b = LV[i], t = LV[i + 1], top = t - 0.4;
      const balconyAbove = i < 2 && st.st[i + 1] >= 3;
      if (mode === 0) return;
      if (mode === 1) {
        for (let zi = 3; zi >= 0; zi--) for (let xi = 0; xi < 4; xi++) {
          const cx = COLX[xi], cz = COLZ[zi];
          const shut = st.shutterCol && (hash(xi + 2, zi + 9) > 0.6 || (xi === 1 && zi === 0));
          column(cx, cz, b, t - 0.6);
          if (shut) {
            const a = 0.22;
            box(cx - a, cx + a, b, t - 0.9, cz - a, cz + a, (x, y, u, Y) => {
              const pk = Math.floor(u / 0.1);
              return S(0.22 + hash(pk, 4) * 0.2 + (u / 0.1 - pk < 0.1 ? 0.4 : 0), u * LU, Y * LY, 0, x, y);
            }, (x, y, u, Y) => S(0.6, u * LU, Y * LY, 0, x, y));
          }
          drawBars(cx, cz, t - 0.6, t + 1.15, xi * 4 + zi + 2);
        }
        return;
      }
      if (mode === 2) {
        openFrameInterior(i);
        if (st.props === i || st.props === 1 && i === 1 || st.props === 2 && i === 2) propsForest(i, st.props === 2 ? 2 : 1);
        for (let zi = 3; zi >= 0; zi--) column(HW, COLZ[zi], b, top);
        for (let xi = 0; xi < 3; xi++) column(COLX[xi], 0, b, top);
        // and the beams that tie it together
        face(HW + 0.02, 0, HW + 0.02, HD, top, t, concR);
        box(-0.02, HW + 0.02, top, t, -0.03, 0, concF(i * 9.3, 0), null);
        edge(-0.02, top, -0.03, HW + 0.02, top, -0.03, 1.2, 0.85);
        edge(HW, top, 0, HW, top, HD, 1.1, 0.85);
        return;
      }
      // Walls
      const wTop = st.wallTo && i === 0 ? Math.min(top, st.wallTo) : top;
      const m = mode;
      const shF = shadeFront(i, balconyAbove), shR = shadeSide(i);
      const lit = (j) => lampOf(i, j);
      if (m >= 5) {
        const fin = m === 6;
        face(0, 0, HW, 0, b, t, plasterF(shF, fin));
        face(HW, 0, HW, HD, b, t, plasterR(shR, fin));
      } else if (m === 4) {
        const split = b + (top - b) * 0.58;
        face(0, 0, HW, 0, b, top, (x, y, u, Y) => {
          const edgeY = split + (vn(u * 0.9, 3) - 0.5) * 0.7;
          return Y > edgeY ? plasterF(shF, 0)(x, y, u, Y) : brickF(shF)(x, y, u, Y);
        });
        face(HW, 0, HW, HD, b, top, (x, y, u, Y) => {
          const edgeY = split + (vn(u * 0.5, 9) - 0.5) * 0.8;
          return Y > edgeY ? plasterR(shR, 0)(x, y, u, Y) : brickR(shR)(x, y, u, Y);
        });
      } else {
        face(0, 0, HW, 0, b, wTop, brickF(shF));
        face(HW, 0, HW, HD, b, wTop, brickR(shR));
      }
      const y00 = b;
      windowsF.forEach((w, j) => openingF(w[0], w[1], y00 + w[2], Math.min(wTop - 0.02, y00 + w[3]), m, lit(j)));
      openingF(doorF[0], doorF[1], y00 + doorF[2], Math.min(wTop - 0.02, y00 + doorF[3]), m, i > 0 ? lit(5) : !opts.lightsOff, i === 0);
      windowsR.forEach((w, j) => openingR(w[0], w[1], y00 + 0.95, Math.min(wTop - 0.02, y00 + 2.3), m, lit(j + 2)));
      // Columns and the beam
      if (m < 5) {
        const cTop = st.wallTo && i === 0 ? t - 0.6 : top;
        for (let zi = 3; zi >= 1; zi--) {
          const cz = COLZ[zi];
          face(HW + 0.02, cz - 0.17, HW + 0.02, cz + 0.17, b, cTop, concR);
        }
        for (let xi = 0; xi < 4; xi++) {
          const cx = COLX[xi];
          box(cx - 0.17, cx + 0.17, b, cTop, -0.03, 0, concF(cx * 2.1, 1), concR);
          if (LOD >= 1) edge(cx + 0.17, b, -0.03, cx + 0.17, cTop, -0.03, 1.2, 0.8);
        }
        if (!st.wallTo || i > 0) {
          box(-0.02, HW + 0.02, top, t, -0.03, 0, concF(i * 9.3, 0), null);
          face(HW + 0.02, 0, HW + 0.02, HD, top, t, concR);
        }
        if (st.wallTo && i === 0) {
          // walls stop here: the sariya keeps going
          for (let zi = 3; zi >= 0; zi--) for (let xi = 0; xi < 4; xi++) {
            if (zi !== 0 && xi !== 3) continue;
            drawBars(COLX[xi], COLZ[zi], t - 0.6, t + 1.0, xi * 4 + zi + 2);
          }
        }
      } else {
        // a plastered wall still shows its frame as a soft band
        edge(0, top, 0, HW, top, 0, 1, 0.4);
        // the shade under the slab edge, cut straight along the wall
        face(0, -0.005, HW, -0.005, t - 0.26, t, (x, y, u, Y) => S(0.56, Y * LY, u * LU, 0, x, y));
      }
      // the near corner, cut once
      edge(HW, b, 0, HW, t, 0, 1.7, 0.95);
    }

    function slabEdge(y) {
      box(-0.12, HW + 0.12, y, y + 0.14, -0.14, HD + 0.14, concF(y, 0), concR, null, under(0.88));
      edge(-0.12, y, -0.14, HW + 0.12, y, -0.14, 1.5, 1);
      edge(HW + 0.12, y, -0.14, HW + 0.12, y, HD + 0.14, 1.3, 1);
    }
    function balcony(i, finished) {
      const y = LV[i], z0 = -1.15, x0 = 3.2, x1 = HW;
      flat(x0, z0, x1, 0, y - 0.02, under(0.94));
      box(x0, x1, y - 0.02, y + 0.13, z0, 0, concF(i * 2.2, 0), concR);
      edge(x0, y - 0.02, z0, x1, y - 0.02, z0, 1.5, 1);
      edge(x1, y - 0.02, z0, x1, y - 0.02, 0, 1.2, 1);
      if (finished) {
        const h = 1.02, top = y + 0.13 + h, n = 26;
        for (let k = 0; k <= n; k++) {
          const x = x0 + ((x1 - x0) * k) / n;
          edge(x, y + 0.13, z0, x, top, z0, k % 13 === 0 ? 2.3 : 0.95);
        }
        edge(x0, top, z0, x1, top, z0, 2.4);
        edge(x0, y + 0.55, z0, x1, y + 0.55, z0, 1);
        for (let k = 0; k <= 5; k++) {
          const z = z0 + ((0 - z0) * k) / 5;
          edge(x1, y + 0.13, z, x1, top, z, k === 0 ? 2.2 : 0.95);
        }
        edge(x1, top, z0, x1, top, 0, 2.2);
      }
    }

    function roofLevel() {
      const y = LV[3], ph = 1.0;
      const raw = st.roof === 1;
      // the stair room
      const mx0 = 5.3, mx1 = 9.3, mz0 = 7.4, mz1 = 12.2, mh = 2.75;
      if (raw) {
        face(mx0, mz0, mx1, mz0, y, y + mh, brickF(null));
        face(mx1, mz0, mx1, mz1, y, y + mh, brickR(null));
      } else {
        face(mx0, mz0, mx1, mz0, y, y + mh, plasterF(null, 1));
        face(mx1, mz0, mx1, mz1, y, y + mh, plasterR(null, 1));
      }
      box(mx0 - 0.3, mx1 + 0.3, y + mh, y + mh + 0.14, mz0 - 0.3, mz1 + 0.3, concF(4, 0), concR, null, under(0.9));
      edge(mx0 - 0.3, y + mh, mz0 - 0.3, mx1 + 0.3, y + mh, mz0 - 0.3, 1.4);
      // door to the roof
      face(mx0 + 1.4, mz0, mx0 + 2.4, mz0, y, y + 2.1, (x, yy) => {
        if (night && !opts.lightsOff) { pl.setBW(1); return 0.05; }
        return S(0.95, yy / P, x / P, (x + yy) / P, x, yy);
      });
      if (night && !opts.lightsOff) {
        const pa = pr(mx0 + 1.9, y + 1.1, mz0);
        lights.push({ x: pa[0], y: pa[1], r: K * 1.9, s: 0.8 });
      }
      if (st.tank) waterTank((mx0 + mx1) / 2 + 0.3, y + mh + 0.14, (mz0 + mz1) / 2 - 0.3);
      // sariya inside the plot, seen over the parapet
      if (st.bars) {
        for (let zi = 3; zi >= 1; zi--) for (let xi = 0; xi < 3; xi++) {
          if (COLX[xi] > 5 && COLZ[zi] > 6) continue;
          drawBars(COLX[xi], COLZ[zi], y + 0.2, y + 3.05 + hash(xi, zi) * 0.5, 80 + xi * 4 + zi);
        }
      }
    }
    function parapet() {
      const y = LV[3] + 0.14, ph = 0.95;
      const rawP = st.roof === 1;
      const fm = rawP ? brickF(null) : plasterF(null, 1), rm = rawP ? brickR(null) : plasterR(null, 1);
      if (st.bars) {
        for (let zi = 3; zi >= 1; zi--) drawBars(HW, COLZ[zi], y + 0.2, y + 3.2 + hash(9, zi) * 0.4, 40 + zi);
      }
      face(0, 0, HW, 0, y, y + ph, fm);
      face(HW, 0, HW, HD, y, y + ph, rm);
      box(-0.05, HW + 0.05, y + ph, y + ph + 0.08, -0.05, HD + 0.05, concF(3, 0), concR);
      edge(-0.05, y + ph + 0.08, -0.05, HW + 0.05, y + ph + 0.08, -0.05, 1.3, 0.95);
      edge(HW, y, 0, HW, y + ph, 0, 1.5, 0.95);
      if (st.bars) {
        for (let xi = 0; xi < 4; xi++) {
          const cx = COLX[xi];
          if (xi < 3 && cx >= 0) {
            box(cx - 0.17, cx + 0.17, y + ph + 0.08, y + ph + 0.42, -0.17, 0.17, concF(cx, 1), concR);
          }
          drawBars(cx, 0, y + ph + 0.42, y + ph + 2.7 + hash(xi, 5) * 0.4, 20 + xi);
        }
        box(HW - 0.17, HW + 0.17, y + ph + 0.08, y + ph + 0.42, -0.17, 0.17, concF(1, 1), concR);
      }
      if (night && !opts.lightsOff) {
        // the row of diyas on the parapet
        const n = 18;
        for (let k = 0; k <= n; k++) {
          const x = 0.3 + ((HW - 0.6) * k) / n, pa = pr(x, y + ph + 0.15, -0.04);
          lampDot(pa[0], pa[1], Math.max(1.7, K * 0.034));
        }
        for (let k = 1; k <= 11; k++) {
          const z = (HD * k) / 11, pa = pr(HW + 0.03, y + ph + 0.15, z);
          lampDot(pa[0], pa[1], Math.max(1.5, K * 0.03));
        }
      }
    }
    const lamps = [];
    function lampDot(x, y, r) {
      lamps.push([x, y, r]);
      lights.push({ x, y, r: r * 7.5, s: 0.55 });
    }
    function drawLamps() {
      for (const [x, y, r] of lamps) {
        const pts = [];
        for (let a = 0; a < 10; a++) {
          const an = (a / 10) * Math.PI * 2;
          pts.push(x + Math.cos(an) * r, y + Math.sin(an) * r * 1.2);
        }
        poly(pts, () => { pl.setBW(1); return 0; });
      }
    }
    function waterTank(cx, y, cz) {
      const r = 0.72, h = 1.25, a = pr(cx, y, cz), bTop = pr(cx, y + h, cz), rx = (r * F) / a[2];
      // stand
      box(cx - 0.8, cx + 0.8, y, y + 0.18, cz - 0.8, cz + 0.8, concF(1, 0), concR);
      const y0 = a[1] - (0.18 * F) / a[2], y1 = bTop[1] - (0.18 * F) / a[2], dome = rx * 0.32;
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const an = Math.PI - (k / 16) * Math.PI;
        pts.push(a[0] + Math.cos(an) * rx, y1 - Math.sin(an) * dome);
      }
      pts.push(a[0] + rx, y0);
      for (let k = 0; k <= 8; k++) {
        const an = (k / 8) * Math.PI;
        pts.push(a[0] + Math.cos(an) * rx, y0 + Math.sin(an) * dome * 0.28);
      }
      poly(pts, (x, yy) => {
        const nx = (x + 0.5 - a[0]) / rx, band = (yy - y1) / (y0 - y1);
        const rib = Math.abs(((band * 4.5) % 1) - 0.5) < 0.09 ? -0.18 : 0;
        let t = 0.86 + rib + (nx > 0 ? nx * 0.14 : 0);
        if (nx < -0.25 && nx > -0.62) t -= 0.5 * (1 - Math.abs(nx + 0.44) / 0.18);
        if (yy < y1) t -= 0.14;
        return S(t, (Math.asin(clamp(nx, -1, 1)) * rx) / (P * 0.9), yy / P, (x + yy) / P, x, yy);
      });
      if (night) {
        const q = K / 100 + 0.5;
        stroke(a[0] - rx, y1, a[0] - rx, y0, q * 1.2, q * 1.2, 0.8, 0.1);
        stroke(a[0] - rx * 0.56, y1 - dome * 0.8, a[0] - rx * 0.56, y0 + dome * 0.2, q * 0.8, q * 0.8, 0.35, 0.1);
        for (let k = 0; k < 16; k++) {
          const an = Math.PI - (k / 16) * Math.PI, an2 = Math.PI - ((k + 1) / 16) * Math.PI;
          stroke(a[0] + Math.cos(an) * rx, y1 - Math.sin(an) * dome, a[0] + Math.cos(an2) * rx, y1 - Math.sin(an2) * dome, q, q, 0.7, 0.1);
        }
      }
      // lid
      const lidw = rx * 0.24;
      poly([a[0] - lidw, y1 - dome + 2, a[0] + lidw, y1 - dome + 2, a[0] + lidw * 0.86, y1 - dome - lidw * 0.5, a[0] - lidw * 0.86, y1 - dome - lidw * 0.5], (x, yy) => S(0.7, yy / P, x / P, 0, x, yy));
      // the rising pipe
      const pa = pr(cx + 0.9, y - 1.8, cz - 0.8), pb = pr(cx + 0.9, y + 1.0, cz - 0.8);
      pole(pa[0], pa[1], pb[0], pb[1], 0.035 * K, 0.035 * K, 0.2, 0, 0);
    }

    /* Bamboo */
    function bambooLine(x0, y0, z0, x1, y1, z1, r = 0.052) {
      const a = pr(x0, y0, z0), b = pr(x1, y1, z1);
      const ra = Math.max(0.8, (r * 0.62 * F) / a[2]), rb = Math.max(0.7, (r * 0.5 * F) / b[2]);
      pole(a[0], a[1], b[0], b[1], ra, rb, 0.3, LOD >= 1 ? K * 0.62 : 0);
    }
    function lash(x, y, z) {
      const a = pr(x, y, z), rad = Math.max(1.4, 0.075 * K);
      const n = 3;
      for (let k = 0; k < n; k++) {
        stroke(a[0] - rad, a[1] - rad * 0.8 + k * rad * 0.8, a[0] + rad, a[1] + rad * 0.5 - k * rad * 0.6, Math.max(0.9, K * 0.014), Math.max(0.9, K * 0.014), 1, 0.1);
      }
    }
    function plank(x0, x1, y, z0, z1) {
      flat(x0, z0, x1, z1, y, (x, yy) => S(0.5 + vn(x * 0.04, yy * 0.2) * 0.2, x / (P * 1.1), yy / P, (x + yy) / P, x, yy));
      face(x0, z0, x1, z0, y - 0.05, y, (x, yy) => S(0.1, yy / P, x / P, 0, x, yy));
      edge(x0, y - 0.05, z0, x1, y - 0.05, z0, 1, 1);
    }
    function scaffold(topY) {
      srand(11);
      const zf = -1.75, xr = HW + 1.5;
      const xs = [];
      for (let x = 1.4; x <= xr - 0.4; x += 2.3) xs.push(x + rr(-0.16, 0.16));
      xs.push(xr);
      const zs = [zf + 2.6, zf + 5.2];
      const lev = [];
      for (let y = 2.2; y < topY + 0.1; y += 2.05) lev.push(y);
      const y0 = 0.1;
      // two runs down the shade side, no more: that wall should stay one dark mass
      for (let k = zs.length - 1; k >= 0; k--) bambooLine(xr + rr(-0.05, 0.05), y0, zs[k], xr + rr(-0.05, 0.05), topY + rr(0.2, 1.1), zs[k], 0.05);
      lev.forEach((y) => {
        bambooLine(xr, y + rr(-0.05, 0.05), zf, xr, y + rr(-0.05, 0.05), zs[1] + 0.8, 0.042);
        zs.forEach((z) => lash(xr, y, z));
      });
      // front run
      lev.forEach((y, li) => {
        bambooLine(0.7, y + rr(-0.05, 0.05), zf, xr + 0.4, y + rr(-0.05, 0.05), zf, 0.042);
        if (li % 2 === 1 && xs.length > 3) plank(xs[1] - 0.2, xs[Math.min(xs.length - 2, 3)] + 0.2, y + 0.06, zf - 0.02, zf + 0.46);
      });
      xs.forEach((x) => {
        bambooLine(x, y0, zf + rr(-0.04, 0.04), x + rr(-0.05, 0.05), topY + rr(0.1, 1.5), zf + rr(-0.04, 0.04), 0.052);
      });
      lev.forEach((y) => xs.forEach((x) => lash(x, y, zf)));
      if (lev.length > 1) bambooLine(xs[0] + 0.02, lev[0] - 1.6, zf - 0.03, xs[1], lev[1], zf - 0.03, 0.034);
      if (lev.length > 3) bambooLine(xs[3], lev[1], zf - 0.03, xs[2], lev[3], zf - 0.03, 0.034);
      // the black pot with a face, hung to keep off the evil eye: every site in Bihar has one
      if (st.nazar) {
        const nx = xs[Math.min(1, xs.length - 1)] + 0.12, ny = lev[0] - 0.06;
        const a = pr(nx, ny + 0.5, zf), b = pr(nx, ny, zf), r = Math.max(2.2, 0.13 * K);
        stroke(a[0], a[1], b[0], b[1], 1, 1, 1, 0.1);
        const pts = [];
        for (let k = 0; k < 14; k++) {
          const an = (k / 14) * Math.PI * 2;
          pts.push(b[0] + Math.cos(an) * r, b[1] + r + Math.sin(an) * r);
        }
        poly(pts, (x, y) => S(0.97, y / P, x / P, (x + y) / P, x, y));
        if (LOD >= 1) {
          for (const sx of [-0.38, 0.38]) {
            const pe = [];
            for (let k = 0; k < 8; k++) { const an = (k / 8) * Math.PI * 2; pe.push(b[0] + sx * r + Math.cos(an) * r * 0.2, b[1] + r * 0.82 + Math.sin(an) * r * 0.2); }
            poly(pe, () => 0);
          }
          stroke(b[0] - r * 0.46, b[1] + r * 1.36, b[0] + r * 0.46, b[1] + r * 1.36, r * 0.16, r * 0.16, 0, 0.1);
        }
      }
    }
    function hoist() {
      // A bamboo jib with a rope and a pulley. This is how material gets up in Patna.
      const y = LV[3] + 0.14, x = 1.15, z = -0.3;
      bambooLine(x, y + 0.2, z, x + 0.1, y + 6.1, z, 0.075);
      bambooLine(x + 0.1, y + 3.6, z, -0.45, y + 5, z - 1.2, 0.064);
      const tip = pr(-0.45, y + 5, z - 1.2), low = pr(-0.45, y - 3.4, z - 1.2);
      if (!opts.noPan) stroke(tip[0], tip[1], low[0], low[1], Math.max(1, K * 0.013), Math.max(1, K * 0.013), 1, 0.08);
      const back = pr(x + 0.1, y + 5.9, z), ta = pr(-0.45, y + 5, z - 1.2);
      const st2 = pr(4.6, y + 1.0, z + 3.4), mt = pr(x + 0.1, y + 5.9, z);
      stroke(mt[0], mt[1], st2[0], st2[1], Math.max(0.9, K * 0.009), Math.max(0.9, K * 0.009), 1, 0.08);
      stroke(back[0], back[1], ta[0], ta[1], Math.max(0.9, K * 0.011), Math.max(0.9, K * 0.011), 1, 0.08);
      // pulley wheel
      const r = Math.max(2, K * 0.1), px = [];
      for (let k = 0; k < 12; k++) { const an = (k / 12) * Math.PI * 2; px.push(tip[0] + Math.cos(an) * r, tip[1] + r * 0.6 + Math.sin(an) * r); }
      poly(px, (xx, yy) => S(0.9, yy / P, xx / P, 0, xx, yy));
      if (opts.noPan) return;
      // the iron pan on the rope
      const g = K * 0.34, gy = low[1];
      poly([low[0] - g, gy, low[0] + g, gy, low[0] + g * 0.68, gy + g * 0.56, low[0] - g * 0.68, gy + g * 0.56], (xx, yy) => S(0.72 + (xx - low[0]) / g * 0.2, (xx - low[0]) / (P * 0.9), yy / P, (xx + yy) / P, xx, yy));
      stroke(low[0] - g, gy, low[0], gy - g * 0.8, 1, 1, 1, 0.1);
      stroke(low[0] + g, gy, low[0], gy - g * 0.8, 1, 1, 1, 0.1);
    }

    /* Ground and things on it */
    function ground(mode) {
      const hy = C.hy, yTop = Math.max(0, pr(0, 0, 60)[1]);
      const xc = opts.groundCx || C.cx, rw = W * (opts.groundR || 0.48), bandTop = yTop;
      poly([0, bandTop, W, bandTop, W, H, 0, H], (x, y) => {
        const d = F * C.ey / Math.max(1, y + 0.5 - hy);
        const xcw = ((x + 0.5 - C.cx) * d) / F;
        const wx = C.ex + xcw * C.cos + d * C.sin, wz = C.ez - xcw * C.sin + d * C.cos;
        const ex = (x - xc) / rw, ey = (y - hy) / (H - hy + 1);
        const r = ex * ex * (1.05 + 0.5 * vn(x * 0.004, y * 0.01));
        let dis = 1 - sstep(0.34, 0.92, r);
        if (opts.fadeBottom) dis *= 1 - sstep(H * 0.9, H * 0.995, y);
        dis *= sstep(0, H * 0.018, y - hy);
        if (dis < RT[(x & 511) + ((y & 511) << 9)]) { pl.setA(0); return 0; }
        let t = 0.03 + fbm(wx * 0.42, wz * 0.3) * 0.17;
        // the house throws its shade to the right and behind
        if (wx > HW && wz > -0.5 && st.st[0] > 0) {
          const bh = st.slabs >= 3 ? 7.4 : st.slabs >= 1 ? 3.6 : 1.9;
          const reach = bh * 0.9;
          const sx = (wx - HW) / reach;
          if (sx < 1 && wz < HD + (wx - HW) * 0.7) t += 0.6 * (1 - sx * sx);
        }
        // tyre ruts
        if (mode === 1) {
          const rut = Math.abs(((wz + 8) * 0.8 + vn(wx * 0.2, 9) * 0.7) % 3 - 1.5);
          if (rut < 0.1 && wz < 0) t += 0.16;
        }
        // and a contact shade at the walls
        if (wz < 0 && wz > -0.35 && wx > 0 && wx < HW && st.st[0] > 2) t += 0.34 * (1 + wz / 0.35);
        const gr = t * 0.42 > RT[((x * 3) & 511) + (((y * 5) & 511) << 9)] ? 1 : 0;
        const ln = S(t, y / (P * 1.2), x / P, (x + y) / (P * 1.2), x, y);
        return night ? ln : gr > ln ? gr : ln;
      });
      // Bits of gravel and shade marks scattered about
      srand(23);
      const n = night ? 0 : LOD === 2 ? 900 : 260;
      for (let k = 0; k < n; k++) {
        const wx = rr(-12, 24), wz = rr(-14, 18);
        if (wz > -0.5 && wx > -1 && wx < HW + 1) continue;
        const a = pr(wx, 0, wz);
        if (a[0] < 0 || a[0] >= W || a[1] < C.hy || a[1] >= H) continue;
        const rx = ((x) => (x - xc) / rw)(a[0]);
        if (rx * rx > 0.3) continue;
        const sc = F / a[2], L = rr(0.04, 0.2) * sc;
        stroke(a[0], a[1], a[0] + L, a[1] + rr(-0.5, 0.5), Math.max(0.6, sc * 0.008), 0.5, 1, 0.1);
      }
    }
    function brickStack(x, z, lx, lz, h) {
      const fm = (px, py, u, Y) => {
        const t = brickTone(u, Y, 0.34, 0.03, 0.3);
        return S(t, Y * LY, u * LU, (u * LU + Y * LY) * 0.7, px, py);
      };
      const rm = (px, py, u, Y) => {
        const t = brickTone(u, Y, 0.72, 0.42, 0.2);
        return S(t, u * LU, Y * LY, (u * LU - Y * LY) * 0.7, px, py);
      };
      const tm = (px, py) => {
        const v = hash(Math.floor(px / (K * 0.25)), Math.floor(py / (K * 0.1)));
        return S(0.1 + v * 0.16, py / P, px / P, 0, px, py);
      };
      box(x, x + lx, 0, h, z, z + lz, fm, rm, tm);
      edge(x + lx, 0, z, x + lx, h, z, 1.5, 1);
    }
    function bagStack(x, z, cols, rows) {
      const bw = 0.72, bh = 0.18, wd = cols * bw, dp = 1.45, top = rows * bh;
      face(x + wd, z, x + wd, z + dp, 0, top, (px, py, u, Y) => {
        const f = Y / bh, ff = f - Math.floor(f);
        return S(0.6 + (ff < 0.2 ? 0.36 : 0) + vn(u * 2, Y * 3) * 0.08, px / P, Y * LY, (px / P - Y * LY) * 0.7, px, py);
      });
      if (top < C.ey) flat(x, z, x + wd, z + dp, top, (px, py) => S(0.05 + vn(px * 0.03, py * 0.1) * 0.08, py / (P * 1.1), px / P, 0, px, py));
      for (let r = 0; r < rows; r++) {
        const n = r % 2 ? cols * 2 : cols, w0 = wd / n, y0 = r * bh;
        for (let c = n - 1; c >= 0; c--) {
          const ox = x + c * w0, a = pr(ox, y0, z), bb = pr(ox + w0, y0, z), t0 = pr(ox, y0 + bh, z);
          const cx = (a[0] + bb[0]) / 2, w = (bb[0] - a[0]) / 2, cy = (a[1] + bb[1]) / 2 - (a[1] - t0[1]) / 2, hh = (a[1] - t0[1]) / 2 + 0.5;
          const pts = [];
          for (let k = 0; k < 20; k++) {
            const an = (k / 20) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
            pts.push(cx + Math.sign(ca) * Math.pow(Math.abs(ca), 0.3) * w, cy + Math.sign(sa) * Math.pow(Math.abs(sa), 0.5) * hh);
          }
          poly(pts, (px, py) => {
            const nx = (px - cx) / w, ny = (py - cy) / hh;
            const tn = 0.02 + (ny > 0.15 ? (ny - 0.15) * (ny - 0.15) * 1.5 : 0) + nx * nx * nx * nx * 0.55 + (ny < -0.82 ? 0.3 : 0);
            return S(tn, py / (P * 0.86), px / P, (px + py) / P, px, py);
          });
        }
      }
    }
    function heap(x, z, rw, h, tone, gravel, seed) {
      // balu or gitti, tipped in a heap
      srand(seed);
      const a = pr(x, 0, z), rpx = (rw * F) / a[2], hpx = (h * F) / a[2];
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, xn = t * 2 - 1, bump = (vn(t * 9 + seed, 3) - 0.5) * 0.18;
        pts.push(a[0] + xn * rpx, a[1] + rpx * 0.12 * (1 - xn * xn) * -0 - (1 - Math.pow(Math.abs(xn), 1.75)) * hpx * (1 + bump));
      }
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, xn = 1 - t * 2;
        pts.push(a[0] + xn * rpx, a[1] + (1 - xn * xn) * rpx * 0.14);
      }
      poly(pts, (px, py) => {
        const nx = (px - a[0]) / rpx, ny = (a[1] - py) / hpx;
        const lit = 0.42 - nx * 0.36 + ny * 0.2 + (vn(px * 0.02, py * 0.05) - 0.5) * 0.28;
        let t = clamp(1 - lit * 1.5) * tone + 0.02;
        if (gravel) {
          const sz = Math.max(3, K * 0.1), wy = worley(px / sz, py / (sz * 0.8));
          if (wy[1] - wy[0] < 0.09) t += 0.6; else t += (wy[2] - 0.5) * 0.3;
          const th = wy[2] * 3.14;
          return S(t, (px * Math.cos(th) + py * Math.sin(th)) / P, py / P, (px - py) / P, px, py);
        }
        const st2 = t * 0.82 > RT[(px & 511) + ((py & 511) << 9)] ? 1 : 0;
        const lines = cov((ny * hpx + nx * nx * rpx * 0.25) / (P * 1.25), t * 0.5);
        return NIGHT_S(st2 > lines ? st2 : lines, px, py);
      });
      for (let k = 0; k < 24; k++) stroke(pts[k * 2], pts[k * 2 + 1], pts[k * 2 + 2], pts[k * 2 + 3], 0.9, 0.9, night ? 0.3 : 0.75, 0.25);
    }
    function NIGHT_S(v, x, y) { if (!night) return v; return v * 0.2; }
    function drum(x, z) {
      const a = pr(x, 0, z), t = pr(x, 1.0, z), r = (0.3 * F) / a[2], d = r * 0.26;
      const pts = [];
      for (let k = 0; k <= 10; k++) { const an = Math.PI + (k / 10) * Math.PI; pts.push(a[0] + Math.cos(an) * r, t[1] + Math.sin(an) * d); }
      for (let k = 0; k <= 10; k++) { const an = (k / 10) * Math.PI; pts.push(a[0] + Math.cos(an) * r, a[1] + Math.sin(an) * d); }
      poly(pts, (x2, y2) => {
        const nx = (x2 - a[0]) / r;
        let tn = 0.2 + (nx > 0 ? nx * nx * 0.75 : nx * nx * 0.1);
        const b = (y2 - t[1]) / (a[1] - t[1]);
        if (Math.abs(b - 0.33) < 0.02 || Math.abs(b - 0.66) < 0.02) tn += 0.5;
        return S(tn, (Math.asin(clamp(nx, -1, 1)) * r) / P, y2 / P, (x2 + y2) / P, x2, y2);
      });
      const top = [];
      for (let k = 0; k < 16; k++) { const an = (k / 16) * Math.PI * 2; top.push(a[0] + Math.cos(an) * r, t[1] + Math.sin(an) * d); }
      poly(top, (x2, y2) => S(0.86, y2 / P, x2 / P, (x2 + y2) / P, x2, y2));
    }
    function mixer(x, z) {
      // The concrete mixer every street hears on slab day: tilted drum, ring gear, hopper, two wheels.
      const a = pr(x, 0, z), s0 = F / a[2], cx = a[0], base = a[1], wr = s0 * 0.3;
      const dx = cx - s0 * 0.16, dy = base - s0 * 1.26, ang = -0.5, ca = Math.cos(ang), sa = Math.sin(ang);
      const R = (u, v) => [dx + u * s0 * ca - v * s0 * sa, dy + u * s0 * sa + v * s0 * ca];
      // frame and legs
      pole(cx - s0 * 0.78, base - s0 * 0.42, cx + s0 * 0.92, base - s0 * 0.42, s0 * 0.05, s0 * 0.05, 0.62, 0);
      pole(cx - s0 * 0.44, base - s0 * 0.42, dx - s0 * 0.1, dy + s0 * 0.44, s0 * 0.05, s0 * 0.05, 0.62, 0);
      pole(cx + s0 * 0.42, base - s0 * 0.42, dx + s0 * 0.26, dy + s0 * 0.44, s0 * 0.05, s0 * 0.05, 0.62, 0);
      // engine box
      poly([cx + s0 * 0.38, base - s0 * 0.86, cx + s0 * 0.9, base - s0 * 0.86, cx + s0 * 0.9, base - s0 * 0.44, cx + s0 * 0.38, base - s0 * 0.44], (px, py) => S(0.82, py / P, px / P, (px + py) / P, px, py));
      // drum: wide belly, narrow mouth
      const body = [R(-0.5, -0.32), R(-0.5, 0.32), R(-0.1, 0.56), R(0.3, 0.56), R(0.58, 0.36), R(0.58, -0.36), R(0.3, -0.56), R(-0.1, -0.56)].flat();
      poly(body, (px, py) => {
        const u = ((px - dx) * ca + (py - dy) * sa) / s0, v = (-(px - dx) * sa + (py - dy) * ca) / s0;
        let t = 0.1 + (v > 0 ? v * v * 2.2 : v * v * 0.5) + (u > 0.08 && u < 0.17 ? 0.58 : 0);
        if (Math.abs(((v * 16) % 1)) < 0.12 && u > 0.08 && u < 0.17) t = 0.98;
        return S(t, (v * s0) / (P * 0.8), (u * s0) / P, ((u + v) * s0) / P, px, py);
      });
      const mc = R(-0.5, 0), mouth = [];
      for (let k = 0; k < 18; k++) {
        const an = (k / 18) * Math.PI * 2, e1 = Math.cos(an) * 0.32, e2 = Math.sin(an) * 0.1;
        mouth.push(mc[0] - sa * s0 * e1 * -1 * -1 + ca * s0 * e2, mc[1] + ca * s0 * e1 + sa * s0 * e2);
      }
      poly(mouth, (px, py) => S(0.98, py / P, px / P, (px + py) / P, px, py));
      // hopper tray tipped down at the back
      poly([cx + s0 * 0.86, base - s0 * 0.42, cx + s0 * 1.42, base - s0 * 0.86, cx + s0 * 1.62, base - s0 * 0.66, cx + s0 * 1.08, base - s0 * 0.2], (px, py) => S(0.42, (px - py) / P, (px + py) / P, py / P, px, py));
      wheel(cx - s0 * 0.42, base - wr, wr, 0.42);
      wheel(cx + s0 * 0.62, base - wr, wr, 0.42);
    }
    function wheel(cx, cy, r, hub) {
      const pts = [];
      for (let k = 0; k < 30; k++) { const an = (k / 30) * Math.PI * 2; pts.push(cx + Math.cos(an) * r, cy + Math.sin(an) * r); }
      poly(pts, (x, y) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rn = Math.hypot(dx, dy) / r, an = Math.atan2(dy, dx);
        if (rn < hub) {
          const t = 0.14 + (dx + dy > 0 ? 0.3 : 0) + (rn > hub * 0.86 ? 0.7 : 0) + (rn < hub * 0.3 ? 0.5 : 0);
          return S(t, (rn * r) / P, an * 8, (x + y) / P, x, y);
        }
        const lug = Math.abs(((an / (Math.PI * 2)) * 22 + (rn > 0.8 ? 0.3 : 0)) % 1 - 0.5) < 0.2;
        let t = 0.8 + (lug && rn > 0.76 ? -0.42 : 0) + (dx + dy > 0 ? 0.14 : -0.1);
        return S(t, (rn * r) / (P * 0.8), an * r / P, (x - y) / P, x, y);
      });
    }

    /* A person, small enough to be a shape. Enough to give the house its size. */
    function figure(x, z, kind) {
      const a = pr(x, 0, z), s0 = F / a[2], u = s0 * 1.5, cx = a[0], by = a[1];
      const P2 = (pts) => pts.map((v, i) => (i % 2 ? by - v * u : cx + v * u));
      const dark = (px, py) => S(0.94, py / P, px / P, (px + py) / P, px, py);
      const cloth = (px, py) => {
        const n = (px - cx) / (u * 0.12);
        return S(0.2 + (n > 0 ? n * n * 0.5 : 0), py / (P * 0.9), px / P, (px + py) / P, px, py);
      };
      const head = (hx, hy, rx, ry, sh) => {
        const pts = [];
        for (let k = 0; k < 12; k++) { const an = (k / 12) * Math.PI * 2; pts.push(cx + (hx + Math.cos(an) * rx) * u, by - (hy + Math.sin(an) * ry) * u); }
        poly(pts, sh || dark);
      };
      if (kind === 'gamla') {
        // A woman walking with an iron pan of bricks on her head, sari to the ankle, one arm up to steady it.
        poly(P2([-0.075, 0.58, 0.075, 0.58, 0.1, 0.3, 0.135, 0.02, 0.09, 0, -0.1, 0, -0.11, 0.03, -0.1, 0.3]), cloth);
        poly(P2([-0.085, 0.82, 0.075, 0.82, 0.08, 0.56, -0.075, 0.56, -0.095, 0.72]), dark);
        poly(P2([0.06, 0.82, 0.095, 0.84, 0.135, 0.96, 0.105, 0.98, 0.075, 0.9, 0.05, 0.78]), dark);
        poly(P2([-0.085, 0.8, -0.105, 0.62, -0.09, 0.5, -0.06, 0.52, -0.07, 0.66]), dark);
        head(0.005, 0.895, 0.052, 0.06);
        poly(P2([-0.15, 1.0, 0.16, 1.0, 0.105, 0.95, -0.095, 0.95]), (px, py) => S(0.82, (px - cx) / P, py / P, 0, px, py));
        poly(P2([-0.11, 1.0, -0.06, 1.07, 0.09, 1.07, 0.125, 1.0]), (px, py) => S(0.42, py / P, px / P, (px - py) / P, px, py));
      } else if (kind === 'squat') {
        // A mason on his heels, working low.
        poly(P2([-0.115, 0.0, 0.05, 0.0, 0.13, 0.18, 0.05, 0.24, -0.06, 0.2]), cloth);
        poly(P2([-0.12, 0.2, -0.13, 0.42, -0.03, 0.56, 0.06, 0.5, 0.075, 0.3, 0.02, 0.2]), dark);
        poly(P2([0.03, 0.48, 0.15, 0.3, 0.19, 0.2, 0.165, 0.18, 0.11, 0.26, 0.0, 0.4]), dark);
        head(0.045, 0.6, 0.05, 0.058);
      } else {
        // A mason in a lungi, standing, one arm out to the work.
        poly(P2([-0.075, 0.27, -0.03, 0.27, -0.035, 0.03, -0.015, 0, -0.09, 0, -0.07, 0.03]), dark);
        poly(P2([0.03, 0.27, 0.078, 0.27, 0.075, 0.03, 0.105, 0, 0.03, 0, 0.038, 0.03]), dark);
        poly(P2([-0.09, 0.52, 0.09, 0.52, 0.09, 0.25, -0.092, 0.25]), cloth);
        poly(P2([-0.085, 0.83, -0.1, 0.78, -0.07, 0.52, 0.08, 0.52, 0.09, 0.78, 0.07, 0.83, 0.02, 0.86, -0.03, 0.86]), dark);
        poly(P2([-0.09, 0.8, -0.125, 0.62, -0.115, 0.47, -0.085, 0.47, -0.09, 0.62, -0.07, 0.72]), dark);
        poly(P2([0.075, 0.82, 0.2, 0.74, 0.3, 0.77, 0.305, 0.74, 0.2, 0.68, 0.06, 0.74]), dark);
        head(0.01, 0.925, 0.052, 0.062);
      }
    }

    function foundation() {
      // Pits for each footing, cut into the ground, with cages of sariya standing in them.
      const pits = [];
      for (let zi = 3; zi >= 0; zi--) for (let xi = 0; xi < 4; xi++) pits.push([COLX[xi], COLZ[zi]]);
      for (const [cx, cz] of pits) {
        const r = 0.9;
        const a = pr(cx - r, 0, cz - r), b = pr(cx + r, 0, cz - r), c = pr(cx + r, 0, cz + r), e = pr(cx - r, 0, cz + r);
        // soil thrown up around it
        const ce = pr(cx, 0, cz), rp = (1.2 * F) / ce[2];
        const sp = [];
        for (let k = 0; k < 18; k++) {
          const an = (k / 18) * Math.PI * 2;
          sp.push(ce[0] + Math.cos(an) * rp * (1 + vn(k * 0.7, cx + cz) * 0.22), ce[1] + Math.sin(an) * rp * 0.42 - rp * 0.03);
        }
        poly(sp, (x, y) => {
          const t = 0.2 + sstep(0, 1, (y - ce[1]) / (rp * 0.3)) * 0.34;
          const st2 = t * 0.9 > RT[(x & 511) + ((y & 511) << 9)] ? 1 : 0;
          return st2;
        });
        poly([a[0], a[1], b[0], b[1], c[0], c[1], e[0], e[1]], (x, y) => {
          const d = F * C.ey / Math.max(1, y + 0.5 - C.hy);
          return S(0.96, y / (P * 0.86), x / P, (x + y) / P, x, y);
        });
        // far wall lit, so the pit has depth
        const a2 = pr(cx - r, -0.5, cz + r), c2 = pr(cx + r, -0.5, cz + r);
        poly([e[0], e[1], c[0], c[1], c2[0], c2[1], a2[0], a2[1]], (x, y) => S(0.46, y / P, x / P, (x + y) / P, x, y));
      }
      for (const [cx, cz] of pits) {
        const r = 0.4;
        // footing block and the cage
        box(cx - r, cx + r, 0, 0.14, cz - r, cz + r, concF(cx, 0), concR, (x, y) => S(0.08, y / P, x / P, 0, x, y));
        drawBars(cx, cz, 0.1, 2.5, cx * 3 + cz * 7 + 1);
      }
    }
    function layoutThread() {
      // Chuna lines and the mason's thread that fixes where the house will stand.
      const corners = [[-0.9, -0.9], [HW + 0.9, -0.9], [HW + 0.9, HD + 0.9], [-0.9, HD + 0.9]];
      for (let k = 0; k < 4; k++) {
        const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4];
        const a = pr(x0, 0.5, z0), b = pr(x1, 0.5, z1);
        stroke(a[0], a[1], b[0], b[1], 0.9, 0.9, 0.85, 0.05);
        const pa = pr(x0, 0, z0);
        stroke(pa[0], pa[1], a[0], a[1], Math.max(1.6, K * 0.03), Math.max(1.2, K * 0.02), 1, 0.1);
      }
    }
    function shutterDeck() {
      // Slab day: planks underneath, a mesh of sariya on top and wet concrete being poured.
      const y = LV[2];
      flat(-0.15, -0.15, HW + 0.15, HD + 0.15, y - 0.1, (x, yy) => {
        const pk = Math.floor(x / (K * 0.26));
        return S(0.82 + hash(pk, 2) * 0.12, x / (P * 0.8), yy / P, (x + yy) / P, x, yy);
      });
      box(-0.15, HW + 0.15, y - 0.1, y + 0.08, -0.15, HD + 0.15,
        (x, yy, u, Y) => { const pk = Math.floor(u / 0.3); return S(0.2 + hash(pk, 8) * 0.2 + (u / 0.3 - pk < 0.05 ? 0.5 : 0), Y * LY, u * LU, 0, x, yy); },
        (x, yy, u, Y) => S(0.6, u * LU, Y * LY, 0, x, yy));
      edge(-0.15, y - 0.1, -0.15, HW + 0.15, y - 0.1, -0.15, 1.3);
      for (let zi = 3; zi >= 0; zi--) for (let xi = 0; xi < 4; xi++) {
        if (zi !== 0 && xi !== 3 && !(zi < 3 && xi > 0)) continue;
        drawBars(COLX[xi], COLZ[zi], y, y + 1.9, xi * 3 + zi * 11 + 50);
      }
    }
    function background() {
      // Neighbours in the haze. The plot is not alone, but the sky stays huge.
      srand(61);
      const runs = [[-34, 60, 44], [HW - 6, 66, 44], [HW + 16, 52, 30]];
      for (const [x0, z, xs] of runs) {
        let x = x0;
        while (x < x0 + xs) {
          const w = rr(4.5, 8), h = rr(3.4, 7.6);
          face(x, z, x + w, z, 0, h, (px, py, u, Y) => {
            if (night) return S(0.62, Y * LY * 0.9, u * LU, 0, px, py);
            return S(0.05 + (1 - Y / h) * 0.07 + vn(u * 0.5, Y * 0.3) * 0.03, py / (P * 1.18), px / P, 0, px, py);
          });
          for (let f = 0; f < Math.floor(h / 3); f++) for (let q = 0; q < 2; q++) {
            if (hash(Math.round(x * 3) + q, f + 2) > 0.5) continue;
            const wx = x + 1 + q * (w - 2.4), wy = 1.2 + f * 3;
            face(wx, z, wx + 0.8, z, wy, wy + 1, night
              ? (hash(Math.round(x * 5) + q, f) > 0.72 ? () => { pl.setBW(0.6); return 0; } : (px, py) => S(0.9, py / P, px / P, 0, px, py))
              : (px, py) => S(0.26, py / (P * 1.18), px / P, 0, px, py));
          }
          // a bit of sariya on most of these roofs too
          if (hash(Math.round(x), 2) > 0.35) {
            for (let q = 0; q < 2; q++) {
              const bx = x + 0.5 + q * (w - 1), a0 = pr(bx, h, z), b0 = pr(bx, h + 1.1, z);
              stroke(a0[0], a0[1], b0[0], b0[1], 0.8, 0.7, night ? 0.25 : 0.4, 0.1);
            }
          }
          x += w + rr(0.2, 2.4);
        }
      }
    }
    function pole_and_wires() {
      const a = pr(-6.5, 0, -2.4), t = pr(-6.5, 8.6, -2.4);
      pole(a[0], a[1], t[0], t[1], 0.11 * K, 0.07 * K, 0.22, 0);
      for (let k = 0; k < 2; k++) {
        const y = 8.2 - k * 0.5, l = pr(-7.1, y, -2.4), r = pr(-5.9, y, -2.4);
        pole(l[0], l[1], r[0], r[1], 0.03 * K, 0.03 * K, 0.4, 0);
      }
      const wy = [8.2, 8.2, 7.7];
      const end = [[-7.1, W * -0.2], [-5.9, W * 1.2]];
      for (let k = 0; k < 3; k++) {
        const s0 = pr(-7 + k * 0.5, wy[k], -2.4);
        const ex = W * 1.1, ey = s0[1] + K * (-0.8 + k * 0.5);
        let px = s0[0], py = s0[1];
        for (let q = 1; q <= 14; q++) {
          const t2 = q / 14, x = lerp(s0[0], ex, t2), y = lerp(s0[1], ey, t2) + Math.sin(t2 * Math.PI) * K * 0.8;
          stroke(px, py, x, y, 0.9, 0.9, 0.82, 0.05);
          px = x; py = y;
        }
        const lx = -W * 0.15, ly = s0[1] - K * 0.3;
        px = s0[0]; py = s0[1];
        for (let q = 1; q <= 8; q++) {
          const t2 = q / 8, x = lerp(s0[0], lx, t2), y = lerp(s0[1], ly, t2) + Math.sin(t2 * Math.PI) * K * 0.4;
          stroke(px, py, x, y, 0.9, 0.9, 0.82, 0.05);
          px = x; py = y;
        }
      }
    }
    function tree(x, z, sc, seed) {
      // A neem down the road. Stippled, soft and well behind the house, so it does not compete.
      srand(seed);
      const a = pr(x, 0, z), s0 = (F / a[2]) * sc, tx = a[0], ty = a[1];
      const trunk = night ? 0.5 : 0.62;
      pole(tx, ty, tx - s0 * 0.25, ty - s0 * 3, s0 * 0.2, s0 * 0.1, trunk, 0);
      pole(tx - s0 * 0.16, ty - s0 * 2.1, tx + s0 * 1.2, ty - s0 * 3.5, s0 * 0.09, s0 * 0.04, trunk, 0);
      pole(tx - s0 * 0.22, ty - s0 * 2.7, tx - s0 * 1.4, ty - s0 * 3.9, s0 * 0.09, s0 * 0.04, trunk, 0);
      const puffs = [];
      for (let k = 0; k < 34; k++) {
        const an = rr(0, Math.PI * 2), rd = Math.sqrt(rnd());
        puffs.push([tx - s0 * 0.15 + Math.cos(an) * rd * s0 * 2.5, ty - s0 * 4.7 + Math.sin(an) * rd * s0 * 1.5, rr(0.5, 0.95) * s0]);
      }
      puffs.sort((p, q) => p[1] - q[1]);
      for (const [px, py, r] of puffs) {
        const pts = [];
        for (let k = 0; k < 14; k++) {
          const an = (k / 14) * Math.PI * 2, rr2 = r * (0.84 + vn(px * 0.1 + k, py * 0.1) * 0.36);
          pts.push(px + Math.cos(an) * rr2, py + Math.sin(an) * rr2 * 0.86);
        }
        poly(pts, (x2, y2) => {
          const nx = (x2 - px) / r, ny = (y2 - py) / r, rho = nx * nx + ny * ny;
          if (1 - sstep(0.55, 1, rho) < RT[(x2 & 511) + ((y2 & 511) << 9)]) { pl.setA(0); return 0; }
          const leaf = vn(x2 * (9 / s0), y2 * (9 / s0));
          let t = clamp(0.14 + ny * 0.42 + nx * 0.2 + (y2 - (ty - s0 * 4.7)) / (s0 * 1.9) * 0.3) * (0.5 + leaf * 0.9);
          if (night) return t * 0.14 > RT[((x2 * 3) & 511) + ((y2 * 3 & 511) << 9)] ? 0.7 : 0;
          return t > RT[((x2 * 3) & 511) + ((y2 * 3 & 511) << 9)] ? 1 : 0;
        });
      }
    }
    function toran(y) {
      // Marigold and mango leaves over the door. The one thing that says: people live here now.
      if (opts.lightsOff) return;
      const a = 3.72, b = 5.88, n = 22;
      const pa = pr(a, y + 0.1, -0.06), pb = pr(b, y + 0.1, -0.06), da = pr(4.0, y, 0), db = pr(5.6, y, 0);
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = lerp(pa[0], pb[0], t), yy = lerp(pa[1], pb[1], t) + Math.sin(t * Math.PI) * K * 0.1;
        const inside = x > da[0] && x < db[0];
        const r = Math.max(1.5, K * 0.042), pts = [];
        if (inside && k % 2) {
          // a mango leaf hanging, dark against the light
          const L0 = K * 0.2;
          poly([x - r * 0.62, yy, x + r * 0.62, yy, x + r * 0.34, yy + L0 * 0.62, x, yy + L0, x - r * 0.34, yy + L0 * 0.62], () => { pl.setBW(1); return 1; });
          continue;
        }
        for (let q = 0; q < 8; q++) { const an = (q / 8) * Math.PI * 2; pts.push(x + Math.cos(an) * r, yy + Math.sin(an) * r); }
        poly(pts, () => { pl.setBW(inside ? 0.72 : 1); return 0; });
      }
    }

    /* Paint it, back to front */
        function dish(x, y, z) {
      const a = pr(x, y, z), b = pr(x, y + 1.05, z), r = K * 0.42;
      stroke(a[0], a[1], b[0], b[1], Math.max(1, K * 0.02), Math.max(1, K * 0.02), night ? 0.5 : 1, 0.1);
      const pts = [];
      for (let k = 0; k < 18; k++) { const an = (k / 18) * Math.PI * 2; pts.push(b[0] + Math.cos(an) * r * 0.44 - Math.sin(an) * r * 0.1, b[1] + Math.sin(an) * r + Math.cos(an) * r * 0.1); }
      poly(pts, (px, py) => S(0.22 + (px - b[0]) / r * 0.5, (px * 0.6 + py) / P, px / P, 0, px, py));
    }
    function paint() {
      litSeed = 0;
      if (night) background();
      if (st.ground) ground(st.ground);
      if (key !== 'hero') {
        tree(-4.2, 7, 0.88, 41);
        tree(12.8, 15, 1.05, 77);
      }
      if (st.pits) foundation();
      if (st.thread) layoutThread();
      if (st.st[0] && st.plinth) {
        // plinth
        box(-0.2, HW + 0.2, 0, LV[0], -0.2, HD + 0.2, (x, y, u, Y) => S(0.52 + vn(u, Y) * 0.1, Y * LY, u * LU, 0, x, y), (x, y, u, Y) => S(0.78, u * LU, Y * LY, 0, x, y), (x, y) => S(0.1, y / P, x / P, 0, x, y));
      }
      // Top-down, so lower floors can cover what is behind them.
      if (st.roof) roofLevel();
      if (st.slabs >= 3 || st.roof) { parapet(); slabEdge(LV[3]); }
      if (st.final) dish(0.9, LV[3] + 1.1, 1.2);
      if (st.st[2]) storey(2, st.st[2]);
      if (st.slabs >= 2 && !st.deck) slabEdge(LV[2]);
      if (st.st[2] >= 5 || (st.st[1] >= 3 && st.st[2] >= 3) || key === 'hero') balcony(2, st.final);
      if (st.deck) shutterDeck();
      if (st.st[1]) storey(1, st.st[1]);
      if (st.slabs >= 1) { slabEdge(LV[1]); if (st.st[1] >= 2) balcony(1, st.final); }
      if (st.st[0]) storey(0, st.st[0]);
      if (st.final) {
        // steps up to the door
        for (let k = 0; k < 3; k++) box(3.7 - k * 0.1, 5.9 + k * 0.1, LV[0] - 0.17 * (k + 1), LV[0] - 0.17 * k, -0.3 - k * 0.28, 0, concF(k, 0), concR, (x, y) => S(0.06, y / P, x / P, 0, x, y));
        toran(LV[0] + 2.32);
      }
      if (st.heaps) foreground(st.heaps);
      if (st.hoist2) mixer(12.7, -3.8);
      if (st.scaffold) scaffold(st.scaffold);
      if (st.hoist) hoist();
      if (st.heaps) people(st.heaps);
    }
    function foreground(n) {
      if (n === 1) { heap(4.2, -5, 1.5, 0.75, 0.8, 1, 5); }
      if (n === 2) { bagStack(3.2, -4.2, 3, 8); brickStack(13.2, -0.2, 2.2, 1.1, 1.3); heap(11.6, -4.6, 1.2, 0.6, 0.8, 1, 8); }
      if (n === 3) { brickStack(2.8, -5, 2.6, 1.2, 1.3); bagStack(12.6, -2.8, 3, 8); heap(14.2, 4.5, 1.7, 0.9, 0.5, 0, 9); }
      if (n === 4) { bagStack(3.4, -4.6, 3, 7); heap(6.6, -6.4, 1.2, 0.6, 0.8, 1, 3); drum(14.2, 1); }
      if (n === 5) { heap(4.6, -6, 1.7, 0.85, 0.5, 0, 12); drum(13.6, -1.6); bagStack(14.2, 1.6, 2, 5); }
    }
    function people(n) {
      if (n === 1) figure(7.8, -3.2, 'stand');
      if (n === 2) figure(8.2, -2.8, 'stand');
      if (n === 3) { figure(5.66, -3.36, 'gamla'); figure(10.18, -2.4, 'squat'); }
      if (n === 4) { figure(8.6, -3.4, 'gamla'); figure(10.8, -2.2, 'stand'); }
      if (n === 5) figure(8.67, -3.36, 'gamla');
    }

    paint();
    if (night) {
      // Second pass: now that the lamps are known, bake the light and redraw the house under it.
      const gw = (W >> 3) + 2, gh = (H >> 3) + 2, g = new Float32Array(gw * gh);
      for (const l of lights) {
        const lx = l.x / 8, ly = l.y / 8, r = l.r / 8, y0 = Math.max(0, Math.floor(ly - r)), y1 = Math.min(gh - 1, Math.ceil(ly + r)), x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(gw - 1, Math.ceil(lx + r));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dd = Math.hypot(x - lx, y - ly) / r;
          if (dd < 1) g[x + y * gw] += l.s * (1 - dd) * (1 - dd);
        }
      }
      pl.setGlow(g, gw, gh);
      pl.A.fill(0); pl.I.fill(0); pl.WB.fill(0); pl.WL.fill(0);
      lights.length = 0; lamps.length = 0;
      // stars, a few, and a thin moon
      srand(5);
      for (let k = 0; k < (W * H) / 26000; k++) {
        const x = rr(0, W), y = rr(0, H * 0.68), r = rnd() > 0.93 ? 1.5 : 0.85;
        stroke(x, y, x + r, y, r, r, rr(0.3, 0.8), 0);
      }
      paint();
      drawLamps();
    }
    return pl;
  }

  /* ---------- Clouds: a height field of billows, lit from the upper left, cut in level lines with fine grain ---------- */
  function renderClouds(W, H, opts) {
    const pl = createPlate(W, H, { pitch: opts.pitch, night: false });
    const { cov, P } = pl;
    const Q = 2, gw = Math.ceil(W / Q) + 3, gh = Math.ceil(H / Q) + 3;
    const HF = new Float32Array(gw * gh), PL = new Float32Array(gw * gh);
    // Warp the sample position so that billows do not look like circles.
    const wx = new Float32Array(gw * gh), wy = new Float32Array(gw * gh);
    const wa = (opts.warp || 1) * W * 0.0118;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = i * Q, y = j * Q, k = i + j * gw;
      wx[k] = (fbm(x * 0.0062 + 3, y * 0.0062) - 0.5) * wa * 2.6 + (vn(x * 0.031, y * 0.031) - 0.5) * wa * 0.5;
      wy[k] = (fbm(x * 0.0062, y * 0.0062 + 9) - 0.5) * wa * 2.6 + (vn(x * 0.031 + 5, y * 0.031) - 0.5) * wa * 0.5;
    }
    srand(opts.seed || 3);
    function stamp(cx, cy, r, lift) {
      const reach = r + wa * 1.6;
      const j0 = Math.max(0, Math.floor((cy - reach) / Q)), j1 = Math.min(gh - 1, Math.ceil((cy + reach) / Q));
      const i0 = Math.max(0, Math.floor((cx - reach) / Q)), i1 = Math.min(gw - 1, Math.ceil((cx + reach) / Q));
      const r2 = r * r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = i + j * gw, dx = i * Q + wx[k] - cx, dy = j * Q + wy[k] - cy, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const d0 = Math.sqrt(d2), rim0 = (r - d0) / (r * 0.34), g0 = rim0 >= 1 ? 1 : rim0 * rim0 * (3 - 2 * rim0);
        const h = Math.sqrt(r2 - d2) + lift * g0;
        if (h > HF[k]) HF[k] = h;
      }
    }
    const dome = (a0) => Math.sqrt(Math.max(0, 1 - a0 * a0));
    // One rounded form, then smaller ones standing on its shoulders. Lower forms sit nearer the eye.
    function billow(cx, cy, R, lift, depth, dir) {
      stamp(cx, cy, R, lift);
      if (depth <= 0) return;
      const m = depth === 2 ? 5 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < m; i++) {
        const an = rr(Math.PI * 1.04, Math.PI * 1.96), d = R * rr(0.62, 0.92), r = R * rr(0.26, 0.46);
        const h0 = Math.sqrt(Math.max(0, R * R - d * d)) + lift;
        billow(cx + Math.cos(an) * d, cy + Math.sin(an) * d * dir, r, h0 * rr(0.72, 0.95), depth - 1, dir);
      }
    }
    for (const c of opts.clouds) {
      const n = Math.round(c.n || 8), cw = c.w * 0.5, ch = c.h * 0.8, dir = c.down ? -1 : 1, depth = c.depth ?? 2;
      const j0 = Math.max(0, Math.floor((c.y - ch - wa * 2) / Q)), j1 = Math.min(gh - 1, Math.ceil((c.y + ch + wa * 2) / Q));
      const i0 = Math.max(0, Math.floor((c.x - cw - wa * 2) / Q)), i1 = Math.min(gw - 1, Math.ceil((c.x + cw + wa * 2) / Q));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = i + j * gw, x = i * Q + wx[k], y = j * Q + wy[k], a0 = (x - c.x) / cw;
        if (a0 <= -1 || a0 >= 1) continue;
        const edge = c.y - dir * ch * dome(a0), inside = dir > 0 ? y - edge : edge - y, back = dir > 0 ? y - c.y : c.y - y;
        if (inside <= 0 || back > wa) continue;
        const v = 6 + Math.min(inside * 0.5, c.h * 0.14);
        if (v > HF[k]) HF[k] = v;
      }
      for (let k = 0; k < n; k++) {
        const a0 = -0.94 + (1.88 * (k + rnd() * 0.85)) / n, q = rr(0.46, 0.94);
        billow(c.x + a0 * cw, c.y - dir * ch * dome(a0) * q, c.h * rr(0.26, 0.4) * (0.62 + 0.38 * dome(a0)), (1 - q) * c.h * 0.42 + 8, depth, dir);
      }
    }
    const wall = opts.wall;
    if (opts.ceiling) {
      const yb = opts.ceiling;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const k = i + j * gw, y = j * Q + wy[k];
        if (y > yb) continue;
        const v = 50 + fbm(i * Q * 0.0024, y * 0.0032) * 90 * sstep(0, 160, yb - y);
        if (v > HF[k]) HF[k] = v;
      }
    }
    if (wall) {
      const a = wall.top / Q, b = wall.bottom / Q;
      for (let j = Math.max(0, Math.floor(a)); j < gh; j++) for (let i = 0; i < gw; i++) {
        const k = i + j * gw, x = i * Q + wx[k], y = j * Q + wy[k];
        if (y < wall.top) continue;
        const v = (60 + fbm(x * 0.0024, y * 0.0032) * 150 + fbm(x * 0.011, y * 0.013) * 18) * sstep(wall.top, wall.top + 110, y);
        if (v > HF[k]) HF[k] = v;
      }
    }
    // Blur once, then lit by finite differences. Creases between billows come from the blur difference.
    const B = new Float32Array(gw * gh);
    const rad = 6;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? HF : B, tmp = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) {
        let acc = 0;
        for (let i = -rad; i <= rad; i++) acc += src[clampI(i, gw) + j * gw];
        for (let i = 0; i < gw; i++) {
          tmp[i + j * gw] = acc / (2 * rad + 1);
          acc += src[clampI(i + rad + 1, gw) + j * gw] - src[clampI(i - rad, gw) + j * gw];
        }
      }
      for (let i = 0; i < gw; i++) {
        let acc = 0;
        for (let j = -rad; j <= rad; j++) acc += tmp[i + clampI(j, gh) * gw];
        for (let j = 0; j < gh; j++) {
          B[i + j * gw] = acc / (2 * rad + 1);
          acc += tmp[i + clampI(j + rad + 1, gh) * gw] - tmp[i + clampI(j - rad, gh) * gw];
        }
      }
    }
    function clampI(v, n) { return v < 0 ? 0 : v >= n ? n - 1 : v; }
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const k = i + j * gw, h = HF[k];
      if (h <= 0 && B[k] <= 0) { PL[k] = -1; continue; }
      const nx = (HF[k + 1] - HF[k - 1]) / (2 * Q), ny = (HF[k + gw] - HF[k - gw]) / (2 * Q);
      const bx = (B[k + 1] - B[k - 1]) / (2 * Q), by = (B[k + gw] - B[k - gw]) / (2 * Q);
      // light from the upper left
      const lit = (bx * 0.55 + by * 0.83) * 0.9 + (nx * 0.55 + ny * 0.83) * 0.34;
      const inside = wall ? sstep(wall.top, wall.top + 300, j * Q) : 0;
      const crease = clamp((B[k] - h) * 0.028) * sstep(30, 80, h) * (1 - inside);
      const rim = (1 - sstep(0, 46, h)) * 0.14 * (1 - inside);
      const shade = clamp(lerp(0.05, 0, inside) - lit * lerp(0.76, 0.1, inside));
      const hush = opts.hushLeft ? lerp(opts.hushLeft, 1, sstep(W * 0.16, W * 0.4, i * Q)) : 1;
      let tone = (shade * (opts.gain || 0.95) + crease * 0.5 + rim) * hush;
      tone = (1 - Math.exp(-tone * 1.5)) * 0.6;
      if (opts.shadeEnd) tone *= 1 - sstep(opts.shadeEnd * 0.66, opts.shadeEnd, j * Q);
      if (opts.shadeStart) tone *= sstep(opts.shadeStart * 0.5, opts.shadeStart, j * Q);
      PL[k] = clamp(tone);
    }
    const sample = (A0, x, y) => {
      const gx = x / Q, gy = y / Q, xi = gx | 0, yi = gy | 0, fx = gx - xi, fy = gy - yi, k = xi + yi * gw;
      const a = A0[k], b = A0[k + 1], c = A0[k + gw], d = A0[k + gw + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const h = sample(HF, x, y);
        if (h <= 0.2) continue;
        const rn = RT[(x & 511) + ((y & 511) << 9)];
        let alpha = sstep(0, opts.soft || 16, h);
        if (wall && y > wall.bottom) alpha *= 1 - (y - wall.bottom) / (H - wall.bottom);
        if (opts.fadeBelow && y > opts.fadeBelow) alpha *= Math.max(0, 1 - (y - opts.fadeBelow) / (opts.fadeLen || 200));
        if (alpha < rn * 0.99) continue;
        const t = Math.max(0, sample(PL, x, y));
        const detail = 0.72 + vn(x * 0.09, y * 0.09) * 0.56;
        let tn = t * detail;
        // the silhouette: a fine, broken contour, because white cloud on pale paper has no other edge
        const band = (opts.soft || 16) * 1.7;
        if (h < band) {
          const hx = opts.hushLeft ? lerp(opts.hushLeft * 0.7, 1, sstep(W * 0.16, W * 0.4, x)) : 1;
          const e = (1 - h / band) * (0.26 + vn(x * 0.02, y * 0.02) * 0.62) * hx * (opts.edge ?? 1);
          if (e * 0.9 > RT[((x * 5) & 511) + (((y * 3) & 511) << 9)]) { pl.put(x + y * W, 1, 1); continue; }
        }
        // the shade is cut in long level lines, the way an engraver cuts a sky; stipple softens it
        const wob = vn(x * 0.006, y * 0.018) * 2.4 + vn(x * 0.03, y * 0.05) * 0.5;
        const arcs = tn > 0.05 ? cov(y / (P * 1.12) + wob, (tn - 0.05) * 0.9) : 0;
        const grain = tn * tn * 0.34 > RT[((x * 3) & 511) + (((y * 5) & 511) << 9)] ? 1 : 0;
        pl.put(x + y * W, 1, arcs > grain ? arcs : grain);
      }
    }
    return pl;
  }

  /* ---------- Sprites and specimens: objects drawn large in the same hand ---------- */
  function renderObject(kind, W, H, opts) {
    const pl = createPlate(W, H, { pitch: opts.pitch, night: !!opts.night, moon: 0.45 });
    const { poly, stroke, pole, S, cov, P } = pl;
    const s = W / 100;
    const grainAt = (x, y) => RT[(x & 511) + ((y & 511) << 9)];
    const groundShade = (cx, cy, rx, ry, tone = 0.6) => {
      const pts = [];
      for (let k = 0; k < 36; k++) { const an = (k / 36) * Math.PI * 2; pts.push(cx + Math.cos(an) * rx, cy + Math.sin(an) * ry); }
      poly(pts, (x, y) => {
        const nx = (x - cx) / rx, ny = (y - cy) / ry, r = nx * nx + ny * ny, t = tone * (1 - r);
        if (grainAt(x, y) > 1 - sstep(0.3, 1, r) && r > 0.3) { pl.setA(0); return 0; }
        return grainAt(x * 3, y * 5) < t ? 1 : cov(y / (P * 0.9), t * 0.5);
      });
    };
    const circle = (cx, cy, rx, ry, sh, n = 40) => {
      const pts = [];
      for (let k = 0; k < n; k++) { const an = (k / n) * Math.PI * 2; pts.push(cx + Math.cos(an) * rx, cy + Math.sin(an) * (ry ?? rx)); }
      poly(pts, sh);
    };
    // A sack lying on its side: flat, soft corners, arched cut lines, stitched ends, a small printed mark.
    function sack(cx, cy, w, h, tilt = 0, under = 0, top = false) {
      const pts = [];
      for (let k = 0; k < 44; k++) {
        const an = (k / 44) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
        const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 0.42), ey = Math.sign(sa) * Math.pow(Math.abs(sa), 0.86);
        const ear = 1 + 0.035 * Math.pow(Math.abs(ca * sa) * 2, 6);
        pts.push(cx + ex * w * ear + ey * h * tilt, cy + ey * h * ear - ex * w * tilt);
      }
      poly(pts, (x, y) => {
        const rx0 = x - cx, ry0 = y - cy, nx = (rx0 + ry0 * -tilt) / w, ny = (ry0 + rx0 * tilt) / h;
        let t = 0.008 + (ny > 0.18 ? (ny - 0.18) * (ny - 0.18) * 1.5 : 0) + nx * nx * nx * nx * nx * nx * 0.24;
        if (ny < -0.66 && under) t += 0.5 * sstep(-0.66, -1, ny);
        if (ny > -0.62 && ny < -0.2 && top) t -= 0.02;
        const q = Math.abs(nx);
        // stitching near each end
        if (q > 0.905 && q < 0.92 && Math.abs(ny) < 0.74 && ((ny * 9 + 40) % 1) < 0.62) t = 1;
        // creases that run in from the corners
        const cr = vn(nx * 3 + cx * 0.01, ny * 8 + cy * 0.01);
        if (q > 0.58) t += sstep(0.58, 0.9, q) * (cr > 0.6 ? 0.2 : 0);
        // a printed panel, as on any bag. No brand: nobody has given us permission to draw one.
        if (q < 0.84 && Math.abs(ny + 0.04 - nx * nx * 0.16) < 0.3) t += 0.13;
        return S(t, (ry0 + nx * nx * h * 0.64 - rx0 * tilt) / (P * 0.92), x / (P * 1.1), (x + y) / P, x, y);
      });
    }
    function tyre(cx, cy, r, hub, lugs) {
      // A real tyre: dark rubber, lugs only at the shoulder, a dished steel rim
      circle(cx, cy, r, r, (x, y) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rn = Math.hypot(dx, dy) / r, an = Math.atan2(dy, dx);
        const af = (an / (Math.PI * 2)) * lugs + 40;
        if (rn < hub) {
          let t = 0.04 + (dx + dy > 0 ? ((dx + dy) / r) * 0.5 : 0);
          const rr0 = rn / hub;
          if (rr0 > 0.9) t += 0.8;
          if (rr0 > 0.34 && rr0 < 0.42) t += 0.5;
          if (rr0 < 0.3) t = 0.18 + (dx - dy > 0 ? 0.3 : 0);
          if (rr0 < 0.1) t = 0.95;
          const bolt = Math.abs(rr0 - 0.56) < 0.05 && Math.abs(((an / (Math.PI * 2)) * 8 + 8) % 1 - 0.5) < 0.12;
          if (bolt) t = 0.96;
          return S(t, (rn * r) / P, (an * rn * r) / P, (x + y) / P, x, y);
        }
        const shoulder = Math.abs((af + rn * 3.4) % 1 - 0.5) < 0.2;
        if (rn > 0.955 && !shoulder) { pl.setA(0); return 0; }
        let t = 0.9 + (dx + dy > 0 ? 0.08 : -0.18);
        // light catches the upper left of the sidewall
        const hl = (-dx - dy) / (r * 1.41);
        if (rn > hub + 0.05 && rn < 0.8 && hl > 0.3) t -= (hl - 0.3) * 0.7;
        if (shoulder && rn > 0.8) t -= 0.42 * (hl > 0 ? 1 : 0.5);
        if (rn > hub && rn < hub + 0.03) t = 0.98;
        return S(t, (rn * r) / (P * 0.82), (an * r) / P, (x - y) / P, x, y);
      });
    }
    // Stone heap and sand heap share the same form
    function heapForm(cx, g, rx, hh, seed) {
      const pts = [];
      for (let k = 0; k <= 34; k++) {
        const xn = k / 17 - 1, b = (fbm(k * 0.26, seed) - 0.5) * 0.3;
        pts.push(cx + xn * rx, g - (1 - Math.pow(Math.abs(xn), 1.6)) * hh * (1 + b * (1 - Math.abs(xn))));
      }
      for (let k = 0; k <= 16; k++) { const xn = 1 - k / 8; pts.push(cx + xn * rx, g + (1 - xn * xn) * H * 0.05); }
      return pts;
    }
    function brickFace(ax, ay, bx, by, hgt, courses, count, light, dark) {
      // one face of a stack, from a to b along the base
      poly([ax, ay, bx, by, bx, by - hgt, ax, ay - hgt], (x, y) => {
        const t2 = (x - ax) / (bx - ax || 1), base = ay + (by - ay) * t2, u = t2 * count, v = (base - y) / (hgt / courses), ro = Math.floor(v), f = v - ro, cu = u + (ro & 1) * 0.5, co = Math.floor(cu), fu = cu - co;
        let t = light + hash(co + 3, ro) * 0.2 + (hash(co, ro + 5) > 0.92 ? 0.24 : 0);
        if (f < 0.09 || fu < 0.035) t = dark;
        return S(t, (y - (by - ay) * t2) / (P * 0.92), x / P, (x + y) / P, x, y);
      });
    }
    if (kind === 'tractor') {
      // A tractor and trolley side on. The machine that carries Patna's balu.
      const g = H * 0.93, ux = W / 100, uy = ux;
      groundShade(W * 0.5, g + 0.4 * uy, W * 0.49, H * 0.05, 0.8);
      // Trolley
      const tx0 = 2 * ux, tx1 = 50 * ux, tTop = g - 23 * uy, tBot = g - 10.4 * uy;
      const hp = [tx0 + ux, tTop + 0.5 * uy];
      for (let k = 0; k <= 26; k++) {
        const t = k / 26, xn = t * 2 - 1;
        hp.push(lerp(tx0 + ux, tx1 - ux, t), tTop - (1 - Math.pow(Math.abs(xn), 2.1)) * 8.4 * uy * (1 + (vn(k * 0.5, 3) - 0.5) * 0.26));
      }
      hp.push(tx1 - ux, tTop + 0.5 * uy);
      poly(hp, (x, y) => {
        const xn = (x - (tx0 + tx1) / 2) / ((tx1 - tx0) / 2), ny = (tTop - y) / (8.4 * uy);
        const t = clamp(0.2 + xn * 0.32 - ny * 0.18 + (vn(x * (2.4 / ux), y * (5 / ux)) - 0.5) * 0.34);
        return grainAt(x, y) < t * 0.92 ? 1 : cov((ny * 8 * uy + xn * xn * 2 * uy) / (P * 1.3), t * 0.42);
      });
      poly([tx0, tTop, tx1, tTop, tx1, tBot, tx0 + 1.2 * ux, tBot], (x, y) => {
        const pk = Math.floor((y - tTop) / (2.5 * uy)), fy = (y - tTop) / (2.5 * uy) - pk, fx = (x - tx0) / ux;
        let t = 0.12 + hash(pk, 12) * 0.14 + (fy < 0.06 ? 0.72 : 0) + (x > tx1 - 6 * ux ? 0.05 : 0);
        t += sstep(tTop, tBot, y) * 0.3;
        // steel uprights
        const up = ((fx + 2.2) % 11.6);
        if (up < 0.9) t = 0.62 + (up > 0.6 ? 0.3 : 0);
        return S(t + vn(x * 0.02, y * 0.08) * 0.08, y / (P * 0.9), x / P, (x + y) / P, x, y);
      });
      // top rail, a chain at the tail, the chassis beam
      poly([tx0 - 0.3 * ux, tTop - 0.6 * uy, tx1 + 0.3 * ux, tTop - 0.6 * uy, tx1 + 0.3 * ux, tTop + 0.5 * uy, tx0 - 0.3 * ux, tTop + 0.5 * uy], (x, y) => S(0.5 + (y - tTop) / uy * 0.3, y / P, x / P, 0, x, y));
      poly([tx0 + 1.2 * ux, tBot, tx1 + 0.4 * ux, tBot, tx1 + 0.4 * ux, tBot + 1.5 * uy, tx0 + 1.2 * ux, tBot + 1.5 * uy], (x, y) => S(0.96, y / P, x / P, (x + y) / P, x, y));
      // drawbar
      poly([tx1 + 0.2 * ux, tBot + 0.3 * uy, 62 * ux, g - 9.6 * uy, 62 * ux, g - 8.5 * uy, tx1 + 0.2 * ux, tBot + 1.3 * uy], (x, y) => S(0.86, y / P, x / P, 0, x, y));
      tyre(18 * ux, g - 5.6 * uy, 5.6 * uy, 0.5, 18);
      tyre(30 * ux, g - 5.6 * uy, 5.6 * uy, 0.5, 18);
      // Bonnet, tapered to the nose with a real grille
      const nose = 98 * ux, hoodTop = g - 20 * uy, hoodBot = g - 9.8 * uy, cowl = 71 * ux;
      poly([cowl, hoodTop - 0.8 * uy, nose - 3.2 * ux, hoodTop + 0.2 * uy, nose, hoodTop + 3 * uy, nose, hoodBot - 0.6 * uy, nose - 3 * ux, hoodBot, cowl, hoodBot], (x, y) => {
        const ny = (y - hoodTop) / (hoodBot - hoodTop), nx = (x - cowl) / (nose - cowl);
        let t = 0.03 + ny * ny * 0.34 + (ny < 0.1 ? 0.2 : 0) + (ny > 0.34 && ny < 0.37 ? 0.5 : 0);
        // side vents, three slits
        if (nx > 0.42 && nx < 0.62 && ny > 0.48 && ny < 0.8 && ((ny * 16) % 1) < 0.42) t = 0.96;
        if (nx > 0.9) { t = 0.4 + (((ny * 12) % 1) < 0.5 ? 0.56 : 0); }
        if (Math.abs(nx - 0.05) < 0.006) t += 0.5;
        return S(t, y / (P * 0.92), x / P, (x + y) / P, x, y);
      });
      // headlamp
      circle(nose - 0.8 * ux, hoodTop + 4.6 * uy, 1.15 * ux, 1.5 * ux, (x, y) => S(0.14 + (x - (nose - 0.8 * ux)) / ux * 0.2, y / P, x / P, 0, x, y));
      // engine block and chassis under the bonnet
      poly([70 * ux, hoodBot, 92 * ux, hoodBot, 91 * ux, g - 6 * uy, 70 * ux, g - 5.6 * uy], (x, y) => S(0.9 + vn(x * 0.05, y * 0.05) * 0.08, y / P, x / P, (x - y) / P, x, y));
      // exhaust stack
      pole(80 * ux, hoodTop, 80.3 * ux, g - 33 * uy, 0.5 * ux, 0.46 * ux, 0.46, 0);
      poly([79.5 * ux, g - 33 * uy, 81.1 * ux, g - 33 * uy, 81 * ux, g - 34.8 * uy, 79.7 * ux, g - 34.8 * uy], (x, y) => S(0.96, y / P, x / P, 0, x, y));
      // steering column and wheel, seen edge on
      pole(70.5 * ux, hoodTop - 0.4 * uy, 67 * ux, g - 26.4 * uy, 0.36 * ux, 0.32 * ux, 0.7, 0);
      poly([64.4 * ux, g - 27.4 * uy, 70 * ux, g - 26.2 * uy, 70 * ux, g - 25.5 * uy, 64.4 * ux, g - 26.7 * uy], (x, y) => S(0.97, y / P, x / P, 0, x, y));
      // seat
      poly([54.4 * ux, g - 20.4 * uy, 60.6 * ux, g - 20.4 * uy, 61 * ux, g - 18.6 * uy, 54.6 * ux, g - 18.6 * uy], (x, y) => S(0.88, y / P, x / P, (x + y) / P, x, y));
      poly([53.4 * ux, g - 27 * uy, 55.6 * ux, g - 27 * uy, 56.6 * ux, g - 20 * uy, 54.6 * ux, g - 20 * uy], (x, y) => S(0.72, y / P, x / P, 0, x, y));
      // The driver: a seated silhouette, gamcha on the head. A shape, not a toy.
      const figT = (x, y) => S(0.92, y / P, x / P, (x + y) / P, x, y);
      poly([55.2 * ux, g - 20.2 * uy, 54.8 * ux, g - 24 * uy, 55.6 * ux, g - 28.4 * uy, 57.4 * ux, g - 31 * uy, 60.4 * ux, g - 31.4 * uy, 62.2 * ux, g - 29.6 * uy, 62.4 * ux, g - 26 * uy, 62 * ux, g - 20.2 * uy], (x, y) => {
        const nx = (x - 58.5 * ux) / (4 * ux);
        return S(nx < -0.3 ? 0.42 : 0.78 + nx * 0.2, y / (P * 0.9), x / P, (x + y) / P, x, y);
      });
      poly([60.4 * ux, g - 30 * uy, 63.4 * ux, g - 28 * uy, 66 * ux, g - 26.6 * uy, 65.6 * ux, g - 25.6 * uy, 62.8 * ux, g - 26.4 * uy, 59.8 * ux, g - 28 * uy], figT);
      poly([57.4 * ux, g - 21.6 * uy, 65.4 * ux, g - 21.8 * uy, 68.4 * ux, g - 14.4 * uy, 66.6 * ux, g - 13.8 * uy, 63.4 * ux, g - 19 * uy, 57.4 * ux, g - 19 * uy], figT);
      circle(60 * ux, g - 33.4 * uy, 1.65 * ux, 1.95 * ux, figT, 18);
      poly([58 * ux, g - 34.4 * uy, 60 * ux, g - 35.7 * uy, 62 * ux, g - 34.6 * uy, 61.8 * ux, g - 33.4 * uy, 58.2 * ux, g - 33.2 * uy], (x, y) => S(0.2, y / P, x / P, 0, x, y));
      poly([57.6 * ux, g - 33.6 * uy, 58.4 * ux, g - 33.8 * uy, 58 * ux, g - 30.6 * uy, 57 * ux, g - 30.8 * uy], (x, y) => S(0.26, y / P, x / P, 0, x, y));
      // Rear wheel and mudguard: the big one
      tyre(62 * ux, g - 10.2 * uy, 10.2 * uy, 0.5, 22);
      const mg = [], mcx = 62 * ux, mcy = g - 10.2 * uy;
      for (let k = 0; k <= 18; k++) { const an = Math.PI * 1.04 + (k / 18) * Math.PI * 0.86; mg.push(mcx + Math.cos(an) * 11.6 * uy, mcy + Math.sin(an) * 11.6 * uy); }
      for (let k = 18; k >= 0; k--) { const an = Math.PI * 1.04 + (k / 18) * Math.PI * 0.86; mg.push(mcx + Math.cos(an) * 10.8 * uy, mcy + Math.sin(an) * 10.8 * uy); }
      poly(mg, (x, y) => S(0.08 + clamp((x - mcx) / (11 * ux)) * 0.5, (x + y) / P, y / P, x / P, x, y));
      tyre(89 * ux, g - 5 * uy, 5 * uy, 0.52, 14);
    } else if (kind === 'cement') {
      groundShade(W * 0.52, H * 0.885, W * 0.49, H * 0.06, 0.82);
      const bw = W * 0.158, bh = H * 0.075, base = H * 0.86, rows = [3, 3, 3, 2, 2, 1];
      const dy = bh * 1.66;
      rows.forEach((n, r) => {
        const off = r % 2 ? bw : 0, left = W * 0.5 - ((n - 1) * bw * 2) / 2;
        for (let c = 0; c < n; c++) {
          const cx = left + c * bw * 2 * 0.985 + (r % 2 && n === 3 ? bw * 0.42 : 0) - (r % 2 && n === 3 ? bw * 0.42 : 0) + (r % 2 ? (c % 2 ? 2 : -2) * s * 0.1 : 0);
          const shift = r % 2 ? bw * 0.5 : -bw * 0.1;
          sack(cx + shift * 0.5 + hash(r, c) * s * 0.7, base - r * dy, bw, bh, (hash(c, r) - 0.5) * (r === rows.length - 1 ? 0.14 : 0.02), r < rows.length - 1 && !(r === 4 && c !== 0) ? 1 : 0, r === rows.length - 1);
        }
      });
    } else if (kind === 'sariya') {
      // A bundle coming at you: the far end converges, the near end shows every cut face.
      srand(19);
      const nx0 = W * 0.12, ny0 = H * 0.66, fx0 = W * 1.04, fy0 = H * 0.2;
      const hex = [];
      for (let row = -2; row <= 2; row++) for (let q = -2; q <= 2; q++) {
        if (Math.abs(row + q) > 2) continue;
        hex.push({ ox: q + row * 0.5, oy: row * 0.86, j: rr(-1, 1), end: rr(-1, 1) });
      }
      hex.sort((a, b) => a.oy - b.oy || a.ox - b.ox);
      const rN = W * 0.021, gap = rN * 2.12;
      {
        const rr0 = gap * 2.2, x0 = nx0 - rr0 * 0.7, y0 = ny0 + rr0 * 0.92, x1 = W, y1 = lerp(ny0, fy0, 0.95) + rr0 * 0.62;
        poly([x0, y0, x1, y1, x1, y1 + rr0 * 0.42, x0 + rr0 * 1.5, y0 + rr0 * 0.74, x0 - rr0 * 0.1, y0 + rr0 * 0.34], (x, y) => {
          const d = (y - lerp(y0, y1, clamp((x - x0) / (x1 - x0)))) / (rr0 * lerp(0.74, 0.42, clamp((x - x0) / (x1 - x0))));
          return grainAt(x * 3, y * 5) < 0.86 * (1 - clamp(d)) ? 1 : 0;
        });
      }
      const rod = (o, t0, t1) => {
        const p = (t) => {
          const sc = lerp(1, 0.5, t), sp = 1 + t * t * 0.34;
          return [lerp(nx0, fx0, t) + o.ox * gap * sc * sp + o.j * t * t * s * 1.2, lerp(ny0, fy0, t) + o.oy * gap * sc * sp + o.end * t * t * s * 0.9];
        };
        const a = p(t0), b = p(t1), ra = rN * lerp(1, 0.5, t0), rb = rN * lerp(1, 0.5, t1);
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
        poly([a[0] + nx * ra, a[1] + ny * ra, b[0] + nx * rb, b[1] + ny * rb, b[0] - nx * rb, b[1] - ny * rb, a[0] - nx * ra, a[1] - ny * ra], (x, y) => {
          const px = x - a[0], py = y - a[1], al = (px * dx + py * dy) / (L * L), rl = lerp(ra, rb, clamp(al)), ac = (px * nx + py * ny) / rl;
          // the ribs of a TMT bar: short slanting cuts on the lit side, and a dark underside
          const ribU = (Math.log(1 + clamp(al) * 1.8) * L) / (rl * 1.25) + ac * 0.34;
          const rib = Math.abs((ribU % 1) - 0.5) < 0.1 && ac < 0.4 && ac > -0.62;
          let t = 0.012 + (ac > 0.1 ? (ac - 0.1) * (ac - 0.1) * 1.4 : 0) + (rib ? 0.3 : 0) + (ac > 0.8 ? 0.6 : 0) + (ac < -0.86 ? 0.5 : 0);
          return S(t, (ac * rl) / (P * 0.74), (al * L) / P, (al * L + ac * rl) / P, x, y);
        });
      };
      const t0 = 0.02;
      for (const o of hex) rod(o, t0 + Math.abs(o.end) * 0.018, 1);
      // two ties of binding wire
      for (const tq of [0.22, 0.58]) {
        const cx = lerp(nx0, fx0, tq), cy = lerp(ny0, fy0, tq), sc = lerp(1, 0.5, tq), rr1 = gap * sc * 2.5;
        for (let w = 0; w < 4; w++) {
          const off = (w - 1.5) * s * 0.26;
          let px = 0, py = 0;
          for (let k = 0; k <= 18; k++) {
            const an = -Math.PI / 2 + (k / 18) * Math.PI;
            const x = cx + off + Math.cos(an) * rr1 * 0.18, y = cy + Math.sin(an) * rr1;
            if (k) stroke(px, py, x, y, Math.max(1, s * 0.18), Math.max(1, s * 0.18), 1, 0.1);
            px = x; py = y;
          }
        }
      }
      // the cut ends
      for (const o of hex) {
        const q = t0 + Math.abs(o.end) * 0.018, sc = lerp(1, 0.5, q), sp = 1 + q * q * 0.34;
        const cx = lerp(nx0, fx0, q) + o.ox * gap * sc * sp, cy = lerp(ny0, fy0, q) + o.oy * gap * sc * sp, r0 = rN * sc;
        circle(cx, cy, r0 * 0.72, r0, (x, y) => {
          const dx = (x - cx) / (r0 * 0.72), dy = (y - cy) / r0;
          return S(0.03 + (dx + dy > 0.2 ? (dx + dy) * 0.42 : 0) + (dx * dx + dy * dy > 0.7 ? 0.9 : 0), (x + y) / P, (x - y) / P, 0, x, y);
        }, 16);
      }
    } else if (kind === 'bricks') {
      const ox = W * 0.55, oy = H * 0.88, ax = -W * 0.42, ay = -H * 0.13, bx = W * 0.36, by = -H * 0.11, hg = H * 0.42;
      // cast shade to the right, flat on the ground
      const sx = W * 0.09, sy = H * 0.02;
      poly([ox, oy, ox + bx, oy + by, ox + bx + sx, oy + by + sy, ox + sx, oy + sy + H * 0.015], (x, y) => {
        const t = 0.72 * (1 - ((x - ox) / (bx + sx)) * 0.5);
        return grainAt(x * 3, y * 5) < t ? 1 : 0;
      });
      groundShade(ox + ax * 0.5, oy - H * 0.04, W * 0.34, H * 0.05, 0.3);
      brickFace(ox + ax, oy + ay, ox, oy, hg, 16, 10, 0.04, 0.9);
      brickFace(ox, oy, ox + bx, oy + by, hg, 16, 5, 0.62, 0.99);
      const topF = (x0, y0, x1, y1, x2, y2, x3, y3, nA, nB) => poly([x0, y0, x1, y1, x2, y2, x3, y3], (x, y) => {
        // bilinear enough: solve in the skew frame of the top face
        const ex = x1 - x0, ey = y1 - y0, fx = x3 - x0, fy = y3 - y0, det = ex * fy - ey * fx, px = x - x0, py = y - y0;
        const a = (px * fy - py * fx) / det, b = (ex * py - ey * px) / det, ua = a * nA, ub = b * nB, q = Math.floor(ub), fu = ua + (q & 1) * 0.5, c = Math.floor(fu);
        let t = 0.03 + hash(c, q) * 0.12;
        if (ub - q < 0.05 || fu - c < 0.03) t = 0.86;
        return S(t, (x * 0.3 + y) / P, x / P, 0, x, y);
      });
      const tx = ox, ty = oy - hg;
      topF(tx + ax, ty + ay, tx, ty, tx + bx, ty + by, tx + ax + bx, ty + ay + by, 10, 10);
      // a smaller course stack on top, the way a half-used pile looks
      const k = 0.5, c2 = 0.22, tx2 = tx + ax * 0.5 + bx * 0.1, ty2 = ty + ay * 0.5 + by * 0.1, hg2 = hg * 0.22;
      brickFace(tx2 + ax * k, ty2 + ay * k, tx2, ty2, hg2, 4, 5, 0.04, 0.9);
      brickFace(tx2, ty2, tx2 + bx * 0.5, ty2 + by * 0.5, hg2, 4, 3, 0.66, 0.99);
      topF(tx2 + ax * k, ty2 + ay * k - hg2, tx2, ty2 - hg2, tx2 + bx * 0.5, ty2 + by * 0.5 - hg2, tx2 + ax * k + bx * 0.5, ty2 + ay * k + by * 0.5 - hg2, 5, 5);
      // a loose brick on the ground
      const lx = W * 0.14, ly = H * 0.93, la = -W * 0.07, lb = W * 0.1;
      poly([lx, ly, lx + lb, ly - H * 0.03, lx + lb, ly - H * 0.075, lx, ly - H * 0.045], (x, y) => S(0.62, x / P, y / P, 0, x, y));
      poly([lx, ly, lx + la, ly - H * 0.02, lx + la, ly - H * 0.065, lx, ly - H * 0.045], (x, y) => S(0.08, y / P, x / P, 0, x, y));
      poly([lx, ly - H * 0.045, lx + lb, ly - H * 0.075, lx + lb + la, ly - H * 0.095, lx + la, ly - H * 0.065], (x, y) => S(0.03, x / P, y / P, 0, x, y));
    } else if (kind === 'balu') {
      const g = H * 0.88, cx = W * 0.5, rx = W * 0.47, hh = H * 0.66;
      groundShade(cx + W * 0.03, g + H * 0.01, rx * 1.04, H * 0.07, 0.72);
      poly(heapForm(cx, g, rx, hh, 1), (x, y) => {
        const nx = (x - cx) / rx, ny = (g - y) / hh;
        const lit = 0.62 - nx * 0.5 + ny * 0.1 + (fbm(x * 0.01, y * 0.024) - 0.5) * 0.26;
        const t = clamp(1 - lit * 1.05);
        const gr = grainAt(x * 3, y * 5) < t * 0.8 ? 1 : 0;
        const ln = cov((ny * hh * (1 + nx * nx * 0.7)) / (P * 1.3) + vn(x * 0.015, y * 0.03) * 1.2, t * 0.5 + 0.03);
        return gr > ln ? gr : ln;
      });
      {
        const f = heapForm(cx, g, rx, hh, 1), q = Math.max(1, s * 0.16);
        for (let k = 0; k < 34; k++) stroke(f[k * 2], f[k * 2 + 1], f[k * 2 + 2], f[k * 2 + 3], q, q, 1, 0.3);
      }
      // the phawda, stuck in where someone left it
      const hx = W * 0.665, hy = H * 0.5;
      pole(hx, hy, W * 0.79, H * 0.1, s * 0.55, s * 0.5, 0.42, 0);
      poly([hx - s * 2.8, hy - s * 0.2, hx + s * 2.6, hy + s * 1, hx + s * 1.8, hy + s * 7, hx - s * 3.4, hy + s * 5.6], (x, y) => {
        const n = (x - hx) / (s * 3);
        return S(0.2 + (n > 0 ? n * 0.6 : 0), (x * 0.2 + y) / P, x / P, (x + y) / P, x, y);
      });
    } else if (kind === 'gitti') {
      const g = H * 0.88, cx = W * 0.5, rx = W * 0.47, hh = H * 0.62;
      groundShade(cx + W * 0.03, g + H * 0.01, rx * 1.04, H * 0.07, 0.8);
      const sz = Math.max(6, W * 0.021);
      poly(heapForm(cx, g, rx, hh, 8), (x, y) => {
        const nx = (x - cx) / rx, ny = (g - y) / hh;
        const lit = 0.62 - nx * 0.52 + ny * 0.14 + (fbm(x * 0.012, y * 0.03) - 0.5) * 0.3;
        const form = clamp(1 - lit * 1.1);
        const wy = worley(x / sz, y / (sz * 0.84)), edgeD = wy[1] - wy[0], id = wy[2];
        if (edgeD < 0.05 + form * 0.05) return S(0.72 + form * 0.26, x / P, y / P, (x + y) / P, x, y);
        const th = id * 6.283, t = clamp(form * 0.78 + (id - 0.5) * 0.34 + 0.04 + (wy[0] > 0.5 ? 0.14 : 0));
        const c = (x * Math.cos(th) + y * Math.sin(th)) / (P * 0.92);
        return S(t, c, (x * Math.cos(th + 1.3) + y * Math.sin(th + 1.3)) / P, 0, x, y);
      });
    } else if (kind === 'tiles') {
      groundShade(W * 0.52, H * 0.9, W * 0.46, H * 0.05, 0.8);
      // A stack of boxed tiles, and one tile leaning on it showing its face
      const bx0 = W * 0.34, by0 = H * 0.86, bdx = W * 0.54, bdy = -H * 0.07, sdx = -W * 0.26, sdy = -H * 0.05, n = 12, th = H * 0.034;
      for (let r = 0; r < n; r++) {
        const y0 = by0 - r * th;
        poly([bx0, y0, bx0 + bdx, y0 + bdy, bx0 + bdx, y0 + bdy - th, bx0, y0 - th], (x, yy) => S((r % 2 ? 0.34 : 0.56) + (x - bx0) / bdx * 0.26, yy / (P * 0.9), x / P, (x + yy) / P, x, yy));
        poly([bx0, y0, bx0 + sdx, y0 + sdy, bx0 + sdx, y0 + sdy - th, bx0, y0 - th], (x, yy) => S(r % 2 ? 0.04 : 0.14, yy / (P * 0.9), x / P, 0, x, yy));
      }
      const ty = by0 - n * th;
      poly([bx0, ty, bx0 + bdx, ty + bdy, bx0 + bdx + sdx, ty + bdy + sdy, bx0 + sdx, ty + sdy], (x, y) => S(0.05, y / P, x / P, 0, x, y));
      // the leaning tile: a square in perspective with a plain inlaid pattern
      const lx0 = W * 0.03, ly0 = H * 0.88, lx1 = W * 0.42, ly1 = H * 0.93, lx2 = W * 0.5, ly2 = H * 0.44, lx3 = W * 0.13, ly3 = H * 0.4;
      poly([lx0, ly0, lx1, ly1, lx1 + W * 0.012, ly1 + H * 0.006, lx0 + W * 0.012, ly0 + H * 0.014], (x, y) => S(0.9, y / P, x / P, 0, x, y));
      poly([lx0, ly0, lx1, ly1, lx2, ly2, lx3, ly3], (x, y) => {
        const ex = lx1 - lx0, ey = ly1 - ly0, fx = lx3 - lx0, fy = ly3 - ly0, det = ex * fy - ey * fx, px = x - lx0, py = y - ly0;
        const a = (px * fy - py * fx) / det, b = (ex * py - ey * px) / det;
        const u = a * 4, v = b * 4, cu = Math.floor(u), cv = Math.floor(v), fu = u - cu, fv = v - cv;
        const diamond = Math.abs(fu - 0.5) + Math.abs(fv - 0.5);
        let t = (cu + cv) & 1 ? (diamond < 0.32 ? 0.74 : 0.08) : (diamond < 0.32 ? 0.08 : 0.5);
        if (a < 0.02 || a > 0.98 || b < 0.02 || b > 0.98) t = 0.9;
        return S(t + vn(x * 0.03, y * 0.03) * 0.05, (x + y) / (P * 1.1), (x - y) / P, x / P, x, y);
      });
    } else if (kind === 'pipes') {
      groundShade(W * 0.5, H * 0.92, W * 0.47, H * 0.05, 0.8);
      const r = W * 0.098, rows = [[0.18, 0.79], [0.39, 0.79], [0.6, 0.79], [0.81, 0.79], [0.285, 0.605], [0.495, 0.605], [0.705, 0.605], [0.39, 0.42], [0.6, 0.42], [0.495, 0.235]];
      for (const [cx0, cy0] of rows) {
        const cx = W * cx0, cy = H * cy0 + (W / H - 1) * 0;
        const ry = r * (W / H) * 1.0 > 0 ? r : r;
        circle(cx, cy, r, ry, (x, y) => {
          const dx = x - cx, dy = y - cy, rn = Math.hypot(dx, dy) / r;
          if (rn > 0.78) {
            const t = 0.03 + (dx + dy > 0 ? ((dx + dy) / r) * 0.3 : 0) + (rn > 0.965 ? 0.8 : 0) + (rn < 0.81 ? 0.7 : 0);
            return S(t, (rn * r) / P, x / P, (x + y) / P, x, y);
          }
          // inside the pipe: darkness that lifts toward the lower right wall
          const inner = clamp((dx + dy) / (r * 1.1));
          const t = 0.97 - inner * inner * 0.55;
          return S(t, y / (P * 0.86), x / P, (x + y) / P, x, y);
        });
      }
    } else if (kind === 'hardware') {
      // A mason's trowel and a brass tap. Things every house needs before it is finished.
      groundShade(W * 0.27, H * 0.92, W * 0.24, H * 0.035, 0.72);
      const ux = W / 100;
      // Trowel, standing on its point against nothing: blade, tang, handle
      const tipx = 27 * ux, tipy = H * 0.92, heelx = 27 * ux, heely = H * 0.36, bw = 15 * ux;
      poly([tipx, tipy, tipx + bw, H * 0.5, tipx + bw * 0.94, H * 0.43, heelx, heely, tipx - bw * 0.94, H * 0.43, tipx - bw, H * 0.5], (x, y) => {
        const n = (x - tipx) / bw, v = (y - heely) / (tipy - heely);
        // a blade catches light on one side of its spine
        let t = n > 0 ? 0.04 + n * 0.5 : 0.01 + (-n > 0.8 ? 0.2 : 0);
        t += vn(x * 0.02, y * 0.06) * 0.05;
        return S(t, (y * 0.9 + x * (n > 0 ? 0.42 : -0.42)) / (P * 0.86), x / P, (x + y) / P, x, y);
      });
      const q = Math.max(1.2, ux * 0.34);
      for (const [a0, b0, a1, b1] of [[tipx, tipy, tipx + bw, H * 0.5], [tipx + bw, H * 0.5, tipx + bw * 0.94, H * 0.43], [tipx + bw * 0.94, H * 0.43, heelx, heely], [heelx, heely, tipx - bw * 0.94, H * 0.43], [tipx - bw * 0.94, H * 0.43, tipx - bw, H * 0.5], [tipx - bw, H * 0.5, tipx, tipy]]) stroke(a0, b0, a1, b1, q, q * 0.8, 1, 0.14);
      stroke(heelx, heely, tipx, H * 0.76, q * 0.8, q * 0.2, 0.9, 0.1);
      pole(heelx, heely, heelx, H * 0.27, ux * 0.8, ux * 0.8, 0.5, 0);
      pole(heelx, H * 0.28, heelx, H * 0.04, ux * 2.1, ux * 2.8, 0.12, 0);
      circle(heelx, H * 0.285, ux * 1.5, ux * 0.62, (x, y) => S(0.72, y / P, x / P, 0, x, y), 18);
      // The tap: a wall nipple, a body, a spindle and a spout, drawn back to front
      const bx = 66 * ux, by = H * 0.4, u = 2.9 * ux, q2 = Math.max(1.1, ux * 0.26);
      const out = (pts) => { for (let k = 0; k < pts.length; k += 2) stroke(pts[k], pts[k + 1], pts[(k + 2) % pts.length], pts[(k + 3) % pts.length], q2, q2, 1, 0.14); };
      const part = (pts, sh) => { poly(pts, sh); out(pts); };
      const ring = (cx, cy, rx, ry, n = 36) => { const r0 = []; for (let k = 0; k < n; k++) { const an = (k / n) * Math.PI * 2; r0.push(cx + Math.cos(an) * rx, cy + Math.sin(an) * ry); } return r0; };
      part([bx - u * 5.2, by + u * 0.2, bx - u * 1.7, by + u * 0.2, bx - u * 1.7, by + u * 2.6, bx - u * 5.2, by + u * 2.6], (x, y) => {
        const n = (y - by - u * 1.4) / (u * 1.2);
        return S(0.04 + (n > 0 ? n * n * 0.9 : n * n * 0.1) + (Math.abs(((x / (u * 0.62)) % 1) - 0.5) < 0.12 ? 0.5 : 0), y / (P * 0.86), x / P, (x + y) / P, x, y);
      });
      part([bx + u * 0.6, by + u * 0.2, bx + u * 7.4, by + u * 2.4, bx + u * 8.2, by + u * 6, bx + u * 5.2, by + u * 6, bx + u * 4.8, by + u * 3.9, bx + u * 0.6, by + u * 2.7], (x, y) => {
        const v = (y - by) / (u * 6);
        return S(0.03 + (v > 0.38 ? (v - 0.38) * 1.0 : 0), y / (P * 0.86), x / P, (x + y) / P, x, y);
      });
      poly([bx + u * 5, by + u * 5.7, bx + u * 8.4, by + u * 5.7, bx + u * 8.4, by + u * 6.5, bx + u * 5, by + u * 6.5], (x, y) => S(0.92, y / P, x / P, 0, x, y));
      part(ring(bx, by + u * 1.4, u * 2.3, u * 2.6), (x, y) => {
        const n = clamp((x - bx) / (u * 2.3), -1, 1), m = clamp((y - by - u * 1.4) / (u * 2.6), -1, 1), l = n * 0.6 + m * 0.8;
        return S(0.02 + (l > 0.1 ? (l - 0.1) * (l - 0.1) * 1.3 : 0), (x * 0.3 + y) / (P * 0.86), x / P, (x + y) / P, x, y);
      });
      part([bx - u * 0.62, by - u * 1, bx - u * 0.62, by - u * 3.6, bx + u * 0.62, by - u * 3.6, bx + u * 0.62, by - u * 1], (x, y) => {
        const n = (x - bx) / (u * 0.62);
        return S(0.03 + (n > 0 ? n * n * 0.7 : 0), y / P, (Math.asin(clamp(n, -1, 1)) * u * 0.62) / (P * 0.8), 0, x, y);
      });
      part([bx - u * 1.1, by - u * 1.2, bx + u * 1.1, by - u * 1.2, bx + u * 1.4, by + u * 0.2, bx - u * 1.4, by + u * 0.2], (x, y) => {
        const n = (x - bx) / (u * 1.4);
        return S(0.05 + (n > 0 ? n * n * 0.8 : 0) + (Math.abs(((x / (u * 0.46)) % 1) - 0.5) < 0.14 ? 0.42 : 0), y / P, x / P, (x + y) / P, x, y);
      });
      part([bx - u * 3.6, by - u * 4.5, bx + u * 3.6, by - u * 4.5, bx + u * 3.6, by - u * 3.5, bx - u * 3.6, by - u * 3.5], (x, y) => {
        const m = (y - by + u * 4) / (u * 0.5);
        return S(0.02 + (m > 0 ? m * m * 0.7 : 0), y / P, x / P, 0, x, y);
      });
      for (const sx of [-1, 1]) part(ring(bx + sx * u * 3.6, by - u * 4, u * 0.86, u * 0.86, 16), (x, y) => {
        const n = (x - bx - sx * u * 3.6) / (u * 0.86);
        return S(0.03 + (n > 0 ? n * n : 0) * 0.9, y / P, x / P, 0, x, y);
      });
      // a drop, about to fall
      const dy0 = by + u * 8.4;
      poly([bx + u * 6.75, dy0 - u * 0.9, bx + u * 7.15, dy0, bx + u * 7.05, dy0 + u * 0.44, bx + u * 6.75, dy0 + u * 0.6, bx + u * 6.45, dy0 + u * 0.44, bx + u * 6.35, dy0], (x, y) => S(0.26 + ((x - bx - u * 6.75) / u) * 0.6, y / P, x / P, 0, x, y));
    } else if (kind === 'pan') {
      // A rope running up out of frame, an iron pan, and one bori sitting in it.
      const cx = W / 2, g = W * 0.42, gy = H - W * 0.34, q = Math.max(1, W * 0.012);
      stroke(cx, 0, cx, gy - g * 1.34, q, q, 1, 0.06);
      for (const sx of [-1, 1]) stroke(cx, gy - g * 1.34, cx + sx * g, gy, q * 0.9, q * 0.9, 1, 0.06);
      // the bori
      const bw = g * 0.8, bh = g * 0.36, by = gy - bh * 0.8;
      const pts = [];
      for (let k = 0; k < 30; k++) {
        const an = (k / 30) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
        pts.push(cx + Math.sign(ca) * Math.pow(Math.abs(ca), 0.34) * bw, by + Math.sign(sa) * Math.pow(Math.abs(sa), 0.62) * bh);
      }
      poly(pts, (x, y) => {
        const nx = (x - cx) / bw, ny = (y - by) / bh;
        return S(0.02 + (ny > 0.1 ? (ny - 0.1) * 1.05 : 0) + nx * nx * nx * nx * 0.5, (y - by + nx * nx * bh * 0.6) / (P * 0.8), x / P, (x + y) / P, x, y);
      });
      poly([cx - g, gy, cx + g, gy, cx + g * 0.68, gy + g * 0.56, cx - g * 0.68, gy + g * 0.56], (x, y) => S(0.66 + ((x - cx) / g) * 0.26, (x - cx) / (P * 0.9), y / P, (x + y) / P, x, y));
      stroke(cx - g, gy, cx + g, gy, q * 1.2, q * 1.2, 1, 0.1);
    } else if (kind === 'plumb') {
      // The mason's plumb bob. A line that cannot lie.
      const bx = W * 0.5, by = H * 0.72;
      stroke(bx, 0, bx, by - H * 0.1, Math.max(1.2, s * 0.3), Math.max(1.2, s * 0.3), 1, 0.05);
      const bw = W * 0.21, capH = H * 0.03;
      poly([bx - bw * 0.36, by - H * 0.105, bx + bw * 0.36, by - H * 0.105, bx + bw * 0.42, by - H * 0.105 + capH, bx - bw * 0.42, by - H * 0.105 + capH], (x, y) => {
        const n = (x - bx) / (bw * 0.42);
        return S(0.2 + (n > 0 ? n * 0.7 : -n * 0.2) + (Math.abs(((x / (s * 2.2)) % 1) - 0.5) < 0.2 ? 0.46 : 0), y / (P * 0.86), x / P, (x + y) / P, x, y);
      });
      poly([bx - bw, by - H * 0.07, bx + bw, by - H * 0.07, bx + bw * 0.9, by + H * 0.02, bx + bw * 0.14, by + H * 0.2, bx, by + H * 0.25, bx - bw * 0.14, by + H * 0.2, bx - bw * 0.9, by + H * 0.02], (x, y) => {
        const n = (x - bx) / bw;
        const t = 0.05 + (n > 0 ? n * n * 0.92 : n * n * 0.2) + ((n < -0.34 && n > -0.52) ? -0.04 : 0);
        return S(t, y / (P * 0.86), (Math.asin(clamp(n, -1, 1)) * bw) / P, (x + y) / P, x, y);
      });
      {
        const q = Math.max(1.1, s * 0.34), o = [bx - bw, by - H * 0.07, bx + bw, by - H * 0.07, bx + bw * 0.9, by + H * 0.02, bx + bw * 0.14, by + H * 0.2, bx, by + H * 0.25, bx - bw * 0.14, by + H * 0.2, bx - bw * 0.9, by + H * 0.02];
        for (let k = 0; k < o.length; k += 2) stroke(o[k], o[k + 1], o[(k + 2) % o.length], o[(k + 3) % o.length], q, q, 1, 0.12);
      }
    } else if (kind.startsWith('sk-')) {
      // Plans for photographs nobody has taken yet: thin pencil lines only.
      const w = Math.max(0.9, s * 0.13), L = (a, b, c, d, wt = 1) => stroke(a * W, b * H, c * W, d * H, w * wt, w * wt, 0.72, 0.18);
      const R = (a, b, c, d, wt) => { L(a, b, c, b, wt); L(c, b, c, d, wt); L(c, d, a, d, wt); L(a, d, a, b, wt); };
      if (kind === 'sk-shop') {
        L(0.06, 0.84, 0.94, 0.84, 1.4);
        R(0.18, 0.16, 0.82, 0.28, 1.2);
        for (let k = 0; k < 3; k++) { const x0 = 0.18 + k * 0.215; R(x0, 0.32, x0 + 0.2, 0.84); for (let q = 1; q < 13; q++) L(x0, 0.32 + q * 0.04, x0 + 0.2, 0.32 + q * 0.04, 0.6); }
        R(0.02, 0.62, 0.16, 0.84); L(0.02, 0.69, 0.16, 0.69); L(0.02, 0.76, 0.16, 0.76); L(0.09, 0.62, 0.09, 0.69); L(0.055, 0.69, 0.055, 0.76); L(0.125, 0.69, 0.125, 0.76);
        R(0.84, 0.7, 0.98, 0.84); L(0.84, 0.77, 0.98, 0.77);
      } else if (kind === 'sk-family') {
        // Nobody draws the family. An architect's cross marks where their picture goes.
        R(0.06, 0.1, 0.94, 0.9, 1.2);
        L(0.06, 0.1, 0.94, 0.9, 0.8);
        L(0.94, 0.1, 0.06, 0.9, 0.8);
      } else if (kind === 'sk-yard') {
        L(0.03, 0.86, 0.97, 0.86, 1.4);
        R(0.08, 0.5, 0.42, 0.86); for (let q = 1; q < 8; q++) L(0.08, 0.5 + q * 0.045, 0.42, 0.5 + q * 0.045, 0.6);
        for (let x = 0.5; x < 0.94; x += 0.15) { R(x, 0.74, x + 0.14, 0.86); }
        for (let x = 0.575; x < 0.8; x += 0.15) { R(x, 0.62, x + 0.14, 0.74); }
        R(0.65, 0.5, 0.79, 0.62);
      } else if (kind === 'sk-tractor') {
        L(0.03, 0.84, 0.97, 0.84, 1.4);
        const circ = (x, y, r) => { let px = x + r, py = y; const asp = W / H; for (let k = 1; k <= 28; k++) { const an = (k / 28) * Math.PI * 2, qx = x + Math.cos(an) * r, qy = y + Math.sin(an) * r * asp; stroke(px * W, py * H, qx * W, qy * H, w, w, 0.72, 0.1); px = qx; py = qy; } };
        circ(0.66, 0.68, 0.085); circ(0.66, 0.68, 0.04); circ(0.89, 0.74, 0.05); circ(0.2, 0.74, 0.05); circ(0.33, 0.74, 0.05);
        R(0.05, 0.42, 0.48, 0.66); L(0.05, 0.42, 0.14, 0.3); L(0.14, 0.3, 0.4, 0.3); L(0.4, 0.3, 0.48, 0.42); L(0.48, 0.62, 0.58, 0.66);
        L(0.72, 0.44, 0.96, 0.46); L(0.96, 0.46, 0.96, 0.66); L(0.96, 0.66, 0.72, 0.66); L(0.72, 0.44, 0.72, 0.66); L(0.8, 0.44, 0.8, 0.22); L(0.72, 0.44, 0.67, 0.3);
      } else if (kind === 'sk-home') {
        L(0.03, 0.88, 0.97, 0.88, 1.4);
        R(0.3, 0.3, 0.7, 0.88, 1.2);
        L(0.3, 0.49, 0.7, 0.49); L(0.3, 0.68, 0.7, 0.68); R(0.36, 0.36, 0.46, 0.45); R(0.54, 0.36, 0.64, 0.45); R(0.36, 0.55, 0.46, 0.64); R(0.54, 0.55, 0.64, 0.64); R(0.45, 0.74, 0.55, 0.88); R(0.34, 0.74, 0.41, 0.82); R(0.59, 0.74, 0.66, 0.82);
        for (const x of [0.32, 0.5, 0.68]) { L(x, 0.3, x, 0.16); L(x, 0.16, x + 0.018, 0.14); }
      }
    }
    return pl;
  }

  // A plan drawing of the finished house: thin lines only. Everything else fills this in.
  function renderGhost(W, H, opts) {
    const pl = createPlate(W, H, { pitch: opts.pitch });
    const K = opts.k, DREF = 30, F = K * DREF;
    const C = { ex: 22.6, ey: opts.eye || 2.3, ez: -24, cos: 0.857, sin: -0.514, cx: opts.cx, hy: opts.hy };
    const pr = (x, y, z) => { const dx = x - C.ex, dz = z - C.ez, xc = dx * C.cos - dz * C.sin, zc = dx * C.sin + dz * C.cos; return [C.cx + (F * xc) / zc, C.hy - (F * (y - C.ey)) / zc, zc]; };
    const v = 1, w = Math.max(0.75, K * 0.0105);
    const L = (x0, y0, z0, x1, y1, z1, wt = 1) => {
      const a = pr(x0, y0, z0), b = pr(x1, y1, z1);
      pl.stroke(a[0], a[1], b[0], b[1], w * wt, w * wt, v, 0.1);
    };
    for (const y of [0.5, 3.8, 7.1, 10.4, 11.5]) {
      L(0, y, 0, HW, y, 0);
      L(HW, y, 0, HW, y, HD);
    }
    for (const x of [0, 3.2, 6.4, 9.6]) L(x, 0.5, 0, x, 11.5, 0, x === 9.6 ? 1.4 : 1);
    for (const z of [4.33, 8.67, 13]) L(HW, 0.5, z, HW, 11.5, z);
    for (let i = 0; i < 3; i++) {
      const b = LV[i];
      for (const [a0, a1] of [[0.95, 2.35], [4.0, 5.6], [7.2, 8.8]]) {
        const y0 = a0 === 4.0 ? b : b + 0.95, y1 = b + 2.35;
        L(a0, y0, 0, a1, y0, 0); L(a0, y1, 0, a1, y1, 0); L(a0, y0, 0, a0, y1, 0); L(a1, y0, 0, a1, y1, 0);
      }
      for (const [a0, a1] of [[1.5, 2.9], [5.9, 7.2], [10.2, 11.5]]) {
        const y0 = b + 0.95, y1 = b + 2.3;
        L(HW, y0, a0, HW, y1, a0); L(HW, y0, a1, HW, y1, a1); L(HW, y0, a0, HW, y0, a1); L(HW, y1, a0, HW, y1, a1);
      }
    }
    // stair room and tank
    const y = 10.4, mx0 = 5.3, mx1 = 9.3, mz0 = 7.4, mz1 = 12.2, mh = 2.75;
    L(mx0, y + 1, mz0, mx0, y + mh, mz0); L(mx1, y + 1, mz0, mx1, y + mh, mz0); L(mx1, y + 1, mz1, mx1, y + mh, mz1);
    L(mx0, y + mh, mz0, mx1, y + mh, mz0); L(mx1, y + mh, mz0, mx1, y + mh, mz1);
    return pl;
  }

  return { renderScene, renderClouds, renderObject, renderGhost, toRGBA };
}
module.exports = { ENGRAVER };
