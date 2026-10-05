// Turns the list of shapes (type, parameters, placement, operation, tint) into one combined mesh.
// Runs in the worker (worker.js) or, if workers are unavailable, on the page itself.
(function (root) {
  const O = root.Objects, CSG = root.CSG;
  const cache = new Map();

  function objectMesh(d, hopfTime) {
    if (d.kind === 'poly') return O.polytope(d.id, d.prm);
    if (d.kind === 'clifford') return O.clifford(d.prm);
    if (d.kind === 'hopf') return O.hopf(d.prm, hopfTime);
    return O.fractal(d.id, d.prm);
  }

  // descs: [{ id, key, kind, oid, prm, place, op, tint, visible }] top to bottom
  function build(descs, hopfTime = 0) {
    const items = [], infos = [], live = new Set();
    for (const d of descs) {
      live.add(d.id);
      const sig = JSON.stringify([d.key, d.prm, d.kind === 'hopf' && d.prm.flow ? hopfTime : 0]), fsig = JSON.stringify([d.key, d.prm]);
      let c = cache.get(d.id);
      if (!c || c.sig !== sig) { c = { ...c, sig, mesh: objectMesh({ ...d, id: d.oid }, hopfTime) }; cache.set(d.id, c); }
      if (c.fsig !== fsig) { c.fsig = fsig; c.field = CSG.field({ kind: d.kind, id: d.oid }, d.prm); }
      infos.push(c.mesh.info);
      if (d.visible) items.push({ mesh: c.mesh, field: c.field, place: d.place, op: d.op, tint: d.tint });
    }
    for (const k of [...cache.keys()]) if (!live.has(k)) cache.delete(k);
    const t0 = Date.now();
    const G = CSG.compose(items.length ? items : [], {});
    return { G, infos, ms: Date.now() - t0 };
  }

  // the typed arrays of a combined mesh, for transferring out of a worker
  const buffers = G => [G.pts, G.tris, G.triCol, G.triTube, G.tets, G.tetCol, G.tetCtr, G.edges].map(a => a.buffer);

  root.Scene = { build, buffers };
})(typeof window !== 'undefined' ? window : globalThis);
