// Keyboard, gamepad and touch input -> a single { throttle, brake, steer, handbrake, boost } struct.
import { clamp } from './car.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, boost: false, hand: false };
    this.pressed = new Set(); // edge-triggered actions: 'camera' | 'reset' | 'pause' | 'mute'
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.pad = { prev: {} };
    this.usingTouch = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.isGameKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      if (this.isGameKey(e.code)) e.preventDefault();
      if (e.code === 'KeyC') this.pressed.add('camera');
      if (e.code === 'KeyR') this.pressed.add('reset');
      if (e.code === 'KeyP' || e.code === 'Escape') this.pressed.add('pause');
      if (e.code === 'KeyM') this.pressed.add('mute');
      if (e.code === 'Enter') this.pressed.add('confirm');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
  }

  isGameKey(code) {
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code);
  }

  /** Wire an on-screen button element to a touch flag. */
  bindTouch(el, flag, action) {
    const on = (e) => { e.preventDefault(); this.usingTouch = true; if (flag) this.touch[flag] = true; if (action) this.pressed.add(action); el.classList.add('down'); };
    const off = (e) => { e.preventDefault(); if (flag) this.touch[flag] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  consume(action) { return this.pressed.delete(action); }

  update() {
    const k = this.keys, t = this.touch;
    let throttle = (k.has('ArrowUp') || k.has('KeyW') || t.gas) ? 1 : 0;
    let brake = (k.has('ArrowDown') || k.has('KeyS') || t.brake) ? 1 : 0;
    let steer = ((k.has('ArrowRight') || k.has('KeyD') || t.right) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA') || t.left) ? 1 : 0);
    let handbrake = k.has('Space') || t.hand;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;

    // gamepad (first connected pad)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads || []).find((p) => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = clamp((Math.abs(ax) - 0.12) / 0.88, 0, 1) * Math.sign(ax);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) throttle = 1; // A also accelerates
      if (gp.buttons[1] && gp.buttons[1].pressed) brake = 1;
      if (gp.buttons[2] && gp.buttons[2].pressed) handbrake = true;
      if (gp.buttons[5] && gp.buttons[5].pressed) boost = true;
      const edge = (i, action) => { const p = !!(gp.buttons[i] && gp.buttons[i].pressed); if (p && !this.pad.prev[i]) this.pressed.add(action); this.pad.prev[i] = p; };
      edge(3, 'camera'); edge(4, 'reset'); edge(9, 'pause');
    }

    this.state.throttle = throttle; this.state.brake = brake;
    this.state.steer = steer; this.state.handbrake = handbrake; this.state.boost = boost;
    return this.state;
  }
}
