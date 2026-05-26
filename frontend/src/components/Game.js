import React, { useState, useEffect, useCallback, useRef } from 'react';
import PieDisplay, { CATEGORIES, CAT_COLORS, CAT_EMOJI } from './PieDisplay';
import { getCategories, getAllCategories, getCategoryCounts, getQuestion, markAnswered, getBankCount } from '../api';

// ─── SOUND ENGINE (Web Audio API — no files needed) ────────────────────────
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

// 🥧 Pie unlocked — dramatic ascending sting (4 notes + cymbal swell)
function playPieSting(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [330, 415, 523, 698];
  notes.forEach((f, i) => playTone(ctx, f, t + i * 0.13, 0.25, 'sawtooth', 0.18));
  // Final big chord
  [523, 659, 784].forEach(f => playTone(ctx, f, t + 0.58, 0.7, 'triangle', 0.15));
  // Noise swell
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.06;
  const src  = ctx.createBufferSource();
  const filt = ctx.createBiquadFilter();
  const g    = ctx.createGain();
  src.buffer = buf;
  filt.type  = 'bandpass';
  filt.frequency.value = 6000;
  src.connect(filt); filt.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0, t + 0.55);
  g.gain.linearRampToValueAtTime(0.15, t + 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  src.start(t + 0.55);
}

// 🏆 Wedge won — BIG celebratory fanfare
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

// 🎊 Game winner — epic full fanfare
function playGameWon(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Full ascending scale twice
  [261, 329, 392, 523, 659, 784, 1047, 1318].forEach((f, i) =>
    playTone(ctx, f, t + i * 0.07, 0.2, 'triangle', 0.22)
  );
  // Big chord
  [523, 659, 784, 1047, 1318].forEach(f =>
    playTone(ctx, f, t + 0.62, 2.5, 'sine', 0.15)
  );
  // Rhythm pattern
  [0, 0.15, 0.3, 0.5, 0.65, 0.8].forEach(offset =>
    playTone(ctx, 1047, t + 0.7 + offset, 0.1, 'square', 0.09)
  );
  // Cymbal crashes
  for (let crash = 0; crash < 3; crash++) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.15));
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.2, t + crash * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + crash * 0.5 + 0.4);
    src.start(t + crash * 0.5);
  }
}

// 🕵️ Steal opportunity — tense suspense sting
function playStealSting(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Low dramatic pulses
  [0, 0.22, 0.44].forEach(offset =>
    playTone(ctx, 110, t + offset, 0.18, 'sawtooth', 0.25)
  );
  // Rising tension note
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t + 0.55);
  osc.frequency.linearRampToValueAtTime(440, t + 1.1);
  gain.gain.setValueAtTime(0.18, t + 0.55);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  osc.start(t + 0.55); osc.stop(t + 1.2);
}

// 🎉 Correct answer — dramatic upbeat fanfare
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

// 🔊 OpenAI TTS — plays question audio via backend
const OPENAI_VOICES = ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer'];
const VOICE_LABELS  = {
  nova:    'Nova (friendly female)',
  alloy:   'Alloy (neutral)',
  echo:    'Echo (warm male)',
  fable:   'Fable (British)',
  onyx:    'Onyx (deep male)',
  shimmer: 'Shimmer (soft female)',
};

// Voices for each team — opposite gender reads to you
const TEAM_VOICES = [
  ['nova', 'shimmer', 'fable'],   // Boys' turn → female voices read
  ['onyx', 'echo', 'alloy'],      // Girls' turn → male voices read
];
const voiceIndexRef = [0, 0]; // tracks rotation within each team's voice list

let currentAudio = null;

