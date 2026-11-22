/**
 * Keyboard / mouse input with pointer lock and a fallback for frames that refuse pointer lock
 * (e.g. some embeds): arrow keys turn, and right-mouse-drag looks.
 */
import { loadSettings } from './settings.ts';

export interface InputFrame {
  fwd: number; strafe: number; jump: boolean; crouch: boolean; walk: boolean;
  fire: boolean; reload: boolean; use: boolean;
  slot: number;                 // -1 none; 0 primary 1 secondary 2 melee; 9 = previous weapon
  wheel: number;                // +1/-1 detents this frame
  inspect: boolean;
  buyPressed: boolean; scoreboard: boolean; spectateNext: boolean;
  lookX: number; lookY: number; // radians this frame
}

const BASE_SENS = 0.0022; // radians per pixel at sensitivity 1

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseButtons = 0;
  private dx = 0; private dy = 0;
  private wheelAcc = 0;
  private rmbDrag = false;
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
      if (e.button === 2) this.rmbDrag = true;
      this.onFirstClick?.();
    });
    addEventListener('mouseup', (e) => { this.mouseButtons &= ~(1 << e.button); if (e.button === 2) this.rmbDrag = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.rmbDrag) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    addEventListener('wheel', (e) => { if (this.enabled && this.locked) this.wheelAcc += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; this.onLockChange?.(false); });
  }

  /** must be called from a user gesture */
  requestLock() {
    try {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }
  exitLock() { try { document.exitPointerLock?.(); } catch { /* ignore */ } }

  isDown(code: string) { return this.down.has(code); }

  poll(dt: number): InputFrame {
    const k = loadSettings().keys;
    const s = loadSettings();
    const d = (c: string) => this.down.has(c);
    const p = (c: string) => this.pressed.has(c);
    let lookX = this.dx * BASE_SENS * s.sensitivity, lookY = this.dy * BASE_SENS * s.sensitivity * (s.invertY ? -1 : 1);
    // keyboard turning (works without pointer lock)
    const turn = 1.9 * dt;
    if (d('ArrowLeft')) lookX -= turn; if (d('ArrowRight')) lookX += turn;
    if (d('ArrowUp')) lookY -= turn * 0.8; if (d('ArrowDown')) lookY += turn * 0.8;
    this.dx = this.dy = 0;
    let slot = -1;
    if (p(k.slot1!)) slot = 0; else if (p(k.slot2!)) slot = 1; else if (p(k.slot3!)) slot = 2; else if (p(k.lastWeapon!)) slot = 9;
    const wheel = this.wheelAcc; this.wheelAcc = 0;
    const f: InputFrame = {
      fwd: (d(k.forward!) ? 1 : 0) - (d(k.back!) ? 1 : 0),
      strafe: (d(k.right!) ? 1 : 0) - (d(k.left!) ? 1 : 0),
      jump: d(k.jump!), crouch: d(k.crouch!) || d('ControlLeft'), walk: d(k.walk!),
      fire: (this.mouseButtons & 1) !== 0 && this.locked || ((this.mouseButtons & 1) !== 0 && this.lockFailed),
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
