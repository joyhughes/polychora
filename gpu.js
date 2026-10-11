// GPU ray tracer for the slice view of a combined 4D scene.
// Each pixel's ray through the slice hyperplane is a line in 4D. Every shape turns that line into a list of
// inside intervals (exactly, from its flat cells, or by marching for the tubes), the intervals are combined
// from the top down (add, subtract, intersect), and the surfaces where the result starts and stops are shaded.
// Nothing is meshed, so shapes can move every frame.
(function (root) {
  const P = root.Polychora, O = root.Objects, CSG = root.CSG;
  const T_CONVEX = 1, T_STAR = 2, T_FRAC = 3, T_TORUS = 4, T_HOPF = 5, T_MTN = 6, T_TREE = 7, T_BH = 8;
  const MAXS = 8, TEXW = 2048;
  const DEG = Math.PI / 180;

  // ---------- per-shape data ----------
  // normal of the hyperplane through the origin and three points
  function cross3(u, v, w) {
    const d3 = (i, j, k) => u[i] * (v[j] * w[k] - v[k] * w[j]) - u[j] * (v[i] * w[k] - v[k] * w[i]) + u[k] * (v[i] * w[j] - v[j] * w[i]);
    return [d3(1, 2, 3), -d3(0, 2, 3), d3(0, 1, 3), -d3(0, 1, 2)];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const unit = a => { const l = Math.hypot(...a); return l < 1e-12 ? null : a.map(x => x / l); };
  // a side of the cone from the origin over three points, facing away from a fourth point inside it
  function side(a, b, c, inner) {
    const n = unit(cross3(a, b, c)); if (!n) return null;
    return dot(n, inner) > 0 ? n.map(x => -x) : n;
  }

  // Each record: { type, texels: [[x,y,z,w], …], c1, c2, prm: [4] }. Texel offsets are relative to the shape.
  function polytopeData(id) {
    const T = P.polytope(id);
    if (T.spec.kind !== 'star') {
      const tx = [];
      T.cells.forEach((c, i) => { const h = Math.hypot(...c.center); tx.push(c.center.map(x => x / h), [h, i, 0, 0]); });
      return { type: T_CONVEX, texels: tx, c1: T.cells.length, c2: 0, prm: [0, 0, 0, 0] };
    }
    // star: per cell a header (normal; h, hull start, hull count, tet start; tet count), the cone sides over the
    // cell's convex hull (for culling), then four sides per fan tetrahedron
    const star = T.spec.face === 'pentagram', head = [], hulls = [], tets = [];
    for (const cell of T.cells) {
      const cc = cell.center, h = Math.hypot(...cc), n = cc.map(x => x / h);
      const vi = [...new Set(cell.faces.flatMap(f => T.faces[f]))], vs = vi.map(i => T.verts[i]);
      const hs = hulls.length, seen = new Set();
      for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) for (let c = b + 1; c < vs.length; c++) {
        const m = unit(cross3(vs[a], vs[b], vs[c])); if (!m) continue;
        let pos = 0, neg = 0;
        for (const v of vs) { const d = dot(m, v); if (d > 1e-9) pos++; else if (d < -1e-9) neg++; }
        if (pos && neg) continue;
        const o = neg ? m : m.map(x => -x), key = o.map(x => Math.round(x * 1e6)).join(',');
        if (seen.has(key)) continue;
        seen.add(key); hulls.push(o);
      }
      const ts = tets.length;
      for (const f of cell.faces) {
        const fv = T.faces[f].map(i => T.verts[i]), tris = [];
        if (star) { const fc = [0, 1, 2, 3].map(k => fv.reduce((s, v) => s + v[k], 0) / fv.length); for (let k = 0; k < fv.length; k++) tris.push([fc, fv[k], fv[(k + 1) % fv.length]]); }
        else for (let k = 1; k < fv.length - 1; k++) tris.push([fv[0], fv[k], fv[k + 1]]);
        for (const [p, q, r] of tris) {
          const pts = [cc, p, q, r], centre = [0, 1, 2, 3].map(k => (cc[k] + p[k] + q[k] + r[k]) / 4);
          const sides = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]].map(([i, j, k]) => side(pts[i], pts[j], pts[k], centre));
          if (sides.some(x => !x)) continue;
          tets.push(...sides);
        }
      }
      head.push({ n, h, hs, hc: hulls.length - hs, ts, tc: (tets.length - ts) / 4 });
    }
    // layout: headers (3 texels each), hull sides, tet sides
    const H = head.length * 3, tx = [];
    head.forEach((c, i) => tx.push(c.n, [c.h, H + c.hs, c.hc, H + hulls.length + c.ts], [c.tc, i, 0, 0]));
    tx.push(...hulls, ...tets);
    return { type: T_STAR, texels: tx, c1: head.length, c2: 0, prm: [0, 0, 0, 0] };
  }

  function fractalData(kind, prm) {
    const F = O.FRACTALS[kind], B = P.polytope(F.base), r = F.ratio ? prm.ratio : 1 / 3, maps = F.maps(r), tx = [];
    B.cells.forEach((c, i) => { const h = Math.hypot(...c.center); tx.push(c.center.map(x => x / h), [h, i, 0, 0]); });
    for (const m of maps) tx.push(m.t);
    return { type: T_FRAC, texels: tx, c1: B.cells.length, c2: maps.length, prm: [r, prm.depth, 0, 0] };
  }

  function hopfData(prm, time) {
    const { base } = O.hopfBase(prm, time), tx = [];
    for (const [th, ph] of base) tx.push(O.fibrePoint(th, ph, 0), O.fibrePoint(th, ph, Math.PI / 2));
    return { type: T_HOPF, texels: tx, c1: base.length, c2: 0, prm: [prm.tube, 0, 0, 0] };
  }

  // mountain: a header (N, half-width, floor, summit; sea, snow line), then one height per texel
  function mountainData(prm) {
    const hf = O.mountainHeights(prm), tx = [[hf.N, hf.a, hf.B, hf.top], [hf.sea, hf.snow, 0, 0]];
    for (const h of hf.H) tx.push([h, 0, 0, 0]);
    return { type: T_MTN, texels: tx, c1: hf.N, c2: 0, prm: [hf.N, hf.a, hf.B, hf.top] };
  }

  // tree: eight texels per branch (depth first): base, axis, the three frame vectors, [length, base radius, tip
  // radius, index past its subtree], subtree ball centre, [subtree radius, branch radius, leaf size, level]
  function treeData(prm) {
    const { br, depth } = O.treeData(prm), tx = [];
    for (const b of br) tx.push(b.base, b.a, b.e[0], b.e[1], b.e[2], [b.L, b.r0, b.r1, b.skip], b.sc, [b.sR, b.R, b.leaf, b.level]);
    return { type: T_TREE, texels: tx, c1: br.length, c2: 0, prm: [depth, 0, 0, 0] };
  }

  // black hole: a header (r₊, a, M, depth of the rim; reach, both sheets, shift, table size; steepest |∇r|), then for even steps of the
  // depth w the radius r_w where the space sits at that depth, and dr_w/dw
  function blackHoleData(prm) {
    const G = O.blackHoleShape(prm), N = 512, tx = [[G.rp, G.a, G.M, G.wmax], [G.R, G.both ? 1 : 0, G.shift, N + 1]];
    // the steepest |∇r| anywhere: 1/ρ'(r₊) on the equator at the horizon (1 when a = 0)
    const drho = (G.rp - G.M * G.a * G.a / (G.rp * G.rp)) / G.rho(G.rp);
    tx.push([Math.max(1, 1 / Math.max(1e-3, drho)), 0, 0, 0]);
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const w = G.wmax * i / N;
      while (j < G.NS - 1 && G.W[j + 1] < w) j++;
      const t = G.W[j + 1] > G.W[j] ? Math.min(1, Math.max(0, (w - G.W[j]) / (G.W[j + 1] - G.W[j]))) : 0;
      const sv = G.smax * (j + t) / G.NS, dWds = G.dW[j] + (G.dW[j + 1] - G.dW[j]) * t;
      tx.push([G.rp + sv * sv, Math.min(1e3, 2 * sv / Math.max(1e-9, dWds)), 0, 0]);
    }
    return { type: T_BH, texels: tx, c1: 0, c2: 0, prm: [G.rp, G.R, G.both ? 1 : 0, G.shift] };
  }

  function shapeData(o, prm, time) {
    if (o.kind === 'bh') return blackHoleData(prm);
    if (o.kind === 'chord') {
      // its fibre, as a Hopf tube
      const th = prm.lat * DEG, ph = prm.lon * DEG;
      return { type: T_HOPF, texels: [O.fibrePoint(th, ph, 0), O.fibrePoint(th, ph, Math.PI / 2)], c1: 1, c2: 0, prm: [prm.tube, 0, 0, 0] };
    }
    if (o.kind === 'mtn') return mountainData(prm);
    if (o.kind === 'tree') return treeData(prm);
    if (o.kind === 'poly') return polytopeData(o.id);
    if (o.kind === 'frac') return fractalData(o.id, prm);
    if (o.kind === 'hopf') return hopfData(prm, time);
    // Clifford torus: the points within the tube radius of the torus (or of the shell, if it is thick)
    return { type: T_TORUS, texels: [], c1: 0, c2: 0, prm: [prm.eta * DEG, prm.thick * DEG, prm.tube, 0] };
  }

  // ---------- shader ----------
  const VS = `#version 300 es
  in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS = `#version 300 es
  precision highp float; precision highp int; precision highp sampler2D;
  #define MAXS ${MAXS}
  #define MAXI 12
  #define TEXW ${TEXW}
  uniform sampler2D uData;
  uniform mat4 uInvVP, uView;
  uniform vec2 uRes;
  uniform float uSlice, uOrtho, uMode, uOpacity, uDepthCol, uEdges, uPx;
  uniform vec4 uEdgeCol;
  uniform int uN;
  uniform int uType[MAXS], uOff[MAXS], uC1[MAXS], uC2[MAXS], uOp[MAXS];
  uniform vec4 uPrm[MAXS];
  uniform mat4 uA[MAXS];
  uniform vec4 uB[MAXS];
  uniform vec4 uTint[MAXS];
  uniform float uScl[MAXS];
  out vec4 outCol;

  vec4 tex(int i) { return texelFetch(uData, ivec2(i % TEXW, i / TEXW), 0); }

  // interval lists: R (result so far), S (current shape), U (scratch). Endpoint ids: x = shape << 24 | texel or
  // fibre, y = auxiliary (cell header for star cells)
  float Rt0[MAXI], Rt1[MAXI], St0[MAXI], St1[MAXI], Ut0[MAXI], Ut1[MAXI];
  ivec2 Re0[MAXI], Re1[MAXI], Se0[MAXI], Se1[MAXI], Ue0[MAXI], Ue1[MAXI];
  int Rn, Sn, Un;

  // union an interval into S (sorted, disjoint)
  void addS(float a, float b, ivec2 ea, ivec2 eb) {
    if (!(b > a)) return;
    int i = 0;
    while (i < Sn && St1[i] < a) i++;
    int j = i;
    while (j < Sn && St0[j] <= b) j++;
    // S[i..j-1] overlap [a, b]
    if (i < j) {
      if (St0[i] < a) { a = St0[i]; ea = Se0[i]; }
      if (St1[j - 1] > b) { b = St1[j - 1]; eb = Se1[j - 1]; }
    }
    int removed = j - i, shift = 1 - removed;
    if (shift > 0) { if (Sn >= MAXI) { if (i >= MAXI) return; Sn = MAXI - 1; } for (int k = Sn - 1; k >= j; k--) { St0[k + 1] = St0[k]; St1[k + 1] = St1[k]; Se0[k + 1] = Se0[k]; Se1[k + 1] = Se1[k]; } }
    else if (shift < 0) { for (int k = j; k < Sn; k++) { St0[k + shift] = St0[k]; St1[k + shift] = St1[k]; Se0[k + shift] = Se0[k]; Se1[k + shift] = Se1[k]; } }
    Sn += shift;
    St0[i] = a; St1[i] = b; Se0[i] = ea; Se1[i] = eb;
  }

  // R = R op S  (0 add, 1 subtract, 2 intersect)
  void combine(int op) {
    bool inR = false, inS = false, o = false; int i = 0, j = 0; Un = 0;
    for (int it = 0; it < 4 * MAXI + 4; it++) {
      float tr = i < Rn ? (inR ? Rt1[i] : Rt0[i]) : 1e30, ts = j < Sn ? (inS ? St1[j] : St0[j]) : 1e30;
      if (tr > 1e29 && ts > 1e29) break;
      float t; ivec2 e;
      if (tr <= ts) { t = tr; e = inR ? Re1[i] : Re0[i]; if (inR) i++; inR = !inR; }
      else { t = ts; e = inS ? Se1[j] : Se0[j]; if (inS) j++; inS = !inS; }
      bool v = op == 0 ? (inR || inS) : op == 1 ? (inR && !inS) : (inR && inS);
      if (v != o) {
        if (v) { if (Un < MAXI) { Ut0[Un] = t; Ue0[Un] = e; } }
        else if (Un < MAXI) { Ut1[Un] = t; Ue1[Un] = e; Un++; }
        o = v;
      }
    }
    Rn = Un;
    for (int k = 0; k < MAXI; k++) { if (k >= Rn) break; Rt0[k] = Ut0[k]; Rt1[k] = Ut1[k]; Re0[k] = Ue0[k]; Re1[k] = Ue1[k]; }
  }

  // clip [lo, hi] by the half-space n·y <= h along y = Y0 + t·Yd
  bool clip(vec4 n, float h, vec4 Y0, vec4 Yd, int id, inout float lo, inout float hi, inout int ilo, inout int ihi) {
    float a = dot(n, Y0) - h, b = dot(n, Yd);
    if (abs(b) < 1e-12) return a <= 0.0;
    float t = -a / b;
    if (b > 0.0) { if (t < hi) { hi = t; ihi = id; } } else if (t > lo) { lo = t; ilo = id; }
    return lo < hi;
  }

  // ---- shapes ----
  void convexIv(int k, vec4 Y0, vec4 Yd) {
    float lo = -1e9, hi = 1e9; int ilo = 0, ihi = 0, off = uOff[k];
    for (int c = 0; c < uC1[k]; c++) {
      int ti = off + 2 * c;
      if (!clip(tex(ti), tex(ti + 1).x, Y0, Yd, ti, lo, hi, ilo, ihi)) return;
    }
    addS(lo, hi, ivec2(k << 24 | ilo, 0), ivec2(k << 24 | ihi, 0));
  }

  void starIv(int k, vec4 Y0, vec4 Yd) {
    int off = uOff[k];
    for (int c = 0; c < uC1[k]; c++) {
      int hd = off + 3 * c;
      vec4 n = tex(hd), r1 = tex(hd + 1); float tc = tex(hd + 2).x;
      float lo = -1e9, hi = 1e9; int ilo = 0, ihi = 0;
      if (!clip(n, r1.x, Y0, Yd, hd, lo, hi, ilo, ihi)) continue;
      bool ok = true;
      int hs = off + int(r1.y), hc = int(r1.z);
      for (int q = 0; q < hc; q++) if (!clip(tex(hs + q), 0.0, Y0, Yd, hs + q, lo, hi, ilo, ihi)) { ok = false; break; }
      if (!ok) continue;
      // the hull only culls: each fan tetrahedron's cone is the cell plane plus its own four sides
      lo = -1e9; hi = 1e9; ilo = 0; ihi = 0;
      clip(n, r1.x, Y0, Yd, hd, lo, hi, ilo, ihi);
      int ts = off + int(r1.w);
      for (int q = 0; q < int(tc); q++) {
        float a = lo, b = hi; int ia = ilo, ib = ihi;
        bool hit = true;
        for (int s = 0; s < 4; s++) { int ti = ts + 4 * q + s; if (!clip(tex(ti), 0.0, Y0, Yd, ti, a, b, ia, ib)) { hit = false; break; } }
        if (hit) addS(a, b, ivec2(k << 24 | ia, hd), ivec2(k << 24 | ib, hd));
      }
    }
  }

  // the base polytope scaled by s about o: n·y <= n·o + s·h
  bool fracHull(int k, vec4 o, float s, vec4 Y0, vec4 Yd, out float lo, out float hi, out int ilo, out int ihi) {
    lo = -1e9; hi = 1e9; ilo = 0; ihi = 0;
    int off = uOff[k];
    for (int c = 0; c < uC1[k]; c++) {
      int ti = off + 2 * c; vec4 n = tex(ti);
      if (!clip(n, dot(n, o) + s * tex(ti + 1).x, Y0, Yd, ti, lo, hi, ilo, ihi)) return false;
    }
    return true;
  }
  void fracIv(int k, vec4 Y0, vec4 Yd) {
    float r = uPrm[k].x; int depth = int(uPrm[k].y), nm = uC2[k], mo = uOff[k] + 2 * uC1[k];
    float lo, hi; int ilo, ihi;
    if (!fracHull(k, vec4(0), 1.0, Y0, Yd, lo, hi, ilo, ihi)) return;
    if (depth == 0) { addS(lo, hi, ivec2(k << 24 | ilo, 0), ivec2(k << 24 | ihi, 0)); return; }
    vec4 lo4[7]; float ls[7]; int li[7];
    int lev = 0; lo4[0] = vec4(0); ls[0] = 1.0; li[0] = 0;
    for (int guard = 0; guard < 20000; guard++) {
      if (lev < 0) break;
      if (li[lev] >= nm) { lev--; continue; }
      int m = li[lev]; li[lev] = m + 1;
      vec4 o = lo4[lev] + ls[lev] * tex(mo + m); float s = ls[lev] * r;
      if (!fracHull(k, o, s, Y0, Yd, lo, hi, ilo, ihi)) continue;
      if (lev + 1 >= depth) addS(lo, hi, ivec2(k << 24 | ilo, 0), ivec2(k << 24 | ihi, 0));
      else if (lev < 6) { lev++; lo4[lev] = o; ls[lev] = s; li[lev] = 0; }
    }
  }

  // tubes: distance fields, marched
  float torusD(int k, vec4 y) {
    vec4 p = uPrm[k]; float a = length(y.xy), b = length(y.zw);
    if (p.y <= 0.0) return length(vec2(a - cos(p.x), b - sin(p.x))) - p.z;
    // a shell of angular half-width p.y on the 3-sphere, thickened by the tube radius
    return max(abs(atan(b, a) - p.x) - p.y, abs(length(y) - 1.0)) - p.z;
  }
  float hopfD(int k, vec4 y, out int fi) {
    float best = 1e9; fi = 0; int off = uOff[k]; float yy = dot(y, y);
    for (int f = 0; f < uC1[k]; f++) {
      vec4 a = tex(off + 2 * f), b = tex(off + 2 * f + 1);
      float u = dot(y, a), v = dot(y, b), rho = length(vec2(u, v));
      float d = sqrt(max(0.0, (rho - 1.0) * (rho - 1.0) + yy - rho * rho));
      if (d < best) { best = d; fi = f; }
    }
    return best - uPrm[k].x;
  }
  // the black hole's space: Boyer–Lindquist r of a point solves (x² + z²)/ρ(r)² + y²/r² = 1 (Newton's method), then
  // the distance is, to first order, |w ∓ W(r)| / √(1 + W'(r)²); cut off at the reach and, for one sheet, at w = 0
  float bhR(int k, vec3 p) {
    vec4 h = tex(uOff[k]); float a = h.y, M = h.z, q = dot(p.xz, p.xz), yy = p.y * p.y, r = max(length(p), 1e-4);
    if (a <= 0.0) return r;
    // for r ≥ r* = (Ma²)^⅓, where ρ is smallest, the left side falls as r grows, and at r = |p| it is at most 1
    // (ρ ≥ r), so the root lies in [r*, |p|]; a point with no root there sits inside the horizon, at r*
    float lo = pow(M * a * a, 1.0 / 3.0), hi = max(r, lo);
    for (int i = 0; i < 14; i++) {
      float m = 0.5 * (lo + hi), rho2 = m * m + a * a + 2.0 * M * a * a / m;
      if (q / rho2 + yy / (m * m) > 1.0) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
  }
  float bhD(int k, vec4 y) {
    vec4 h = tex(uOff[k]), h1 = tex(uOff[k] + 1);
    float rp = h.x, a = h.y, M = h.z, wmax = h.w, R = h1.x, w = y.w - h1.z, wa = abs(w);
    int n = int(h1.w);
    float u = clamp(wa / max(wmax, 1e-6), 0.0, 1.0) * float(n - 1);
    int j = min(n - 2, int(floor(u))); float f = u - float(j);
    vec4 A = tex(uOff[k] + 3 + j), B = tex(uOff[k] + 4 + j);
    float rw = mix(A.x, B.x, f), drw = mix(A.y, B.y, f), gmax = tex(uOff[k] + 2).x;
    // The space is r = r_w(|w|) (for a = 0, r = r₊ + w²/(4r₊) exactly). Every point of it lies outside the horizon's
    // spheroid (semi-axes 2M across the spin axis, r₊ along it); inside that, the scaled radius r₊·e stands in for r,
    // meeting r(p) on the spheroid, and equal to |p| when a = 0.
    float q = dot(y.xz, y.xz), yy = y.y * y.y, e = sqrt(q / (4.0 * M * M) + yy / (rp * rp)), r, gr;
    if (e < 1.0) {
      r = rp * e;
      gr = rp * length(vec3(y.x / (4.0 * M * M), y.y / (rp * rp), y.z / (4.0 * M * M))) / max(e, 1e-6);
    } else {
      r = bhR(k, y.xyz); gr = 1.0;
      if (a > 0.0) {
        // the gradient of r(p), from differentiating q/ρ(r)² + y²/r² = 1
        float rho2 = r * r + a * a + 2.0 * M * a * a / r;
        vec3 gp = vec3(2.0 * y.x / rho2, 2.0 * y.y / (r * r), 2.0 * y.z / rho2);
        gr = length(gp) / max(q * (2.0 * r - 2.0 * M * a * a / (r * r)) / (rho2 * rho2) + 2.0 * yy / (r * r * r), 1e-4);
      }
    }
    // steps use the steepest gradient anywhere, so they never overshoot where r changes faster nearer the horizon
    gr = max(gr, gmax);
    float d = abs(r - rw) / sqrt(gr * gr + drw * drw) - 0.008;
    d = max(d, max(r - R, wa - wmax));
    if (h1.y < 0.5) d = max(d, -w);
    return d;
  }
  float tubeD(int k, vec4 y, out int fi) { fi = 0; return uType[k] == ${T_TORUS} ? torusD(k, y) : uType[k] == ${T_BH} ? bhD(k, y) : hopfD(k, y, fi); }
  void tubeIv(int k, vec4 Y0, vec4 Yd) {
    // only inside the ball |y| <= 1.2 that holds the 3-sphere objects
    float A = dot(Yd, Yd), B = dot(Y0, Yd), C = dot(Y0, Y0) - 1.44, D = B * B - A * C;
    if (D <= 0.0 || A < 1e-12) return;
    float sq = sqrt(D), t = (-B - sq) / A, tEnd = (-B + sq) / A, sp = sqrt(A);
    bool inside = false; float tin = t; int fi = 0, fin = 0;
    for (int s = 0; s < 400; s++) {
      if (t > tEnd) break;
      float d = tubeD(k, Y0 + t * Yd, fi);
      if (!inside && d < 1e-4) { inside = true; tin = t; fin = fi; }
      else if (inside && d > 0.0) {
        float a = t - max(abs(d), 1e-3) / sp, b = t; int fj;
        for (int q = 0; q < 8; q++) { float m = 0.5 * (a + b); if (tubeD(k, Y0 + m * Yd, fj) > 0.0) b = m; else a = m; }
        addS(tin, b, ivec2(k << 24 | fin, 0), ivec2(k << 24 | fi, 0)); inside = false;
      }
      t += max(abs(d), 1e-3) / sp;
    }
    if (inside) addS(tin, tEnd, ivec2(k << 24 | fin, 0), ivec2(k << 24 | fi, 0));
  }

  // mountain: ids below MB are surface pieces (grid cube · 8 + Kuhn tetrahedron), MB + 0..6 the sides and floor
  #define MB 16777200
  float mtnH(int k, ivec3 c) { int n1 = int(uPrm[k].x) + 1; return tex(uOff[k] + 2 + (c.x * n1 + c.y) * n1 + c.z).x; }
  int kuhnPerm(vec3 f) { return f.x >= f.y ? (f.y >= f.z ? 0 : f.x >= f.z ? 1 : 4) : (f.x >= f.z ? 2 : f.y >= f.z ? 3 : 5); }
  ivec3 kuhnAxes(int p) { return p == 0 ? ivec3(0, 1, 2) : p == 1 ? ivec3(0, 2, 1) : p == 2 ? ivec3(1, 0, 2) : p == 3 ? ivec3(1, 2, 0) : p == 4 ? ivec3(2, 0, 1) : ivec3(2, 1, 0); }
  // the height on Kuhn tetrahedron p of cube c is h0 + d·f (f: fractional grid coordinates)
  void kuhnLin(int k, ivec3 c, int p, out float h0, out vec3 d) {
    ivec3 ax = kuhnAxes(p), v = c; float a = mtnH(k, v); h0 = a; d = vec3(0);
    for (int r = 0; r < 3; r++) { int q = ax[r]; v[q] += 1; float b = mtnH(k, v); d[q] = b - a; a = b; }
  }
  void mtnIv(int k, vec4 Y0, vec4 Yd) {
    int N = int(uPrm[k].x); float A = uPrm[k].y, B = uPrm[k].z, top = uPrm[k].w;
    float lo = -1e9, hi = 1e9; int ilo = MB, ihi = MB;
    if (!clip(vec4(1, 0, 0, 0), A, Y0, Yd, MB + 1, lo, hi, ilo, ihi) || !clip(vec4(-1, 0, 0, 0), A, Y0, Yd, MB + 2, lo, hi, ilo, ihi)
     || !clip(vec4(0, 0, 1, 0), A, Y0, Yd, MB + 3, lo, hi, ilo, ihi) || !clip(vec4(0, 0, -1, 0), A, Y0, Yd, MB + 4, lo, hi, ilo, ihi)
     || !clip(vec4(0, 0, 0, 1), A, Y0, Yd, MB + 5, lo, hi, ilo, ihi) || !clip(vec4(0, 0, 0, -1), A, Y0, Yd, MB + 6, lo, hi, ilo, ihi)
     || !clip(vec4(0, -1, 0, 0), B, Y0, Yd, MB, lo, hi, ilo, ihi) || !clip(vec4(0, 1, 0, 0), top + 1e-3, Y0, Yd, MB, lo, hi, ilo, ihi)) return;
    // walk the grid cubes the ray's shadow on the ground passes through
    float sc = float(N) / (2.0 * A);
    vec3 g0 = (Y0.xzw + A) * sc, gd = Yd.xzw * sc;
    vec3 gp = g0 + gd * (lo + 1e-5 * (hi - lo));
    ivec3 c = clamp(ivec3(floor(gp)), ivec3(0), ivec3(N - 1)), st = ivec3(sign(gd));
    vec3 tMax, tDel;
    for (int r = 0; r < 3; r++) {
      if (gd[r] > 1e-12) { tMax[r] = (float(c[r] + 1) - g0[r]) / gd[r]; tDel[r] = 1.0 / gd[r]; }
      else if (gd[r] < -1e-12) { tMax[r] = (float(c[r]) - g0[r]) / gd[r]; tDel[r] = -1.0 / gd[r]; }
      else { tMax[r] = 1e30; tDel[r] = 1e30; }
    }
    bool started = false, inside = false; float t = lo, tin = lo; int ein = ilo;
    for (int it = 0; it < 200; it++) {
      float te = min(min(min(tMax.x, tMax.y), tMax.z), hi);
      // where two fractional coordinates swap order, the ray moves to another Kuhn tetrahedron
      float bs[4]; int nb = 0;
      vec3 f0 = g0 - vec3(c);
      for (int i = 0; i < 3; i++) for (int j = i + 1; j < 3; j++) {
        float dd = gd[i] - gd[j];
        if (abs(dd) < 1e-12) continue;
        float tb = -(f0[i] - f0[j]) / dd;
        if (tb > t && tb < te) bs[nb++] = tb;
      }
      for (int i = 0; i < 3; i++) for (int j = 0; j < 2; j++) if (j < nb - 1 && bs[j] > bs[j + 1]) { float x = bs[j]; bs[j] = bs[j + 1]; bs[j + 1] = x; }
      bs[nb] = te;
      float s0 = t;
      for (int q = 0; q < 4; q++) {
        if (q > nb) break;
        float s1 = bs[q];
        if (s1 > s0) {
          int p = kuhnPerm(f0 + gd * (0.5 * (s0 + s1)));
          float h0; vec3 d; kuhnLin(k, c, p, h0, d);
          float a0 = Y0.y + s0 * Yd.y - h0 - dot(d, f0 + gd * s0), a1 = Y0.y + s1 * Yd.y - h0 - dot(d, f0 + gd * s1);
          int id = ((c.x * N + c.y) * N + c.z) * 8 + p;
          if (!started) { started = true; inside = a0 <= 0.0; }
          if (!inside && a1 <= 0.0 && a0 > 0.0) { inside = true; tin = s0 + (s1 - s0) * a0 / (a0 - a1); ein = id; }
          else if (inside && a1 > 0.0) { addS(tin, s0 + (s1 - s0) * a0 / (a0 - a1), ivec2(k << 24 | ein, 0), ivec2(k << 24 | id, 0)); inside = false; }
        }
        s0 = s1;
      }
      if (te >= hi) break;
      int r = tMax.x <= tMax.y && tMax.x <= tMax.z ? 0 : tMax.y <= tMax.z ? 1 : 2;
      c[r] += st[r]; if (c[r] < 0 || c[r] >= N) break;
      tMax[r] += tDel[r]; t = te;
    }
    if (inside) addS(tin, hi, ivec2(k << 24 | ein, 0), ivec2(k << 24 | ihi, 0));
  }
  // tree: the icosahedron's face normals; endpoint ids are branch · 40 + piece (0–19 sides, 20 base, 21 tip, 22–37 leaf)
  const vec3 ICO[20] = vec3[20](${O.ICOSA.normals.map(n => `vec3(${n.map(x => x.toFixed(9)).join(', ')})`).join(', ')});
  bool hitBall(vec4 c, float R, vec4 Y0, vec4 Yd) {
    vec4 d = Y0 - c; float A = dot(Yd, Yd), B = dot(d, Yd), C = dot(d, d) - R * R;
    return B * B - A * C > 0.0;
  }
  void treeIv(int k, vec4 Y0, vec4 Yd) {
    int off = uOff[k], n = uC1[k], i = 0;
    for (int guard = 0; guard < 20000; guard++) {
      if (i >= n) break;
      int b = off + 8 * i;
      vec4 P = tex(b + 5), q = tex(b + 7);
      if (!hitBall(tex(b + 6), q.x, Y0, Yd)) { i = int(P.w); continue; }
      vec4 base = tex(b), a = tex(b + 1);
      if (P.y > 0.0 && hitBall(base + 0.5 * P.x * a, q.y, Y0, Yd)) {
        vec4 e1 = tex(b + 2), e2 = tex(b + 3), e3 = tex(b + 4);
        float lo = -1e9, hi = 1e9; int ilo = 0, ihi = 0, id = i * 40;
        float ab = dot(a, base), kap = (P.z - P.y) / P.x;
        bool ok = clip(-a, -ab, Y0, Yd, id + 20, lo, hi, ilo, ihi) && clip(a, ab + P.x, Y0, Yd, id + 21, lo, hi, ilo, ihi);
        for (int f = 0; f < 20; f++) {
          if (!ok) break;
          vec4 nn = ICO[f].x * e1 + ICO[f].y * e2 + ICO[f].z * e3 - kap * a;
          ok = clip(nn, P.y + dot(nn, base), Y0, Yd, id + f, lo, hi, ilo, ihi);
        }
        if (ok) addS(lo, hi, ivec2(k << 24 | ilo, 0), ivec2(k << 24 | ihi, 0));
      }
      if (q.z > 0.0) {
        vec4 c = base + P.x * a;
        if (hitBall(c, q.z, Y0, Yd)) {
          float lo = -1e9, hi = 1e9; int ilo = 0, ihi = 0; bool ok = true;
          for (int m = 0; m < 16; m++) {
            vec4 sg = vec4((m & 1) != 0 ? -1.0 : 1.0, (m & 2) != 0 ? -1.0 : 1.0, (m & 4) != 0 ? -1.0 : 1.0, (m & 8) != 0 ? -1.0 : 1.0);
            if (!clip(sg, dot(sg, c) + q.z, Y0, Yd, i * 40 + 22 + m, lo, hi, ilo, ihi)) { ok = false; break; }
          }
          if (ok) addS(lo, hi, ivec2(k << 24 | ilo, 0), ivec2(k << 24 | ihi, 0));
        }
      }
      i++;
    }
  }
  vec3 terrainColor(int k, float y, float slope) {
    float sea = tex(uOff[k] + 1).x, snow = tex(uOff[k] + 1).y, top = uPrm[k].w;
    if (y <= sea + 2e-4) return vec3(0.17, 0.4, 0.66);
    float q = (y - sea) / max(1e-6, top - sea), sl = (snow - sea) / max(1e-6, top - sea);
    vec3 sand = vec3(0.8, 0.73, 0.5), grass = vec3(0.33, 0.58, 0.27), forest = vec3(0.18, 0.4, 0.2), rock = vec3(0.5, 0.42, 0.35), scree = vec3(0.6, 0.58, 0.56), snw = vec3(0.93, 0.95, 0.98);
    vec3 col = q < 0.04 ? mix(sand, grass, q / 0.04) : q < 0.3 ? mix(grass, forest, (q - 0.04) / 0.26) : q < sl ? mix(rock, scree, (q - 0.3) / max(1e-6, sl - 0.3)) : snw;
    return q < sl ? mix(col, rock, clamp((slope - 1.2) / 1.2, 0.0, 1.0)) : mix(snw, scree, clamp((slope - 1.8) / 1.5, 0.0, 1.0));
  }

  // ---- colour ----
  vec3 hsl(float h, float s, float l) {
    vec3 n = vec3(0.0, 8.0, 4.0), kk = mod(n + h * 12.0, 12.0); float a = s * min(l, 1.0 - l);
    return l - a * max(vec3(-1.0), min(min(kk - 3.0, 9.0 - kk), vec3(1.0)));
  }
  vec3 hopfColor(vec4 p) {
    p = normalize(p);
    float x = 2.0 * (p.x * p.z + p.y * p.w), y = 2.0 * (p.y * p.z - p.x * p.w), z = p.x * p.x + p.y * p.y - p.z * p.z - p.w * p.w;
    return hsl(fract(atan(y, x) / 6.2831853 + 1.0), 0.62, 0.5 + 0.16 * z);
  }
  vec3 depthColor(float w) {
    float t = clamp((w + 1.0) * 0.5, 0.0, 1.0) * 3.0;
    vec3 c0 = vec3(0.239, 0.306, 0.839), c1 = vec3(0.122, 0.710, 0.690), c2 = vec3(0.949, 0.757, 0.306), c3 = vec3(0.933, 0.365, 0.290);
    return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : mix(c2, c3, t - 2.0);
  }

  vec4 Y0s[MAXS], Yds[MAXS];
  // shade the surface where the result starts or stops at t (endpoint id e); returns colour and an edge weight
  vec4 shadeAt(float t, ivec2 e, vec3 ro, vec3 rd, out float edge) {
    int k = e.x >> 24, idx = e.x & 0xFFFFFF, ty = uType[k];
    vec4 y = Y0s[k] + t * Yds[k], nl, own;
    edge = 0.0;
    if (ty == ${T_TORUS} || ty == ${T_HOPF} || ty == ${T_BH}) {
      int fi; float h = 1e-3;
      nl = vec4(tubeD(k, y + vec4(h, 0, 0, 0), fi) - tubeD(k, y - vec4(h, 0, 0, 0), fi), tubeD(k, y + vec4(0, h, 0, 0), fi) - tubeD(k, y - vec4(0, h, 0, 0), fi),
                tubeD(k, y + vec4(0, 0, h, 0), fi) - tubeD(k, y - vec4(0, 0, h, 0), fi), tubeD(k, y + vec4(0, 0, 0, h), fi) - tubeD(k, y - vec4(0, 0, 0, h), fi));
      if (ty == ${T_HOPF}) { tubeD(k, y, fi); own = vec4(hopfColor(tex(uOff[k] + 2 * fi)), 1.0); }
      else if (ty == ${T_BH}) {
        // the lapse √(ΣΔ/A), as in the mesh, and violet inside the ergosphere
        vec4 h = tex(uOff[k]); float a = h.y, M = h.z, r = max(bhR(k, y.xyz), h.x), c = clamp(y.y / r, -1.0, 1.0);
        float D = r * r - 2.0 * M * r + a * a, S2 = r * r + a * a * c * c, A2 = (r * r + a * a) * (r * r + a * a) - a * a * D * (1.0 - c * c);
        float g = clamp(sqrt(max(0.0, S2 * D / A2)), 0.0, 1.0) * 4.0;
        vec3 c0 = vec3(0.35, 0.05, 0.06), c1 = vec3(0.85, 0.25, 0.1), c2 = vec3(0.96, 0.66, 0.26), c3 = vec3(0.72, 0.8, 0.92), c4 = vec3(0.42, 0.56, 0.9);
        vec3 cc = g < 1.0 ? mix(c0, c1, g) : g < 2.0 ? mix(c1, c2, g - 1.0) : g < 3.0 ? mix(c2, c3, g - 2.0) : mix(c3, c4, g - 3.0);
        if (a > 0.0 && r < M + sqrt(max(0.0, M * M - a * a * c * c))) cc = cc * 0.45 + vec3(0.58, 0.36, 0.92) * 0.55;
        own = vec4(cc, 1.0);
      }
      else {
        float th = atan(y.y, y.x), ph = atan(y.w, y.z);
        own = vec4(hsl(fract(th / 6.2831853 + 1.0), 0.6, mod(floor(fract(ph / 6.2831853 + 1.0) * 8.0), 2.0) > 0.5 ? 0.6 : 0.44), 1.0);
      }
    } else if (ty == ${T_TREE}) {
      int i = idx / 40, f = idx - 40 * i, b = uOff[k] + 8 * i;
      vec4 a = tex(b + 1), P = tex(b + 5);
      if (f < 20) nl = ICO[f].x * tex(b + 2) + ICO[f].y * tex(b + 3) + ICO[f].z * tex(b + 4) - (P.z - P.y) / P.x * a;
      else if (f == 20) nl = -a;
      else if (f == 21) nl = a;
      else { int m = f - 22; nl = vec4((m & 1) != 0 ? -1.0 : 1.0, (m & 2) != 0 ? -1.0 : 1.0, (m & 4) != 0 ? -1.0 : 1.0, (m & 8) != 0 ? -1.0 : 1.0); }
      if (f < 22) { float t = tex(b + 7).w / max(1.0, uPrm[k].x); own = vec4(0.34 + 0.16 * t, 0.24 + 0.2 * t, 0.16 + 0.06 * t, 1.0); }
      else own = vec4(hsl(0.24 + 0.1 * fract(float(i) * 0.6180339), 0.55, 0.36 + 0.12 * fract(float(i) * 0.381966)), 1.0);
    } else if (ty == ${T_MTN}) {
      int N = int(uPrm[k].x); float sc = float(N) / (2.0 * uPrm[k].y);
      if (idx >= MB) {
        int f = idx - MB;
        nl = f == 0 ? vec4(0, -1, 0, 0) : f == 1 ? vec4(1, 0, 0, 0) : f == 2 ? vec4(-1, 0, 0, 0) : f == 3 ? vec4(0, 0, 1, 0) : f == 4 ? vec4(0, 0, -1, 0) : f == 5 ? vec4(0, 0, 0, 1) : vec4(0, 0, 0, -1);
        // the soil of the walls, in layers
        float l = 0.5 + 0.5 * sin(y.y * 38.0);
        own = vec4(mix(vec3(0.3, 0.21, 0.14), vec3(0.47, 0.35, 0.24), (y.y + uPrm[k].z) / (uPrm[k].w + uPrm[k].z)) * (0.85 + 0.15 * l), 1.0);
      } else {
        int cell = idx >> 3, p = idx & 7;
        ivec3 c = ivec3(cell / (N * N), (cell / N) % N, cell % N);
        float h0; vec3 d; kuhnLin(k, c, p, h0, d);
        vec3 g = d * sc;
        nl = vec4(-g.x, 1.0, -g.y, -g.z);
        own = vec4(terrainColor(k, y.y, length(g)), 1.0);
      }
    } else {
      nl = tex(idx);
      own = vec4(hopfColor(ty == ${T_STAR} ? tex(e.y) : nl), 1.0);
      if (ty == ${T_CONVEX} && uEdges > 0.5) {
        // distance to the nearest other cell plane: small near a ridge, which is an edge of the slice
        float best = -1e9;
        for (int c = 0; c < uC1[k]; c++) { int ti = uOff[k] + 2 * c; if (ti == idx) continue; best = max(best, dot(tex(ti), y) - tex(ti + 1).x); }
        // pixel footprint in the shape's own units (uPx is per unit distance in perspective, absolute in orthographic)
        float px = (uOrtho > 0.5 ? uPx : uPx * t) * uScl[k];
        edge = 1.0 - smoothstep(0.6, 1.6, -best / max(1e-6, px));
      }
    }
    vec4 n4 = transpose(uA[k]) * nl; n4 = n4 / max(1e-9, length(n4));
    vec3 col = own.rgb;
    if (uTint[k].a > 0.5) { float l = 0.62 + 0.9 * (dot(col, vec3(0.3, 0.55, 0.15)) - 0.5); col = uTint[k].rgb * l; }
    if (uDepthCol > 0.5) col = depthColor(n4.w);
    // light like the mesh renderer
    vec3 p = ro + t * rd, vV = (uView * vec4(p, 1.0)).xyz, n = normalize(mat3(uView) * n4.xyz);
    vec3 v = uOrtho > 0.5 ? vec3(0, 0, 1) : normalize(-vV);
    if (dot(n, v) < 0.0) n = -n;
    vec3 L = normalize(vec3(-0.45, 0.7, 0.55));
    float d = max(dot(n, L), 0.0), f = max(dot(n, normalize(vec3(0.6, -0.3, 0.75))), 0.0), s = pow(max(dot(n, normalize(L + v)), 0.0), 48.0);
    return vec4(col * (0.30 + 0.62 * d + 0.20 * f) + 0.16 * s, 1.0);
  }

  void main() {
    vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    vec4 a = uInvVP * vec4(ndc, -1.0, 1.0), b = uInvVP * vec4(ndc, 1.0, 1.0);
    vec3 ro = a.xyz / a.w, rd = b.xyz / b.w - ro;
    float L = length(rd); rd /= L;
    Rn = 0;
    for (int k = 0; k < MAXS; k++) {
      if (k >= uN) break;
      Y0s[k] = uA[k] * vec4(ro, uSlice) + uB[k]; Yds[k] = uA[k] * vec4(rd, 0.0);
      Sn = 0;
      int ty = uType[k];
      if (ty == ${T_CONVEX}) convexIv(k, Y0s[k], Yds[k]);
      else if (ty == ${T_STAR}) starIv(k, Y0s[k], Yds[k]);
      else if (ty == ${T_FRAC}) fracIv(k, Y0s[k], Yds[k]);
      else if (ty == ${T_MTN}) mtnIv(k, Y0s[k], Yds[k]);
      else if (ty == ${T_TREE}) treeIv(k, Y0s[k], Yds[k]);
      else tubeIv(k, Y0s[k], Yds[k]);
      combine(k == 0 ? 0 : uOp[k]);
    }
    // walk the surfaces along the ray, front to back
    vec3 acc = vec3(0); float accA = 0.0;
    for (int q = 0; q < 2 * MAXI; q++) {
      int i = q / 2; if (i >= Rn) break;
      float t = (q & 1) == 0 ? Rt0[i] : Rt1[i]; ivec2 e = (q & 1) == 0 ? Re0[i] : Re1[i];
      if (t <= 0.0 || t > L) continue;
      float edge; vec4 c = shadeAt(t, e, ro, rd, edge);
      vec3 rgb = c.rgb; float al;
      if (uMode < 0.5) { rgb = mix(rgb, uEdgeCol.rgb, edge * uEdgeCol.a); al = 1.0; }
      else if (uMode < 1.5) { rgb = mix(rgb, uEdgeCol.rgb, edge * uEdgeCol.a); al = uOpacity; }
      else { rgb = uEdgeCol.rgb; al = max(edge * 0.9, uType[e.x >> 24] == ${T_CONVEX} ? 0.0 : 0.12); }
      acc += (1.0 - accA) * al * rgb; accA += (1.0 - accA) * al;
      if (accA > 0.985) break;
    }
    if (accA <= 0.001) discard;
    outCol = vec4(acc, accA);
  }`;

  function create(gl) {
    const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uData', 'uInvVP', 'uView', 'uRes', 'uSlice', 'uOrtho', 'uMode', 'uOpacity', 'uDepthCol', 'uEdges', 'uPx', 'uEdgeCol', 'uN']) U[n] = gl.getUniformLocation(prog, n);
    for (const n of ['uType', 'uOff', 'uC1', 'uC2', 'uOp', 'uPrm', 'uA', 'uB', 'uTint', 'uScl']) U[n] = gl.getUniformLocation(prog, n + '[0]');
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // a reduced-resolution image is drawn onto the canvas as a texture (blitting into the canvas fails when it is
    // multisampled, which it is with antialiasing on)
    const copyProg = gl.createProgram();
    gl.attachShader(copyProg, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(copyProg, mk(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; uniform sampler2D uImg; uniform vec2 uSize; out vec4 o;
      void main() { o = texture(uImg, gl_FragCoord.xy / uSize); }`));
    gl.linkProgram(copyProg);
    if (!gl.getProgramParameter(copyProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(copyProg));
    const uImg = gl.getUniformLocation(copyProg, 'uImg'), uSize = gl.getUniformLocation(copyProg, 'uSize');
    const texture = gl.createTexture();
    let fbo = null, fboTex = null, fboW = 0, fboH = 0;
    const cache = new Map();
    let packed = null, packKey = '';

    // pack every shape's data into one float texture (only when the shapes' types or parameters change)
    function pack(descs, time) {
      const recs = descs.map(d => {
        const sig = JSON.stringify([d.key, d.prm, d.kind === 'hopf' && d.prm.flow ? time : 0]);
        let c = cache.get(d.id);
        if (!c || c.sig !== sig) { c = { sig, data: shapeData({ kind: d.kind, id: d.oid }, d.prm, time) }; cache.set(d.id, c); }
        return c.data;
      });
      const key = recs.map(r => r.texels.length + ':' + r.type).join('|') + '|' + descs.map(d => cache.get(d.id).sig).join('|');
      if (key === packKey) return packed;
      let total = 0; const offs = recs.map(r => { const o = total; total += r.texels.length; return o; });
      const rows = Math.max(1, Math.ceil(total / TEXW)), arr = new Float32Array(TEXW * rows * 4);
      recs.forEach((r, k) => r.texels.forEach((t, j) => arr.set(t, (offs[k] + j) * 4)));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEXW, rows, 0, gl.RGBA, gl.FLOAT, arr);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      packKey = key; packed = { recs, offs };
      return packed;
    }

    // s: { descs (visible, top to bottom), R, T, slice, view, proj, ortho, mode, opacity, depthCol, edges, edgeCol,
    //      width, height, scale, background, pxAngle, hopfTime }
    function draw(s) {
      const descs = s.descs.slice(0, MAXS), { recs, offs } = pack(descs, s.hopfTime);
      const W = Math.max(1, Math.round(s.width * s.scale)), H = Math.max(1, Math.round(s.height * s.scale));
      const direct = s.scale === 1;
      if (!direct && (!fbo || fboW !== W || fboH !== H)) {
        fbo = fbo || gl.createFramebuffer(); fboTex = fboTex || gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
        fboW = W; fboH = H;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : fbo);
      gl.viewport(0, 0, W, H);
      if (!direct) { const c = s.background; gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(U.uData, 0);
      const VP = mul(s.proj, s.view);
      gl.uniformMatrix4fv(U.uInvVP, false, invert(VP)); gl.uniformMatrix4fv(U.uView, false, s.view);
      gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uSlice, s.slice); gl.uniform1f(U.uOrtho, s.ortho ? 1 : 0);
      gl.uniform1f(U.uMode, s.mode); gl.uniform1f(U.uOpacity, s.opacity); gl.uniform1f(U.uDepthCol, s.depthCol ? 1 : 0);
      gl.uniform1f(U.uEdges, s.edges ? 1 : 0); gl.uniform1f(U.uPx, s.pxAngle / s.scale); gl.uniform4fv(U.uEdgeCol, s.edgeCol);
      gl.uniform1i(U.uN, descs.length);
      const type = [], off = [], c1 = [], c2 = [], op = [], prm = [], A = [], B = [], tint = [], scl = [];
      descs.forEach((d, k) => {
        const r = recs[k], pl = CSG.placement(d.place), { a, b } = affine(s.R, s.T, pl);
        type.push(r.type); off.push(offs[k]); c1.push(r.c1); c2.push(r.c2); op.push(d.op === 'subtract' ? 1 : d.op === 'intersect' ? 2 : 0);
        prm.push(...r.prm); A.push(...a); B.push(...b); scl.push(1 / pl.s);
        const t = CSG.TINTS[d.tint]; tint.push(...(t ? [...t, 1] : [0, 0, 0, 0]));
      });
      gl.uniform1iv(U.uType, padI(type, MAXS)); gl.uniform1iv(U.uOff, padI(off, MAXS)); gl.uniform1iv(U.uC1, padI(c1, MAXS)); gl.uniform1iv(U.uC2, padI(c2, MAXS)); gl.uniform1iv(U.uOp, padI(op, MAXS));
      gl.uniform4fv(U.uPrm, pad(prm, MAXS * 4)); gl.uniformMatrix4fv(U.uA, false, pad(A, MAXS * 16)); gl.uniform4fv(U.uB, pad(B, MAXS * 4));
      gl.uniform4fv(U.uTint, pad(tint, MAXS * 4)); gl.uniform1fv(U.uScl, pad(scl, MAXS));
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, s.width, s.height);
      if (!direct) {
        gl.disable(gl.BLEND);
        gl.useProgram(copyProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.uniform1i(uImg, 0); gl.uniform2f(uSize, s.width, s.height);
        gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
        gl.enable(gl.BLEND);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      return W * H;
    }
    return { draw };
  }

  const pad = (a, n) => { const o = new Float32Array(n); o.set(a.slice(0, n)); return o; };
  const padI = (a, n) => { const o = new Int32Array(n); o.set(a.slice(0, n)); return o; };
  // the view-frame point q maps to the shape's own coordinates as y = A·q + b (column-major mat4 for GLSL)
  function affine(R, T, pl) {
    const Rk = pl.R, s = pl.s, off = pl.off, RR = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let m = 0; m < 4; m++) RR[r * 4 + c] += R[r * 4 + m] * Rk[m * 4 + c];
    // A = RRᵀ / s  (row-major A[r][c] = RR[c][r] / s)
    const Arm = (r, c) => RR[c * 4 + r] / s;
    const a = []; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) a.push(Arm(r, c));
    // b = −A·T − Rkᵀ·off / s
    const b = [0, 1, 2, 3].map(r => -(Arm(r, 0) * T[0] + Arm(r, 1) * T[1] + Arm(r, 2) * T[2] + Arm(r, 3) * T[3]) - (Rk[r] * off[0] + Rk[4 + r] * off[1] + Rk[8 + r] * off[2] + Rk[12 + r] * off[3]) / s);
    return { a, b };
  }
  // column-major 4×4 helpers
  function mul(A, B) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; }
  function invert(m) {
    const inv = new Array(16), [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return inv;
  }

  root.GPU = { create, shapeData, affine };
})(typeof window !== 'undefined' ? window : globalThis);
