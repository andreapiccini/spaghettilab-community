const copy = v => JSON.parse(JSON.stringify(v));
export const ACTIONS = ['PLAY / PAUSE','STOP','LOAD','SAVE','DELETE'];
export function validProfile(p) { return p?.version === 1 && Array.isArray(p.rows) && p.rows.length === 16 && p.rows.every(x => Number.isInteger(x) && x >= 0 && x <= 3); }
export class SelectOkUI {
  constructor(saved = {}) {
    this.action = Number.isInteger(saved.action) && saved.action >= 0 && saved.action < 5 ? saved.action : 0;
    this.slot = Number.isInteger(saved.slot) && saved.slot >= 0 && saved.slot < 4 ? saved.slot : 0;
    this.menu = saved.menu === 'slot' && this.action >= 2 ? 'slot' : 'action';
    this.draft = Array.isArray(saved.draft) && saved.draft.length === 16 && saved.draft.every(v => Number.isInteger(v) && v >= 0 && v < 4) ? copy(saved.draft) : Array.from({length:16},(_,i)=>[1,2,3,0][i%4]);
    this.slots = Array.from({length:4},(_,i) => validProfile(saved.slots?.[i]) ? copy(saved.slots[i]) : null);
    // A newly instantiated controller starts disarmed. Hardware adapters must not restore active outputs at boot.
    this.runtime = 'STOPPED'; this.outputs = Array(16).fill(0); this.note = 'STOPPED — outputs disconnected';
    this.down = {select:false,ok:false}; this.okAt = 0; this.handled = false; this.chord = false;
  }
  snapshot() { return copy({action:this.action,slot:this.slot,menu:this.menu,draft:this.draft,slots:this.slots}); }
  stop() { this.outputs.fill(0); this.runtime='STOPPED'; this.menu='action'; this.note='STOPPED — all rows Hi-Z; working configuration retained'; }
  press(key, now) {
    if (!(key in this.down) || this.down[key]) return false;
    this.down[key]=true;
    if (this.down.select && this.down.ok) { this.chord=true;this.handled=true;this.stop();return true; }
    if (key==='ok') {this.okAt=now;this.handled=false;}
    return false;
  }
  tick(now) {
    if (!this.chord && this.down.ok && !this.handled && this.menu==='slot' && this.action===4 && now-this.okAt>=2000) {
      this.slots[this.slot]=null;this.note='Slot '+(this.slot+1)+' deleted; working configuration unchanged';this.menu='action';this.handled=true;return true;
    }
    return false;
  }
  release(key, now) {
    if (!(key in this.down) || !this.down[key]) return false;
    const ticked = key==='ok' ? this.tick(now) : false;
    this.down[key]=false;
    if (this.chord) {if(!this.down.select&&!this.down.ok)this.chord=false;return ticked;}
    if (key==='select') {
      if(this.menu==='slot')this.slot=(this.slot+1)%4;else this.action=(this.action+1)%5;
      this.note=this.menu==='slot'?'Choose slot '+(this.slot+1):ACTIONS[this.action];return true;
    }
    if (!this.handled) {this.confirm();return true;}
    return ticked;
  }
  cancel() { this.down={select:false,ok:false};this.chord=false;this.handled=false; }
  confirm() {
    if (this.action===0) {
      if(this.runtime==='RUNNING'){this.runtime='PAUSED';this.note='PAUSED — row outputs remain active';}
      else {this.outputs=copy(this.draft);this.runtime='RUNNING';this.note='RUNNING — configuration applied';}
      return;
    }
    if(this.action===1){this.stop();return;}
    if(this.menu==='action'){this.menu='slot';this.note='Choose slot1–4, then OK'+(this.action===4?' held2s':'');return;}
    if(this.action===2){
      const p=this.slots[this.slot];if(!validProfile(p)){this.note='Slot '+(this.slot+1)+' empty or invalid — nothing changed';return;}
      const draft=copy(p.rows);this.stop();this.draft=draft;this.note='Slot '+(this.slot+1)+' loaded — press PLAY to activate';
    } else if(this.action===3){this.slots[this.slot]={version:1,rows:copy(this.draft)};this.menu='action';this.note='Configuration saved in slot '+(this.slot+1);}
    else this.note='Hold OK2s to delete slot '+(this.slot+1);
  }
  cycleRow(i) { if(!Number.isInteger(i)||i<0||i>=16)return;this.draft[i]=(this.draft[i]+1)%4;if(this.runtime==='RUNNING')this.outputs=copy(this.draft);this.note=(i<8?'A':'B')+(i%8+1)+' · '+['Hi-Z','3.3V','GND','MCU'][this.draft[i]]; }
}
