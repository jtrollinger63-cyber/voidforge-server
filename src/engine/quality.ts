export type QualityName = 'low' | 'medium' | 'high';

export interface QualityProfile {
  name: QualityName;
  /** render scale relative to CSS pixels (dynamic resolution may lower it further) */
  renderScale: number;
  maxPixelRatio: number;
  /** off: none (blob shadows only); static: map shadow rendered ONCE; dynamic: re-rendered every frame around the player */
  shadows: 'off' | 'static' | 'dynamic';
  shadowMapSize: number;
  shadowRadius: number;      // half-extent of the sun shadow frustum around the player (m)
  antialias: boolean;
  fogFar: number;
  particles: number;         // max pooled impact/muzzle particles
  hills: boolean;
}

export const QUALITY: Record<QualityName, QualityProfile> = {
  low:    { name: 'low',    renderScale: 0.7,  maxPixelRatio: 1,   shadows: 'off', shadowMapSize: 1024, shadowRadius: 18, antialias: false, fogFar: 90,  particles: 24,  hills: false },
  medium: { name: 'medium', renderScale: 0.85, maxPixelRatio: 1,   shadows: 'static', shadowMapSize: 2048, shadowRadius: 22, antialias: false, fogFar: 120, particles: 48,  hills: true },
  high:   { name: 'high',   renderScale: 1.0,  maxPixelRatio: 1.5, shadows: 'dynamic', shadowMapSize: 2048, shadowRadius: 26, antialias: true,  fogFar: 150, particles: 96,  hills: true },
};
