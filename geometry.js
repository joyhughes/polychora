// Regular polychora (the 6 convex + the 10 Schläfli–Hess star polychora).
// Every polytope is built the same way: pick a vertex set on the unit 3-sphere,
// a set of cell-centre directions, the cell's hyperplane height h and the edge
// cosine e. Each cell is the layer {v : v·n = h}; its faces are the planar
// p-cycles of the edge graph inside that layer. Faces are shared between cells.
(function (root) {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const TOL = 1e-6;
  const C36 = Math.cos(Math.PI / 5), C60 = 0.5, C72 = Math.cos(2 * Math.PI / 5), C108 = -C72;
  // found by searching the layers of the 600-cell / 120-cell (see README)
  const GRAND_H = 0.1350453783688632, GGS_E = -0.7135254915624211;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2], a[3]); return a.map(x => x / l); };

  function evenPerms() {
    const out = [];
    const perm = (arr, k) => {
      if (k === arr.length) {
        let inv = 0;
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (arr[i] > arr[j]) inv++;
        if (inv % 2 === 0) out.push(arr.slice());
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    perm([0, 1, 2, 3], 0);
    return out;
  }

  function signs(base) {
    // all sign combinations of the non-zero entries
    let out = [base.slice()];
    for (let i = 0; i < 4; i++) {
      if (base[i] === 0) continue;
      out = out.flatMap(v => { const w = v.slice(); w[i] = -w[i]; return [v, w]; });
    }
    return out;
  }

  function dedupe(pts) {
    const out = [];
    for (const p of pts) if (!out.some(q => dot(p, q) > 1 - TOL)) out.push(p);
    return out;
  }

  // 600-cell vertices (the 120 unit icosians)
  function verts600() {
    const pts = [];
    for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const v = [0, 0, 0, 0]; v[i] = s; pts.push(v); }
    for (const v of signs([0.5, 0.5, 0.5, 0.5])) pts.push(v);
    const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
    for (const p of evenPerms()) {
      const v = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) v[p[i]] = base[i];
      for (const s of signs(v)) pts.push(s);
    }
    return dedupe(pts);
  }

  // 120-cell vertex directions = centres of the 600-cell's 600 tetrahedra
  function verts120(V) {
    const n = V.length, adj = [];
    for (let i = 0; i < n; i++) adj.push(new Set());
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.abs(dot(V[i], V[j]) - C36) < TOL) { adj[i].add(j); adj[j].add(i); }
    const out = [];
    for (let a = 0; a < n; a++) for (const b of adj[a]) {
      if (b <= a) continue;
      for (const c of adj[b]) {
        if (c <= b || !adj[a].has(c)) continue;
        for (const d of adj[c]) {
          if (d <= c || !adj[a].has(d) || !adj[b].has(d)) continue;
          out.push(norm([0, 1, 2, 3].map(k => V[a][k] + V[b][k] + V[c][k] + V[d][k])));
        }
      }
    }
    return out;
  }

  function simplex() {
    const E = [0, 1, 2, 3, 4].map(i => [0, 1, 2, 3, 4].map(j => (i === j ? 1 : 0) - 0.2));
    const basis = [];
    for (let i = 0; i < 4; i++) {
      let v = [0, 0, 0, 0, 0]; v[i] = 1; v[i + 1] = -1;
      for (const b of basis) { const d = v.reduce((s, x, k) => s + x * b[k], 0); v = v.map((x, k) => x - d * b[k]); }
      const l = Math.hypot(...v); basis.push(v.map(x => x / l));
    }
    return E.map(p => norm(basis.map(b => b.reduce((s, x, k) => s + x * p[k], 0))));
  }

  function planar(pts) {
    // rank of {p_k - p_0} must be 2
    const o = pts[0], basis = [];
    for (let k = 1; k < pts.length; k++) {
      let v = [0, 1, 2, 3].map(i => pts[k][i] - o[i]);
      for (const b of basis) { const d = dot(v, b); v = v.map((x, i) => x - d * b[i]); }
      const l = Math.hypot(...v);
      if (l > 1e-5) { if (basis.length === 2) return false; basis.push(v.map(x => x / l)); }
    }
    return basis.length === 2;
  }

  function cyclesInLayer(S, V, e, p) {
    const adj = new Map(S.map(i => [i, S.filter(j => j !== i && Math.abs(dot(V[i], V[j]) - e) < TOL)]));
    const out = [];
    for (const s of S) {
      const path = [s];
      const dfs = u => {
        if (path.length === p) {
          if (adj.get(u).includes(s) && path[1] < path[p - 1]) out.push(path.slice());
          return;
        }
        for (const w of adj.get(u)) if (w > s && !path.includes(w)) { path.push(w); dfs(w); path.pop(); }
      };
      dfs(s);
    }
    return out.filter(c => p === 3 || planar(c.map(i => V[i])));
  }

  function build(spec, V, C) {
    const faceKey = new Map(), faces = [], faceCells = [], cells = [];
    for (const n of C) {
      const S = [];
      for (let i = 0; i < V.length; i++) if (Math.abs(dot(V[i], n) - spec.h) < TOL) S.push(i);
      const cf = [];
      for (const cyc of cyclesInLayer(S, V, spec.e, spec.p)) {
        const key = cyc.slice().sort((a, b) => a - b).join(',');
        let f = faceKey.get(key);
        if (f === undefined) { f = faces.length; faceKey.set(key, f); faces.push(cyc); faceCells.push([]); }
        faceCells[f].push(cells.length);
        cf.push(f);
      }
      cells.push({ center: n.map(x => x * spec.h), faces: cf, nverts: S.length });
    }
    const edgeKey = new Set(), edges = [];
    for (const f of faces) for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], key = a < b ? a + ',' + b : b + ',' + a;
      if (!edgeKey.has(key)) { edgeKey.add(key); edges.push([a, b]); }
    }
    const used = new Set(faces.flat());
    return { verts: V, faces, faceCells, cells, edges, nverts: used.size };
  }

  const CATALOG = [
    { id: 'pentachoron', name: '5-cell', sym: '{3,3,3}', cell: 'tetrahedron', face: 'triangle', vf: 'tetrahedron', density: 1, set: 'simplex', cdir: 'antisimplex', h: 0.25, e: -0.25, p: 3, kind: 'convex' },
    { id: 'tesseract', name: 'Tesseract', sym: '{4,3,3}', cell: 'cube', face: 'square', vf: 'tetrahedron', density: 1, set: 'tess', cdir: 'axes', h: 0.5, e: 0.5, p: 4, kind: 'convex' },
    { id: 'hexadecachoron', name: '16-cell', sym: '{3,3,4}', cell: 'tetrahedron', face: 'triangle', vf: 'octahedron', density: 1, set: 'axes', cdir: 'tess', h: 0.5, e: 0, p: 3, kind: 'convex' },
    { id: 'icositetrachoron', name: '24-cell', sym: '{3,4,3}', cell: 'octahedron', face: 'triangle', vf: 'cube', density: 1, set: 'c24', cdir: 'c24dual', h: Math.SQRT1_2, e: 0.5, p: 3, kind: 'convex' },
    { id: 'hecatonicosachoron', name: '120-cell', sym: '{5,3,3}', cell: 'dodecahedron', face: 'pentagon', vf: 'tetrahedron', density: 1, set: 'W', cdir: 'V', h: null, e: null, p: 5, kind: 'convex' },
    { id: 'hexacosichoron', name: '600-cell', sym: '{3,3,5}', cell: 'tetrahedron', face: 'triangle', vf: 'icosahedron', density: 1, set: 'V', cdir: 'W', h: null, e: C36, p: 3, kind: 'convex' },

    { id: 'icosahedral', name: 'Icosahedral 120-cell', sym: '{3,5,5/2}', cell: 'icosahedron', face: 'triangle', vf: 'great dodecahedron', density: 4, set: 'V', cdir: 'V', h: C36, e: C36, p: 3, kind: 'star' },
    { id: 'small-stellated', name: 'Small stellated 120-cell', sym: '{5/2,5,3}', cell: 'small stellated dodecahedron', face: 'pentagram', vf: 'dodecahedron', density: 4, set: 'V', cdir: 'V', h: C36, e: C60, p: 5, kind: 'star' },
    { id: 'great', name: 'Great 120-cell', sym: '{5,5/2,5}', cell: 'great dodecahedron', face: 'pentagon', vf: 'small stellated dodecahedron', density: 6, set: 'V', cdir: 'V', h: C36, e: C36, p: 5, kind: 'star' },
    { id: 'grand', name: 'Grand 120-cell', sym: '{5,3,5/2}', cell: 'dodecahedron', face: 'pentagon', vf: 'great icosahedron', density: 20, set: 'V', cdir: 'V', h: C60, e: C36, p: 5, kind: 'star' },
    { id: 'great-stellated', name: 'Great stellated 120-cell', sym: '{5/2,3,5}', cell: 'great stellated dodecahedron', face: 'pentagram', vf: 'icosahedron', density: 20, set: 'V', cdir: 'V', h: C60, e: C108, p: 5, kind: 'star' },
    { id: 'grand-stellated', name: 'Grand stellated 120-cell', sym: '{5/2,5,5/2}', cell: 'small stellated dodecahedron', face: 'pentagram', vf: 'great dodecahedron', density: 66, set: 'V', cdir: 'V', h: C72, e: C108, p: 5, kind: 'star' },
    { id: 'great-grand', name: 'Great grand 120-cell', sym: '{5,5/2,3}', cell: 'great dodecahedron', face: 'pentagon', vf: 'great stellated dodecahedron', density: 76, set: 'V', cdir: 'V', h: C72, e: C60, p: 5, kind: 'star' },
    { id: 'great-icosahedral', name: 'Great icosahedral 120-cell', sym: '{3,5/2,5}', cell: 'great icosahedron', face: 'triangle', vf: 'small stellated dodecahedron', density: 76, set: 'V', cdir: 'V', h: C72, e: C108, p: 3, kind: 'star' },
    { id: 'grand-600', name: 'Grand 600-cell', sym: '{3,3,5/2}', cell: 'tetrahedron', face: 'triangle', vf: 'great icosahedron', density: 191, set: 'V', cdir: 'W', h: GRAND_H, e: C108, p: 3, kind: 'star' },
    { id: 'great-grand-stellated', name: 'Great grand stellated 120-cell', sym: '{5/2,3,3}', cell: 'great stellated dodecahedron', face: 'pentagram', vf: 'tetrahedron', density: 191, set: 'W', cdir: 'V', h: GRAND_H, e: GGS_E, p: 5, kind: 'star' },

    { id: 'permutohedron', name: 'Permutohedron', sym: 't₀₁₂₃{3,3,3}', cell: '10 truncated octahedra, 20 hexagonal prisms', face: '90 squares, 60 hexagons', vf: 'irregular tetrahedron', density: 1, kind: 'uniform', build: permutohedron, family: 'omnitruncated 5-cell; vertices are the 120 orderings of 1–5' },
  ];

  // ---- polytopes given by their facet hyperplanes (not regular, so cells sit at different heights) ----
  // Each cell is the set of vertices maximising n·v; each face is where two cells share a 2D set of vertices,
  // ordered around by the edge graph.
  function fromFacets(V, normals, e) {
    const cells = [], faces = [], faceCells = [], faceKey = new Map();
    const layers = normals.map(n => { let m = -Infinity; for (const v of V) m = Math.max(m, dot(v, n)); return { n, h: m, S: V.map((v, i) => i).filter(i => Math.abs(dot(V[i], n) - m) < TOL) }; });
    const adj = V.map((v, i) => V.map((w, j) => j).filter(j => j !== i && Math.abs(dot(v, V[j]) - e) < TOL));
    layers.forEach((L, ci) => {
      const cf = [];
      layers.forEach((M, cj) => {
        if (cj === ci) return;
        const common = L.S.filter(i => M.S.includes(i));
        if (common.length < 3 || !planar(common.map(i => V[i]))) return;
        const key = common.slice().sort((a, b) => a - b).join(',');
        let f = faceKey.get(key);
        if (f === undefined) {
          // walk the face's boundary along edges
          const cyc = [common[0]];
          while (cyc.length < common.length) {
            const last = cyc[cyc.length - 1], nx = adj[last].find(j => common.includes(j) && !cyc.includes(j));
            if (nx === undefined) break;
            cyc.push(nx);
          }
          f = faces.length; faceKey.set(key, f); faces.push(cyc); faceCells.push([]);
        }
        faceCells[f].push(ci); cf.push(f);
      });
      // the foot of the perpendicular is the cell's centre for these symmetric cells
      cells.push({ center: L.n.map(x => x * L.h), faces: cf, nverts: L.S.length });
    });
    const edgeKey = new Set(), edges = [];
    for (const f of faces) for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], key = a < b ? a + ',' + b : b + ',' + a;
      if (!edgeKey.has(key)) { edgeKey.add(key); edges.push([a, b]); }
    }
    return { verts: V, faces, faceCells, cells, edges, nverts: new Set(faces.flat()).size };
  }

  // 4D permutohedron (omnitruncated 5-cell): the permutations of (1, 2, 3, 4, 5), which lie in the hyperplane
  // Σx = 15. Facets: Σ over a subset S of the coordinates ≥ 1 + … + |S|, for each of the 30 nonempty proper subsets.
  function permutohedron() {
    const basis = [];
    for (let i = 0; i < 4; i++) {
      let v = [0, 0, 0, 0, 0]; v[i] = 1; v[i + 1] = -1;
      for (const b of basis) { const d = v.reduce((s, x, k) => s + x * b[k], 0); v = v.map((x, k) => x - d * b[k]); }
      const l = Math.hypot(...v); basis.push(v.map(x => x / l));
    }
    const to4 = p => basis.map(b => b.reduce((s, x, k) => s + x * p[k], 0));
    const perms = [];
    const gen = (a, k) => { if (k === 5) { perms.push(a.slice()); return; } for (let i = k; i < 5; i++) { [a[k], a[i]] = [a[i], a[k]]; gen(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
    gen([1, 2, 3, 4, 5], 0);
    const R = Math.sqrt(10); // |(−2, −1, 0, 1, 2)|
    const V = perms.map(p => to4(p.map(x => (x - 3) / R)));
    const normals = [];
    for (let m = 1; m < 31; m++) {
      const S = [0, 1, 2, 3, 4].map(i => (m >> i) & 1), k = S.reduce((a, b) => a + b);
      normals.push(norm(to4(S.map(x => k / 5 - x)))); // outward: small sums on S
    }
    return fromFacets(V, normals, 1 - 1 / 10);
  }

  let sets = null;
  function getSets() {
    if (sets) return sets;
    const V = verts600(), W = verts120(V), S = simplex();
    const axes = []; for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const v = [0, 0, 0, 0]; v[i] = s; axes.push(v); }
    const tess = signs([0.5, 0.5, 0.5, 0.5]);
    const c24 = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const v = [0, 0, 0, 0]; v[i] = Math.SQRT1_2; v[j] = Math.SQRT1_2; c24.push(...signs(v));
    }
    sets = { V, W, simplex: S, antisimplex: S.map(v => v.map(x => -x)), axes, tess, c24, c24dual: axes.concat(tess) };
    return sets;
  }

  function layerValues(a, B) {
    // distinct dot values of a against B, descending, excluding a itself
    const vals = [];
    for (const b of B) { const d = dot(a, b); if (d < 1 - TOL && !vals.some(x => Math.abs(x - d) < TOL)) vals.push(d); }
    return vals.sort((x, y) => y - x);
  }

  const cache = new Map();
  function polytope(id) {
    if (cache.has(id)) return cache.get(id);
    const spec = { ...CATALOG.find(s => s.id === id) };
    if (spec.build) { const P = spec.build(); P.spec = spec; cache.set(id, P); return P; }
    const st = getSets(), V = st[spec.set], C = st[spec.cdir];
    if (spec.h === null) spec.h = layerValues(C[0], V)[0];
    if (spec.e === null) spec.e = layerValues(V[0], V)[0];
    const P = build(spec, V, C);
    P.spec = spec;
    cache.set(id, P);
    return P;
  }

  root.Polychora = { CATALOG, polytope, getSets, build, layerValues, dot, consts: { C36, C60, C72, C108, PHI } };
  if (typeof module !== 'undefined') module.exports = root.Polychora;
})(typeof window !== 'undefined' ? window : globalThis);
