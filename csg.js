// Constructive solid geometry in 4D.
// Each solid shape gets a field d(p): negative inside, positive outside, zero on its boundary.
//   convex polytopes  max over cells of (n·p − h)
//   star polytopes    |p| − r(p/|p|): the solid is everything the boundary hides from the centre
//   fractals          the IFS applied to the base polytope's field
// Every boundary is made of flat pieces, so each field can also report the hyperplane it is resting on.
// Surfaces and curves (Clifford torus, Hopf fibres) have no inside: they are clipped but cut nothing.
//
// Shapes combine top to bottom (add = union, subtract, intersect). A boundary element of shape i at p is kept
// exactly when switching shape i on or off changes whether p is in the result. Each mesh is clipped to that
// region: a simplex the cut crosses on one flat piece is cut exactly; one where the cut bends (a ridge of the
// other shape inside it) is first split along the hyperplane of one of those pieces, so cuts stay exact.
(function (root) {
  const Poly = root.Polychora, Obj = root.Objects;
  const BIG = 1e9;
  const PLANES = [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]];
  const DEG = Math.PI / 180;

  // ---------------- fields (in the shape's own coordinates) ----------------
  // f(x0, x1, x2, x3, P?) returns the field; if P (Float64Array(5)) is given it receives the active
  // boundary hyperplane n·x = c as [n0, n1, n2, n3, c].
  function planesOf(T) {
    const m = T.cells.length, n = new Float64Array(m * 4), h = new Float64Array(m);
    T.cells.forEach((c, i) => { const l = Math.hypot(...c.center); h[i] = l; for (let k = 0; k < 4; k++) n[i * 4 + k] = c.center[k] / l; });
    // cells sharing a face are neighbours
    const nb = Array.from({ length: m }, () => []);
    for (const fc of T.faceCells) for (const a of fc) for (const b of fc) if (a !== b && !nb[a].includes(b)) nb[a].push(b);
    return { n, h, m, nb };
  }
  // A regular polytope's cell normals are the vertices of its dual, so the plane maximising n·x is found by
  // climbing from neighbour to neighbour (the simplex method), starting from the last answer.
  function convexField({ n, h, m, nb }) {
    // the tesseract's cells face ±x, ±y, ±z, ±w: its field is just the largest |coordinate| − ½
    if (m === 8 && [...n].every(v => Math.abs(v) < 1e-12 || Math.abs(Math.abs(v) - 1) < 1e-12)) {
      const hh = h[0];
      return (x0, x1, x2, x3, P) => {
        const a0 = Math.abs(x0), a1 = Math.abs(x1), a2 = Math.abs(x2), a3 = Math.abs(x3);
        let k = 0, v = a0; if (a1 > v) { v = a1; k = 1; } if (a2 > v) { v = a2; k = 2; } if (a3 > v) { v = a3; k = 3; }
        if (P) { P[0] = P[1] = P[2] = P[3] = 0; P[k] = (k === 0 ? x0 : k === 1 ? x1 : k === 2 ? x2 : x3) < 0 ? -1 : 1; P[4] = hh; }
        return v - hh;
      };
    }
    // few cells: a plain scan is quickest
    if (m <= 32) return (x0, x1, x2, x3, P) => {
      let best = -Infinity, bi = 0;
      for (let i = 0, o = 0; i < m; i++, o += 4) { const d = n[o] * x0 + n[o + 1] * x1 + n[o + 2] * x2 + n[o + 3] * x3 - h[i]; if (d > best) { best = d; bi = i; } }
      if (P) { P[0] = n[bi * 4]; P[1] = n[bi * 4 + 1]; P[2] = n[bi * 4 + 2]; P[3] = n[bi * 4 + 3]; P[4] = h[bi]; }
      return best;
    };
    let last = 0;
    return (x0, x1, x2, x3, P) => {
      let bi = last, best = n[bi * 4] * x0 + n[bi * 4 + 1] * x1 + n[bi * 4 + 2] * x2 + n[bi * 4 + 3] * x3;
      for (let moved = true; moved;) {
        moved = false;
        for (const j of nb[bi]) { const d = n[j * 4] * x0 + n[j * 4 + 1] * x1 + n[j * 4 + 2] * x2 + n[j * 4 + 3] * x3; if (d > best + 1e-15) { best = d; bi = j; moved = true; } }
      }
      last = bi;
      if (P) { P[0] = n[bi * 4]; P[1] = n[bi * 4 + 1]; P[2] = n[bi * 4 + 2]; P[3] = n[bi * 4 + 3]; P[4] = h[bi]; }
      return best - h[bi];
    };
  }

  // A star polytope's cells, each split into tetrahedra from the cell centre (pentagrams fan from their centre),
  // with a precomputed barycentric solve so a radial ray can be tested against every tetrahedron quickly.
  function starField(T) {
    const star = T.spec.face === 'pentagram', cells = [];
    for (const cell of T.cells) {
      const cc = cell.center, h = Math.hypot(...cc), n = cc.map(x => x / h), tets = [];
      let R2 = 0;
      for (const f of cell.faces) {
        const fv = T.faces[f].map(i => T.verts[i]), tris = [];
        if (star) { const fc = [0, 1, 2, 3].map(k => fv.reduce((s, v) => s + v[k], 0) / fv.length); for (let k = 0; k < fv.length; k++) tris.push([fc, fv[k], fv[(k + 1) % fv.length]]); }
        else for (let k = 1; k < fv.length - 1; k++) tris.push([fv[0], fv[k], fv[k + 1]]);
        for (const t of tris) {
          const E = t.map(v => v.map((x, k) => x - cc[k]));
          for (const e of E) R2 = Math.max(R2, e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3]);
          // M = (EᵀE)⁻¹ Eᵀ, so λ = M (x − cc)
          const g = [0, 1, 2].map(i => [0, 1, 2].map(j => E[i].reduce((s, v, k) => s + v * E[j][k], 0)));
          const det = g[0][0] * (g[1][1] * g[2][2] - g[1][2] * g[2][1]) - g[0][1] * (g[1][0] * g[2][2] - g[1][2] * g[2][0]) + g[0][2] * (g[1][0] * g[2][1] - g[1][1] * g[2][0]);
          if (Math.abs(det) < 1e-14) continue;
          const inv = [
            [g[1][1] * g[2][2] - g[1][2] * g[2][1], g[0][2] * g[2][1] - g[0][1] * g[2][2], g[0][1] * g[1][2] - g[0][2] * g[1][1]],
            [g[1][2] * g[2][0] - g[1][0] * g[2][2], g[0][0] * g[2][2] - g[0][2] * g[2][0], g[0][2] * g[1][0] - g[0][0] * g[1][2]],
            [g[1][0] * g[2][1] - g[1][1] * g[2][0], g[0][1] * g[2][0] - g[0][0] * g[2][1], g[0][0] * g[1][1] - g[0][1] * g[1][0]],
          ].map(r => r.map(v => v / det));
          const M = new Float64Array(12);
          for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) M[i * 4 + k] = inv[i][0] * E[0][k] + inv[i][1] * E[1][k] + inv[i][2] * E[2][k];
          tets.push(M);
        }
      }
      cells.push({ cc, h, n, R2: R2 * 1.0001, tets });
    }
    const EPS = 1e-9;
    return (x0, x1, x2, x3, P) => {
      const r = Math.hypot(x0, x1, x2, x3);
      if (r < 1e-9) return -0.5;
      const u0 = x0 / r, u1 = x1 / r, u2 = x2 / r, u3 = x3 / r;
      let best = 0, bc = null;
      for (const c of cells) {
        const n = c.n, d = n[0] * u0 + n[1] * u1 + n[2] * u2 + n[3] * u3;
        if (d <= 1e-9) continue;
        const t = c.h / d;
        if (t <= best) continue;
        const cc = c.cc, y0 = t * u0 - cc[0], y1 = t * u1 - cc[1], y2 = t * u2 - cc[2], y3 = t * u3 - cc[3];
        if (y0 * y0 + y1 * y1 + y2 * y2 + y3 * y3 > c.R2) continue;
        for (const M of c.tets) {
          const a = M[0] * y0 + M[1] * y1 + M[2] * y2 + M[3] * y3; if (a < -EPS) continue;
          const b = M[4] * y0 + M[5] * y1 + M[6] * y2 + M[7] * y3; if (b < -EPS) continue;
          const e = M[8] * y0 + M[9] * y1 + M[10] * y2 + M[11] * y3; if (e < -EPS || a + b + e > 1 + EPS) continue;
          best = t; bc = c; break;
        }
      }
      if (P && bc) { P[0] = bc.n[0]; P[1] = bc.n[1]; P[2] = bc.n[2]; P[3] = bc.n[3]; P[4] = bc.h; }
      return r - best;
    };
  }

  function fractalField(kind, prm) {
    const F = Obj.FRACTALS[kind], B = Poly.polytope(F.base), r = F.ratio ? prm.ratio : 1 / 3, maps = F.maps(r), base = convexField(planesOf(B));
    const ts = maps.map(m => m.t), inv = 1 / r, depth = prm.depth;
    const f = (x0, x1, x2, x3, d, P) => {
      const fb = base(x0, x1, x2, x3, P);
      if (fb > 0 || d === 0) return fb;
      // descend only into the copies that contain the point; the others' base values bound them from below
      let best = Infinity, bt = null, deep = false;
      for (const t of ts) {
        const y0 = (x0 - t[0]) * inv, y1 = (x1 - t[1]) * inv, y2 = (x2 - t[2]) * inv, y3 = (x3 - t[3]) * inv;
        let v = base(y0, y1, y2, y3) * r, dv = false;
        if (v <= 0) { v = f(y0, y1, y2, y3, d - 1) * r; dv = true; }
        if (v < best) { best = v; bt = t; deep = dv; }
      }
      if (P) {
        // the winning copy's plane, carried back out: n·y = c with y = (x − t)/r  ⇔  n·x = n·t + r c
        const y0 = (x0 - bt[0]) * inv, y1 = (x1 - bt[1]) * inv, y2 = (x2 - bt[2]) * inv, y3 = (x3 - bt[3]) * inv;
        if (deep) f(y0, y1, y2, y3, d - 1, P); else base(y0, y1, y2, y3, P);
        P[4] = P[0] * bt[0] + P[1] * bt[1] + P[2] * bt[2] + P[3] * bt[3] + r * P[4];
      }
      return best;
    };
    return (x0, x1, x2, x3, P) => f(x0, x1, x2, x3, depth, P);
  }

  // { f, lip }: lip is how far the field can understate the distance to its boundary (subdivision safety)
  function field(o, prm) {
    if (o.kind === 'poly') {
      const T = Poly.polytope(o.id);
      return T.spec.kind === 'convex' ? { f: convexField(planesOf(T)), lip: 1 } : { f: starField(T), lip: 3 };
    }
    if (o.kind === 'frac') return { f: fractalField(o.id, prm), lip: 1 };
    return null;
  }

  // ---------------- placement ----------------
  // world = off + s·R·x, with R built from six plane angles in degrees
  function placement(pl) {
    const R = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    PLANES.forEach(([i, j], k) => {
      const a = (pl.rot[k] || 0) * DEG; if (!a) return;
      const c = Math.cos(a), s = Math.sin(a);
      for (let col = 0; col < 4; col++) { const x = R[i * 4 + col], y = R[j * 4 + col]; R[i * 4 + col] = c * x - s * y; R[j * 4 + col] = s * x + c * y; }
    });
    return { R, s: pl.scale, off: pl.off };
  }

  // ---------------- composition ----------------
  const TINTS = { amber: [0.95, 0.72, 0.3], teal: [0.2, 0.74, 0.7], rose: [0.92, 0.42, 0.52], violet: [0.62, 0.52, 0.96], lime: [0.62, 0.86, 0.36], sky: [0.4, 0.66, 0.97], white: [0.86, 0.87, 0.9] };
  function tinter(name) {
    const t = TINTS[name]; if (!t) return null;
    return (c, o) => { const l = 0.62 + 0.9 * ((0.3 * c[o] + 0.55 * c[o + 1] + 0.15 * c[o + 2]) - 0.5); return [t[0] * l, t[1] * l, t[2] * l]; };
  }

  class Out {
    constructor() { this.pts = []; this.tris = []; this.triCol = []; this.triTube = []; this.tets = []; this.tetCol = []; this.tetCtr = []; this.edges = []; this.curves = []; }
    get npts() { return this.pts.length / 4; }
    pt(a, b, c, d) { this.pts.push(a, b, c, d); return this.pts.length / 4 - 1; }
    done(info) {
      return {
        pts: Float64Array.from(this.pts), npts: this.npts, tris: Int32Array.from(this.tris), triCol: Float32Array.from(this.triCol), triTube: Float32Array.from(this.triTube),
        tets: Int32Array.from(this.tets), tetCol: Float32Array.from(this.tetCol), tetCtr: Int32Array.from(this.tetCtr), edges: Int32Array.from(this.edges), curves: this.curves,
        hasTube: this.triTube.some(v => v > 0), info,
      };
    }
  }

  // Split a simplex by a side test (true = side A). cut(a, b) gives the crossing point on edge a→b (a on side A).
  // Tetrahedra: emitA/emitB receive tets, emitCut the cut polygon as triangles.
  function marchTet(v, side, cut, emitA, emitB, emitCut) {
    const A = [], B = [];
    for (let k = 0; k < 4; k++) (side[k] ? A : B).push(v[k]);
    if (A.length === 1 || A.length === 3) {
      const one = A.length === 1, [p] = one ? A : B, rest = one ? B : A;
      const x = rest.map(o => (one ? cut(p, o) : cut(o, p)));
      (one ? emitA : emitB)(p, x[0], x[1], x[2]);
      const [q, r, w] = rest, em = one ? emitB : emitA;
      em(q, r, w, x[0]); em(r, w, x[0], x[1]); em(w, x[0], x[1], x[2]);
      if (emitCut) emitCut(x[0], x[1], x[2]);
    } else {
      const [p, q] = A, [o1, o2] = B, p1 = cut(p, o1), p2 = cut(p, o2), q1 = cut(q, o1), q2 = cut(q, o2);
      emitA(p, p1, p2, q); emitA(p1, p2, q, q1); emitA(p2, q, q1, q2);
      emitB(o1, p1, q1, o2); emitB(p1, q1, o2, p2); emitB(q1, o2, p2, q2);
      if (emitCut) { emitCut(p1, p2, q2); emitCut(p1, q2, q1); }
    }
  }
  // Triangles: emitCut receives the cut segment.
  function marchTri(v, side, cut, emitA, emitB, emitCut) {
    let r = 0; for (; r < 3; r++) if (side[r] !== side[(r + 1) % 3] && side[r] !== side[(r + 2) % 3]) break;
    const p = v[r], q = v[(r + 1) % 3], w = v[(r + 2) % 3], pa = side[r];
    const x1 = pa ? cut(p, q) : cut(q, p), x2 = pa ? cut(p, w) : cut(w, p);
    (pa ? emitA : emitB)(p, x1, x2);
    const em = pa ? emitB : emitA; em(q, w, x2); em(q, x2, x1);
    if (emitCut) emitCut(x1, x2);
  }

  // A grid of simplices (as world-space corner lists) for exact piercing tests: does a d-simplex of another
  // shape cross the inside of this (4 − d)-simplex? Any island of the cut inside a simplex has such a corner.
  // unit normal of the hyperplane through a tetrahedron (4D cross product of its edge vectors)
  function normal4(P) {
    const a = [0, 1, 2, 3].map(k => P[1][k] - P[0][k]), b = [0, 1, 2, 3].map(k => P[2][k] - P[0][k]), c = [0, 1, 2, 3].map(k => P[3][k] - P[0][k]);
    const d3 = (i, j, k) => a[i] * (b[j] * c[k] - b[k] * c[j]) - a[j] * (b[i] * c[k] - b[k] * c[i]) + a[k] * (b[i] * c[j] - b[j] * c[i]);
    const N = [d3(1, 2, 3), -d3(0, 2, 3), d3(0, 1, 3), -d3(0, 1, 2)], l = Math.hypot(...N);
    return l < 1e-14 ? null : N.map(x => x / l);
  }
  function featureIndex(list) {
    const recs = list.map(P => {
      const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
      for (const p of P) for (let k = 0; k < 4; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      return { P, lo, hi, c: lo.map((x, k) => (x + hi[k]) / 2), N: P.length === 4 ? normal4(P) : null };
    });
    // bounding-volume hierarchy: split on the widest axis of the centres until leaves hold a few simplices
    const build = (items) => {
      const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
      for (const r of items) for (let k = 0; k < 4; k++) { lo[k] = Math.min(lo[k], r.lo[k]); hi[k] = Math.max(hi[k], r.hi[k]); }
      if (items.length <= 6) return { lo, hi, items };
      let ax = 0, w = -1;
      for (let k = 0; k < 4; k++) { let a = Infinity, b = -Infinity; for (const r of items) { a = Math.min(a, r.c[k]); b = Math.max(b, r.c[k]); } if (b - a > w) { w = b - a; ax = k; } }
      items.sort((p, q) => p.c[ax] - q.c[ax]);
      const m = items.length >> 1;
      return { lo, hi, a: build(items.slice(0, m)), b: build(items.slice(m)) };
    };
    const root = recs.length ? build(recs) : null;
    const A = new Float64Array(20), sol = new Float64Array(4);
    // solve [e1..ed, −f1..fm] x = q0 − p0 (4×4, partial pivoting); true if solved
    const solve = () => {
      for (let c = 0; c < 4; c++) {
        let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r * 5 + c]) > Math.abs(A[piv * 5 + c])) piv = r;
        if (Math.abs(A[piv * 5 + c]) < 1e-12) return false;
        if (piv !== c) for (let k = 0; k < 5; k++) { const t = A[c * 5 + k]; A[c * 5 + k] = A[piv * 5 + k]; A[piv * 5 + k] = t; }
        for (let r = 0; r < 4; r++) if (r !== c) { const f = A[r * 5 + c] / A[c * 5 + c]; if (f) for (let k = c; k < 5; k++) A[r * 5 + k] -= f * A[c * 5 + k]; }
      }
      for (let r = 0; r < 4; r++) sol[r] = A[r * 5 + 4] / A[r * 5 + r];
      return true;
    };
    // Q: corners of the query simplex; returns a 4D point strictly inside Q where a listed simplex crosses it, or null
    return Q => {
      if (!root) return null;
      const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
      for (const p of Q) for (let k = 0; k < 4; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      const dq = Q.length - 1, QN = dq === 3 ? normal4(Q) : null;
      const test = r => {
        const P = r.P, dm = P.length - 1;
        if (dq + dm !== 4) return null;
        // an edge can only cross a cell's hyperplane if its ends are on opposite sides
        if (QN) { const s0 = (P[0][0] - Q[0][0]) * QN[0] + (P[0][1] - Q[0][1]) * QN[1] + (P[0][2] - Q[0][2]) * QN[2] + (P[0][3] - Q[0][3]) * QN[3], s1 = (P[1][0] - Q[0][0]) * QN[0] + (P[1][1] - Q[0][1]) * QN[1] + (P[1][2] - Q[0][2]) * QN[2] + (P[1][3] - Q[0][3]) * QN[3]; if (s0 * s1 > 0) return null; }
        else if (r.N) { const N = r.N, s0 = (Q[0][0] - P[0][0]) * N[0] + (Q[0][1] - P[0][1]) * N[1] + (Q[0][2] - P[0][2]) * N[2] + (Q[0][3] - P[0][3]) * N[3], s1 = (Q[1][0] - P[0][0]) * N[0] + (Q[1][1] - P[0][1]) * N[1] + (Q[1][2] - P[0][2]) * N[2] + (Q[1][3] - P[0][3]) * N[3]; if (s0 * s1 > 0) return null; }
        for (let row = 0; row < 4; row++) {
          for (let k = 0; k < dq; k++) A[row * 5 + k] = Q[k + 1][row] - Q[0][row];
          for (let k = 0; k < dm; k++) A[row * 5 + dq + k] = -(P[k + 1][row] - P[0][row]);
          A[row * 5 + 4] = P[0][row] - Q[0][row];
        }
        if (!solve()) return null;
        let sq = 0, sp = 0;
        for (let k = 0; k < dq; k++) { if (sol[k] < 1e-7) return null; sq += sol[k]; }
        if (sq > 1 - 1e-7) return null;
        for (let k = dq; k < 4; k++) { if (sol[k] < -1e-9) return null; sp += sol[k]; }
        if (sp > 1 + 1e-9) return null;
        const X = [0, 0, 0, 0];
        for (let row = 0; row < 4; row++) { X[row] = Q[0][row]; for (let k = 0; k < dq; k++) X[row] += sol[k] * (Q[k + 1][row] - Q[0][row]); }
        return X;
      };
      const stack = [root];
      while (stack.length) {
        const nd = stack.pop();
        let skip = false;
        for (let k = 0; k < 4; k++) if (nd.hi[k] < lo[k] - 1e-9 || nd.lo[k] > hi[k] + 1e-9) { skip = true; break; }
        if (skip) continue;
        if (nd.items) { for (const r of nd.items) { let out = false; for (let k = 0; k < 4; k++) if (r.hi[k] < lo[k] - 1e-9 || r.lo[k] > hi[k] + 1e-9) { out = true; break; } if (out) continue; const X = test(r); if (X) return X; } }
        else stack.push(nd.a, nd.b);
      }
      return null;
    };
  }

  // items: [{ mesh, field: {f, lip} | null, place, op, tint }] — visible shapes, top to bottom
  // opt.depth: how many times one simplex may be split while resolving the cut
  // Shapes are combined one at a time, so the running result (with its own cut edges and faces) is what the
  // next shape is clipped against: every corner where boundaries meet is then an actual edge of a mesh.
  // opt.deadline: a Date.now() time after which compose gives up by throwing CSG.TIMEOUT
  function compose(items, opt = {}) {
    const n = items.length, maxDepth = opt.depth ?? 10, deadline = opt.deadline ?? Infinity;
    let ticks = 0;
    const tick = () => { if ((++ticks & 255) === 0 && Date.now() > deadline) throw TIMEOUT; };
    const P = items.map(it => placement(it.place));
    const LP = new Float64Array(5);
    // world-space fields; with W given, also the active hyperplane in world space (N·p = C)
    const wf = items.map((it, k) => {
      if (!it.field) return null;
      const { R, s, off } = P[k], f = it.field.f, is = 1 / s;
      return (p0, p1, p2, p3, W) => {
        const y0 = p0 - off[0], y1 = p1 - off[1], y2 = p2 - off[2], y3 = p3 - off[3];
        const v = s * f((R[0] * y0 + R[4] * y1 + R[8] * y2 + R[12] * y3) * is, (R[1] * y0 + R[5] * y1 + R[9] * y2 + R[13] * y3) * is,
          (R[2] * y0 + R[6] * y1 + R[10] * y2 + R[14] * y3) * is, (R[3] * y0 + R[7] * y1 + R[11] * y2 + R[15] * y3) * is, W ? LP : undefined);
        if (W) {
          for (let r = 0; r < 4; r++) W[r] = R[r * 4] * LP[0] + R[r * 4 + 1] * LP[1] + R[r * 4 + 2] * LP[2] + R[r * 4 + 3] * LP[3];
          W[4] = W[0] * off[0] + W[1] * off[1] + W[2] * off[2] + W[3] * off[3] + s * LP[4];
        }
        return v;
      };
    });
    const ops = items.map((it, k) => (k === 0 ? 'add' : it.op));
    let splits = 0;

    // a shape's mesh in world space, colours resolved
    function worldMesh(k) {
      const it = items[k], M = it.mesh, { R, s, off } = P[k], tint = tinter(it.tint), o = new Out();
      const colour = (arr, at) => (tint ? tint(arr, at) : [arr[at], arr[at + 1], arr[at + 2]]);
      for (let j = 0; j < M.npts; j++) {
        const q = j * 4, x0 = M.pts[q], x1 = M.pts[q + 1], x2 = M.pts[q + 2], x3 = M.pts[q + 3];
        for (let r = 0; r < 4; r++) o.pts.push(off[r] + s * (R[r * 4] * x0 + R[r * 4 + 1] * x1 + R[r * 4 + 2] * x2 + R[r * 4 + 3] * x3));
      }
      const sliceR = (M.sliceTube || 0) * s, tubeR = (M.tubeR || 0.03) * s;
      for (let t = 0; t < M.tris.length / 3; t++) { o.tris.push(M.tris[t * 3], M.tris[t * 3 + 1], M.tris[t * 3 + 2]); o.triCol.push(...colour(M.triCol, t * 3)); o.triTube.push(sliceR); }
      for (let t = 0; t < M.tets.length / 4; t++) { o.tets.push(M.tets[t * 4], M.tets[t * 4 + 1], M.tets[t * 4 + 2], M.tets[t * 4 + 3]); o.tetCol.push(...colour(M.tetCol, t * 3)); o.tetCtr.push(M.tetCtr[t]); }
      for (let e = 0; e < M.edges.length; e++) o.edges.push(M.edges[e]);
      for (const c of M.curves) o.curves.push({ start: c.start, n: c.n, closed: c.closed, col: tint ? colour(c.col, 0) : c.col, r: tubeR });
      return o;
    }
    function copyInto(src, out) {
      const base = out.npts;
      for (const x of src.pts) out.pts.push(x);
      for (const x of src.tris) out.tris.push(base + x);
      for (const x of src.tets) out.tets.push(base + x);
      for (const x of src.edges) out.edges.push(base + x);
      for (const x of src.tetCtr) out.tetCtr.push(x >= 0 ? base + x : -1);
      out.triCol.push(...src.triCol); out.triTube.push(...src.triTube); out.tetCol.push(...src.tetCol);
      for (const c of src.curves) out.curves.push({ ...c, start: base + c.start });
    }

    // Append the parts of src where keep(p) < 0 to out. featSrc: the mesh whose edges, faces and cells
    // bound the region (for exact detection of corners poking into a simplex).
    // region(p) < 0 inside the new result; first: true for the earlier result's pieces (they win ties where
    // a piece lies exactly in the boundary), false for the new shape's.
    function clipPass(M, out, keep, lip, featSrc, region, first) {
      const base = out.npts;
      for (const x of M.pts) out.pts.push(x);
      let sliceR = 0;
      const pushTri = (a, b, c, col) => { if (a === b || b === c || a === c) return; out.tris.push(a, b, c); out.triCol.push(col[0], col[1], col[2]); out.triTube.push(sliceR); };
      const pushTet = (a, b, c, d, col, ctr) => { if (a === b || a === c || a === d || b === c || b === d || c === d) return; out.tets.push(a, b, c, d); out.tetCol.push(col[0], col[1], col[2]); out.tetCtr.push(ctr); };
      const fp = featSrc.pts, corners = (idx, at, m) => { const C = []; for (let k = 0; k < m; k++) { const o = idx[at + k] * 4; C.push([fp[o], fp[o + 1], fp[o + 2], fp[o + 3]]); } return C; };
      const feat = { 4: [], 3: [], 2: [] };
      for (let e = 0; e < featSrc.edges.length; e += 2) feat[4].push(corners(featSrc.edges, e, 2));
      for (let t = 0; t < featSrc.tris.length; t += 3) feat[3].push(corners(featSrc.tris, t, 3));
      for (let t = 0; t < featSrc.tets.length; t += 4) feat[2].push(corners(featSrc.tets, t, 4));
      const pierce = { 4: featureIndex(feat[4]), 3: featureIndex(feat[3]), 2: featureIndex(feat[2]) };
      const simplexPts = vs => vs.map(v => [pts[v * 4], pts[v * 4 + 1], pts[v * 4 + 2], pts[v * 4 + 3]]);
      // a point where another shape's boundary structure crosses this simplex or any of its edges and faces
      // (an island of the cut can enter through any of them); results for shared edges and faces are cached
      const pierceCache = new Map();
      const pierced = sub => {
        let k = null;
        if (sub.length === 2) k = key(sub[0], sub[1]);
        else if (sub.length === 3) { let [x, y, z] = sub; if (x > y) [x, y] = [y, x]; if (y > z) [y, z] = [z, y]; if (x > y) [x, y] = [y, x]; k = x + ',' + y + ',' + z; }
        if (k !== null && pierceCache.has(k)) return pierceCache.get(k);
        const X = pierce[sub.length](simplexPts(sub));
        if (k !== null) pierceCache.set(k, X);
        return X;
      };
      // only structure that is actually on the boundary of the region can make a corner poke in
      const onRegion = X => X && Math.abs(keep(X[0], X[1], X[2], X[3])) <= 1e-7;
      const feature = vs => {
        const m = vs.length;
        if (m === 4) { const X = pierced(vs); if (onRegion(X)) return X; }
        if (m >= 3) for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) for (let c = b + 1; c < m; c++) { if (m === 3 && (a || b !== 1 || c !== 2)) continue; const X = pierced([vs[a], vs[b], vs[c]]); if (onRegion(X)) return X; }
        for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) { const X = pierced([vs[a], vs[b]]); if (onRegion(X)) return X; }
        return null;
      };
      const pts = out.pts, kv = [];
      const val = j => { let v = kv[j]; if (v === undefined) { const o = j * 4; v = kv[j] = keep(pts[o], pts[o + 1], pts[o + 2], pts[o + 3]); } return v; };
      const len2 = (a, b) => { const x = pts[a * 4] - pts[b * 4], y = pts[a * 4 + 1] - pts[b * 4 + 1], z = pts[a * 4 + 2] - pts[b * 4 + 2], w = pts[a * 4 + 3] - pts[b * 4 + 3]; return x * x + y * y + z * z + w * w; };
      const key = (a, b) => (a < b ? a * 67108864 + b : b * 67108864 + a);
      const lerpPt = (a, b, t) => out.pt(pts[a * 4] + (pts[b * 4] - pts[a * 4]) * t, pts[a * 4 + 1] + (pts[b * 4 + 1] - pts[a * 4 + 1]) * t, pts[a * 4 + 2] + (pts[b * 4 + 2] - pts[a * 4 + 2]) * t, pts[a * 4 + 3] + (pts[b * 4 + 3] - pts[a * 4 + 3]) * t);
      const mids = new Map(), cuts = new Map(), pcuts = new Map();
      const mid = (a, b) => { const k = key(a, b); let m = mids.get(k); if (m === undefined) { m = lerpPt(a, b, 0.5); mids.set(k, m); } return m; };
      // where the edge from a kept point a to a dropped point b meets the boundary (bisection on the true field)
      const cut = (a, b) => {
        const k = key(a, b); let m = cuts.get(k);
        if (m !== undefined) return m;
        // an end already on the boundary is the crossing itself
        if (val(b) <= EPS) { cuts.set(k, b); return b; }
        if (val(a) >= -EPS) { cuts.set(k, a); return a; }
        let lo = 0, hi = 1;
        const A = a * 4, B = b * 4;
        for (let s = 0; s < 18; s++) {
          const t = (lo + hi) / 2;
          if (keep(pts[A] + (pts[B] - pts[A]) * t, pts[A + 1] + (pts[B + 1] - pts[A + 1]) * t, pts[A + 2] + (pts[B + 2] - pts[A + 2]) * t, pts[A + 3] + (pts[B + 3] - pts[A + 3]) * t) < 0) lo = t; else hi = t;
        }
        m = lerpPt(a, b, (lo + hi) / 2); kv[m] = -1e-12; cuts.set(k, m);
        return m;
      };
      // splitting by a hyperplane: g(p) = N·p − C, exact linear crossings, shared between neighbours
      const g = (H, j) => H[0] * pts[j * 4] + H[1] * pts[j * 4 + 1] + H[2] * pts[j * 4 + 2] + H[3] * pts[j * 4 + 3] - H[4];
      const planeCut = H => {
        const hk = H.hk;
        return (a, b) => {
          const k = key(a, b) + ':' + hk; let m = pcuts.get(k);
          if (m === undefined) {
            const ga = g(H, a), gb = g(H, b), t = ga / (ga - gb);
            m = t < 1e-9 ? a : t > 1 - 1e-9 ? b : lerpPt(a, b, t); pcuts.set(k, m);
          }
          return m;
        };
      };
      const W = new Float64Array(5);
      const planeAtXY = (x0, x1, x2, x3) => {
        keep(x0, x1, x2, x3, W);
        if (!(W[4] === W[4])) return null;
        const H = Array.from(W); H.hk = H.map(x => Math.round(x * 1e7)).join(',');
        return H;
      };
      const planeAt = j => planeAtXY(pts[j * 4], pts[j * 4 + 1], pts[j * 4 + 2], pts[j * 4 + 3]);
      const sameSide = (vs, H) => { let pos = 0, neg = 0; for (const v of vs) { const x = g(H, v); if (x > 1e-10) pos++; else if (x < -1e-10) neg++; } return !(pos && neg); };
      const X = new Float64Array(4);
      const at = (vs, w) => {
        let x0 = 0, x1 = 0, x2 = 0, x3 = 0;
        for (let k = 0; k < vs.length; k++) { const o = vs[k] * 4; x0 += pts[o] * w[k]; x1 += pts[o + 1] * w[k]; x2 += pts[o + 2] * w[k]; x3 += pts[o + 3] * w[k]; }
        X[0] = x0; X[1] = x1; X[2] = x2; X[3] = x3;
        return keep(x0, x1, x2, x3);
      };
      const EPS = 1e-9, CENTRE = { 2: [0.5, 0.5], 3: [1 / 3, 1 / 3, 1 / 3], 4: [0.25, 0.25, 0.25, 0.25] };
      const PROBES = { 2: [[0.5, 0.5]], 3: [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]], 4: [[0.25, 0.25, 0.25, 0.25], [0.5, 0.5, 0, 0], [0.5, 0, 0.5, 0], [0.5, 0, 0, 0.5], [0, 0.5, 0.5, 0], [0, 0.5, 0, 0.5], [0, 0, 0.5, 0.5]] };

      // A boundary hyperplane through (or right beside) X that separates the simplex's corners. X is often on a ridge
      // where several facets meet, so look just beside it too, towards the centre and each corner; else halve.
      const splitPlaneNear = (vs, Xp) => {
        const H = planeAtXY(Xp[0], Xp[1], Xp[2], Xp[3]);
        if (H && !sameSide(vs, H)) return H;
        const targets = [CENTRE[vs.length].map((w, k) => w), ...vs.map((_, k) => vs.map((__, j) => (j === k ? 1 : 0)))];
        for (const w of targets) {
          let y0 = 0, y1 = 0, y2 = 0, y3 = 0;
          for (let k = 0; k < vs.length; k++) { const o = vs[k] * 4; y0 += pts[o] * w[k]; y1 += pts[o + 1] * w[k]; y2 += pts[o + 2] * w[k]; y3 += pts[o + 3] * w[k]; }
          const e = 1e-4, Hy = planeAtXY(Xp[0] + e * (y0 - Xp[0]), Xp[1] + e * (y1 - Xp[1]), Xp[2] + e * (y2 - Xp[2]), Xp[3] + e * (y3 - Xp[3]));
          if (Hy && !sameSide(vs, Hy)) return Hy;
        }
        for (const v of vs) { const Hv = planeAt(v); if (Hv && !sameSide(vs, Hv)) return Hv; }
        return 'mid';
      };

      // Is the region really different just beside X inside this simplex? (expect(p) gives the sign a point
      // should have if nothing pokes in.) Points are nudged from X towards the centre and each corner.
      const pokes = (vs, Xp, expectIn) => {
        const m = vs.length, targets = [CENTRE[m], ...vs.map((_, k) => vs.map((__, j) => (j === k ? 1 : 0)))];
        for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) targets.push(vs.map((_, j) => (j === a || j === b ? 0.5 : 0)));
        for (const w of targets) {
          let y0 = 0, y1 = 0, y2 = 0, y3 = 0;
          for (let k = 0; k < vs.length; k++) { const o = vs[k] * 4; y0 += pts[o] * w[k]; y1 += pts[o + 1] * w[k]; y2 += pts[o + 2] * w[k]; y3 += pts[o + 3] * w[k]; }
          for (const e of [1e-3, 0.01, 0.05, 0.2, 0.5]) {
            const z0 = Xp[0] + e * (y0 - Xp[0]), z1 = Xp[1] + e * (y1 - Xp[1]), z2 = Xp[2] + e * (y2 - Xp[2]), z3 = Xp[3] + e * (y3 - Xp[3]);
            const v = keep(z0, z1, z2, z3), ex = expectIn(z0, z1, z2, z3);
            if (ex ? v > EPS : v < -EPS) return true;
          }
        }
        return false;
      };

      // A piece lying exactly in the boundary (shapes sharing a face): the earlier result keeps its piece when exactly
      // one side of it is inside the new result; the new shape's matching piece is dropped, so the face appears once.
      const coincident = vs => {
        if (!first) return 'none';
        if (vs.length < 4) return 'all';
        const Q = simplexPts(vs), N = normal4(Q);
        if (!N) return 'none';
        const c = [0, 1, 2, 3].map(k => (Q[0][k] + Q[1][k] + Q[2][k] + Q[3][k]) / 4), d = 1e-6;
        const a = region(c[0] + d * N[0], c[1] + d * N[1], c[2] + d * N[2], c[3] + d * N[3]) < 0, b = region(c[0] - d * N[0], c[1] - d * N[1], c[2] - d * N[2], c[3] - d * N[3]) < 0;
        return a !== b ? 'all' : 'none';
      };

      // decide what to do with a simplex: 'all' | 'none' | 'mid' (halve it) | 'cut' (march) | a hyperplane to split by
      const classify = (vs, depth) => {
        tick();
        let nin = 0, nout = 0, minAbs = Infinity, maxL = 0;
        for (const v of vs) { const x = val(v); if (x < -EPS) nin++; else if (x > EPS) nout++; minAbs = Math.min(minAbs, Math.abs(x)); }
        if (!nin || !nout) {
          let inside = nin > 0;
          if (!nin && !nout) {
            // every corner is on the boundary: the piece either bulges off it (a probe says which way) or lies in it
            let offV = null;
            for (const w of [CENTRE[vs.length], ...PROBES[vs.length]]) { const x = at(vs, w); if (Math.abs(x) > EPS) { offV = x; break; } }
            if (offV === null) return coincident(vs);
            inside = offV < 0;
          }
          if (depth >= maxDepth) return inside ? 'all' : 'none';
          for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) maxL = Math.max(maxL, len2(vs[a], vs[b]));
          if (minAbs > lip * Math.sqrt(maxL)) return inside ? 'all' : 'none';
          // the boundary is close: a corner of another shape inside this simplex means the cut may poke in
          const Xf = feature(vs);
          if (Xf) {
            // split along a boundary plane there; halve only if the region really pokes in and no plane separates
            const H = splitPlaneNear(vs, Xf);
            if (H !== 'mid' || pokes(vs, Xf, () => inside)) return H;
          }
          for (const w of PROBES[vs.length]) {
            const x = at(vs, w);
            if (inside ? x <= EPS : x >= -EPS) continue;
            // split along the plane of the piece that pokes in (found at the probe), else halve
            return splitPlaneNear(vs, [X[0], X[1], X[2], X[3]]);
          }
          return inside ? 'all' : 'none';
        }
        if (depth >= maxDepth) return 'cut';
        for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) maxL = Math.max(maxL, len2(vs[a], vs[b]));
        maxL = Math.sqrt(maxL);
        // the cut's corners: crossings on edges from inside to outside, plus vertices already on the boundary
        const cs = [];
        for (const v of vs) if (Math.abs(val(v)) <= EPS) cs.push(v);
        for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) {
          const va = val(vs[a]), vb = val(vs[b]);
          if (va < -EPS && vb > EPS) cs.push(cut(vs[a], vs[b])); else if (vb < -EPS && va > EPS) cs.push(cut(vs[b], vs[a]));
        }
        const planes = cs.map(planeAt);
        // if one boundary hyperplane holds every corner (and nothing pokes into the middle), the cut is exact
        for (const H of planes) {
          if (!H || !cs.every(c => Math.abs(g(H, c)) < 1e-7)) continue;
          if (Math.abs(at(cs, cs.map(() => 1 / cs.length))) > 1e-6 + 1e-4 * maxL) break;
          // a planar cut, unless another shape's corner sits inside this simplex
          const Xf = feature(vs);
          if (Xf) {
            // on the planar cut, the kept side is the side of the kept corners
            const vin = vs.find(v => val(v) < -EPS), sIn = g(H, vin) < 0;
            const expect = (z0, z1, z2, z3) => (H[0] * z0 + H[1] * z1 + H[2] * z2 + H[3] * z3 - H[4] < 0) === sIn;
            if (pokes(vs, Xf, expect)) return splitPlaneNear(vs, Xf);
          }
          return 'cut';
        }
        for (const H of planes) if (H && !sameSide(vs, H)) return H;
        return 'mid';
      };

      // A kept piece whose face lies on the boundary of the result: that face is part of the cut, so it is a new face
      // of the combined shape (likewise for the edges of kept pieces of faces).
      const onB = v => Math.abs(val(v)) <= EPS;
      const TRI_C = [1 / 3, 1 / 3, 1 / 3];
      const capFaces = (a, b, c, d, col) => {
        const on = [onB(a), onB(b), onB(c), onB(d)];
        if (on[0] + on[1] + on[2] + on[3] < 3) return;
        const v = [a, b, c, d];
        for (let k = 0; k < 4; k++) {
          const f = v.filter((_, j) => j !== k);
          if (on.every((o, j) => j === k || o) && Math.abs(at(f, TRI_C)) <= 1e-7) pushTri(f[0], f[1], f[2], col);
        }
      };
      const capEdges = (a, b, c) => {
        const v = [a, b, c];
        for (let k = 0; k < 3; k++) { const p = v[k], q = v[(k + 1) % 3]; if (onB(p) && onB(q) && Math.abs(at([p, q], [0.5, 0.5])) <= 1e-7) out.edges.push(p, q); }
      };

      // ---- tetrahedra ----
      const clipTet = (a, b, c, d, col, ctr, depth) => {
        if (a === b || a === c || a === d || b === c || b === d || c === d) return;
        const cl = classify([a, b, c, d], depth);
        if (cl === 'none') return;
        if (cl === 'all') { pushTet(a, b, c, d, col, ctr); if (depth) capFaces(a, b, c, d, col); return; }
        const e = depth + 1;
        if (cl === 'mid') {
          const ab = mid(a, b), ac = mid(a, c), ad = mid(a, d), bc = mid(b, c), bd = mid(b, d), cd = mid(c, d);
          clipTet(a, ab, ac, ad, col, ctr, e); clipTet(ab, b, bc, bd, col, ctr, e); clipTet(ac, bc, c, cd, col, ctr, e); clipTet(ad, bd, cd, d, col, ctr, e);
          clipTet(ac, bd, ab, bc, col, ctr, e); clipTet(ac, bd, bc, cd, col, ctr, e); clipTet(ac, bd, cd, ad, col, ctr, e); clipTet(ac, bd, ad, ab, col, ctr, e);
          return;
        }
        const v = [a, b, c, d];
        if (cl === 'cut') {
          marchTet(v, v.map(x => val(x) < -EPS), cut, (p, q, r, w) => pushTet(p, q, r, w, col, ctr), () => {}, (p, q, r) => pushTri(p, q, r, col));
          return;
        }
        splits++;
        const sub = (p, q, r, w) => clipTet(p, q, r, w, col, ctr, e);
        marchTet(v, v.map(x => g(cl, x) < 0), planeCut(cl), sub, sub);
      };
      // ---- triangles (faces); their cut edges become new edges ----
      const clipTri = (a, b, c, col, depth) => {
        if (a === b || b === c || a === c) return;
        const cl = classify([a, b, c], depth);
        if (cl === 'none') return;
        if (cl === 'all') { pushTri(a, b, c, col); if (depth) capEdges(a, b, c); return; }
        const e = depth + 1;
        if (cl === 'mid') {
          const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
          clipTri(a, ab, ca, col, e); clipTri(ab, b, bc, col, e); clipTri(ca, bc, c, col, e); clipTri(ab, bc, ca, col, e);
          return;
        }
        const v = [a, b, c];
        if (cl === 'cut') {
          marchTri(v, v.map(x => val(x) < -EPS), cut, (p, q, r) => pushTri(p, q, r, col), () => {}, (p, q) => { if (p !== q) out.edges.push(p, q); });
          return;
        }
        const sub = (p, q, r) => clipTri(p, q, r, col, e);
        marchTri(v, v.map(x => g(cl, x) < 0), planeCut(cl), sub, sub);
      };
      const clipEdge = (a, b, depth) => {
        if (a === b) return;
        const cl = classify([a, b], depth);
        if (cl === 'none') return;
        if (cl === 'all') { out.edges.push(a, b); return; }
        if (cl === 'cut') { const ain = val(a) < -EPS, x = ain ? cut(a, b) : cut(b, a); if (ain ? x !== a : x !== b) out.edges.push(ain ? a : x, ain ? x : b); return; }
        const m = cl === 'mid' ? mid(a, b) : (g(cl, a) < 0 ? planeCut(cl)(a, b) : planeCut(cl)(b, a));
        clipEdge(a, m, depth + 1); clipEdge(m, b, depth + 1);
      };

      for (let t = 0; t < M.tets.length / 4; t++) { const c = M.tetCtr[t]; clipTet(base + M.tets[t * 4], base + M.tets[t * 4 + 1], base + M.tets[t * 4 + 2], base + M.tets[t * 4 + 3], M.tetCol.slice(t * 3, t * 3 + 3), c >= 0 ? base + c : -1, 0); }
      for (let t = 0; t < M.tris.length / 3; t++) { sliceR = M.triTube[t]; clipTri(base + M.tris[t * 3], base + M.tris[t * 3 + 1], base + M.tris[t * 3 + 2], M.triCol.slice(t * 3, t * 3 + 3), 0); }
      for (let e = 0; e < M.edges.length; e += 2) clipEdge(base + M.edges[e], base + M.edges[e + 1], 0);
      // ---- curves: split into the runs that survive ----
      for (const c of M.curves) {
        const col = c.col, tubeR = c.r, idx = k => base + c.start + k;
        const inside = []; let nIn = 0;
        for (let k = 0; k < c.n; k++) { inside[k] = val(idx(k)) < 0; if (inside[k]) nIn++; }
        if (nIn === 0) continue;
        if (nIn === c.n) { out.curves.push({ start: base + c.start, n: c.n, closed: c.closed, col, r: tubeR }); continue; }
        let run = null;
        const flush = () => { if (run && run.length > 1) { const start = out.npts; for (const j of run) out.pt(pts[j * 4], pts[j * 4 + 1], pts[j * 4 + 2], pts[j * 4 + 3]); out.curves.push({ start, n: run.length, closed: false, col, r: tubeR }); } run = null; };
        let s0 = 0; if (c.closed) while (inside[s0]) s0++;
        const segs = c.closed ? c.n : c.n - 1;
        if (!c.closed && inside[0]) run = [idx(0)];
        for (let m = 0; m < segs; m++) {
          const k0 = (s0 + m) % c.n, k1 = (k0 + 1) % c.n, a = idx(k0), b = idx(k1);
          if (inside[k0] && inside[k1]) run.push(b);
          else if (inside[k0]) { const x = cut(a, b); if (x !== a) run.push(x); flush(); }
          else if (inside[k1]) { const x = cut(b, a); run = x === b ? [b] : [x, b]; }
        }
        flush();
      }
    }

    // the region made by shapes 0..k−1, as a field (and the plane of whichever shape decides it)
    const prefix = k => (p0, p1, p2, p3, W) => {
      let F = BIG, fi = -1;
      for (let j = 0; j < k; j++) {
        const d = wf[j] ? wf[j](p0, p1, p2, p3) : BIG, op = ops[j];
        if (op === 'add') { if (d < F) { F = d; fi = j; } } else if (op === 'subtract') { if (-d > F) { F = -d; fi = j; } } else if (d > F) { F = d; fi = j; }
      }
      if (W) { if (fi >= 0 && wf[fi]) wf[fi](p0, p1, p2, p3, W); else W[4] = NaN; }
      return F;
    };
    if (!n) return new Out().done({ splits: 0 });
    let cur = worldMesh(0);
    for (let k = 1; k < n; k++) {
      const Sk = worldMesh(k), next = new Out(), op = ops[k], dk = wf[k];
      // the result so far: outside shape k (add, subtract) or inside it (intersect)
      const F = prefix(k), Fk = prefix(k + 1);
      if (!dk) { if (op !== 'intersect') copyInto(cur, next); }
      else clipPass(cur, next, op === 'intersect' ? dk : (p0, p1, p2, p3, W) => -dk(p0, p1, p2, p3, W), items[k].field.lip, Sk, Fk, true);
      // shape k: outside the result so far (add) or inside it (subtract, intersect)
      const solidSoFar = wf.slice(0, k).some(Boolean);
      if (!solidSoFar) { if (op === 'add') copyInto(Sk, next); }
      else {
        const lip = Math.max(1, ...items.slice(0, k).map(o => (o.field ? o.field.lip : 1)));
        clipPass(Sk, next, op === 'add' ? (p0, p1, p2, p3, W) => -F(p0, p1, p2, p3, W) : F, lip, cur, Fk, false);
      }
      cur = next;
    }
    return compact(cur).done({ splits });
  }

  // drop points nothing refers to
  function compact(m) {
    const np = m.npts, map = new Int32Array(np).fill(-1);
    const use = j => { if (j >= 0) map[j] = 1; };
    m.tris.forEach(use); m.tets.forEach(use); m.edges.forEach(use); m.tetCtr.forEach(use);
    for (const c of m.curves) for (let k = 0; k < c.n; k++) map[c.start + k] = 1;
    const o = new Out();
    for (let j = 0; j < np; j++) if (map[j] > 0) { map[j] = o.npts; o.pts.push(m.pts[j * 4], m.pts[j * 4 + 1], m.pts[j * 4 + 2], m.pts[j * 4 + 3]); }
    o.tris = m.tris.map(j => map[j]); o.tets = m.tets.map(j => map[j]); o.edges = m.edges.map(j => map[j]); o.tetCtr = m.tetCtr.map(j => (j >= 0 ? map[j] : -1));
    o.triCol = m.triCol; o.triTube = m.triTube; o.tetCol = m.tetCol;
    o.curves = m.curves.map(c => ({ ...c, start: map[c.start] }));
    return o;
  }

  const TIMEOUT = new Error('csg timeout');
  root.CSG = { field, compose, placement, TINTS, TIMEOUT };
  if (typeof module !== 'undefined') module.exports = root.CSG;
})(typeof window !== 'undefined' ? window : globalThis);
