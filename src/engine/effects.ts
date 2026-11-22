/**
 * Pooled visual effects. Everything is pre-allocated; combat never allocates per-frame.
 *   - tracers:    additive camera-facing streaks that travel along the shot line
 *   - particles:  one ShaderMaterial Points object (per-particle size + alpha): dust, sparks, blood, smoke
 *   - decals:     bullet holes in a ring buffer InstancedMesh
 *   - flashes:    short sprites (explosion, world muzzle)
 */
import * as THREE from 'three';

const TRACER_COUNT = 28;
const PARTICLES = 160;
const DECALS = 56;

interface Tracer { mesh: THREE.Mesh; t: number; life: number; sx: number; sy: number; sz: number; ex: number; ey: number; ez: number; len: number; active: boolean; }

export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private tracerNext = 0;
  private pts: THREE.Points;
  private pPos = new Float32Array(PARTICLES * 3);
  private pCol = new Float32Array(PARTICLES * 4);
  private pSize = new Float32Array(PARTICLES);
  private pVel = new Float32Array(PARTICLES * 3);
  private pLife = new Float32Array(PARTICLES);
  private pMax = new Float32Array(PARTICLES);
  private pGrav = new Float32Array(PARTICLES);
  private pGrow = new Float32Array(PARTICLES);
  private pBase = new Float32Array(PARTICLES);
  private pNext = 0;
  private decals: THREE.InstancedMesh;
  private decalNext = 0;
  private flash: THREE.Mesh;
  private flashLife = 0; private flashMax = 0.3;
  private ring: THREE.Mesh; private ringLife = 0;
  private dummy = new THREE.Object3D();
  maxParticles = PARTICLES;

  constructor() {
    // tracers
    const tg = new THREE.PlaneGeometry(1, 1);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < TRACER_COUNT; i++) {
      const m = new THREE.Mesh(tg, tm); m.visible = false; m.matrixAutoUpdate = false; m.frustumCulled = false; this.group.add(m);
      this.tracers.push({ mesh: m, t: 0, life: 0, sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0, len: 0, active: false });
    }
    // particles
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { scale: { value: 600 }, tex: { value: softDot() } },
      vertexShader: `attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; uniform sampler2D tex; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.pts = new THREE.Points(geo, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.group.add(this.pts);
    this.pLife.fill(0);
    for (let i = 0; i < PARTICLES; i++) this.pPos[i * 3 + 1] = -999;

    // decals
    const dtex = holeTexture();
    const dmat = new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 0.14), dmat, DECALS);
    this.decals.frustumCulled = false; this.decals.count = 0; this.decals.renderOrder = 2; this.group.add(this.decals);

    // explosion flash + shockwave
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.flash.visible = false; this.group.add(this.flash);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; this.group.add(this.ring);
  }

  // ------------------------------------------------------------ tracers
  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, color = 0xffe6a8) {
    const t = this.tracers[this.tracerNext++ % TRACER_COUNT]!;
    const len = Math.hypot(ex - sx, ey - sy, ez - sz);
    if (len < 1) return;
    t.sx = sx; t.sy = sy; t.sz = sz; t.ex = ex; t.ey = ey; t.ez = ez; t.len = len; t.t = 0; t.life = Math.min(0.22, len / 260 + 0.04); t.active = true; t.mesh.visible = true;
    void color;
  }

  // ------------------------------------------------------------ particles
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, grav: number, r: number, g: number, b: number, a: number) {
    const i = this.pNext++ % this.maxParticles;
    const k = i * 3;
    this.pPos[k] = x; this.pPos[k + 1] = y; this.pPos[k + 2] = z;
    this.pVel[k] = vx; this.pVel[k + 1] = vy; this.pVel[k + 2] = vz;
    this.pLife[i] = life; this.pMax[i] = life; this.pBase[i] = size; this.pGrow[i] = grow; this.pGrav[i] = grav;
    this.pCol[i * 4] = r; this.pCol[i * 4 + 1] = g; this.pCol[i * 4 + 2] = b; this.pCol[i * 4 + 3] = a;
    this.pSize[i] = size;
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: 'world' | 'player' | 'head') {
    const rnd = Math.random;
    if (kind === 'world') {
      for (let i = 0; i < 4; i++) this.spawn(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, nx * 1.2 + (rnd() - 0.5) * 1.4, ny * 1.2 + rnd() * 0.9, nz * 1.2 + (rnd() - 0.5) * 1.4, 0.55 + rnd() * 0.35, 0.16, 1.8, -0.8, 0.78, 0.72, 0.62, 0.55);
      for (let i = 0; i < 3; i++) this.spawn(x, y, z, nx * 4 + (rnd() - 0.5) * 3, ny * 4 + rnd() * 2, nz * 4 + (rnd() - 0.5) * 3, 0.14 + rnd() * 0.1, 0.05, -0.2, 9, 1, 0.82, 0.4, 1);
      this.decal(x, y, z, nx, ny, nz);
    } else {
      const n = kind === 'head' ? 9 : 6;
      for (let i = 0; i < n; i++) this.spawn(x, y, z, -nx * 0.5 + (rnd() - 0.5) * 2.4, rnd() * 1.8, -nz * 0.5 + (rnd() - 0.5) * 2.4, 0.4 + rnd() * 0.3, 0.1 + rnd() * 0.06, 0.4, 9, 0.62, 0.05, 0.05, 0.85);
    }
  }

  muzzleSmoke(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    this.spawn(x, y, z, dx * 0.7 + (Math.random() - 0.5) * 0.3, dy * 0.7 + 0.35, dz * 0.7 + (Math.random() - 0.5) * 0.3, 0.7, 0.08, 2.4, -0.2, 0.8, 0.8, 0.8, 0.28);
  }

  explosion(x: number, y: number, z: number) {
    this.flash.position.set(x, y + 0.6, z); this.flash.visible = true; this.flashLife = this.flashMax = 0.55;
    this.ring.position.set(x, y + 0.15, z); this.ring.visible = true; this.ringLife = 0.7;
    const rnd = Math.random;
    for (let i = 0; i < 38; i++) {
      const a = rnd() * Math.PI * 2, s = 2 + rnd() * 7;
      this.spawn(x, y + 0.4, z, Math.cos(a) * s, 2 + rnd() * 6, Math.sin(a) * s, 0.7 + rnd() * 1.4, 0.5 + rnd() * 0.5, 3.5, -2.5, i % 3 === 0 ? 1 : 0.28, i % 3 === 0 ? 0.55 : 0.26, i % 3 === 0 ? 0.15 : 0.24, 0.8);
    }
  }

  dustPuff(x: number, y: number, z: number) {
    for (let i = 0; i < 3; i++) this.spawn(x + (Math.random() - 0.5) * 0.4, y + 0.05, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8, 0.5, 0.14, 2, -0.4, 0.75, 0.7, 0.62, 0.35);
  }

  // ------------------------------------------------------------ decals
  private decal(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    const d = this.dummy;
    d.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    d.lookAt(x + nx, y + ny, z + nz);
    d.rotateZ(Math.random() * 6.28);
    const s = 0.7 + Math.random() * 0.6; d.scale.set(s, s, 1);
    d.updateMatrix();
    const i = this.decalNext++ % DECALS;
    this.decals.setMatrixAt(i, d.matrix);
    this.decals.count = Math.min(DECALS, Math.max(this.decals.count, i + 1));
    this.decals.instanceMatrix.needsUpdate = true;
  }
  clearDecals() { this.decals.count = 0; this.decalNext = 0; }

  // ------------------------------------------------------------ per-frame
  update(dt: number, camera: THREE.Camera) {
    // tracers
    const cp = camera.position;
    const m = new THREE.Matrix4(); // small, only built for active tracers
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      if (t.t >= t.life) { t.active = false; t.mesh.visible = false; continue; }
      const k = t.t / t.life;
      const head = Math.min(1, k * 1.15), tail = Math.max(0, head - Math.min(0.35, 4 / t.len));
      const ax = t.sx + (t.ex - t.sx) * tail, ay = t.sy + (t.ey - t.sy) * tail, az = t.sz + (t.ez - t.sz) * tail;
      const bx = t.sx + (t.ex - t.sx) * head, by = t.sy + (t.ey - t.sy) * head, bz = t.sz + (t.ez - t.sz) * head;
      let dx = bx - ax, dy = by - ay, dz = bz - az; const l = Math.hypot(dx, dy, dz) || 1e-4; dx /= l; dy /= l; dz /= l;
      const mx = (ax + bx) / 2 - cp.x, my = (ay + by) / 2 - cp.y, mz = (az + bz) / 2 - cp.z;
      // up = dir x toCam
      let ux = dy * mz - dz * my, uy = dz * mx - dx * mz, uz = dx * my - dy * mx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const w = 0.035;
      // basis: X = dir*len, Y = up*w, Z = X cross Y normalised
      const zx = dy * uz - dz * uy, zy = dz * ux - dx * uz, zz = dx * uy - dy * ux;
      m.set(dx * l, ux * w, zx, (ax + bx) / 2, dy * l, uy * w, zy, (ay + by) / 2, dz * l, uz * w, zz, (az + bz) / 2, 0, 0, 0, 1);
      t.mesh.matrix.copy(m); t.mesh.matrixWorldNeedsUpdate = true;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * 0.6);
    }
    // particles
    let any = false;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.pLife[i]! <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      const k = i * 3;
      if (this.pLife[i]! <= 0) { this.pPos[k + 1] = -999; this.pCol[i * 4 + 3] = 0; this.pSize[i] = 0; continue; }
      this.pVel[k + 1] += this.pGrav[i]! * -dt;
      this.pPos[k] += this.pVel[k]! * dt; this.pPos[k + 1] += this.pVel[k + 1]! * dt; this.pPos[k + 2] += this.pVel[k + 2]! * dt;
      if (this.pPos[k + 1]! < 0.1 && this.pGrav[i]! > 0) { this.pPos[k + 1] = 0.1; this.pVel[k] = this.pVel[k]! * 0.3; this.pVel[k + 1] = 0; this.pVel[k + 2] = this.pVel[k + 2]! * 0.3; }
      const life01 = this.pLife[i]! / this.pMax[i]!;
      this.pSize[i] = this.pBase[i]! * (1 + (1 - life01) * this.pGrow[i]!);
      this.pCol[i * 4 + 3] = Math.min(this.pCol[i * 4 + 3]!, life01 * 1.2) ;
    }
    if (any) {
      const g = this.pts.geometry;
      g.attributes.position!.needsUpdate = true; g.attributes.color!.needsUpdate = true; g.attributes.size!.needsUpdate = true;
    }
    // explosion
    if (this.flashLife > 0) {
      this.flashLife -= dt; const k = Math.max(0, this.flashLife / this.flashMax);
      this.flash.scale.setScalar(2.5 + (1 - k) * 9); (this.flash.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
    if (this.ringLife > 0) {
      this.ringLife -= dt; const k = Math.max(0, this.ringLife / 0.7);
      this.ring.scale.setScalar(1 + (1 - k) * 22); (this.ring.material as THREE.MeshBasicMaterial).opacity = k * 0.6;
      if (this.ringLife <= 0) this.ring.visible = false;
    }
    (this.pts.material as THREE.ShaderMaterial).uniforms.scale!.value = (window.innerHeight * (window.devicePixelRatio || 1)) * 0.9;
  }
}

function softDot(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(10,8,6,0.95)'); gr.addColorStop(0.35, 'rgba(25,20,15,0.8)'); gr.addColorStop(1, 'rgba(25,20,15,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(20,16,12,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + Math.random(), r = 14 + Math.random() * 14; g.beginPath(); g.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5); g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); g.stroke(); }
  return new THREE.CanvasTexture(c);
}
