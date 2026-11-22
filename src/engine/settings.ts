import type { QualityName } from './quality.ts';

export interface Settings {
  sensitivity: number;      // multiplier on the base look speed
  invertY: boolean;
  fov: number;              // horizontal-ish vertical fov in degrees (camera.fov)
  volume: number;           // master 0..1
  musicVolume: number;
  quality: QualityName;
  resolutionScale: number;  // 0.5..1 extra scale on top of the quality profile
  dynamicRes: boolean;
  showFps: boolean;
  crosshairColor: string;
  crosshairSize: number;
  crosshairGap: number;
  highContrastTeams: boolean;  // accessibility: stronger enemy / team outlines
  reduceMotion: boolean;       // accessibility: no head-bob / camera shake
  name: string;
  keys: Record<string, string>;
}

export const DEFAULT_KEYS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', walk: 'ShiftLeft',
  reload: 'KeyR', use: 'KeyE', buy: 'KeyB', scoreboard: 'Tab', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', lastWeapon: 'KeyQ', inspect: 'KeyF', spectateNext: 'KeyV',
};

export const KEY_LABELS: Record<string, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump', crouch: 'Crouch (hold)', walk: 'Walk (hold)',
  reload: 'Reload', use: 'Use / plant / disarm', buy: 'Buy menu', scoreboard: 'Scoreboard (hold)', slot1: 'Primary weapon', slot2: 'Sidearm', slot3: 'Knife', lastWeapon: 'Previous weapon', inspect: 'Inspect weapon', spectateNext: 'Spectate next',
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1, invertY: false, fov: 78, volume: 0.7, musicVolume: 0.35, quality: 'medium', resolutionScale: 1, dynamicRes: true, showFps: false,
  crosshairColor: '#7dff9b', crosshairSize: 1, crosshairGap: 1, highContrastTeams: false, reduceMotion: false, name: '', keys: { ...DEFAULT_KEYS },
};

const KEY = 'hillfront.settings.v1';
let current: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

function safeGet(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function safeSet(v: string) { try { localStorage.setItem(KEY, v); } catch { /* private mode / blocked storage: settings simply do not persist */ } }

export function loadSettings(): Settings {
  if (current) return current;
  let s: Settings = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
  const raw = safeGet();
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<Settings>;
      s = { ...s, ...p, keys: { ...DEFAULT_KEYS, ...(p.keys ?? {}) } };
    } catch { /* corrupt: fall back to defaults */ }
  }
  s = sanitize(s);
  current = s;
  return s;
}

function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, Number.isFinite(v) ? v : a)); }
export function sanitize(s: Settings): Settings {
  s.sensitivity = clamp(s.sensitivity, 0.1, 5); s.fov = clamp(s.fov, 60, 110); s.volume = clamp(s.volume, 0, 1); s.musicVolume = clamp(s.musicVolume, 0, 1);
  s.resolutionScale = clamp(s.resolutionScale, 0.4, 1); s.crosshairSize = clamp(s.crosshairSize, 0.4, 3); s.crosshairGap = clamp(s.crosshairGap, 0, 4);
  if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'medium';
  s.name = String(s.name ?? '').replace(/[^\w \-.]/g, '').slice(0, 16);
  return s;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = sanitize({ ...loadSettings(), ...patch, keys: { ...loadSettings().keys, ...(patch.keys ?? {}) } });
  current = s;
  safeSet(JSON.stringify(s));
  for (const l of listeners) l(s);
  return s;
}

export function onSettings(fn: (s: Settings) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function resetSettings(): Settings { current = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } return loadSettings(); }

export function keyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl').replace('Space', 'Space').replace('Tab', 'Tab').replace('ArrowUp', '↑').replace('ArrowDown', '↓');
}
