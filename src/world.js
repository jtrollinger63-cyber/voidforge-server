// Environment: sky, ground, lighting, distant hills, roadside scenery, grandstand, signs, lamps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPACING } from './trackmath.js';
import { makeCanvas, canvasTexture, mulberry32, shade, glowTexture } from './util.js';

function groundTexture(theme, aniso) {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  g.fillStyle = theme.ground; g.fillRect(0, 0, S, S);
  const rnd = mulberry32(11);
  // soft blotches
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.5;
    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fine speckle (grass blades / sand grains)
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() > 0.5 ? theme.groundDark : shade(theme.ground, 1.18);
    g.globalAlpha = 0.25 + rnd() * 0.35;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 1 + rnd() * 3);
  }
  g.globalAlpha = 1;
  return canvasTexture(c, { repeat: true, anisotropy: aniso });
}

function crowdTexture() {
  const c = makeCanvas(256, 64), g = c.getContext('2d');
  g.fillStyle = '#2a2f3a'; g.fillRect(0, 0, 256, 64);
  const rnd = mulberry32(5);
  const cols = ['#e63946', '#f1faee', '#ffb703', '#4cc9f0', '#8ac926', '#ff7ab6', '#ffffff', '#6a4c93'];
  for (let i = 0; i < 700; i++) {
    g.fillStyle = cols[(rnd() * cols.length) | 0];
    g.fillRect(rnd() * 256, rnd() * 64, 3, 3 + rnd() * 3);
  }
  return canvasTexture(c, { repeat: true, anisotropy: 4 });
}

function signTexture(i) {
  const defs = [
    ['NITRO', '#ff3d71', '#2b0a16'], ['VOIDFORGE', '#00e5ff', '#06222b'],
    ['TURBO', '#ffb703', '#2a1d00'], ['APEX', '#8ce99a', '#0c2412'], ['DRIFT KING', '#c77dff', '#1d0b2b'],
  ];
  const [txt, fg, bg] = defs[i % defs.length];
  const c = makeCanvas(512, 160), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 160);
  g.fillStyle = fg; g.fillRect(0, 0, 512, 10); g.fillRect(0, 150, 512, 10);
  g.font = 'italic 900 84px "Trebuchet MS","Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.fillText(txt, 256, 82);
  return canvasTexture(c, { anisotropy: 8 });
}

function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 6); trunk.translate(0, 1.1, 0); paint(trunk, 0x5b3d26); parts.push(trunk);
  const tiers = [[3.4, 3.2, 2.0], [2.7, 2.9, 4.0], [1.9, 2.6, 5.9]];
  for (const [r, h, y] of tiers) {
    const c = new THREE.ConeGeometry(r, h, 7); c.translate(0, y + h / 2 - 0.2, 0); paint(c, 0x2f7d3a); parts.push(c);
  }
  return mergeGeometries(parts);
}

function cactusGeometry() {
  const parts = [];
  const mk = (r0, r1, h, x, y, z, rz = 0) => {
    const g = new THREE.CylinderGeometry(r0, r1, h, 7); g.rotateZ(rz); g.translate(x, y, z); paint(g, 0x4f8a45); parts.push(g);
  };
  mk(0.45, 0.5, 5.5, 0, 2.75, 0);
  mk(0.28, 0.3, 2.6, 1.1, 3.6, 0); mk(0.28, 0.3, 1.3, 0.55, 2.8, 0, Math.PI / 2);
  mk(0.26, 0.28, 2.0, -1.0, 2.8, 0); mk(0.26, 0.28, 1.2, -0.5, 2.1, 0, Math.PI / 2);
  return mergeGeometries(parts);
}

function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(1.6, 0);
  const p = g.attributes.position;
  const rnd = mulberry32(3);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + rnd() * 0.3), p.getY(i) * (0.55 + rnd() * 0.25), p.getZ(i) * (0.85 + rnd() * 0.3));
  g.translate(0, 0.5, 0);
  paint(g, 0xffffff);
  return g;
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

