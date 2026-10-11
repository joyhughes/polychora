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

  // base points (polar angle, azimuth) on S² for the fibres, and the latitudes of the rings
  function hopfBase(prm, time = 0) {
    const phase = (prm.phase + prm.flow * time) * DEG, base = [], rings = [];
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
    return { base, rings };
  }

  function hopf(prm, time = 0) {
    const M = new Mesh(), { base, rings } = hopfBase(prm, time);
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

  // ---------------- fractal mountain ----------------
  // A 4D landscape: the solid between a flat floor and a height y = h(x, z, w) over a cube of ground. The heights
  // come from diamond–square on a 3D grid: each new point is the mean of its neighbours plus a random offset that
  // shrinks by the roughness at every halving. Between grid points h is linear on the Kuhn split of each cube into
  // six tetrahedra (sorted fractional coordinates), so the mesh, the CSG field and the GPU all see the same surface.
  const KUHN = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const MTN_HALF = 0.75, MTN_FLOOR = 0.4;
  let hfKey = '', hfVal = null;
  function mountainHeights(prm) {
    const key = JSON.stringify(prm);
    if (key === hfKey) return hfVal;
    const N = 2 ** prm.detail, n1 = N + 1, a = MTN_HALF, B = MTN_FLOOR, H = new Float64Array(n1 * n1 * n1);
    const at = (i, j, k) => (i * n1 + j) * n1 + k;
    let seed = (prm.seed * 2654435761) >>> 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };
    const c = [0, 0, 0];
    let amp = 0.42 * prm.height;
    for (let s = N; s >= 2; s >>= 1, amp *= prm.rough) {
      const h = s >> 1;
      // points with three, then two, then one coordinate halfway between the coarse grid points
      for (const m of [3, 2, 1]) for (c[0] = 0; c[0] <= N; c[0] += h) for (c[1] = 0; c[1] <= N; c[1] += h) for (c[2] = 0; c[2] <= N; c[2] += h) {
        const odd = c.map(x => (x / h) & 1);
        if (odd[0] + odd[1] + odd[2] !== m) continue;
        // the coarse corners around it, and the points one step away along its other axes (filled one pass ago)
        let sum = 0, cnt = 0;
        const ax = [0, 1, 2].filter(q => odd[q]);
        for (let b = 0; b < 1 << m; b++) { const p = c.slice(); ax.forEach((q, r) => { p[q] += b >> r & 1 ? h : -h; }); sum += H[at(p[0], p[1], p[2])]; cnt++; }
        for (let q = 0; q < 3; q++) if (!odd[q]) for (const d of [-h, h]) { const x = c[q] + d; if (x < 0 || x > N) continue; const p = c.slice(); p[q] = x; sum += H[at(p[0], p[1], p[2])]; cnt++; }
        H[at(c[0], c[1], c[2])] = sum / cnt + amp * rnd();
      }
    }
    // a peak in the middle of the ground, then the water fills everything below sea level
    let top = -Infinity;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) {
      const x = -1 + 2 * i / N, z = -1 + 2 * j / N, w = -1 + 2 * k / N, r2 = x * x + z * z + w * w, q = at(i, j, k);
      H[q] = Math.max(prm.sea, -B + 0.02, H[q] + prm.height * (1.1 * Math.exp(-2.4 * r2) - 0.3));
      top = Math.max(top, H[q]);
    }
    hfKey = key; hfVal = { N, a, B, H, sea: prm.sea, top, snow: prm.sea + prm.snow * (top - prm.sea) };
    return hfVal;
  }
  // ground colour by height (as a share of the way from sea level to the summit) and steepness
  function terrainColor(y, slope, hf) {
    if (y <= hf.sea + 1e-9) return [0.17, 0.4, 0.66];
    const q = (y - hf.sea) / Math.max(1e-6, hf.top - hf.sea), mix = (A, Bc, t) => A.map((v, i) => v + (Bc[i] - v) * Math.max(0, Math.min(1, t)));
    const sand = [0.8, 0.73, 0.5], grass = [0.33, 0.58, 0.27], forest = [0.18, 0.4, 0.2], rock = [0.5, 0.42, 0.35], scree = [0.6, 0.58, 0.56], snow = [0.93, 0.95, 0.98];
    const sl = (hf.snow - hf.sea) / Math.max(1e-6, hf.top - hf.sea);
    let col = q < 0.04 ? mix(sand, grass, q / 0.04) : q < 0.3 ? mix(grass, forest, (q - 0.04) / 0.26) : q < sl ? mix(rock, scree, (q - 0.3) / Math.max(1e-6, sl - 0.3)) : snow;
    if (q < sl) col = mix(col, rock, (slope - 1.2) / 1.2);
    else col = mix(snow, scree, (slope - 1.8) / 1.5);
    return col;
  }

  function mountain(prm) {
    const hf = mountainHeights(prm), { N, a, B, H } = hf, n1 = N + 1, sc = N / (2 * a), M = new Mesh();
    const at = (i, j, k) => (i * n1 + j) * n1 + k, coord = i => -a + 2 * a * i / N;
    // grid points on the surface: axes x, z, w with height y
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) M.pt([coord(i), H[at(i, j, k)], coord(j), coord(k)]);
    const floorPt = new Map(), fp = (i, j, k) => { const q = at(i, j, k); let v = floorPt.get(q); if (v === undefined) { v = M.pt([coord(i), -B, coord(j), coord(k)]); floorPt.set(q, v); } return v; };
    const soil = y => { const t = (y + B) / (hf.top + B); return [0.36 + 0.12 * t, 0.26 + 0.08 * t, 0.18 + 0.05 * t]; };
    // the surface: six tetrahedra per grid cube
    let water = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) for (const p of KUHN) {
      const v = [i, j, k], ch = [at(i, j, k)];
      for (const q of p) { v[q]++; ch.push(at(v[0], v[1], v[2])); }
      const g = [0, 0, 0]; for (let r = 0; r < 3; r++) g[p[r]] = (H[ch[r + 1]] - H[ch[r]]) * sc;
      const mean = (H[ch[0]] + H[ch[1]] + H[ch[2]] + H[ch[3]]) / 4, wet = Math.max(H[ch[0]], H[ch[1]], H[ch[2]], H[ch[3]]) <= hf.sea + 1e-9;
      if (wet) water++;
      M.tet(ch[0], ch[1], ch[2], ch[3], terrainColor(wet ? hf.sea : mean, Math.hypot(...g), hf));
    }
    // the walls: over each side of the cube, a prism from the floor up to the surface for each grid triangle
    const side = (ax, lv, b, c) => (u, v) => { const p = [0, 0, 0]; p[ax] = lv; p[b] = u; p[c] = v; return p; };
    for (let ax = 0; ax < 3; ax++) for (const lv of [0, N]) {
      const [b, c] = [0, 1, 2].filter(q => q !== ax), P3 = side(ax, lv, b, c);
      for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) for (const tri of [[[u, v], [u + 1, v], [u + 1, v + 1]], [[u, v], [u, v + 1], [u + 1, v + 1]]]) {
        const ps = tri.map(([x, y]) => P3(x, y)), T = ps.map(p => at(p[0], p[1], p[2])), F = ps.map(p => fp(p[0], p[1], p[2]));
        const col = soil((H[T[0]] + H[T[1]] + H[T[2]]) / 6 - B / 2);
        M.tet(T[0], T[1], T[2], F[0], col); M.tet(T[1], T[2], F[0], F[1], col); M.tet(T[2], F[0], F[1], F[2], col);
      }
    }
    // the floor: the cube split into six
    for (const p of KUHN) { const v = [0, 0, 0], ch = [fp(0, 0, 0)]; for (const q of p) { v[q] = N; ch.push(fp(v[0], v[1], v[2])); } M.tet(ch[0], ch[1], ch[2], ch[3], [0.24, 0.18, 0.13]); }

    // faces and edges to draw: the surface over the grid planes through the middle and the sides of the ground,
    // and the edges of the block
    const step = N / 2;
    const triCol = q => { const t = terrainColor(Math.max(hf.sea, (H[q[0]] + H[q[1]] + H[q[2]]) / 3), 0, hf); return t; };
    for (let ax = 0; ax < 3; ax++) for (let lv = 0; lv <= N; lv += step) {
      const [b, c] = [0, 1, 2].filter(q => q !== ax), P3 = side(ax, lv, b, c);
      for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) for (const tri of [[[u, v], [u + 1, v], [u + 1, v + 1]], [[u, v], [u, v + 1], [u + 1, v + 1]]]) {
        const T = tri.map(([x, y]) => { const p = P3(x, y); return at(p[0], p[1], p[2]); });
        M.tri(T[0], T[1], T[2], triCol(T));
      }
    }
    for (let e = 0; e < 3; e++) {
      const [b, c] = [0, 1, 2].filter(q => q !== e);
      for (let lb = 0; lb <= N; lb += step) for (let lc = 0; lc <= N; lc += step) {
        const pt = t => { const p = [0, 0, 0]; p[e] = t; p[b] = lb; p[c] = lc; return p; };
        const outer = (lb === 0 || lb === N) && (lc === 0 || lc === N);
        for (let t = 0; t < N; t++) {
          const p = pt(t), q = pt(t + 1), A = at(p[0], p[1], p[2]), Bq = at(q[0], q[1], q[2]);
          M.edge(A, Bq);
          if (outer) {
            // the wall where two sides of the ground meet, and the floor's edge beneath it
            const fa = fp(p[0], p[1], p[2]), fb = fp(q[0], q[1], q[2]), col = soil(-B / 2);
            M.tri(A, Bq, fb, col); M.tri(A, fb, fa, col);
            M.edge(fa, fb);
            if (t === 0) M.edge(A, fa);
            if (t === N - 1) M.edge(Bq, fb);
          }
        }
      }
    }
    const Hs = -Math.log2(prm.rough);
    const rows = [
      ['Rule', 'diamond–square on a 3D grid: each new height is its neighbours’ mean plus a random offset scaled by r at each halving'],
      ['Dimension', `surface ≈ 4 − H = ${(4 - Hs).toFixed(3)} (H = −log₂ r = ${Hs.toFixed(3)})`],
      ['Slices', 'each slice across w is an ordinary 3D mountain; sweeping it moves through the range'],
      ['Water', `${Math.round(100 * water / (6 * N ** 3))}% of the ground below sea level`],
    ];
    return M.done({
      info: { name: 'Fractal mountain', sub: `y = h(x, z, w), ${N}³ grid, seed ${prm.seed}`, counts: [['grid', N + '³'], ['summit', hf.top.toFixed(2)], ['tets', M.tets.length / 4], ['verts', M.pts.length / 4]], rows },
    });
  }

  // ---------------- L-system tree ----------------
  // A bracketed L-system drawn by a 4D turtle. The turtle carries a position, a heading H and three more directions
  // e1, e2, e3 across it. Each F draws a branch: a prism over an icosahedron lying in the 3-space across H.
  //   F draw forward     f move forward     [ ] save and restore the turtle     L a leaf (a 16-cell)
  //   + −  turn toward ±e1      & ^  pitch toward ±e2      < >  turn toward ±e3, into the fourth dimension
  //   \ /  roll e1 toward e2     { }  roll e2 toward e3      |  turn around
  //   ! thinner (width ratio)   " shorter (length ratio)
  // Any turn may carry its own angle in degrees, as +(30). Other letters only drive the rewriting. A symbol with several
  // rules picks one at random (from the seed) each time it is rewritten.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const ICOSA = (() => {
    const v = [];
    for (const a of [-1, 1]) for (const b of [-PHI, PHI]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
    const n = v.map(p => { const l = Math.hypot(...p); return p.map(x => x / l); }), faces = [];
    const d2 = (i, j) => (v[i][0] - v[j][0]) ** 2 + (v[i][1] - v[j][1]) ** 2 + (v[i][2] - v[j][2]) ** 2;
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (Math.abs(d2(i, j) - 4) < 1e-9 && Math.abs(d2(j, k) - 4) < 1e-9 && Math.abs(d2(i, k) - 4) < 1e-9) faces.push([i, j, k]);
    const normals = faces.map(f => { const c = [0, 1, 2].map(q => n[f[0]][q] + n[f[1]][q] + n[f[2]][q]), l = Math.hypot(...c); return c.map(x => x / l); });
    const inr = Math.hypot(...[0, 1, 2].map(q => (n[faces[0][0]][q] + n[faces[0][1]][q] + n[faces[0][2]][q]) / 3)); // inradius of the unit-circumradius icosahedron
    const edges = [];
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(d2(i, j) - 4) < 1e-9) edges.push([i, j]);
    return { verts: n, faces, normals, edges, inr };
  })();
  const LSYS_PRESETS = {
    tetra: { name: '4D tetrahedral tree', axiom: 'A', rules: 'A = !"F/{[+&<A][+^>A][-&>A][-^<A]', iter: 5, angle: 22, lenRatio: 0.66, widthRatio: 0.63, thick: 0.09, leaves: true, leafSize: 0.1 },
    ternary: { name: 'Ternary tree, spun into w', axiom: 'FFA', rules: 'A = !"[&FA]/(120)<(14)[&FA]/(120)<(14)[&FA]', iter: 5, angle: 30, lenRatio: 0.78, widthRatio: 0.7, thick: 0.1, leaves: true, leafSize: 0.16 },
    bush: { name: 'Bush in four dimensions', axiom: 'F', rules: 'F = FF-[-F+F<F]+[+F-F>F]^[^F&F<F]&[&F^F>F]', iter: 3, angle: 22.5, lenRatio: 1, widthRatio: 1, thick: 0.1, leaves: true, leafSize: 0.45 },
    weed: { name: 'Stochastic weed', axiom: 'X', rules: 'X = F[+X][>X]F[-X][<X]\nX = F[&X][^X]FX\nX = F[+<X]F[->X]X\nF = FF', iter: 5, angle: 28, lenRatio: 1, widthRatio: 1, thick: 0.3, leaves: true, leafSize: 1.2 },
    fern: { name: 'Plant with a leader', axiom: 'X', rules: 'X = F[+X][<X]F[-X][>X]/+X\nF = FF', iter: 5, angle: 22.5, lenRatio: 1, widthRatio: 1, thick: 0.35, leaves: true, leafSize: 1.1 },
  };
  const LSYS_MAX_STRING = 400000, LSYS_MAX_PARTS = 20000;
  // "X = rhs" lines (also X -> rhs, X → rhs); lines starting with # are comments
  function parseRules(text) {
    const rules = new Map(), bad = [];
    for (const raw of String(text).split(/\n/)) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(\S)\s*(?:=|->|→)\s*(.*)$/);
      if (!m) { bad.push(line); continue; }
      const rhs = m[2].replace(/\s+/g, '');
      if (!rules.has(m[1])) rules.set(m[1], []);
      rules.get(m[1]).push(rhs);
    }
    return { rules, bad };
  }
  let treeKey = '', treeVal = null;
  function treeData(prm) {
    const key = JSON.stringify(prm);
    if (key === treeKey) return treeVal;
    let seed = (prm.seed * 2654435761) >>> 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const { rules, bad } = parseRules(prm.rules);
    // rewrite, keeping (angle) arguments with the symbol before them
    let str = String(prm.axiom).replace(/\s+/g, ''), done = 0, cut = false;
    for (; done < prm.iter; done++) {
      let out = '';
      for (let i = 0; i < str.length; i++) {
        const c = str[i], alts = rules.get(c);
        if (str[i + 1] === '(') { const j = str.indexOf(')', i); if (j > i) { out += alts ? alts[Math.floor(rnd() * alts.length)] : str.slice(i, j + 1); i = j; continue; } }
        out += alts ? alts[alts.length === 1 ? 0 : Math.floor(rnd() * alts.length)] : c;
        if (out.length > LSYS_MAX_STRING) break;
      }
      if (out.length > LSYS_MAX_STRING) { cut = true; break; }
      str = out;
    }
    // interpret
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2] + u[3] * v[3];
    const turn = (T, i, j, th) => { const a = T.F[i], b = T.F[j], c = Math.cos(th), s = Math.sin(th); T.F[i] = a.map((x, q) => c * x + s * b[q]); T.F[j] = b.map((x, q) => c * x - s * a[q]); };
    const ortho = F => { for (let i = 0; i < 4; i++) { for (let j = 0; j < i; j++) { const d = dot(F[i], F[j]); F[i] = F[i].map((x, q) => x - d * F[j][q]); } const l = Math.hypot(...F[i]); F[i] = F[i].map(x => x / l); } };
    const DEF = prm.angle * DEG;
    // frame F = [H, e1, e2, e3]: up along y, then x, z, w
    let T = { p: [0, 0, 0, 0], F: [[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], w: prm.thick, len: 1 };
    const stack = [], br = [], scopes = [[]];
    let canMerge = false, level = 0, maxLevel = 0, ops = 0, full = false;
    const push = rec => { if (br.length >= LSYS_MAX_PARTS) { full = true; return; } rec.level = level; br.push(rec); scopes[scopes.length - 1].push(br.length - 1); };
    for (let i = 0; i < str.length && !full; i++) {
      const c = str[i];
      let th = DEF;
      if (str[i + 1] === '(') { const j = str.indexOf(')', i); if (j > i) { const v = parseFloat(str.slice(i + 2, j)); if (isFinite(v)) th = v * DEG; i = j; } }
      if (c === 'F') {
        const last = br[br.length - 1];
        if (canMerge && last) last.L += T.len;
        else push({ base: T.p.slice(), a: T.F[0].slice(), e: [T.F[1].slice(), T.F[2].slice(), T.F[3].slice()], L: T.len, r0: T.w, r1: T.w, leaf: 0 });
        T.p = T.p.map((x, q) => x + T.len * T.F[0][q]); canMerge = true; continue;
      }
      canMerge = false;
      if (c === 'f') T.p = T.p.map((x, q) => x + T.len * T.F[0][q]);
      else if (c === '+') turn(T, 0, 1, th); else if (c === '-') turn(T, 0, 1, -th);
      else if (c === '&') turn(T, 0, 2, th); else if (c === '^') turn(T, 0, 2, -th);
      else if (c === '<') turn(T, 0, 3, th); else if (c === '>') turn(T, 0, 3, -th);
      else if (c === '\\') turn(T, 1, 2, th); else if (c === '/') turn(T, 1, 2, -th);
      else if (c === '{') turn(T, 2, 3, th); else if (c === '}') turn(T, 2, 3, -th);
      else if (c === '|') turn(T, 0, 1, Math.PI);
      else if (c === '!') T.w *= prm.widthRatio;
      else if (c === '"') T.len *= prm.lenRatio;
      else if (c === '[') { stack.push({ p: T.p.slice(), F: T.F.map(v => v.slice()), w: T.w, len: T.len }); scopes.push([]); level++; maxLevel = Math.max(maxLevel, level); }
      else if (c === ']') { if (stack.length) { T = stack.pop(); for (const k of scopes.pop()) br[k].skip = br.length; level--; } }
      else if (c === 'L') push({ base: T.p.slice(), a: T.F[0].slice(), e: [T.F[1].slice(), T.F[2].slice(), T.F[3].slice()], L: 0, r0: 0, r1: 0, leaf: prm.leafSize });
      if (++ops % 32 === 0) ortho(T.F);
    }
    for (const sc of scopes) for (const k of sc) if (br[k].skip === undefined) br[k].skip = br.length;
    // a leaf on every branch with nothing drawn after it
    if (prm.leaves) br.forEach((b, i) => { if (b.L > 0 && b.skip === i + 1) b.leaf = prm.leafSize; });
    const add = (u, v, s = 1) => u.map((x, i) => x + s * v[i]);
    if (br.length) {
      // fit the tree into a ball of radius 1.15 about the origin
      const lo = [Infinity, Infinity, Infinity, Infinity], hi = lo.map(() => -Infinity);
      for (const b of br) for (const p of [b.base, add(b.base, b.a, b.L)]) for (let i = 0; i < 4; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      const mid = lo.map((x, i) => (x + hi[i]) / 2);
      let R = 1e-9; for (const b of br) for (const p of [b.base, add(b.base, b.a, b.L)]) R = Math.max(R, Math.hypot(...p.map((x, i) => x - mid[i])) + Math.max(b.r0 / ICOSA.inr, b.leaf));
      const sc = 1.15 / R;
      for (const b of br) { b.base = b.base.map((x, i) => (x - mid[i]) * sc); b.L *= sc; b.r0 *= sc; b.r1 *= sc; b.leaf *= sc; }
    }
    // bounding balls of each part and of each subtree (br[i .. skip))
    const cr = 1 / ICOSA.inr;
    for (const b of br) { b.c = add(b.base, b.a, b.L / 2); b.R = Math.hypot(b.L / 2, b.r0 * cr); if (b.leaf) { const t = add(b.base, b.a, b.L); b.R = Math.max(b.R, Math.hypot(...t.map((x, i) => x - b.c[i])) + b.leaf); } }
    for (let i = br.length - 1; i >= 0; i--) {
      const b = br[i], lo2 = b.c.slice(), hi2 = b.c.slice();
      for (let j = i; j < b.skip; j++) for (let q = 0; q < 4; q++) { lo2[q] = Math.min(lo2[q], br[j].c[q] - br[j].R); hi2[q] = Math.max(hi2[q], br[j].c[q] + br[j].R); }
      b.sc = lo2.map((x, q) => (x + hi2[q]) / 2);
      b.sR = 0; for (let j = i; j < b.skip; j++) b.sR = Math.max(b.sR, Math.hypot(...br[j].c.map((x, q) => x - b.sc[q])) + br[j].R);
    }
    treeKey = key; treeVal = { br, depth: Math.max(1, maxLevel), str: str.length, done, cut, full, bad, rules };
    return treeVal;
  }

  function tree(prm) {
    const T = treeData(prm), M = new Mesh(), cr = 1 / ICOSA.inr, I = ICOSA;
    const bark = lv => { const t = lv / Math.max(1, T.depth); return [0.34 + 0.16 * t, 0.24 + 0.2 * t, 0.16 + 0.06 * t]; };
    let leaves = 0;
    T.br.forEach((b, bi) => {
      const tip = b.base.map((x, i) => x + b.L * b.a[i]);
      const ring = (o, r) => I.verts.map(v => M.pt(o.map((x, i) => x + r * cr * (v[0] * b.e[0][i] + v[1] * b.e[1][i] + v[2] * b.e[2][i]))));
      const col = bark(b.level);
      if (b.r0 > 0) {
      const B = ring(b.base, b.r0), Tp = ring(tip, b.r1), cb = M.pt(b.base), ct = M.pt(tip);
      for (const [i, j, k] of I.faces) {
        M.tet(B[i], B[j], B[k], Tp[i], col); M.tet(B[j], B[k], Tp[i], Tp[j], col); M.tet(B[k], Tp[i], Tp[j], Tp[k], col);
        M.tet(cb, B[i], B[j], B[k], col); M.tet(ct, Tp[i], Tp[j], Tp[k], col);
        M.tri(B[i], B[j], B[k], col); M.tri(Tp[i], Tp[j], Tp[k], col);
      }
      for (const [i, j] of I.edges) { M.tri(B[i], B[j], Tp[j], col); M.tri(B[i], Tp[j], Tp[i], col); M.edge(B[i], B[j]); M.edge(Tp[i], Tp[j]); }
      for (let i = 0; i < 12; i++) M.edge(B[i], Tp[i]);
      }
      if (b.leaf) {
        // a 16-cell: the points within leaf size of the tip in the sum of |coordinates|
        leaves++;
        const lc = hsl(0.24 + 0.1 * ((bi * 0.6180339) % 1), 0.55, 0.36 + 0.12 * ((bi * 0.381966) % 1));
        const V = [];
        for (let q = 0; q < 4; q++) for (const sg of [1, -1]) { const p = tip.slice(); p[q] += sg * b.leaf; V.push(M.pt(p)); }
        const vx = (q, sg) => V[q * 2 + (sg > 0 ? 0 : 1)];
        for (let m = 0; m < 16; m++) { const sg = [0, 1, 2, 3].map(q => (m >> q & 1 ? -1 : 1)); M.tet(vx(0, sg[0]), vx(1, sg[1]), vx(2, sg[2]), vx(3, sg[3]), lc); }
        for (let q = 0; q < 4; q++) for (let r = q + 1; r < 4; r++) for (const s1 of [1, -1]) for (const s2 of [1, -1]) M.edge(vx(q, s1), vx(r, s2));
        for (let m = 0; m < 32; m++) { const skip = m & 3, sg = [0, 1, 2].map(q => (m >> (q + 2) & 1 ? -1 : 1)), ax = [0, 1, 2, 3].filter(q => q !== skip); M.tri(vx(ax[0], sg[0]), vx(ax[1], sg[1]), vx(ax[2], sg[2]), lc); }
      }
    });
    const esc = x => String(x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const rules = [...T.rules].map(([k, alts]) => alts.map(r => `${esc(k)} → ${esc(r)}`).join('<br>')).join('<br>');
    const rows = [
      ['Axiom', `<code>${esc(prm.axiom) || '—'}</code>`],
      ['Rules', rules ? `<code>${rules}</code>` : 'none'],
      ['String', `${T.str.toLocaleString()} symbols after ${T.done} rewriting${T.done === 1 ? '' : 's'}${T.cut ? ` (stopped: the next would pass ${LSYS_MAX_STRING.toLocaleString()})` : ''}`],
    ];
    if (T.full) rows.push(['Drawn', `the first ${LSYS_MAX_PARTS.toLocaleString()} branches and leaves only`]);
    if (T.bad.length) rows.push(['Not read', `<code>${T.bad.map(esc).join('<br>')}</code> (write rules as X = …)`]);
    rows.push(['Branch', 'a 4D prism over an icosahedron; F steps in a straight line join into one']);
    return M.done({
      info: { name: 'L-system tree', sub: `${T.done} iteration${T.done === 1 ? '' : 's'}, ${prm.angle}°`, counts: [['branches', T.br.filter(b => b.L > 0).length], ['leaves', leaves], ['tets', M.tets.length / 4], ['verts', M.pts.length / 4]], rows },
    });
  }

  // ---------------- black hole ----------------
  // Space around a Schwarzschild black hole at one instant, ds² = dr²/(1 − rₛ/r) + r² dΩ², is curved, but it fits exactly
  // in flat 4D as the hypersurface w = 2√(rₛ(r − rₛ)) over r = |(x, y, z)| ≥ rₛ: Flamm's paraboloid one dimension up.
  // Written as r = rₛ + w²/(4rₛ) it is smooth through the horizon r = rₛ (w = 0), where it turns into a second sheet
  // (w < 0): the Einstein–Rosen bridge. The mesh is a sphere of directions times layers in w, split into tetrahedra.
  // Light rays follow the photon orbit equation u'' + u = (3/2) rₛ u² (u = 1/r) and are lifted onto the sheet.
  function icosphere(level) {
    const v = ICOSA.verts.map(p => p.slice());
    let f = ICOSA.faces.map(t => t.slice());
    for (let l = 0; l < level; l++) {
      const mid = new Map(), nf = [];
      const m = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; let i = mid.get(k); if (i === undefined) { const p = [0, 1, 2].map(q => v[a][q] + v[b][q]), l2 = Math.hypot(...p); i = v.length; v.push(p.map(x => x / l2)); mid.set(k, i); } return i; };
      for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]); }
      f = nf;
    }
    return { v, f };
  }
  // the rate of a clock held still at r, √(1 − rₛ/r): deep red at the horizon, through amber, to blue-white far out
  const CLOCK = [[0.35, 0.05, 0.06], [0.85, 0.25, 0.1], [0.96, 0.66, 0.26], [0.72, 0.8, 0.92], [0.42, 0.56, 0.9]];
  function clockColor(g) {
    const t = Math.max(0, Math.min(1, g)) * (CLOCK.length - 1), i = Math.min(CLOCK.length - 2, Math.floor(t)), f = t - i;
    return CLOCK[i].map((v, q) => v + (CLOCK[i + 1][q] - v) * f);
  }
  // The geometry for both cases (M = rₛ/2, a = spin·M; a = 0 is Schwarzschild). Boyer–Lindquist r runs from the
  // horizon r₊ = M + √(M² − a²) out to the reach; s = √(r − r₊) is smooth through the horizon.
  // On the equator the space ds² = r²/Δ dr² + ρ(r)² dφ², ρ² = r² + a² + 2Ma²/r, embeds exactly as a surface of revolution
  // with circle radius ρ(r) and depth W(r) = ∫ √(g_rr − ρ'²) dr. The 3D space is drawn over the directions (θ from the
  // spin axis y, and φ) as (ρ sinθ cosφ, r cosθ, ρ sinθ sinφ, W(r)): exact at a = 0, and exact on the equator for any spin.
  let bhKey = '', bhVal = null;
  function blackHoleShape(prm) {
    const spin = prm.kerr ? Math.min(0.99, prm.spin) : 0, key = [prm.rs, prm.reach, spin, !!prm.both].join();
    if (key === bhKey) return bhVal;
    const M = prm.rs / 2, a = spin * M, rp = M + Math.sqrt(M * M - a * a), rm = M - Math.sqrt(M * M - a * a), R = Math.max(prm.reach, rp * 1.05);
    const rho2 = r => r * r + a * a + 2 * M * a * a / r, rho = r => Math.sqrt(rho2(r)), drho = r => (r - M * a * a / (r * r)) / rho(r);
    // dW/ds = 2√(r²/(r − r₋) − s² ρ'²), finite at the horizon; integrated with Simpson's rule on a fine grid
    const smax = Math.sqrt(R - rp), NS = 512, W = new Float64Array(NS + 1), dW = new Float64Array(NS + 1);
    let unembeddable = false;
    const f = s => { const r = rp + s * s, v = r * r / (r - rm) - s * s * drho(r) ** 2; if (v < 0) unembeddable = true; return 2 * Math.sqrt(Math.max(0, v)); };
    for (let j = 0; j <= NS; j++) dW[j] = f(smax * j / NS);
    for (let j = 1; j <= NS; j++) { const s0 = smax * (j - 1) / NS, s1 = smax * j / NS; W[j] = W[j - 1] + (s1 - s0) / 6 * (dW[j - 1] + 4 * f((s0 + s1) / 2) + dW[j]); }
    const Ws = s => { const u = Math.min(NS, Math.max(0, Math.abs(s) / smax * NS)), j = Math.min(NS - 1, Math.floor(u)), t = u - j; return Math.sign(s || 1) * (W[j] + (W[j + 1] - W[j]) * t); };
    const Wr = r => Ws(Math.sqrt(Math.max(0, r - rp)));
    const wmax = W[NS], both = !!prm.both;
    // the clock rate of an observer swept round with the space (the lapse √(ΣΔ/A)), and the ergosphere r_E = M + √(M² − a² cos²θ)
    const lapse = (r, c) => { const D = r * r - 2 * M * r + a * a, S2 = r * r + a * a * c * c, A = (r * r + a * a) ** 2 - a * a * D * (1 - c * c); return Math.sqrt(Math.max(0, S2 * D / A)); };
    const ergo = c => M + Math.sqrt(Math.max(0, M * M - a * a * c * c));
    // circular photon orbits on the equator: prograde and retrograde
    const rph = sg => 2 * M * (1 + Math.cos(2 / 3 * Math.acos(-sg * a / M)));
    bhKey = key;
    bhVal = { M, a, spin, rp, rm, R, rho, Ws, Wr, W, dW, NS, smax, wmax, both, shift: both ? 0 : -wmax / 2, lapse, ergo, rph, unembeddable };
    return bhVal;
  }
  // a photon in the equatorial plane of a Kerr black hole, from far away along +x at height h above the axis.
  // With Mino time τ (dλ = r² dτ): (dr/dτ)² = R(r) = (r² + a² − ab)² − Δ(b − a)², dφ/dτ = (b − a) + a(r² + a² − ab)/Δ,
  // where b = L/E = −h, and d²r/dτ² = R'(r)/2 carries the ray smoothly through its closest approach.
  function kerrPhoton(G, h) {
    const { M, a, rp, R } = G, b = -h, Rf = r => (r * r + a * a - a * b) ** 2 - (r * r - 2 * M * r + a * a) * (b - a) ** 2;
    const dRf = r => 4 * r * (r * r + a * a - a * b) - (2 * r - 2 * M) * (b - a) ** 2;
    const dphi = r => { const D = r * r - 2 * M * r + a * a; return (b - a) + a * (r * r + a * a - a * b) / D; };
    let r = R, v = -Math.sqrt(Math.max(0, Rf(R))), phi = Math.atan2(h, -Math.sqrt(Math.max(0, R * R - h * h)));
    const pts = [[r, phi]];
    let fell = false;
    for (let n = 0; n < 20000; n++) {
      const dt = 0.006 / (Math.abs(v) / r + Math.abs(dphi(r)) + 1e-9);
      // RK4 on (r, v, φ)
      const k1r = v, k1v = dRf(r) / 2, k1p = dphi(r);
      const r2 = r + dt / 2 * k1r, v2 = v + dt / 2 * k1v, k2r = v2, k2v = dRf(r2) / 2, k2p = dphi(r2);
      const r3 = r + dt / 2 * k2r, v3 = v + dt / 2 * k2v, k3r = v3, k3v = dRf(r3) / 2, k3p = dphi(r3);
      const r4 = r + dt * k3r, v4 = v + dt * k3v, k4r = v4, k4v = dRf(r4) / 2, k4p = dphi(r4);
      const rP = r, pP = phi;
      r += dt / 6 * (k1r + 2 * k2r + 2 * k3r + k4r); v += dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v); phi += dt / 6 * (k1p + 2 * k2p + 2 * k3p + k4p);
      // keep v² = R(r) exactly, except near a turning point (R small), where v has to be free to change sign
      const Rn = Rf(r);
      if (Rn > 1e-4 * r ** 4) v = (v < 0 ? -1 : 1) * Math.sqrt(Rn);
      const end = r <= rp * (1 + 2e-3) ? rp * (1 + 2e-3) : r >= R && v > 0 ? R : 0;
      if (end) { pts.push([end, pP + (phi - pP) * (end - rP) / (r - rP)]); fell = end !== R; break; }
      pts.push([r, phi]);
    }
    return { pts, fell };
  }
  // photon path in its plane, from far away along +x with impact parameter b; returns plane points [x, y] and whether it fell in
  function photon(rs, R, b) {
    const u0 = 1 / R, d0 = 1 / (b * b) - u0 * u0 + rs * u0 ** 3;
    const phi0 = Math.atan2(b, -Math.sqrt(Math.max(0, R * R - b * b)));
    let u = u0, du = Math.sqrt(Math.max(0, d0)), psi = 0, fell = false;
    const pts = [], h = 0.01, acc = (uu) => 1.5 * rs * uu * uu - uu;
    for (let n = 0; n < 4000; n++) {
      const r = 1 / u, phi = phi0 - psi;
      pts.push([r * Math.cos(phi), r * Math.sin(phi)]);
      // RK4 for u'' = 1.5 rₛ u² − u
      const k1u = du, k1v = acc(u), k2u = du + h / 2 * k1v, k2v = acc(u + h / 2 * k1u), k3u = du + h / 2 * k2v, k3v = acc(u + h / 2 * k2u), k4u = du + h * k3v, k4v = acc(u + h * k3u);
      const uP = u, psiP = psi;
      u += h / 6 * (k1u + 2 * k2u + 2 * k3u + k4u); du += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v); psi += h;
      // end exactly where the ray crosses the horizon or leaves the drawn region
      const end = u >= 1 / rs ? 1 / rs : u < u0 && du < 0 ? u0 : 0;
      if (end) {
        const p2 = phi0 - (psiP + (psi - psiP) * (end - uP) / (u - uP));
        pts.push([Math.cos(p2) / end, Math.sin(p2) / end]); fell = end !== u0; break;
      }
    }
    return { pts, fell };
  }
  function blackHole(prm) {
    const G = blackHoleShape(prm), { M, a, rp, R, rho, Ws, Wr, shift, both } = G, Mesh_ = new Mesh(), MM = Mesh_;
    const ERGO = [0.58, 0.36, 0.92];
    // colour by the lapse, tinted violet inside the ergosphere
    const shade = (r, c) => { const col = clockColor(G.lapse(r, c)); return a > 0 && r < G.ergo(c) ? col.map((v, q) => v * 0.45 + ERGO[q] * 0.55) : col; };
    const pos = (r, n, w) => [rho(r) * n[0], r * n[1], rho(r) * n[2], w + shift];
    const { v: sph, f: tri } = icosphere(prm.detail), L = 6 + 8 * prm.detail * (both ? 2 : 1);
    const s0 = both ? -G.smax : 0, layer = [], sOf = k => s0 + (G.smax - s0) * k / L, rOfS = s => rp + s * s;
    for (let k = 0; k <= L; k++) { const s = sOf(k), r = rOfS(s), w = Ws(s); layer.push(sph.map(n => MM.pt(pos(r, n, w)))); }
    // each triangle of the sphere times each layer is a prism, split by vertex order so neighbours agree
    for (let k = 0; k < L; k++) {
      const r = rOfS((sOf(k) + sOf(k + 1)) / 2);
      for (const t of tri) {
        const [p, q, u] = t.slice().sort((x, y) => x - y), A = layer[k], B = layer[k + 1];
        const c = (sph[p][1] + sph[q][1] + sph[u][1]) / 3, col = shade(r, c);
        MM.tet(A[p], A[q], A[u], B[p], col); MM.tet(A[q], A[u], B[p], B[q], col); MM.tet(A[u], B[p], B[q], B[u], col);
      }
    }
    // the classic picture: the equatorial plane y = 0 as a funnel, with rings and spokes
    const eq = (r, ph, w) => [rho(r) * Math.cos(ph), 0, rho(r) * Math.sin(ph), w + shift];
    if (prm.funnel) {
      const NA = 72, idx = [];
      for (let k = 0; k <= L; k++) { const s = sOf(k), r = rOfS(s), w = Ws(s); idx.push(Array.from({ length: NA }, (_, j) => MM.pt(eq(r, 2 * Math.PI * j / NA, w)))); }
      for (let k = 0; k < L; k++) {
        const col = shade(rOfS((sOf(k) + sOf(k + 1)) / 2), 0);
        for (let j = 0; j < NA; j++) { const j2 = (j + 1) % NA; MM.tri(idx[k][j], idx[k + 1][j], idx[k + 1][j2], col); MM.tri(idx[k][j], idx[k + 1][j2], idx[k][j2], col); }
      }
      for (let k = 0; k <= L; k += 2) for (let j = 0; j < NA; j++) MM.edge(idx[k][j], idx[k][(j + 1) % NA]);
      for (let j = 0; j < NA; j += 6) for (let k = 0; k < L; k++) MM.edge(idx[k][j], idx[k + 1][j]);
    }
    // rings on the funnel: horizon, ergosphere, photon orbits
    const ring = (r, col, side) => { const w = side * Wr(r), pts = []; for (let j = 0; j < 120; j++) pts.push(eq(r, 2 * Math.PI * j / 120, w)); MM.curve(pts, true, col); };
    ring(rp, [1, 0.3, 0.12], 0);
    const sides = both ? [1, -1] : [1];
    if (a > 0 && 2 * M < R) for (const sd of sides) ring(2 * M, ERGO, sd);
    const orbits = a > 0 ? [G.rph(1), G.rph(-1)] : [3 * M];
    for (const ro of orbits) if (ro < R) for (const sd of sides) ring(ro, [0.98, 0.75, 0.3], sd);
    // light rays: a beam along +x; for a spinning hole, in the equatorial plane only (other planes need the full Carter motion)
    let fell = 0, nr = 0;
    const bc = a > 0 ? 3 * Math.sqrt(3) * M : 1.5 * Math.sqrt(3) * prm.rs, planes = a > 0 ? 1 : prm.planes;
    for (let pl = 0; pl < planes; pl++) {
      const th = Math.PI * pl / planes, ny = Math.sin(th), nz = Math.cos(th);
      for (let i = 0; i < prm.rays; i++) {
        const h = bc * prm.beam * (prm.rays === 1 ? 1 : (2 * i / (prm.rays - 1) - 1)) || 1e-3 * bc;
        let pts, f;
        if (a > 0) {
          const P = kerrPhoton(G, h); f = P.fell;
          pts = P.pts.map(([r, ph]) => eq(r, ph, Wr(r)));
        } else {
          const P = photon(prm.rs, R, Math.max(Math.abs(h), 1e-4)), sg = h < 0 ? -1 : 1; f = P.fell;
          pts = P.pts.map(([x, y]) => { const r = Math.hypot(x, y); return [x, sg * y * ny, sg * y * nz, Wr(r) + shift]; });
        }
        // keep a point only once it has moved on visibly (rays falling in wind tightly near the horizon)
        const kept = [pts[0]];
        for (let q = 1; q < pts.length; q++) { const l = kept[kept.length - 1], p = pts[q]; if (q === pts.length - 1 || Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2], p[3] - l[3]) > 0.006) kept.push(p); }
        pts = kept;
        if (f) fell++;
        nr++;
        const near = Math.min(1, Math.abs(Math.abs(h) - bc) / bc * 4);
        MM.curve(pts, false, f ? [0.95, 0.35, 0.72] : [0.98 - 0.1 * (1 - near), 0.98 - 0.04 * (1 - near), 1]);
      }
    }
    const rows = a > 0 ? [
      ['Space', `the Kerr geometry at one instant, spin a = ${G.spin.toFixed(2)} M (Boyer–Lindquist t = const)`],
      ['In 4D', 'the equator y = 0 is embedded exactly; off it, each direction takes the equator’s depth at the same r (a picture, not an exact embedding)'],
      ['Horizon', `r₊ = ${(rp / M).toFixed(3)} M: an oblate spheroid; its equator always has circumference 4πM`],
      ['Ergosphere', 'violet, out to r = M + √(M² − a² cos²θ): space is dragged round so hard that nothing there can stand still'],
      ['Light', `equatorial photon orbits at ${(G.rph(1) / M).toFixed(2)} M (with the spin) and ${(G.rph(-1) / M).toFixed(2)} M (against it); rays crossing on the side that turns with the hole get closer before falling in`],
      ['Colour', 'how fast the clock of an observer carried round with the space runs: red is slow, blue is nearly normal'],
    ] : [
      ['Space', 'ds² = dr²/(1 − rₛ/r) + r² dΩ², the Schwarzschild geometry at one instant'],
      ['In 4D', 'exactly the hypersurface w = 2√(rₛ(r − rₛ)): Flamm’s paraboloid, one dimension up'],
      ['Colour', 'how fast a clock held still there runs, √(1 − rₛ/r): red is slow, blue is nearly normal'],
      ['Horizon', `r = rₛ = ${prm.rs.toFixed(2)}, the throat (red ring)${both ? '; past it, the second sheet of the Einstein–Rosen bridge' : ''}`],
      ['Light', `photon sphere at 1.5 rₛ (amber ring); white rays escape, bent; pink rays, with impact parameter below (3√3/2) rₛ = ${bc.toFixed(3)}, fall in`],
    ];
    if (G.unembeddable) rows.push(['Note', 'part of the equator cannot be embedded at this spin; its depth is held flat there']);
    rows.push(['Slices', 'y = 0 is the classic funnel; GPU shows the space as a thin shell']);
    return MM.done({
      sliceTube: 0, tubeR: prm.tube,
      info: { name: a > 0 ? 'Kerr black hole' : 'Black hole', sub: a > 0 ? `rotating, a = ${G.spin.toFixed(2)} M, rₛ = ${prm.rs.toFixed(2)}` : `Schwarzschild space in E⁴, rₛ = ${prm.rs.toFixed(2)}`, counts: [['rays', nr], ['fall in', fell], ['tets', MM.tets.length / 4], ['layers', L]], rows },
    });
  }

  root.Objects = { polytope, clifford, hopf, hopfBase, fibrePoint, fractal, FRACTALS, hopfColor, hsl, mountain, mountainHeights, KUHN, tree, treeData, ICOSA, LSYS_PRESETS, blackHole, blackHoleShape, photon, kerrPhoton };
  if (typeof module !== 'undefined') module.exports = root.Objects;
})(typeof window !== 'undefined' ? window : globalThis);
