// Read-only live experiment summary. Hash assignment is approximately random,
// not a paired match design. Never promote/reset a version automatically.
import * as fs from 'node:fs';
import * as path from 'node:path';
const version=process.argv[2]??'v2.9-ab';
const directory=process.argv[3]??'data/live';
const unique=new Map<number,any>();let malformed=0;
for(const file of fs.readdirSync(directory).filter(f=>f.startsWith('matches-'))) {
 for(const line of fs.readFileSync(path.join(directory,file),'utf8').split('\n')) {
  if(!line.trim())continue;
  try {const r=JSON.parse(line);if(r.version===version)unique.set(r.match,r);}
  catch {malformed++;}
 }
}
const arms={A:[...unique.values()].filter(r=>r.arm==='A'),B:[...unique.values()].filter(r=>r.arm==='B')};
function stats(xs:number[]){const n=xs.length,m=n?xs.reduce((a,b)=>a+b,0)/n:NaN;const variance=n>1?xs.reduce((s,x)=>s+(x-m)**2,0)/(n-1):NaN;return {n,m,variance};}
console.log(`${version}: ${unique.size} unique games; ${malformed} malformed historical log lines skipped.`);
console.log('| Arm | Games | Win% | Mean place | Bottom two% | Score | Opponents mean score |');
console.log('|---|---|---|---|---|---|---|');
for(const [name,rows]of Object.entries(arms)) {
 if(!rows.length)continue;
 const avg=(f:(r:any)=>number)=>stats(rows.map(f)).m;
 console.log(`| ${name} | ${rows.length} | ${(100*avg(r=>r.place===1?1:0)).toFixed(1)} | ${avg(r=>r.place).toFixed(2)} | ${(100*avg(r=>r.place>=5?1:0)).toFixed(1)} | ${avg(r=>r.score).toFixed(1)} | ${avg(r=>stats(r.scores.filter((s:any)=>s.bot!==88).map((s:any)=>s.score)).m).toFixed(1)} |`);
}
if(arms.A.length>=2&&arms.B.length>=2) {
 for(const key of ['place','score']) {
  const a=stats(arms.A.map(r=>r[key])),b=stats(arms.B.map(r=>r[key]));
  const h=1.96*Math.sqrt(a.variance/a.n+b.variance/b.n);
  console.log(`B-A ${key}: ${(b.m-a.m).toFixed(2)} ±${h.toFixed(2)} (approximate 95% interval; unpaired).`);
 }
}
if(Math.min(arms.A.length,arms.B.length)<50)console.log('Too few games to promote a strategy. Collect at least 50 per arm, then assess uncertainty and opponent mix; 50 is not itself evidence of a win.');
console.log('Primary criterion: better placement without more bottom-two finishes or operational failures. Reset leaderboard statistics only after choosing the winner.');
