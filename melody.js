// Audio for the vertex-walk melodies: plucked notes scheduled on the audio clock, and held voices that slide.
// The page decides what to play (app.js walks the shape's graph); this only makes the sound.
(function (root) {
  let ctx = null, out = null, master = null, on = false, live = true, quietTimer = 0;
  const slides = new Map(), waves = {};
  function wave(o, name) {
    if (name === 'sine' || name === 'triangle') { o.type = name; return; }
    if (!waves[name]) {
      const h = name === 'reed' ? [0, 1, 0.5, 0.28, 0.16, 0.08, 0.04] : [0, 1, 0, 0.35, 0, 0.12, 0, 0.05];
      waves[name] = ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h));
    }
    o.setPeriodicWave(waves[name]);
  }
  async function start() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) throw new Error('this browser has no Web Audio');
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = 0;
      out = ctx.createBiquadFilter(); out.type = 'lowpass'; out.frequency.value = 6000; out.Q.value = 0.3;
      out.connect(master); master.connect(comp); comp.connect(ctx.destination);
    }
    on = true;
    if (live) await wake();
  }
  function quiet() {
    if (!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (!(on && live) && ctx.state === 'running') ctx.suspend(); }, 250);
  }
  async function wake() { clearTimeout(quietTimer); if (ctx && ctx.state !== 'running') await ctx.resume(); }
  function stop() { on = false; quiet(); }
  function setLive(v) { if (v === live) return; live = v; if (on) (v ? wake() : quiet()); }
  function close() { on = false; if (ctx) { ctx.close(); ctx = null; slides.clear(); } }
  const playing = () => on && live && ctx && ctx.state === 'running';
  function setVolume(v) { if (playing()) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }

  // a note at time t (audio clock) lasting dur seconds, with a quick attack and a decay
  function pluck(t, freq, dur, tone, level) {
    if (!playing()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    wave(o, tone); o.frequency.value = freq;
    const peak = 0.3 * level, end = t + Math.max(0.08, dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.setTargetAtTime(peak * 0.35, t + 0.01, dur * 0.25); g.gain.setTargetAtTime(0, end - 0.04, 0.02);
    o.connect(g); g.connect(out); o.start(t); o.stop(end + 0.1);
    return { o, g, t, end };
  }
  // cut notes short: ones still to come never start, ones sounding fade out at once
  function cancel(notes) {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const n of notes) {
      if (n.end < now) continue;
      try {
        if (n.t > now) { n.o.stop(); n.o.disconnect(); }
        else { n.g.gain.cancelScheduledValues(now); n.g.gain.setTargetAtTime(0, now, 0.015); n.o.stop(now + 0.08); }
      } catch { /* already stopped */ }
    }
  }
  // a held voice k that slides to freq (level 0 silences it)
  function slide(k, freq, tone, level, glide) {
    if (!ctx) return;
    let s = slides.get(k);
    if (!s) { const o = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0; o.frequency.value = freq; o.connect(g); g.connect(out); o.start(); s = { o, g, tone: '' }; slides.set(k, s); }
    if (s.tone !== tone) { wave(s.o, tone); s.tone = tone; }
    const t = ctx.currentTime;
    s.o.frequency.setTargetAtTime(freq, t, Math.max(0.005, glide));
    s.g.gain.setTargetAtTime(playing() ? 0.2 * level : 0, t, 0.05);
  }
  root.Melody = { start, stop, setLive, close, pluck, cancel, slide, setVolume, get on() { return on; }, get time() { return ctx ? ctx.currentTime : 0; }, get running() { return playing(); } };
})(typeof window !== 'undefined' ? window : globalThis);
