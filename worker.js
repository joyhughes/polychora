// Builds and combines the shapes off the main thread, so spinning and dragging stay smooth.
// (with the page's stamp, so they are never older than the page)
importScripts(...['geometry.js', 'objects.js', 'csg.js', 'scene.js'].map(f => f + self.location.search));
// Full precision if it is quick; otherwise a coarse draft first, then the full result when it is ready.
// (The page restarts this worker if the scene changes while it is still refining.)
const QUICK_MS = 1200, DRAFT_DEPTH = 3, REFINE_MS = 15000, SETTLE_DEPTH = 5;
onmessage = e => {
  const { job, descs, hopfTime } = e.data;
  const send = (r, final) => postMessage({ job, final, ...r }, Scene.buffers(r.G));
  try {
    try { send(Scene.build(descs, hopfTime, { deadline: Date.now() + QUICK_MS }), true); return; }
    catch (err) { if (err !== CSG.TIMEOUT) throw err; }
    send(Scene.build(descs, hopfTime, { depth: DRAFT_DEPTH }), false);
    // full precision within REFINE_MS, else settle for a middle depth
    try { send(Scene.build(descs, hopfTime, { deadline: Date.now() + REFINE_MS }), true); }
    catch (err) { if (err !== CSG.TIMEOUT) throw err; send(Scene.build(descs, hopfTime, { depth: SETTLE_DEPTH }), true); }
  } catch (err) {
    postMessage({ job, final: true, error: String(err && err.stack || err) });
  }
};
