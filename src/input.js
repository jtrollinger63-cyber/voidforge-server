// Keyboard, gamepad, touch and tilt input -> { throttle, brake, steer(+right), handbrake, boost }.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor() {
    this.keys = new Set(); this.touch = { left: false, right: false, gas: false, brake: false, boost: false, hand: false };
    this.pressed = new Set(); this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.pad = { prev: {} }; this.usingTouch = false; this.steerSens = 1; this.tilt = false; this.tiltVal = 0; this.enabled = true; this.touchSteer = 0;
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const tag = (e.target && e.target.tagName) || ''; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (this.isGameKey(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.pressed.add('camera'); if (e.code === 'KeyR') this.pressed.add('reset');
      if (e.code === 'KeyP' || e.code === 'Escape') this.pressed.add('pause'); if (e.code === 'KeyM') this.pressed.add('mute');
      if (e.code === 'Enter' || e.code === 'Space') this.pressed.add('confirm');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    addEventListener('deviceorientation', (e) => { if (!this.tilt) return; const g = e.gamma || 0, b = e.beta || 0, land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight; this.tiltVal = clamp((land ? (window.orientation === -90 ? -b : b) : g) / 28, -1, 1); });
  }
  isGameKey(c) { return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(c) && document.activeElement === document.body || ['Space', 'ArrowUp', 'ArrowDown'].includes(c) && document.activeElement && document.activeElement.tagName === 'CANVAS'; }
  /** Wire an on-screen element to a touch flag / action. */
  bindTouch(el, flag, action) {
    const on = (e) => { e.preventDefault(); this.usingTouch = true; if (flag) this.touch[flag] = true; if (action) this.pressed.add(action); el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } };
    const off = (e) => { e.preventDefault(); if (flag) this.touch[flag] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off); el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  consume(a) { return this.pressed.delete(a); }
  update() {
    const k = this.keys, t = this.touch;
    let throttle = k.has('ArrowUp') || k.has('KeyW') || t.gas ? 1 : 0, brake = k.has('ArrowDown') || k.has('KeyS') || t.brake ? 1 : 0;
    let steer = ((k.has('ArrowRight') || k.has('KeyD') || t.right) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA') || t.left) ? 1 : 0);
    let handbrake = k.has('Space') || t.hand, boost = k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;
    if (this.tilt && this.usingTouch) steer = this.tiltVal;
    const pads = navigator.getGamepads ? navigator.getGamepads() : []; const gp = Array.from(pads || []).find((p) => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.1) steer = clamp((Math.abs(ax) - 0.1) / 0.9, 0, 1) ** 1.3 * Math.sign(ax);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0; if (rt > 0.04) throttle = Math.max(throttle, rt); if (lt > 0.04) brake = Math.max(brake, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) throttle = 1; if (gp.buttons[1] && gp.buttons[1].pressed) brake = 1; if (gp.buttons[2] && gp.buttons[2].pressed) handbrake = true; if (gp.buttons[5] && gp.buttons[5].pressed) boost = true;
      const edge = (i, a) => { const p = !!(gp.buttons[i] && gp.buttons[i].pressed); if (p && !this.pad.prev[i]) this.pressed.add(a); this.pad.prev[i] = p; }; edge(3, 'camera'); edge(4, 'reset'); edge(9, 'pause');
    }
    this.state.throttle = throttle; this.state.brake = brake; this.state.steer = clamp(steer * this.steerSens, -1, 1); this.state.handbrake = handbrake; this.state.boost = boost;
    return this.state;
  }
}
