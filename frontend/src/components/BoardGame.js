import {playWedgeWon,createAudioCtx,playCorrect,playIncorrect,playDiceRoll} from './game-audio';
import React, {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {getQuestion,markAnswered} from '../api';
import {BOARD,CATS,COLORS,destinations,rollDie} from './board-rules';
import './BoardGame.css';
const TEAMS=[{name:'Boys',token:'👦',color:'#429bf5'},{name:'Girls',token:'👧',color:'#ec78b2'}];
function TokenIcon({team=0,x,y}){const girl=team===1;return <svg x={x} y={y} width="40" height="40" viewBox="0 0 40 40" aria-label={girl?'Girl token':'Boy token'} role="img"><path d={girl?'M8 22C5 3 34 0 33 24L35 31H5Z':'M8 20V12C8 0 33 1 32 17L29 22Z'} fill={girl?'#613d2d':'#59442b'}/><path d="M6 40Q8 27 20 27Q33 27 35 40" fill={girl?'#ffafd4':'#9bd3ff'}/><ellipse cx="20" cy="18" rx="10" ry="12" fill="#f5c9a1"/><path d={girl?'M10 13Q17 14 23 6Q27 12 31 14L29 7 18 4 10 8Z':'M10 13L12 7 23 5 30 10 28 13 20 9 15 13Z'} fill={girl?'#613d2d':'#59442b'}/><circle cx="16" cy="19" r="1.2" fill="#382a27"/><circle cx="24" cy="19" r="1.2" fill="#382a27"/><path d="M16 24Q20 27 24 24" fill="none" stroke="#ab6254" strokeWidth="1.4"/></svg>;}
function Die({value}){const patterns={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};return <span className="die-face" role="img" aria-label={`Dice: ${value}`}>{Array.from({length:9},(_,i)=><i key={i} style={{visibility:patterns[value].includes(i)?'visible':'hidden'}}/>)}</span>;}
const KEY_CATEGORIES=['Geography','TV, Movies & Music','History','Science & Nature','Sports & Games','Pop Culture & Current Events'];
function PieTracker({wedges=[],team=0,small=false}){
 const id='pie-shine-'+team+(small?'-small':'');
 return <svg className={small?'pie-tracker small-pie':'pie-tracker'} viewBox="0 0 120 120" role="img" aria-label={`${TEAMS[team].name}: ${wedges.length} of 6 pies`}>
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="white" stopOpacity=".42"/><stop offset=".5" stopColor="white" stopOpacity="0"/><stop offset="1" stopColor="black" stopOpacity=".25"/></linearGradient></defs>
  <circle cx="60" cy="60" r="57" fill="#247e8c" stroke="#7cd9de" strokeWidth="3"/>
  {KEY_CATEGORIES.map((cat,i)=>{const start=(i*60-150)*Math.PI/180,end=start+Math.PI/3;const x1=60+49*Math.cos(start),y1=60+49*Math.sin(start),x2=60+49*Math.cos(end),y2=60+49*Math.sin(end);const d=`M60 60 L${x1} ${y1} A49 49 0 0 1 ${x2} ${y2} Z`;const earned=wedges.includes(cat);return <g key={cat} className={earned?'earned-pie':'empty-pie'}><title>{cat}: {earned?'collected':'empty'}</title><path d={d} fill={earned?COLORS[cat]:'#102c35'} stroke="#68bdc8" strokeWidth="4" strokeLinejoin="round"/>{earned&&<path d={d} fill={`url(#${id})`} pointerEvents="none"/>}</g>;})}
  <circle cx="60" cy="60" r="8" fill="#58b3c0"/>
 </svg>;
}
function CategoryCard(){return <section className="category-card" aria-label="Category colour key"><div className="category-card-spine"><span>Trivial Pursuit</span></div><div className="category-card-list">{KEY_CATEGORIES.map(cat=><div className="category-key-row" key={cat}><i style={{background:COLORS[cat]}} aria-hidden="true"/><span>{cat}</span></div>)}</div></section>;}
const SAVE='trivial-pursuit-board-v1';
const fresh=()=>({phase:'intro',active:0,positions:['hub','hub'],wedges:[[],[]],scores:[0,0],roll:null,question:null,category:null,pie:false,final:false,steal:false,stealFrom:null,revealed:false,challenge:false,pendingId:null});
function restore(){try{const g=JSON.parse(localStorage.getItem(SAVE));if(g&&g.version===1&&g.positions.every(p=>BOARD[p])&&['board','move','question','category','landing','stealPick','rolloff','rolloffResult','challengeOffer','challengePick','wedgeWin','winner'].includes(g.phase))return g;}catch{}return fresh();}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function arc(r,a){return [500+r*Math.cos(a),500+r*Math.sin(a)];}
function cellPath(i){const a=(i-.5)*Math.PI/21,b=(i+.5)*Math.PI/21;const p=[arc(374,a),arc(466,a),arc(466,b),arc(374,b)];return `M${p[0]} L${p[1]} A466 466 0 0 1 ${p[2]} L${p[3]} A374 374 0 0 0 ${p[0]} Z`;}
function Board({game,allowed,onMove,mini=false}){
 const targets=new Set(allowed);
 const click=(node)=>()=>targets.has(node.id)&&onMove(node.id);
 const accessible=node=>({role:targets.has(node.id)?'button':undefined,tabIndex:targets.has(node.id)?0:undefined,
   'aria-label':`${node.kind==='hub'?'Centre':node.category}${node.kind==='pie'?' wedge space':node.kind==='roll'?' roll again':''}${targets.has(node.id)?', move here':''}`,
   onClick:click(node),onKeyDown:e=>{if(targets.has(node.id)&&['Enter',' '].includes(e.key)){e.preventDefault();onMove(node.id);}}});
 return <svg className={`game-board ${mini?'mini-board':''}`} viewBox="0 0 1000 1000" aria-label="Trivial Pursuit game board">
  <defs><radialGradient id="felt"><stop stopColor="#183c43"/><stop offset="1" stopColor="#06151d"/></radialGradient>
  <filter id="spaceGlow"><feGaussianBlur stdDeviation="5"/></filter></defs>
  <image href="/trivial-pursuit-board.webp" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>
  <g opacity="0">
  <circle cx="500" cy="500" r="494" fill="url(#felt)" stroke="#9caeb2" strokeWidth="4"/>
  {CATS.map((c,i)=>{const a=(i+.04)*Math.PI/3,b=(i+.96)*Math.PI/3;return <path key={c} d={`M500 500 L${arc(368,a)} A368 368 0 0 1 ${arc(368,b)} Z`} fill={COLORS[c]} opacity=".22"/>;})}
  <text x="500" y="275" textAnchor="middle" fill="#e5f2ef" fontSize="35" fontFamily="Georgia" fontStyle="italic">Trivial Pursuit</text>
  </g>
  {Object.values(BOARD).filter(n=>n.id!=='hub').map(node=>{
    const lit=targets.has(node.id),fill=node.kind==='roll'?'#dbe3e6':COLORS[node.category];
    return <g key={node.id} {...accessible(node)} className={lit?`board-space legal-space ${node.kind==='pie'&&!game.wedges[game.active].includes(node.category)?'missing-pie-option':''}`:'board-space'}>
      {node.id[0]==='r'?<path d={cellPath(+node.id.slice(1))} fill={lit?fill:'transparent'} stroke={lit?'#fffbd2':'#0c2330'} strokeWidth={lit?7:0}/>:<rect x={node.x-28} y={node.y-27} width="56" height="54" transform={`rotate(${node.angle*180/Math.PI},${node.x},${node.y})`} fill={lit?fill:'transparent'} stroke={lit?'#fffbd2':'#0c2330'} strokeWidth={lit?7:0}/>}
      {node.kind==='pie'&&<g opacity={lit?1:0}><circle cx={node.x} cy={node.y} r="25" fill="#142733" stroke="#f1e9c9" strokeWidth="2"/>{Array.from({length:6},(_,j)=><line key={j} x1={node.x} y1={node.y} x2={node.x+23*Math.cos(j*Math.PI/3)} y2={node.y+23*Math.sin(j*Math.PI/3)} stroke="#eee" strokeWidth="2"/>)}</g>}
      {node.kind==='roll'&&lit&&<text x={node.x} y={node.y+13} textAnchor="middle" fill="#183140" fontSize="39">⚄</text>}
      {lit&&<circle cx={node.x} cy={node.y} r="9" fill="white" stroke="#26363c" strokeWidth="2"/>}
    </g>;
  })}
  <g {...accessible(BOARD.hub)} className={targets.has('hub')?'board-space legal-space':'board-space'}><circle cx="500" cy="500" r="92" fill="transparent" stroke={targets.has('hub')?'#fffbd2':'#233d4a'} strokeWidth={targets.has('hub')?7:0}/>
    {false&&CATS.map((c,i)=><path key={c} d={`M500 500 L${arc(84,i*Math.PI/3)} A84 84 0 0 1 ${arc(84,(i+1)*Math.PI/3)} Z`} fill={COLORS[c]} stroke="#f0eee3" strokeWidth="2"/>)}</g>
  {game.positions.map((id,i)=>{const n=BOARD[id],t=TEAMS[i];const together=game.positions[0]===game.positions[1];const x=n.x+(together?(i===0?-24:24):0);return <g key={i} className="board-token" pointerEvents="none" style={{transform:`translate(${x}px,${n.y}px)`}}><circle r="27" fill={t.color} stroke="#fff" strokeWidth="4"/><TokenIcon team={i} x={-20} y={-20}/>{game.active===i&&<circle r="34" fill="none" stroke="#fff" strokeWidth="3"/>}</g>;})}
 </svg>;
}
export default function BoardGame(){
 const [game,setGame]=useState(restore),[busy,setBusy]=useState(false),[error,setError]=useState(''),[opening,setOpening]=useState(false),[rolling,setRolling]=useState(false),[die,setDie]=useState(1),[speaking,setSpeaking]=useState(false);
 const panelRef=useRef(null);
 useLayoutEffect(()=>{
  const root=panelRef.current;if(!root)return;
  const fit=()=>{
   const question=root.querySelector('.question-panel h2');if(!question)return;
   question.style.fontSize='';
   root.querySelector('.game-panel')?.classList.remove('long-question');
   if(window.innerWidth<1100)return;
   const panel=root.querySelector('.game-panel');
   const copy=root.querySelector('.question-copy');
   if(!panel||!copy)return;
   const overflowing=()=>question.getBoundingClientRect().bottom>copy.getBoundingClientRect().bottom-8||panel.scrollHeight>panel.clientHeight+1;
   if(overflowing())panel.classList.add('long-question');
   let size=parseFloat(getComputedStyle(question).fontSize);
   for(let i=0;i<44&&overflowing()&&size>12;i++){
    size-=1;question.style.fontSize=size+'px';
   }
  };
  fit();window.addEventListener('resize',fit);return()=>window.removeEventListener('resize',fit);
 },[game.phase,game.question?.question,game.revealed,error]);
 const effects=useRef(null);
 function effectsContext(){
  if(!effects.current)effects.current=createAudioCtx();
  if(effects.current?.state==='suspended')effects.current.resume().catch(()=>{});
  return effects.current;
 }
 function feedback(correct){try{(correct?playCorrect:playIncorrect)(effectsContext());}catch(e){console.warn('Sound effect unavailable',e);}}
 const audio=useRef(null),controller=useRef(null),speechSerial=useRef(0),alive=useRef(true),lock=useRef(false);
 const team=TEAMS[game.active];
 useEffect(()=>{try{if(!['intro','opening'].includes(game.phase))localStorage.setItem(SAVE,JSON.stringify({...game,phase:game.phase==='pieIntro'?'landing':game.phase,version:1}));}catch{}},[game]);
 function stopSpeech(){speechSerial.current++;controller.current?.abort();audio.current?.pause();audio.current=null;if(window.speechSynthesis)window.speechSynthesis.cancel();setSpeaking(false);}
 async function say(text,excited=false){
  stopSpeech();const serial=speechSerial.current;const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),12000);setSpeaking(true);
  let url;
  try{const r=await fetch(`${process.env.REACT_APP_API_URL||''}/api/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:game.active===0?'onyx':'nova',announcement:excited}),signal:abort.signal});if(!r.ok)throw Error('Speech unavailable');url=URL.createObjectURL(await r.blob());if(serial!==speechSerial.current)return;const a=new Audio(url);audio.current=a;await new Promise((resolve,reject)=>{a.onended=resolve;a.onerror=reject;a.play().catch(reject);});}
  catch(e){if(serial===speechSerial.current&&alive.current&&window.speechSynthesis){await new Promise(resolve=>{const u=new SpeechSynthesisUtterance(text);u.volume=1;u.pitch=excited?1.3:1;u.rate=excited?1.1:1;u.onend=resolve;u.onerror=resolve;window.speechSynthesis.speak(u);});}}
  finally{clearTimeout(timeout);if(url)URL.revokeObjectURL(url);if(serial===speechSerial.current&&alive.current)setSpeaking(false);}
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;speechSerial.current++;controller.current?.abort();audio.current?.pause();effects.current?.close().catch(()=>{});window.speechSynthesis?.cancel();};},[]);
 // No reading while the box or wedge overlays cover the question.
 useEffect(()=>{
  let cancelled=false;
  if(game.phase==='question'&&game.question)say(game.question.question);
  else if(game.phase==='challengeOffer')say(`${TEAMS[game.active].name}, do you want to challenge?`);
  else if(game.phase==='pieIntro'){
    Promise.all([say(`Pie Question for the ${TEAMS[game.active].name}!`,true),wait(3000)]).then(()=>{
      if(!cancelled&&alive.current)setGame(g=>({...g,phase:'question'}));
    });
  }else if(game.phase==='wedgeWin'){
    stopSpeech();try{playWedgeWon(effectsContext());}catch{}
    const timer=setTimeout(()=>{if(!cancelled)setGame(g=>({...g,phase:g.afterCelebrate||'board'}));},3500);
    return()=>{cancelled=true;clearTimeout(timer);stopSpeech();};
  }else stopSpeech();
  return()=>{cancelled=true;stopSpeech();};
 },[game.phase,game.question?.id,game.active]); // eslint-disable-line

 async function openBox(){if(lock.current)return;lock.current=true;setOpening(true);await Promise.all([say("Let's Play Trivial Pursuit"),wait(5200)]);if(alive.current){setGame({...fresh(),phase:'rolloff'});setOpening(false);}lock.current=false;}
 async function roll(){if(lock.current||rolling)return;lock.current=true;stopSpeech();try{playDiceRoll(effectsContext());}catch(e){console.warn('Dice sound unavailable',e);}setRolling(true);for(let i=0;i<10;i++){setDie(rollDie());await wait(80);}const n=rollDie();setDie(n);if(alive.current){setRolling(false);setGame(g=>({...g,roll:n,phase:'move'}));}lock.current=false;}
 async function firstRoll(){
  if(lock.current)return;lock.current=true;setRolling(true);stopSpeech();
  try{playDiceRoll(effectsContext());}catch{}
  for(let i=0;i<10;i++){setGame(g=>({...g,startRolls:[rollDie(),rollDie()]}));await wait(90);}
  const rolls=[rollDie(),rollDie()];
  if(alive.current){setGame(g=>({...g,phase:'rolloffResult',startRolls:rolls,starter:rolls[0]===rolls[1]?null:rolls[0]>rolls[1]?0:1}));setRolling(false);}
  lock.current=false;
 }
 async function judgePie(winner){
  if(lock.current||!game.revealed)return;effectsContext();lock.current=true;setBusy(true);setError('');stopSpeech();
  try{
   await markAnswered(game.question.id);feedback(winner!==null);
   setGame(g=>{
    const wedges=g.wedges.map(w=>[...w]),scores=[...g.scores];
    const active=winner===null?1-g.active:winner;
    if(winner!==null){
      scores[winner]++;
      if(winner!==g.active&&wedges[winner].includes(g.category)&&wedges[g.active].length){
        return {...g,scores,active:winner,stealFrom:g.active,phase:'stealPick',question:null,revealed:false,pie:false};
      }
      if(!wedges[winner].includes(g.category))wedges[winner].push(g.category);
    }
    const final=wedges[active].length===6;
    return {...g,scores,wedges,active,question:null,revealed:false,pie:false,steal:false,final,
      phase:winner===null?(final?'category':'board'):'wedgeWin',
      afterCelebrate:final?'category':'board',celebrateCategory:g.category};
   });
  }catch(e){setError('Could not save the answer. Please try again. '+e.message);}
  finally{lock.current=false;setBusy(false);}
 }
 const allowed=game.phase==='move'?destinations(game.positions[game.active],game.roll):[];
 async function ask(category,pie,final=false,isChallenge=game.challenge){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');stopSpeech();
  try{const data=await getQuestion(category,pie);if(!data.question)throw Error('No question returned');if(pie&&data.fallbackFromPie)throw Error('No pie question is available for '+category+'. Add pie questions to this category, then retry');
    // Keep landing data for retry if the bank request fails.
    const next={category,pie:pie&&!data.fallbackFromPie,final,challenge:!!isChallenge,question:data.question,revealed:false};
    if(pie&&!data.fallbackFromPie){setGame(g=>({...g,...next,phase:'pieIntro'}));return;}
    if(alive.current)setGame(g=>({...g,...next,phase:'question'}));
  }catch(e){if(alive.current)setError(e.message+' — choose Retry question.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function resolveLanding(id,isChallenge=false){
  const n=BOARD[id];stopSpeech();
  setGame(g=>({...g,phase:'landing',challenge:isChallenge,category:n.category||null,pie:!isChallenge&&n.kind==='pie',final:false,roll:null}));
  if(!isChallenge&&n.kind==='roll'){setGame(g=>({...g,phase:'board',roll:null,challenge:false}));return;}
  if(n.kind==='hub'){setGame(g=>({...g,phase:'category',final:false,challenge:isChallenge}));return;}
  await ask(n.category,!isChallenge&&n.kind==='pie',false,isChallenge);
 }
 async function move(id){
  if(lock.current||!allowed.includes(id))return;
  const positions=[...game.positions];positions[game.active]=id;
  const collision=id===game.positions[1-game.active];
  setGame(g=>({...g,positions,pendingId:id,phase:collision?'challengeOffer':'landing',challenge:false,question:null,roll:null}));
  if(!collision)await resolveLanding(id);
 }
 function removeChallengeWedge(category){
  setGame(g=>{
    if(g.phase!=='challengePick'||!g.wedges[g.removeFrom].includes(category))return g;
    const wedges=g.wedges.map(w=>[...w]);wedges[g.removeFrom]=wedges[g.removeFrom].filter(c=>c!==category);
    const active=g.afterChallengeActive,final=wedges[active].length===6;
    return {...g,wedges,active,phase:final?'category':'board',final,challenge:false,question:null,revealed:false};
  });
 }
 async function answer(correct){if(lock.current||!game.revealed)return;effectsContext();lock.current=true;setBusy(true);setError('');stopSpeech();
  try{if(!game.steal)await markAnswered(game.question.id);feedback(correct);
   setGame(g=>{
    const wedges=g.wedges.map(w=>[...w]),scores=[...g.scores];
    if(g.challenge){
      if(correct)scores[g.active]++;
      const removeFrom=correct?1-g.active:g.active,chooserTeam=1-removeFrom;
      const active=correct?g.active:1-g.active;
      return {...g,scores,question:null,revealed:false,pie:false,steal:false,
        phase:wedges[removeFrom].length?'challengePick':wedges[active].length===6?'category':'board',
        final:!wedges[removeFrom].length&&wedges[active].length===6,
        challenge:wedges[removeFrom].length>0,removeFrom,chooserTeam,afterChallengeActive:active,
        active:wedges[removeFrom].length?g.active:active};
    }
    const earned=correct&&g.pie&&!wedges[g.active].includes(g.category);
    if(correct){
      scores[g.active]++;
      if(g.steal&&wedges[g.active].includes(g.category)&&wedges[g.stealFrom].length){
        return {...g,scores,phase:'stealPick',question:null,revealed:false};
      }
      if(g.pie&&!wedges[g.active].includes(g.category))wedges[g.active].push(g.category);
    }
    const nextActive=correct||g.steal?g.active:1-g.active;
    const finalReady=wedges[nextActive].length===6;
    return {...g,wedges,scores,active:nextActive,
      phase:correct&&g.final?'winner':earned?'wedgeWin':finalReady?'category':'board',
      afterCelebrate:finalReady?'category':'board',celebrateCategory:g.category,
      question:null,revealed:false,pie:false,final:finalReady,steal:false,stealFrom:null,roll:null};
   });
  }catch(e){setError('Could not save the answer. Please try again. '+e.message);}
  finally{lock.current=false;setBusy(false);}
 }
 function stealWedge(category){
  setGame(g=>{
    if(g.phase!=='stealPick'||!g.wedges[g.stealFrom].includes(category))return g;
    const wedges=g.wedges.map(w=>[...w]);wedges[g.stealFrom]=wedges[g.stealFrom].filter(c=>c!==category);
    if(!wedges[g.active].includes(category))wedges[g.active].push(category);
    const finalReady=wedges[g.active].length===6;
    return {...g,wedges,phase:'wedgeWin',afterCelebrate:finalReady?'category':'board',celebrateCategory:category,final:finalReady,pie:false,steal:false,stealFrom:null,roll:null};
  });
 }
 function reset(){if(window.confirm('Start a new game? This clears the current board and wedges.')){stopSpeech();localStorage.removeItem(SAVE);setGame(fresh());setError('');}}
 if(game.phase==='intro')return <main className="box-stage"><h1>Trivial Pursuit</h1><p>A classic game night. Boys versus Girls.</p><div className={opening?'unboxing':'closed-box'}><img className="box-lid" src="/trivial-pursuit-box.webp" alt="Trivial Pursuit game box"/>{opening&&<img className="unboxed-board" src="/trivial-pursuit-board.webp" alt="The game board slides out of the box"/>}</div><button className="primary" disabled={opening} onClick={openBox}>{opening?"Let's Play Trivial Pursuit…":'Open the box & play'}</button></main>;
 return <main ref={panelRef} className={`board-game ${game.active===0?'boys-turn':'girls-turn'}`}>
  <header className="board-header"><div><span className="eyebrow">GAME NIGHT</span><h1>Trivial Pursuit</h1></div><div className="turn-label"><TokenIcon team={game.active}/> {team.name}’ turn</div><button className="quiet" onClick={reset} disabled={busy||rolling}>New game</button></header>
  <div className="board-layout"><section className="board-table"><Board game={game} allowed={allowed} onMove={move}/></section>
   <aside className="game-panel"><div className="team-scores">{TEAMS.map((t,i)=><div key={t.name} className={`team-score ${game.active===i?'active-team':''}`}><strong><TokenIcon team={i}/> {t.name}</strong><span>{game.scores[i]} correct</span><PieTracker wedges={game.wedges[i]} team={i}/><small>{game.wedges[i].length} / 6 wedges</small></div>)}</div>
    {error&&<div role="alert" className="error">{error}{game.phase==='landing'&&<button onClick={()=>ask(game.category,game.pie,game.final)} disabled={busy}>Retry question</button>}</div>}
    {(game.phase==='rolloff'||game.phase==='rolloffResult')&&<section className="rolloff-panel"><span className="eyebrow">WHO GOES FIRST?</span><h2>Highest roll starts</h2><div className="rolloff-dice">{TEAMS.map((t,i)=><div key={t.name}><strong>{t.name}</strong><Die value={game.startRolls?.[i]||1}/></div>)}</div>{game.phase==='rolloffResult'&&<h2 role="status">{game.starter===null?'A tie! Roll again.':`${TEAMS[game.starter].name} go first!`}</h2>}{game.phase==='rolloff'||game.starter===null?<button className="primary" disabled={rolling} onClick={firstRoll}>{rolling?'Rolling…':'Roll to see who starts'}</button>:<button className="primary" onClick={()=>setGame(g=>({...g,active:g.starter,phase:'board'}))}>Start game</button>}</section>}
    {game.phase==='board'&&<div className="turn-controls"><Die value={die}/><h2>{'Roll the die'}</h2><p>Move along the rim or take a shortcut through the centre.</p><button className="primary" onClick={roll} disabled={rolling}>{rolling?'Rolling…':'Roll die'}</button></div>}
    {game.phase==='move'&&<div className="turn-controls"><Die value={game.roll}/><h2>Move {game.roll} spaces</h2><p>Select a glowing space on the board.</p></div>}
    {game.phase==='challengeOffer'&&<section className="challenge-offer"><span className="eyebrow">SAME SPACE · CHALLENGE OPPORTUNITY</span><h2>{team.name}, do you want to challenge?</h2><p>Get it right: choose one of their pies to discard. Get it wrong: they choose one of yours to discard. No pies are transferred.</p><div className="answer-buttons"><button className="correct" disabled={busy} onClick={()=>resolveLanding(game.pendingId,true)}>Challenge!</button><button disabled={busy} onClick={()=>resolveLanding(game.pendingId,false)}>No challenge</button></div></section>}
    {game.phase==='challengePick'&&<section><span className="eyebrow">CHALLENGE RESULT</span><h2>{TEAMS[game.chooserTeam].name}, choose a {TEAMS[game.removeFrom].name} pie to discard.</h2><div className="category-buttons">{game.wedges[game.removeFrom].map(c=><button key={c} style={{borderColor:COLORS[c]}} onClick={()=>removeChallengeWedge(c)}>{c}</button>)}</div></section>}
    {game.phase==='stealPick'&&<div><span className="eyebrow">BONUS STEAL</span><h2>You already have that pie. Choose an opponent’s pie to steal.</h2><div className="category-buttons">{game.wedges[game.stealFrom].map(c=><button key={c} style={{borderColor:COLORS[c]}} onClick={()=>stealWedge(c)}>{c}</button>)}</div></div>}
    {game.phase==='category'&&<div><span className="eyebrow">{game.final?'FINAL QUESTION · OPPONENT CHOOSES':'CENTRE SPACE'}</span><h2>{game.final?`${TEAMS[1-game.active].name}, choose their final category`:'Which colour will you play?'}</h2><div className="category-buttons">{CATS.map(c=><button key={c} disabled={busy} style={{borderColor:COLORS[c]}} onClick={()=>ask(c,false,game.final)}>{c}</button>)}</div></div>}
    {game.phase==='landing'&&<div><p role="status">{busy?'Finding your question…':'Your token has landed.'}</p>{!busy&&!error&&<button className="primary" onClick={()=>ask(game.category,game.pie,game.final)}>Get question</button>}</div>}
    {game.phase==='question'&&game.question&&<section className="question-panel"><div className="question-copy"><div className="question-heading"><span className="eyebrow" style={{color:COLORS[game.category]}}>{game.challenge?'CHALLENGE QUESTION':game.final?'FINAL QUESTION':game.steal?'STEAL · '+game.category:game.pie?'WEDGE QUESTION':game.category}</span><button className="quiet" aria-label={speaking?'Stop narration':'Read question again'} onClick={()=>speaking?stopSpeech():say(game.question.question)}>{speaking?'Stop voice':'Read aloud'}</button></div><h2>{game.question.question}</h2></div>{game.revealed?<><div className="answer">{game.question.answer}</div>{game.pie&&!game.challenge?<div className="pie-judging"><button className="correct" disabled={busy} onClick={()=>judgePie(game.active)}>{team.name} got it right. Win pie!</button><button className="steal" disabled={busy} onClick={()=>judgePie(1-game.active)}>{TEAMS[1-game.active].name} got it right. Steal pie!</button><button className="wrong" disabled={busy} onClick={()=>judgePie(null)}>Both wrong — no pie</button></div>:<div className="answer-buttons"><button className="correct" disabled={busy} onClick={()=>answer(true)}>✓ Correct</button><button className="wrong" disabled={busy} onClick={()=>answer(false)}>✕ Incorrect</button></div>}</>:<button className="primary" disabled={busy} onClick={()=>{stopSpeech();setGame(g=>({...g,revealed:true}));}}>Reveal answer</button>}</section>}

    <CategoryCard/>
    <details className="board-key"><summary>Board rules</summary><p>Glowing spaces are exactly one die roll away. No reversing within a move. A die space grants another roll. Correct answers grant another turn; incorrect answers pass the turn. Wedge spaces ask a pie question. Land on your opponent to optionally challenge them: the winner chooses one of the loser’s pies to discard. A missed pie question can be stolen by the other team. If they already own that pie, they can take one of the opponent’s pies instead. Collect all six wedges to immediately enter the final round; the other team chooses your category. A correct final answer wins. A wrong final answer passes the turn; you keep your pies.</p></details>
   </aside></div>
  {game.phase==='pieIntro'&&<div className="wedge-intro" style={{'--wedge-color':COLORS[game.category]}}><div className="big-wedge">◀</div><span className="eyebrow">FOR THE WEDGE</span><h1>{game.category}</h1><p><TokenIcon team={game.active}/> {team.name}, get ready.</p></div>}
  {game.phase==='wedgeWin'&&<div className="wedge-celebration" style={{'--wedge-color':COLORS[game.celebrateCategory]}}>{Array.from({length:40},(_,i)=><i className="confetti" key={i} style={{left:`${i*2.5}%`,background:COLORS[KEY_CATEGORIES[i%6]],animationDelay:`${(i%7)*.12}s`,transform:`rotate(${i*37}deg)`}}/>)}<div className="celebration-pie"><PieTracker team={game.active} wedges={game.wedges[game.active]}/></div><span className="eyebrow">PIE WEDGE WON!</span><h1>{team.name} win {game.celebrateCategory}!</h1></div>}
  {game.phase==='winner'&&<div className="winner-overlay"><h1>{team.name} win!</h1><p>Six wedges. One final answer. Game night champions.</p><button className="primary" onClick={reset}>Play again</button></div>}
 </main>;
}
