import React, { useState, useEffect, useCallback, useRef } from 'react';
import PieDisplay, { CATEGORIES, CAT_COLORS, CAT_EMOJI } from './PieDisplay';
import { getCategories, getQuestion, markAnswered, getBankCount } from '../api';

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

// 🏆 Wedge won — celebratory fanfare
function playWedgeWon(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Rising scale
  [261, 329, 392, 523, 659, 784, 1047].forEach((f, i) =>
    playTone(ctx, f, t + i * 0.08, 0.18, 'triangle', 0.2)
  );
  // Big chord sustain
  [523, 659, 784, 1047].forEach(f =>
    playTone(ctx, f, t + 0.62, 1.2, 'sine', 0.14)
  );
  // Rhythm hits
  [0, 0.18, 0.36].forEach(offset =>
    playTone(ctx, 880, t + 0.65 + offset, 0.1, 'square', 0.08)
  );
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

// 🎲 Dice roll sound
function playDiceSound(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(ctx, 180, t, 0.05, 'triangle', 0.15);
  playTone(ctx, 120, t + 0.04, 0.05, 'triangle', 0.15);
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const STREAK_NEEDED = 2;
const TEAMS = [
  { label: 'Boys',  emoji: '👦', color: '#3b82f6' },
  { label: 'Girls', emoji: '👧', color: '#ec4899' },
];

const S = {
  ROLLING:     'rolling',     // initial dice rolling state
  CHOOSING:    'choosing',
  QUESTION:    'question',
  PIE_INTRO:   'pie_intro',   // animated pie reveal screen
  PIE:         'pie',         // pie question active
  STEAL:       'steal',       // other team can steal
  WINNER:      'winner',
};

// ─── DICE ROLLING COMPONENT ───────────────────────────────────────────────
function DiceRollStart({ onRollComplete, getAudio, audioCtxRef }) {
  const [rolls, setRolls] = useState([null, null]);
  const [rolling, setRolling] = useState([false, false]);
  const [tieMessage, setTieMessage] = useState(false);

  const rollDie = (teamIdx) => {
    getAudio(); // Unlock audio context
    if (rolling[teamIdx] || (rolls[0] !== null && rolls[1] !== null && !tieMessage)) return;

    setTieMessage(false);
    const newRolling = [...rolling];
    newRolling[teamIdx] = true;
    setRolling(newRolling);

    let counter = 0;
    const interval = setInterval(() => {
      setRolls(prev => {
        const next = [...prev];
        next[teamIdx] = Math.floor(Math.random() * 6) + 1;
        return next;
      });
      if (audioCtxRef && audioCtxRef.current) {
        playDiceSound(audioCtxRef.current);
      }
      counter++;
      
      if (counter > 10) {
        clearInterval(interval);
        setRolling(prev => {
          const next = [...prev];
          next[teamIdx] = false;
          return next;
        });
      }
    }, 80);
  };

  // Listen for when both teams finish rolling
  useEffect(() => {
    if (rolling[0] || rolling[1]) return;
    if (rolls[0] !== null && rolls[1] !== null) {
      if (rolls[0] === rolls[1]) {
        const tieTimer = setTimeout(() => {
          setTieMessage(true);
          setRolls([null, null]);
        }, 1000);
        return () => clearTimeout(tieTimer);
      } else {
        const winnerIdx = rolls[0] > rolls[1] ? 0 : 1;
        const proceedTimer = setTimeout(() => {
          onRollComplete(winnerIdx);
        }, 1800);
        return () => clearTimeout(proceedTimer);
      }
    }
  }, [rolls, rolling, onRollComplete]);

  return (
    <div style={{ width: '100%', maxWidth: 480, textAlign: 'center', padding: 20, background: '#0d0d0d', borderRadius: 12, border: '1px solid #1c1c1c' }}>
      <div style={{ fontSize: 11, letterSpacing: 5, color: '#666', fontFamily: 'monospace', marginBottom: 6 }}>DETERMINE FIRST TURN</div>
      <h2 style={{ fontSize: 24, color: '#fff', fontWeight: 900, margin: '0 0 20px 0', fontFamily: 'Georgia, serif' }}>🎲 ROLL FOR HIGHEST START</h2>
      
      {tieMessage && (
        <div style={{ color: '#fbbf24', fontSize: 12, fontFamily: 'monospace', marginBottom: 16, animation: 'fadeIn 0.3s ease' }}>
          ⚠️ IT'S A TIE! ROLL AGAIN!
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {TEAMS.map((t, i) => {
          const hasRolled = rolls[i] !== null;
          const isWinner = rolls[0] !== null && rolls[1] !== null && rolls[0] !== rolls[1] && ((i === 0 && rolls[0] > rolls[1]) || (i === 1 && rolls[1] > rolls[0]));
          
          return (
            <div key={i} style={{
              flex: 1, background: '#111', borderRadius: 10, padding: '20px 10px',
              border: `1px solid ${isWinner ? t.color : '#1c1c1c'}`,
              boxShadow: isWinner ? `0 0 15px ${t.color}33` : 'none',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ fontSize: 12, color: '#fff', fontFamily: 'monospace', marginBottom: 12 }}>{t.emoji} {t.label.toUpperCase()}</div>
              
              <div style={{
                width: 64, height: 64, background: rolling[i] ? '#222' : hasRolled ? t.color : '#1a1a1a',
                color: rolling[i] ? '#555' : hasRolled ? '#fff' : '#333',
                margin: '0 auto 16px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 900, border: '1px solid #2a2a2a', fontFamily: 'monospace',
                transform: rolling[i] ? 'rotate(20deg) scale(1.05)' : 'none', transition: 'all 0.1s ease'
              }}>
                {rolls[i] || '?'}
              </div>

              <button 
                onClick={() => rollDie(i)} 
                disabled={rolling[i] || (rolls[i] !== null && !tieMessage)}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: `1px solid ${t.color}55`,
                  background: rolling[i] ? '#111' : `${t.color}15`, color: t.color,
                  cursor: rolling[i] || (rolls[i] !== null && !tieMessage) ? 'default' : 'pointer',
                  fontSize: 10, fontFamily: 'monospace', width: '100%', opacity: rolls[i] !== null && !tieMessage ? 0.4 : 1
                }}
              >
                {rolling[i] ? 'ROLLING...' : hasRolled && !tieMessage ? 'ROLLED' : '💥 ROLL DIE'}
              </button>

              {isWinner && (
                <div style={{ color: t.color, fontSize: 9, fontFamily: 'monospace', marginTop: 10, letterSpacing: 1 }}>
                  GOES FIRST!
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PIE INTRO ANIMATION ───────────────────────────────────────────────────
function PieIntro({ category, teamIdx, onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 600),
      setTimeout(() => setStep(2), 1800),
      setTimeout(onDone, 2600),
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

      <div style={{
        animation: step >= 0 ? 'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' : 'none',
        opacity: 0,
      }}>
        <PieWedge color={color} emoji={CAT_EMOJI[category]} />
      </div>

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

function PieWedge({ color, emoji, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const startAngle = -Math.PI / 2;
  const endAngle   = startAngle + (Math.PI * 2) / 6