async function playTTS(text, voice = 'nova', onStart, onEnd, onError) {
  try {
    // Stop any current audio
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }

    const BASE = process.env.REACT_APP_API_URL || '';
    const response = await fetch(`${BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });

    if (!response.ok) throw new Error('TTS request failed');

    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    audio.onplay  = onStart;
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; onEnd?.(); };
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; onError?.(); };

    await audio.play();
  } catch (err) {
    console.error('TTS failed:', err);
    onError?.();
  }
}

function stopTTS() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function stopSpeaking() { stopTTS(); }

// ✗ Wrong answer / team switch — 4 descending tones
function playSwish(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const freqs = [349, 294, 247, 196]; // descending: F4 → D4 → B3 → G3
  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t + i * 0.13);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, t + i * 0.13 + 0.12);
    gain.gain.setValueAtTime(0.0, t + i * 0.13);
    gain.gain.linearRampToValueAtTime(0.16, t + i * 0.13 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.14);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t + i * 0.13);
    osc.stop(t + i * 0.13 + 0.15);
  });
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const STREAK_NEEDED = 2;
const TEAMS = [
  { label: 'Boys',  emoji: '👦', color: '#3b82f6' },
  { label: 'Girls', emoji: '👧', color: '#ec4899' },
];

const S = {
  INTRO:            'intro',          // opening splash screen
  DICE_ROLL:        'dice_roll',
  LUCKY_PIE:        'lucky_pie',      // dramatic lucky pie announcement
  STEAL_CELEBRATE:  'steal_celebrate',// steal success celebration
  STEAL_PICK:       'steal_pick',     // pick which wedge to take from opponent     // who goes first screen
  CHOOSING:         'choosing',
  CAT_SPLASH:       'cat_splash',
  QUESTION:         'question',
  PIE_INTRO:        'pie_intro',
  PIE:              'pie',
  PIE_WIN:          'pie_win',
  STEAL:            'steal',
  FINAL_PICK:       'final_pick',
  FINAL:            'final',
  WINNER:           'winner',
};

// Short display names removed — use full names everywhere

// ─── STEAL CELEBRATION ───────────────────────────────────────────────────
function StealCelebration({ team, category, onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 200);
    const t2 = setTimeout(() => setStep(2), 800);
    const t3 = setTimeout(() => onDone(), 2800);
    return () => [t1,t2,t3].forEach(clearTimeout);
  }, [onDone]);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:999,
      background: `radial-gradient(ellipse at center, ${team.color}22 0%, #0a0a0a 70%)`,
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:16,
    }}>
      <style>{`
        @keyframes stealSlam   { 0%{transform:scale(3) rotate(15deg);opacity:0} 60%{transform:scale(0.9) rotate(-3deg)} 100%{transform:scale(1) rotate(0deg);opacity:1} }
        @keyframes stealShake  { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
        @keyframes stealGlow   { 0%,100%{text-shadow:0 0 20px currentColor} 50%{text-shadow:0 0 60px currentColor, 0 0 100px currentColor} }
        @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(100vh) rotate(720deg);opacity:0} }
      `}</style>

      {/* Confetti */}
      {step >= 1 && ['🔴','🟡','🟢','🔵','🟠','🟣'].map((dot, i) => (
        <div key={i} style={{
          position:'absolute',
          left: `${15 + i * 14}%`,
          top: '-20px',
          fontSize: 16,
          animation: `confettiFall ${1.5 + i * 0.2}s ${i * 0.1}s ease-in forwards`,
        }}>{dot}</div>
      ))}

      {step >= 1 && (
        <div style={{
          fontSize: 72,
          animation: 'stealSlam 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards',
          filter: `drop-shadow(0 0 20px ${team.color})`,
        }}>🕵️</div>
      )}

      {step >= 2 && (
        <>
          <div style={{
            fontSize: 'clamp(32px,7vw,52px)', fontWeight: 900,
            color: team.color, fontFamily: 'Georgia,serif',
            animation: 'stealGlow 0.8s ease infinite, stealShake 0.4s ease',
            textAlign: 'center',
          }}>
            STOLEN! 🎉
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: team.color, fontFamily: 'monospace', letterSpacing: 2 }}>
              {team.emoji} {team.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', marginTop: 4 }}>
              {CAT_EMOJI[category]} {category} WEDGE STOLEN!
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── LUCKY PIE ANNOUNCEMENT ──────────────────────────────────────────────
function LuckyPieAnnounce({ team, category, onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 400);
    const t2 = setTimeout(() => setStep(2), 1000);
    const t3 = setTimeout(() => setStep(3), 1800);
    const t4 = setTimeout(() => onDone(), 3200);
    return () => [t1,t2,t3,t4].forEach(clearTimeout);
  }, [onDone]);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:999,
      background:'#0a0a0a',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      gap:20,
    }}>
      <style>{`
        @keyframes luckyBounce { 0%{transform:scale(0) rotate(-20deg);opacity:0} 60%{transform:scale(1.3) rotate(5deg)} 100%{transform:scale(1) rotate(0deg);opacity:1} }
        @keyframes luckyGlow   { 0%,100%{text-shadow:0 0 30px #fbbf24,0 0 60px #fbbf24} 50%{text-shadow:0 0 60px #fbbf24,0 0 120px #fbbf24,0 0 180px #fbbf24} }
        @keyframes starSpin    { 0%{transform:rotate(0deg) scale(0);opacity:0} 100%{transform:rotate(360deg) scale(1);opacity:1} }
        @keyframes slideUp     { 0%{transform:translateY(30px);opacity:0} 100%{transform:translateY(0);opacity:1} }
      `}</style>

      {/* Stars */}
      {step >= 1 && (
        <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
          {['10%','20%','80%','90%','50%','30%','70%'].map((left, i) => (
            <div key={i} style={{
              position:'absolute', left, top: `${10 + i*12}%`,
              fontSize:20, animation:`starSpin 0.6s ${i*0.1}s ease both`,
            }}>⭐</div>
          ))}
        </div>
      )}

      {step >= 1 && (
        <div style={{
          fontSize:80,
          animation:'luckyBounce 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards',
          filter:'drop-shadow(0 0 30px #fbbf24)',
        }}>🥧</div>
      )}

      {step >= 2 && (
        <div style={{
          fontSize:'clamp(28px,6vw,42px)', fontWeight:900, color:'#fbbf24',
          fontFamily:'Georgia,serif', textAlign:'center',
          animation:'luckyGlow 1s ease infinite, slideUp 0.4s ease forwards',
        }}>
          🎲 LUCKY PIE!
        </div>
      )}

      {step >= 3 && (
        <div style={{
          textAlign:'center', animation:'slideUp 0.4s ease forwards',
        }}>
          <div style={{ fontSize:16, color: CAT_COLORS[category], fontFamily:'monospace', letterSpacing:2 }}>
            {CAT_EMOJI[category]} {category}
          </div>
          <div style={{ fontSize:13, color:'#555', fontFamily:'monospace', marginTop:6 }}>
            {team.emoji} {team.label.toUpperCase()} — YOUR LUCKY SHOT!
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OPENING SCENE ────────────────────────────────────────────────────────────────────────────
function IntroScene({ onDone }) {
  const [phase, setPhase] = React.useState('tap'); // tap → playing → ready
  const videoRef = React.useRef(null);

  const handleTap = React.useCallback(() => {
    if (phase !== 'tap') return;
    setPhase('playing');
    const v = videoRef.current;
    if (v) {
      v.play().catch(() => setPhase('ready'));
    }
  }, [phase]);

  const handleEnded = React.useCallback(() => {
    setPhase('ready');
  }, []);

  return (
    <div
      onClick={phase === 'tap' ? handleTap : undefined}
      style={{
        minHeight: '100vh', background: '#000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
        cursor: phase === 'tap' ? 'pointer' : 'default',
      }}
    >
      <style>{\`
        @keyframes tapPulse  { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes playPulse { 0%,100%{transform:scale(1);box-shadow:0 0 20px #fbbf2444} 50%{transform:scale(1.04);box-shadow:0 0 40px #fbbf2488} }
        @keyframes fadeIn    { 0%{opacity:0;transform:translateY(16px)} 100%{opacity:1;transform:translateY(0)} }
      \`}</style>

      {/* Video */}
      <video
        ref={videoRef}
        src="/intro.mp4"
        onEnded={handleEnded}
        playsInline
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          opacity: phase === 'playing' ? 1 : 0,
          transition: 'opacity 0.4s ease',
          pointerEvents: 'none',
        }}
      />

      {/* TAP TO START */}
      {phase === 'tap' && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 24, zIndex: 10,
        }}>
          <div style={{
            fontSize: 'clamp(32px,7vw,52px)', fontWeight: 900,
            color: '#fff', letterSpacing: -1, fontFamily: 'Georgia,serif',
          }}>TRIVIAL PURSUIT</div>
          <div style={{
            fontSize: 14, color: '#fbbf24', fontFamily: 'monospace',
            letterSpacing: 4, animation: 'tapPulse 1.5s ease infinite',
          }}>► TAP TO START</div>
        </div>
      )}

      {/* START GAME button after video ends */}
      {phase === 'ready' && (
        <div style={{
          zIndex: 10, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 16,
          animation: 'fadeIn 0.6s ease forwards',
        }}>
          <button
            onClick={onDone}
            style={{
              padding: '16px 56px', borderRadius: 12, cursor: 'pointer',
              fontSize: 18, fontFamily: 'monospace', letterSpacing: 4, fontWeight: 900,
              border: '2px solid #fbbf24', background: '#fbbf2415', color: '#fbbf24',
              animation: 'playPulse 1.5s ease infinite',
            }}
          >► START GAME</button>
        </div>
      )}
    </div>
  );
}

function PieIntro({ category, teamIdx, onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 600),
      setTimeout(() => setStep(2), 1800),
      setTimeout(onDone, 3000), // slightly longer so TTS starts after animation
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const color = CAT_COLORS[category];
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 20, zIndex: 100,
      animation: 'fadeIn 0.3s ease',
    }}>
      <style>{`
        @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes popIn   { from { transform:scale(0.4); opacity:0 } to { transform:scale(1); opacity:1 } }
        @keyframes glow    { 0%,100% { text-shadow: 0 0 20px ${color} } 50% { text-shadow: 0 0 60px ${color}, 0 0 100px ${color} } }
        @keyframes slideUp { from { transform:translateY(20px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      `}</style>

      {/* Spinning pie wedge */}
      <div style={{
        animation: step >= 0 ? 'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' : 'none',
        opacity: 0,
      }}>
        <PieWedge color={color} emoji={CAT_EMOJI[category]} />
      </div>

      {/* Category name */}
      {step >= 1 && (
        <div style={{
          animation: 'slideUp 0.4s ease forwards',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, letterSpacing: 6, color: color, fontFamily: 'monospace', marginBottom: 6 }}>
            PIE QUESTION
          </div>
          <div style={{
            fontSize: 'clamp(22px,5vw,36px)', color: '#fff', fontWeight: 900,
            animation: 'glow 1.5s ease infinite',
          }}>
            {CAT_EMOJI[category]} {category}
          </div>
        </div>
      )}

      {/* Team label */}
      {step >= 2 && (
        <div style={{
          animation: 'slideUp 0.3s ease forwards',
          fontSize: 13, color: TEAMS[teamIdx].color, fontFamily: 'monospace', letterSpacing: 3,
        }}>
          {TEAMS[teamIdx].emoji} {TEAMS[teamIdx].label.toUpperCase()} — ANSWER FOR THE WEDGE!
        </div>
      )}
    </div>
  );
}

// ─── PIE WIN CELEBRATION ───────────────────────────────────────────────────
const pieWinStyles = ['fireworks', 'confetti', 'wedge'];
let pieWinStyleIndex = 0;

function PieWinCelebration({ category, teamIdx, onDone }) {
  const style = pieWinStyles[pieWinStyleIndex % 3];
  pieWinStyleIndex++;
  const color = CAT_COLORS[category];
  const team  = TEAMS[teamIdx];

  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  // Generate confetti particles
  const confetti = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 1.5,
    dur: 1.5 + Math.random(),
    color: ['#fbbf24','#ef4444','#3b82f6','#22c55e','#ec4899','#a855f7'][i % 6],
    size: 6 + Math.random() * 10,
    rot: Math.random() * 360,
  }));

  // Fireworks particles
  const sparks = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    angle: (i / 40) * 360,
    dist: 80 + Math.random() * 120,
    color: ['#fbbf24','#fff','#ef4444','#3b82f6','#22c55e','#ec4899'][i % 6],
    delay: Math.random() * 0.5,
  }));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.93)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', zIndex: 200, overflow: 'hidden',
    }}>
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes sparkFly {
          0%   { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
        }
        @keyframes wedgeSpin {
          0%   { transform: scale(0.2) rotate(-180deg); opacity: 0; }
          60%  { transform: scale(1.3) rotate(10deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes celebPulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.06); }
        }
        @keyframes titleBounce {
          0%   { transform: translateY(-40px); opacity: 0; }
          60%  { transform: translateY(8px); }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* CONFETTI style */}
      {style === 'confetti' && confetti.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: `${p.x}%`,
          top: '-20px',
          width: p.size,
          height: p.size * 0.4,
          background: p.color,
          borderRadius: 2,
          animation: `confettiFall ${p.dur}s ${p.delay}s ease-in both`,
          transform: `rotate(${p.rot}deg)`,
        }} />
      ))}

      {/* FIREWORKS style */}
      {style === 'fireworks' && [
        { cx: '30%', cy: '30%' },
        { cx: '70%', cy: '25%' },
        { cx: '50%', cy: '40%' },
      ].map((pos, bi) =>
        sparks.slice(bi * 13, bi * 13 + 13).map(p => {
          const rad = (p.angle * Math.PI) / 180;
          return (
            <div key={`${bi}-${p.id}`} style={{
              position: 'absolute',
              left: pos.cx, top: pos.cy,
              width: 6, height: 6,
              borderRadius: '50%',
              background: p.color,
              '--dx': `${Math.cos(rad) * p.dist}px`,
              '--dy': `${Math.sin(rad) * p.dist}px`,
              animation: `sparkFly 0.8s ${p.delay + bi * 0.3}s ease-out both`,
            }} />
          );
        })
      )}

      {/* WEDGE ZOOM style */}
      {style === 'wedge' && (
        <div style={{ animation: 'wedgeSpin 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards', marginBottom: 20 }}>
          <PieWedge color={color} emoji={CAT_EMOJI[category]} size={220} />
        </div>
      )}

      {/* Central message — all styles */}
      <div style={{
        textAlign: 'center', zIndex: 10,
        animation: 'titleBounce 0.6s 0.3s ease both',
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
        <div style={{
          fontSize: 'clamp(28px,6vw,52px)', fontWeight: 900, color: team.color,
          animation: 'celebPulse 0.8s ease infinite',
          textShadow: `0 0 40px ${team.color}`,
        }}>
          {team.emoji} {team.label.toUpperCase()}
        </div>
        <div style={{ fontSize: 20, color: color, fontFamily: 'monospace', letterSpacing: 3, marginTop: 8 }}>
          WINS THE {CAT_EMOJI[category]} {category.toUpperCase()} WEDGE!
        </div>
        <div style={{ fontSize: 13, color: '#444', fontFamily: 'monospace', marginTop: 16 }}>
          continuing in 3 seconds...
        </div>
      </div>
    </div>
  );
}
// 🎲 Dice roll sound — rattling tumble
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

// 🎲 Dice faces
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];

// ─── DICE ROLL COMPONENT ────────────────────────────────────────────────────
function DiceRoll({ onDone }) {
  const [rolls, setRolls]     = useState([null, null]); // [boys, girls]
  const [rolling, setRolling] = useState(false);
  const [winner, setWinner]   = useState(null); // 0=boys, 1=girls, 'tie'
  const [phase, setPhase]     = useState('idle'); // idle, rolling, result

  const doRoll = useCallback(() => {
    setRolling(true);
    setPhase('rolling');
    setWinner(null);
    setRolls([null, null]);

    // Play dice sound
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      playDiceRoll(ctx);
    } catch(e) {}

    // Animate dice for 1.5s showing random faces
    let ticks = 0;
    const interval = setInterval(() => {
      setRolls([
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
      ]);
      ticks++;
      if (ticks > 14) {
        clearInterval(interval);
        // Final roll
        const b = Math.floor(Math.random() * 6);
        const g = Math.floor(Math.random() * 6);
        setRolls([b, g]);
        setRolling(false);
        setPhase('result');
        if (b > g)       setWinner(0);
        else if (g > b)  setWinner(1);
        else             setWinner('tie');
      }
    }, 80);
  }, []);

  const handleContinue = useCallback(() => {
    if (winner === 'tie') {
      doRoll();
    } else {
      onDone(winner);
    }
  }, [winner, onDone, doRoll]);

  return (
    <div style={{
      minHeight:'100vh', background:'#0a0a0a',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      gap:32, padding:24, fontFamily:'Georgia,serif',
    }}>
      <style>{`
        @keyframes diceRoll { 0%{transform:rotate(0deg) scale(1)} 25%{transform:rotate(-15deg) scale(1.1)} 75%{transform:rotate(15deg) scale(1.1)} 100%{transform:rotate(0deg) scale(1)} }
        @keyframes dieLand  { 0%{transform:scale(1.3)} 60%{transform:scale(0.95)} 100%{transform:scale(1)} }
        @keyframes winGlow  { 0%,100%{text-shadow:0 0 20px currentColor} 50%{text-shadow:0 0 60px currentColor} }
      `}</style>

      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:13, letterSpacing:6, color:'#444', fontFamily:'monospace', marginBottom:8 }}>WHO GOES FIRST?</div>
        <div style={{ fontSize:'clamp(28px,6vw,44px)', fontWeight:900, color:'#fff' }}>ROLL THE DICE</div>
      </div>

      {/* Dice display */}
      <div style={{ display:'flex', gap:48, alignItems:'center' }}>
        {TEAMS.map((team, i) => (
          <div key={i} style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:14, color:team.color, fontFamily:'monospace', letterSpacing:2 }}>
              {team.emoji} {team.label.toUpperCase()}
            </div>
            <div style={{
              fontSize:96,
              color: winner === i ? team.color : winner !== null && winner !== 'tie' ? '#222' : '#fff',
              animation: rolling
                ? 'diceRoll 0.16s ease infinite'
                : phase === 'result' && rolls[i] !== null
                ? 'dieLand 0.3s ease forwards'
                : 'none',
              filter: winner === i ? `drop-shadow(0 0 20px ${team.color})` : 'none',
              transition: 'color 0.3s',
            }}>
              {rolls[i] !== null ? DICE_FACES[rolls[i]] : '⬜'}
            </div>
            {phase === 'result' && rolls[i] !== null && (
              <div style={{
                fontSize:22, fontWeight:900,
                color: winner === i ? team.color : '#333',
                fontFamily:'monospace',
              }}>
                {rolls[i] + 1}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Result message */}
      {phase === 'result' && (
        <div style={{ textAlign:'center', animation:'winGlow 1s ease infinite' }}>
          {winner === 'tie' ? (
            <div style={{ color:'#fbbf24', fontSize:20, fontWeight:700 }}>🤝 TIE! ROLL AGAIN!</div>
          ) : (
            <div style={{ color:TEAMS[winner].color, fontSize:24, fontWeight:900 }}>
              {TEAMS[winner].emoji} {TEAMS[winner].label.toUpperCase()} GOES FIRST!
            </div>
          )}
        </div>
      )}

      {/* Button */}
      {phase === 'idle' && (
        <button onClick={doRoll} style={{
          padding:'16px 48px', borderRadius:12, cursor:'pointer',
          fontSize:16, fontFamily:'monospace', letterSpacing:3, fontWeight:700,
          border:'2px solid #fbbf24', background:'#fbbf2415', color:'#fbbf24',
        }}>🎲 ROLL DICE</button>
      )}
      {phase === 'rolling' && (
        <div style={{ color:'#444', fontFamily:'monospace', fontSize:13, letterSpacing:2 }}>ROLLING...</div>
      )}
      {phase === 'result' && (
        <button onClick={handleContinue} style={{
          padding:'16px 48px', borderRadius:12, cursor:'pointer',
          fontSize:16, fontFamily:'monospace', letterSpacing:3, fontWeight:700,
          border:`2px solid ${winner === 'tie' ? '#fbbf24' : TEAMS[winner]?.color || '#fff'}`,
          background: winner === 'tie' ? '#fbbf2415' : `${TEAMS[winner]?.color}15`,
          color: winner === 'tie' ? '#fbbf24' : TEAMS[winner]?.color || '#fff',
        }}>
          {winner === 'tie' ? '🎲 ROLL AGAIN' : '▶ START GAME'}
        </button>
      )}
    </div>
  );
}

// ─── CATEGORY SPLASH ──────────────────────────────────────────────────────
function CategorySplash({ category, teamIdx, onReady }) {
  const color = CAT_COLORS[category];
  const team  = TEAMS[teamIdx];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 150);
    const t2 = setTimeout(() => setStep(2), 600);
    // Minimum display of 1s, then signal ready — parent will call onReady when audio is fetched
    const t3 = setTimeout(onReady, 3500); // fallback max
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, [onReady]);

  return (
    <div style={{
      width:'100%', maxWidth:540,
      borderRadius:12, overflow:'hidden',
      border:`2px solid ${color}55`,
      background:`${color}10`,
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      padding:'32px 20px', gap:10, minHeight:160,
    }}>
      <style>{`
        @keyframes splashEmoji { 0%{transform:scale(0.4) rotate(-10deg);opacity:0} 70%{transform:scale(1.15) rotate(3deg)} 100%{transform:scale(1) rotate(0deg);opacity:1} }
        @keyframes splashTitle { 0%{transform:translateY(12px);opacity:0} 100%{transform:translateY(0);opacity:1} }
        @keyframes splashTeam  { 0%{opacity:0} 100%{opacity:1} }
      `}</style>

      <div style={{
        fontSize:64, opacity:0,
        filter:`drop-shadow(0 0 16px ${color}88)`,
        animation:'splashEmoji 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards',
      }}>
        {CAT_EMOJI[category]}
      </div>

      {step >= 1 && (
        <div style={{
          fontSize:22, fontWeight:900, color,
          textAlign:'center', animation:'splashTitle 0.3s ease forwards',
        }}>
          {category}
        </div>
      )}

      {step >= 2 && (
        <div style={{
          fontSize:11, color:team.color, fontFamily:'monospace', letterSpacing:2,
          animation:'splashTeam 0.3s ease forwards',
        }}>
          {team.emoji} {team.label.toUpperCase()}'S QUESTION
        </div>
      )}
    </div>
  );
}

function PieWedge({ color, emoji, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const startAngle = -Math.PI / 2;
  const endAngle   = startAngle + (Math.PI * 2) / 6; // one of six slices
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const mid = (startAngle + endAngle) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={r + 6} fill="#111" />
      <path
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
        fill={color}
        filter="url(#glow)"
        stroke="#0a0a0a" strokeWidth="2"
      />
      <text x={cx + r * 0.58 * Math.cos(mid)} y={cy + r * 0.58 * Math.sin(mid)}
        textAnchor="middle" dominantBaseline="middle" fontSize="28">{emoji}</text>
    </svg>
  );
}

// ─── STEAL SCREEN ──────────────────────────────────────────────────────────
function StealScreen({ stealingTeamIdx, category, question, onCorrect, onWrong }) {
  const [revealed, setRevealed] = useState(false);
  const color  = CAT_COLORS[category];
  const team   = TEAMS[stealingTeamIdx];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 20, zIndex: 100, gap: 16,
    }}>
      <style>{`
        @keyframes stealPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🕵️</div>
        <div style={{ fontSize: 11, letterSpacing: 6, color: '#f97316', fontFamily: 'monospace', marginBottom: 4 }}>
          STEAL OPPORTUNITY
        </div>
        <div style={{
          fontSize: 'clamp(20px,4vw,30px)', color: team.color, fontWeight: 900,
          animation: 'stealPulse 1.2s ease infinite',
        }}>
          {team.emoji} {team.label.toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', marginTop: 4 }}>
          Answer correctly to steal the wedge + get a bonus turn!
        </div>
      </div>

      {/* Question card */}
      <div style={{
        width: '100%', maxWidth: 520,
        background: '#111',
        border: `2px solid ${color}55`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10, padding: '18px 16px',
      }}>
        <div style={{ fontSize: 9, color: '#f97316', fontFamily: 'monospace', letterSpacing: 2, marginBottom: 12 }}>
          🥧 {category.toUpperCase()} — SAME QUESTION
        </div>
        <div style={{ fontSize: 'clamp(13px,2.4vw,16px)', color: '#fffbeb', lineHeight: 1.7, marginBottom: 14 }}>
          {question.question}
        </div>

        <div onClick={() => !revealed && setRevealed(true)} style={{
          borderRadius: 7, padding: '11px 14px', marginBottom: 12, minHeight: 40,
          background: revealed ? '#161616' : '#090909',
          border: `1px solid ${revealed ? color + '33' : '#161616'}`,
          cursor: revealed ? 'default' : 'pointer',
        }}>
          {revealed
            ? <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{question.answer}</div>
            : <div style={{ color: '#1c1c1c', fontSize: 10, fontFamily: 'monospace', letterSpacing: 3 }}>▸ TAP TO REVEAL</div>
          }
        </div>

        {!revealed ? (
          <button onClick={() => setRevealed(true)} style={{
            width: '100%', padding: '10px', borderRadius: 7, cursor: 'pointer',
            border: `1px solid ${color}44`, background: `${color}0d`,
            color: color, fontSize: 11, fontFamily: 'monospace', letterSpacing: 2,
          }}>REVEAL ANSWER</button>
        ) : (
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={onCorrect} style={{
              flex: 1, padding: '10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
              border: '1px solid #14532d', background: 'rgba(34,197,94,0.07)', color: '#4ade80',
            }}>✓ CORRECT · STEAL WEDGE + BONUS TURN</button>
            <button onClick={onWrong} style={{
              flex: 1, padding: '10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
              border: '1px solid #7f1d1d', background: 'rgba(239,68,68,0.07)', color: '#f87171',
            }}>✗ WRONG · NO STEAL</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN GAME ─────────────────────────────────────────────────────────────
export default function Game() {
  const audioCtxRef    = useRef(null);
  const pendingAudioRef = useRef(null);
  const activeTeamRef   = useRef(0); // always current, never stale

  // Lazily init audio context on first user interaction
  const getAudio = () => {
    if (!audioCtxRef.current) audioCtxRef.current = createAudioCtx();
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const [state,      setState]      = useState(S.INTRO);
  const [active,     setActive]     = useState(0); // will be set by dice roll
  const [scores,     setScores]     = useState([0, 0]);
  const [wedges,     setWedges]     = useState([[], []]);
  const [streak,     setStreak]     = useState([{}, {}]);
  const [catOptions, setCatOptions] = useState([]);
  const [allCats,    setAllCats]    = useState(CATEGORIES);
  const [chosenCat,  setChosenCat]  = useState(null);
  const [question,   setQuestion]   = useState(null);
  const [revealed,   setRevealed]   = useState(false);
  const [bankCount,      setBankCount]      = useState(null);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [questionsUsed,  setQuestionsUsed]  = useState(() =>
    Object.fromEntries(CATEGORIES.map(c => [c, 0]))
  );
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [flash,      setFlash]      = useState(null);
  const [winner,     setWinner]     = useState(null);
  const [pieWinCat,     setPieWinCat]     = useState(null);
  const [speaking,      setSpeaking]      = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('auto'); // auto = rotate by team
  const [finalTeam,     setFinalTeam]     = useState(null);
  const [finalUsedCats, setFinalUsedCats] = useState([]);

  // Keep ref in sync so voice selection never uses stale closure
  useEffect(() => { activeTeamRef.current = active; }, [active]);

  useEffect(() => {
    const fetchCounts = () => {
      getBankCount().then(d => setBankCount(d.count)).catch(() => {});
      getCategoryCounts().then(d => setCategoryCounts(d.counts || {})).catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadCategoryOptions = useCallback(async (activeTeam, currentWedges, checkFinal = true) => {
    setLoading(true); setError(null);
    try {
      // If this team is in final mode, go straight to FINAL_PICK
      if (checkFinal && finalTeam !== null && finalTeam === activeTeam) {
        setState(S.FINAL_PICK);
        setLoading(false);
        return;
      }
      const owned = currentWedges ? currentWedges[activeTeam ?? 0] : [];
      const data = await getCategories(owned);
      setCatOptions(data.categories);
      setState(S.CHOOSING);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [finalTeam]);

  useEffect(() => {
    if (state === S.CHOOSING && catOptions.length === 0) {
      loadCategoryOptions(active, wedges);
    }
  }, []); // eslint-disable-line

  // Called when dice roll determines who goes first
  const handleDiceRollDone = useCallback((winnerIdx) => {
    setActive(winnerIdx);
    loadCategoryOptions(winnerIdx, [[], []]);
  }, [loadCategoryOptions]);

  // Speak helper — auto-selects voice based on active team, rotates through voices
  const speak = useCallback((text, teamIdx) => {
    if (!text) return;
    setSpeaking(true);

    // Use passed teamIdx, or fall back to ref (never stale), never use active state directly
    let voice = selectedVoice;
    if (!selectedVoice || selectedVoice === 'auto') {
      const team = teamIdx !== undefined ? teamIdx : activeTeamRef.current;
      const voices = TEAM_VOICES[team];
      voice = voices[voiceIndexRef[team] % voices.length];
      voiceIndexRef[team] = (voiceIndexRef[team] + 1) % voices.length;
    }

    playTTS(
      text,
      voice,
      () => setSpeaking(true),
      () => setSpeaking(false),
      () => setSpeaking(false),
    );
  }, [selectedVoice]);

  // Auto-read question aloud when new question loads — uses pre-fetched audio
  useEffect(() => {
    if (!question?.question) return;
    let cancelled = false;
    const teamAtLoad = active; // capture active team at question load time

    const playWhenReady = async () => {
      try {
        let url = null;
        if (pendingAudioRef.current) {
          url = await pendingAudioRef.current;
          pendingAudioRef.current = null;
        }
        if (cancelled) return;

        if (url) {
          if (currentAudio) { currentAudio.pause(); currentAudio = null; }
          const audio = new Audio(url);
          currentAudio = audio;
          audio.onplay  = () => setSpeaking(true);
          audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; setSpeaking(false); };
          audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; setSpeaking(false); };
          await audio.play();
        } else {
          speak(question.question, teamAtLoad);
        }
      } catch (e) {
        if (!cancelled) speak(question.question, teamAtLoad);
      }
    };

    const timer = setTimeout(playWhenReady, 100);
    return () => { cancelled = true; clearTimeout(timer); stopTTS(); };
  }, [question]); // eslint-disable-line

  const triggerFlash = (type) => {
    setFlash(type);
    setTimeout(() => setFlash(null), 600);
  };

  const consumeQuestion = useCallback(async () => {
    if (!question) return;
    try {
      const r = await markAnswered(question.id);
      setBankCount(r.bankCount);
    } catch (e) { console.error(e); }
  }, [question]);

  // Calculate random pie chance based on score
  // 0-5 pts: 0%, 6-10: 5%, 11-15: 10%, 16-20: 15%, 21+: 20%
  const getRandomPieChance = (score) => {
    if (score <= 5)  return 0;
    if (score <= 10) return 0.05;
    if (score <= 15) return 0.10;
    if (score <= 20) return 0.15;
    return 0.20;
  };

  // Team picks a category from the choosing screen
  const handlePickCategory = async (cat) => {
    getAudio();
    setLoading(true); setError(null); setChosenCat(cat);
    setRevealed(false); setSpeaking(false); stopTTS();
    try {
      const catStreak = streak[active][cat] || 0;
      const alreadyOwned = wedges[active].includes(cat);

      // Determine if this is a pie turn:
      // 1. Earned via 2-in-a-row streak (as before)
      // 2. OR random lucky pie based on score (only if don't already own wedge)
      const earnedPie = catStreak >= STREAK_NEEDED && !alreadyOwned;
      const randomPieChance = getRandomPieChance(scores[active]);
      const luckyPie = !alreadyOwned && !earnedPie && Math.random() < randomPieChance;
      const isPieTurn = earnedPie || luckyPie;

      if (luckyPie) {
        console.log('🎲 Lucky pie triggered! Score:', scores[active], 'Chance was:', Math.round(randomPieChance * 100) + '%');
      }

      // Fetch question and start pre-fetching TTS audio simultaneously
      const data = await getQuestion(cat, isPieTurn);
      setQuestion(data.question);
      setRevealed(false);

      // Track questions used per category for this game
      setQuestionsUsed(prev => ({ ...prev, [cat]: (prev[cat] || 0) + 1 }));

      // Start pre-fetching audio using ref to guarantee correct team
      const currentTeam = activeTeamRef.current;
      const ttsVoice = (selectedVoice && selectedVoice !== 'auto')
        ? selectedVoice
        : TEAM_VOICES[currentTeam][voiceIndexRef[currentTeam] % TEAM_VOICES[currentTeam].length];
      if (!selectedVoice || selectedVoice === 'auto') {
        voiceIndexRef[currentTeam] = (voiceIndexRef[currentTeam] + 1) % TEAM_VOICES[currentTeam].length;
      }

      const BASE = process.env.REACT_APP_API_URL || '';
      pendingAudioRef.current = fetch(`${BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.question.question, voice: ttsVoice }),
      }).then(async r => {
        if (!r.ok) throw new Error('TTS failed');
        const blob = await r.blob();
        return URL.createObjectURL(blob);
      }).catch(() => null);

      if (isPieTurn) {
        playPieSting(getAudio());
        if (luckyPie) {
          setState(S.LUCKY_PIE);
        } else {
          setState(S.PIE_INTRO);
        }
      } else {
        setState(S.CAT_SPLASH);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // Called when category splash finishes — show the question
  const handleSplashDone = useCallback(() => {
    setState(S.QUESTION);
  }, []);

  // Watch for audio being ready and dismiss splash early if it's done
  useEffect(() => {
    if (state !== S.CAT_SPLASH || !pendingAudioRef.current) return;
    let cancelled = false;
    const minDelay = 1200; // always show splash for at least 1.2s
    const start = Date.now();

    pendingAudioRef.current.then(() => {
      if (cancelled) return;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, minDelay - elapsed);
      setTimeout(() => {
        if (!cancelled) setState(S.QUESTION);
      }, remaining);
    }).catch(() => {
      if (!cancelled) setTimeout(() => setState(S.QUESTION), 500);
    });

    return () => { cancelled = true; };
  }, [state]);

  // Called when pie intro animation finishes — ensure revealed is false
  const handlePieIntroDone = useCallback(() => {
    setRevealed(false);
    setState(S.PIE);
  }, []);

  // Award wedge to a team
  const awardWedge = (teamIdx, cat, currentWedges) => {
    const newWedges = [currentWedges[0].slice(), currentWedges[1].slice()];
    if (!newWedges[teamIdx].includes(cat)) newWedges[teamIdx].push(cat);
    return newWedges;
  };

  // Check if a team just completed all wedges — if so, trigger final question
  const checkForFinal = (teamIdx, newWedges) => {
    if (newWedges[teamIdx].length === CATEGORIES.length) {
      setFinalTeam(teamIdx);
      setFinalUsedCats([]);
      setActive(teamIdx);
      setState(S.FINAL_PICK);
      return true;
    }
    return false;
  };

  const handleCorrect = async () => {
    await consumeQuestion();
    stopSpeaking(); setSpeaking(false);
    triggerFlash('correct');
    playCorrect(getAudio());
    const newScores = [...scores];
    newScores[active] += 1;
    setScores(newScores);

    if (state === S.FINAL) {
      // Won the final question — game over!
      playGameWon(getAudio());
      setWinner(active);
      setState(S.WINNER);
      return;
    }

    if (state === S.PIE) {
      const newWedges = awardWedge(active, chosenCat, wedges);
      setWedges(newWedges);
      playWedgeWon(getAudio());
      setStreak(prev => { const n=[...prev]; n[active]={...n[active],[chosenCat]:0}; return n; });

      if (newWedges[active].length === CATEGORIES.length) {
        if (checkForFinal(active, newWedges)) return;
      }

      // Show pie win celebration then continue their turn
      setPieWinCat(chosenCat);
      setState(S.PIE_WIN);
      return;
    }

    // Regular question — increment streak for THIS category only
    const catStreak = (streak[active][chosenCat] || 0) + 1;
    setStreak(prev => { const n=[...prev]; n[active]={...n[active],[chosenCat]:catStreak}; return n; });

    if (catStreak >= STREAK_NEEDED && !wedges[active].includes(chosenCat)) {
      setLoading(true);
      try {
        const data = await getQuestion(chosenCat, true);
        setQuestion(data.question);
        setRevealed(false);
        playPieSting(getAudio());
        setState(S.PIE_INTRO);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    } else {
      // If active team is in final mode, go back to FINAL_PICK
      await loadCategoryOptions(active, wedges, true);
    }
  };

  const handleWrong = async () => {
    await consumeQuestion();
    stopSpeaking(); setSpeaking(false);
    triggerFlash('wrong');
    setStreak(prev => { const n=[...prev]; n[active]={...n[active],[chosenCat]:0}; return n; });

    if (state === S.FINAL) {
      // Wrong on final — other team gets normal turns
      // They keep playing until THEY get something wrong, then we return here
      const nextTeam = 1 - active;
      setActive(nextTeam);
      playSwish(getAudio());
      // checkFinal=true so when nextTeam gets something wrong, it'll check if they need FINAL_PICK too
      await loadCategoryOptions(nextTeam, wedges, true);
      return;
    }

    if (state === S.PIE) {
      playStealSting(getAudio());
      setState(S.STEAL);
      return;
    }

    const nextTeam = 1 - active;
    setActive(nextTeam);
    playSwish(getAudio());
    await loadCategoryOptions(nextTeam, wedges, true);
  };

  const handleSkip = async () => {
    await consumeQuestion();
    stopSpeaking(); setSpeaking(false);
    await loadCategoryOptions(active, wedges);
  };

  // Steal: other team answers correctly
  const handleStealCorrect = async () => {
    const stealingTeam = 1 - active;
    const newScores = [...scores];
    newScores[stealingTeam] += 1;
    setScores(newScores);

    // Reset BOTH teams' streaks for this category
    setStreak(prev => {
      const n = [...prev];
      n[stealingTeam] = { ...n[stealingTeam], [chosenCat]: 0 };
      n[active]       = { ...n[active],       [chosenCat]: 0 };
      return n;
    });

    // If stealing team already owns this wedge, let them pick one from opponent instead
    if (wedges[stealingTeam].includes(chosenCat)) {
      playWedgeWon(getAudio());
      setActive(stealingTeam);
      setState(S.STEAL_PICK);
      return;
    }

    const newWedges = awardWedge(stealingTeam, chosenCat, wedges);
    setWedges(newWedges);
    playWedgeWon(getAudio());

    if (checkForFinal(stealingTeam, newWedges)) return;

    // Show steal celebration then pie win
    setPieWinCat(chosenCat);
    setActive(stealingTeam);
    setState(S.STEAL_CELEBRATE);
  };

  // Called when stealing team picks which opponent wedge to take
  const handleStealPickWedge = async (pickedCat) => {
    const stealingTeam = active; // active was already set to stealingTeam
    const losingTeam = 1 - stealingTeam;

    // Remove wedge from opponent
    const newWedges = [wedges[0].slice(), wedges[1].slice()];
    newWedges[losingTeam] = newWedges[losingTeam].filter(c => c !== pickedCat);
    // Add to stealing team if they don't already have it
    if (!newWedges[stealingTeam].includes(pickedCat)) {
      newWedges[stealingTeam].push(pickedCat);
    }
    setWedges(newWedges);

    // Reset streaks for the picked category
    setStreak(prev => {
      const n = [...prev];
      n[stealingTeam] = { ...n[stealingTeam], [pickedCat]: 0 };
      n[losingTeam]   = { ...n[losingTeam],   [pickedCat]: 0 };
      return n;
    });

    if (checkForFinal(stealingTeam, newWedges)) return;

    setPieWinCat(pickedCat);
    setState(S.STEAL_CELEBRATE);
  };

  const handleStealWrong = async () => {
    // Both teams got it wrong — reset original team's streak for this category
    setStreak(prev => { const n=[...prev]; n[active]={...n[active],[chosenCat]:0}; return n; });
    const nextTeam = 1 - active;
    setActive(nextTeam);
    playSwish(getAudio());
    await loadCategoryOptions(nextTeam, wedges, true);
  };

  // Called when pie win celebration finishes — continue game
  const handlePieWinDone = useCallback(async () => {
    setPieWinCat(null);
    await loadCategoryOptions(active, wedges, true);
  }, [active, wedges, loadCategoryOptions]);

  // Final question: opponent picks a category
  const handleFinalCategoryPick = async (cat) => {
    setLoading(true); setError(null); setChosenCat(cat); setRevealed(false);
    setFinalUsedCats(prev => [...prev, cat]); // mark this category as used
    try {
      const data = await getQuestion(cat, false);
      setQuestion(data.question);
      setState(S.FINAL);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ── INTRO ─────────────────────────────────────────────────────────────────
  if (state === S.INTRO) {
    return <IntroScene onDone={() => setState(S.DICE_ROLL)} />;
  }

  // ── DICE ROLL — who goes first ────────────────────────────────────────────
  if (state === S.DICE_ROLL) {
    return <DiceRoll onDone={handleDiceRollDone} />;
  }

  // ── STEAL PICK — stealing team picks which opponent wedge to take ─────────
  if (state === S.STEAL_PICK) {
    const losingTeam = 1 - active;
    const opponentWedges = wedges[losingTeam];
    return (
      <div style={{
        minHeight:'100vh', background:'#0a0a0a',
        display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        padding:24, gap:20, fontFamily:'Georgia,serif',
      }}>
        <style>{`
          @keyframes pickPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        `}</style>
        <div style={{ fontSize:48 }}>🕵️</div>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:11, letterSpacing:4, color:'#f97316', fontFamily:'monospace' }}>BONUS STEAL!</div>
          <div style={{ fontSize:'clamp(20px,4vw,28px)', fontWeight:900, color:TEAMS[active].color, marginTop:4 }}>
            {TEAMS[active].emoji} {TEAMS[active].label.toUpperCase()}
          </div>
          <div style={{ fontSize:13, color:'#555', fontFamily:'monospace', marginTop:6 }}>
            You already have that wedge. Pick one from {TEAMS[losingTeam].label}!
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, maxWidth:400, width:'100%' }}>
          {opponentWedges.map(cat => (
            <button key={cat} onClick={() => handleStealPickWedge(cat)} style={{
              padding:'16px 12px', borderRadius:10, cursor:'pointer',
              border:`2px solid ${CAT_COLORS[cat]}`,
              background:`${CAT_COLORS[cat]}15`,
              display:'flex', flexDirection:'column', alignItems:'center', gap:6,
              animation:'pickPulse 1.5s ease infinite',
            }}>
              <span style={{ fontSize:32, filter:`drop-shadow(0 0 8px ${CAT_COLORS[cat]})` }}>{CAT_EMOJI[cat]}</span>
              <span style={{ fontSize:11, color:CAT_COLORS[cat], fontFamily:'monospace', fontWeight:700, textAlign:'center', lineHeight:1.3 }}>{cat}</span>
            </button>
          ))}
        </div>

        {opponentWedges.length === 0 && (
          <div style={{ color:'#555', fontFamily:'monospace', fontSize:13 }}>
            Opponent has no wedges to steal!
          </div>
        )}
      </div>
    );
  }

  // ── STEAL CELEBRATION ────────────────────────────────────────────────────
  if (state === S.STEAL_CELEBRATE) {
    return <StealCelebration
      team={TEAMS[active]}
      category={chosenCat}
      onDone={() => setState(S.PIE_WIN)}
    />;
  }

  // ── LUCKY PIE ANNOUNCEMENT ───────────────────────────────────────────────
  if (state === S.LUCKY_PIE) {
    return <LuckyPieAnnounce
      team={TEAMS[active]}
      category={chosenCat}
      onDone={() => setState(S.PIE_INTRO)}
    />;
  }

  // ── WINNER ────────────────────────────────────────────────────────────────
  if (state === S.WINNER && winner !== null) {
    return (
      <div style={{ minHeight:'100vh', background:'#0a0a0a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:'Georgia,serif', padding:24, overflow:'hidden', position:'relative' }}>
        <style>{`
          @keyframes winnerPop   { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
          @keyframes winnerGlow  { 0%,100%{text-shadow:0 0 30px ${TEAMS[winner].color}} 50%{text-shadow:0 0 80px ${TEAMS[winner].color}, 0 0 120px ${TEAMS[winner].color}} }
          @keyframes trophySpin  { 0%{transform:rotateY(0deg)} 100%{transform:rotateY(360deg)} }
          @keyframes starFloat   { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-20px) rotate(180deg)} }
          @keyframes bgPulse     { 0%,100%{background:rgba(0,0,0,0)} 50%{background:rgba(${TEAMS[winner].color === '#3b82f6' ? '59,130,246' : '236,72,153'},0.05)} }
        `}</style>

        {/* Floating stars background */}
        {Array.from({length:20},(_,i) => (
          <div key={i} style={{
            position:'absolute',
            left:`${Math.random()*100}%`,
            top:`${Math.random()*100}%`,
            fontSize: 16 + Math.random()*24,
            animation:`starFloat ${2+Math.random()*2}s ${Math.random()*2}s ease-in-out infinite`,
            opacity: 0.3 + Math.random()*0.4,
          }}>⭐</div>
        ))}

        <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:20, zIndex:10 }}>
          <div style={{ fontSize:80, animation:'trophySpin 2s ease-in-out' }}>🏆</div>

          <div style={{ fontSize:13, letterSpacing:8, color:TEAMS[winner].color, fontFamily:'monospace', animation:'winnerPop 0.6s ease both' }}>
            CHAMPION
          </div>

          <div style={{
            fontSize:'clamp(40px,8vw,72px)', color:TEAMS[winner].color, fontWeight:900,
            animation:'winnerGlow 1.5s ease infinite, winnerPop 0.5s 0.2s ease both',
            opacity:0,
          }}>
            {TEAMS[winner].emoji} {TEAMS[winner].label.toUpperCase()}
          </div>

          <div style={{ fontSize:14, color:'#555', fontFamily:'monospace', letterSpacing:2 }}>
            ALL {CATEGORIES.length} WEDGES + FINAL QUESTION ANSWERED
          </div>

          <PieDisplay wedges={wedges[winner]} size={160} />

          <div style={{ display:'flex', gap:40, marginTop:8 }}>
            {TEAMS.map((t,i) => (
              <div key={i} style={{ textAlign:'center', opacity: i === winner ? 1 : 0.4 }}>
                <div style={{ color:t.color, fontSize:13, fontFamily:'monospace' }}>{t.emoji} {t.label.toUpperCase()}</div>
                <div style={{ color:'#fff', fontSize:32, fontWeight:900, fontFamily:'monospace' }}>{scores[i]}</div>
                <div style={{ color:'#555', fontSize:11, fontFamily:'monospace' }}>{wedges[i].length}/{CATEGORIES.length} wedges</div>
              </div>
            ))}
          </div>

          <button onClick={() => window.location.reload()} style={{
            marginTop:8, padding:'14px 36px', borderRadius:10,
            border:`2px solid ${TEAMS[winner].color}`,
            background:`${TEAMS[winner].color}18`,
            color:TEAMS[winner].color, cursor:'pointer',
            fontFamily:'monospace', fontSize:14, letterSpacing:3,
            fontWeight:700,
          }}>↺ PLAY AGAIN</button>

          {/* Questions used this game */}
          <div style={{ marginTop:16, maxWidth:400, width:'100%', background:'#0d0d0d', border:'1px solid #1a1a1a', borderRadius:8, padding:'12px 16px' }}>
            <div style={{ fontSize:9, color:'#333', fontFamily:'monospace', textAlign:'center', letterSpacing:2, marginBottom:10 }}>
              QUESTIONS USED THIS GAME · {Object.values(questionsUsed).reduce((a,b)=>a+b,0)} TOTAL
            </div>
            {CATEGORIES.map(cat => {
              const count = questionsUsed[cat] || 0;
              const max = Math.max(...Object.values(questionsUsed), 1);
              return (
                <div key={cat} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                  <span style={{ fontSize:12 }}>{CAT_EMOJI[cat]}</span>
                  <div style={{ flex:1, height:4, background:'#1a1a1a', borderRadius:2, overflow:'hidden' }}>
                    <div style={{
                      height:'100%',
                      width: `${(count/max)*100}%`,
                      background: CAT_COLORS[cat],
                      borderRadius:2,
                      transition:'width 0.6s ease',
                    }} />
                  </div>
                  <span style={{ fontSize:10, color:'#444', fontFamily:'monospace', minWidth:16, textAlign:'right' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const catData      = chosenCat ? { color: CAT_COLORS[chosenCat], emoji: CAT_EMOJI[chosenCat] } : null;
  const isPieState   = state === S.PIE;
  const currentStreak = streak[active];

  return (
    <div style={{
      ...css.page,
      background: chosenCat && (state === S.QUESTION || state === S.PIE || state === S.FINAL || state === S.CAT_SPLASH)
        ? `radial-gradient(ellipse at center, ${CAT_COLORS[chosenCat]}18 0%, #0a0a0a 65%)`
        : '#0a0a0a',
      transition: 'background 0.8s ease',
    }}>
      {/* Pie intro overlay */}
      {state === S.PIE_INTRO && chosenCat && (
        <PieIntro category={chosenCat} teamIdx={active} onDone={handlePieIntroDone} />
      )}

      {/* Pie win celebration overlay */}
      {state === S.PIE_WIN && pieWinCat && (
        <PieWinCelebration category={pieWinCat} teamIdx={active} onDone={handlePieWinDone} />
      )}

      {/* Steal overlay */}
      {state === S.STEAL && question && chosenCat && (
        <StealScreen
          stealingTeamIdx={1 - active}
          category={chosenCat}
          question={question}
          onCorrect={handleStealCorrect}
          onWrong={handleStealWrong}
        />
      )}

      {/* Header */}
      <div style={{ textAlign:'center', marginBottom:16 }}>
        <h1 style={{ fontSize:'clamp(28px,6vw,48px)', color:'#fff', margin:0, fontWeight:900, letterSpacing:-1 }}>TRIVIAL PURSUIT</h1>
        {bankCount !== null && (
          <div style={{ fontSize:12, color: bankCount < 100 ? '#ef4444' : '#555', fontFamily:'monospace', marginTop:4 }}>
            {bankCount} questions in bank{bankCount < 250 ? ' · refilling...' : ''}
          </div>
        )}
        {/* Voice selector */}
        <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          <span style={{ fontSize:10, color:'#444', fontFamily:'monospace' }}>🔊 VOICE:</span>
          <select
            value={selectedVoice}
            onChange={e => { setSelectedVoice(e.target.value); stopTTS(); setSpeaking(false); }}
            style={{
              background:'#111', border:'1px solid #222', borderRadius:4,
              color:'#888', fontSize:10, fontFamily:'monospace', padding:'3px 8px',
              cursor:'pointer', maxWidth:240,
            }}
          >
            <option value="auto">Auto — rotates by team 🎲</option>
            {OPENAI_VOICES.map(v => (
              <option key={v} value={v}>{VOICE_LABELS[v]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scoreboards */}
      <div style={{ display:'flex', width:'100%', maxWidth:600, gap:10, marginBottom:16 }}>
        {TEAMS.map((t, i) => (
          <div key={i} style={{
            flex:1, background:'#111', borderRadius:12, padding:'14px 10px',
            border:`1px solid ${active===i ? t.color+'55' : '#1c1c1c'}`,
            borderBottom:`4px solid ${active===i ? t.color : '#1c1c1c'}`,
            display:'flex', flexDirection:'column', alignItems:'center', gap:6,
          }}>
            <div style={{ fontSize:16, color:active===i?'#fff':'#333', fontFamily:'monospace', fontWeight:700 }}>{t.emoji} {t.label.toUpperCase()}</div>
            <div style={{ fontSize:32, fontWeight:900, color:active===i?t.color:'#2a2a2a', fontFamily:'monospace' }}>{scores[i]}</div>
            <PieDisplay wedges={wedges[i]} size={100} />
            <div style={{ fontSize:11, color:'#444', fontFamily:'monospace' }}>{wedges[i].length}/{CATEGORIES.length} wedges</div>
            {/* Per-category streak tracker */}
            <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:4, marginTop:2 }}>
              {CATEGORIES.map(cat => {
                const owned = wedges[i].includes(cat);
                const s = streak[i][cat] || 0;
                const pieReady = s >= STREAK_NEEDED && !owned;
                return (
                  <div key={cat} style={{ display:'flex', alignItems:'center', gap:6, opacity: owned ? 0.35 : 1 }}>
                    <span style={{ fontSize:16, minWidth:22 }}>{CAT_EMOJI[cat]}</span>
                    <div style={{ flex:1, height:6, background:'#1a1a1a', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ height:'100%', width: owned ? '100%' : `${Math.min((s/STREAK_NEEDED)*100,100)}%`, background: owned ? '#333' : pieReady ? '#fbbf24' : t.color, borderRadius:3, transition:'width 0.4s' }} />
                    </div>
                    {owned && <span style={{ fontSize:11, color:'#444' }}>✓</span>}
                    {pieReady && !owned && <span style={{ fontSize:13 }}>🥧</span>}
                    {!owned && s > 0 && !pieReady && <span style={{ fontSize:10, color:t.color, fontFamily:'monospace', minWidth:24 }}>{s}/{STREAK_NEEDED}</span>}
                  </div>
                );
              })}
            </div>
            {active===i && <div style={{ fontSize:10, color:t.color+'88', fontFamily:'monospace', letterSpacing:1, marginTop:2 }}>▸ PLAYING</div>}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color:'#f87171', fontFamily:'monospace', fontSize:12, marginBottom:10, textAlign:'center' }}>
          ⚠ {error} <button onClick={() => loadCategoryOptions(active, wedges)} style={{ marginLeft:8, color:'#888', background:'none', border:'none', cursor:'pointer', fontFamily:'monospace', fontSize:11 }}>retry</button>
        </div>
      )}
      {loading && <div style={{ color:'#333', fontFamily:'monospace', fontSize:11, marginBottom:10 }}>Loading...</div>}

      {/* ── FINAL PICK — opponent chooses category for final question ── */}
      {state === S.FINAL_PICK && finalTeam !== null && (
        <div style={{ width:'100%', maxWidth:540 }}>
          <div style={{ textAlign:'center', marginBottom:20, padding:'16px', background:'#fbbf2410', border:'1px solid #fbbf2444', borderRadius:10 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🏆</div>
            <div style={{ color:'#fbbf24', fontSize:18, fontWeight:700, marginBottom:6 }}>
              {TEAMS[finalTeam].emoji} {TEAMS[finalTeam].label} HAS ALL 6 WEDGES!
            </div>
            <div style={{ color:'#888', fontSize:13, fontFamily:'monospace' }}>
              {TEAMS[1-finalTeam].label.toUpperCase()} — PICK THE FINAL QUESTION CATEGORY
            </div>
            {finalUsedCats.length > 0 && (
              <div style={{ color:'#555', fontSize:11, fontFamily:'monospace', marginTop:6 }}>
                Already used: {finalUsedCats.join(', ')}
              </div>
            )}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            {CATEGORIES.map(cat => {
              const alreadyUsed = finalUsedCats.includes(cat);
              return (
                <button key={cat} onClick={() => !alreadyUsed && handleFinalCategoryPick(cat)}
                  disabled={loading || alreadyUsed} style={{
                  padding:'16px 10px', borderRadius:12,
                  border:`2px solid ${alreadyUsed ? '#222' : CAT_COLORS[cat]+'55'}`,
                  background: alreadyUsed ? '#0d0d0d' : `${CAT_COLORS[cat]}10`,
                  color: alreadyUsed ? '#333' : '#fff',
                  cursor: alreadyUsed ? 'not-allowed' : 'pointer',
                  textAlign:'center', display:'flex', flexDirection:'column',
                  alignItems:'center', gap:8, opacity: alreadyUsed ? 0.4 : 1,
                }}>
                  <span style={{ fontSize:32 }}>{CAT_EMOJI[cat]}</span>
                  <div style={{ fontSize:10, fontWeight:700, color: alreadyUsed ? '#333' : CAT_COLORS[cat], lineHeight:1.3 }}>{cat}</div>
                  {alreadyUsed && <div style={{ fontSize:9, color:'#444', fontFamily:'monospace' }}>used</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CATEGORY SPLASH — shows while audio pre-fetches ── */}
      {state === S.CAT_SPLASH && chosenCat && (
        <CategorySplash category={chosenCat} teamIdx={active} onReady={handleSplashDone} />
      )}

      {/* ── CHOOSING ── */}
      {state === S.CHOOSING && !loading && (
        <div style={{ width:'100%', maxWidth:540 }}>
          <div style={{ textAlign:'center', marginBottom:14 }}>
            <div style={{ color:TEAMS[active].color, fontSize:12, fontFamily:'monospace', letterSpacing:2 }}>
              {TEAMS[active].emoji} {TEAMS[active].label.toUpperCase()} — CHOOSE A CATEGORY
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {catOptions.filter(Boolean).map(cat => {
              // Roll Again special button
              if (cat === 'ROLL_AGAIN') {
                return (
                  <button key="ROLL_AGAIN" onClick={() => loadCategoryOptions(active, wedges)} disabled={loading} style={{
                    padding:'22px 24px', borderRadius:12,
                    border:'2px solid #22c55e55',
                    background:'#22c55e10',
                    color:'#fff', cursor:'pointer', textAlign:'left',
                    display:'flex', alignItems:'center', gap:16,
                  }}>
                    <span style={{ fontSize:36 }}>🎲</span>
                    <div>
                      <div style={{ fontSize:16, fontWeight:700, color:'#22c55e' }}>Roll Again!</div>
                      <div style={{ fontSize:13, color:'#555', fontFamily:'monospace', marginTop:4 }}>tap to get two new categories</div>
                    </div>
                  </button>
                );
              }
              const alreadyOwned = wedges[active].includes(cat);
              const streakInCat  = streak[active][cat] || 0;
              const pieReady     = streakInCat >= STREAK_NEEDED && !alreadyOwned;
              const randomChance = getRandomPieChance(scores[active]);
              const showLuckyChance = !alreadyOwned && !pieReady && randomChance > 0;
              return (
                <button key={cat} onClick={() => handlePickCategory(cat)} disabled={loading} style={{
                  padding:'22px 24px', borderRadius:12,
                  border:`2px solid ${pieReady ? '#fbbf24' : CAT_COLORS[cat]+'55'}`,
                  background: pieReady ? '#fbbf2410' : `${CAT_COLORS[cat]}10`,
                  color:'#fff', cursor:'pointer', textAlign:'left',
                  display:'flex', alignItems:'center', gap:16,
                }}>
                  <span style={{ fontSize:36 }}>{CAT_EMOJI[cat]}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:16, fontWeight:700, color: pieReady ? '#fbbf24' : CAT_COLORS[cat], lineHeight:1.2 }}>{cat}</div>
                    <div style={{ fontSize:13, color:'#555', fontFamily:'monospace', marginTop:4 }}>
                      {alreadyOwned ? '✓ wedge owned'
                        : pieReady ? '🥧 PIE QUESTION READY!'
                        : streakInCat > 0 ? `🔥 ${streakInCat}/${STREAK_NEEDED} — one more for pie!`
                        : 'tap to play'}
                    </div>
                  </div>
                  {showLuckyChance && (
                    <div style={{ textAlign:'center', fontSize:10, color:'#fbbf2488', fontFamily:'monospace' }}>
                      🎲 {Math.round(randomChance * 100)}%<br/>lucky pie
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── QUESTION / PIE QUESTION / FINAL QUESTION ── */}
      {(state === S.QUESTION || state === S.PIE || state === S.FINAL) && question && (
        <div style={{
          width:'100%', maxWidth:540,
          background: flash==='correct' ? '#0a1a0a' : flash==='wrong' ? '#1a0a0a' : isPieState ? '#100e08' : '#111',
          border:`1px solid ${isPieState ? '#fbbf2433' : catData?.color+'1a'}`,
          borderLeft:`4px solid ${isPieState ? '#fbbf24' : catData?.color}`,
          borderRadius:10, padding:'18px 16px',
          transition:'background 0.3s',
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:9, color: state===S.FINAL ? '#fbbf24' : isPieState?'#fbbf24':catData?.color, fontFamily:'monospace', letterSpacing:2, textTransform:'uppercase' }}>
              {state===S.FINAL ? '🏆 FINAL QUESTION' : isPieState ? '🥧 PIE QUESTION' : `${catData?.emoji} ${chosenCat}`}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {/* Stop / Replay button */}
              <button
                onClick={() => {
                  if (speaking) { stopTTS(); setSpeaking(false); }
                  else { speak(question.question); }
                }}
                title={speaking ? 'Stop reading' : 'Read again'}
                style={{
                  padding:'4px 10px', borderRadius:5,
                  border:`1px solid ${speaking ? '#ef4444' : '#333'}`,
                  background: speaking ? 'rgba(239,68,68,0.1)' : 'transparent',
                  color: speaking ? '#ef4444' : '#555',
                  cursor:'pointer', fontSize:16, lineHeight:1,
                }}
              >{speaking ? '🔇' : '🔁'}</button>
              {question.canadian && <div style={{ fontSize:8, color:'#cc000099', fontFamily:'monospace' }}>🍁</div>}
              <button onClick={handleSkip} disabled={loading} style={{
                padding:'4px 12px', borderRadius:4,
                border:`1px solid ${isPieState ? '#fbbf2444' : '#2a2a2a'}`,
                background: isPieState ? '#fbbf2410' : 'transparent',
                color: isPieState ? '#fbbf2499' : '#555',
                cursor:'pointer', fontSize:10,
                fontFamily:'monospace', letterSpacing:1,
              }}>
                ⟳ SKIP
              </button>
            </div>
          </div>

          <div style={{ fontSize:'clamp(18px,3vw,24px)', color:isPieState?'#fffbeb':'#ddd', lineHeight:1.7, marginBottom:18, minHeight:60 }}>
            {question.question}
          </div>

          <div onClick={() => !revealed && setRevealed(true)} style={{
            borderRadius:7, padding:'16px 18px', marginBottom:14, minHeight:52,
            background:revealed?'#161616':'#090909',
            border:`1px solid ${revealed?(isPieState?'#fbbf2433':catData?.color+'2a'):'#161616'}`,
            cursor:revealed?'default':'pointer', transition:'all 0.2s',
          }}>
            {revealed
              ? <div style={{ color:'#fff', fontSize:20, fontWeight:600, lineHeight:1.55 }}>{question.answer}</div>
              : <div style={{ color:'#1c1c1c', fontSize:12, fontFamily:'monospace', letterSpacing:3 }}>▸ TAP TO REVEAL ANSWER</div>
            }
          </div>

          {!revealed ? (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {isPieState && (
                <div style={{ textAlign:'center', padding:'10px 14px', borderRadius:7, background:'#fbbf2408', border:'1px solid #fbbf2422', color:'#fbbf24', fontSize:13, fontFamily:'monospace', letterSpacing:1 }}>
                  ⚠ OTHER TEAM — DECLARE STEAL NOW BEFORE REVEALING
                </div>
              )}
              {state === S.FINAL && (
                <div style={{ textAlign:'center', padding:'10px 14px', borderRadius:7, background:'#fbbf2408', border:'1px solid #fbbf2422', color:'#fbbf24', fontSize:13, fontFamily:'monospace', letterSpacing:1 }}>
                  🏆 {TEAMS[active].label.toUpperCase()} — ANSWER TO WIN THE GAME!
                </div>
              )}
              <button onClick={() => setRevealed(true)} style={{
                width:'100%', padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', letterSpacing:2,
                border:`1px solid ${(isPieState||state===S.FINAL)?'#fbbf2433':catData?.color+'33'}`,
                background:(isPieState||state===S.FINAL)?'#fbbf2408':`${catData?.color}08`,
                color:(isPieState||state===S.FINAL)?'#fbbf24':catData?.color,
              }}>REVEAL ANSWER</button>
            </div>
          ) : state === S.FINAL ? (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleCorrect} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #14532d', background:'rgba(34,197,94,0.07)', color:'#4ade80' }}>
                ✓ CORRECT · WIN THE GAME 🏆
              </button>
              <button onClick={handleWrong} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #7f1d1d', background:'rgba(239,68,68,0.07)', color:'#f87171' }}>
                ✗ WRONG · GAME CONTINUES
              </button>
            </div>
          ) : isPieState ? (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={handleCorrect} disabled={loading} style={{
                width:'100%', padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace',
                border:'1px solid #14532d', background:'rgba(34,197,94,0.07)', color:'#4ade80',
              }}>✓ {TEAMS[active].label.toUpperCase()} GOT IT · WIN WEDGE</button>
              <button onClick={handleStealCorrect} disabled={loading} style={{
                width:'100%', padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace',
                border:'1px solid #1d4ed8', background:'rgba(59,130,246,0.07)', color:'#60a5fa',
              }}>✓ STEAL CORRECT · {TEAMS[1-active].label.toUpperCase()} WIN WEDGE + BONUS</button>
              <button onClick={async () => {
                await consumeQuestion();
                triggerFlash('wrong');
                setStreak(prev => { const n=[...prev]; n[active]={...n[active],[chosenCat]:0}; return n; });
                setActive(a => 1 - a);
                await loadCategoryOptions();
              }} disabled={loading} style={{
                width:'100%', padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace',
                border:'1px solid #7f1d1d', background:'rgba(239,68,68,0.07)', color:'#f87171',
              }}>✗ BOTH WRONG · NO WEDGE · SWITCH</button>
            </div>
          ) : (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleCorrect} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #14532d', background:'rgba(34,197,94,0.07)', color:'#4ade80' }}>
                ✓ CORRECT · KEEP GOING
              </button>
              <button onClick={handleWrong} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #7f1d1d', background:'rgba(239,68,68,0.07)', color:'#f87171' }}>
                ✗ WRONG · SWITCH
              </button>
            </div>
          )}
        </div>
      )}

      {/* Question Bank */}
      <div style={{ marginTop:12, maxWidth:540, width:'100%', padding:'10px 14px', borderRadius:7, background:'#0d0d0d', border:'1px solid #131313' }}>
        <div style={{ fontSize:9, color:'#333', fontFamily:'monospace', textAlign:'center', marginBottom:6, letterSpacing:2 }}>
          QUESTION BANK · {bankCount !== null ? bankCount : '—'} TOTAL{bankCount < 250 ? ' · REFILLING...' : ''}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 10px' }}>
          {CATEGORIES.map(cat => {
            const count = categoryCounts[cat] || 0;
            const low = count < 50;
            return (
              <div key={cat} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ fontSize:10 }}>{CAT_EMOJI[cat]}</span>
                <div style={{ flex:1, height:3, background:'#1a1a1a', borderRadius:2, overflow:'hidden' }}>
                  <div style={{
                    height:'100%',
                    width: `${Math.min((count / 200) * 100, 100)}%`,
                    background: low ? '#ef4444' : CAT_COLORS[cat],
                    borderRadius:2,
                  }} />
                </div>
                <span style={{ fontSize:9, color: low ? '#ef4444' : '#2a2a2a', fontFamily:'monospace', minWidth:24, textAlign:'right' }}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button onClick={() => window.location.reload()} style={{ marginTop:12, padding:'5px 14px', borderRadius:4, border:'1px solid #181818', background:'transparent', color:'#222', cursor:'pointer', fontFamily:'monospace', fontSize:9 }}>
        ↺ RESET
      </button>
    </div>
  );
}

const css = {
  page: { minHeight:'100vh', fontFamily:'Georgia,serif', display:'flex', flexDirection:'column', alignItems:'center', padding:'12px 10px 40px' },
  btn:  (color) => ({ padding:'11px 28px', borderRadius:8, border:`1px solid ${color}`, background:'#111', color:'#aaa', cursor:'pointer', fontFamily:'monospace', fontSize:12, letterSpacing:2 }),
};
