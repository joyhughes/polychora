// Four voices for the Hopf chord: each coordinate of a point on the 3-sphere picks a pitch inside its own octave.
// Web Audio: four oscillators, each with its own gain, into a gentle low-pass, a master gain and a compressor.
(function (root) {
  const SCALES = {
    off: null,
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(k => 2 ** (k / 12)),
    major: [0, 2, 4, 5, 7, 9, 11].map(k => 2 ** (k / 12)),
    pentatonic: [0, 2, 4, 7, 9].map(k => 2 ** (k / 12)),
    just: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8],
  };
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  // where a coordinate c in [−1, 1] sits in its voice's octave, as a ratio in [1, 2], snapped to a scale if asked
  function ratio(c, scale) {
    const x = Math.max(-1, Math.min(1, c)), r = 2 ** ((x + 1) / 2), S = SCALES[scale];
    if (!S) return r;
    let best = 1, bd = Infinity;
    for (const s of [...S, 2]) { const d = Math.abs(Math.log2(r / s)); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  // voice k of the chord: its octave starts spread·k octaves above the root
  function frequencies(coords, prm) {
    const root = 440 * 2 ** (prm.root / 12);
    return coords.map((c, k) => root * 2 ** (prm.spread * k) * ratio(c, prm.snap));
  }
  function noteName(f) {
    const m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), cents = Math.round((m - n) * 100);
    return { name: NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1), cents };
  }

  let ctx = null, voices = null, master = null, filter = null, waveName = '', on = false;
  const waves = {};
  function periodic(name) {
    if (name === 'sine' || name === 'triangle') return name;
    if (!waves[name]) {
      // soft harmonic recipes: an organ-like reed and a hollow, bell-like glass
      const h = name === 'warm' ? [0, 1, 0.5, 0.28, 0.16, 0.08, 0.04] : [0, 1, 0, 0.35, 0, 0.12, 0, 0.05];
      const re = new Float32Array(h.length), im = Float32Array.from(h);
      waves[name] = ctx.createPeriodicWave(re, im);
    }
    return waves[name];
  }
  function setWave(name) {
    if (!voices || name === waveName) return;
    waveName = name;
    const w = periodic(name);
    for (const v of voices) { if (typeof w === 'string') v.osc.type = w; else v.osc.setPeriodicWave(w); }
  }
  // on: the listener asked for sound; live: the chord is moving and visible, so it should be heard now
  let live = true, quietTimer = 0;
  async function start() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) throw new Error('this browser has no Web Audio');
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      master = ctx.createGain(); master.gain.value = 0;
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 5200; filter.Q.value = 0.4;
      filter.connect(master); master.connect(comp); comp.connect(ctx.destination);
      voices = [0, 1, 2, 3].map(() => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        g.gain.value = 0; osc.frequency.value = 220;
        osc.connect(g); g.connect(filter); osc.start();
        return { osc, g };
      });
      waveName = '';
    }
    on = true;
    if (live) await wake();
  }
  // fade out, then stop the audio clock altogether, so nothing keeps sounding
  function quiet() {
    if (!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (!(on && live) && ctx.state === 'running') ctx.suspend(); }, 250);
  }
  async function wake() { clearTimeout(quietTimer); if (ctx && ctx.state !== 'running') await ctx.resume(); }
  function stop() { on = false; quiet(); }
  // the page says whether the chord should be heard right now (it pauses with the animation and when hidden)
  function setLive(v) {
    if (v === live) return;
    live = v;
    if (!on) return;
    if (v) wake(); else quiet();
  }
  // shut everything down when the page goes away
  function close() { on = false; if (ctx) { ctx.close(); ctx = null; voices = null; } }
  // freqs: four Hz; amps: four weights in [0, 1]; vol: master level in [0, 1]
  function update(freqs, amps, vol, wave, glide) {
    if (!on || !live || !ctx) return;
    setWave(wave);
    const t = ctx.currentTime, tc = Math.max(0.005, glide);
    voices.forEach((v, k) => { v.osc.frequency.setTargetAtTime(freqs[k], t, tc); v.g.gain.setTargetAtTime(0.22 * amps[k], t, 0.04); });
    master.gain.setTargetAtTime(vol, t, 0.05);
  }

  root.Music = { start, stop, setLive, close, update, frequencies, ratio, noteName, SCALES, get on() { return on; }, get state() { return ctx ? ctx.state : 'none'; } };
})(typeof window !== 'undefined' ? window : globalThis);