export function buildWorld(scene, renderer, td, theme, startSlots) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const rnd = mulberry32(42);
  const world = { group: new THREE.Group(), dynamic: [] };
  scene.add(world.group);

  // ---- atmosphere ----
  scene.background = new THREE.Color(theme.fog);
  scene.fog = new THREE.Fog(new THREE.Color(theme.fog), theme.fogNear, theme.fogFar);

  // sky dome
  const sunDir = new THREE.Vector3(...theme.sunDir).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) }, mid: { value: new THREE.Color(theme.skyMid) },
        hor: { value: new THREE.Color(theme.skyHorizon) }, sunDir: { value: sunDir },
        sunCol: { value: new THREE.Color(theme.sun) }, night: { value: theme.night ? 1 : 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 top, mid, hor, sunDir, sunCol; uniform float night;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
          c = mix(c, top, smoothstep(0.18, 0.85, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          float disc = night > 0.5 ? pow(s, 900.0) * 1.6 : pow(s, 700.0) * 4.0;
          c += sunCol * (disc + pow(s, 10.0) * 0.28 + pow(s, 2.5) * 0.06);
          if (d.y < 0.0) c = hor;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  world.sky = sky;

  // lights
  const hemi = new THREE.HemisphereLight(new THREE.Color(theme.hemiSky), new THREE.Color(theme.hemiGround), theme.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(theme.sun), theme.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  world.sun = sun; world.sunDir = sunDir;

  // ---- ground ----
  const gt = groundTexture(theme, aniso);
  gt.repeat.set(900, 900);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: gt, roughness: 1, metalness: 0 }),
  );
  ground.position.y = -0.04; ground.receiveShadow = true;
  world.group.add(ground);

  // bounds of the track (for placing hills, scenery)
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < td.N; i++) { minx = Math.min(minx, td.px[i]); maxx = Math.max(maxx, td.px[i]); minz = Math.min(minz, td.pz[i]); maxz = Math.max(maxz, td.pz[i]); }
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2, baseR = Math.hypot(maxx - minx, maxz - minz) / 2;
  world.center = { x: cx, z: cz };

  // ---- distant hills ----
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  const hills = [];
  const nHills = 34;
  for (let i = 0; i < nHills; i++) {
    const ang = (i / nHills) * Math.PI * 2 + rnd() * 0.15;
    const dist = baseR + 420 + rnd() * 500;
    const w = 180 + rnd() * 320, h = 70 + rnd() * 190;
    let g;
    if (theme.scenery === 'desert' && rnd() > 0.45) { g = new THREE.CylinderGeometry(0.55, 1, 1, 7, 1); g.translate(0, 0.5, 0); }
    else { g = new THREE.IcosahedronGeometry(1, 1); g.translate(0, 0.25, 0); }
    const col = new THREE.Color(theme.hills[(rnd() * theme.hills.length) | 0]).multiplyScalar(0.85 + rnd() * 0.3);
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const shadeF = 0.8 + 0.35 * Math.max(0, g.attributes.position.getY(k)); arr[k * 3] = col.r * shadeF; arr[k * 3 + 1] = col.g * shadeF; arr[k * 3 + 2] = col.b * shadeF; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.Mesh(g, hillMat);
    m.scale.set(w, h, w * (0.6 + rnd() * 0.5)); m.position.set(cx + Math.cos(ang) * dist, -h * 0.12, cz + Math.sin(ang) * dist);
    m.rotation.y = rnd() * 6.28;
    hills.push(m); world.group.add(m);
  }

  // ---- stars + moon (night) / clouds (day) ----
  if (theme.night) {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd(), v = rnd() * 0.95 + 0.04, a = u * Math.PI * 2, r = 3000;
      const y = v, rr = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * rr * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = Math.sin(a) * rr * r;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    stars.renderOrder = -9; stars.frustumCulled = false; world.stars = stars; scene.add(stars);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(150,180,255,0)'), fog: false, depthWrite: false, transparent: true }));
    moon.scale.set(260, 260, 1); moon.position.copy(sunDir).multiplyScalar(2800); moon.renderOrder = -8; world.moon = moon; scene.add(moon);
  } else {
    const cc = makeCanvas(256, 128), g = cc.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 50 + rnd() * 156, y = 50 + rnd() * 30, r = 18 + rnd() * 28;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const ct = canvasTexture(cc, { anisotropy: 1 });
    const clouds = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, fog: false, depthWrite: false, transparent: true, opacity: 0.8, color: theme.sun }));
      const a = rnd() * Math.PI * 2, d = 600 + rnd() * 1800;
      s.position.set(Math.cos(a) * d, 320 + rnd() * 260, Math.sin(a) * d);
      s.scale.set(700 + rnd() * 700, 350 + rnd() * 250, 1); s.renderOrder = -7;
      clouds.add(s);
    }
    world.clouds = clouds; scene.add(clouds);
  }

  // ---- roadside scenery (instanced) ----
  const minClear = td.half + td.runoff + 4;
  const place = (count, latMin, latSpan, power, extraCheck) => {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const i = (rnd() * td.N) | 0;
      const side = rnd() > 0.5 ? 1 : -1;
      const lat = side * (td.half + td.runoff + latMin + Math.pow(rnd(), power) * latSpan);
      const x = td.px[i] + td.rx[i] * lat + (rnd() - 0.5) * 8, z = td.pz[i] + td.rz[i] * lat + (rnd() - 0.5) * 8;
      const q = td.nearest(x, z, -1);
      if (q.dist < minClear) continue;
      if (extraCheck && !extraCheck(x, z)) continue;
      out.push([x, z]);
    }
    return out;
  };
  const noStand = (x, z) => Math.hypot(x - td.px[0], z - td.pz[0]) > 85;
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const inst = (geo, mat, spots, scaleFn, tint) => {
    const m = new THREE.InstancedMesh(geo, mat, spots.length);
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    spots.forEach(([x, z], k) => {
      const s = scaleFn();
      dummy.position.set(x, 0, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.set(s * (0.9 + rnd() * 0.2), s, s * (0.9 + rnd() * 0.2)); dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
      col.setScalar(1).multiplyScalar(0.75 + rnd() * 0.5); if (tint) col.lerp(new THREE.Color(tint), rnd() * 0.5);
      m.setColorAt(k, col);
    });
    m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
    world.group.add(m);
    return m;
  };

  if (theme.scenery === 'pine' || theme.scenery === 'night') {
    const trees = place(theme.night ? 650 : 900, 5, 130, 1.4, noStand);
    const geo = pineGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    inst(geo, mat, trees, () => 0.8 + rnd() * 1.1, theme.night ? '#1b3a4a' : '#7fb040');
  } else {
    const cacti = place(260, 5, 120, 1.5, noStand);
    inst(cactusGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), cacti, () => 0.8 + rnd() * 0.9);
    const rocks = place(380, 4, 140, 1.3, noStand);
    inst(rockGeometry(), new THREE.MeshStandardMaterial({ color: 0xb08256, roughness: 1, flatShading: true }), rocks, () => 0.8 + rnd() * 2.8);
  }

  // ---- grandstand beside the start straight ----
  {
    const stand = new THREE.Group();
    stand.position.set(td.px[0], 0, td.pz[0]);
    stand.rotation.y = td.heading[0];
    const crowd = crowdTexture(); crowd.repeat.set(4, 1);
    const stepMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, roughness: 0.9 });
    const off = td.half + td.runoff + 7; // distance from centre line to the front of the stand
    for (let t = 0; t < 5; t++) {
      const h = 1.5 * (t + 1);
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z. The crowd faces the track (local +x, since the track's right side is local -x).
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 80), [stepMat, concrete, stepMat, concrete, concrete, concrete]);
      m.position.set(-(off + 1.2 + t * 2.4), h / 2, 0);
      m.castShadow = true; m.receiveShadow = true; stand.add(m);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 82), new THREE.MeshStandardMaterial({ color: 0xe9ecf1, roughness: 0.6 }));
    roof.position.set(-(off + 7), 11.5, 0); roof.castShadow = true; stand.add(roof);
    for (const z of [-38, -13, 13, 38]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11.5, 0.5), concrete); p.position.set(-(off + 1.5), 5.75, z); p.castShadow = true; stand.add(p);
    }
    world.group.add(stand);
  }

  // ---- advertising boards ----
  {
    const signGeo = new THREE.PlaneGeometry(14, 4.4);
    const postGeo = new THREE.BoxGeometry(0.3, 3, 0.3);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 0.7 });
    for (let k = 0; k < 18; k++) {
      const i = Math.round((k / 18) * td.N + (rnd() * 20 - 10)) % td.N;
      const side = k % 2 ? 1 : -1;
      const lat = side * (td.half + td.runoff + 3.2);
      const x = td.px[i] + td.rx[i] * lat, z = td.pz[i] + td.rz[i] * lat;
      if (Math.hypot(x - td.px[0], z - td.pz[0]) < 60) continue;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      g.rotation.y = td.heading[i] + (side > 0 ? Math.PI / 2 : -Math.PI / 2); // face the track (text reads left-to-right from the road)
      const s = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ map: signTexture(k), toneMapped: false, side: THREE.DoubleSide }));
      s.position.set(0, 4.2, 0); g.add(s);
      for (const px of [-5, 5]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(px, 1.5, 0); g.add(p); }
      world.group.add(g);
    }
  }

  // ---- street lamps with fake light pools (night) ----
  if (theme.night) {
    const spacing = Math.round(40 / SPACING);
    const spots = [];
    for (let i = 0; i < td.N; i += spacing) for (const s of [-1, 1]) {
      const lat = s * (td.half + td.runoff + 1.4);
      spots.push({ x: td.px[i] + td.rx[i] * lat, z: td.pz[i] + td.rz[i] * lat, i, s });
    }
    const pole = new THREE.CylinderGeometry(0.14, 0.2, 10, 6); pole.translate(0, 5, 0);
    const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.6, metalness: 0.5 }), spots.length);
    const headGeo = new THREE.BoxGeometry(1.6, 0.25, 0.7);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), spots.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,220,150,0.9)', 'rgba(255,200,120,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: true }), spots.length);
    const d = new THREE.Object3D();
    const glowPos = new Float32Array(spots.length * 3);
    spots.forEach((p, k) => {
      d.position.set(p.x, 0, p.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); poles.setMatrixAt(k, d.matrix);
      const inward = -p.s; // toward the track
      const hx = p.x + td.rx[p.i] * inward * 2.0, hz = p.z + td.rz[p.i] * inward * 2.0;
      d.position.set(hx, 10.1, hz); d.rotation.set(0, td.heading[p.i], 0); d.updateMatrix(); heads.setMatrixAt(k, d.matrix);
      glowPos[k * 3] = hx; glowPos[k * 3 + 1] = 10.0; glowPos[k * 3 + 2] = hz;
      d.position.set(hx + td.rx[p.i] * inward * 6, 0.07, hz + td.rz[p.i] * inward * 6); d.rotation.set(0, 0, 0); d.scale.set(34, 1, 34); d.updateMatrix(); pool.setMatrixAt(k, d.matrix);
    });
    poles.frustumCulled = heads.frustumCulled = pool.frustumCulled = false;
    world.group.add(poles, heads, pool);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    const halo = new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTexture('rgba(255,235,190,1)', 'rgba(255,200,120,0)'), size: 7, sizeAttenuation: true, opacity: 0.8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.frustumCulled = false; world.group.add(halo);
  }

  /** Called every frame with the camera and the point the shadow map should follow. */
  world.update = (camera, fx, fz) => {
    sky.position.copy(camera.position);
    if (world.stars) world.stars.position.copy(camera.position);
    if (world.moon) world.moon.position.copy(camera.position).addScaledVector(sunDir, 2800);
    if (world.clouds) world.clouds.position.set(camera.position.x, 0, camera.position.z);
    // snap the shadow frustum to the shadow-map texel grid to avoid shimmering
    const texel = 140 / 2048;
    const sx = Math.round(fx / texel) * texel, sz = Math.round(fz / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + sunDir.x * 200, sunDir.y * 200, sz + sunDir.z * 200);
    sun.target.updateMatrixWorld();
  };

  return world;
}
