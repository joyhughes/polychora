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

  // ---------- small 4D helpers ----------
  const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sub4 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
  // ground point (x, z, w) at height y as a 4D point (x, y, z, w)
  const G4 = (g, y) => [g[0], y, g[1], g[2]];

  // ---------- the builder ----------
  // Parts are recorded as point sets in a tree of groups; transforms (quarter turns, moves) apply as they are added.
  function Builder(detail) {
    const top = { kids: [] }, stack = [top];
    let xf = p => p;
    const B = {
      detail,
      group(fn) { const g = { kids: [] }; stack[stack.length - 1].kids.push(g); stack.push(g); fn(); stack.pop(); },
      // a convex part: the hull of pts. opt.axis: a point on the vertical axis of a solid of revolution (smooth shading)
      hull(pts, col, opt = {}) {
        stack[stack.length - 1].kids.push({ pts: pts.map(p => xf(p)), col, smooth: !!opt.smooth, axis: opt.axis ? xf(opt.axis) : null });
      },
      with(f, fn) { const old = xf; xf = p => old(f(p)); fn(); xf = old; },
      // quarter turns in the plane of axes i, j (0 x, 1 y, 2 z, 3 w), q = 1, 2, 3
      turn(i, j, q, fn) {
        B.with(p => { const o = p.slice(); for (let k = 0; k < q; k++) { const a = o[i], b = o[j]; o[i] = -b; o[j] = a; } return o; }, fn);
      },
      // fn draws the +z side of the building; it is repeated on +w, −z, −w
      sides(fn) { for (let q = 0; q < 4; q++) { if (q) B.turn(2, 3, q, fn); else fn(); } },
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
          for (let i = 0; i + 1 < lats.length; i++) {
            const P = [];
            for (const th of [lats[i], lats[i + 1]]) {
              const m = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), Math.sin(th)];
              for (const [y, r] of prof) for (const k of [1 - d, 1 + d]) for (const sg of [-t, t])
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
          const P = [];
          for (const [y, r] of prof) for (const v of [a, b]) for (const k of [1 - d, 1 + d]) for (const sg of [-t, t])
            P.push([g[0] + r * k * v[0] + sg * tg[0], y, g[1] + r * k * v[1] + sg * tg[1], g[2] + r * k * v[2] + sg * tg[2]]);
          B.hull(P, col);
        }
      },
      top,
    };
    return B;
  }
  // ground directions: the six axes, and the twelve diagonals of the cuboctahedron
  const AXES6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const DIAG12 = [];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) for (const si of [1, -1]) for (const sj of [1, -1]) { const d = [0, 0, 0]; d[i] = si * Math.SQRT1_2; d[j] = sj * Math.SQRT1_2; DIAG12.push(d); }
  const along = (g, d, s) => [g[0] + s * d[0], g[1] + s * d[1], g[2] + s * d[2]];

  // ---------- palette ----------
  const C = {
    stone: [0.8, 0.76, 0.66], stoneLight: [0.9, 0.87, 0.8], stoneDark: [0.6, 0.56, 0.49], lead: [0.45, 0.5, 0.57],
    glass: [0.24, 0.34, 0.8], glassRed: [0.72, 0.18, 0.26], dark: [0.2, 0.18, 0.17], gold: [0.96, 0.76, 0.26],
    trav: [0.87, 0.82, 0.7], travLight: [0.94, 0.91, 0.84], domeLead: [0.5, 0.56, 0.63],
    terracotta: [0.76, 0.34, 0.21], marble: [0.94, 0.93, 0.9], green: [0.24, 0.46, 0.36], pink: [0.86, 0.6, 0.6],
    brick: [0.68, 0.22, 0.17], white: [0.95, 0.94, 0.9], ochre: [0.82, 0.6, 0.45], sand: [0.84, 0.74, 0.58],
    sandDark: [0.7, 0.6, 0.46], cypress: [0.2, 0.48, 0.3],
  };

  // ---------- Notre-Dame de Paris ----------
  function notreDame(B, prm) {
    const { stone, stoneLight, stoneDark, lead, glass, glassRed, dark, gold } = C;
    B.group(() => {
      // the nave and choir, square in z and w, under a lead hip roof
      B.sq([-5, 3.6], [0, 3.3], 0.6, stone);
      B.roof([-5, 3.6], 3.3, 1.05, 0.66, lead);
      // double aisles and chapels all round, with lean-to roofs against the clerestory
      B.sq([-5, 3.6], [0, 1.6], 2.2, stone);
      const P = [];
      for (const x of [-5, 3.6]) { for (const s of [[2.25, 1.6], [0.62, 2.15]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]); }
      B.hull(P, lead);
      // the east end: a half-round apse for the choir, its conical roof, and the ambulatory below
      const half = [1, 0, 0];
      B.rev([3.6, 0, 0], [[0, 0.6], [3.3, 0.6]], stone, { p: 'm', half });
      B.rev([3.6, 0, 0], [[3.3, 0.66], [4.35, 0]], lead, { p: 'm', half });
      B.rev([3.6, 0, 0], [[0, 2.2], [1.6, 2.2]], stone, { p: 'm', half });
      B.rev([3.6, 0, 0], [[1.6, 2.25], [2.15, 0.62]], lead, { p: 'm', half });
    });
    // the transept: arms along z and w, each with a rose window in its end
    B.sides(() => B.group(() => {
      B.box([0.35, 1.65], [0, 3.3], [0, 2.5], [-0.65, 0.65], stone);
      const P = [];
      for (const z of [0, 2.5]) { for (const x of [0.35, 1.65]) for (const w of [-0.65, 0.65]) P.push([x, 3.3, z, w]); P.push([1, 4.35, z, 0]); }
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
      B.box([-5.8, -5.7], [0, 1.35], [-0.38, 0.38], [-0.38, 0.38], dark);
      B.sides(() => {
        B.box([-5.8, -5.7], [0, 1.15], [1.2, 1.75], [-0.3, 0.3], dark);
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
      B.rev([1, 0, 0], [[3.9, 0.3], [5.1, 0.3]], lead, { p: 'oct' });
      B.rev([1, 0, 0], [[5.1, 0.32], [9.6, 0]], lead, { p: 'oct' });
      B.ball([1, 0, 0], 9.65, 0.07, gold);
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
    return {
      name: 'Notre-Dame de Paris', sub: 'Paris, 1163–1345 · Gothic',
      rows: [
        ['Plan', 'the nave runs along x; its cross-section is a square in z and w, so it has four sides instead of two, each with its aisles, chapels and flying buttresses'],
        ['Transept', 'arms along both z and w: the crossing is where three axes meet, and every arm ends in a rose window (a glass ball, flat in the arm’s direction)'],
        ['West front', 'the two towers stand on the ±z sides of the front, and two more on the ±w sides: the slice w = 0 shows the familiar pair'],
        ['Apse', 'a half ball instead of a half cylinder, ringed by buttresses in every direction of the half sphere'],
        ['Roofs', 'hip roofs over the square sections: in the slice w = 0 each is the familiar gable'],
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
      B.sq([-9.4, -2.3], [0, 3.2], 3, trav);
      const P = [];
      for (const x of [-9.4, -2.3]) for (const s of [[3.05, 3.2], [1.42, 3.75]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
      B.hull(P, lead);
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
    B.group(() => {
      const g = [X, 0, 0], ph16 = Array.from({ length: 16 }, (_, k) => TAU * (k + 0.5) / 16);
      B.rev(g, [[4.95, 2.45], [7.3, 2.45]], trav, { p: 'l' });
      B.fins(g, [[4.95, 2.45], [7.3, 2.45]], ph16, 0.07, 0.11, travLight);
      B.rev(g, [[7.3, 2.64], [7.58, 2.64]], travLight, { p: 'l' });
      const dome = [[7.58, 2.42], [8.4, 2.33], [9.2, 2.06], [9.9, 1.63], [10.5, 1.06], [10.85, 0.62]];
      B.rev(g, dome, domeLead, { p: 'l' });
      B.fins(g, dome, ph16, 0.035, 0.06, travLight);
      B.rev(g, [[10.85, 0.62], [11.9, 0.62]], trav, { p: 'm' });
      B.fins(g, [[10.85, 0.62], [11.9, 0.62]], Array.from({ length: 8 }, (_, k) => TAU * (k + 0.5) / 8), 0.12, 0.05, travLight, 'm');
      B.rev(g, [[11.9, 0.7], [12.05, 0.7]], travLight, { p: 'm' });
      B.rev(g, [[12.05, 0.58], [12.5, 0.42], [12.85, 0.08]], domeLead, { p: 'm' });
      B.ball(g, 13.05, 0.2, gold);
      // the cross on the ball: an upright and bars along z and w
      B.beam([X, 13.2, 0, 0], [X, 14.1, 0, 0], 0.045, gold);
      B.beam([X, 13.8, -0.3, 0], [X, 13.8, 0.3, 0], 0.04, gold);
      B.beam([X, 13.8, 0, -0.3], [X, 13.8, 0, 0.3], 0.04, gold);
    });
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
      B.sq([-10.2, -10.1], [0, 1.6], 0.6, dark);
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
    return {
      name: 'St Peter’s Basilica', sub: 'Rome, 1506–1626 · Renaissance and Baroque',
      rows: [
        ['Dome', 'Michelangelo’s dome as a 3-sphere cap: its sixteen ribs and drum columns are fins along meridians of the ball-shaped cross-sections, so every slice shows sixteen'],
        ['Cupolas', 'the four corner cupolas become twelve, on the diagonals of the 3D ground (a cuboctahedron)'],
        ['Centre', 'Michelangelo’s Greek cross gains a third arm direction: apses close the arms at +x, ±z and ±w'],
        ['Façade', 'its giant order stands in a cross on the façade’s 3D face: a row along z and a row along w'],
        ['Piazza', prm.grounds ? 'Bernini’s oval colonnade, an ellipse of columns, becomes an ellipsoid shell of them, open towards and away from the basilica' : 'hidden (Grounds off)'],
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
      B.sq([-4.6, 2.6], [0, 3], 2.25, sand);
      const P = [];
      for (const x of [-4.6, 2.6]) for (const s of [[2.3, 3], [0.78, 3.7]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
      B.hull(P, sandDark);
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
      B.box([dl[0], dh[0]], [0, 2.4], [dl[1], dh[1]], [dl[2], dh[2]], dark);
      // the Nativity façade's cypress, the tree of life, above its portal
      if (name === 'nat') { const g = ctr.slice(); g[axis] += sgn * 0.5; B.rev(g, [[4.2, 0.45], [5.1, 0.35], [6.2, 0]], cypress, { p: 'm' }); B.ball(g, 6.3, 0.12, white); }
    });
    facade(0, -1, 'glory');
    facade(1, 1, 'nat'); facade(1, -1, 'pas'); facade(2, 1, 'nat'); facade(2, -1, 'pas');
    // the transepts behind them
    B.group(() => { for (const k of [1, 2]) { const zr = k === 1 ? [-3.1, 3.1] : [-0.75, 0.75], wr = k === 2 ? [-3.1, 3.1] : [-0.75, 0.75]; B.box([X - 0.75, X + 0.75], [0, 4.5], zr, wr, sand); } });
    // the tower of Jesus Christ over the crossing, with its 4D cross: arms along all four axes
    B.group(() => {
      const g = [X, 0, 0];
      B.rev(g, [[4.5, 1.05], [10, 0.88], [14, 0.56], [16.5, 0.2], [17.2, 0.05]], sand, { p: 'l' });
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
    return {
      name: 'Basílica de la Sagrada Família', sub: 'Barcelona, 1882– · Gaudí',
      rows: [
        ['Towers', 'each façade’s row of four bell towers becomes a cross of eight, four along each of the façade’s side axes'],
        ['Façades', 'Glory at the west end; the transept façades (Nativity, with its cypress, and Passion) face ±z and ±w'],
        ['Evangelists', 'the four towers round the central tower become eight, on the corners of a cube'],
        ['Jesus Christ', 'the tallest tower; Gaudí’s three-armed cross becomes a four-armed one, along x, y, z and w'],
        ['Mary', 'the tower over the apse, crowned with its star'],
      ],
    };
  }

  // ---------- Hagia Sophia ----------
  function hagiaSophia(B, prm) {
    const { ochre, domeLead, gold, stoneLight } = C, wall = [0.8, 0.56, 0.44];
    B.group(() => {
      B.box([-3.8, 3.8], [0, 2.4], [-3.4, 3.4], [-3.4, 3.4], wall);
      B.sq([-1.7, 1.7], [0, 4.0], 1.7, wall);
      // the half domes east and west, and the exedrae beside them
      for (const sx of [1, -1]) {
        const d = [sx, 0, 0], g = [sx * 1.7, 0, 0];
        B.rev(g, [[2.4, 1.7], [3.3, 1.7]], wall, { p: 'l', half: d });
        B.rev(g, [[3.3, 1.7], [3.85, 1.55], [4.3, 1.12], [4.6, 0.6], [4.72, 0]], domeLead, { p: 'l', half: d });
        B.sides(() => {
          const e = [sx * 2.9, 1.2, 0];
          B.rev(e, [[2.4, 0.8], [2.8, 0.7], [3.05, 0.42], [3.15, 0]], domeLead, { p: 'm', half: d });
        });
      }
      // the great buttresses on the sides
      B.sides(() => { for (const sx of [1, -1]) B.box([sx * 1.7 - 0.45, sx * 1.7 + 0.45], [0, 4.25], [1.7, 3.0], [-0.45, 0.45], wall); });
    });
    // the dome on its ring of windows
    B.group(() => {
      const g = [0, 0, 0];
      B.rev(g, [[4.0, 1.72], [4.35, 1.72]], wall, { p: 'l' });
      B.fins(g, [[4.0, 1.72], [4.35, 1.72]], Array.from({ length: 24 }, (_, k) => TAU * (k + 0.5) / 24), 0.04, 0.05, stoneLight);
      B.rev(g, [[4.35, 1.66], [4.8, 1.45], [5.2, 1.08], [5.48, 0.6], [5.58, 0]], domeLead, { p: 'l' });
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
    const chapel = (g, r, h, R, bands, p) => B.group(() => {
      B.rev(g, [[0.8, r], [0.8 + h, r]], brick, { p: 'oct' });
      B.rev(g, [[0.8 + h * 0.45, r * 1.06], [0.8 + h * 0.5, r * 1.06]], white, { p: 'oct' });
      B.rev(g, [[0.8 + h, r * 1.08], [0.95 + h, r * 1.08]], white, { p: 'oct' });
      B.rev(g, [[0.95 + h, r * 0.85], [1.4 + h, r * 0.6]], brick, { p: 'oct' });
      onion(g, 1.4 + h, R, bands, p);
    });
    B.group(() => {
      B.box([-3.2, 3.2], [0, 0.8], [-3.2, 3.2], [-3.2, 3.2], brick);
      B.box([-3.25, 3.25], [0.68, 0.84], [-3.25, 3.25], [-3.25, 3.25], white);
    });
    // the central church of the Intercession: an octagonal tower with a tent roof
    B.group(() => {
      const g = [0, 0, 0];
      B.rev(g, [[0.8, 1.05], [4.9, 1.05]], brick, { p: 'oct' });
      B.rev(g, [[4.9, 1.12], [5.1, 1.12]], white, { p: 'oct' });
      B.rev(g, [[5.1, 1.0], [8.4, 0.28]], brick, { p: 'oct' });
      B.edgeRibs(g, [[5.1, 1.0], [8.4, 0.28]], 0.02, 0.025, white);
      B.rev(g, [[8.4, 0.24], [8.9, 0.24]], white, { p: 'oct' });
      onion(g, 8.9, 0.24, [[0.95, 0.76, 0.26]], 'm');
    });
    // eight chapels round it in the real church (four large on the axes, four small on the diagonals): here
    // six large ones on the axes of the ground and twelve small ones on its diagonals
    AXES6.forEach((d, i) => chapel(along([0, 0, 0], d, 2.3), 0.72, 3.0, 0.62, BANDS[i % BANDS.length], 'm'));
    DIAG12.forEach((d, i) => chapel(along([0, 0, 0], d, 2.15), 0.46, 2.1, 0.42, BANDS[(i + 3) % BANDS.length], i % 3 ? 's' : 'cube'));
    return {
      name: 'St Basil’s Cathedral', sub: 'Moscow, 1555–1561 · Russian',
      rows: [
        ['Plan', 'nine churches: the central tent-roofed tower and the chapels round it. The four large chapels on the axes become six, on ±x, ±z and ±w'],
        ['Diagonals', 'the four small chapels on the diagonals become twelve, on the diagonals of the 3D ground (a cuboctahedron)'],
        ['Domes', 'each onion is a solid of revolution with ball-shaped cross-sections, banded in two colours; some small ones are faceted'],
        ['Towers', 'octagonal, as in Moscow: their cross-sections are rhombicuboctahedra, whose central slices are octagons'],
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
      B.sq([-8, -2.75], [0, 3.0], 2.0, marble);
      for (const y of [0.9, 1.9]) B.sq([-8, -2.75], [y, y + 0.12], 2.04, green);
      const P = [];
      for (const x of [-8, -2.75]) for (const s of [[2.05, 3], [1.02, 3.5]]) for (const z of [-1, 1]) for (const w of [-1, 1]) P.push([x, s[1], z * s[0], w * s[0]]);
      B.hull(P, terracotta);
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
    // edge of the rhombicuboctahedral cross-sections), and the lantern
    B.group(() => {
      const g = [X, 0, 0];
      B.rev(g, [[4.4, 2.75], [5.6, 2.75]], marble, { p: 'oct' });
      for (const d of AXES6) B.disc(G4(along(g, d, 2.78), 5.0), d[0] ? 0 : d[1] ? 2 : 3, 0.32, 0.06, dark);
      const dome = [[5.6, 2.62], [6.5, 2.52], [7.4, 2.22], [8.1, 1.7], [8.6, 1.05], [8.8, 0.72]];
      B.rev(g, dome, terracotta, { p: 'oct' });
      B.edgeRibs(g, dome, 0.025, 0.07, marble);
      B.rev(g, [[8.8, 0.74], [8.95, 0.74]], marble, { p: 'oct' });
      B.rev(g, [[8.95, 0.55], [10.3, 0.55]], marble, { p: 'oct' });
      B.rev(g, [[10.3, 0.5], [11.1, 0.06]], marble, { p: 'oct' });
      B.ball(g, 11.25, 0.15, gold);
    });
    // the façade, banded in white, green and pink marble, with its rose window
    B.group(() => {
      B.sq([-8.4, -8], [0, 4.6], 2.05, marble);
      for (const [y, c] of [[0.6, green], [1.5, pink], [2.4, green], [3.3, pink], [4.2, green]]) B.sq([-8.45, -8.4], [y, y + 0.14], 2.05, c);
      const P = [[-8.45, 5.4, 0, 0], [-8.0, 5.4, 0, 0]];
      for (const x of [-8.45, -8]) for (const z of [-1.05, 1.05]) for (const w of [-1.05, 1.05]) P.push([x, 4.6, z, w]);
      B.hull(P, marble);
      B.disc([-8.44, 3.6, 0, 0], 0, 0.42, 0.05, C.glass);
      B.box([-8.47, -8.4], [0, 1.3], [-0.35, 0.35], [-0.35, 0.35], dark);
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
    return {
      name: 'Florence Cathedral', sub: 'Santa Maria del Fiore, 1296–1436 · Brunelleschi',
      rows: [
        ['Dome', 'Brunelleschi’s octagonal dome, its cross-sections rhombicuboctahedra: every coordinate slice through its axis is an octagon'],
        ['Ribs', 'the eight white ribs run along the octagon’s corners; in 4D they run along all 48 edges of the rhombicuboctahedron'],
        ['Tribunes', 'the trefoil of apses round the octagon becomes five, on +x, ±z and ±w'],
        ['Campanile', prm.grounds ? 'Giotto’s bell tower stands on the +z side of the façade, and on the +w side' : 'hidden (Grounds off)'],
        ['Baptistery', prm.grounds ? 'the octagonal Baptistery in front, with its pyramidal roof and lantern' : 'hidden (Grounds off)'],
      ],
    };
  }

  const CATHEDRALS = {
    'notre-dame': { name: 'Notre-Dame de Paris', build: notreDame },
    'st-peters': { name: 'St Peter’s Basilica', build: stPeters, grounds: true },
    sagrada: { name: 'Sagrada Família', build: sagrada },
    'hagia-sophia': { name: 'Hagia Sophia', build: hagiaSophia },
    'st-basil': { name: 'St Basil’s Cathedral', build: stBasil },
    florence: { name: 'Florence Cathedral', build: florence, grounds: true },
  };

  // ---------- from point sets to convex parts ----------
  // The hull's simplices, merged by hyperplane, give the part's cells.
  function convexPart(pts) {
    const F = O.hull4(pts);
    if (!F) return null;
    const planes = [];
    for (const f of F) if (!planes.some(p => Math.abs(p.h - f.h) < 1e-6 && Math.abs(p.n[0] - f.n[0]) + Math.abs(p.n[1] - f.n[1]) + Math.abs(p.n[2] - f.n[2]) + Math.abs(p.n[3] - f.n[3]) < 1e-6)) planes.push({ n: f.n, h: f.h });
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
  const cache = new Map();
  function build(id, prm) {
    const key = JSON.stringify([id, prm.detail, !!prm.grounds]);
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
    // the tree of groups and parts, depth first; each with a bounding ball
    const parts = [];
    const make = n => {
      if (n.pts) {
        const P = convexPart(n.pts.map(fit));
        if (!P) return null;
        const bc = [0, 1, 2, 3].map(q => (Math.min(...P.V.map(v => v[q])) + Math.max(...P.V.map(v => v[q]))) / 2);
        const br = Math.max(...P.V.map(v => Math.hypot(...sub4(v, bc)))) + 1e-6;
        const part = { ...P, col: n.col, smooth: n.smooth, axis: n.axis ? fit(n.axis) : null, c: bc, r: br };
        parts.push(part);
        return part;
      }
      const kids = n.kids.map(make).filter(Boolean);
      if (!kids.length) return null;
      // a ball round the kids' balls
      const lo2 = [0, 1, 2, 3].map(q => Math.min(...kids.map(k => k.c[q] - k.r))), hi2 = [0, 1, 2, 3].map(q => Math.max(...kids.map(k => k.c[q] + k.r)));
      const gc = lo2.map((x, q) => (x + hi2[q]) / 2), gr = Math.max(...kids.map(k => Math.hypot(...sub4(k.c, gc)) + k.r));
      return { kids, c: gc, r: gr };
    };
    const tree = make(B.top);
    // height in the builder's units (tens of metres)
    const out = { tree, parts, info, spec, height: hi[1] - lo[1] };
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
      const base = part.V.map(v => M.pt(v)), fs = faces(part), byCell = new Map(), edges = new Set();
      nCells += part.planes.length; if (part.smooth) nRound++;
      for (const f of fs) {
        const p = f.poly;
        for (let k = 1; k + 1 < p.length; k++) { M.tri(base[p[0]], base[p[k]], base[p[k + 1]], part.col); smooth.push(part.smooth ? 1 : 0); }
        if (!part.smooth) for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length], key = a < b ? a * 65536 + b : b * 65536 + a; if (!edges.has(key)) { edges.add(key); M.edge(base[a], base[b]); } }
        for (const cl of f.cells) { let l = byCell.get(cl); if (!l) byCell.set(cl, l = []); l.push(p); }
      }
      for (const [cl, polys] of byCell) {
        const vs = [...new Set(polys.flat())], cc = [0, 1, 2, 3].map(q => vs.reduce((s, v) => s + part.V[v][q], 0) / vs.length), ci = M.pt(cc);
        for (const p of polys) for (let k = 1; k + 1 < p.length; k++) M.tet(ci, base[p[0]], base[p[k]], base[p[k + 1]], part.col, ci);
      }
    }
    const I = K.info;
    return M.done({
      triSmooth: Uint8Array.from(smooth),
      info: {
        name: I.name, sub: I.sub,
        counts: [['parts', K.parts.length], ['cells', nCells], ['round', nRound], ['height', Math.round(K.height * 10) + ' m']],
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
    for (let i = 0; i < 1500; i++) { let v; do { v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]; } while (Math.hypot(...v) > 1 || Math.hypot(...v) < 0.1); const l = Math.hypot(...v); dirs.push(v.map(x => x / l)); }
    for (const part of K.parts) for (const u of dirs) { let m = -Infinity; for (const pl of part.planes) m = Math.max(m, dot4(pl.n, u)); gamma = Math.min(gamma, m); }
    gamma *= 0.8;
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
  // [normal], [h, offset back to the part's first texel, 0, 0].
  function gpuTexels(id, prm) {
    const K = build(id, prm), tx = [];
    const lay = n => {
      const at = tx.length;
      if (n.planes) {
        tx.push(n.c, [n.r, n.planes.length, 4 + 2 * n.planes.length, n.smooth && n.axis ? 1 : 0], [...n.col, 0], n.axis || [0, 0, 0, 0]);
        n.planes.forEach(p => { const o = tx.length; tx.push(p.n, [p.h, at - o, 0, 0]); });
      } else {
        tx.push(n.c, [n.r, -1, 0, 0]);
        n.kids.forEach(lay);
        tx[at + 1][2] = tx.length - at;
      }
    };
    lay(K.tree);
    return tx;
  }

  Object.assign(O, { CATHEDRALS, cathedral: mesh, cathedralField: field, cathedralTexels: gpuTexels });
})(typeof window !== 'undefined' ? window : globalThis);
