import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeLog } from './safe-log.js';
test('disk exhaustion cannot abort an action; retries back off and recover', () => {
  let now=0, fail=true, writes=0, submitted=false; const lines:string[]=[];
  const log=new SafeLog('/unused',{now:()=>now,stdout:()=>{},append:(_p,text)=>{writes++;if(fail)throw Object.assign(new Error('full'),{code:'ENOSPC'});lines.push(text)}});
  const action=()=>{log.json('decisions',{bid:10n});submitted=true};
  assert.doesNotThrow(action);assert.equal(submitted,true);
  now=1000;action();assert.equal(writes,1);
  now=30000;fail=false;action();assert.equal(writes,2);
  assert.equal(JSON.parse(lines[0]!).telemetryDropped,2);
  assert.equal(JSON.parse(lines[0]!).bid,10);
  now=30001;action();assert.equal(JSON.parse(lines[1]!).telemetryDropped,undefined);
});
test('broken stdout is independent of JSON logging and never escapes',()=>{
  let jsonWrites=0,textWrites=0;
  const log=new SafeLog('/unused',{now:()=>0,stdout:()=>{textWrites++;throw new Error('EPIPE')},append:()=>{jsonWrites++}});
  assert.doesNotThrow(()=>{log.text('bid');log.text('word');log.json('matches',{score:50})});
  assert.equal(textWrites,1);assert.equal(jsonWrites,1);
});
