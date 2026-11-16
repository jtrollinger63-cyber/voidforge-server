// Sky dome (gradient + fbm clouds + sun + stars), environment maps, ocean, and the lighting rig.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 top, mid, hor, grd, sunDir, sunCol;
uniform float night, cover, time, sunSize;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a * vnoise(p); p = p * 2.07 + 11.7; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
  c = mix(c, top, smoothstep(0.16, 0.9, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  float disc = smoothstep(sunSize, sunSize + 0.0007, s) * (night > 0.5 ? 1.2 : 14.0);
  c += sunCol * (disc + pow(s, 8.0) * 0.32 + pow(s, 2.0) * 0.07);
  if (d.y > 0.0) {
    // clouds: project the view ray on a plane, light them from the sun side
    vec2 cp = d.xz / (d.y + 0.16) * 0.9 + vec2(time * 0.012, time * 0.006);
    float n = fbm(cp * 1.4);
    float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.26, n) * smoothstep(0.0, 0.14, d.y);
    float n2 = fbm(cp * 1.4 + normalize(sunDir.xz + 0.001) * 0.07);
    float lit = clamp(0.62 + (n - n2) * 5.0, 0.2, 1.1);
    vec3 cloudCol = mix(hor * 0.55 + top * 0.18, vec3(1.0) * (night > 0.5 ? 0.12 : 1.0) + sunCol * 0.18, lit);
    if (night > 0.5) cloudCol = mix(vec3(0.03, 0.04, 0.08), vec3(0.18, 0.14, 0.26), lit);
    c = mix(c, cloudCol, dens * (night > 0.5 ? 0.55 : 0.9));
    if (night > 0.5) { // stars
      vec2 sp = d.xz / (d.y + 0.35) * 90.0; float st = hash(floor(sp)); float tw = 0.6 + 0.4 * sin(time * 3.0 + st * 40.0);
      c += vec3(0.9, 0.95, 1.0) * smoothstep(0.9965, 1.0, st) * tw * (1.0 - dens) * smoothstep(0.02, 0.3, d.y);
    }
  } else c = mix(hor, grd, smoothstep(0.0, 0.25, -d.y));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(env) {
  const u = {
    top: { value: new THREE.Color(env.sky.top) }, mid: { value: new THREE.Color(env.sky.mid) }, hor: { value: new THREE.Color(env.sky.horizon) },
    grd: { value: new THREE.Color(env.terrain.colors.mid).multiplyScalar(0.6) }, sunDir: { value: new THREE.Vector3(...env.sunDir).normalize() },
    sunCol: { value: new THREE.Color(env.sun) }, night: { value: env.night ? 1 : 0 }, cover: { value: env.cloud.cover }, time: { value: 0 }, sunSize: { value: env.night ? 0.9994 : 0.9993 },
  };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 40, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG }));
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, uniforms: u };
}

/** Environment map for PBR reflections, rendered from the same sky (+ neon panels for the city). */
export function makeEnvMap(renderer, env) {
  const scene = new THREE.Scene();
  const sky = createSky(env); sky.uniforms.time.value = 20; scene.add(sky.mesh);
  if (env.id === 'neon' || env.night) {
    const rnd = mulberry32(5), cols = ['#ff2bd6', '#25e6ff', '#ff8a2b', '#7a5cff', '#2bff9c'];
    for (let i = 0; i < 42; i++) {
      const a = rnd() * Math.PI * 2, r = 60 + rnd() * 60, h = rnd() * 70 - 6;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6 + rnd() * 16, 3 + rnd() * 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[(rnd() * cols.length) | 0]).multiplyScalar(2.5 + rnd() * 2.5), side: THREE.DoubleSide }));
      m.position.set(Math.cos(a) * r, h + 10, Math.sin(a) * r); m.lookAt(0, h + 10, 0); scene.add(m);
    }
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.015, 0.1, 2000).texture;
  pm.dispose(); sky.mesh.geometry.dispose();
  return tex;
}

