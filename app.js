(() => {
  const $ = id => document.getElementById(id);
  const P = window.Polychora, O = window.Objects;
  const canvas = $('gl');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) { $('err').hidden = false; $('err').textContent = 'This viewer needs WebGL2, which this browser has turned off or does not support.'; return; }

  // ---------- object catalogue ----------
  const OBJECTS = [];
  for (const s of P.CATALOG) OBJECTS.push({ key: 'poly:' + s.id, label: `${s.name}  ${s.sym}`, group: s.kind === 'convex' ? 'Convex regular polychora' : s.kind === 'star' ? 'Schläfli–Hess star polychora' : 'Other polytopes', kind: 'poly', id: s.id });
  OBJECTS.push({ key: 'clifford', label: 'Clifford torus', group: 'Surfaces & fibrations in S³', kind: 'clifford', s3: true });
  OBJECTS.push({ key: 'blackhole', label: 'Black hole (curved 3D space)', group: 'Curved space', kind: 'bh' });
  OBJECTS.push({ key: 'hopf', label: 'Hopf fibration', group: 'Surfaces & fibrations in S³', kind: 'hopf', s3: true });
  OBJECTS.push({ key: 'chord', label: 'Hopf chord (4D music)', group: 'Surfaces & fibrations in S³', kind: 'chord', s3: true });
  for (const [k, F] of Object.entries(O.FRACTALS)) OBJECTS.push({ key: 'frac:' + k, label: F.name, group: 'Sierpinski fractals', kind: 'frac', id: k });
  OBJECTS.push({ key: 'mountain', label: 'Fractal mountain', group: 'Fractal nature', kind: 'mtn' });
  OBJECTS.push({ key: 'tree', label: 'L-system tree', group: 'Fractal nature', kind: 'tree' });

  const rings = p => p.pattern === 'rings';
  function paramDefs(o) {
    if (o.kind === 'poly') return [{ id: 'shrink', label: 'Cell shrink', min: 0.2, max: 1, step: 0.01, def: 1, fmt: 2 }];
    if (o.kind === 'clifford') return [
      { id: 'eta', label: 'η', min: 3, max: 87, step: 0.5, def: 45, fmt: 1, unit: '°', title: '45° gives the Clifford torus; other values give flatter tori' },
      { id: 'thick', label: 'Thickness', min: 0, max: 15, step: 0.5, def: 0, fmt: 1, unit: '°', title: 'Above 0 the torus becomes a solid shell, so slices are surfaces' },
      { id: 'res', label: 'Resolution', min: 16, max: 128, step: 8, def: 64 },
      { id: 'grid', label: 'Grid lines', min: 0, max: 32, step: 1, def: 12 },
      { id: 'knot', label: 'Torus knot', type: 'check', def: true },
      { id: 'p', label: 'Knot p', min: -7, max: 7, step: 1, def: 3, show: p => p.knot },
      { id: 'q', label: 'Knot q', min: -7, max: 7, step: 1, def: 2, show: p => p.knot },
      { id: 'tube', label: 'Tube radius', min: 0.005, max: 0.08, step: 0.001, def: 0.022, fmt: 3 },
    ];
    if (o.kind === 'hopf') return [
      { id: 'pattern', label: 'Base points', type: 'select', options: [['rings', 'Latitude rings'], ['sphere', 'Spread over S²'], ['circle', 'One great circle']], def: 'rings' },
      { id: 'rings', label: 'Rings', min: 1, max: 8, step: 1, def: 5, show: rings },
      { id: 'perRing', label: 'Per ring', min: 3, max: 48, step: 1, def: 14, show: rings },
      { id: 'lat', label: 'Latitude', min: 5, max: 175, step: 1, def: 90, unit: '°', show: rings },
      { id: 'spread', label: 'Spread', min: 0, max: 170, step: 1, def: 110, unit: '°', show: rings },
      { id: 'count', label: 'Fibres', min: 4, max: 240, step: 1, def: 60, show: p => !rings(p) },
      { id: 'tilt', label: 'Tilt', min: 0, max: 90, step: 1, def: 35, unit: '°', show: p => p.pattern === 'circle' },
      { id: 'phase', label: 'Phase', min: 0, max: 360, step: 1, def: 0, unit: '°' },
      { id: 'flow', label: 'Flow', min: -90, max: 90, step: 1, def: 0, unit: '°/s', title: 'Moves the base points around S², so the fibres sweep through S³' },
      { id: 'segs', label: 'Segments', min: 24, max: 192, step: 8, def: 96 },
      { id: 'tube', label: 'Tube radius', min: 0.004, max: 0.06, step: 0.001, def: 0.018, fmt: 3 },
      { id: 'tori', label: 'Hopf tori', type: 'check', def: false, show: rings },
    ];
    if (o.kind === 'mtn') return [
      { id: 'seed', label: 'Seed', min: 1, max: 200, step: 1, def: 7, title: 'Each seed grows a different range' },
      { id: 'detail', label: 'Detail', min: 2, max: 5, step: 1, def: 4, title: 'Grid halvings: 2ⁿ cells along each side of the ground' },
      { id: 'rough', label: 'Roughness r', min: 0.3, max: 0.8, step: 0.01, def: 0.55, fmt: 2, title: 'How much each halving keeps of the random offsets' },
      { id: 'height', label: 'Height', min: 0.3, max: 1.3, step: 0.01, def: 0.85, fmt: 2 },
      { id: 'sea', label: 'Sea level', min: -0.48, max: 0.4, step: 0.01, def: -0.25, fmt: 2 },
      { id: 'snow', label: 'Snow line', min: 0.3, max: 1, step: 0.01, def: 0.72, fmt: 2, title: 'Share of the way from sea level to the summit' },
    ];
    if (o.kind === 'chord') return [
      { id: 'lat', label: 'Latitude θ', min: 0, max: 180, step: 1, def: 70, unit: '°', title: 'Which fibre: its base point on S². θ sets how far x, y swing (cos θ/2) against z, w (sin θ/2)' },
      { id: 'lon', label: 'Longitude φ', min: 0, max: 360, step: 1, def: 0, unit: '°', title: 'Shifts x, y against z, w along the orbit' },
      { id: 'period', label: 'Orbit', min: 2, max: 60, step: 0.5, def: 12, fmt: 1, unit: ' s', title: 'Seconds for one trip round the fibre' },
      { id: 'root', label: 'Root', min: -36, max: 0, step: 1, def: -24, title: 'Bottom of the lowest voice, in semitones from A4 (−24 is A2, 110 Hz)' },
      { id: 'spread', label: 'Voice gap', min: 0, max: 1.5, step: 0.05, def: 1, fmt: 2, title: 'Octaves between the voices’ ranges (0: all four share one octave)' },
      { id: 'snap', label: 'Notes', type: 'select', options: [['off', 'Glide (any pitch)'], ['chromatic', 'Chromatic'], ['major', 'Major scale'], ['pentatonic', 'Pentatonic'], ['just', 'Just intonation']], def: 'off' },
      { id: 'wave', label: 'Tone', type: 'select', options: [['sine', 'Sine'], ['triangle', 'Triangle'], ['warm', 'Reed'], ['glass', 'Glass']], def: 'warm' },
      { id: 'loud', label: 'Loudness', type: 'select', options: [['equal', 'Equal voices'], ['square', 'Coordinate², summing to 1']], def: 'equal', title: 'With coordinate², a voice fades as its coordinate passes 0, and the total never changes' },
      { id: 'listen', label: 'Listen to', type: 'select', options: [['shape', 'The shape’s coordinates'], ['view', 'The view (spin changes the chord)']], def: 'shape' },
      { id: 'vol', label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.5, fmt: 2 },
      { id: 'glide', label: 'Glide', min: 0.005, max: 0.5, step: 0.005, def: 0.03, fmt: 3, unit: ' s', title: 'How quickly each voice slides to its next pitch' },
      { id: 'torus', label: 'Hopf torus', type: 'check', def: true, title: 'The torus the fibre lies on, with its other fibres' },
      { id: 'fibres', label: 'Fibres', min: 2, max: 32, step: 1, def: 12, show: p => p.torus },
      { id: 'tube', label: 'Tube radius', min: 0.004, max: 0.05, step: 0.001, def: 0.016, fmt: 3 },
    ];
    if (o.kind === 'bh') return [
      { id: 'rs', label: 'Horizon rₛ', min: 0.08, max: 0.6, step: 0.01, def: 0.28, fmt: 2, title: 'Schwarzschild radius 2GM/c²' },
      { id: 'reach', label: 'Reach', min: 0.7, max: 1.3, step: 0.01, def: 1, fmt: 2, title: 'How far out the space is drawn' },
      { id: 'kerr', label: 'Rotating', type: 'check', def: false, title: 'A Kerr black hole: spinning, with an ergosphere' },
      { id: 'spin', label: 'Spin a/M', min: 0.05, max: 0.99, step: 0.01, def: 0.9, fmt: 2, show: p => p.kerr, title: 'Angular momentum per unit mass, as a share of the mass (1 would be extremal)' },
      { id: 'both', label: 'Wormhole', type: 'check', def: false, title: 'Both sheets: the Einstein–Rosen bridge through the horizon' },
      { id: 'detail', label: 'Detail', min: 1, max: 3, step: 1, def: 2 },
      { id: 'funnel', label: 'Funnel', type: 'check', def: true, title: 'The classic embedding diagram: the equatorial plane y = 0' },
      { id: 'rays', label: 'Light rays', min: 0, max: 31, step: 1, def: 15, title: 'Per plane, in a beam along +x' },
      { id: 'planes', label: 'Ray planes', min: 1, max: 6, step: 1, def: 1, show: p => !p.kerr, title: 'Planes through the beam’s axis, turned about it (a spinning hole keeps its rays on the equator)' },
      { id: 'beam', label: 'Beam width', min: 0.2, max: 3, step: 0.01, def: 1.6, fmt: 2, title: 'Widest impact parameter, in units of the capture limit (3√3/2) rₛ' },
      { id: 'tube', label: 'Ray radius', min: 0.003, max: 0.03, step: 0.001, def: 0.008, fmt: 3 },
    ];
    if (o.kind === 'tree') {
      const P0 = O.LSYS_PRESETS.tetra, edited = { custom: true };
      return [
        { id: 'preset', label: 'Preset', type: 'select', options: [...Object.entries(O.LSYS_PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Your own']], def: 'tetra',
          apply: (prm, v) => { const q = O.LSYS_PRESETS[v]; if (q) { for (const k of ['axiom', 'rules', 'iter', 'angle', 'lenRatio', 'widthRatio', 'thick', 'leaves', 'leafSize']) prm[k] = q[k]; } } },
        { id: 'axiom', label: 'Axiom', type: 'text', def: P0.axiom, edits: edited },
        { id: 'rules', label: 'Rules', type: 'textarea', def: P0.rules, edits: edited, title: 'One rule per line, as X = …. Several rules for one symbol: each rewrite picks one at random' },
        { id: 'help', type: 'help', html: `<b>F</b> branch · <b>f</b> move · <b>[ ]</b> fork · <b>L</b> leaf<br><b>+ −</b> turn · <b>&amp; ^</b> pitch · <b>&lt; &gt;</b> turn into w<br><b>\\ /</b> roll · <b>{ }</b> roll toward w · <b>|</b> about-face<br><b>!</b> thinner · <b>"</b> shorter · <b>+(30)</b> its own angle` },
        { id: 'iter', label: 'Iterations', min: 0, max: 8, step: 1, def: P0.iter },
        { id: 'angle', label: 'Angle', min: 0, max: 120, step: 0.5, def: P0.angle, fmt: 1, unit: '°' },
        { id: 'lenRatio', label: 'Length " ×', min: 0.3, max: 1, step: 0.01, def: P0.lenRatio, fmt: 2, title: 'How much each " shortens the step' },
        { id: 'widthRatio', label: 'Width ! ×', min: 0.3, max: 1, step: 0.01, def: P0.widthRatio, fmt: 2, title: 'How much each ! thins the branches' },
        { id: 'thick', label: 'Thickness', min: 0.01, max: 0.6, step: 0.005, def: P0.thick, fmt: 3, title: 'Branch radius at the start, in steps' },
        { id: 'seed', label: 'Seed', min: 1, max: 200, step: 1, def: 3, show: prm => /^(\S)\s*(=|->|→)[^]*\n\s*\1\s*(=|->|→)/m.test(prm.rules), title: 'For rules that choose at random' },
        { id: 'leaves', label: 'Tip leaves', type: 'check', def: P0.leaves, title: 'A 16-cell on every branch with nothing drawn after it (L puts one anywhere)' },
        { id: 'leafSize', label: 'Leaf size', min: 0.02, max: 2, step: 0.01, def: P0.leafSize, fmt: 2, title: 'In steps' },
      ];
    }
    const F = O.FRACTALS[o.id];
    const defs = [{ id: 'depth', label: 'Depth', min: 0, max: F.maxDepth, step: 1, def: F.depth }];
    if (F.ratio) defs.push({ id: 'ratio', label: 'Ratio r', min: 0.25, max: 0.62, step: 0.005, def: F.ratioDefault ?? 0.5, fmt: 3 });
    return defs;
  }
  // ---------- scene: several shapes, each with its own type, parameters, placement and colour ----------
  const TINT_NAMES = [['own', 'Own colours'], ['amber', 'Amber'], ['teal', 'Teal'], ['rose', 'Rose'], ['violet', 'Violet'], ['lime', 'Lime'], ['sky', 'Sky'], ['white', 'White']];
  const OPS = [['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']];
  const objOf = key => OBJECTS.find(o => o.key === key);
  let shapeSeq = 0;
  const newPlace = () => ({ off: [0, 0, 0, 0], scale: 1, rot: [0, 0, 0, 0, 0, 0] });
  const newShape = (key, extra = {}) => ({ id: ++shapeSeq, key, prm: {}, op: 'add', visible: true, tint: 'own', place: newPlace(), spin: [0, 0, 0, 0, 0, 0], ...extra });
  const scene = { shapes: [newShape('poly:grand-600')], sel: 0 };
  const selShape = () => scene.shapes[scene.sel];
  const shapePrm = (sh, o = objOf(sh.key)) => sh.prm[o.key] ??= Object.fromEntries(paramDefs(o).map(d => [d.id, d.def]));
  const params = o => shapePrm(selShape(), o);
  const shortName = o => (o.kind === 'poly' ? P.CATALOG.find(c => c.id === o.id).name : o.label);

  // ---------- UI state ----------
  const PLANES = [['XY', 0, 1], ['XZ', 0, 2], ['YZ', 1, 2], ['XW', 0, 3], ['YW', 1, 3], ['ZW', 2, 3]];
  const state = {
    key: 'poly:grand-600', mode: 'slice', surf: 'solid', col: 'depth', p4: 'persp', p3: 'persp',
    edges: true, ghost: false, opacity: 0.18, eye4: 2.6, slice: 0, sweep: true, sweepSp: 0.25,
    spin: [0, 0, 0.12, 0.3, 0, 0.18], playing: true, pivot: [0, 0, 0, 0], marker: true, renderer: 'mesh', gpuQ: 'medium',
    yaw: 0.5, pitch: -0.35, dist: 3.7,
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) state.playing = false;
  const cur = () => OBJECTS.find(o => o.key === state.key);

  const sel = $('obj');
  for (const g of [...new Set(OBJECTS.map(o => o.group))]) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const o of OBJECTS.filter(o => o.group === g)) { const op = document.createElement('option'); op.value = o.key; op.textContent = o.label; og.appendChild(op); }
    sel.appendChild(og);
  }

  PLANES.forEach(([nm], i) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<label for="sp${i}">${nm}</label><input type="range" id="sp${i}" min="-1.2" max="1.2" step="0.01"><output id="sp${i}O"></output>`;
    $('spins').appendChild(r);
    r.querySelector('input').addEventListener('input', e => { state.spin[i] = +e.target.value; syncUI(); });
  });

  ['X', 'Y', 'Z', 'W'].forEach((nm, i) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<label for="pv${i}">${nm}</label><input type="range" id="pv${i}" min="-1.5" max="1.5" step="0.01"><output id="pv${i}O"></output>`;
    $('pivots').appendChild(r);
    r.querySelector('input').addEventListener('input', e => { state.pivot[i] = +e.target.value; syncUI(); });
  });

  const fmtVal = (d, v) => (d.fmt ? (+v).toFixed(d.fmt) : String(v)) + (d.unit || '');
  function buildParamUI() {
    const o = cur(), prm = params(o), box = $('params'), defs = paramDefs(o);
    box.innerHTML = '';
    for (const d of defs) {
      const r = document.createElement('div'), id = 'prm-' + d.id;
      r.className = 'row' + (d.type === 'check' ? ' check' : d.type === 'text' || d.type === 'textarea' || d.type === 'help' ? ' wide' : ''); r.dataset.id = d.id; if (d.title) r.title = d.title;
      if (d.type === 'help') { r.innerHTML = `<p class="help">${d.html}</p>`; box.appendChild(r); continue; }
      if (d.type === 'text') r.innerHTML = `<label for="${id}">${d.label}</label><input type="text" id="${id}" spellcheck="false" autocomplete="off">`;
      else if (d.type === 'textarea') r.innerHTML = `<label for="${id}">${d.label}</label><textarea id="${id}" rows="3" spellcheck="false"></textarea>`;
      else if (d.type === 'select') r.innerHTML = `<label for="${id}">${d.label}</label><select id="${id}">${d.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
      else if (d.type === 'check') r.innerHTML = `<label for="${id}">${d.label}</label><input type="checkbox" id="${id}">`;
      else r.innerHTML = `<label for="${id}">${d.label}</label><input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}"><output></output>`;
      box.appendChild(r);
      const inp = r.querySelector('input,select,textarea');
      if (d.type === 'check') inp.checked = prm[d.id]; else inp.value = prm[d.id];
      const out = r.querySelector('output'); if (out) out.value = fmtVal(d, prm[d.id]);
      if (d.type === 'text' || d.type === 'textarea') {
        // rebuild a moment after typing stops; editing a preset's text makes it your own
        let timer = 0;
        inp.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            prm[d.id] = inp.value;
            if (d.edits && prm.preset !== 'custom') { prm.preset = 'custom'; const ps = $('params').querySelector('[data-id="preset"] select'); if (ps) ps.value = 'custom'; }
            refreshParamVisibility(); dirty = true;
          }, 350);
        });
        continue;
      }
      if (d.apply) { inp.addEventListener('change', () => { prm[d.id] = inp.value; d.apply(prm, inp.value); buildParamUI(); dirty = true; }); continue; }
      inp.addEventListener(d.type === 'range' || !d.type ? 'input' : 'change', () => {
        prm[d.id] = d.type === 'check' ? inp.checked : d.type === 'select' ? inp.value : +inp.value;
        if (out) out.value = fmtVal(d, prm[d.id]);
        refreshParamVisibility(); dirty = true;
      });
    }
    refreshParamVisibility();
    buildPlaceUI();
  }
  // where the selected shape sits in 4D, and its colour
  let placeOpen = false;
  function buildPlaceUI() {
    const sh = selShape(), pl = sh.place, box = document.createElement('details');
    box.className = 'place'; box.open = placeOpen || scene.shapes.length > 1;
    box.addEventListener('toggle', () => { placeOpen = box.open; });
    box.innerHTML = '<summary>Placement and colour</summary>';
    const defs = [
      ...['X', 'Y', 'Z', 'W'].map((nm, k) => ({ id: 'off' + k, label: 'Move ' + nm, min: -1.5, max: 1.5, step: 0.01, fmt: 2, get: () => pl.off[k], set: v => { pl.off[k] = v; } })),
      { id: 'scale', label: 'Scale', min: 0.2, max: 2.5, step: 0.01, fmt: 2, get: () => pl.scale, set: v => { pl.scale = v; } },
      ...PLANES.map(([nm], k) => ({ id: 'rot' + k, label: 'Turn ' + nm, min: -180, max: 180, step: 1, unit: '°', get: () => pl.rot[k], set: v => { pl.rot[k] = v; } })),
      // this shape's own spin, so it can turn through the others
      ...PLANES.map(([nm], k) => ({ id: 'spin' + k, label: 'Spin ' + nm, min: -90, max: 90, step: 1, unit: '°/s', get: () => sh.spin[k], set: v => { sh.spin[k] = v; } })),
    ];
    for (const d of defs) {
      const r = document.createElement('div'), id = 'pl-' + d.id;
      r.className = 'row';
      r.innerHTML = `<label for="${id}">${d.label}</label><input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}"><output></output>`;
      const inp = r.querySelector('input'), out = r.querySelector('output');
      inp.value = d.get(); out.value = fmtVal(d, d.get());
      inp.addEventListener('input', () => { d.set(+inp.value); out.value = fmtVal(d, d.get()); dirty = true; });
      box.appendChild(r);
    }
    const tr = document.createElement('div');
    tr.className = 'row';
    tr.innerHTML = `<label for="pl-tint">Colour</label><select id="pl-tint">${TINT_NAMES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
    const ts = tr.querySelector('select'); ts.value = sh.tint;
    ts.addEventListener('change', () => { sh.tint = ts.value; dirty = true; buildShapeList(); });
    box.appendChild(tr);
    const br = document.createElement('div'); br.className = 'btns';
    br.innerHTML = '<button type="button">Reset placement</button>';
    br.querySelector('button').onclick = () => { sh.place = newPlace(); sh.spin = [0, 0, 0, 0, 0, 0]; dirty = true; buildParamUI(); };
    box.appendChild(br);
    $('params').appendChild(box);
  }

  // ---------- shape list ----------
  const rgbCss = c => `rgb(${c.map(x => Math.round(Math.min(1, x) * 255)).join(',')})`;
  const OWN_SWATCH = 'conic-gradient(#f2b84b, #1fb5b0, #3d4ed6, #ee5d4a, #f2b84b)';
  function buildShapeList() {
    const box = $('shapeList'); box.innerHTML = '';
    scene.shapes.forEach((sh, i) => {
      const o = objOf(sh.key), r = document.createElement('div');
      r.className = 'shape' + (i === scene.sel ? ' sel' : '') + (sh.visible ? '' : ' off');
      const sw = sh.tint === 'own' ? OWN_SWATCH : rgbCss(window.CSG.TINTS[sh.tint]);
      r.innerHTML = `<button type="button" class="nm" title="Edit this shape"><span class="sw" style="background:${sw}"></span><span></span></button>` +
        (i ? `<select class="op" aria-label="How this shape combines with the ones above">${OPS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>` : '<span class="op base" title="The first shape is the starting point">Base</span>') +
        `<button type="button" class="ic up" title="Move up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>` +
        `<input type="checkbox" class="vis" title="Show this shape" aria-label="Show this shape"${sh.visible ? ' checked' : ''}>` +
        `<button type="button" class="ic rm" title="Remove" aria-label="Remove shape"${scene.shapes.length > 1 ? '' : ' disabled'}>×</button>`;
      r.querySelector('.nm span:last-child').textContent = shortName(o);
      r.querySelector('.nm').onclick = () => selectShape(i);
      const op = r.querySelector('select.op');
      if (op) { op.value = sh.op; op.addEventListener('change', () => { sh.op = op.value; dirty = true; }); }
      r.querySelector('.vis').addEventListener('change', e => { sh.visible = e.target.checked; r.classList.toggle('off', !sh.visible); dirty = true; });
      r.querySelector('.up').onclick = () => { if (!i) return; [scene.shapes[i - 1], scene.shapes[i]] = [scene.shapes[i], scene.shapes[i - 1]]; selectShape(i - 1); dirty = true; };
      r.querySelector('.rm').onclick = () => { if (scene.shapes.length < 2) return; scene.shapes.splice(i, 1); selectShape(Math.min(scene.sel >= i ? Math.max(0, scene.sel - 1) : scene.sel, scene.shapes.length - 1)); dirty = true; };
      box.appendChild(r);
    });
    $('shapesHint').hidden = scene.shapes.length < 2;
  }
  function selectShape(i) {
    scene.sel = i; state.key = selShape().key;
    buildParamUI(); buildShapeList(); showInfo(); syncUI();
  }
  const nextTint = () => TINT_NAMES[1 + (scene.shapes.length - 1) % (TINT_NAMES.length - 1)][0];
  $('addShape').onclick = () => {
    // a tesseract cutting into the current shape is the quickest way to see what subtraction does
    const solid = scene.shapes.some(sh => ['poly', 'frac', 'mtn', 'tree'].includes(objOf(sh.key).kind));
    scene.shapes.push(newShape('poly:tesseract', { op: solid ? 'subtract' : 'add', tint: nextTint(), place: newPlace() }));
    selectShape(scene.shapes.length - 1); dirty = true;
  };
  $('dupShape').onclick = () => {
    const s0 = selShape(), sh = newShape(s0.key, { prm: structuredClone(s0.prm), tint: nextTint(), place: structuredClone(s0.place), spin: [...s0.spin] });
    scene.shapes.splice(scene.sel + 1, 0, sh); selectShape(scene.sel + 1); dirty = true;
  };
  function refreshParamVisibility() {
    const o = cur(), prm = params(o);
    for (const d of paramDefs(o)) { const r = $('params').querySelector(`[data-id="${d.id}"]`); if (r) r.hidden = d.show ? !d.show(prm) : false; }
  }

  function syncUI() {
    sel.value = state.key;
    for (const n of ['mode', 'surf', 'col', 'p4', 'p3']) document.querySelector(`input[name=${n}][value=${state[n]}]`).checked = true;
    $('edges').checked = state.edges; $('ghost').checked = state.ghost; $('sweep').checked = state.sweep;
    $('opacity').value = state.opacity; $('opacityO').value = state.opacity.toFixed(2);
    $('eye4').value = state.eye4; $('eye4O').value = state.eye4.toFixed(2);
    $('slice').value = state.slice; $('sliceO').value = state.slice.toFixed(3);
    $('sweepSp').value = state.sweepSp; $('sweepSpO').value = state.sweepSp.toFixed(2);
    PLANES.forEach((_, i) => { $('sp' + i).value = state.spin[i]; $('sp' + i + 'O').value = state.spin[i].toFixed(2); });
    state.pivot.forEach((v, i) => { $('pv' + i).value = v; $('pv' + i + 'O').value = v.toFixed(2); });
    const gpu = state.renderer === 'gpu';
    // the ray tracer draws the slice
    if (gpu) state.mode = 'slice';
    $('m-proj').disabled = gpu; $('gpuRow').hidden = !gpu; $('gpuHint').hidden = !gpu;
    $('gpuQ').value = state.gpuQ;
    document.querySelector(`input[name=rend][value=${state.renderer}]`).checked = true;
    document.querySelector('input[name=mode][value=' + state.mode + ']').checked = true;
    const slice = state.mode === 'slice';
    $('sliceSec').hidden = !slice; $('projSec').hidden = slice; $('ghostL').hidden = !slice;
    $('eyeRow').hidden = state.p4 !== 'persp'; $('stereoHint').hidden = state.p4 !== 'stereo';
    $('opRow').hidden = state.surf !== 'trans';
    $('legend').hidden = state.col !== 'depth';
    $('wread').hidden = !slice;
    $('play').textContent = state.playing ? 'Pause' : 'Play';
  }

  for (const n of ['mode', 'surf', 'col', 'p4', 'p3'])
    document.querySelectorAll(`input[name=${n}]`).forEach(r => r.addEventListener('change', () => { state[n] = r.value; syncUI(); }));
  let gpuR = null, gpuFailed = false;
  document.querySelectorAll('input[name=rend]').forEach(r => r.addEventListener('change', () => {
    if (r.value === 'gpu' && !gpuR && !gpuFailed) {
      try { gpuR = window.GPU.create(gl); } catch (err) { gpuFailed = true; console.error(err); }
    }
    if (r.value === 'gpu' && !gpuR) { note('The GPU ray tracer could not start in this browser'); state.renderer = 'mesh'; }
    else state.renderer = r.value;
    dirty = true; syncUI();
  }));
  $('gpuQ').addEventListener('change', e => { state.gpuQ = e.target.value; });
  $('edges').addEventListener('change', e => { state.edges = e.target.checked; });
  $('ghost').addEventListener('change', e => { state.ghost = e.target.checked; });
  $('sweep').addEventListener('change', e => { state.sweep = e.target.checked; if (state.sweep) sweepPhase = Math.asin(Math.max(-1, Math.min(1, state.slice / 0.999))); });
  for (const k of ['opacity', 'eye4', 'sweepSp']) $(k).addEventListener('input', e => { state[k] = +e.target.value; syncUI(); });
  $('slice').addEventListener('input', e => { state.slice = +e.target.value; state.sweep = false; syncUI(); });
  sel.addEventListener('change', () => select(sel.value));
  const step = d => { const i = OBJECTS.findIndex(o => o.key === state.key); select(OBJECTS[(i + d + OBJECTS.length) % OBJECTS.length].key); };
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1);
  $('play').onclick = () => { state.playing = !state.playing; syncUI(); };
  $('stopSpin').onclick = () => { state.spin = [0, 0, 0, 0, 0, 0]; syncUI(); };
  $('reset').onclick = () => { R = initialPose(); T = [0, 0, 0, 0]; };
  const setPivot = c => { state.pivot = c.map(x => Math.round(x * 100) / 100); syncUI(); };
  $('pivotCentre').onclick = () => setPivot([0, 0, 0, 0]);
  $('pivotVertex').onclick = () => {
    // a random outermost point of the object: a vertex for the polytopes and fractals
    if (!G || !G.npts) return;
    const { pts, npts } = G; let m = 0;
    for (let i = 0; i < npts; i++) m = Math.max(m, Math.hypot(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]));
    const far = []; for (let i = 0; i < npts; i++) if (Math.hypot(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]) > m * 0.995) far.push(i);
    const i = far[Math.floor(Math.random() * far.length)];
    setPivot([0, 1, 2, 3].map(k => pts[i * 4 + k]));
  };
  $('pivotRandom').onclick = () => setPivot([0, 1, 2, 3].map(() => (Math.random() * 2 - 1) * 1.1));
  $('marker').addEventListener('change', e => { state.marker = e.target.checked; });
  $('recentre').onclick = () => { T = [0, 0, 0, 0]; setPivot([0, 0, 0, 0]); };
  const preset = s => () => { state.spin = s; state.playing = true; syncUI(); };
  $('presetSimple').onclick = preset([0, 0, 0, 0.4, 0, 0]);
  $('presetDouble').onclick = preset([0, 0, 0.12, 0.3, 0, 0.18]);
  $('presetIso').onclick = preset([0.35, 0, 0, 0, 0, 0.35]);
  addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio'].includes(t.type))) return;
    if (e.key === ' ') { e.preventDefault(); state.playing = !state.playing; syncUI(); }
    else if (e.key === '[') step(-1);
    else if (e.key === ']') step(1);
    else if ((e.key === 's' || e.key === 'S') && state.renderer !== 'gpu') { state.mode = state.mode === 'slice' ? 'proj' : 'slice'; syncUI(); }
    else if (e.key === 'p' || e.key === 'P') snapshot();
    else if (e.key === 'r' || e.key === 'R') toggleRecording();
  });

  // ---------- capture ----------
  // Files go through the viewer's downloads capability when framed on claude.ai, else a plain link download.
  const downloadsCap = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
  const baseName = () => 'polychora-' + state.key.replace(/^(poly|frac):/, '');
  let noteTimer = 0;
  function note(msg) { const n = $('capNote'); n.textContent = msg; n.hidden = !msg; clearTimeout(noteTimer); if (msg) noteTimer = setTimeout(() => { n.hidden = true; }, 4000); }
  async function saveFile(blob, filename) {
    const dl = await downloadsCap;
    if (dl) {
      try { await dl.save({ filename, data: blob }); note('Saved ' + filename); }
      catch (err) { note(err?.code === 'declined' ? '' : 'Could not save: ' + (err?.message || err?.code || err)); }
      return;
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    note('Saved ' + filename);
  }
  // Snapshots are taken inside the next frame, right after drawing, at an optional supersampled size.
  let shotScale = 0;
  function snapshot() { if (!shotScale) shotScale = +$('shotSize').value || 1; }
  function finishSnapshot() {
    const name = `${baseName()}-${stamp()}.png`;
    canvas.toBlob(b => { if (b) saveFile(b, name); else note('Snapshot failed'); }, 'image/png');
  }
  // Video is MP4 wherever WebCodecs can encode H.264: each frame is encoded as it is drawn and packed with
  // mp4-muxer (vendor/, loaded on first use). Otherwise the browser's own recorder, in MP4 if it can, else WebM.
  const MR_TYPES = [['video/mp4;codecs=avc1.640028', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm']];
  const mrType = typeof MediaRecorder !== 'undefined' && canvas.captureStream ? MR_TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) : null;
  const canEncode = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  let muxerLib = null;
  const loadMuxer = () => muxerLib ||= new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = 'vendor/mp4-muxer.js';
    s.onload = () => ok(window.Mp4Muxer); s.onerror = () => { muxerLib = null; fail(new Error('could not load the MP4 muxer')); };
    document.head.appendChild(s);
  });
  // H.264 profiles from High 5.2 down, so large canvases still find a level that fits
  const AVC = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f'];
  async function avcConfig(width, height, bitrate) {
    for (const codec of AVC) {
      const c = { codec, width, height, bitrate, framerate: 60, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch { /* try the next */ }
    }
    return null;
  }
  async function startEncoder(bitrate) {
    const M = await loadMuxer();
    // even dimensions for H.264, and no more than a 4K frame's pixels
    const k = Math.min(1, Math.sqrt(3840 * 2160 / (canvas.width * canvas.height)), 4096 / Math.max(canvas.width, canvas.height));
    const w = Math.max(2, Math.floor(canvas.width * k / 2) * 2), h = Math.max(2, Math.floor(canvas.height * k / 2) * 2);
    const cfg = await avcConfig(w, h, bitrate);
    if (!cfg) return null;
    const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: 60 }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let failed = null, forceKey = false;
    const out = Mp4Write.writer(muxer, cfg, w, h);
    const newEncoder = () => { const e = new VideoEncoder({ output: (chunk, meta) => { try { out.output(chunk, meta); } catch (x) { failed = x; } }, error: x => { failed = x; } }); e.configure(cfg); return e; };
    let enc = newEncoder();
    // frames are copied to a fixed-size canvas, so resizing the window mid-recording only rescales them
    const copy = document.createElement('canvas'); copy.width = w; copy.height = h;
    const cx = copy.getContext('2d');
    let t0 = -1, lastKey = -1e9;
    return {
      ext: 'mp4',
      frame(now) {
        if (failed || enc.encodeQueueSize > 8) return; // drop a frame rather than fall behind
        if (out.needsAnnexB && cfg.avc.format !== 'annexb') {
          // the encoder sent no stream settings: a new one with start-code framing puts them in every keyframe
          // (Firefox ignores a change of framing on an encoder that is already running)
          cfg.avc.format = 'annexb'; out.needsAnnexB = false; enc.close(); enc = newEncoder(); forceKey = true;
        }
        if (t0 < 0) t0 = now;
        cx.drawImage(canvas, 0, 0, w, h);
        const vf = new VideoFrame(copy, { timestamp: Math.round((now - t0) * 1000) });
        const keyFrame = forceKey || now - lastKey >= 2000;
        if (keyFrame) { lastKey = now; forceKey = false; }
        enc.encode(vf, { keyFrame }); vf.close();
      },
      async stop() {
        if (!failed) await enc.flush().catch(e => { failed = e; });
        if (enc.state !== 'closed') enc.close();
        if (failed) throw failed;
        if (!out.chunks) throw new Error('the video encoder produced no usable frames');
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: 'video/mp4' });
      },
    };
  }
  function startMediaRecorder(bitrate) {
    const [type, ext] = mrType, chunks = [], stream = canvas.captureStream(60);
    const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.start(1000);
    return {
      ext,
      stop: () => new Promise(done => {
        mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); done(chunks.length ? new Blob(chunks, { type: type.split(';')[0] }) : null); };
        mr.stop();
      }),
    };
  }
  let rec = null, recStart = 0, recBusy = false;
  async function toggleRecording() {
    if (recBusy) return;
    recBusy = true;
    try {
      if (rec) {
        const r = rec; rec = null; syncCapture(); note('Finishing the video…');
        try { const blob = await r.stop(); if (blob) await saveFile(blob, r.name); else note(''); }
        catch (err) { note('Recording failed: ' + (err?.message || err)); }
        return;
      }
      const bitrate = +$('vidRate').value * 1e6;
      let r = null;
      if (canEncode) try { r = await startEncoder(bitrate); } catch (err) { console.warn('MP4 encoder unavailable, using MediaRecorder', err); }
      if (!r && mrType) r = startMediaRecorder(bitrate);
      if (!r) { note('This browser cannot record the canvas'); return; }
      r.name = `${baseName()}-${stamp()}.${r.ext}`;
      rec = r; recStart = performance.now(); syncCapture();
    } finally { recBusy = false; }
  }
  function syncCapture() {
    $('record').textContent = rec ? 'Stop recording' : 'Record video';
    $('record').classList.toggle('on', !!rec);
    $('recBadge').hidden = !rec;
  }
  $('snap').onclick = snapshot;
  $('record').onclick = toggleRecording;
  (async () => {
    const fmt = canEncode && await avcConfig(1280, 720, 8e6) ? 'mp4' : mrType?.[1];
    if (fmt) $('vidFmt').textContent = fmt.toUpperCase();
    else { $('record').disabled = true; $('record').title = 'This browser cannot record the canvas'; }
  })();

  // ---------- 4D pose ----------
  // Spins act in the object's own frame (R <- R·G), so an equal XY + ZW spin always slides along Hopf fibres.
  // Hand dragging acts in the view frame (R <- G·R), so it matches what you see.
  const ident4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function rotWorld(M, i, j, a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < 4; k++) { const x = M[i * 4 + k], y = M[j * 4 + k]; M[i * 4 + k] = c * x - s * y; M[j * 4 + k] = s * x + c * y; }
  }
  function rotBody(M, i, j, a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let r = 0; r < 4; r++) { const x = M[r * 4 + i], y = M[r * 4 + j]; M[r * 4 + i] = c * x + s * y; M[r * 4 + j] = -s * x + c * y; }
  }
  function orthonormalize(M) {
    for (let r = 0; r < 4; r++) {
      for (let q = 0; q < r; q++) {
        let d = 0; for (let k = 0; k < 4; k++) d += M[r * 4 + k] * M[q * 4 + k];
        for (let k = 0; k < 4; k++) M[r * 4 + k] -= d * M[q * 4 + k];
      }
      let l = 0; for (let k = 0; k < 4; k++) l += M[r * 4 + k] ** 2; l = Math.sqrt(l);
      for (let k = 0; k < 4; k++) M[r * 4 + k] /= l;
    }
  }
  function initialPose() {
    const M = ident4();
    if (cur().s3) { rotWorld(M, 1, 2, 0.5); return M; } // keep the torus axes readable in stereographic view
    if (cur().kind === 'mtn' || cur().kind === 'tree') { rotWorld(M, 0, 2, 0.5); return M; }
    // the black hole's depth w points up the screen, and slices go across y, so y = 0 is the textbook funnel
    if (cur().kind === 'bh') { rotWorld(M, 1, 3, -Math.PI / 2); rotWorld(M, 0, 2, 0.4); return M; } // up stays up, and slices start straight across w
    rotWorld(M, 0, 3, 0.31); rotWorld(M, 1, 2, 0.23); rotWorld(M, 2, 3, 0.17); rotWorld(M, 0, 1, 0.11); return M;
  }
  let R = ident4(), T = [0, 0, 0, 0];
  // The pose is affine: q = R·x + T. Every rotation turns about the pivot (given in object coordinates),
  // so the pivot's world position R·c + T stays put and the rest of the object swings around it.
  const pivotWorld = () => { const c = state.pivot; return [0, 1, 2, 3].map(r => R[r * 4] * c[0] + R[r * 4 + 1] * c[1] + R[r * 4 + 2] * c[2] + R[r * 4 + 3] * c[3] + T[r]); };
  function aboutPivot(fn) {
    const pw = pivotWorld(); fn(); const c = state.pivot;
    for (let r = 0; r < 4; r++) T[r] = pw[r] - (R[r * 4] * c[0] + R[r * 4 + 1] * c[1] + R[r * 4 + 2] * c[2] + R[r * 4 + 3] * c[3]);
  }

  // ---------- colours ----------
  const DEPTH_STOPS = [[0x3d, 0x4e, 0xd6], [0x1f, 0xb5, 0xb0], [0xf2, 0xc1, 0x4e], [0xee, 0x5d, 0x4a]].map(c => c.map(x => x / 255));
  function depthColor(w, out, o) {
    const t = Math.max(0, Math.min(1, (w + 1) / 2)) * (DEPTH_STOPS.length - 1);
    const k = Math.min(DEPTH_STOPS.length - 2, Math.floor(t)), f = t - k, a = DEPTH_STOPS[k], b = DEPTH_STOPS[k + 1];
    out[o] = a[0] + (b[0] - a[0]) * f; out[o + 1] = a[1] + (b[1] - a[1]) * f; out[o + 2] = a[2] + (b[2] - a[2]) * f;
  }
  const hex = s => { s = s.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255); };
  let theme = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    theme = { canvas: hex(cs.getPropertyValue('--canvas')), fg: hex(cs.getPropertyValue('--fg')), accent: hex(cs.getPropertyValue('--accent')) };
    theme.dark = theme.canvas[0] + theme.canvas[1] + theme.canvas[2] < 1.5;
  }
  readTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- object loading ----------
  let G = null, dirty = true, hopfTime = 0, lastInfo = '', lastInfos = [];
  function select(key) {
    const was = objOf(selShape().key);
    state.key = key; selShape().key = key;
    const o = cur();
    // a single shape sets up the view to suit it; with several, the view is left alone
    if (scene.shapes.length === 1 && (!was || was.s3 !== o.s3 || was.kind !== o.kind || !G)) {
      if (o.s3) { state.p4 = 'stereo'; state.dist = 7.5; }
      else { if (state.p4 === 'stereo') state.p4 = 'persp'; state.dist = 3.7; }
      if (o.kind === 'hopf' || o.kind === 'chord') state.col = 'flat'; // fibres coloured by their point on S²
      if (o.kind === 'chord' && state.renderer !== 'gpu') state.mode = 'proj';
      // the mountain keeps its own colours and keeps y up: it turns about the vertical and through w
      // a slice of the tree only meets the branches that cross it, so it opens in projection to show the whole tree
      if (o.kind === 'bh') { state.col = 'flat'; state.spin = [0, 0.12, 0, 0, 0, 0]; state.dist = 3.6; state.pitch = 0.45; }
      else if (o.kind === 'tree') { state.col = 'flat'; if (state.renderer !== 'gpu') state.mode = 'proj'; state.spin = [0, 0.15, 0, 0, 0, 0]; state.dist = 3.9; state.pitch = 0.25; }
      else if (o.kind === 'mtn') { state.col = 'flat'; state.mode = 'slice'; state.spin = [0, 0.15, 0, 0, 0, 0]; state.dist = 4.3; state.pitch = 0.5; }
      else if (was && (was.kind === 'mtn' || was.kind === 'tree' || was.kind === 'bh')) { state.col = 'depth'; state.spin = [0, 0, 0.12, 0.3, 0, 0.18]; state.pitch = -0.35; }
      R = initialPose(); T = [0, 0, 0, 0];
    }
    buildParamUI(); buildShapeList(); showInfo(); dirty = true; syncUI();
  }
  const descs = () => scene.shapes.map(sh => { const o = objOf(sh.key); return { id: sh.id, key: sh.key, kind: o.kind, oid: o.id, prm: shapePrm(sh, o), place: sh.place, op: sh.op, tint: sh.tint, visible: sh.visible }; });
  // Shapes are built and combined in a worker when the browser allows it, else right here.
  // A heavy combination arrives as a coarse draft and then the full result; while it refines, a change to the
  // scene restarts the worker rather than waiting.
  // the worker's scripts carry a stamp from this page load, so an update never pairs a new page with old cached scripts
  let worker = null, inFlight = 0, refining = 0, jobSeq = 0, buildStart = 0;
  const workerStamp = Date.now().toString(36);
  function startWorker() {
    try {
      worker = new Worker('worker.js?v=' + workerStamp);
      worker.onmessage = e => {
        const r = e.data;
        if (r.job !== inFlight && r.job !== refining) return;
        if (r.error) { console.error(r.error); worker = null; inFlight = refining = 0; dirty = true; return; }
        applyBuild(r);
        if (r.final) inFlight = refining = 0; else { refining = r.job; inFlight = 0; }
      };
      worker.onerror = e => { e.preventDefault(); worker = null; inFlight = refining = 0; dirty = true; };
    } catch { worker = null; }
  }
  startWorker();
  function rebuild() {
    const d = descs();
    if (refining && worker) { worker.terminate(); refining = 0; startWorker(); }
    if (worker) { inFlight = ++jobSeq; buildStart = performance.now(); worker.postMessage({ job: inFlight, descs: d, hopfTime }); }
    else {
      // no worker: full precision if it is quick, else the coarse draft only
      let r;
      try { r = window.Scene.build(d, hopfTime, { deadline: Date.now() + 1200 }); }
      catch (err) { if (err !== window.CSG.TIMEOUT) throw err; r = window.Scene.build(d, hopfTime, { depth: 3 }); }
      applyBuild(r);
    }
  }
  function applyBuild(r) {
    const m = r.G;
    m.q = new Float64Array(m.npts * 4); m.p3 = new Float64Array(m.npts * 3); m.ok = new Uint8Array(m.npts);
    G = m; lastInfos = r.infos; lastBuildMs = r.ms;
    showInfo();
  }
  let lastBuildMs = 0;
  // The panel names the selected shape at once; its counts wait for the build that includes it.
  function showInfo() {
    const sh = selShape(), o = objOf(sh.key), got = lastInfos.find(f => f.shape === sh.id);
    const fresh = got && got.key === sh.key, info = fresh ? got : placeholderInfo(o);
    const card = $('pname').closest('.card');
    card.classList.toggle('stale', !fresh || got.sig !== JSON.stringify([sh.key, shapePrm(sh, o)]));
    const key = JSON.stringify([info.name, info.sub, info.counts, info.rows]);
    if (key === lastInfo) return;
    lastInfo = key;
    $('pname').textContent = info.name; $('psym').textContent = info.sub;
    $('counts').innerHTML = info.counts.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    $('rows').innerHTML = info.rows.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('');
  }
  function placeholderInfo(o) {
    const c = o.kind === 'poly' && P.CATALOG.find(c => c.id === o.id);
    const labels = o.kind === 'poly' ? ['cells', 'faces', 'edges', 'verts'] : o.kind === 'frac' ? ['copies', 'cells', 'faces', 'verts'] : o.kind === 'hopf' ? ['fibres', 'rings', 'segs', 'tori'] : o.kind === 'mtn' ? ['grid', 'summit', 'tets', 'verts'] : o.kind === 'tree' ? ['branches', 'leaves', 'tets', 'verts'] : o.kind === 'bh' ? ['rays', 'fall in', 'tets', 'layers'] : o.kind === 'chord' ? ['voices', 'orbit', 'fibres', 'latitude'] : ['grid', 'tris', 'tets', 'curves'];
    return { name: shortName(o), sub: c ? c.sym : '', counts: labels.map(l => [l, '…']), rows: [] };
  }
  // the spinner beside the symbol while a build is pending (after a short delay, so quick ones do not flicker)
  function showBusy(now) {
    const pending = refining || (inFlight && now - buildStart > 250);
    const b = $('pbusy');
    if (pending) {
      const several = scene.shapes.filter(s => s.visible).length > 1;
      b.lastChild.textContent = refining ? 'refining the cut…' : several ? 'computing intersection…' : 'building…';
    }
    b.hidden = !pending;
  }

  // ---------- GL ----------
  function prog(vs, fs) {
    const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const triProg = prog(`#version 300 es
    in vec3 aPos; in vec3 aNor; in vec4 aCol;
    uniform mat4 uProj, uView;
    out vec3 vN; out vec4 vC; out vec3 vV;
    void main() { vec4 p = uView * vec4(aPos, 1.0); vV = p.xyz; vN = mat3(uView) * aNor; vC = aCol; gl_Position = uProj * p; }`,
  `#version 300 es
    precision highp float;
    in vec3 vN; in vec4 vC; in vec3 vV; uniform float uOrtho; out vec4 o;
    void main() {
      vec3 n = normalize(vN); vec3 v = uOrtho > 0.5 ? vec3(0, 0, 1) : normalize(-vV);
      if (dot(n, v) < 0.0) n = -n;
      vec3 L = normalize(vec3(-0.45, 0.7, 0.55));
      float d = max(dot(n, L), 0.0), f = max(dot(n, normalize(vec3(0.6, -0.3, 0.75))), 0.0);
      float s = pow(max(dot(n, normalize(L + v)), 0.0), 48.0);
      o = vec4(vC.rgb * (0.30 + 0.62 * d + 0.20 * f) + 0.16 * s, vC.a);
    }`);
  const lineProg = prog(`#version 300 es
    in vec3 aPos; in vec4 aCol; uniform mat4 uProj, uView; out vec4 vC;
    void main() { vC = aCol; gl_Position = uProj * uView * vec4(aPos, 1.0); }`,
  `#version 300 es
    precision highp float; in vec4 vC; out vec4 o; void main() { o = vC; }`);
  const U = {};
  for (const [p, names] of [[triProg, ['uProj', 'uView', 'uOrtho']], [lineProg, ['uProj', 'uView']]])
    U[p === triProg ? 'tri' : 'line'] = Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));

  function makeVAO(p, layout) {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = layout.reduce((s, [, n]) => s + n, 0) * 4; let off = 0;
    for (const [name, n] of layout) { const loc = gl.getAttribLocation(p, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off); off += n * 4; }
    gl.bindVertexArray(null);
    return { vao, buf, cap: 0 };
  }
  const triVAO = makeVAO(triProg, [['aPos', 3], ['aNor', 3], ['aCol', 4]]);
  const lineVAO = makeVAO(lineProg, [['aPos', 3], ['aCol', 4]]);
  const ghostVAO = makeVAO(lineProg, [['aPos', 3], ['aCol', 4]]);
  function upload(v, data, n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf);
    if (n > v.cap) { v.cap = Math.ceil(n * 1.5); gl.bufferData(gl.ARRAY_BUFFER, v.cap * 4, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n);
  }

  // ---------- triangle / line emitters ----------
  let triRaw = new Float32Array(30 * 8192), triKey = new Float32Array(8192), triOut = new Float32Array(30 * 8192);
  let lineBuf = new Float32Array(14 * 8192), ghostBuf = new Float32Array(14 * 8192);
  let nTri = 0, nLine = 0, nGhost = 0;
  const camF = [0, 0, 1];
  // scratch triangle: positions TV, normals TN, colours TC (3 vertices each)
  const TV = new Float64Array(9), TN = new Float64Array(9), TC = new Float64Array(9);
  function commit(a) {
    if (nTri >= triKey.length) {
      const m = Math.ceil(triKey.length * 1.6), r = new Float32Array(m * 30); r.set(triRaw); triRaw = r;
      triOut = new Float32Array(m * 30); const k = new Float32Array(m); k.set(triKey); triKey = k;
    }
    const o = nTri * 30, T = triRaw;
    for (let v = 0; v < 3; v++) {
      const p = o + v * 10, s = v * 3;
      T[p] = TV[s]; T[p + 1] = TV[s + 1]; T[p + 2] = TV[s + 2];
      T[p + 3] = TN[s]; T[p + 4] = TN[s + 1]; T[p + 5] = TN[s + 2];
      T[p + 6] = TC[s]; T[p + 7] = TC[s + 1]; T[p + 8] = TC[s + 2]; T[p + 9] = a;
    }
    triKey[nTri++] = (TV[0] + TV[3] + TV[6]) * camF[0] + (TV[1] + TV[4] + TV[7]) * camF[1] + (TV[2] + TV[5] + TV[8]) * camF[2];
  }
  function flatNormal() {
    const ux = TV[3] - TV[0], uy = TV[4] - TV[1], uz = TV[5] - TV[2], vx = TV[6] - TV[0], vy = TV[7] - TV[1], vz = TV[8] - TV[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (!(l > 1e-14)) return false;
    nx /= l; ny /= l; nz /= l;
    for (let v = 0; v < 9; v += 3) { TN[v] = nx; TN[v + 1] = ny; TN[v + 2] = nz; }
    return true;
  }
  const setV = (v, A, i) => { TV[v * 3] = A[i]; TV[v * 3 + 1] = A[i + 1]; TV[v * 3 + 2] = A[i + 2]; };
  function colAll(r, g, b) { for (let v = 0; v < 9; v += 3) { TC[v] = r; TC[v + 1] = g; TC[v + 2] = b; } }
  function ensureLine(which, n) {
    const b = which ? ghostBuf : lineBuf; if (n * 14 <= b.length) return b;
    const a = new Float32Array(Math.ceil(n * 1.6) * 14); a.set(b); if (which) ghostBuf = a; else lineBuf = a; return a;
  }
  function pushLine(which, A, i, B, j, r, g, b, a, r2 = r, g2 = g, b2 = b) {
    const n = which ? nGhost : nLine, L = ensureLine(which, n + 1), o = n * 14;
    L[o] = A[i]; L[o + 1] = A[i + 1]; L[o + 2] = A[i + 2]; L[o + 3] = r; L[o + 4] = g; L[o + 5] = b; L[o + 6] = a;
    L[o + 7] = B[j]; L[o + 8] = B[j + 1]; L[o + 9] = B[j + 2]; L[o + 10] = r2; L[o + 11] = g2; L[o + 12] = b2; L[o + 13] = a;
    if (which) nGhost++; else nLine++;
  }

  // ---------- tubes and spheres ----------
  const SIDES = 8, RING_COS = [], RING_SIN = [];
  for (let k = 0; k <= SIDES; k++) { RING_COS.push(Math.cos(2 * Math.PI * k / SIDES)); RING_SIN.push(Math.sin(2 * Math.PI * k / SIDES)); }
  let ringBuf = new Float64Array(0), ringCol = new Float64Array(0);
  // idx: point indices into G.p3 (one run of valid points); col(i, out, o) fills colour for run position i
  function tube(idx, n, closed, r, col, alpha) {
    if (n < 2) return;
    const P3 = G.p3, need = n * (SIDES + 1) * 6;
    if (ringBuf.length < need) { ringBuf = new Float64Array(need * 1.5); ringCol = new Float64Array(n * 4.5); }
    if (ringCol.length < n * 3) ringCol = new Float64Array(n * 4.5);
    let ux = 0, uy = 0, uz = 0;
    for (let i = 0; i < n; i++) {
      const a = idx[i] * 3, prv = idx[closed ? (i - 1 + n) % n : Math.max(0, i - 1)] * 3, nxt = idx[closed ? (i + 1) % n : Math.min(n - 1, i + 1)] * 3;
      let tx = P3[nxt] - P3[prv], ty = P3[nxt + 1] - P3[prv + 1], tz = P3[nxt + 2] - P3[prv + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) { if (Math.abs(tx) < 0.9) { ux = 0; uy = -tz; uz = ty; } else { ux = tz; uy = 0; uz = -tx; } }
      // parallel transport the frame
      const d = ux * tx + uy * ty + uz * tz; ux -= d * tx; uy -= d * ty; uz -= d * tz;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-9) { if (Math.abs(tx) < 0.9) { ux = 0; uy = -tz; uz = ty; } else { ux = tz; uy = 0; uz = -tx; } ul = Math.hypot(ux, uy, uz); }
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      for (let k = 0; k <= SIDES; k++) {
        const c = RING_COS[k], s = RING_SIN[k], nx = c * ux + s * vx, ny = c * uy + s * vy, nz = c * uz + s * vz, o = (i * (SIDES + 1) + k) * 6;
        ringBuf[o] = P3[a] + r * nx; ringBuf[o + 1] = P3[a + 1] + r * ny; ringBuf[o + 2] = P3[a + 2] + r * nz;
        ringBuf[o + 3] = nx; ringBuf[o + 4] = ny; ringBuf[o + 5] = nz;
      }
      col(i, ringCol, i * 3);
    }
    const segs = closed ? n : n - 1;
    const put = (v, ring, k) => {
      const o = (ring * (SIDES + 1) + k) * 6;
      TV[v * 3] = ringBuf[o]; TV[v * 3 + 1] = ringBuf[o + 1]; TV[v * 3 + 2] = ringBuf[o + 2];
      TN[v * 3] = ringBuf[o + 3]; TN[v * 3 + 1] = ringBuf[o + 4]; TN[v * 3 + 2] = ringBuf[o + 5];
      TC[v * 3] = ringCol[ring * 3]; TC[v * 3 + 1] = ringCol[ring * 3 + 1]; TC[v * 3 + 2] = ringCol[ring * 3 + 2];
    };
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      for (let k = 0; k < SIDES; k++) {
        put(0, i, k); put(1, j, k); put(2, j, k + 1); commit(alpha);
        put(0, i, k); put(1, j, k + 1); put(2, i, k + 1); commit(alpha);
      }
    }
  }
  // short straight tube between two 3D points (slice curves)
  const segIdx = new Int32Array(2);
  let segPts = new Float64Array(6);
  function segTube(A, i, B, j, r, cr, cg, cb, alpha) {
    const save = G.p3;
    segPts[0] = A[i]; segPts[1] = A[i + 1]; segPts[2] = A[i + 2]; segPts[3] = B[j]; segPts[4] = B[j + 1]; segPts[5] = B[j + 2];
    G.p3 = segPts; segIdx[0] = 0; segIdx[1] = 1;
    tube(segIdx, 2, false, r, (k, out, o) => { out[o] = cr; out[o + 1] = cg; out[o + 2] = cb; }, alpha);
    G.p3 = save;
  }
  // unit sphere (subdivided icosahedron)
  const SPHERE = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const nv = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
    V = V.map(nv);
    const mid = new Map(), m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (!mid.has(k)) { mid.set(k, V.length); V.push(nv(V[a].map((x, i) => (x + V[b][i]) / 2))); } return mid.get(k); };
    F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
    return { V, F };
  })();
  function sphere(x, y, z, r, cr, cg, cb, alpha) {
    for (const f of SPHERE.F) {
      for (let v = 0; v < 3; v++) {
        const p = SPHERE.V[f[v]];
        TV[v * 3] = x + r * p[0]; TV[v * 3 + 1] = y + r * p[1]; TV[v * 3 + 2] = z + r * p[2];
        TN[v * 3] = p[0]; TN[v * 3 + 1] = p[1]; TN[v * 3 + 2] = p[2];
      }
      colAll(cr, cg, cb); commit(alpha);
    }
  }

  // ---------- camera ----------
  function matPersp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function matOrtho(h, asp, n, f) { return [1 / (h * asp), 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]; }
  function viewMat() {
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const m = [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, -state.dist, 1];
    camF[0] = m[2]; camF[1] = m[6]; camF[2] = m[10];
    return m;
  }

  // ---------- per-frame geometry ----------
  const STEREO_K = 0.5, LIMIT = 9;
  function transform() {
    const { pts, npts, q, p3, ok } = G, M = R, [t0, t1, t2, t3] = T;
    const mode = state.mode === 'slice' ? 'ortho' : state.p4, D = state.eye4;
    for (let i = 0; i < npts; i++) {
      const o = i * 4, x = pts[o], y = pts[o + 1], z = pts[o + 2], w = pts[o + 3];
      for (let r = 0; r < 4; r++) q[o + r] = M[r * 4] * x + M[r * 4 + 1] * y + M[r * 4 + 2] * z + M[r * 4 + 3] * w;
      q[o] += t0; q[o + 1] += t1; q[o + 2] += t2; q[o + 3] += t3;
      ok[i] = project(q, o, p3, i * 3, mode, D);
    }
  }
  function project(q, o, out, j, mode, D) {
    const qw = q[o + 3];
    let s = 1, good = 1;
    if (mode === 'persp') { const den = D - qw; if (den < 1e-3) { good = 0; s = 0; } else s = (D - 1) / den; }
    else if (mode === 'stereo') { const den = 1 - qw; if (den < 1e-3) { good = 0; s = 0; } else s = STEREO_K / den; }
    const X = q[o] * s, Y = q[o + 1] * s, Z = q[o + 2] * s;
    if (good && X * X + Y * Y + Z * Z > LIMIT * LIMIT) good = 0;
    out[j] = X; out[j + 1] = Y; out[j + 2] = Z;
    return good;
  }
  // a small crosshair at the pivot, drawn over everything
  const pvP = new Float64Array(9);
  function pivotMarker() {
    const c = state.pivot;
    if (!state.marker || (!c[0] && !c[1] && !c[2] && !c[3])) return;
    const pw = pivotWorld(), mode = state.mode === 'slice' ? 'ortho' : state.p4;
    if (!project(pw, 0, pvP, 0, mode, state.eye4)) return;
    const a = theme.accent, h = 0.07 * state.dist / 3.7;
    // in slice view the pivot fades as it leaves the hyperplane
    const al = state.mode === 'slice' ? 0.25 + 0.75 * Math.max(0, 1 - Math.abs(pw[3] - state.slice) / 0.4) : 1;
    for (let k = 0; k < 3; k++) {
      pvP.copyWithin(3, 0, 3); pvP.copyWithin(6, 0, 3); pvP[3 + k] -= h; pvP[6 + k] += h;
      pushLine(1, pvP, 3, pvP, 6, a[0], a[1], a[2], al);
    }
  }

  function edgeStyle(which) {
    if (which) return [theme.fg, theme.dark ? 0.09 : 0.14];
    if (state.surf === 'solid') return [theme.dark ? theme.canvas : [0.1, 0.11, 0.16], 0.55];
    return [theme.fg, state.surf === 'wire' ? 0.75 : 0.32];
  }
  const vcol = new Float64Array(6);
  function edgeLines(which, depth) {
    const { edges, q, p3, ok } = G, [base, a] = edgeStyle(which);
    const useDepth = depth && !which && state.surf !== 'solid', wire = state.surf === 'wire';
    for (let k = 0; k < edges.length; k += 2) {
      const i = edges[k], j = edges[k + 1];
      if (!ok[i] || !ok[j]) continue;
      if (useDepth) {
        depthColor(q[i * 4 + 3], vcol, 0); depthColor(q[j * 4 + 3], vcol, 3);
        pushLine(which, p3, i * 3, p3, j * 3, vcol[0], vcol[1], vcol[2], wire ? 0.9 : 0.55, vcol[3], vcol[4], vcol[5]);
      } else pushLine(which, p3, i * 3, p3, j * 3, base[0], base[1], base[2], a);
    }
  }
  function curveLines(which, depth) {
    const { curves, q, p3, ok } = G, [base, a] = edgeStyle(which);
    for (const c of curves) {
      const segs = c.closed ? c.n : c.n - 1;
      for (let k = 0; k < segs; k++) {
        const i = c.start + k, j = c.start + (k + 1) % c.n;
        if (!ok[i] || !ok[j]) continue;
        if (which) pushLine(1, p3, i * 3, p3, j * 3, base[0], base[1], base[2], a);
        else if (depth) { depthColor(q[i * 4 + 3], vcol, 0); depthColor(q[j * 4 + 3], vcol, 3); pushLine(0, p3, i * 3, p3, j * 3, vcol[0], vcol[1], vcol[2], 0.95, vcol[3], vcol[4], vcol[5]); }
        else pushLine(0, p3, i * 3, p3, j * 3, c.col[0], c.col[1], c.col[2], 0.95);
      }
    }
  }

  let runIdx = new Int32Array(1024);
  function buildProjection() {
    const { tris, triCol, q, p3, ok, curves } = G;
    const depth = state.col === 'depth', trans = state.surf === 'trans', alpha = trans ? state.opacity : 1;
    if (state.surf !== 'wire') {
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        if (!ok[a] || !ok[b] || !ok[c]) continue;
        setV(0, p3, a * 3); setV(1, p3, b * 3); setV(2, p3, c * 3);
        if (!flatNormal()) continue;
        if (depth) { depthColor(q[a * 4 + 3], TC, 0); depthColor(q[b * 4 + 3], TC, 3); depthColor(q[c * 4 + 3], TC, 6); }
        else colAll(triCol[t], triCol[t + 1], triCol[t + 2]);
        commit(alpha);
      }
    }
    if (state.edges || state.surf === 'wire') edgeLines(0, depth);
    if (!curves.length) return;
    if (state.surf === 'wire') { curveLines(0, depth); return; }
    const ta = trans ? Math.min(1, 0.35 + state.opacity * 2) : 1;
    for (const c of curves) {
      // split into runs of drawable points (stereographic projection can send points to infinity)
      if (runIdx.length < c.n) runIdx = new Int32Array(c.n * 2);
      let first = -1;
      for (let k = 0; k < c.n; k++) if (!ok[c.start + k]) { first = k; break; }
      const colFn = depth ? (i, out, o) => depthColor(q[runIdx[i] * 4 + 3], out, o) : (i, out, o) => { out[o] = c.col[0]; out[o + 1] = c.col[1]; out[o + 2] = c.col[2]; };
      if (first < 0) { for (let k = 0; k < c.n; k++) runIdx[k] = c.start + k; tube(runIdx, c.n, c.closed, c.r, colFn, ta); continue; }
      let m = 0;
      for (let s = 1; s <= c.n; s++) {
        const k = c.closed ? (first + s) % c.n : s - 1, idx = c.start + k;
        if (ok[idx]) runIdx[m++] = idx;
        if (!ok[idx] || s === c.n) { if (m > 1) tube(runIdx, m, false, c.r, colFn, ta); m = 0; }
      }
    }
  }

  // slice: cut tetrahedra into triangles, triangles into segments, curves into points
  const PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const ix = new Float64Array(12);
  function cross(i, j, s, k) {
    const q = G.q, wi = q[i * 4 + 3], wj = q[j * 4 + 3], t = (s - wi) / (wj - wi);
    ix[k * 3] = q[i * 4] + (q[j * 4] - q[i * 4]) * t;
    ix[k * 3 + 1] = q[i * 4 + 1] + (q[j * 4 + 1] - q[i * 4 + 1]) * t;
    ix[k * 3 + 2] = q[i * 4 + 2] + (q[j * 4 + 2] - q[i * 4 + 2]) * t;
  }
  const sliceCol = new Float64Array(3);
  function buildSlice() {
    const { tets, tetCol, tetCtr, tris, triCol, q, curves } = G, s = state.slice;
    const depth = state.col === 'depth', trans = state.surf === 'trans', wire = state.surf === 'wire';
    const alpha = trans ? Math.min(1, state.opacity * 1.6) : 1;
    depthColor(s, sliceCol, 0);
    const v = [0, 0, 0, 0], above = [false, false, false, false], A = [0, 0], B = [0, 0];
    if (!wire) {
      for (let t = 0; t < tets.length / 4; t++) {
        let na = 0;
        for (let k = 0; k < 4; k++) { v[k] = tets[t * 4 + k]; above[k] = q[v[k] * 4 + 3] > s; if (above[k]) na++; }
        if (na === 0 || na === 4) continue;
        let r, g, b;
        if (depth) { const c = tetCtr[t]; if (c >= 0) { depthColor(q[c * 4 + 3], vcol, 0); r = vcol[0]; g = vcol[1]; b = vcol[2]; } else { r = sliceCol[0]; g = sliceCol[1]; b = sliceCol[2]; } }
        else { r = tetCol[t * 3]; g = tetCol[t * 3 + 1]; b = tetCol[t * 3 + 2]; }
        if (na === 1 || na === 3) {
          let n = 0;
          for (const [i, j] of PAIRS) if (above[i] !== above[j]) cross(v[i], v[j], s, n++);
          setV(0, ix, 0); setV(1, ix, 3); setV(2, ix, 6);
          if (flatNormal()) { colAll(r, g, b); commit(alpha); }
        } else {
          let na2 = 0, nb2 = 0;
          for (let k = 0; k < 4; k++) if (above[k]) A[na2++] = v[k]; else B[nb2++] = v[k];
          cross(A[0], B[0], s, 0); cross(A[0], B[1], s, 1); cross(A[1], B[1], s, 2); cross(A[1], B[0], s, 3);
          setV(0, ix, 0); setV(1, ix, 3); setV(2, ix, 6);
          if (flatNormal()) { colAll(r, g, b); commit(alpha); }
          setV(0, ix, 0); setV(1, ix, 6); setV(2, ix, 9);
          if (flatNormal()) { colAll(r, g, b); commit(alpha); }
        }
      }
    }
    // surface triangles: their cut is a curve. Pure surfaces draw it as a tube; solids draw it as an outline.
    const triTube = G.triTube;
    if (G.hasTube || state.edges || wire) {
      const [base, a] = edgeStyle(0), outline = state.edges || wire;
      const up = [false, false, false], f = [0, 0, 0];
      for (let t = 0; t < tris.length; t += 3) {
        const tr = triTube[t / 3];
        if (!tr && !outline) continue;
        f[0] = tris[t]; f[1] = tris[t + 1]; f[2] = tris[t + 2];
        for (let k = 0; k < 3; k++) up[k] = q[f[k] * 4 + 3] > s;
        if (up[0] === up[1] && up[1] === up[2]) continue;
        let n = 0;
        if (up[0] !== up[1]) cross(f[0], f[1], s, n++);
        if (up[1] !== up[2]) cross(f[1], f[2], s, n++);
        if (up[2] !== up[0]) cross(f[2], f[0], s, n++);
        const cr = depth ? sliceCol[0] : triCol[t], cg = depth ? sliceCol[1] : triCol[t + 1], cb = depth ? sliceCol[2] : triCol[t + 2];
        if (tr && !wire) segTube(ix, 0, ix, 3, tr, cr, cg, cb, alpha);
        else if (tr) pushLine(0, ix, 0, ix, 3, cr, cg, cb, 0.95);
        else pushLine(0, ix, 0, ix, 3, base[0], base[1], base[2], state.surf === 'solid' ? 0.6 : wire ? 0.85 : 0.45);
      }
    }
    // curves pierce the hyperplane at points
    for (const c of curves) {
      const segs = c.closed ? c.n : c.n - 1;
      for (let k = 0; k < segs; k++) {
        const i = c.start + k, j = c.start + (k + 1) % c.n;
        if ((q[i * 4 + 3] > s) === (q[j * 4 + 3] > s)) continue;
        cross(i, j, s, 0);
        const col = depth ? sliceCol : c.col;
        sphere(ix[0], ix[1], ix[2], c.r * 2, col[0], col[1], col[2], 1);
      }
    }
    if (state.ghost) { edgeLines(1, false); curveLines(1, false); }
  }

  // ---------- Hopf chord: a point on a fibre, sounding its four coordinates ----------
  const chordP = new Float64Array(4), chordQ = new Float64Array(4), chordS = new Float64Array(3);
  let chordPhase = 0, chordHud = 0;
  const VOICE_COL = [[0.95, 0.45, 0.35], [0.96, 0.78, 0.3], [0.35, 0.8, 0.7], [0.5, 0.62, 0.98]];
  $('voices').innerHTML = ['x', 'y', 'z', 'w'].map((n, k) => `<b style="color:rgb(${VOICE_COL[k].map(c => Math.round(c * 255)).join(',')})">${n}</b><div class="cb"><i id="vb${k}" style="background:rgb(${VOICE_COL[k].map(c => Math.round(c * 255)).join(',')})"></i></div><span class="nt" id="vn${k}"></span><span id="vf${k}"></span>`).join('');
  $('soundBtn').onclick = async () => {
    try {
      if (window.Music.on) window.Music.stop(); else await window.Music.start();
    } catch (err) { note('Sound could not start: ' + (err.message || err)); }
    $('soundBtn').setAttribute('aria-pressed', String(window.Music.on)); $('soundBtn').textContent = window.Music.on ? 'Sound off' : 'Sound on';
  };
  // the point's place on the fibre, in the shape's coordinates (P) and in the view (Q, after placement and pose)
  function chordPoint(prm, phase, sh, P, Q) {
    const th = prm.lat * Math.PI / 180, ph = prm.lon * Math.PI / 180, a = Math.cos(th / 2), b = Math.sin(th / 2);
    P[0] = a * Math.cos(phase + ph); P[1] = a * Math.sin(phase + ph); P[2] = b * Math.cos(phase); P[3] = b * Math.sin(phase);
    const pl = window.CSG.placement(sh.place), w = [0, 1, 2, 3].map(r => pl.off[r] + pl.s * (pl.R[r * 4] * P[0] + pl.R[r * 4 + 1] * P[1] + pl.R[r * 4 + 2] * P[2] + pl.R[r * 4 + 3] * P[3]));
    for (let r = 0; r < 4; r++) Q[r] = R[r * 4] * w[0] + R[r * 4 + 1] * w[1] + R[r * 4 + 2] * w[2] + R[r * 4 + 3] * w[3] + T[r];
  }
  function chordFrame(dt) {
    const sh = scene.shapes.find(s => s.visible && objOf(s.key).kind === 'chord');
    $('music').hidden = !sh;
    if (!sh) { if (window.Music.on) { window.Music.stop(); $('soundBtn').setAttribute('aria-pressed', 'false'); $('soundBtn').textContent = 'Sound on'; } return; }
    const prm = shapePrm(sh);
    if (state.playing) chordPhase = (chordPhase + dt * 2 * Math.PI / prm.period) % (2 * Math.PI);
    chordPoint(prm, chordPhase, sh, chordP, chordQ);
    const coords = prm.listen === 'view' ? (() => { const l = Math.hypot(...chordQ) || 1; return [...chordQ].map(v => v / l); })() : [...chordP];
    const freqs = window.Music.frequencies(coords, prm);
    const amps = prm.loud === 'square' ? coords.map(c => c * c * 2) : [1, 1, 1, 1];
    window.Music.update(freqs, amps, prm.vol, prm.wave, prm.glide);
    // the point and a fading trail behind it (in a slice, only where they cross the slice)
    if (state.renderer !== 'gpu' || state.mode === 'slice') {
      const mode = state.mode === 'slice' ? 'ortho' : state.p4, sc = state.p4 === 'stereo' && state.mode !== 'slice' ? 1.6 : 1;
      for (let j = 24; j >= 0; j--) {
        chordPoint(prm, chordPhase - j * 0.035, sh, chordP, chordQ);
        let r = (j ? 0.022 * (1 - j / 26) : 0.05) * sc;
        if (state.mode === 'slice') r *= Math.max(0, 1 - Math.abs(chordQ[3] - state.slice) / 0.12);
        if (r <= 0.002 || !project(chordQ, 0, chordS, 0, mode, state.eye4)) continue;
        const k = 1 - j / 25;
        sphere(chordS[0], chordS[1], chordS[2], r * (mode === 'stereo' ? 1 : 1), 0.98 * k + 0.4 * (1 - k), 0.96 * k + 0.5 * (1 - k), 0.85 * k + 0.75 * (1 - k), 1);
      }
      chordPoint(prm, chordPhase, sh, chordP, chordQ);
    }
    // the readout, a few times a second
    if (++chordHud % 4) return;
    coords.forEach((c, k) => {
      const nn = window.Music.noteName(freqs[k]);
      $('vb' + k).style.left = (50 + 50 * Math.max(-1, Math.min(1, c))) + '%';
      $('vn' + k).textContent = nn.name + (prm.snap === 'off' || prm.snap === 'just' ? (nn.cents >= 0 ? ' +' : ' −') + Math.abs(nn.cents) + '¢' : '');
      $('vf' + k).textContent = freqs[k].toFixed(1) + ' Hz';
    });
  }

  // ---------- frame ----------
  let last = performance.now(), sweepPhase = 0, frameCount = 0, statT = 0;
  let order = new Uint32Array(0);
  let frameMs = 16;
  function frame(now) {
    frameMs = frameMs * 0.9 + (now - last) * 0.1;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state.playing) {
      aboutPivot(() => {
        PLANES.forEach(([, i, j], k) => { if (state.spin[k]) rotBody(R, i, j, state.spin[k] * dt); });
        if (++frameCount % 120 === 0) orthonormalize(R);
      });
      const mesh = state.renderer !== 'gpu';
      if (scene.shapes.some(sh => sh.visible && sh.key === 'hopf' && shapePrm(sh).flow)) { hopfTime += dt; if (mesh) dirty = true; }
      // shapes with their own spin turn about their own centres; the mesh renderer has to recombine them
      let turned = false;
      for (const sh of scene.shapes) {
        if (!sh.spin.some(Boolean)) continue;
        sh.place.rot = sh.place.rot.map((a, k) => { const v = a + sh.spin[k] * dt; return v > 180 ? v - 360 : v < -180 ? v + 360 : v; });
        turned = true;
        if (sh === selShape()) sh.place.rot.forEach((a, k) => { const inp = $('pl-rot' + k); if (inp && document.activeElement !== inp) { inp.value = a; inp.nextElementSibling.value = Math.round(a) + '°'; } });
      }
      if (turned && mesh) dirty = true;
    }
    if (dirty && !inFlight) { dirty = false; rebuild(); }
    if (state.mode === 'slice' && state.sweep && state.playing) {
      sweepPhase += dt * state.sweepSp * 2;
      state.slice = 0.999 * Math.sin(sweepPhase);
      $('slice').value = state.slice; $('sliceO').value = state.slice.toFixed(3);
    }
    if (state.mode === 'slice') $('wread').textContent = `w = ${state.slice >= 0 ? '+' : '−'}${Math.abs(state.slice).toFixed(3)}`;

    let dpr = Math.min(devicePixelRatio || 1, 2);
    const shooting = shotScale > 0;
    if (shooting) dpr = Math.min(dpr * shotScale, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) / Math.max(canvas.clientWidth, canvas.clientHeight));
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    const c = theme.canvas; gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const view = viewMat(), asp = W / Math.max(1, H), fov = 0.62;
    const proj = state.p3 === 'persp' ? matPersp(fov, asp, 0.05, 80) : matOrtho(state.dist * Math.tan(fov / 2), asp, -40, 80);

    nTri = 0; nLine = 0; nGhost = 0;
    let rayPx = 0;
    if (state.renderer === 'gpu' && gpuR) {
      const q = shooting ? 1 : state.gpuQ === 'high' ? 1 : state.gpuQ === 'low' ? 0.5 / dpr : 1 / dpr;
      rayPx = gpuR.draw({
        descs: descs().filter(d => d.visible), R, T, slice: state.slice, view, proj, ortho: state.p3 === 'ortho', hopfTime,
        mode: state.surf === 'solid' ? 0 : state.surf === 'trans' ? 1 : 2, opacity: Math.min(1, state.opacity * 1.6), depthCol: state.col === 'depth',
        edges: state.edges || state.surf === 'wire', edgeCol: state.surf === 'solid' ? [...(theme.dark ? theme.canvas : [0.1, 0.11, 0.16]), 0.7] : [...theme.fg, state.surf === 'wire' ? 0.9 : 0.5],
        width: W, height: H, scale: Math.min(1, Math.max(0.2, q)), background: theme.canvas,
        pxAngle: (state.p3 === 'persp' ? 2 * Math.tan(fov / 2) : 2 * state.dist * Math.tan(fov / 2)) / H,
      });
    } else if (G) {
      transform();
      if (state.mode === 'proj') buildProjection(); else buildSlice();
    }
    pivotMarker();
    chordFrame(dt);

    if (nTri) {
      const trans = state.surf === 'trans';
      let data = triRaw;
      if (trans) {
        if (order.length < nTri) order = new Uint32Array(Math.ceil(nTri * 1.5));
        const idx = order.subarray(0, nTri);
        for (let i = 0; i < nTri; i++) idx[i] = i;
        idx.sort((a, b) => triKey[a] - triKey[b]); // farthest first
        for (let i = 0; i < nTri; i++) triOut.set(triRaw.subarray(idx[i] * 30, idx[i] * 30 + 30), i * 30);
        data = triOut;
      }
      gl.useProgram(triProg);
      gl.uniformMatrix4fv(U.tri.uProj, false, proj);
      gl.uniformMatrix4fv(U.tri.uView, false, view);
      gl.uniform1f(U.tri.uOrtho, state.p3 === 'ortho' ? 1 : 0);
      gl.bindVertexArray(triVAO.vao); upload(triVAO, data, nTri * 30);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      if (trans) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      else { gl.disable(gl.BLEND); gl.depthMask(true); }
      gl.drawArrays(gl.TRIANGLES, 0, nTri * 3);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true);
    }
    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(U.line.uProj, false, proj);
    gl.uniformMatrix4fv(U.line.uView, false, view);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (nLine) {
      gl.bindVertexArray(lineVAO.vao); upload(lineVAO, lineBuf, nLine * 14);
      if (state.surf === 'solid') gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false); gl.drawArrays(gl.LINES, 0, nLine * 2); gl.depthMask(true);
    }
    if (nGhost) {
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(ghostVAO.vao); upload(ghostVAO, ghostBuf, nGhost * 14);
      gl.drawArrays(gl.LINES, 0, nGhost * 2);
    }
    gl.bindVertexArray(null);
    if (now - statT > 250) {
      statT = now;
      showBusy(now); showInfo();
      const busy = refining ? 'refining the cut… · ' : inFlight && now - buildStart > 300 ? 'combining shapes… · ' : '';
      $('stats').textContent = rayPx ? `ray traced on the GPU · ${rayPx.toLocaleString()} rays · ${Math.round(1000 / Math.max(1, frameMs))} fps`
        : `${busy}${nTri.toLocaleString()} triangles · ${(nLine + nGhost).toLocaleString()} lines`;
    }
    if (shooting) { shotScale = 0; finishSnapshot(); }
    if (rec?.frame) rec.frame(now);
    if (rec) { const s = Math.floor((now - recStart) / 1000); $('recBadge').textContent = `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    requestAnimationFrame(frame);
  }

  // ---------- pointer ----------
  const pointers = new Map(); let pinch0 = 0, dist0 = 0;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, four: e.shiftKey || e.button === 2 });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = state.dist; }
  });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) state.dist = Math.max(1.2, Math.min(16, dist0 * pinch0 / d)); return; }
    if (p.four || e.shiftKey) aboutPivot(() => { rotWorld(R, 0, 3, dx * 0.008); rotWorld(R, 1, 3, -dy * 0.008); });
    else { state.yaw += dx * 0.008; state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.008)); }
  });
  const up = e => { pointers.delete(e.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); state.dist = Math.max(1.2, Math.min(16, state.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

  // deep links: #clifford, #hopf, #sierpinski-5, #small-stellated … plus #sliced and #pivot=x,y,z,w
  let hash = location.hash.slice(1);
  const pv = /pivot=([-+\d.e]+(?:,[-+\d.e]+){3})/.exec(hash);
  if (pv) { const c = pv[1].split(',').map(Number); if (c.every(isFinite)) state.pivot = c; hash = hash.replace(pv[0], ''); }
  const tags = hash.split('.').filter(Boolean);
  for (const t of tags) {
    if (t === 'sliced') { state.mode = 'slice'; state.slice = 0.35; continue; }
    const o = OBJECTS.find(o => o.key === t || o.key === 'poly:' + t || o.key === 'frac:' + t);
    if (o) state.key = o.key;
  }
  const startKey = state.key; state.key = 'poly:grand-600';
  R = initialPose();
  select(startKey);
  buildShapeList();
  requestAnimationFrame(frame);
})();
