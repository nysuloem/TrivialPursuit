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

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const STREAK_NEEDED = 2;
const TEAMS = [
  { label: 'Boys',  emoji: '👦', color: '#3b82f6' },
  { label: 'Girls', emoji: '👧', color: '#ec4899' },
];

const S = {
  CHOOSING:    'choosing',
  QUESTION:    'question',
  PIE_INTRO:   'pie_intro',   // animated pie reveal screen
  PIE:         'pie',         // pie question active
  STEAL:       'steal',       // other team can steal
  WINNER:      'winner',
};

// ─── PIE INTRO ANIMATION ───────────────────────────────────────────────────
function PieIntro({ category, teamIdx, onDone }) {
  const [step, setStep] = useState(0);
  // step 0: fade in wedge, step 1: text appears, step 2: done
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

// Single pie wedge graphic
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
  const audioCtxRef = useRef(null);

  // Lazily init audio context on first user interaction
  const getAudio = () => {
    if (!audioCtxRef.current) audioCtxRef.current = createAudioCtx();
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const [state,      setState]      = useState(S.CHOOSING);
  const [active,     setActive]     = useState(0);
  const [scores,     setScores]     = useState([0, 0]);
  const [wedges,     setWedges]     = useState([[], []]);
  const [streak,     setStreak]     = useState([{ cat: null, n: 0 }, { cat: null, n: 0 }]);
  const [catOptions, setCatOptions] = useState([]);
  const [chosenCat,  setChosenCat]  = useState(null);
  const [question,   setQuestion]   = useState(null);
  const [revealed,   setRevealed]   = useState(false);
  const [bankCount,  setBankCount]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [flash,      setFlash]      = useState(null);
  const [winner,     setWinner]     = useState(null);

  useEffect(() => {
    getBankCount().then(d => setBankCount(d.count)).catch(() => {});
  }, []);

  const loadCategoryOptions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getCategories();
      setCatOptions(data.categories);
      setState(S.CHOOSING);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCategoryOptions(); }, [loadCategoryOptions]);

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

  // Team picks a category from the choosing screen
  const handlePickCategory = async (cat) => {
    getAudio(); // unlock audio context on user tap
    setLoading(true); setError(null); setChosenCat(cat);
    try {
      const isPieTurn =
        streak[active].cat === cat &&
        streak[active].n >= STREAK_NEEDED &&
        !wedges[active].includes(cat);

      const data = await getQuestion(cat, isPieTurn);
      setQuestion(data.question);
      setRevealed(false);

      if (isPieTurn) {
        // Show animated intro first
        playPieSting(getAudio());
        setState(S.PIE_INTRO);
      } else {
        setState(S.QUESTION);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // Called when pie intro animation finishes
  const handlePieIntroDone = useCallback(() => {
    setState(S.PIE);
  }, []);

  // Award wedge to a team
  const awardWedge = (teamIdx, cat, currentWedges) => {
    const newWedges = [currentWedges[0].slice(), currentWedges[1].slice()];
    if (!newWedges[teamIdx].includes(cat)) newWedges[teamIdx].push(cat);
    return newWedges;
  };

  const handleCorrect = async () => {
    await consumeQuestion();
    triggerFlash('correct');
    const newScores = [...scores];
    newScores[active] += 1;
    setScores(newScores);

    if (state === S.PIE) {
      // Win wedge
      const newWedges = awardWedge(active, chosenCat, wedges);
      setWedges(newWedges);
      playWedgeWon(getAudio());

      if (newWedges[active].length === CATEGORIES.length) {
        setWinner(active); setState(S.WINNER); return;
      }
      setStreak(prev => { const n=[...prev]; n[active]={cat:null,n:0}; return n; });
      await loadCategoryOptions();
      return;
    }

    // Regular question — update streak
    const prev = streak[active];
    const newN = prev.cat === chosenCat ? prev.n + 1 : 1;
    const newStreak = [...streak];
    newStreak[active] = { cat: chosenCat, n: newN };
    setStreak(newStreak);

    if (newN >= STREAK_NEEDED && !wedges[active].includes(chosenCat)) {
      // Pie unlocked — fetch pie question then show intro
      setLoading(true);
      try {
        const data = await getQuestion(chosenCat, true);
        setQuestion(data.question);
        setStreak(prev => { const n=[...prev]; n[active]={cat:null,n:0}; return n; });
        playPieSting(getAudio());
        setState(S.PIE_INTRO);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    } else {
      await loadCategoryOptions();
    }
  };

  const handleWrong = async () => {
    await consumeQuestion();
    triggerFlash('wrong');
    setStreak(prev => { const n=[...prev]; n[active]={cat:null,n:0}; return n; });

    if (state === S.PIE) {
      // Trigger steal for other team
      playStealSting(getAudio());
      setState(S.STEAL);
      return;
    }

    setActive(a => 1 - a);
    await loadCategoryOptions();
  };

  const handleSkip = async () => {
    await consumeQuestion();
    setStreak(prev => { const n=[...prev]; n[active]={cat:null,n:0}; return n; });
    await loadCategoryOptions();
  };

  // Steal: other team answers correctly
  const handleStealCorrect = async () => {
    const stealingTeam = 1 - active;
    const newScores = [...scores];
    newScores[stealingTeam] += 1;
    setScores(newScores);

    const newWedges = awardWedge(stealingTeam, chosenCat, wedges);
    setWedges(newWedges);
    playWedgeWon(getAudio());

    if (newWedges[stealingTeam].length === CATEGORIES.length) {
      setWinner(stealingTeam); setState(S.WINNER); return;
    }

    // Stealing team gets a bonus turn
    setActive(stealingTeam);
    await loadCategoryOptions();
  };

  // Steal: other team answers wrong — no wedge for anyone
  const handleStealWrong = async () => {
    setActive(a => 1 - a);
    await loadCategoryOptions();
  };

  // ── WINNER ────────────────────────────────────────────────────────────────
  if (state === S.WINNER && winner !== null) {
    return (
      <div style={css.page}>
        <style>{`@keyframes celebrate { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }`}</style>
        <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
          <div style={{ fontSize:64, animation:'celebrate 0.5s ease infinite' }}>🏆</div>
          <div style={{ fontSize:11, letterSpacing:6, color:TEAMS[winner].color, fontFamily:'monospace' }}>WINNER</div>
          <div style={{ fontSize:40, color:'#fff', fontWeight:900 }}>{TEAMS[winner].emoji} {TEAMS[winner].label}</div>
          <div style={{ fontSize:12, color:'#555', fontFamily:'monospace' }}>ALL {CATEGORIES.length} WEDGES COLLECTED</div>
          <PieDisplay wedges={wedges[winner]} size={150} />
          <div style={{ display:'flex', gap:32, marginTop:8 }}>
            {TEAMS.map((t,i) => (
              <div key={i} style={{ textAlign:'center' }}>
                <div style={{ color:t.color, fontSize:11, fontFamily:'monospace' }}>{t.emoji} {t.label.toUpperCase()}</div>
                <div style={{ color:'#fff', fontSize:28, fontWeight:900, fontFamily:'monospace' }}>{scores[i]}</div>
                <div style={{ color:'#444', fontSize:10, fontFamily:'monospace' }}>{wedges[i].length}/{CATEGORIES.length} wedges</div>
              </div>
            ))}
          </div>
          <button onClick={() => window.location.reload()} style={css.btn('#555')}>↺ PLAY AGAIN</button>
        </div>
      </div>
    );
  }

  const catData      = chosenCat ? { color: CAT_COLORS[chosenCat], emoji: CAT_EMOJI[chosenCat] } : null;
  const isPieState   = state === S.PIE;
  const currentStreak = streak[active];

  return (
    <div style={css.page}>
      {/* Pie intro overlay */}
      {state === S.PIE_INTRO && chosenCat && (
        <PieIntro category={chosenCat} teamIdx={active} onDone={handlePieIntroDone} />
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
        {bankCount !== null && bankCount < 250 && (
          <div style={{ fontSize:10, color:'#ef4444', fontFamily:'monospace', marginTop:3 }}>
            ⚠️ Refilling question bank...
          </div>
        )}
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
            {/* Streak tracker for this team */}
            <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:3, marginTop:2 }}>
              {CATEGORIES.map(cat => {
                const owned = wedges[i].includes(cat);
                const s = streak[i].cat === cat ? streak[i].n : 0;
                const pieReady = s >= STREAK_NEEDED && !owned;
                return (
                  <div key={cat} style={{ display:'flex', alignItems:'center', gap:5, opacity: owned ? 0.4 : 1 }}>
                    <span style={{ fontSize:10 }}>{CAT_EMOJI[cat]}</span>
                    <div style={{ flex:1, height:5, background:'#1a1a1a', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ height:'100%', width: owned ? '100%' : `${(s/STREAK_NEEDED)*100}%`, background: owned ? '#444' : pieReady ? '#fbbf24' : t.color, borderRadius:3, transition:'width 0.3s' }} />
                    </div>
                    {owned && <span style={{ fontSize:9, color:'#444' }}>✓</span>}
                    {pieReady && <span style={{ fontSize:9, color:'#fbbf24' }}>🥧</span>}
                    {!owned && s > 0 && !pieReady && <span style={{ fontSize:9, color:t.color }}>{s}/{STREAK_NEEDED}</span>}
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
          ⚠ {error} <button onClick={loadCategoryOptions} style={{ marginLeft:8, color:'#888', background:'none', border:'none', cursor:'pointer', fontFamily:'monospace', fontSize:11 }}>retry</button>
        </div>
      )}
      {loading && <div style={{ color:'#333', fontFamily:'monospace', fontSize:11, marginBottom:10 }}>Loading...</div>}

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
              const alreadyOwned = wedges[active].includes(cat);
              const streakInCat  = streak[active].cat === cat ? streak[active].n : 0;
              const pieReady     = streakInCat >= STREAK_NEEDED && !alreadyOwned;
              return (
                <button key={cat} onClick={() => handlePickCategory(cat)} disabled={loading} style={{
                  padding:'22px 24px', borderRadius:12,
                  border:`2px solid ${pieReady ? '#fbbf24' : CAT_COLORS[cat]+'55'}`,
                  background: pieReady ? '#fbbf2410' : `${CAT_COLORS[cat]}10`,
                  color:'#fff', cursor:'pointer', textAlign:'left',
                  display:'flex', alignItems:'center', gap:16,
                }}>
                  <span style={{ fontSize:36 }}>{CAT_EMOJI[cat]}</span>
                  <div>
                    <div style={{ fontSize:20, fontWeight:700, color: pieReady ? '#fbbf24' : CAT_COLORS[cat] }}>{cat}</div>
                    <div style={{ fontSize:13, color:'#555', fontFamily:'monospace', marginTop:4 }}>
                      {alreadyOwned ? '✓ wedge owned' : pieReady ? '🥧 PIE QUESTION READY!' : streakInCat > 0 ? `🔥 ${streakInCat}/${STREAK_NEEDED} — one more for pie!` : 'tap to play'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── QUESTION / PIE QUESTION ── */}
      {(state === S.QUESTION || state === S.PIE) && question && (
        <div style={{
          width:'100%', maxWidth:540,
          background: flash==='correct' ? '#0a1a0a' : flash==='wrong' ? '#1a0a0a' : isPieState ? '#100e08' : '#111',
          border:`1px solid ${isPieState ? '#fbbf2433' : catData?.color+'1a'}`,
          borderLeft:`4px solid ${isPieState ? '#fbbf24' : catData?.color}`,
          borderRadius:10, padding:'18px 16px',
          transition:'background 0.3s',
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:9, color:isPieState?'#fbbf24':catData?.color, fontFamily:'monospace', letterSpacing:2, textTransform:'uppercase' }}>
              {isPieState ? '🥧 PIE QUESTION' : `${catData?.emoji} ${chosenCat}`}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {question.canadian && <div style={{ fontSize:8, color:'#cc000099', fontFamily:'monospace' }}>🍁</div>}
              {!isPieState && (
                <button onClick={handleSkip} disabled={loading} style={{ padding:'2px 8px', borderRadius:3, border:'1px solid #222', background:'transparent', color:'#333', cursor:'pointer', fontSize:9, fontFamily:'monospace' }}>
                  SKIP
                </button>
              )}
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
            <button onClick={() => setRevealed(true)} style={{
              width:'100%', padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', letterSpacing:2,
              border:`1px solid ${isPieState?'#fbbf2433':catData?.color+'33'}`,
              background:isPieState?'#fbbf2408':`${catData?.color}08`,
              color:isPieState?'#fbbf24':catData?.color,
            }}>REVEAL ANSWER</button>
          ) : (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleCorrect} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #14532d', background:'rgba(34,197,94,0.07)', color:'#4ade80' }}>
                ✓ CORRECT{isPieState?' · WIN WEDGE':' · KEEP GOING'}
              </button>
              <button onClick={handleWrong} disabled={loading} style={{ flex:1, padding:'14px', borderRadius:7, cursor:'pointer', fontSize:15, fontFamily:'monospace', border:'1px solid #7f1d1d', background:'rgba(239,68,68,0.07)', color:'#f87171' }}>
                {isPieState ? '✗ WRONG · STEAL?' : '✗ WRONG · SWITCH'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Rules */}
      <div style={{ marginTop:12, maxWidth:540, width:'100%', padding:'8px 12px', borderRadius:7, background:'#0d0d0d', border:'1px solid #131313' }}>
        <div style={{ fontSize:9, color:'#222', fontFamily:'monospace', textAlign:'center', lineHeight:1.9 }}>
          PICK A CATEGORY · {STREAK_NEEDED} IN A ROW → PIE QUESTION · WIN PIE = WEDGE<br/>
          WRONG ON PIE → OTHER TEAM CAN STEAL · STEAL CORRECT = WEDGE + BONUS TURN<br/>
          COLLECT ALL {CATEGORIES.length} WEDGES TO WIN
        </div>
      </div>

      <button onClick={() => window.location.reload()} style={{ marginTop:12, padding:'5px 14px', borderRadius:4, border:'1px solid #181818', background:'transparent', color:'#222', cursor:'pointer', fontFamily:'monospace', fontSize:9 }}>
        ↺ RESET
      </button>
    </div>
  );
}

const css = {
  page: { minHeight:'100vh', background:'#0a0a0a', fontFamily:'Georgia,serif', display:'flex', flexDirection:'column', alignItems:'center', padding:'12px 10px 40px' },
  btn:  (color) => ({ padding:'11px 28px', borderRadius:8, border:`1px solid ${color}`, background:'#111', color:'#aaa', cursor:'pointer', fontFamily:'monospace', fontSize:12, letterSpacing:2 }),
};