// ------------------------------------------------------------------------------------------------ ocean
export function createWater(env, terrain, sunDir) {
  const b = terrain.bounds, margin = 1500;
  const x0 = b.minx - margin, z0 = b.minz - margin, W = b.maxx - b.minx + margin * 2, H = b.maxz - b.minz + margin * 2;
  const nx = 150, nz = 150;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), dep = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const o = j * (nx + 1) + i, x = x0 + (i / nx) * W, z = z0 + (j / nz) * H;
    pos[o * 3] = x; pos[o * 3 + 1] = 0; pos[o * 3 + 2] = z; dep[o] = -terrain.height(x, z);
  }
  // refine: depth only matters near shores; smooth the grid a little
  const idx = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('depth', new THREE.BufferAttribute(dep, 1)); g.setIndex(idx);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, sunDir: { value: sunDir.clone() }, deep: { value: new THREE.Color('#06355c') }, shallow: { value: new THREE.Color('#22b6c8') },
    skyCol: { value: new THREE.Color(env.sky.horizon) }, sunCol: { value: new THREE.Color(env.sun) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `attribute float depth;
varying float vDepth;
varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vDepth = depth; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `uniform float time; uniform vec3 sunDir, deep, shallow, skyCol, sunCol;
varying float vDepth;
varying vec3 vW;
#include <fog_pars_fragment>
float wave(vec2 p, float t){ return sin(p.x*0.11+t*1.1)*0.5 + sin(p.y*0.17-t*0.9)*0.35 + sin((p.x+p.y)*0.31+t*1.7)*0.2 + sin((p.x-p.y)*0.6+t*2.3)*0.1; }
void main(){
  float e = 0.8; vec2 p = vW.xz;
  float h0 = wave(p, time), hx = wave(p + vec2(e,0.0), time), hz = wave(p + vec2(0.0,e), time);
  vec3 n = normalize(vec3(-(hx-h0)*0.9, 1.0, -(hz-h0)*0.9));
  vec3 v = normalize(cameraPosition - vW);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  float dd = clamp(vDepth / 22.0, 0.0, 1.0);
  vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, dd));
  col = mix(col, skyCol, fr * 0.8);
  vec3 r = reflect(-v, n); float sp = pow(max(dot(r, normalize(sunDir)), 0.0), 220.0);
  col += sunCol * sp * 3.0;
  float shore = 1.0 - smoothstep(0.0, 4.5, vDepth);
  float foam = shore * (0.5 + 0.5 * sin(vDepth * 2.4 - time * 1.6 + h0 * 2.0)) * smoothstep(0.1, 1.2, vDepth + 0.6);
  col = mix(col, vec3(0.95), clamp(foam * 0.8, 0.0, 1.0));
  float alpha = clamp(0.55 + dd * 0.4 + fr * 0.3, 0.0, 1.0) * smoothstep(-0.5, 0.6, vDepth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 1;
  return { mesh, update: (t) => { uniforms.time.value = t; } };
}

// ------------------------------------------------------------------------------------------------ lighting rig
export function createLighting(scene, env, quality) {
  const sunDir = new THREE.Vector3(...env.sunDir).normalize();
  const hemi = new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]); scene.add(hemi);
  const sun = new THREE.DirectionalLight(env.sun, env.sunI);
  const sres = [512, 1024, 2048, 4096][quality] || 2048;
  sun.castShadow = quality > 0; sun.shadow.mapSize.set(sres, sres);
  const R = quality >= 3 ? 90 : 70; const sc = sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 700;
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.06; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  // fixed set of headlight spots (constant light count avoids shader recompiles)
  const spots = [];
  for (let i = 0; i < 3; i++) { const s = new THREE.SpotLight(0xfff1d8, 0, 130, 0.5, 0.75, 2); s.castShadow = false; scene.add(s, s.target); spots.push(s); }
  const tunnelLight = new THREE.PointLight(env.id === 'neon' ? 0x66ccff : 0xffd29a, 0, 60, 2); scene.add(tunnelLight);
  const base = { sunI: env.sunI, hemi: env.hemi[2], envI: env.env };
  const fogColor = new THREE.Color(env.fog.color), fogDark = new THREE.Color('#0b0b0e'), tmp = new THREE.Color();
  scene.fog = new THREE.Fog(fogColor.clone(), env.fog.near, env.fog.far); scene.background = fogColor.clone();
  const texel = (R * 2) / sres;
  return {
    hemi, sun, spots, tunnelLight, sunDir,
    /** focus: {x,y,z}; tunnel 0..1; nightFactor = headlight demand 0..1 */
    update(focus, tunnel) {
      const sx = Math.round(focus.x / texel) * texel, sz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(sx, focus.y, sz);
      sun.position.set(sx + sunDir.x * 320, focus.y + sunDir.y * 320, sz + sunDir.z * 320);
      sun.target.updateMatrixWorld();
      const k = 1 - tunnel;
      sun.intensity = base.sunI * (0.04 + 0.96 * k);
      hemi.intensity = base.hemi * (0.22 + 0.78 * k);
      scene.environmentIntensity = base.envI * (0.18 + 0.82 * k);
      scene.fog.color.copy(fogColor).lerp(fogDark, tunnel * 0.9); scene.background.copy(scene.fog.color);
      tunnelLight.position.set(focus.x, focus.y + 3.0, focus.z); tunnelLight.intensity = tunnel * 260;
    },
  };
}
