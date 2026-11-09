import assert from 'node:assert/strict';
import {SelectOkUI} from './select-ok-ui.mjs';
let t=0;const tap=(u,k)=>{u.press(k,t);u.release(k,t+=50);t+=50;};const action=(u,n)=>{u.menu='action';while(u.action!==n)tap(u,'select');};
const u=new SelectOkUI();assert(u.outputs.every(x=>x===0));action(u,3);tap(u,'ok');tap(u,'select');tap(u,'ok');assert.equal(u.slot,1);assert.deepEqual(u.slots[1].rows,u.draft);const saved=[...u.draft];u.cycleRow(0);assert.notDeepEqual(u.draft,saved);assert.deepEqual(u.slots[1].rows,saved);
action(u,2);tap(u,'ok');tap(u,'ok');assert.deepEqual(u.draft,saved);assert.equal(u.runtime,'STOPPED');assert(u.outputs.every(x=>x===0));action(u,0);tap(u,'ok');assert.equal(u.runtime,'RUNNING');const active=[...u.outputs];tap(u,'ok');assert.equal(u.runtime,'PAUSED');assert.deepEqual(u.outputs,active);
// Deleting a profile never changes the live outputs or the working draft.
action(u,4);tap(u,'ok');tap(u,'ok');assert(u.slots[1]);u.press('ok',t);u.tick(t+1999);assert(u.slots[1]);u.tick(t+2000);assert.equal(u.slots[1],null);u.release('ok',t+2100);t+=2200;assert.deepEqual(u.outputs,active);assert.deepEqual(u.draft,saved);
// A chord suppresses pending single-key actions and aborts a save.
action(u,3);tap(u,'ok');const before=JSON.stringify(u.slots);u.press('ok',t);u.press('select',t+10);u.release('ok',t+100);u.release('select',t+110);assert.equal(u.runtime,'STOPPED');assert.equal(u.menu,'action');assert.equal(JSON.stringify(u.slots),before);assert(u.outputs.every(x=>x===0));assert.equal(u.action,3);
// Empty and corrupt loads do not replace or disarm the current configuration.
action(u,0);tap(u,'ok');const live=[...u.outputs];action(u,2);tap(u,'ok');tap(u,'ok');assert.equal(u.runtime,'RUNNING');assert.deepEqual(u.outputs,live);u.slots[u.slot]={version:99,rows:Array(16).fill(1)};tap(u,'ok');assert.deepEqual(u.outputs,live);
// A chord while holding DELETE must not delete, even after2s.
u.slots[u.slot]={version:1,rows:Array(16).fill(2)};action(u,4);tap(u,'ok');u.press('ok',t);u.press('select',t+10);u.tick(t+3000);u.release('select',t+3100);u.release('ok',t+3200);assert(u.slots[u.slot]);assert(u.outputs.every(x=>x===0));
const boot=new SelectOkUI(u.snapshot());assert.equal(boot.runtime,'STOPPED');assert(boot.outputs.every(x=>x===0));assert.equal(boot.down.ok,false);
console.log('PASS: four slots, safe load, save isolation, pause retention, delete hold, chord priority, empty/corrupt load rejection, disarmed boot');
