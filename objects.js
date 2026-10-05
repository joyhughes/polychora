// Scene objects as generic 4D meshes. Every object becomes:
//   pts    — 4D points (flat, 4 per point)
//   tris   — surface triangles, drawn in projection; sliced into segments
//   tets   — solid tetrahedra (the 3D boundary of a 4D solid), sliced into triangles
//   edges  — line segments
//   curves — closed or open polylines (drawn as tubes; sliced into points)
(function (root) {
  const Poly = root.Polychora || require('./geometry.js');
  const TAU = 2 * Math.PI, DEG = Math.PI / 180;

  function hsl(h, s, l) {
    const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  // Colour by the Hopf map S³ → S²: points on the same Hopf fibre share a colour.
  function hopfColor(p) {
    const l = Math.hypot(p[0], p[1], p[2], p[3]) || 1, a = p[0] / l, b = p[1] / l, c = p[2] / l, d = p[3] / l;
    const x = 2 * (a * c + b * d), y = 2 * (b * c - a * d), z = a * a + b * b - c * c - d * d;
    return hsl((Math.atan2(y, x) / TAU + 1) % 1, 0.62, 0.5 + 0.16 * z);
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

  class Mesh {
    constructor() { this.pts = []; this.tris = []; this.triCol = []; this.tets = []; this.tetCol = []; this.tetCtr = []; this.edges = []; this.curves = []; }
    pt(p) { this.pts.push(p[0], p[1], p[2], p[3]); return this.pts.length / 4 - 1; }
    tri(a, b, c, col) { this.tris.push(a, b, c); this.triCol.push(col[0], col[1], col[2]); }
    tet(a, b, c, d, col, ctr = -1) { this.tets.push(a, b, c, d); this.tetCol.push(col[0], col[1], col[2]); this.tetCtr.push(ctr); }
    edge(a, b) { this.edges.push(a, b); }
    curve(points, closed, col) {
      const start = this.pts.length / 4;
      for (const p of points) this.pt(p);
      this.curves.push({ start, n: points.length, closed, col });
    }
    done(extra) {
      return {
        pts: Float64Array.from(this.pts), npts: this.pts.length / 4,
        tris: Int32Array.from(this.tris), triCol: Float32Array.from(this.triCol),
        tets: Int32Array.from(this.tets), tetCol: Float32Array.from(this.tetCol), tetCtr: Int32Array.from(this.tetCtr),
        edges: Int32Array.from(this.edges), curves: this.curves, sliceTube: 0, tubeR: 0.03, ...extra,
      };
    }
  }

  // ---------------- regular polychora ----------------
  function polytope(id, prm) {
    const T = Poly.polytope(id), s = T.spec, sh = prm.shrink ?? 1;
    const M = new Mesh(), star = s.face === 'pentagram', exploded = sh < 0.999;
    const faceCtr = T.faces.map(f => { const c = [0, 0, 0, 0]; for (const i of f) for (let k = 0; k < 4; k++) c[k] += T.verts[i][k] / f.length; return c; });
    const faceCol = faceCtr.map(hopfColor), cellCol = T.cells.map(c => hopfColor(c.center));
    const gmap = new Map(), gfc = new Map(), faceDone = new Set();
    T.cells.forEach((cell, ci) => {
      const C = cell.center, vmap = exploded ? new Map() : gmap;
      const shrink = v => (exploded ? v.map((x, k) => C[k] + sh * (x - C[k])) : v);
      const vp = i => { let k = vmap.get(i); if (k === undefined) { k = M.pt(shrink(T.verts[i])); vmap.set(i, k); } return k; };
      const cc = M.pt(C);
      const isTet = cell.nverts === 4 && cell.faces.length === 4;
      for (const f of cell.faces) {
        const fv = T.faces[f], n = fv.length, ft = [];
        if (n === 3) ft.push([vp(fv[0]), vp(fv[1]), vp(fv[2])]);
        else if (!star) for (let k = 1; k < n - 1; k++) ft.push([vp(fv[0]), vp(fv[k]), vp(fv[k + 1])]);
        else {
          // a fan from the centre fills the pentagram
          let fc = exploded ? undefined : gfc.get(f);
          if (fc === undefined) { fc = M.pt(shrink(faceCtr[f])); if (!exploded) gfc.set(f, fc); }
          for (let k = 0; k < n; k++) ft.push([fc, vp(fv[k]), vp(fv[(k + 1) % n])]);
        }
        if (exploded || !faceDone.has(f)) {
          faceDone.add(f);
          const col = exploded ? cellCol[ci] : faceCol[f];
          for (const t of ft) M.tri(t[0], t[1], t[2], col);
          for (let k = 0; k < n; k++) M.edge(vp(fv[k]), vp(fv[(k + 1) % n]));
        }
        if (!isTet) for (const t of ft) M.tet(cc, t[0], t[1], t[2], cellCol[ci], cc);
      }
      if (isTet) { const vs = [...new Set(cell.faces.flatMap(f => T.faces[f]))].map(vp); M.tet(vs[0], vs[1], vs[2], vs[3], cellCol[ci], cc); }
    });
    // dedupe edges
    const seen = new Set(), E = [];
    for (let k = 0; k < M.edges.length; k += 2) {
      const a = M.edges[k], b = M.edges[k + 1], key = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (!seen.has(key)) { seen.add(key); E.push(a, b); }
    }
    M.edges = E;
    const rows = [['Cell', s.cell], ['Face', s.face], ['Vertex fig.', s.vf], ['Density', String(s.density)]];
    rows.push(s.kind === 'star'
      ? ['Relatives', `stellation of the ${s.cdir === 'V' ? '120' : '600'}-cell; faceting of the ${s.set === 'V' ? '600' : '120'}-cell`]
      : ['Family', s.family || 'convex regular']);
    return M.done({
      info: { name: s.name, sub: s.sym, counts: [['cells', T.cells.length], ['faces', T.faces.length], ['edges', T.edges.length], ['verts', T.nverts]], rows },
    });
  }

  // ---------------- flat tori in S³ ----------------
  const torusPoint = (eta, a, b) => [Math.cos(eta) * Math.cos(a), Math.cos(eta) * Math.sin(a), Math.sin(eta) * Math.cos(b), Math.sin(eta) * Math.sin(b)];

  function torusGrid(M, eta, res, colOf) {
    const idx = [];
    for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) idx.push(M.pt(torusPoint(eta, TAU * i / res, TAU * j / res)));
    const at = (i, j) => idx[((i + res) % res) * res + ((j + res) % res)];
    for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) {
      const col = colOf(i, j);
      M.tri(at(i, j), at(i + 1, j), at(i + 1, j + 1), col);
      M.tri(at(i, j), at(i + 1, j + 1), at(i, j + 1), col);
    }
    return at;
  }

  function torusKnot(M, eta, p, q, col) {
    const g = gcd(p, q) || 1, pp = p / g, qq = q / g, n = Math.min(900, 90 * Math.max(Math.abs(pp), Math.abs(qq), 1));
    for (let k = 0; k < g; k++) {
      const off = TAU * k / (g * Math.max(1, Math.abs(pp))), pts = [];
      for (let i = 0; i < n; i++) { const t = TAU * i / n; pts.push(torusPoint(eta, pp * t, qq * t + off)); }
      M.curve(pts, true, col);
    }
    return g;
  }

  function clifford(prm) {
    const M = new Mesh(), res = prm.res, eta = prm.eta * DEG, d = prm.thick * DEG;
    const bands = 8;
    const colOf = (i, j) => hsl(i / res, 0.6, Math.floor(j * bands / res) % 2 ? 0.6 : 0.44);
    let surf;
    if (d > 0) {
      const e0 = Math.max(0.5 * DEG, eta - d), e1 = Math.min(89.5 * DEG, eta + d);
      const A = torusGrid(M, e0, res, colOf), B = torusGrid(M, e1, res, colOf);
      surf = B;
      // solid shell between the two tori: each grid box split into 6 tetrahedra (Kuhn)
      const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
      for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) {
        const corner = (a, b, c) => (c ? B : A)(i + a, j + b), col = colOf(i, j);
        for (const p of perms) {
          const v = [0, 0, 0], chain = [corner(0, 0, 0)];
          for (const ax of p) { v[ax] = 1; chain.push(corner(v[0], v[1], v[2])); }
          M.tet(chain[0], chain[1], chain[2], chain[3], col);
        }
      }
    } else surf = torusGrid(M, eta, res, colOf);
    if (prm.grid > 0) {
      const stepI = Math.max(1, Math.round(res / prm.grid));
      for (let i = 0; i < res; i += stepI) for (let j = 0; j < res; j++) { M.edge(surf(i, j), surf(i, j + 1)); M.edge(surf(j, i), surf(j + 1, i)); }
    }
    let comps = 0;
    if (prm.knot) comps = torusKnot(M, eta, prm.p, prm.q, [0.96, 0.78, 0.32]);
    const name = Math.abs(prm.eta - 45) < 0.01 ? 'Clifford torus' : 'Flat torus';
    const rows = [
      ['Radii', `cos η = ${Math.cos(eta).toFixed(3)}, sin η = ${Math.sin(eta).toFixed(3)}`],
      ['Area', `2π² sin 2η = ${(2 * Math.PI ** 2 * Math.sin(2 * eta)).toFixed(3)}`],
      ['Curvature', 'flat (zero Gaussian curvature)'],
      ['Solid', d > 0 ? `shell ${(2 * prm.thick).toFixed(1)}° thick, slices are surfaces` : 'none, slices are curves'],
    ];
    if (prm.knot) rows.push(['Knot', comps > 1 ? `(${prm.p},${prm.q}) torus link, ${comps} components` : `(${prm.p},${prm.q}) torus knot`]);
    return M.done({
      sliceTube: d > 0 ? 0 : prm.tube, tubeR: prm.tube * 1.4,
      info: { name, sub: `T² ⊂ S³, η = ${prm.eta.toFixed(1)}°`, counts: [['grid', res + '²'], ['tris', M.tris.length / 3], ['tets', M.tets.length / 4], ['curves', M.curves.length]], rows },
    });
  }

  // ---------------- Hopf fibration ----------------
  // Fibre over the point of S² with polar angle th, azimuth ph:
  //   (cos(th/2) e^{i(t+ph)}, sin(th/2) e^{it}),  t ∈ [0, 2π)
  const fibrePoint = (th, ph, t) => [Math.cos(th / 2) * Math.cos(t + ph), Math.cos(th / 2) * Math.sin(t + ph), Math.sin(th / 2) * Math.cos(t), Math.sin(th / 2) * Math.sin(t)];

  function hopf(prm, time = 0) {
    const M = new Mesh(), phase = (prm.phase + prm.flow * time) * DEG, base = [], rings = [];
    if (prm.pattern === 'rings') {
      const K = prm.rings, N = prm.perRing;
      for (let k = 0; k < K; k++) {
        const th = Math.max(2, Math.min(178, prm.lat + (K > 1 ? prm.spread * (k / (K - 1) - 0.5) : 0))) * DEG;
        rings.push(th);
        for (let j = 0; j < N; j++) base.push([th, TAU * j / N + phase + (k % 2 ? Math.PI / N : 0)]);
      }
    } else if (prm.pattern === 'sphere') {
      const N = prm.count, ga = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < N; k++) base.push([Math.acos(1 - 2 * (k + 0.5) / N), k * ga + phase]);
    } else { // great circle on S², tilted from the equator
      const N = prm.count, tl = prm.tilt * DEG;
      for (let k = 0; k < N; k++) {
        const a = TAU * k / N + phase, x = Math.cos(a), y = Math.sin(a) * Math.cos(tl), z = Math.sin(a) * Math.sin(tl);
        base.push([Math.acos(Math.max(-1, Math.min(1, z))), Math.atan2(y, x)]);
      }
    }
    for (const [th, ph] of base) {
      const pts = [];
      for (let i = 0; i < prm.segs; i++) pts.push(fibrePoint(th, ph, TAU * i / prm.segs));
      M.curve(pts, true, hopfColor(pts[0]));
    }
    if (prm.tori && prm.pattern === 'rings') {
      const r = 40;
      for (const th of rings) torusGrid(M, th / 2, r, (i, j) => hopfColor(torusPoint(th / 2, TAU * (i + 0.5) / r, TAU * (j + 0.5) / r)));
    }
    const rows = [
      ['Fibres', 'great circles of S³, one over each point of S²'],
      ['Linking', 'any two fibres link exactly once'],
      ['Rings', 'fibres over a circle of latitude fill a flat torus'],
      ['Spin tip', 'Isoclinic preset (XY = ZW) slides points along the fibres'],
    ];
    return M.done({
      sliceTube: prm.tube * 0.5, tubeR: prm.tube,
      info: { name: 'Hopf fibration', sub: 'S¹ → S³ → S²', counts: [['fibres', base.length], ['rings', rings.length || '—'], ['segs', prm.segs], ['tori', prm.tori && rings.length ? rings.length : 0]], rows },
    });
  }

  // ---------------- Sierpinski-style IFS fractals ----------------
  const FRACTALS = {
    'sierpinski-5': { name: 'Sierpinski pentatope', base: 'pentachoron', rule: 'a half-size 5-cell at each of the 5 vertices', maps: r => Poly.polytope('pentachoron').verts.map(v => ({ r, t: v.map(x => x * (1 - r)) })), ratio: true, maxDepth: 5, depth: 4 },
    'sierpinski-16': { name: 'Sierpinski 16-cell', base: 'hexadecachoron', rule: 'a half-size 16-cell at each of the 8 vertices', maps: r => Poly.polytope('hexadecachoron').verts.map(v => ({ r, t: v.map(x => x * (1 - r)) })), ratio: true, maxDepth: 4, depth: 3 },
    'cantor': { name: 'Cantor tesseract', base: 'tesseract', rule: 'a scaled tesseract in each of the 16 corners', maps: r => Poly.polytope('tesseract').verts.map(v => ({ r, t: v.map(x => x * (1 - r)) })), ratio: true, maxDepth: 3, depth: 2, ratioDefault: 0.4 },
    'menger': {
      name: 'Menger tesseract', base: 'tesseract', rule: 'split into 3⁴ = 81, keep the 48 with at most one middle coordinate', ratio: false, maxDepth: 2, depth: 2,
      maps: () => { const m = []; for (let i = 0; i < 81; i++) { const c = [0, 1, 2, 3].map(k => Math.floor(i / 3 ** k) % 3 - 1); if (c.filter(x => x === 0).length <= 1) m.push({ r: 1 / 3, t: c.map(x => x / 3) }); } return m; },
    },
    'vicsek': {
      name: 'Vicsek tesseract', base: 'tesseract', rule: 'keep the centre and its 8 face neighbours of the 3⁴ grid', ratio: false, maxDepth: 3, depth: 3,
      maps: () => { const m = [{ r: 1 / 3, t: [0, 0, 0, 0] }]; for (let k = 0; k < 4; k++) for (const s of [1, -1]) { const t = [0, 0, 0, 0]; t[k] = s / 3; m.push({ r: 1 / 3, t }); } return m; },
    },
  };

  function fractal(kind, prm) {
    const F = FRACTALS[kind], B = Poly.polytope(F.base), r = F.ratio ? prm.ratio : 1 / 3, maps = F.maps(r), N = maps.length;
    let leaves = [{ o: [0, 0, 0, 0], s: 1, path: [] }];
    for (let d = 0; d < prm.depth; d++) {
      const next = [];
      for (const L of leaves) maps.forEach((m, i) => next.push({ o: L.o.map((x, k) => x + L.s * m.t[k]), s: L.s * m.r, path: L.path.length < 2 ? L.path.concat(i) : L.path }));
      leaves = next;
    }
    const key = p => p.map(x => Math.round(x * 1e6)).join(',');
    const tf = (L, v) => v.map((x, k) => L.o[k] + L.s * x);
    // cells shared by two leaves are interior: drop both
    const cellCount = new Map();
    for (const L of leaves) for (const c of B.cells) { const k = key(tf(L, c.center)); cellCount.set(k, (cellCount.get(k) || 0) + 1); }
    const M = new Mesh(), vmap = new Map(), faceDone = new Set(), edgeDone = new Set();
    const vp = p => { const k = key(p); let i = vmap.get(k); if (i === undefined) { i = M.pt(p); vmap.set(k, i); } return i; };
    let kept = 0;
    for (const L of leaves) {
      const col = hsl(((L.path[0] ?? 0) + 0.35 * ((L.path[1] ?? 0) / N)) / N, 0.6, 0.42 + 0.18 * ((L.path[1] ?? 0) / Math.max(1, N - 1)));
      const lv = B.verts.map(v => tf(L, v));
      for (const c of B.cells) {
        const C = tf(L, c.center);
        if (cellCount.get(key(C)) > 1) continue;
        kept++;
        const cc = M.pt(C), isTet = c.nverts === 4;
        for (const f of c.faces) {
          const fv = B.faces[f].map(i => vp(lv[i])), ft = [];
          for (let k = 1; k < fv.length - 1; k++) ft.push([fv[0], fv[k], fv[k + 1]]);
          const fk = fv.slice().sort((a, b) => a - b).join(',');
          if (!faceDone.has(fk)) {
            faceDone.add(fk);
            for (const t of ft) M.tri(t[0], t[1], t[2], col);
            for (let k = 0; k < fv.length; k++) {
              const a = fv[k], b = fv[(k + 1) % fv.length], ek = a < b ? a * 1e7 + b : b * 1e7 + a;
              if (!edgeDone.has(ek)) { edgeDone.add(ek); M.edge(a, b); }
            }
          }
          if (!isTet) for (const t of ft) M.tet(cc, t[0], t[1], t[2], col, cc);
        }
        if (isTet) { const vs = [...new Set(c.faces.flatMap(f => B.faces[f]))].map(i => vp(lv[i])); M.tet(vs[0], vs[1], vs[2], vs[3], col, cc); }
      }
    }
    const dim = Math.log(N) / Math.log(1 / r);
    const rows = [
      ['Rule', F.rule],
      ['Scale', F.ratio ? `r = ${r.toFixed(3)}` : 'r = 1/3'],
      ['Dimension', `log ${N} / log ${(1 / r).toFixed(3).replace(/\.?0+$/, '')} = ${dim.toFixed(4)}${F.ratio && r > 0.5001 ? ' (copies overlap)' : ''}`],
      ['Leaf cell', B.spec.name],
    ];
    return M.done({
      info: { name: F.name, sub: `depth ${prm.depth}, ${N} maps`, counts: [['copies', leaves.length], ['cells', kept], ['faces', faceDone.size], ['verts', vmap.size]], rows },
    });
  }

  root.Objects = { polytope, clifford, hopf, fractal, FRACTALS, hopfColor, hsl };
  if (typeof module !== 'undefined') module.exports = root.Objects;
})(typeof window !== 'undefined' ? window : globalThis);
