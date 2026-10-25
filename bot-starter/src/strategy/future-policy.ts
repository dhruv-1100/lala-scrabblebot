// One-step policy improvement over a future-points model fitted to experts.
// Counterfactual racks are evaluated with common bank/time smoothing. No
// actual future tiles, private bids or opponent starting racks enter this code.
import { readFileSync } from 'node:fs';
import type { Dict } from '../engine/dict.js';
import type { Counts } from '../engine/letters.js';
import type { View } from '../sim/types.js';
import { playable, removeWord } from '../engine/words.js';
import type { Decision, LalaParams } from './lala.js';
import { rackSummary } from './expert-features.js';
import { predict, type Model } from './tree-model.js';
import { ExpertPolicy } from './expert-policy.js';
import { phasePrice } from './tables.js';
import { LIVE_PAID } from '../sim/agents.js';
let model: Model | null | undefined;
function load(): Model | null {
 if(model!==undefined)return model;
 try{model=JSON.parse(readFileSync(new URL('./future-model.json',import.meta.url),'utf8')).model;}
 catch{model=null;}
 return model!;
}
export function futureFeaturesFromSummary(rack: Counts,T: number,balance: number,s: number[]): number[] {
 const best:number[]=[];
 for(const start of [6,10]) {let high=0;for(let i=start;i<start+4;i++){high=Math.max(high,s[i]!);best.push(high);}}
 const counts:number[]=[];let total=0;for(let i=22;i<26;i++){total+=Math.expm1(s[i]!);counts.push(Math.log1p(total));}
 return [T,balance,...rack,s[0]!,s[1]!,s[4]!,s[5]!,...best,...counts];
}
export class FuturePolicy {
 private teacher: ExpertPolicy;
 constructor(private dict: Dict){this.teacher=new ExpertPolicy(dict);}
 private value(v: View,rack: Counts,balance: number): number {
  const m=load()!;const s=rackSummary(this.dict,rack,0,v.tracker.unseen,v.auctionsLeft);
  const x=futureFeaturesFromSummary(rack,v.auctionsLeft,balance,s);
  let total=0;
  for(const dt of [-1,0,1])for(const db of [-5,0,5]) {
   x[0]=Math.max(1,Math.min(68,v.auctionsLeft+dt));x[1]=Math.max(0,balance+db);total+=predict(m,x);
  }
  return Math.max(s[6]!,total/9);
 }
 act(v: View,p: LalaParams): Decision | null {
  if(!load())return null;
  const start=performance.now();let rack:Counts=new Uint8Array(v.rack),balance=v.balance,score=v.score;
  const words:string[]=[];
  let before=this.value(v,rack,balance);
  for(let repeat=0;repeat<4;repeat++) {
   const seen=new Set<string>();
   const candidates=playable(this.dict,rack,v.auctionsLeft>10?(p.futureMinLen??2):2,Infinity).filter(i=>{const key=[...this.dict.words[i]!].sort().join('');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
   let choice=-1,bestGain=p.futurePlayMargin??2,afterValue=before;
   for(const i of candidates){const r=removeWord(rack,this.dict.words[i]!);const after=this.value(v,r,balance+this.dict.reward[i]!);const gain=this.dict.reward[i]!+after-before;
    if(gain>bestGain){choice=i;bestGain=gain;afterValue=after;}}
   if(choice<0)break;
   const w=this.dict.words[choice]!;words.push(w);rack=removeWord(rack,w);balance+=this.dict.reward[choice]!;score+=this.dict.reward[choice]!;before=afterValue;
  }
  const plus=new Uint8Array(rack);plus[v.letter]!++;
  const marginal=Math.max(0,this.value(v,plus,balance)-before);
  const mu=Math.max(.12,Math.min(1,(this.value(v,rack,balance+20)-this.value(v,rack,Math.max(0,balance-20)))/(balance<20?balance+20:40)))*(p.futureMuScale??1);
  const prior=this.teacher.bid({...v,rack,balance,score},{...p,expertPolicy:1})??0;
  const blend=p.futureBlend??1;let bid=blend*marginal/mu+(1-blend)*prior;
  const price=phasePrice(v.round,v.letter)??LIVE_PAID[v.letter]!;
  if(v.auctionsLeft>3)bid=Math.min(bid,p.capMul*price);
  const best=(r:Counts)=>{const i=playable(this.dict,r,6,1)[0];return i===undefined?0:this.dict.reward[i]!;};
  if(best(plus)-best(rack)>=12)bid=Math.max(bid,1.4*price);
  if(v.auctionType==='FirstPrice')bid*=.85;
  bid=Math.max(0,Math.min(balance,Math.floor(bid)));
  return {words,bid,value:before,marginal,mu,ms:performance.now()-start};
 }
}
