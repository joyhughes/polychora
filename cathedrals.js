// Famous cathedrals lifted into four dimensions.
// y is up and the ground is the 3D space (x, z, w). The nave runs along x. The building's sideways direction z
// is doubled: whatever stands on the ±z sides of the real building also stands on the ±w sides, and anything
// round in plan (a dome, a drum, an apse, a round tower) is round in all three ground directions, so its
// cross-sections are balls. The slice w = 0 is close to the real building; turning in the zw plane, or moving
// the slice through w, brings the other sides into view.
// Every building is a union of convex 4D parts (boxes, hip roofs, solids of revolution, beams), each the convex
// hull of its corner points, grouped so that renderers can skip whole groups that a ray or point misses.
(function (root) {
  const O = root.Objects;
  const TAU = 2 * Math.PI, DEG = Math.PI / 180;

  // ---------- cross-sections: unit polyhedra in the ground space (x, z, w) ----------
  // a latitude–longitude ball with its poles on w, so the slice w = 0 meets its equator, a regular polygon
  function uvBall(nl, nm) {
    const V = [[0, 0, 1], [0, 0, -1]];
    for (let i = 0; i < nl; i++) {
      const th = -Math.PI / 2 + Math.PI * (i + 1) / (nl + 1), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < nm; k++) { const ph = TAU * k / nm; V.push([c * Math.cos(ph), c * Math.sin(ph), Math.abs(s) < 1e-12 ? 0 : s]); }
    }
    return V;
  }
  const CUBE = [];
  for (let m = 0; m < 8; m++) CUBE.push([m & 1 ? -1 : 1, m & 2 ? -1 : 1, m & 4 ? -1 : 1]);
  // the rhombicuboctahedron: every slice through its centre along a coordinate plane is a regular octagon
  const RCO = [];
  {
    const a = 1 + Math.SQRT2, l = Math.hypot(1, 1, a);
    for (const p of [[1, 1, a], [1, a, 1], [a, 1, 1]]) for (let m = 0; m < 8; m++) RCO.push(p.map((x, k) => (m >> k & 1 ? -x : x) / l));
  }
  // the octagonal sections' apothem is (1 + √2)/|v|: scale it to 1
  const RCO_UNIT = RCO.map(p => p.map(x => x * Math.hypot(1, 1, 1 + Math.SQRT2) / (1 + Math.SQRT2)));
  function polyOf(kind, detail) {
    if (kind === 'cube') return { V: CUBE, round: false };
    if (kind === 'oct') return { V: RCO_UNIT, round: false };
    const [nl, nm] = { s: [[1, 6], [2, 8], [3, 10]], m: [[2, 8], [3, 12], [5, 16]], l: [[3, 12], [5, 16], [7, 24]] }[kind][detail - 1];
    return { V: uvBall(nl, nm), round: true, nl, nm };
  }
  // the half of a polyhedron on the side d·p ≥ 0 (d a ground axis): for a shape mirror-symmetric across that
  // plane, its section by the plane is the projection of all its corners onto it
  function halfPoly(V, d) {
    const out = [];
    for (const p of V) {
      const t = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
      if (t >= -1e-12) out.push(p);
      out.push([p[0] - t * d[0], p[1] - t * d[1], p[2] - t * d[2]]);
    }
    return out;
  }

  // the faces of a convex polyhedron given by its corners, each an ordered polygon
  function hull3Faces(V) {
    const F = [], seen = new Set(), d3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) for (let k = j + 1; k < V.length; k++) {
      const a = V[i], u = V[j].map((x, q) => x - a[q]), v = V[k].map((x, q) => x - a[q]);
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n); if (l < 1e-9) continue;
      n = n.map(x => x / l); let h = d3(n, a);
      let pos = 0, neg = 0;
      for (const p of V) { const t = d3(n, p) - h; if (t > 1e-9) pos++; else if (t < -1e-9) neg++; }
      if (pos && neg) continue;
      if (pos) { n = n.map(x => -x); h = -h; }
      const key = n.map(x => Math.round(x * 1e6)).join() + '|' + Math.round(h * 1e6);
      if (seen.has(key)) continue;
      seen.add(key);
      const on = V.filter(p => Math.abs(d3(n, p) - h) < 1e-9), c = [0, 1, 2].map(q => on.reduce((s, p) => s + p[q], 0) / on.length);
      const e1 = on[0].map((x, q) => x - c[q]), l1 = Math.hypot(...e1), u1 = e1.map(x => x / l1), u2 = [n[1] * u1[2] - n[2] * u1[1], n[2] * u1[0] - n[0] * u1[2], n[0] * u1[1] - n[1] * u1[0]];
      F.push(on.slice().sort((p, q) => Math.atan2(d3(p.map((x, m) => x - c[m]), u2), d3(p.map((x, m) => x - c[m]), u1)) - Math.atan2(d3(q.map((x, m) => x - c[m]), u2), d3(q.map((x, m) => x - c[m]), u1))));
    }
    return F;
  }
  // a polygon cut to the side d·p ≥ 0 (dropping one that lies in the plane: that side stays open)
  function clipPoly(f, d) {
    const s = f.map(p => p[0] * d[0] + p[1] * d[1] + p[2] * d[2]);
    if (s.every(x => Math.abs(x) < 1e-9)) return [];
    const out = [];
    for (let i = 0; i < f.length; i++) {
      const j = (i + 1) % f.length;
      if (s[i] >= -1e-9) out.push(f[i]);
      if ((s[i] > 1e-9 && s[j] < -1e-9) || (s[i] < -1e-9 && s[j] > 1e-9)) { const t = s[i] / (s[i] - s[j]); out.push(f[i].map((x, q) => x + t * (f[j][q] - x))); }
    }
    return out;
  }
  function polyFaces(kind, detail, half) {
    const P = polyOf(kind, detail);
    let F;
    if (P.round) {
      const { nl, nm } = P, V = P.V, ring = (i, k) => V[2 + i * nm + ((k % nm) + nm) % nm];
      F = [];
      for (let k = 0; k < nm; k++) F.push([V[1], ring(0, k + 1), ring(0, k)]);
      for (let i = 0; i + 1 < nl; i++) for (let k = 0; k < nm; k++) F.push([ring(i, k), ring(i, k + 1), ring(i + 1, k + 1), ring(i + 1, k)]);
      for (let k = 0; k < nm; k++) F.push([V[0], ring(nl - 1, k), ring(nl - 1, k + 1)]);
    } else F = hull3Faces(P.V);
    if (half) F = F.map(f => clipPoly(f, half)).filter(f => f.length >= 3);
    return { F, round: P.round };
  }

  // ---------- small 4D helpers ----------
  const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sub4 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
  // ground point (x, z, w) at height y as a 4D point (x, y, z, w)
  const G4 = (g, y) => [g[0], y, g[1], g[2]];

  // ---------- the builder ----------
  // Parts are recorded as point sets in a tree of groups; transforms (quarter turns, moves) apply as they are added.
  // Parts and carves are kept in the order they were made: a carve cuts every part made before it.
  function Builder(detail) {
    const top = { kids: [] }, stack = [top], ops = [], spots = [];
    let xf = p => p;
    const B = {
      detail, ops, spots,
      group(fn) { const g = { kids: [] }; stack[stack.length - 1].kids.push(g); stack.push(g); fn(); stack.pop(); },
      // a convex part: the hull of pts. opt.axis: a point on the vertical axis of a solid of revolution (smooth
      // shading); opt.real: sets of point indices, each lying in one real face (any other cell is internal, a
      // seam between pieces); without it every cell is real
      hull(pts, col, opt = {}) {
        const node = { pts: pts.map(p => xf(p)), col, smooth: !!opt.smooth, axis: opt.axis ? xf(opt.axis) : null, real: opt.real || null, src: ops.length }, parent = stack[stack.length - 1];
        parent.kids.push(node); ops.push({ node, parent });
      },
      // carve the convex hull of pts out of every part made so far
      carve(pts) { ops.push({ air: pts.map(p => xf(p)) }); },
      carveBox(xr, yr, zr, wr) { B.carve(boxPts(xr, yr, zr, wr)); },
      // carve a solid of revolution (its profile must be concave: one convex piece)
      carveRev(g, prof, opt = {}) {
        const V0 = polyOf(opt.p || 'm', detail).V, V = opt.half ? halfPoly(V0, opt.half) : V0, P = [];
        for (const [y, r] of prof) { if (r < 1e-9) P.push(G4(g, y)); else for (const v of V) P.push([g[0] + r * v[0], y, g[1] + r * v[1], g[2] + r * v[2]]); }
        B.carve(P);
      },
      // a place to stand, on the floor at height y0, first looking up at pitch (radians)
      spot(name, g, y0 = 0, pitch = 0.08) { spots.push({ name, p: xf([g[0], y0 + 0.17, g[1], g[2]]), pitch }); },
      with(f, fn) { const old = xf; xf = p => old(f(p)); fn(); xf = old; },
      // quarter turns in the plane of axes i, j (0 x, 1 y, 2 z, 3 w), q = 1, 2, 3
      turn(i, j, q, fn) {
        B.with(p => { const o = p.slice(); for (let k = 0; k < q; k++) { const a = o[i], b = o[j]; o[i] = -b; o[j] = a; } return o; }, fn);
      },
      // fn draws the +z side of the building; it is repeated on +w, −z, −w (fn gets the quarter turn, 0–3)
      sides(fn) { for (let q = 0; q < 4; q++) { if (q) B.turn(2, 3, q, () => fn(q)); else fn(0); } },
      // fn draws a feature on the ±z sides of the real building (at +z): on all four sides here
      pairs(fn) { B.sides(fn); },
      // an axis-aligned box
      box(xr, yr, zr, wr, col) {
        const P = [];
        for (const x of xr) for (const y of yr) for (const z of zr) for (const w of wr) P.push([x, y, z, w]);
        B.hull(P, col);
      },
      // a box square in z and w, centred on the nave's axis
      sq(xr, yr, h, col) { B.box(xr, yr, [-h, h], [-h, h], col); },
      // the square ring b ≤ max(|z|, |w|) ≤ h round the axis, as four slabs in a pinwheel (they do not overlap,
      // so nothing is carved twice)
      ring(xr, yr, b, h, col) { B.sides(() => B.box(xr, yr, [b, h], [-b, h], col)); },
      // a lean-to roof all round, from the ring's outer edge h at y0 up to its inner edge b at y1, in four pieces
      leanTo(xr, b, h, y0, y1, col) {
        B.sides(() => { const P = []; for (const x of xr) P.push([x, y0, h, -h], [x, y0, h, h], [x, y1, b, -b], [x, y1, b, b], [x, y0, b, -b], [x, y0, b, b]); B.hull(P, col); });
      },
      // a hip roof along x: a square of half-width h at height y0, its ridge along the axis at y0 + ht
      roof(xr, y0, ht, h, col) {
        const P = [];
        for (const x of xr) { for (const z of [-h, h]) for (const w of [-h, h]) P.push([x, y0, z, w]); P.push([x, y0 + ht, 0, 0]); }
        B.hull(P, col);
      },
      // a solid of revolution about the vertical through ground point g: profile [[y, r], …] with y increasing.
      // cols: one colour, or one per profile segment (bands). opt.p: cross-section ('s', 'm', 'l' balls, 'cube',
      // 'oct'); opt.half: keep the half towards that ground direction (an apse or a half dome)
      rev(g, prof, cols, opt = {}) {
        const poly = polyOf(opt.p || 'm', detail), V = opt.half ? halfPoly(poly.V, opt.half) : poly.V;
        const col = i => (Array.isArray(cols[0]) ? cols[i % cols.length] : cols);
        const ring = (y, r) => (r < 1e-9 ? [G4(g, y)] : V.map(v => [g[0] + r * v[0], y, g[1] + r * v[1], g[2] + r * v[2]]));
        // runs of segments where the profile is concave (and of one colour) make one convex part
        let s = 0;
        while (s < prof.length - 1) {
          let e = s + 1;
          const slope = i => (prof[i + 1][1] - prof[i][1]) / (prof[i + 1][0] - prof[i][0]);
          while (e < prof.length - 1 && slope(e) <= slope(e - 1) + 1e-9 && col(e) === col(s)) e++;
          const P = [];
          for (let i = s; i <= e; i++) P.push(...ring(prof[i][0], prof[i][1]));
          B.hull(P, col(s), { smooth: poly.round, axis: G4(g, 0) });
          s = e;
        }
      },
      // a 4-ball (as a solid of revolution)
      ball(g, y, r, col, p = 's') {
        const k = [-1, -0.7, 0, 0.7, 1];
        B.rev(g, k.map(t => [y + r * t, r * Math.sqrt(Math.max(0, 1 - t * t))]), col, { p });
      },
      // a straight beam from a to b with a square cross-section of half-width r in the three directions across it
      beam(a, b, r, col) {
        const e = sub4(b, a), L = Math.hypot(...e), u = e.map(x => x / L), B3 = [];
        for (let k = 0; k < 4 && B3.length < 3; k++) {
          let v = [0, 0, 0, 0]; v[k] = 1;
          v = sub4(v, u.map(x => x * u[k]));
          for (const q of B3) { const d = dot4(v, q); v = sub4(v, q.map(x => x * d)); }
          const l = Math.hypot(...v); if (l > 1e-6) B3.push(v.map(x => x / l));
        }
        const P = [];
        for (const end of [a, b]) for (let m = 0; m < 8; m++) P.push([0, 1, 2, 3].map(q => end[q] + r * ((m & 1 ? -1 : 1) * B3[0][q] + (m & 2 ? -1 : 1) * B3[1][q] + (m & 4 ? -1 : 1) * B3[2][q])));
        B.hull(P, col);
      },
      // a flat round window or plaque: a ball of radius r in the three axes other than `axis`, thickness t
      disc(c, axis, r, t, col, p = 's') {
        const V = polyOf(p, detail).V, others = [0, 1, 2, 3].filter(k => k !== axis), P = [];
        for (const s of [-t / 2, t / 2]) for (const v of V) { const q = c.slice(); q[axis] += s; others.forEach((k, j) => { q[k] += r * v[j]; }); P.push(q); }
        B.hull(P, col, { smooth: true, axis: null });
      },
      // ribs (or columns) standing out of a round solid of revolution along meridians: in 4D a meridian of the
      // ball cross-section is a half circle, so each rib is a fin, one convex piece per meridian step.
      // phis: longitudes; d: how far it stands out (share of the radius); t: half its width
      fins(g, prof, phis, d, t, col, p = 'l') {
        const nl = polyOf(p, detail).nl, lats = [-Math.PI / 2];
        for (let i = 0; i < nl; i++) lats.push(-Math.PI / 2 + Math.PI * (i + 1) / (nl + 1));
        lats.push(Math.PI / 2);
        for (const ph of phis) {
          const tg = [-Math.sin(ph), Math.cos(ph), 0];
          // one piece per meridian step and profile step, so no hull cuts a chord through the dome
          for (let i = 0; i + 1 < lats.length; i++) for (let j = 0; j + 1 < prof.length; j++) {
            const P = [];
            for (const th of [lats[i], lats[i + 1]]) {
              const m = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), Math.sin(th)];
              for (const [y, r] of [prof[j], prof[j + 1]]) for (const k of [1 - d, 1 + d]) for (const sg of [-t, t])
                P.push([g[0] + r * k * m[0] + sg * tg[0], y, g[1] + r * k * m[1] + sg * tg[1], g[2] + r * k * m[2] + sg * tg[2]]);
            }
            B.hull(P, col);
          }
        }
      },
      // ribs along every edge of an octagonal ('oct') solid of revolution
      edgeRibs(g, prof, d, t, col) {
        const V = RCO_UNIT, E = [];
        let best = Infinity;
        for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) best = Math.min(best, Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]));
        for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) if (Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]) < best * 1.01) E.push([V[i], V[j]]);
        for (const [a, b] of E) {
          const m = a.map((x, k) => (x + b[k]) / 2), ml = Math.hypot(...m), mu = m.map(x => x / ml), e = b.map((x, k) => x - a[k]);
          // across the edge, in the tangent plane
          let tg = [e[1] * mu[2] - e[2] * mu[1], e[2] * mu[0] - e[0] * mu[2], e[0] * mu[1] - e[1] * mu[0]];
          const tl = Math.hypot(...tg); tg = tg.map(x => x / tl);
          for (let i = 0; i + 1 < prof.length; i++) {
            const P = [];
            for (const [y, r] of [prof[i], prof[i + 1]]) for (const v of [a, b]) for (const k of [1 - d, 1 + d]) for (const sg of [-t, t])
              P.push([g[0] + r * k * v[0] + sg * tg[0], y, g[1] + r * k * v[1] + sg * tg[1], g[2] + r * k * v[2] + sg * tg[2]]);
            B.hull(P, col);
          }
        }
      },
      // a hollow solid of revolution: a shell of thickness t inside the profile, one convex piece per face of the
      // cross-section and step of the profile (grouped by step, then by runs of faces). Its ends stay open
      shell(g, prof, t, cols, opt = {}) {
        const { F, round } = polyFaces(opt.p || 'm', detail, opt.half), n = prof.length;
        const col = i => (Array.isArray(cols[0]) ? cols[i % cols.length] : cols);
        for (let s = 0; s + 1 < n; s++) B.group(() => {
          const [ya, ra] = prof[s], [yb, rb] = prof[s + 1], ia = Math.max(0, ra - t), ib = Math.max(0, rb - t);
          for (let f0 = 0; f0 < F.length; f0 += 8) B.group(() => {
            for (const f of F.slice(f0, f0 + 8)) {
              const P = [], outer = [], inner = [], rimA = [], rimB = [];
              const add = (v, r, y, tags) => { for (const tg of tags) tg.push(P.length); P.push([g[0] + r * v[0], y, g[1] + r * v[1], g[2] + r * v[2]]); };
              for (const v of f) { add(v, ra, ya, [outer, rimA]); add(v, rb, yb, [outer, rimB]); add(v, ia, ya, [inner, rimA]); add(v, ib, yb, [inner, rimB]); }
              const real = [outer, inner];
              if (s === 0) real.push(rimA);
              if (s === n - 2) real.push(rimB);
              B.hull(P, col(s), { smooth: round, axis: G4(g, 0), real });
            }
          });
        });
      },
      // a thin panel (a window's glass, a painting): a box
      panel(xr, yr, zr, wr, col) { B.box(xr, yr, zr, wr, col); },
      // A basilica's nave and aisles, carved from solid massing already made: the nave, square in z and w with
      // inner half-width b, under a vault, and aisles all round it out to inner half-width A. Between them, the
      // arcade: each arcade wall is a 3D face, and its arches open in a grid along x and w, leaving a grid of piers,
      // each with a round column. o: { x0, x1 (nave), ax (aisles' x range), piers (bay ends along x), open (x ranges
      // left to the caller, as at a crossing), wallT, A, Ao (aisles' outer half-width), aisleTop, spring, rise,
      // wallTop, vaultTop, arch ('pointed' or 'round'), colR, colCol, ribCol, glass (colours per side), clere and
      // aisleWin (window heights), oculus (round clerestory windows), branch (tree columns) }
      nave(o) {
        const { b, wallT, A, arch } = o, cells = [[-b, 0], [0, b]];
        const bays = [];
        for (let i = 0; i + 1 < o.piers.length; i++) { const xa = o.piers[i], xb = o.piers[i + 1]; if (!(o.open || []).some(([u, v]) => xa >= u - 1e-9 && xb <= v + 1e-9)) bays.push([xa, xb]); }
        B.carve(vaultPts(0, o.x0, o.x1, [0, 0], b, o.wallTop, o.vaultTop - o.wallTop, arch));
        B.sides(() => B.carveBox(o.ax, [0, o.aisleTop], [b + wallT, A], [-A, A]));
        const pq = o.pq || 0.07;
        // the arcade, run by run between the open spans
        const runs = [];
        for (const x of o.piers) { const r = runs[runs.length - 1]; if (r && bays.some(([xa, xb]) => xa === r[r.length - 1] && xb === x)) r.push(x); else runs.push([x]); }
        B.sides(() => { for (const r of runs) if (r.length > 1) for (const P of arcadePts(r, b, b - 0.02, b + wallT + 0.02, o.spring, o.rise, arch, pq)) B.carve(P); });
        // columns on the piers: on each face, at its middle and at one corner
        const xs = [...new Set(o.piers)];
        B.sides(() => {
          for (const x of xs) for (const w of [0, b + wallT / 2]) {
            const g = [x, b + wallT / 2, w];
            B.rev(g, [[0, o.colR * 1.25], [0.12, o.colR * 1.25], [0.12, o.colR], [o.spring, o.colR * 0.9]], o.colCol, { p: 's' });
            B.box([x - o.colR * 1.3, x + o.colR * 1.3], [o.spring - 0.06, o.spring + 0.04], [g[1] - o.colR * 1.3, g[1] + o.colR * 1.3], [w - o.colR * 1.3, w + o.colR * 1.3], o.colCol);
            if (o.branch) for (const [dx, dw] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) B.beam([x, o.spring, g[1], w], [x + dx * 0.32, o.spring + 0.55, g[1] - 0.12, w + dw * 0.32], 0.025, o.colCol);
          }
        });
        // ribs under the vault at every pier, following its curve quadrant by quadrant
        if (o.ribCol) B.sides(() => {
          const h = o.vaultTop - o.wallTop, L = ARCH[arch];
          for (const x of xs) for (let k = 0; k + 1 < L.length; k++) {
            const P = [];
            for (const dx of [-0.03, 0.03]) for (const [f, hh] of [L[k], L[k + 1]]) for (const sw of [-1, 1]) { const y = o.wallTop + hh * h; P.push([x + dx, y, f * b, sw * f * b], [x + dx, y - 0.06, f * b, sw * f * b]); }
            B.hull(P, o.ribCol);
          }
        });
        // stained glass: in the clerestory above the aisle roofs and in the aisles' outer walls, inside and out
        if (o.glass) B.sides(q => {
          const pal = o.glass[q % o.glass.length];
          bays.forEach(([xa, xb], i) => {
            cells.forEach(([wa, wb], j) => {
              const c = pal[(i + j) % pal.length];
              if (o.oculus) {
                const r = Math.min(xb - xa, wb - wa, o.clere[1] - o.clere[0]) * 0.36, y = (o.clere[0] + o.clere[1]) / 2;
                B.disc([(xa + xb) / 2, y, b - 0.005, (wa + wb) / 2], 2, r, 0.012, c);
                B.disc([(xa + xb) / 2, y, b + wallT + 0.005, (wa + wb) / 2], 2, r, 0.012, c);
              } else for (const zr of [[b - 0.012, b], [b + wallT, b + wallT + 0.012]]) B.panel([xa + 0.16, xb - 0.16], o.clere, zr, [wa + 0.09, wb - 0.09], c);
            });
            if (o.aisleWin) for (let j = 0; j < 3; j++) {
              const wa = -A + (2 * A * j) / 3, wb = -A + (2 * A * (j + 1)) / 3, c = pal[(i + j + 1) % pal.length];
              for (const zr of [[A - 0.012, A], [o.Ao, o.Ao + 0.012]]) B.panel([xa + 0.2, xb - 0.2], o.aisleWin, zr, [wa + 0.14, wb - 0.14], c);
            }
          });
        });
      },
      top,
    };
    return B;
  }
  const boxPts = (xr, yr, zr, wr) => { const P = []; for (const x of xr) for (const y of yr) for (const z of zr) for (const w of wr) P.push([x, y, z, w]); return P; };
  // the profiles of arches and vaults: [share of the half-width, share of the rise]
  const ARCH = { pointed: [[1, 0], [0.86, 0.5], [0.5, 0.86], [0, 1]], round: [[1, 0], [0.87, 0.5], [0.5, 0.87], [0.12, 1]] };
  // openings get coarser arches: every facet of an opening multiplies the pieces of the wall it is carved from
  const ARCH_LO = { pointed: [[1, 0], [0.72, 0.62], [0, 1]], round: [[1, 0], [0.74, 0.68], [0.2, 1]] };
  // an arched opening through a wall along z: a box over the rectangle (x, w) up to the springing, then an arch
  // over it, pointed or round, curving across x, across w, or both (a domical arch): shrink 'x', 'w' or 'xw'
  function archPts(xa, xb, wa, wb, za, zb, spring, rise, kind, shrink = 'xw') {
    const xc = (xa + xb) / 2, wc = (wa + wb) / 2, hx = (xb - xa) / 2, hw = (wb - wa) / 2, P = [];
    const sx_ = shrink.includes('x'), sw_ = shrink.includes('w');
    for (const z of [za, zb]) {
      for (const sx of [-1, 1]) for (const sw of [-1, 1]) P.push([xc + sx * hx, 0, z, wc + sw * hw]);
      for (const [f, h] of ARCH_LO[kind]) for (const sx of [-1, 1]) for (const sw of [-1, 1]) P.push([xc + sx * (sx_ ? f : 1) * hx, spring + h * rise, z, wc + sw * (sw_ ? f : 1) * hw]);
    }
    return P;
  }
  // A 4D arcade in the wall za ≤ z ≤ zb (a 3D face spanning x and w): columns at the grid points (x of the piers,
  // w = 0 and the corners ±b). Each bay opens across the face's whole width under an arch along x, and between
  // a pier's columns the pier itself opens under an arch along w, so in any slice across w the arcade stands on
  // columns, and in w = 0 it is the familiar one
  function arcadePts(piers, b, za, zb, spring, rise, kind, pq) {
    const out = [];
    for (let i = 0; i + 1 < piers.length; i++) out.push(archPts(piers[i] + pq, piers[i + 1] - pq, -b + pq, b - pq, za, zb, spring, rise, kind, 'x'));
    for (const x of piers) for (const [wa, wb] of [[-b, 0], [0, b]]) out.push(archPts(x - pq - 0.02, x + pq + 0.02, wa + pq, wb - pq, za, zb, spring, rise * (b / 2 - pq) / ((piers[1] - piers[0]) / 2 - pq), kind, 'w'));
    return out;
  }
  // the air of a vaulted hall along a ground axis (0 x, 2 z, 3 w) from a0 to a1: its cross-section a square of
  // half-width h in the other two ground axes, centred on c (their two values), walls to wallTop, then the vault
  function vaultPts(axis, a0, a1, c, h, wallTop, rise, kind) {
    const others = [0, 2, 3].filter(k => k !== axis), P = [];
    const pt = (a, y, s, t) => { const p = [0, y, 0, 0]; p[axis] = a; p[others[0]] = c[0] + s; p[others[1]] = c[1] + t; return p; };
    for (const a of [a0, a1]) {
      for (const s of [-h, h]) for (const t of [-h, h]) P.push(pt(a, 0, s, t));
      for (const [f, hh] of ARCH[kind]) for (const s of [-1, 1]) for (const t of [-1, 1]) P.push(pt(a, wallTop + hh * rise, s * f * h, t * f * h));
    }
    return P;
  }
  // ground directions: the six axes, and the twelve diagonals of the cuboctahedron
  const AXES6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const DIAG12 = [];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) for (const si of [1, -1]) for (const sj of [1, -1]) { const d = [0, 0, 0]; d[i] = si * Math.SQRT1_2; d[j] = sj * Math.SQRT1_2; DIAG12.push(d); }
  const along = (g, d, s) => [g[0] + s * d[0], g[1] + s * d[1], g[2] + s * d[2]];
  // an opening through a wall facing x, from an arch made through a wall facing z
  const swapXZ = p => [p[2], p[1], p[0], p[3]];
  // a box from distance a to b along a ground axis direction d, half-width h across it, heights yr
  // the door in a carved portal: its opening's box, thinned to a slab across the middle of the wall
  const doorIn = (P, axis) => {
    const lo = [0, 1, 2, 3].map(q => Math.min(...P.map(p => p[q]))), hi = [0, 1, 2, 3].map(q => Math.max(...P.map(p => p[q]))), m = (lo[axis] + hi[axis]) / 2;
    lo[axis] = m - 0.02; hi[axis] = m + 0.02;
    const top = Math.max(...P.filter(p => Math.abs(p[1] - hi[1]) > 1e-9 && (Math.abs(p[0] - lo[0]) < 1e-9 || Math.abs(p[0] - hi[0]) < 1e-9 || Math.abs(p[2] - lo[2]) < 1e-9)).map(p => p[1]));
    return [[lo[0], hi[0]], [0, Math.min(top, hi[1])], [lo[2], hi[2]], [lo[3], hi[3]]];
  };
  const boxAlong = (d, a, b, h, yr) => { const k = d.findIndex(x => x), r = [[-h, h], [-h, h], [-h, h]]; r[k] = d[k] > 0 ? [a, b] : [-b, -a]; return boxPts(r[0], yr, r[1], r[2]); };

  // carve a portal (points P, through a wall facing axis) and hang its door
  function portal(B, P, axis) { B.carve(P); const [xr, yr, zr, wr] = doorIn(P, axis); B.box(xr, yr, zr, wr, C.bronze); }

  // ---------- palette ----------
  const C = {
    stone: [0.8, 0.76, 0.66], stoneLight: [0.9, 0.87, 0.8], stoneDark: [0.6, 0.56, 0.49], lead: [0.45, 0.5, 0.57],
    glass: [0.24, 0.34, 0.8], glassRed: [0.72, 0.18, 0.26], dark: [0.2, 0.18, 0.17], gold: [0.96, 0.76, 0.26],
    violet: [0.42, 0.24, 0.62], teal: [0.18, 0.55, 0.52], amber: [0.95, 0.66, 0.22], clear: [0.93, 0.88, 0.68],
    floor: [0.74, 0.7, 0.64], mosaic: [0.86, 0.67, 0.28], bronze: [0.36, 0.26, 0.16],
    trav: [0.87, 0.82, 0.7], travLight: [0.94, 0.91, 0.84], domeLead: [0.5, 0.56, 0.63],
    terracotta: [0.76, 0.34, 0.21], marble: [0.94, 0.93, 0.9], green: [0.24, 0.46, 0.36], pink: [0.86, 0.6, 0.6],
    brick: [0.68, 0.22, 0.17], white: [0.95, 0.94, 0.9], ochre: [0.82, 0.6, 0.45], sand: [0.84, 0.74, 0.58],
    sandDark: [0.7, 0.6, 0.46], cypress: [0.2, 0.48, 0.3],
  };

  // ---------- Notre-Dame de Paris ----------
  function notreDame(B, prm) {
    const { stone, stoneLight, stoneDark, lead, glass, glassRed, dark, gold } = C;
    // inside, the walls rise to the crown of the vault and the roofs sit on them, so carving the vaults never
    // cuts a roof into pieces; the aisles are a ring round the nave rather than a block through it
    const IN = prm.interior, eave = IN ? 4.0 : 3.3;
    B.group(() => {
      // the nave and choir, square in z and w, under a lead hip roof
      B.sq([-5, 3.6], [0, eave], 0.6, stone);
      B.roof([-5, 3.6], eave, 1.05, 0.66, lead);
      // double aisles and chapels all round, with lean-to roofs against the clerestory
      if (IN) { B.ring([-5, 3.6], [0, 1.6], 0.6, 2.2, stone); B.leanTo([-5, 3.6], 0.6, 2.25, 1.6, 2.15, lead); }
      else {
        B.sq([-5, 3.6], [0, 1.6], 2.2, stone);
        const P = [];
        for (const x of [-5, 3.6]) { for (const s of [[2.25, 1.6], [0.62, 2.15]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]); }
        B.hull(P, lead);
      }
      // the east end: a half-round apse for the choir, its conical roof, and the ambulatory below
      const half = [1, 0, 0];
      B.rev([3.6, 0, 0], [[0, 0.6], [3.3, 0.6]], stone, { p: 'm', half });
      B.rev([3.6, 0, 0], [[3.3, 0.66], [4.35, 0]], lead, { p: 'm', half });
      B.rev([3.6, 0, 0], [[0, 2.2], [1.6, 2.2]], stone, { p: 'm', half });
      B.rev([3.6, 0, 0], [[1.6, 2.25], [2.15, 0.62]], lead, { p: 'm', half });
    });
    // the transept: arms along z and w, each with a rose window in its end
    B.sides(() => B.group(() => {
      // inside, an arm starts at the nave's wall, and over the aisles only above their roofs, so no carve cuts
      // the same stone twice
      if (IN) { B.box([0.35, 1.65], [1.6, eave], [0.6, 2.2], [-0.65, 0.65], stone); B.box([0.35, 1.65], [0, eave], [2.2, 2.5], [-0.65, 0.65], stone); }
      else B.box([0.35, 1.65], [0, eave], [0, 2.5], [-0.65, 0.65], stone);
      const P = [];
      for (const z of [0, 2.5]) { for (const x of [0.35, 1.65]) for (const w of [-0.65, 0.65]) P.push([x, eave, z, w]); P.push([1, eave + 1.05, z, 0]); }
      B.hull(P, lead);
      B.disc([1, 2.25, 2.53, 0], 2, 0.46, 0.06, glass);
      B.disc([1, 2.25, 2.56, 0], 2, 0.14, 0.06, glassRed);
    }));
    // the west front: portals, the gallery of kings, the rose window, and towers on all four sides
    B.group(() => {
      B.sq([-5.7, -5], [0, 4.4], 2.2, stone);
      B.sq([-5.76, -5.7], [2.05, 2.3], 2.2, stoneDark);
      B.sq([-5.76, -5.7], [3.95, 4.05], 2.2, stoneDark);
      B.disc([-5.73, 3.1, 0, 0], 0, 0.55, 0.06, glass);
      B.disc([-5.75, 3.1, 0, 0], 0, 0.16, 0.06, glassRed);
      if (!prm.interior) B.box([-5.8, -5.7], [0, 1.35], [-0.38, 0.38], [-0.38, 0.38], dark);
      B.sides(() => {
        if (!prm.interior) B.box([-5.8, -5.7], [0, 1.15], [1.2, 1.75], [-0.3, 0.3], dark);
        B.group(() => {
          B.box([-5.7, -4.3], [4.4, 6.9], [0.75, 2.2], [-0.72, 0.72], stone);
          for (const z of [1.05, 1.65]) B.box([-5.76, -5.7], [4.85, 6.45], [z, z + 0.24], [-0.24, 0.24], dark);
          B.box([-5.76, -4.24], [6.9, 7.05], [0.7, 2.25], [-0.77, 0.77], stoneLight);
          for (const x of [-5.6, -4.4]) for (const z of [0.85, 2.1]) for (const w of [-0.62, 0.62]) B.rev([x, z, w], [[7.05, 0.07], [7.35, 0]], stoneLight, { p: 'cube' });
        });
      });
    });
    // the flèche over the crossing: an octagonal base and a slender lead spire
    B.group(() => {
      const lift = eave - 3.3;
      B.rev([1, 0, 0], [[3.9 + lift, 0.3], [5.1 + lift, 0.3]], lead, { p: 'oct' });
      B.rev([1, 0, 0], [[5.1 + lift, 0.32], [9.6 + lift, 0]], lead, { p: 'oct' });
      B.ball([1, 0, 0], 9.65 + lift, 0.07, gold);
    });
    // flying buttresses: piers with pinnacles beyond the aisles, arches leaping to the clerestory. A row of piers
    // along a wall in 3D becomes a row of slabs across that wall's whole width in w
    const flyer = (x, y0, y1, h, wd) => {
      const P = [];
      for (const dx of [-0.06, 0.06]) for (const w of [-wd, wd]) for (const [z, y] of [[2.4, y0], [0.62, y1]]) { P.push([x + dx, y, z, w]); P.push([x + dx, y + h, z, w]); }
      B.hull(P, stone);
    };
    B.sides(() => B.group(() => {
      for (const x of [-4.1, -3.1, -2.1, -1.1, 2.4, 3.3]) {
        B.box([x - 0.12, x + 0.12], [0, 2.9], [2.2, 2.62], [-0.45, 0.45], stone);
        for (const w of [-0.33, 0.33]) B.rev([x, 2.41, w], [[2.9, 0.11], [3.55, 0]], stoneLight, { p: 'cube' });
        flyer(x, 2.72, 3.08, 0.1, 0.4);
        flyer(x, 2.05, 2.25, 0.08, 0.4);
      }
    }));
    // and round the apse, radially
    B.group(() => {
      const dirs = [[1, 0, 0]];
      for (const a of [40, 75]) { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); dirs.push([c, s, 0], [c, -s, 0], [c, 0, s], [c, 0, -s]); }
      for (const d of dirs) {
        const p = along([3.6, 0, 0], d, 2.4), q = along([3.6, 0, 0], d, 0.62);
        B.hull([[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].flatMap(([a, b]) => {
          // a pier: a small box around p, across the radial direction
          const out = [];
          for (const y of [0, 2.9]) for (const r of [-0.2, 0.2]) {
            const t1 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [-d[1], d[0], 0], l1 = Math.hypot(...t1), u1 = t1.map(x => x / l1);
            const u2 = [d[1] * u1[2] - d[2] * u1[1], d[2] * u1[0] - d[0] * u1[2], d[0] * u1[1] - d[1] * u1[0]];
            out.push(G4([p[0] + r * d[0] + a * u1[0] + b * u2[0], p[1] + r * d[1] + a * u1[1] + b * u2[1], p[2] + r * d[2] + a * u1[2] + b * u2[2]], y));
          }
          return out;
        }), stone);
        B.rev(p, [[2.9, 0.12], [3.55, 0]], stoneLight, { p: 'cube' });
        B.beam(G4(p, 2.78), G4(q, 3.12), 0.055, stone);
      }
    });
    if (prm.interior) {
      const half = [1, 0, 0];
      // the ambulatory round the apse, and the choir's apse inside it
      B.carveRev([3.6, 0, 0], [[0, 2.08], [1.45, 2.08]], { p: 'm', half });
      B.carveRev([3.6, 0, 0], [[0, 0.48], [3.3, 0.48], [3.95, 0]], { p: 'm', half });
      B.nave({ x0: -5, x1: 3.6, ax: [-5, 3.6], piers: [-5, -4.1, -3.2, -2.3, -1.4, -0.5, 0.35, 1.65, 2.6, 3.6], open: [[0.35, 1.65]],
        b: 0.48, wallT: 0.12, A: 2.08, Ao: 2.2, aisleTop: 1.45, spring: 0.95, rise: 0.42, wallTop: 3.3, vaultTop: 3.95, arch: 'pointed',
        colR: 0.07, colCol: stoneLight, ribCol: stoneLight, clere: [2.3, 3.15], aisleWin: [0.35, 1.25],
        glass: [[glass, glassRed, C.violet], [glassRed, glass, C.teal]] });
      // the transept arms, along z and w: their vaults cross the nave's in groins
      B.sides(() => B.carve(vaultPts(2, 0, 2.38, [1, 0], 0.53, 3.3, 0.65, 'pointed')));
      // the portals, each closed by a bronze door
      portal(B, archPts(-0.35, 0.35, -0.35, 0.35, -5.8, -4.95, 0.95, 0.4, 'pointed').map(swapXZ), 0);
      B.sides(() => portal(B, archPts(1.2, 1.75, -0.28, 0.28, -5.8, -4.95, 0.8, 0.32, 'pointed').map(swapXZ), 0));
      // columns round the apse, between the choir and the ambulatory
      const dirs = [[1, 0, 0]];
      for (const a of [30, 60]) { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); dirs.push([c, s, 0], [c, -s, 0], [c, 0, s], [c, 0, -s]); }
      for (const d of dirs) { const g = along([3.6, 0, 0], d, 0.54); B.rev(g, [[0, 0.085], [0.12, 0.085], [0.12, 0.07], [1.45, 0.065]], stoneLight, { p: 's' }); }
      // the rose windows seen from inside
      B.disc([-4.994, 3.1, 0, 0], 0, 0.55, 0.012, glass); B.disc([-4.99, 3.1, 0, 0], 0, 0.16, 0.012, glassRed);
      B.sides(() => { B.disc([1, 2.25, 2.376, 0], 2, 0.46, 0.012, glass); B.disc([1, 2.25, 2.372, 0], 2, 0.14, 0.012, glassRed); });
      // the floor and the altar
      B.box([-5, 3.6], [-0.1, 0], [-2.2, 2.2], [-2.2, 2.2], C.floor);
      B.rev([3.6, 0, 0], [[-0.1, 2.2], [0, 2.2]], C.floor, { p: 'm', half });
      B.sides(() => B.box([0.35, 1.65], [-0.1, 0], [2.2, 2.5], [-0.65, 0.65], C.floor));
      B.box([2.78, 3.06], [0, 0.11], [-0.14, 0.14], [-0.14, 0.14], stoneLight);
      B.rev([2.92, 0, 0], [[0.11, 0.02], [0.32, 0.02]], gold, { p: 's' });
      B.spot('West end', [-4.4, 0, 0]); B.spot('Nave', [-2.0, 0, 0]); B.spot('Crossing', [1.0, 0, 0], 0, 0.35); B.spot('Choir', [3.2, 0, 0]); B.spot('Aisle', [-2.0, 1.4, 0]);
    }
    return {
      name: 'Notre-Dame de Paris', sub: 'Paris, 1163–1345 · Gothic',
      rows: [
        ['Plan', 'the nave runs along x; its cross-section is a square in z and w, so it has four sides instead of two, each with its aisles, chapels and flying buttresses'],
        ['Transept', 'arms along both z and w: the crossing is where three axes meet, and every arm ends in a rose window (a glass ball, flat in the arm’s direction)'],
        ['West front', 'the two towers stand on the ±z sides of the front, and two more on the ±w sides: the slice w = 0 shows the familiar pair'],
        ['Apse', 'a half ball instead of a half cylinder, ringed by buttresses in every direction of the half sphere'],
        ['Roofs', 'hip roofs over the square sections: in the slice w = 0 each is the familiar gable'],
        ...(prm.interior ? [['Inside', 'each arcade wall is a 3D face, so its pointed arches open in a grid along x and w and its columns stand in a grid: eight round the nave at every bay. The vaults of the nave and the two transepts cross in groins; stained glass fills the clerestory and the aisle walls']] : []),
      ],
    };
  }

  // ---------- St Peter's Basilica ----------
  function stPeters(B, prm) {
    const { trav, travLight, domeLead, lead, gold, dark } = C;
    const X = 2;
    B.group(() => {
      // Maderno's nave, its aisles and chapels
      B.sq([-9.4, -2.3], [0, 4.6], 1.4, trav);
      B.roof([-9.4, -2.3], 4.6, 0.75, 1.45, lead);
      if (prm.interior) { B.ring([-9.4, -2.3], [0, 3.2], 1.4, 3, trav); B.leanTo([-9.4, -2.3], 1.4, 3.05, 3.2, 3.75, lead); }
      else {
        B.sq([-9.4, -2.3], [0, 3.2], 3, trav);
        const P = [];
        for (const x of [-9.4, -2.3]) for (const s of [[3.05, 3.2], [1.42, 3.75]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
        B.hull(P, lead);
      }
    });
    // Michelangelo's centre: a great block with an apse on every arm (+x, ±z, ±w)
    B.group(() => {
      B.box([X - 4.3, X + 4.3], [0, 4.4], [-4.3, 4.3], [-4.3, 4.3], trav);
      B.box([X - 4.36, X + 4.36], [4.4, 4.95], [-4.36, 4.36], [-4.36, 4.36], travLight);
      const apse = d => {
        const g = along([X, 0, 0], d, 4.3);
        B.rev(g, [[0, 2.4], [4.4, 2.4]], trav, { p: 'm', half: d });
        B.rev(g, [[4.4, 2.46], [4.95, 2.46]], travLight, { p: 'm', half: d });
        B.rev(g, [[4.95, 2.3], [5.5, 1.9], [5.95, 1.1], [6.15, 0]], domeLead, { p: 'm', half: d });
      };
      apse([1, 0, 0]);
      for (const d of [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) apse(d);
    });
    // the drum, the dome with its ribs, and the lantern
    // (inside: the drum and dome are carved after the spaces below, so they are made last; see the end)
    const domeParts = () => B.group(() => {
      const g = [X, 0, 0], ph16 = Array.from({ length: 16 }, (_, k) => TAU * (k + 0.5) / 16), IN = prm.interior;
      if (IN) B.shell(g, [[4.95, 2.45], [7.3, 2.45]], 0.25, trav, { p: 'l' }); else B.rev(g, [[4.95, 2.45], [7.3, 2.45]], trav, { p: 'l' });
      B.fins(g, [[4.95, 2.45], [7.3, 2.45]], ph16, 0.07, 0.11, travLight);
      if (IN) B.shell(g, [[7.3, 2.64], [7.58, 2.64]], 0.44, travLight, { p: 'l' }); else B.rev(g, [[7.3, 2.64], [7.58, 2.64]], travLight, { p: 'l' });
      const dome = [[7.58, 2.42], [8.4, 2.33], [9.2, 2.06], [9.9, 1.63], [10.5, 1.06], [10.85, 0.62]];
      if (IN) {
        // two shells, as built: lead outside; inside, mosaic rings of gold and blue, open at the top to the lantern
        B.shell(g, dome, 0.08, domeLead, { p: 'l' });
        const inner = [[7.58, 2.22], [8.3, 2.12], [9.0, 1.88], [9.6, 1.45], [10.05, 0.95], [10.3, 0.55]];
        B.shell(g, inner, 0.12, [C.mosaic, [0.22, 0.32, 0.62]], { p: 'l' });
        // its sixteen gilded ribs, on the inner surface (the shell's inner radius is 0.12 less)
        B.fins(g, inner.map(([y, r]) => [y, r - 0.12]), ph16, 0.025, 0.05, gold);
      } else B.rev(g, dome, domeLead, { p: 'l' });
      B.fins(g, dome, ph16, 0.035, 0.06, travLight);
      if (IN) B.shell(g, [[10.85, 0.62], [11.9, 0.62]], 0.1, trav, { p: 'm' }); else B.rev(g, [[10.85, 0.62], [11.9, 0.62]], trav, { p: 'm' });
      B.fins(g, [[10.85, 0.62], [11.9, 0.62]], Array.from({ length: 8 }, (_, k) => TAU * (k + 0.5) / 8), 0.12, 0.05, travLight, 'm');
      B.rev(g, [[11.9, 0.7], [12.05, 0.7]], travLight, { p: 'm' });
      B.rev(g, [[12.05, 0.58], [12.5, 0.42], [12.85, 0.08]], domeLead, { p: 'm' });
      B.ball(g, 13.05, 0.2, gold);
      // the cross on the ball: an upright and bars along z and w
      B.beam([X, 13.2, 0, 0], [X, 14.1, 0, 0], 0.045, gold);
      B.beam([X, 13.8, -0.3, 0], [X, 13.8, 0.3, 0], 0.04, gold);
      B.beam([X, 13.8, 0, -0.3], [X, 13.8, 0, 0.3], 0.04, gold);
    });
    if (!prm.interior) domeParts();
    // the four corner cupolas become twelve, on the diagonals of the ground (a cuboctahedron)
    for (const d of DIAG12) B.group(() => {
      const g = along([X, 0, 0], d, 4.1);
      B.rev(g, [[4.95, 0.78], [5.9, 0.78]], trav, { p: 'm' });
      B.rev(g, [[5.9, 0.8], [6.3, 0.7], [6.6, 0.45], [6.75, 0.22]], domeLead, { p: 'm' });
      B.rev(g, [[6.75, 0.2], [7.1, 0.2]], trav, { p: 's' });
      B.rev(g, [[7.1, 0.16], [7.45, 0]], domeLead, { p: 's' });
    });
    // the façade: giant columns in a cross on its face (a row along z and a row along w), pediment, attic, statues
    B.group(() => {
      B.sq([-10.1, -9.4], [0, 4.6], 5.6, trav);
      B.sq([-10.15, -9.4], [4.6, 5.3], 5.6, travLight);
      if (!prm.interior) B.sq([-10.2, -10.1], [0, 1.6], 0.6, dark);
      for (const s of [0.55, 1.65, 2.75, 3.85, 4.95]) for (const [z, w] of [[s, 0], [-s, 0], [0, s], [0, -s]]) {
        B.rev([-10.4, z, w], [[0, 0.24], [4.25, 0.2]], travLight, { p: 's' });
        B.box([-10.68, -10.12], [4.25, 4.6], [z - 0.28, z + 0.28], [w - 0.28, w + 0.28], travLight);
      }
      const P = [[-10.15, 6.05, 0, 0], [-10.68, 6.05, 0, 0]];
      for (const x of [-10.68, -10.15]) for (const z of [-1.9, 1.9]) for (const w of [-1.9, 1.9]) P.push([x, 4.6, z, w]);
      B.hull(P, travLight);
      for (const s of [1.1, 2.2, 3.3, 4.4, 5.4]) for (const [z, w] of [[s, 0], [-s, 0], [0, s], [0, -s], [0, 0]]) {
        if (!z && !w && s !== 1.1) continue;
        B.rev([-9.8, z, w], [[5.3, 0.1], [5.75, 0.08], [5.85, 0]], travLight, { p: 's' });
      }
    });
    // St Peter's Square: Bernini's colonnade, oval in plan, becomes a shell of columns on an ellipsoid, open
    // towards the basilica and away from it; the obelisk stands at its centre with the fountains around it
    if (prm.grounds) B.group(() => {
      const c = [-15.2, 0, 0], a = 4.6, b = 6.2, thL = [40, 58, 76, 94, 112, 130, 140].map(t => t * DEG), nph = 16;
      const dir = (th, ph) => [Math.cos(th), Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph)];
      const at = (u, k) => [c[0] + a * k * u[0], c[1] + b * k * u[1], c[2] + b * k * u[2]];
      for (let i = 0; i + 1 < thL.length; i++) for (let j = 0; j < nph; j++) {
        const ph0 = TAU * (j - 0.5) / nph, ph1 = TAU * (j + 0.5) / nph, us = [[thL[i], ph0], [thL[i], ph1], [thL[i + 1], ph0], [thL[i + 1], ph1]].map(([t, p]) => dir(t, p));
        const ctr = dir((thL[i] + thL[i + 1]) / 2, TAU * j / nph);
        const pts = (k, sh, y0, y1) => { const out = []; for (const u of us) { const p = at(u, k), q = at(ctr, k), r = p.map((x, m) => q[m] + sh * (x - q[m])); for (const y of [y0, y1]) out.push(G4(r, y)); } return out; };
        B.group(() => {
          B.hull([...pts(0.93, 0.5, 0, 1.6), ...pts(1.07, 0.5, 0, 1.6)], travLight);
          B.hull([...pts(0.92, 1, 1.6, 1.95), ...pts(1.08, 1, 1.6, 1.95)], trav);
        });
      }
      B.rev(c, [[0, 0.5], [0.35, 0.5]], trav, { p: 'cube' });
      B.rev(c, [[0.35, 0.3], [3.0, 0.2], [3.3, 0]], C.stoneDark, { p: 'cube' });
      B.ball(c, 3.36, 0.06, gold);
      B.pairs(() => {
        const g = [c[0], 2.6, 0];
        B.rev(g, [[0, 0.5], [0.2, 0.5]], trav, { p: 'm' });
        B.rev(g, [[0.2, 0.12], [0.6, 0.12]], trav, { p: 's' });
        B.rev(g, [[0.6, 0.3], [0.68, 0.3]], trav, { p: 's' });
      });
    });
    if (prm.interior) {
      // the nave runs on into the west arm and on to the crossing; the other arms are barrel vaulted
      B.nave({ x0: -9.4, x1: X, ax: [-9.4, -2.3], piers: [-9.4, -8.0, -6.6, -5.2, -3.8, -2.3],
        b: 1.18, wallT: 0.22, A: 2.78, Ao: 3, aisleTop: 2.55, spring: 1.6, rise: 0.85, wallTop: 3.6, vaultTop: 4.45, arch: 'round', pq: 0.12,
        colR: 0.15, colCol: travLight, ribCol: travLight, clere: [2.75, 3.45], aisleWin: [0.5, 2.2], glass: [[C.clear, C.amber]] });
      B.carve(vaultPts(0, X, X + 4.15, [0, 0], 1.18, 3.6, 0.85, 'round'));
      B.sides(() => B.carve(vaultPts(2, 0, 4.15, [X, 0], 1.18, 3.6, 0.85, 'round')));
      // the crossing opens up into the drum; each arm ends in its apse
      B.carveRev([X, 0, 0], [[0, 2.0], [4.97, 2.0]], { p: 'oct' });
      for (const d of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) B.carveRev(along([X, 0, 0], d, 4.3), [[0, 2.22], [4.25, 2.22]], { p: 'm', half: d });
      // the portals
      portal(B, archPts(-0.6, 0.6, -0.6, 0.6, -10.5, -9.3, 1.4, 0.55, 'round').map(swapXZ), 0);
      B.sides(() => portal(B, archPts(1.6, 2.4, -0.4, 0.4, -10.5, -9.3, 1.2, 0.4, 'round').map(swapXZ), 0));
      domeParts();
      // Bernini's baldacchino over the altar: its four bronze columns, at (±x, ±z), stand at (±x, ±w) as well
      B.group(() => {
        for (const sx of [-0.55, 0.55]) for (const [z, w] of [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]]) B.rev([X + sx, z, w], [[0, 0.08], [0.15, 0.08], [0.15, 0.06], [2.0, 0.05]], C.bronze, { p: 's' });
        B.box([X - 0.66, X + 0.66], [2.0, 2.22], [-0.66, 0.66], [-0.66, 0.66], C.bronze);
        const P = [[X, 2.75, 0, 0]];
        for (const x of [X - 0.45, X + 0.45]) for (const z of [-0.45, 0.45]) for (const w of [-0.45, 0.45]) P.push([x, 2.22, z, w]);
        B.hull(P, C.bronze);
        B.ball([X, 0, 0], 2.82, 0.07, gold);
        B.box([X - 0.3, X + 0.3], [0, 0.13], [-0.3, 0.3], [-0.3, 0.3], C.marble);
      });
      B.box([-9.4, X + 4.3], [-0.1, 0], [-4.3, 4.3], [-4.3, 4.3], C.floor);
      for (const d of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) B.rev(along([X, 0, 0], d, 4.3), [[-0.1, 2.4], [0, 2.4]], C.floor, { p: 'm', half: d });
      B.spot('Nave', [-6.5, 0, 0]); B.spot('Under the dome', [X - 1.0, 1.1, 0], 0, 0.95); B.spot('Transept', [X, 3.4, 0]); B.spot('Apse', [X + 4.8, 0, 0]);
    }
    return {
      name: 'St Peter’s Basilica', sub: 'Rome, 1506–1626 · Renaissance and Baroque',
      rows: [
        ['Dome', 'Michelangelo’s dome as a 3-sphere cap: its sixteen ribs and drum columns are fins along meridians of the ball-shaped cross-sections, so every slice shows sixteen'],
        ['Cupolas', 'the four corner cupolas become twelve, on the diagonals of the 3D ground (a cuboctahedron)'],
        ['Centre', 'Michelangelo’s Greek cross gains a third arm direction: apses close the arms at +x, ±z and ±w'],
        ['Façade', 'its giant order stands in a cross on the façade’s 3D face: a row along z and a row along w'],
        ['Piazza', prm.grounds ? 'Bernini’s oval colonnade, an ellipse of columns, becomes an ellipsoid shell of them, open towards and away from the basilica' : 'hidden (Grounds off)'],
        ...(prm.interior ? [['Inside', 'barrel-vaulted arms in all five directions from the crossing, the drum and its double dome above it (mosaic rings inside, open at the top to the lantern), and Bernini’s baldacchino, its columns on the corners of a cube']] : []),
      ],
    };
  }

  // ---------- Sagrada Família ----------
  function sagrada(B, prm) {
    const { sand, sandDark, lead, gold, white, cypress, dark } = C;
    const X = 0.8;
    // a Gaudí tower: a round shaft tapering in a parabola, crowned with a coloured pinnacle
    // the crown continues the taper, so a slice that misses the shaft's tip misses the crown too
    const tower = (g, H, r, crown, y0 = 0, p = 'm') => B.group(() => {
      const L = H - y0;
      B.rev(g, [[y0, r], [y0 + 0.5 * L, r * 0.97], [y0 + 0.75 * L, r * 0.78], [y0 + 0.88 * L, r * 0.5]], sand, { p });
      B.rev(g, [[y0 + 0.88 * L, r * 0.5], [y0 + 0.94 * L, r * 0.38], [H, r * 0.18], [H + 0.5 * r, 0]], crown, { p });
      B.ball(g, H + 0.35 * r, 0.12 * r, gold);
    });
    B.group(() => {
      B.sq([-4.6, 2.6], [0, 4.5], 0.75, sand);
      B.roof([-4.6, 2.6], 4.5, 1.6, 0.8, sandDark);
      if (prm.interior) { B.ring([-4.6, 2.6], [0, 3], 0.75, 2.25, sand); B.leanTo([-4.6, 2.6], 0.75, 2.3, 3, 3.7, sandDark); }
      else {
        B.sq([-4.6, 2.6], [0, 3], 2.25, sand);
        const P = [];
        for (const x of [-4.6, 2.6]) for (const s of [[2.3, 3], [0.78, 3.7]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
        B.hull(P, sandDark);
      }
      // the apse, under the tower of Mary
      B.rev([2.6, 0, 0], [[0, 2.25], [3, 2.25]], sand, { p: 'm', half: [1, 0, 0] });
      B.rev([2.6, 0, 0], [[3, 2.3], [3.7, 0.78]], sandDark, { p: 'm', half: [1, 0, 0] });
      B.rev([2.6, 0, 0], [[0, 0.75], [4.5, 0.75]], sand, { p: 'm', half: [1, 0, 0] });
    });
    // façades with four bell towers each: the Glory (west) façade, and transept façades on ±z and ±w (in the
    // real church, Nativity and Passion). Four towers in a row become a cross of eight: four along each side axis
    const facade = (axis, sgn, name) => B.group(() => {
      const H = [11.2, 9.8];
      // the façade's own centre, its normal axis, and its two side axes
      const ctr = axis === 0 ? [-4.6, 0, 0] : (() => { const c = [X, 0, 0]; c[axis] = sgn * 3.1; return c; })();
      const sideAx = [0, 1, 2].filter(k => k !== axis);
      const out = (k, s) => { const c = ctr.slice(); c[k] += s; c[axis] += (axis === 0 ? -1 : sgn) * 0.25; return c; };
      for (const k of sideAx) for (const s of [-2.25, -0.75, 0.75, 2.25]) tower(out(k, s), Math.abs(s) < 1 ? H[0] : H[1], 0.55, name === 'nat' ? cypress : name === 'pas' ? C.glassRed : C.glass, 0, 's');
      // the portal block between the towers
      const lo = ctr.slice(), hi = ctr.slice();
      for (const k of sideAx) { lo[k] -= 2.3; hi[k] += 2.3; }
      lo[axis] += axis === 0 ? -0.6 : (sgn > 0 ? 0 : -0.6); hi[axis] += axis === 0 ? 0.1 : (sgn > 0 ? 0.6 : 0);
      B.box([lo[0], hi[0]], [0, 4.2], [lo[1], hi[1]], [lo[2], hi[2]], sandDark);
      const door = ctr.slice(); door[axis] += (axis === 0 ? -0.62 : sgn * 0.62);
      const dl = door.slice(), dh = door.slice();
      for (const k of sideAx) { dl[k] -= 0.45; dh[k] += 0.45; }
      dl[axis] -= 0.03; dh[axis] += 0.03;
      if (!prm.interior) B.box([dl[0], dh[0]], [0, 2.4], [dl[1], dh[1]], [dl[2], dh[2]], dark);
      // the Nativity façade's cypress, the tree of life, above its portal
      if (name === 'nat') { const g = ctr.slice(); g[axis] += sgn * 0.5; B.rev(g, [[4.2, 0.45], [5.1, 0.35], [6.2, 0]], cypress, { p: 'm' }); B.ball(g, 6.3, 0.12, white); }
    });
    facade(0, -1, 'glory');
    facade(1, 1, 'nat'); facade(1, -1, 'pas'); facade(2, 1, 'nat'); facade(2, -1, 'pas');
    // the transepts behind them
    B.group(() => {
      if (prm.interior) B.sides(() => { B.box([X - 0.75, X + 0.75], [3, 4.5], [0.75, 2.25], [-0.75, 0.75], sand); B.box([X - 0.75, X + 0.75], [0, 4.5], [2.25, 3.1], [-0.75, 0.75], sand); });
      else for (const k of [1, 2]) { const zr = k === 1 ? [-3.1, 3.1] : [-0.75, 0.75], wr = k === 2 ? [-3.1, 3.1] : [-0.75, 0.75]; B.box([X - 0.75, X + 0.75], [0, 4.5], zr, wr, sand); }
    });
    // the tower of Jesus Christ over the crossing, with its 4D cross: arms along all four axes
    B.group(() => {
      const g = [X, 0, 0];
      // inside, its base is a hollow lantern over the crossing (a shell, rather than carving the solid tower)
      if (prm.interior) {
        B.shell(g, [[4.5, 1.05], [7.6, 0.96]], 0.3, sand, { p: 'l' });
        B.rev(g, [[7.6, 0.96], [10, 0.88], [14, 0.56], [16.5, 0.2], [17.2, 0.05]], sand, { p: 'l' });
      } else B.rev(g, [[4.5, 1.05], [10, 0.88], [14, 0.56], [16.5, 0.2], [17.2, 0.05]], sand, { p: 'l' });
      for (const [a, b] of [[[X, 17.1, 0, 0], [X, 18.6, 0, 0]], [[X - 0.45, 17.9, 0, 0], [X + 0.45, 17.9, 0, 0]], [[X, 17.9, -0.45, 0], [X, 17.9, 0.45, 0]], [[X, 17.9, 0, -0.45], [X, 17.9, 0, 0.45]]]) B.beam(a, b, 0.09, white);
      B.ball(g, 17.9, 0.15, gold);
    });
    // the four evangelists around it become eight, on the corners of a cube
    for (let m = 0; m < 8; m++) tower([X + (m & 1 ? -1.4 : 1.4), m & 2 ? -1.4 : 1.4, m & 4 ? -1.4 : 1.4], 13.5, 0.62, white, 4.5);
    // the tower of the Virgin Mary over the apse, crowned with a star
    B.group(() => { tower([3.2, 0, 0], 13.8, 0.75, C.glass, 4.5); B.ball([3.2, 0, 0], 14.32, 0.24, white, 'm'); });
    // fruit pinnacles along the clerestory
    B.sides(() => B.group(() => {
      const fruit = [[0.9, 0.35, 0.2], [0.95, 0.7, 0.15], [0.7, 0.2, 0.4], [0.5, 0.75, 0.3]];
      [-3.8, -2.6, -1.4, 2.0].forEach((x, i) => { B.rev([x, 0.8, 0], [[4.5, 0.12], [5.0, 0.1]], sand, { p: 's' }); B.ball([x, 0.8, 0], 5.15, 0.16, fruit[i % 4]); });
    }));
    if (prm.interior) {
      // a forest of white tree columns; the Nativity sides glow blue and green, the Passion sides red and orange
      const cool = [[0.2, 0.42, 0.85], [0.15, 0.62, 0.45], [0.25, 0.7, 0.8]], warm = [[0.88, 0.25, 0.15], [0.95, 0.6, 0.15], [0.9, 0.82, 0.25]];
      B.nave({ x0: -4.6, x1: 2.6, ax: [-4.25, 2.6], piers: [-4.6, -3.65, -2.7, -1.75, -0.8, 0.05, 1.55, 2.6], open: [[0.05, 1.55]],
        b: 0.6, wallT: 0.15, A: 2.1, Ao: 2.25, aisleTop: 2.6, spring: 1.75, rise: 0.6, wallTop: 3.9, vaultTop: 4.42, arch: 'pointed',
        colR: 0.07, colCol: [0.93, 0.91, 0.86], branch: true, clere: [2.95, 3.8], aisleWin: [0.4, 2.3], glass: [cool, [C.violet, ...cool], warm, [C.amber, ...warm]] });
      B.sides(() => B.carve(vaultPts(2, 0, 3.05, [X, 0], 0.6, 3.9, 0.52, 'pointed')));
      // the crossing opens up into the hollow base of the tower of Jesus Christ
      B.carveRev([X, 0, 0], [[0, 0.7], [4.62, 0.7]], { p: 'oct' });
      const half = [1, 0, 0];
      B.carveRev([2.6, 0, 0], [[0, 2.1], [2.85, 2.1]], { p: 'm', half });
      B.carveRev([2.6, 0, 0], [[0, 0.6], [4.4, 0.6]], { p: 'm', half });
      // the portals, between the bell towers: Glory, and the four transept façades
      portal(B, archPts(-0.19, 0.19, -0.19, 0.19, -5.35, -4.4, 1.5, 0.35, 'pointed').map(swapXZ), 0);
      B.sides(() => portal(B, archPts(X - 0.19, X + 0.19, -0.19, 0.19, 2.95, 3.75, 1.5, 0.35, 'pointed'), 2));
      B.box([-4.6, 2.6], [-0.1, 0], [-2.25, 2.25], [-2.25, 2.25], C.floor);
      B.sides(() => B.box([X - 0.75, X + 0.75], [-0.1, 0], [2.25, 3.1], [-0.75, 0.75], C.floor));
      B.rev([2.6, 0, 0], [[-0.1, 2.25], [0, 2.25]], C.floor, { p: 'm', half });
      B.box([X - 0.2, X + 0.2], [0, 0.12], [-0.2, 0.2], [-0.2, 0.2], C.marble);
      B.spot('Nave', [-2.7, 0, 0]); B.spot('Crossing', [X - 0.35, 0, 0], 0, 0.7); B.spot('Apse', [3.4, 0, 0]); B.spot('Transept', [X, 2.2, 0]);
    }
    return {
      name: 'Basílica de la Sagrada Família', sub: 'Barcelona, 1882– · Gaudí',
      rows: [
        ['Towers', 'each façade’s row of four bell towers becomes a cross of eight, four along each of the façade’s side axes'],
        ['Façades', 'Glory at the west end; the transept façades (Nativity, with its cypress, and Passion) face ±z and ±w'],
        ['Evangelists', 'the four towers round the central tower become eight, on the corners of a cube'],
        ['Jesus Christ', 'the tallest tower; Gaudí’s three-armed cross becomes a four-armed one, along x, y, z and w'],
        ['Mary', 'the tower over the apse, crowned with its star'],
        ...(prm.interior ? [['Inside', 'tree columns that branch in four directions under the vault, the crossing open into the tower above, and glass that is cool on the Nativity sides (+z, +w) and warm on the Passion sides (−z, −w)']] : []),
      ],
    };
  }

  // ---------- Hagia Sophia ----------
  function hagiaSophia(B, prm) {
    const { ochre, domeLead, gold, stoneLight } = C, wall = [0.8, 0.56, 0.44];
    const IN = prm.interior, hd = [[3.3, 1.7], [3.85, 1.55], [4.3, 1.12], [4.6, 0.6], [4.72, 0]];
    B.group(() => {
      if (IN) { for (const xr of [[-3.8, -1.7], [1.7, 3.8]]) B.box(xr, [0, 2.4], [-3.4, 3.4], [-3.4, 3.4], wall); B.ring([-1.7, 1.7], [0, 2.4], 1.7, 3.4, wall); }
      else B.box([-3.8, 3.8], [0, 2.4], [-3.4, 3.4], [-3.4, 3.4], wall);
      B.sq([-1.7, 1.7], [0, 4.0], 1.7, wall);
      // the half domes east and west, and the exedrae beside them
      for (const sx of [1, -1]) {
        const d = [sx, 0, 0], g = [sx * 1.7, 0, 0];
        if (!IN) { B.rev(g, [[2.4, 1.7], [3.3, 1.7]], wall, { p: 'l', half: d }); B.rev(g, hd, domeLead, { p: 'l', half: d }); }
        B.sides(() => {
          const e = [sx * 2.9, 1.2, 0];
          B.rev(e, [[2.4, 0.8], [2.8, 0.7], [3.05, 0.42], [3.15, 0]], domeLead, { p: 'm', half: d });
        });
      }
    });
    if (IN) {
      // the great space: the square under the dome, opening east and west under the half domes, ringed by aisles
      // behind arcades of green marble columns; a round opening at the top of the square meets the dome
      B.carveBox([-1.85, 1.85], [0, 3.9], [-1.55, 1.55], [-1.55, 1.55]);
      B.carveRev([0, 0, 0], [[3.85, 1.55], [4.05, 1.55]], { p: 'l' });
      for (const sx of [1, -1]) {
        B.carveRev([sx * 1.7, 0, 0], [[0, 1.55], [3.35, 1.55]], { p: 'm', half: [sx, 0, 0] });
        B.sides(() => B.carveRev([sx * 2.9, 1.2, 0], [[0, 0.72], [2.4, 0.72]], { p: 'm' }));
      }
      B.sides(() => B.carveBox([-3.65, 3.65], [0, 1.8], [1.7, 3.25], [-3.25, 3.25]));
      B.sides(() => { for (const P of arcadePts([-1.55, -0.52, 0.52, 1.55], 1.55, 1.53, 1.72, 1.05, 0.45, 'round', 0.07)) B.carve(P); });
      B.sides(() => { for (const x of [-1.55, -0.52, 0.52, 1.55]) for (const w of [0, 1.625]) B.rev([x, 1.625, w], [[0, 0.075], [1.05, 0.065]], [0.36, 0.52, 0.44], { p: 's' }); });
      B.box([-3.8, 3.8], [-0.1, 0], [-3.4, 3.4], [-3.4, 3.4], [0.72, 0.68, 0.6]);
      // the half domes: walls and double shells, lead outside and gold mosaic inside
      for (const sx of [1, -1]) {
        const d = [sx, 0, 0], g = [sx * 1.7, 0, 0];
        B.shell(g, [[2.4, 1.7], [3.3, 1.7]], 0.15, wall, { p: 'l', half: d });
        B.shell(g, hd, 0.06, domeLead, { p: 'l', half: d });
        B.shell(g, [[3.3, 1.64], [3.82, 1.49], [4.25, 1.07], [4.53, 0.55], [4.64, 0]], 0.1, C.mosaic, { p: 'l', half: d });
      }
      B.spot('Under the dome', [0, 0, 0], 0, 0.75); B.spot('East apse', [2.6, 0, 0], 0, 0.3); B.spot('Aisle', [0, 2.45, 0]);
    }
    // the great buttresses on the sides
    B.group(() => B.sides(() => { for (const sx of [1, -1]) B.box([sx * 1.7 - 0.45, sx * 1.7 + 0.45], [0, 4.25], [1.7, 3.0], [-0.45, 0.45], wall); }));
    // the dome on its ring of windows (inside: only the piers between the windows, so light comes through)
    B.group(() => {
      const g = [0, 0, 0];
      if (!IN) B.rev(g, [[4.0, 1.72], [4.35, 1.72]], wall, { p: 'l' });
      B.fins(g, [[4.0, 1.72], [4.35, 1.72]], Array.from({ length: 24 }, (_, k) => TAU * (k + 0.5) / 24), IN ? 0.06 : 0.04, IN ? 0.09 : 0.05, stoneLight);
      const dome = [[4.35, 1.66], [4.8, 1.45], [5.2, 1.08], [5.48, 0.6], [5.58, 0]];
      if (IN) { B.shell(g, dome, 0.06, domeLead, { p: 'l' }); B.shell(g, [[4.35, 1.6], [4.78, 1.39], [5.16, 1.02], [5.42, 0.54], [5.52, 0]], 0.1, C.mosaic, { p: 'l' }); }
      else B.rev(g, dome, domeLead, { p: 'l' });
      B.rev(g, [[5.55, 0.05], [5.9, 0.03]], gold, { p: 's' });
      B.ball(g, 5.95, 0.08, gold);
    });
    // the four minarets at the corners become eight: at (±x, ±z) and (±x, ±w)
    B.sides(() => { for (const sx of [1, -1]) B.group(() => {
      const g = [sx * 4.2, 3.9, 0];
      B.rev(g, [[0, 0.3], [0.7, 0.3]], stoneLight, { p: 'm' });
      B.rev(g, [[0.7, 0.21], [6.1, 0.19]], stoneLight, { p: 'm' });
      for (const y of [3.4, 5.0]) B.rev(g, [[y, 0.21], [y + 0.12, 0.3], [y + 0.22, 0.3]], stoneLight, { p: 'm' });
      B.rev(g, [[6.1, 0.2], [7.4, 0]], domeLead, { p: 'm' });
      B.ball(g, 7.45, 0.05, gold);
    }); });
    return {
      name: 'Hagia Sophia', sub: 'Istanbul, 532–537 · Byzantine',
      rows: [
        ['Dome', 'a 3-sphere cap on a ring of windows (fins along its meridians), over a cube where the real dome stands over a square'],
        ['Half domes', 'east and west, along x as in the real building: quarter-balls of a 4-ball'],
        ['Buttresses', 'the great piers on the north and south sides stand on all four sides'],
        ['Minarets', 'the four corner minarets become eight, at the corners of the x–z and x–w squares'],
        ...(prm.interior ? [['Inside', 'one great space under the dome and the half domes, all gold mosaic inside; the dome floats on its ring of windows, now a ring of piers round a 2-sphere of light. Arcades of green columns open into the aisles on all four sides']] : []),
      ],
    };
  }

  // ---------- St Basil's Cathedral ----------
  function stBasil(B, prm) {
    const { brick, white, gold } = C;
    // the onion domes, banded in the colours of the real ones
    const BANDS = [
      [[0.15, 0.55, 0.3], [0.95, 0.8, 0.3]], [[0.85, 0.15, 0.15], [0.95, 0.93, 0.88]], [[0.2, 0.35, 0.8], [0.95, 0.93, 0.88]],
      [[0.95, 0.75, 0.2], [0.2, 0.55, 0.35]], [[0.85, 0.15, 0.15], [0.2, 0.55, 0.35]], [[0.25, 0.65, 0.8], [0.95, 0.8, 0.3]],
    ];
    const onion = (g, y0, R, bands, p = 'm') => {
      const prof = [[0, 0.72], [0.22, 0.95], [0.55, 1.12], [0.85, 1.12], [1.15, 0.95], [1.45, 0.66], [1.75, 0.38], [2.05, 0.17], [2.35, 0.05]].map(([y, r]) => [y0 + y * R, r * R]);
      B.rev(g, prof, bands, { p });
      B.rev(g, [[y0 + 2.3 * R, 0.035 * R], [y0 + 2.75 * R, 0.03 * R]], gold, { p: 's' });
      B.ball(g, y0 + 2.8 * R, 0.07 * R, gold);
    };
    // inside, the churches are painted: ochre, red and green bands
    const PAINT = [[0.84, 0.64, 0.38], [0.72, 0.34, 0.24], [0.42, 0.56, 0.36], [0.88, 0.78, 0.52]];
    const chapel = (g, r, h, R, bands, p, hollow) => B.group(() => {
      if (hollow) {
        B.shell(g, [[0.8, r], [0.8 + h, r]], 0.09, brick, { p: 'oct' });
        B.shell(g, [0, 1, 2, 3].map(k => [0.84 + (h - 0.04) * k / 3, r - 0.09]), 0.03, PAINT, { p: 'oct' });
        B.shell(g, [[0.8 + h * 0.45, r * 1.06], [0.8 + h * 0.5, r * 1.06]], r * 0.2, white, { p: 'oct' });
        B.shell(g, [[0.8 + h, r * 1.08], [0.95 + h, r * 1.08]], r * 0.3, white, { p: 'oct' });
      } else {
        B.rev(g, [[0.8, r], [0.8 + h, r]], brick, { p: 'oct' });
        B.rev(g, [[0.8 + h * 0.45, r * 1.06], [0.8 + h * 0.5, r * 1.06]], white, { p: 'oct' });
        B.rev(g, [[0.8 + h, r * 1.08], [0.95 + h, r * 1.08]], white, { p: 'oct' });
      }
      B.rev(g, [[0.95 + h, r * 0.85], [1.4 + h, r * 0.6]], brick, { p: 'oct' });
      onion(g, 1.4 + h, R, bands, p);
    });
    B.group(() => {
      B.box([-3.2, 3.2], [0, 0.8], [-3.2, 3.2], [-3.2, 3.2], brick);
      B.box([-3.25, 3.25], [0.68, 0.84], [-3.25, 3.25], [-3.25, 3.25], white);
    });
    // the central church of the Intercession: an octagonal tower with a tent roof
    const IN = prm.interior;
    B.group(() => {
      const g = [0, 0, 0];
      if (IN) {
        // hollow to the top of the tent: from the floor, a painted octagonal shaft rising into the tent roof
        B.shell(g, [[0.8, 1.05], [4.9, 1.05]], 0.1, brick, { p: 'oct' });
        B.shell(g, [0, 1, 2, 3, 4, 5].map(k => [0.84 + 4.06 * k / 5, 0.95]), 0.04, PAINT, { p: 'oct' });
        B.shell(g, [[4.9, 1.12], [5.1, 1.12]], 0.32, white, { p: 'oct' });
        B.shell(g, [[5.1, 1.0], [8.4, 0.28]], 0.08, brick, { p: 'oct' });
        B.shell(g, [[5.1, 0.92], [6.2, 0.68], [7.3, 0.44], [8.4, 0.2]], 0.04, [PAINT[3], PAINT[0], PAINT[2]], { p: 'oct' });
      } else {
        B.rev(g, [[0.8, 1.05], [4.9, 1.05]], brick, { p: 'oct' });
        B.rev(g, [[4.9, 1.12], [5.1, 1.12]], white, { p: 'oct' });
        B.rev(g, [[5.1, 1.0], [8.4, 0.28]], brick, { p: 'oct' });
      }
      B.edgeRibs(g, [[5.1, 1.0], [8.4, 0.28]], 0.02, 0.025, white);
      B.rev(g, [[8.4, 0.24], [8.9, 0.24]], white, { p: 'oct' });
      onion(g, 8.9, 0.24, [[0.95, 0.76, 0.26]], 'm');
    });
    // eight chapels round it in the real church (four large on the axes, four small on the diagonals): here
    // six large ones on the axes of the ground and twelve small ones on its diagonals
    AXES6.forEach((d, i) => chapel(along([0, 0, 0], d, 2.3), 0.72, 3.0, 0.62, BANDS[i % BANDS.length], 'm', IN));
    DIAG12.forEach((d, i) => chapel(along([0, 0, 0], d, 2.15), 0.46, 2.1, 0.42, BANDS[(i + 3) % BANDS.length], i % 3 ? 's' : 'cube'));
    if (IN) {
      // low passages from the central church to the six chapels on the axes
      for (const d of AXES6) B.carve(boxAlong(d, 0.5, 2.6, 0.24, [0.84, 1.9]));
      B.spot('Central church', [0, 0, 0], 0.84, 0.9); B.spot('Passage', [1.3, 0, 0], 0.84); B.spot('Chapel', [2.3, 0, 0], 0.84);
    }
    return {
      name: 'St Basil’s Cathedral', sub: 'Moscow, 1555–1561 · Russian',
      rows: [
        ['Plan', 'nine churches: the central tent-roofed tower and the chapels round it. The four large chapels on the axes become six, on ±x, ±z and ±w'],
        ['Diagonals', 'the four small chapels on the diagonals become twelve, on the diagonals of the 3D ground (a cuboctahedron)'],
        ['Domes', 'each onion is a solid of revolution with ball-shaped cross-sections, banded in two colours; some small ones are faceted'],
        ['Towers', 'octagonal, as in Moscow: their cross-sections are rhombicuboctahedra, whose central slices are octagons'],
        ...(prm.interior ? [['Inside', 'the central church is a painted shaft open to the top of its tent roof; low passages lead out along all six axes to the chapels, each a painted octagonal shaft of its own']] : []),
      ],
    };
  }

  // ---------- Florence Cathedral ----------
  function florence(B, prm) {
    const { marble, green, pink, terracotta, gold, dark } = C;
    const X = 0;
    // the nave, its aisles, and the polychrome marble walls
    B.group(() => {
      B.sq([-8, -2.75], [0, 4.4], 1.0, marble);
      B.roof([-8, -2.75], 4.4, 0.6, 1.05, terracotta);
      if (prm.interior) {
        B.ring([-8, -2.75], [0, 3.0], 1.0, 2.0, marble);
        for (const y of [0.9, 1.9]) B.ring([-8, -2.75], [y, y + 0.12], 2.0, 2.04, green);
        B.leanTo([-8, -2.75], 1.0, 2.05, 3, 3.5, terracotta);
      } else {
        B.sq([-8, -2.75], [0, 3.0], 2.0, marble);
        for (const y of [0.9, 1.9]) B.sq([-8, -2.75], [y, y + 0.12], 2.04, green);
        const P = [];
        for (const x of [-8, -2.75]) for (const s of [[2.05, 3], [1.02, 3.5]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
        B.hull(P, terracotta);
      }
    });
    // the octagon under the dome, and the tribunes on its other arms (+x, ±z, ±w): the trefoil becomes five
    B.group(() => {
      B.rev([X, 0, 0], [[0, 2.75], [4.4, 2.75]], marble, { p: 'oct' });
      for (const y of [1.2, 2.6]) B.rev([X, 0, 0], [[y, 2.79], [y + 0.14, 2.79]], green, { p: 'oct' });
      for (const d of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const g = along([X, 0, 0], d, 2.75);
        B.rev(g, [[0, 1.55], [3.0, 1.55]], marble, { p: 'oct', half: d });
        B.rev(g, [[0.9, 1.59], [1.02, 1.59]], green, { p: 'oct', half: d });
        B.rev(g, [[3.0, 1.6], [3.5, 1.2], [3.85, 0]], terracotta, { p: 'oct', half: d });
      }
    });
    // Brunelleschi's dome: an octagonal drum with round windows, the dome, its white ribs (in 4D, along every
    // edge of the rhombicuboctahedral cross-sections), and the lantern. Inside, it is made after the spaces
    // below are carved: two shells, terracotta outside and the painted Last Judgement inside
    const domeParts = () => B.group(() => {
      const g = [X, 0, 0], IN = prm.interior;
      if (IN) B.shell(g, [[4.4, 2.75], [5.6, 2.75]], 0.25, marble, { p: 'oct' }); else B.rev(g, [[4.4, 2.75], [5.6, 2.75]], marble, { p: 'oct' });
      for (const d of AXES6) {
        const ax = d[0] ? 0 : d[1] ? 2 : 3;
        B.disc(G4(along(g, d, 2.78), 5.0), ax, 0.32, 0.06, IN ? C.glass : dark);
        if (IN) B.disc(G4(along(g, d, 2.494), 5.0), ax, 0.32, 0.012, C.glass);
      }
      const dome = [[5.6, 2.62], [6.5, 2.52], [7.4, 2.22], [8.1, 1.7], [8.6, 1.05], [8.8, 0.72]];
      if (IN) {
        B.shell(g, dome, 0.07, terracotta, { p: 'oct' });
        B.shell(g, [[5.6, 2.45], [6.4, 2.36], [7.2, 2.08], [7.8, 1.62], [8.25, 1.05], [8.45, 0.62]], 0.12, [[0.36, 0.5, 0.74], [0.86, 0.72, 0.46], [0.8, 0.5, 0.44], [0.56, 0.7, 0.86], [0.9, 0.82, 0.6]], { p: 'oct' });
      } else B.rev(g, dome, terracotta, { p: 'oct' });
      B.edgeRibs(g, dome, 0.025, 0.07, marble);
      if (IN) { B.shell(g, [[8.8, 0.74], [8.95, 0.74]], 0.2, marble, { p: 'oct' }); B.shell(g, [[8.95, 0.55], [10.3, 0.55]], 0.08, marble, { p: 'oct' }); }
      else { B.rev(g, [[8.8, 0.74], [8.95, 0.74]], marble, { p: 'oct' }); B.rev(g, [[8.95, 0.55], [10.3, 0.55]], marble, { p: 'oct' }); }
      B.rev(g, [[10.3, 0.5], [11.1, 0.06]], marble, { p: 'oct' });
      B.ball(g, 11.25, 0.15, gold);
    });
    if (!prm.interior) domeParts();
    // the façade, banded in white, green and pink marble, with its rose window
    B.group(() => {
      B.sq([-8.4, -8], [0, 4.6], 2.05, marble);
      for (const [y, c] of [[0.6, green], [1.5, pink], [2.4, green], [3.3, pink], [4.2, green]]) B.sq([-8.45, -8.4], [y, y + 0.14], 2.05, c);
      const P = [[-8.45, 5.4, 0, 0], [-8.0, 5.4, 0, 0]];
      for (const x of [-8.45, -8]) for (const z of [-1.05, 1.05]) for (const w of [-1.05, 1.05]) P.push([x, 4.6, z, w]);
      B.hull(P, marble);
      B.disc([-8.44, 3.6, 0, 0], 0, 0.42, 0.05, C.glass);
      if (!prm.interior) B.box([-8.47, -8.4], [0, 1.3], [-0.35, 0.35], [-0.35, 0.35], dark);
    });
    if (prm.grounds) {
      // Giotto's campanile beside the façade, on its +z side and (in 4D) its +w side
      for (const q of [0, 1]) B.turn(2, 3, q, () => B.group(() => {
        const g = [-7.3, 3.4, 0];
        [[0, 1.6, marble], [1.6, 3.0, pink], [3.0, 4.6, marble], [4.6, 6.4, green], [6.4, 8.2, marble]].forEach(([y0, y1, c], i) => {
          B.rev(g, [[y0, 0.72], [y1, 0.72]], c, { p: 'cube' });
          B.rev(g, [[y1 - 0.08, 0.75], [y1, 0.75]], i % 2 ? marble : green, { p: 'cube' });
        });
        B.rev(g, [[8.2, 0.82], [8.4, 0.82]], marble, { p: 'cube' });
      }));
      // the Baptistery of St John, octagonal, in front of the cathedral
      B.group(() => {
        const g = [-11.6, 0, 0];
        B.rev(g, [[0, 1.45], [2.6, 1.45]], marble, { p: 'oct' });
        B.rev(g, [[0.9, 1.49], [1.02, 1.49]], green, { p: 'oct' });
        B.rev(g, [[2.6, 1.2], [3.3, 1.2]], marble, { p: 'oct' });
        B.rev(g, [[3.3, 1.28], [4.3, 0.3]], marble, { p: 'oct' });
        B.rev(g, [[4.3, 0.25], [4.75, 0.25]], marble, { p: 'oct' });
        B.rev(g, [[4.75, 0.28], [5.2, 0]], marble, { p: 'oct' });
        B.ball(g, 5.25, 0.07, gold);
      });
    }
    if (prm.interior) {
      const stoneGrey = [0.6, 0.6, 0.58];
      // pietra serena piers and ribs, round windows in the clerestory
      B.nave({ x0: -8, x1: -1.5, ax: [-8, -2.75], piers: [-8, -6.7, -5.4, -4.1, -2.75],
        b: 0.8, wallT: 0.2, A: 1.82, Ao: 2, aisleTop: 2.7, spring: 1.85, rise: 0.7, wallTop: 3.55, vaultTop: 4.25, arch: 'pointed', pq: 0.11,
        colR: 0.12, colCol: stoneGrey, ribCol: stoneGrey, clere: [2.85, 3.45], oculus: true, glass: [[C.glass, C.glassRed, C.amber]] });
      // the octagon under the dome, open to the drum; the tribunes round it
      B.carveRev([X, 0, 0], [[0, 2.5], [5.65, 2.5]], { p: 'oct' });
      for (const d of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = d.findIndex(v => v), axis = [0, 2, 3][k], sg = d[k], c = [0, 0];
        B.carve(vaultPts(axis, sg * 2.2, sg * 3.0, c, 0.95, 2.6, 0.55, 'pointed'));
        B.carveRev(along([X, 0, 0], d, 2.75), [[0, 1.35], [2.85, 1.35]], { p: 'oct', half: d });
      }
      portal(B, archPts(-0.35, 0.35, -0.35, 0.35, -8.5, -7.95, 1.1, 0.35, 'pointed').map(swapXZ), 0);
      domeParts();
      B.box([-8, -2.75], [-0.1, 0], [-2, 2], [-2, 2], C.floor);
      B.rev([X, 0, 0], [[-0.1, 2.75], [0, 2.75]], C.floor, { p: 'oct' });
      for (const d of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) B.rev(along([X, 0, 0], d, 2.75), [[-0.1, 1.55], [0, 1.55]], C.floor, { p: 'oct', half: d });
      B.box([X - 0.2, X + 0.2], [0, 0.12], [-0.2, 0.2], [-0.2, 0.2], marble);
      B.spot('Nave', [-5.4, 0, 0]); B.spot('Under the dome', [X - 0.7, 0, 0], 0, 0.85); B.spot('Tribune', [3.2, 0, 0]);
    }
    return {
      name: 'Florence Cathedral', sub: 'Santa Maria del Fiore, 1296–1436 · Brunelleschi',
      rows: [
        ['Dome', 'Brunelleschi’s octagonal dome, its cross-sections rhombicuboctahedra: every coordinate slice through its axis is an octagon'],
        ['Ribs', 'the eight white ribs run along the octagon’s corners; in 4D they run along all 48 edges of the rhombicuboctahedron'],
        ['Tribunes', 'the trefoil of apses round the octagon becomes five, on +x, ±z and ±w'],
        ['Campanile', prm.grounds ? 'Giotto’s bell tower stands on the +z side of the façade, and on the +w side' : 'hidden (Grounds off)'],
        ['Baptistery', prm.grounds ? 'the octagonal Baptistery in front, with its pyramidal roof and lantern' : 'hidden (Grounds off)'],
        ...(prm.interior ? [['Inside', 'Brunelleschi’s two shells: terracotta outside, the painted Last Judgement inside in rings of colour, open at the top to the lantern. The octagon opens into five tribunes; the nave has grey pietra serena piers and round clerestory windows']] : []),
      ],
    };
  }

  // spots: the places to stand inside (made by each builder with B.spot, in this order)
  const CATHEDRALS = {
    'notre-dame': { name: 'Notre-Dame de Paris', build: notreDame, spots: ['West end', 'Nave', 'Crossing', 'Choir', 'Aisle'] },
    'st-peters': { name: 'St Peter’s Basilica', build: stPeters, grounds: true, spots: ['Nave', 'Under the dome', 'Transept', 'Apse'] },
    sagrada: { name: 'Sagrada Família', build: sagrada, spots: ['Nave', 'Crossing', 'Apse', 'Transept'] },
    'hagia-sophia': { name: 'Hagia Sophia', build: hagiaSophia, spots: ['Under the dome', 'East apse', 'Aisle'] },
    'st-basil': { name: 'St Basil’s Cathedral', build: stBasil, spots: ['Central church', 'Passage', 'Chapel'] },
    florence: { name: 'Florence Cathedral', build: florence, grounds: true, spots: ['Nave', 'Under the dome', 'Tribune'] },
  };

  // ---------- from point sets to convex parts ----------
  // The hull's simplices, merged by hyperplane, give the part's cells.
  function convexPart(pts) {
    const F = O.hull4(pts);
    if (!F) return null;
    const planes = [];
    for (const f of F) if (!planes.some(p => samePlane(p, f.n, f.h))) planes.push({ n: f.n, h: f.h, int: false });
    // corners: points on at least four cells (dropping repeats and points inside faces)
    const V = [], inc = [], uniq = new Map();
    for (const p of pts) {
      const k = p.map(x => Math.round(x * 1e7)).join();
      if (uniq.has(k)) continue;
      uniq.set(k, 1);
      const on = [];
      planes.forEach((pl, i) => { if (Math.abs(dot4(pl.n, p) - pl.h) < 1e-7) on.push(i); });
      if (on.length >= 4) { V.push(p); inc.push(on); }
    }
    return { planes, V, inc };
  }
  const samePlane = (p, n, h) => Math.abs(p.h - h) < 1e-6 && Math.abs(p.n[0] - n[0]) + Math.abs(p.n[1] - n[1]) + Math.abs(p.n[2] - n[2]) + Math.abs(p.n[3] - n[3]) < 1e-6;
  // a part from points; with real (sets of point indices, each in one real face) every other cell is a seam
  function makePart(pts, real) {
    const P = convexPart(pts);
    if (P && real) for (const pl of P.planes) pl.int = !real.some(set => set.length >= 3 && set.every(i => Math.abs(dot4(pl.n, pts[i]) - pl.h) < 1e-7));
    return P;
  }
  function edgesOf(P) {
    if (P.edges) return P.edges;
    const E = new Map();
    for (const f of faces(P)) for (let k = 0; k < f.poly.length; k++) { const a = f.poly[k], b = f.poly[(k + 1) % f.poly.length]; E.set(a < b ? a * 65536 + b : b * 65536 + a, [a, b]); }
    return (P.edges = [...E.values()]);
  }
  // P ∩ {n·p ≤ h}: the corners inside, and where edges cross; the new cell is a seam or real as asked
  function clip(P, n, h, seam) {
    const s = P.V.map(v => dot4(n, v) - h);
    if (s.every(x => x <= 1e-9)) return P;
    if (s.every(x => x >= -1e-9)) return null;
    const pts = P.V.filter((_, i) => s[i] <= 1e-9);
    for (const [a, b] of edgesOf(P)) if ((s[a] < -1e-9 && s[b] > 1e-9) || (s[a] > 1e-9 && s[b] < -1e-9)) { const t = s[a] / (s[a] - s[b]); pts.push(P.V[a].map((x, q) => x + t * (P.V[b][q] - x))); }
    const Q = convexPart(pts);
    if (!Q) return null;
    for (const pl of Q.planes) { if (samePlane(pl, n, h)) pl.int = seam; else { const old = P.planes.find(o => samePlane(o, pl.n, pl.h)); pl.int = old ? old.int : false; } }
    return Q;
  }
  // A − C for convex parts, as convex pieces: the part beyond each of C's cells in turn. null: they do not meet.
  // A piece's face on C's cell faces the carved space (real); the cuts between pieces are seams
  function subtract(A, C) {
    let rem = A; const pieces = [];
    for (const pl of C.planes) {
      const out = clip(rem, pl.n.map(x => -x), -pl.h, false);
      const rest = clip(rem, pl.n, pl.h, true);
      if (!rest) return null;
      if (out && out !== rem) pieces.push(out);
      rem = rest;
    }
    return pieces;
  }
  // 2D convex hull (monotone chain) of points given in face coordinates; returns indices in order
  function hull2(P) {
    const idx = P.map((_, i) => i).sort((a, b) => P[a][0] - P[b][0] || P[a][1] - P[b][1]);
    const cr = (o, a, b) => (P[a][0] - P[o][0]) * (P[b][1] - P[o][1]) - (P[a][1] - P[o][1]) * (P[b][0] - P[o][0]);
    const lo = [], up = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 1e-12) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], i) <= 1e-12) up.pop(); up.push(i); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  // the part's 2-faces (ordered polygons of corner indices), each with the two cells it lies on
  function faces(part) {
    const { V, inc } = part, pairs = new Map();
    V.forEach((_, vi) => { const on = inc[vi]; for (let a = 0; a < on.length; a++) for (let b = a + 1; b < on.length; b++) { const k = on[a] * 65536 + on[b]; let l = pairs.get(k); if (!l) pairs.set(k, l = []); l.push(vi); } });
    const out = [];
    for (const [k, vs] of pairs) {
      if (vs.length < 3) continue;
      const c = [0, 1, 2, 3].map(q => vs.reduce((s, v) => s + V[v][q], 0) / vs.length);
      // a basis of the face's plane
      let e1 = null, e2 = null;
      for (const v of vs) { const d = sub4(V[v], c), l = Math.hypot(...d); if (l > 1e-9) { e1 = d.map(x => x / l); break; } }
      if (!e1) continue;
      let best = 0;
      for (const v of vs) { let d = sub4(V[v], c); const t = dot4(d, e1); d = sub4(d, e1.map(x => x * t)); const l = Math.hypot(...d); if (l > best) { best = l; e2 = d.map(x => x / l); } }
      if (best < 1e-7) continue;
      const P2 = vs.map(v => { const d = sub4(V[v], c); return [dot4(d, e1), dot4(d, e2)]; }), h = hull2(P2);
      if (h.length >= 3) out.push({ poly: h.map(i => vs[i]), cells: [Math.floor(k / 65536), k % 65536] });
    }
    return out;
  }

  // ---------- building, normalising, caching ----------
  const cache = new Map(), buildKey = (id, prm) => JSON.stringify([id, prm.detail, !!prm.grounds, !!prm.interior]);
  // ray tracer data that arrived from the worker, by build
  const texelCache = new Map();
  function texelsFor(id, prm) {
    const t = texelCache.get(buildKey(id, prm));
    if (!t) return null;
    if (!t.nested) { const n = []; for (let i = 0; i < t.flat.length; i += 4) n.push([t.flat[i], t.flat[i + 1], t.flat[i + 2], t.flat[i + 3]]); t.nested = n; }
    return t.nested;
  }
  function build(id, prm) {
    const key = buildKey(id, prm);
    if (cache.has(key)) return cache.get(key);
    const spec = CATHEDRALS[id], B = Builder(prm.detail || 2), info = spec.build(B, prm);
    // fit within the unit ball: centre the ground plan's bounding box and the height range, then scale
    const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
    const walk = (n, f) => { if (n.pts) f(n); else n.kids.forEach(k => walk(k, f)); };
    walk(B.top, n => { for (const p of n.pts) for (let q = 0; q < 4; q++) { lo[q] = Math.min(lo[q], p[q]); hi[q] = Math.max(hi[q], p[q]); } });
    const c = lo.map((x, q) => (x + hi[q]) / 2);
    let R = 0;
    walk(B.top, n => { for (const p of n.pts) R = Math.max(R, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2], p[3] - c[3])); });
    const s = 1 / R, fit = p => p.map((x, q) => (x - c[q]) * s);
    const ball = P => { const bc = [0, 1, 2, 3].map(q => (Math.min(...P.V.map(v => v[q])) + Math.max(...P.V.map(v => v[q]))) / 2); P.c = bc; P.r = Math.max(...P.V.map(v => Math.hypot(...sub4(v, bc)))) + 1e-6; return P; };
    // run the parts and carves in order: each carve cuts the parts made before it into pieces
    const live = [];
    for (const op of B.ops) {
      if (op.node) {
        const fp = op.node.pts.map(fit), P = makePart(fp, op.node.real);
        if (!P) { op.parent.kids.splice(op.parent.kids.indexOf(op.node), 1); continue; }
        op.node.part = ball(P); live.push(op);
        continue;
      }
      const Cp = convexPart(op.air.map(fit));
      if (!Cp) continue;
      ball(Cp);
      for (let i = 0; i < live.length; i++) {
        const L = live[i], P = L.node.part;
        if (Math.hypot(...sub4(P.c, Cp.c)) >= P.r + Cp.r) continue;
        const pieces = subtract(P, Cp);
        if (!pieces) continue;
        const nodes = pieces.map(pc => ({ ...L.node, part: ball(pc) })), kids = L.parent.kids;
        kids.splice(kids.indexOf(L.node), 1, ...nodes);
        live.splice(i, 1, ...nodes.map(nd => ({ node: nd, parent: L.parent })));
        i += nodes.length - 1;
      }
    }
    // the tree of groups and parts, depth first; each with a bounding ball
    const parts = [];
    const make = n => {
      if (n.pts) {
        if (!n.part) return null;
        const part = { ...n.part, col: n.col, smooth: n.smooth, axis: n.axis ? fit(n.axis) : null, src: n.src };
        parts.push(part);
        return part;
      }
      const kids = n.kids.map(make).filter(Boolean);
      return kids.length ? groupOf(cluster(kids)) : null;
    };
    // a ball round the kids' balls
    const groupOf = kids => {
      const lo2 = [0, 1, 2, 3].map(q => Math.min(...kids.map(k => k.c[q] - k.r))), hi2 = [0, 1, 2, 3].map(q => Math.max(...kids.map(k => k.c[q] + k.r)));
      const gc = lo2.map((x, q) => (x + hi2[q]) / 2), gr = Math.max(...kids.map(k => Math.hypot(...sub4(k.c, gc)) + k.r));
      return { kids, c: gc, r: gr };
    };
    // a big group (carving leaves many pieces in one) becomes a tree of balls: split at the median along its widest axis
    const cluster = kids => {
      if (kids.length <= 8) return kids;
      const lo2 = [0, 1, 2, 3].map(q => Math.min(...kids.map(k => k.c[q]))), hi2 = [0, 1, 2, 3].map(q => Math.max(...kids.map(k => k.c[q])));
      let ax = 0; for (let q = 1; q < 4; q++) if (hi2[q] - lo2[q] > hi2[ax] - lo2[ax]) ax = q;
      const sorted = kids.slice().sort((a, b) => a.c[ax] - b.c[ax]), m = sorted.length >> 1;
      return [groupOf(cluster(sorted.slice(0, m))), groupOf(cluster(sorted.slice(m)))];
    };
    const tree = make(B.top);
    // height in the builder's units (tens of metres)
    const out = { tree, parts, info, spec, height: hi[1] - lo[1], spots: B.spots.map(sp => ({ name: sp.name, p: fit(sp.p), pitch: sp.pitch })) };
    cache.set(key, out);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    return out;
  }

  // the mesh: per part, its 2-faces as triangles (projection), its cells as tetrahedra fanned from their centres
  // (slices), and its edges (except on round parts, whose facets are not real edges)
  function mesh(id, prm) {
    const K = build(id, prm), M = new O.Mesh(), smooth = [];
    let nCells = 0, nRound = 0;
    for (const part of K.parts) {
      const base = part.V.map(v => M.pt(v)), fs = faces(part), byCell = new Map(), edges = new Set(), pl = part.planes;
      nCells += pl.length; if (part.smooth) nRound++;
      // an edge on a seam is not a real edge
      const seamEdge = (a, b) => part.inc[a].some(i => pl[i].int && part.inc[b].includes(i));
      for (const f of fs) {
        const p = f.poly;
        if (!pl[f.cells[0]].int && !pl[f.cells[1]].int) {
          for (let k = 1; k + 1 < p.length; k++) { M.tri(base[p[0]], base[p[k]], base[p[k + 1]], part.col); smooth.push(part.smooth ? 1 : 0); }
          if (!part.smooth) for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length], key = a < b ? a * 65536 + b : b * 65536 + a; if (!edges.has(key) && !seamEdge(a, b)) { edges.add(key); M.edge(base[a], base[b]); } }
        }
        for (const cl of f.cells) { if (pl[cl].int) continue; let l = byCell.get(cl); if (!l) byCell.set(cl, l = []); l.push(p); }
      }
      for (const [cl, polys] of byCell) {
        const vs = [...new Set(polys.flat())], cc = [0, 1, 2, 3].map(q => vs.reduce((s, v) => s + part.V[v][q], 0) / vs.length), ci = M.pt(cc);
        for (const p of polys) for (let k = 1; k + 1 < p.length; k++) M.tet(ci, base[p[0]], base[p[k]], base[p[k + 1]], part.col, ci);
      }
    }
    const I = K.info;
    // the ray tracer's data, built here (in the worker) so the page never builds a cathedral itself
    const gpu = Float32Array.from(gpuTexels(id, prm).flat());
    return M.done({
      triSmooth: Uint8Array.from(smooth),
      info: {
        name: I.name, sub: I.sub,
        counts: [['parts', K.parts.length], ['cells', nCells], ['round', nRound], ['height', Math.round(K.height * 10) + ' m']],
        spots: K.spots, gpu, gpuKey: buildKey(id, prm),
        rows: [...I.rows, ['Lift', 'y is up and the ground is 3D (x, z, w). Whatever stands on the ±z sides of the real building also stands on the ±w sides; anything round in plan is round in all three ground directions. The slice w = 0 is close to the real building; turn in the zw plane, or move the slice, to see the rest']],
      },
    });
  }

  // a field for combining with other shapes (CSG): the least, over parts, of the most of its cells' plane
  // values. A group or part whose bounding ball is far enough away is skipped: a convex part inside a ball
  // (c, R) has field at least γ|p − c| − R, where γ is the smallest, over directions u, of the largest n·u.
  function field(id, prm) {
    const K = build(id, prm);
    // γ by sampling directions (generous margin)
    let gamma = 1;
    const dirs = [];
    let sd = 12345; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) { let v; do { v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]; } while (Math.hypot(...v) > 1 || Math.hypot(...v) < 0.1); const l = Math.hypot(...v); dirs.push(v.map(x => x / l)); }
    for (const part of K.parts) for (const u of dirs) { let m = -Infinity; for (const pl of part.planes) m = Math.max(m, dot4(pl.n, u)); gamma = Math.min(gamma, m); }
    gamma *= 0.75;
    const flat = [];
    const lay = n => {
      const at = flat.length;
      if (n.planes) { const pl = new Float64Array(n.planes.length * 5); n.planes.forEach((p, i) => { pl.set(p.n, i * 5); pl[i * 5 + 4] = p.h; }); flat.push({ c: n.c, r: n.r, pl }); }
      else { flat.push({ c: n.c, r: n.r, pl: null }); n.kids.forEach(lay); }
      flat[at].skip = flat.length;
    };
    lay(K.tree);
    return (x0, x1, x2, x3, P) => {
      let best = Infinity, bpl = null, bo = 0;
      for (let i = 0; i < flat.length;) {
        const n = flat[i], c = n.c;
        if (gamma * Math.hypot(x0 - c[0], x1 - c[1], x2 - c[2], x3 - c[3]) - n.r >= best) { i = n.skip; continue; }
        if (n.pl) {
          const pl = n.pl; let v = -Infinity, vo = 0;
          for (let o = 0; o < pl.length; o += 5) { const u = pl[o] * x0 + pl[o + 1] * x1 + pl[o + 2] * x2 + pl[o + 3] * x3 - pl[o + 4]; if (u > v) { v = u; vo = o; } }
          if (v < best) { best = v; bpl = pl; bo = vo; }
        }
        i++;
      }
      if (P && bpl) for (let q = 0; q < 5; q++) P[q] = bpl[bo + q];
      return best;
    };
  }

  // the ray tracer's data: the tree depth first. A group: [centre], [radius, −1, texels to skip it, 0].
  // A part: [centre], [radius, cells, texels to the next node, smooth], [colour], [axis point], then per cell
  // [normal], [h, offset back to the part's first texel, 1 if a seam, 0].
  function gpuTexels(id, prm) {
    const K = build(id, prm), tx = [];
    const lay = n => {
      const at = tx.length;
      if (n.planes) {
        tx.push(n.c, [n.r, n.planes.length, 4 + 2 * n.planes.length, n.smooth && n.axis ? 1 : 0], [...n.col, 0], n.axis || [0, 0, 0, 0]);
        n.planes.forEach(p => { const o = tx.length; tx.push(p.n, [p.h, at - o, p.int ? 1 : 0, 0]); });
      } else {
        tx.push(n.c, [n.r, -1, 0, 0]);
        n.kids.forEach(lay);
        tx[at + 1][2] = tx.length - at;
      }
    };
    lay(K.tree);
    return tx;
  }

  Object.assign(O, { cathedralBuild: build, cathedralFaces: faces, cathedralTexelsFor: texelsFor, cathedralTexelsArrived: (key, flat) => { if (!texelCache.has(key)) texelCache.set(key, { flat }); if (texelCache.size > 8) texelCache.delete(texelCache.keys().next().value); }, CATHEDRALS, cathedral: mesh, cathedralField: field, cathedralTexels: gpuTexels });
})(typeof window !== 'undefined' ? window : globalThis);
