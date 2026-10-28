// A classic wheel: 42 rim spaces, six five-space spokes, and a central hub.
const CATS = ['History','TV, Movies & Music','Science & Nature','Sports & Games','Geography','Pop Culture & Current Events'];
const RIM = [0,3,null,2,5,null,4,1,4,null,3,0,null,5,2,5,null,4,1,null,0,3,0,null,5,2,null,1,4,1,null,0,3,null,2,5,2,null,1,4,null,3];
const SPOKES = [[5,1,2,4,3],[0,2,3,5,4],[1,3,4,0,5],[2,4,5,1,0],[3,5,0,2,1],[4,0,1,3,2]];
const COLORS = {'History':'#edca28','TV, Movies & Music':'#dc468b','Science & Nature':'#29986b','Sports & Games':'#8662ae','Geography':'#388ec9','Pop Culture & Current Events':'#d66c27'};
const BOARD = {hub:{id:'hub',x:500,y:500,kind:'hub',neighbors:[]}};
const point = (r,a) => ({x:500+r*Math.cos(a),y:500+r*Math.sin(a)});
for(let i=0;i<42;i++) {
  const sector=Math.floor(i/7), offset=i%7;
  const kind=offset===0?'pie':offset===2||offset===5?'roll':'category';
  BOARD['r'+i]={id:'r'+i,...point(420,i*Math.PI/21),angle:i*Math.PI/21,
    kind,category:CATS[RIM[i] === null ? sector : RIM[i]],neighbors:['r'+((i+41)%42),'r'+((i+1)%42)]};
}
for(let arm=0;arm<6;arm++) {
  for(let step=1;step<=5;step++) {
    const id=`s${arm}-${step}`,prev=step===1?'hub':`s${arm}-${step-1}`,next=step===5?'r'+(arm*7):`s${arm}-${step+1}`;
    BOARD[id]={id,...point(64+step*53,arm*Math.PI/3),kind:'category',category:CATS[SPOKES[arm][step-1]],neighbors:[prev,next],angle:arm*Math.PI/3};
  }
  BOARD.hub.neighbors.push(`s${arm}-1`);
  BOARD['r'+(arm*7)].neighbors.push(`s${arm}-5`);
}
function destinations(start,roll) {
  if(!BOARD[start]||!Number.isInteger(roll)||roll<1||roll>6)return [];
  const targets=new Set();
  function walk(id,left,path) {
    if(!left){targets.add(id);return;}
    for(const next of BOARD[id].neighbors)if(!path.has(next))walk(next,left-1,new Set([...path,next]));
  }
  walk(start,roll,new Set([start]));return [...targets];
}
function rollDie(random=Math.random){return Math.floor(random()*6)+1;}
module.exports={BOARD,CATS,COLORS,destinations,rollDie};
