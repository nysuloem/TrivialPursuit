function createAudioCtx() {
  try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
}

function playTone(ctx, freq, startTime, duration, type = 'sine', gainVal = 0.3) {
  if (!ctx) return;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(gainVal, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playCorrect(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Rising three-note ding with extra punch
  playTone(ctx, 523, t,        0.15, 'triangle', 0.45);
  playTone(ctx, 784, t + 0.13, 0.18, 'triangle', 0.42);
  playTone(ctx, 1047,t + 0.26, 0.22, 'sine',     0.38);
  playTone(ctx, 1318,t + 0.38, 0.35, 'sine',     0.30);
  // Harmonic chord underneath
  [523, 659, 784].forEach(f => playTone(ctx, f, t + 0.26, 0.4, 'sine', 0.12));
  // Bright shimmer on top
  playTone(ctx, 2093, t + 0.38, 0.2, 'sine', 0.10);
}

function playDiceRoll(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 6; i++) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    src.buffer = buf;
    filt.type = 'highpass';
    filt.frequency.value = 800;
    src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, t + i * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.05);
    src.start(t + i * 0.08);
    src.stop(t + i * 0.08 + 0.06);
  }
}

function playIncorrect(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  [392,330,262,196].forEach((frequency,i) => playTone(ctx, frequency, t+i*.16, .3, 'triangle', .28));
  playTone(ctx, 131, t+.4, .45, 'sine', .16);
}

function playWedgeWon(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  [261, 329, 392, 523, 659, 784, 1047].forEach((f, i) =>
    playTone(ctx, f, t + i * 0.08, 0.18, 'triangle', 0.2)
  );
  [523, 659, 784, 1047].forEach(f =>
    playTone(ctx, f, t + 0.62, 1.5, 'sine', 0.16)
  );
  [0, 0.18, 0.36, 0.54].forEach(offset =>
    playTone(ctx, 880, t + 0.65 + offset, 0.1, 'square', 0.1)
  );
  // Extra high shimmer
  [1318, 1568, 2093].forEach((f, i) =>
    playTone(ctx, f, t + 0.8 + i * 0.12, 0.3, 'sine', 0.08)
  );
}


export {playWedgeWon,createAudioCtx, playCorrect, playIncorrect, playDiceRoll};
