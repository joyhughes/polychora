// Builds and combines the shapes off the main thread, so spinning and dragging stay smooth.
importScripts('geometry.js', 'objects.js', 'csg.js', 'scene.js');
onmessage = e => {
  const { job, descs, hopfTime } = e.data;
  try {
    const r = Scene.build(descs, hopfTime);
    postMessage({ job, ...r }, Scene.buffers(r.G));
  } catch (err) {
    postMessage({ job, error: String(err && err.stack || err) });
  }
};
