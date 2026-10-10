// Feeds a WebCodecs H.264 encoder's output into mp4-muxer without relying on the encoder's metadata.
// The MP4 needs the stream's parameter sets (SPS and PPS) as an avcC record. Some encoders (Firefox's hardware
// ones among them) send no decoderConfig, or one without a description; then the record is built from the
// parameter sets inside the keyframes. Chunks may come length-prefixed ('avc') or with start codes ('annexb');
// the MP4 always gets them length-prefixed.
(function (root) {
  // the NAL units of a chunk, in either framing
  function splitNals(d) {
    // length-prefixed if the lengths tile the whole chunk exactly (a start code can look like a length, not the reverse)
    const out = [];
    let i = 0;
    while (i + 4 <= d.length) {
      const n = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
      if (!n || i + 4 + n > d.length) break;
      out.push(d.subarray(i + 4, i + 4 + n)); i += 4 + n;
    }
    return i === d.length && out.length ? out : splitStartCodes(d);
  }
  function splitStartCodes(d) {
    const out = [], starts = [];
    for (let i = 0; i + 2 < d.length; i++) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) { starts.push(i + 3); i += 2; }
    for (let k = 0; k < starts.length; k++) {
      let end = k + 1 < starts.length ? starts[k + 1] - 3 : d.length;
      while (end > starts[k] && d[end - 1] === 0) end--; // the zero byte of a four-byte start code, or trailing zeros
      if (end > starts[k]) out.push(d.subarray(starts[k], end));
    }
    return out;
  }
  function lengthPrefixed(nals) {
    let n = 0; for (const u of nals) n += 4 + u.length;
    const out = new Uint8Array(n); let o = 0;
    for (const u of nals) { out[o] = u.length >>> 24; out[o + 1] = (u.length >> 16) & 255; out[o + 2] = (u.length >> 8) & 255; out[o + 3] = u.length & 255; out.set(u, o + 4); o += 4 + u.length; }
    return out;
  }

  // chroma format and bit depths from an SPS (needed in avcC for the High profiles)
  function spsFormat(sps) {
    const b = [];
    for (let i = 1; i < sps.length; i++) { if (i >= 3 && sps[i] === 3 && sps[i - 1] === 0 && sps[i - 2] === 0) continue; b.push(sps[i]); } // drop emulation prevention
    let pos = 24; // after profile, constraints and level
    const bit = () => { const v = (b[pos >> 3] >> (7 - (pos & 7))) & 1; pos++; return v; };
    const ue = () => { let z = 0; while (pos < b.length * 8 && !bit()) z++; let v = 0; for (let k = 0; k < z; k++) v = v * 2 + bit(); return v + (1 << z) - 1; };
    ue(); // seq_parameter_set_id
    const profile = sps[1];
    if (![100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) return { chroma: 1, luma: 0, chromaDepth: 0, high: false };
    const chroma = ue(); if (chroma === 3) bit();
    return { chroma, luma: ue(), chromaDepth: ue(), high: true };
  }
  function avcC(sps, pps) {
    const f = spsFormat(sps), ext = f.high ? [0xfc | f.chroma, 0xf8 | f.luma, 0xf8 | f.chromaDepth, 0] : [];
    return new Uint8Array([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps, ...ext]);
  }

  // cfg: the encoder configuration; returns { output(chunk, meta), needsAnnexB, chunks }
  function writer(muxer, cfg, width, height) {
    // Firefox leaves chunk.duration null, and the muxer needs a number (it uses the timestamps between frames anyway)
    let config = null;
    const frameUs = Math.round(1e6 / (cfg.framerate || 60));
    const w = {
      chunks: 0, needsAnnexB: false,
      output(chunk, meta) {
        const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
        const nals = splitNals(d);
        if (!config) {
          // the file has to start on a keyframe that comes with the stream's settings
          if (chunk.type !== 'key') return;
          const given = meta?.decoderConfig?.description;
          let desc = given ? new Uint8Array(ArrayBuffer.isView(given) ? given.buffer.slice(given.byteOffset, given.byteOffset + given.byteLength) : given.slice(0)) : null;
          if (!desc) {
            const sps = nals.find(u => (u[0] & 31) === 7), pps = nals.find(u => (u[0] & 31) === 8);
            if (sps && pps) desc = avcC(sps, pps);
          }
          if (!desc) { w.needsAnnexB = true; return; } // ask for start-code framing, which carries them in each keyframe
          config = { codec: meta?.decoderConfig?.codec || cfg.codec, codedWidth: width, codedHeight: height, description: desc };
          if (meta?.decoderConfig?.colorSpace) config.colorSpace = meta.decoderConfig.colorSpace;
          muxer.addVideoChunkRaw(lengthPrefixed(nals), chunk.type, chunk.timestamp, chunk.duration ?? frameUs, { decoderConfig: config });
        } else muxer.addVideoChunkRaw(lengthPrefixed(nals), chunk.type, chunk.timestamp, chunk.duration ?? frameUs);
        w.chunks++;
      },
    };
    return w;
  }

  root.Mp4Write = { writer, splitNals, avcC };
})(typeof window !== 'undefined' ? window : globalThis);
