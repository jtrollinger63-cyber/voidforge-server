/**
 * Keyboard / mouse input with pointer lock and a fallback for frames that refuse pointer lock
 * (e.g. some embeds): arrow keys turn, and the cursor steers (hold it off-centre to turn, like a joystick).
 * Right mouse button (or the Aim key) is aim-down-sights.
 */
import { loadSettings } from './settings.ts';

export interface InputFrame {
  fwd: number; strafe: number; jump: boolean; crouch: boolean; walk: boolean;
  fire: boolean; reload: boolean; use: boolean; aim: boolean;
  slot: number;                 // -1 none; 0 primary 1 secondary 2 melee; 9 = previous weapon
  wheel: number;                // +1/-1 detents this frame
  inspect: boolean;
  buyPressed: boolean; scoreboard: boolean; spectateNext: boolean;
  lookX: number; lookY: number; // radians this frame
}

/** radians per pixel at sensitivity 1.0 (~0.075 deg/px: a 600 px trackpad swipe turns ~45 deg). The first release used 0.0022, which is far too fast for a trackpad. */
const BASE_SENS = 0.0013;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseButtons = 0;
  private dx = 0; private dy = 0;
  private wheelAcc = 0;
  private lockAt = 0;
  private cx = 0; private cy = 0; private cursorSeen = false;
  /** cursor steering only starts once the cursor has been through the centre, so a cursor left at a menu button never spins the view */
  private steerArmed = false;
  locked = false;
  lockFailed = false;
  enabled = true;
  onLockChange: ((locked: boolean) => void) | null = null;
  onFirstClick: (() => void) | null = null;
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.down.delete(e.code); });
    addEventListener('blur', () => { this.down.clear(); this.mouseButtons = 0; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.mouseButtons |= 1 << e.button;
      this.onFirstClick?.();
    });
    addEventListener('mouseup', (e) => { this.mouseButtons &= ~(1 << e.button); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      this.cx = e.clientX; this.cy = e.clientY; this.cursorSeen = true;
      if (Math.abs(e.clientX - innerWidth / 2) < innerWidth * 0.06 && Math.abs(e.clientY - innerHeight / 2) < innerHeight * 0.06) this.steerArmed = true;
      if (!this.enabled || !this.locked) return;
      // browsers can emit one huge bogus delta right as the lock engages (and drivers occasionally glitch): neither is a hand movement
      if (performance.now() - this.lockAt < 120) return;
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.enabled && this.locked) this.wheelAcc += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) { this.lockFailed = false; this.lockAt = performance.now(); this.dx = this.dy = 0; }
      this.steerArmed = false;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; this.onLockChange?.(false); });
  }

  /** must be called from a user gesture */
  requestLock() {
    const plain = () => {
      try {
        const r = this.canvas.requestPointerLock?.() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { this.lockFailed = true; });
      } catch { this.lockFailed = true; }
    };
    // raw, unaccelerated movement where the browser offers it (Chrome): the OS pointer-acceleration curve makes small hand movements unpredictable
    try {
      const r = (this.canvas as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void }).requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => plain());
    } catch { plain(); }
  }
  /** pointer lock is refused here and the cursor is steering the view instead */
  get steering() { return !this.locked && this.lockFailed; }
  /** steering is available but waiting for the cursor to visit the middle of the screen */
  get steerWaiting() { return this.steering && !this.steerArmed; }
  exitLock() { try { document.exitPointerLock?.(); } catch { /* ignore */ } }

  isDown(code: string) { return this.down.has(code); }

  /** `sens` scales mouse look (aim-down-sights slows the turn rate in proportion to the zoom) */
  poll(dt: number, sens = 1): InputFrame {
    const k = loadSettings().keys;
    const s = loadSettings();
    const d = (c: string) => this.down.has(c);
    const p = (c: string) => this.pressed.has(c);
    let lookX = this.dx * BASE_SENS * s.sensitivity * sens, lookY = this.dy * BASE_SENS * s.sensitivity * sens * (s.invertY ? -1 : 1);
    // keyboard turning (works without pointer lock)
    const turn = 1.9 * dt;
    if (d('ArrowLeft')) lookX -= turn; if (d('ArrowRight')) lookX += turn;
    if (d('ArrowUp')) lookY -= turn * 0.8; if (d('ArrowDown')) lookY += turn * 0.8;
    // no pointer lock available: the cursor's distance from the centre sets the turn rate (dead zone in the middle)
    if (this.steering && this.steerArmed && this.enabled && this.cursorSeen) {
      const curve = (v: number) => { const a = Math.abs(v); if (a < 0.14) return 0; return Math.sign(v) * Math.pow(Math.min(1, (a - 0.14) / 0.86), 1.5); };
      lookX += curve((this.cx - innerWidth / 2) / (innerWidth / 2)) * 2.4 * dt * s.sensitivity * sens;
      lookY += curve((this.cy - innerHeight / 2) / (innerHeight / 2)) * 1.6 * dt * s.sensitivity * sens * (s.invertY ? -1 : 1);
    }
    this.dx = this.dy = 0;
    let slot = -1;
    if (p(k.slot1!)) slot = 0; else if (p(k.slot2!)) slot = 1; else if (p(k.slot3!)) slot = 2; else if (p(k.lastWeapon!)) slot = 9;
    const wheel = this.wheelAcc; this.wheelAcc = 0;
    const f: InputFrame = {
      fwd: (d(k.forward!) ? 1 : 0) - (d(k.back!) ? 1 : 0),
      strafe: (d(k.right!) ? 1 : 0) - (d(k.left!) ? 1 : 0),
      jump: d(k.jump!), crouch: d(k.crouch!) || d('ControlLeft'), walk: d(k.walk!),
      fire: (this.mouseButtons & 1) !== 0 && this.locked || ((this.mouseButtons & 1) !== 0 && this.lockFailed),
      aim: (((this.mouseButtons & 4) !== 0) && (this.locked || this.lockFailed)) || d(k.aim ?? 'KeyZ'),
      reload: p(k.reload!), use: d(k.use!), slot, wheel, inspect: p(k.inspect!),
      buyPressed: p(k.buy!), scoreboard: d(k.scoreboard!), spectateNext: p(k.spectateNext!) || (this.pressed.has('Click')),
      lookX, lookY,
    };
    this.pressed.clear();
    return f;
  }

  clearAll() { this.down.clear(); this.pressed.clear(); this.mouseButtons = 0; this.dx = this.dy = 0; }
  get primaryHeld() { return (this.mouseButtons & 1) !== 0; }
}
