import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.42, 0.62, 0.66).normalize(); // afternoon sun, low-ish, from the south-west

/** Cheap gradient sky dome (1 draw call, no textures) with a soft sun disc/halo. */
export function createSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f7fc4) },
      mid: { value: new THREE.Color(0x9cc6e6) },
      bottom: { value: new THREE.Color(0xe9dcc2) },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color(0xfff1c9) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 top, mid, bottom, sunDir, sunColor;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.22, h));
        c = mix(c, top, smoothstep(0.18, 0.85, h));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 22.0) * 0.28);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

/** Soft low-poly hills ring + far ground so the town reads as sitting on a hillside. */
export function createHills(): THREE.Group {
  const g = new THREE.Group();
  // unlit + unfogged: tinted by hand so far hills read as hazy blue-green rather than fogging out to white
  const mat = new THREE.MeshBasicMaterial({ color: 0x8aa079, fog: false });
  const mat2 = new THREE.MeshBasicMaterial({ color: 0x8fa9a0, fog: false });
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let layer = 0; layer < 2; layer++) {
    const R = layer === 0 ? 150 : 215;
    const seg = 48;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const h = (layer === 0 ? 14 : 30) + rnd() * (layer === 0 ? 18 : 40) + Math.sin(a * 3 + layer) * 8;
      pos.push(Math.cos(a) * R, -2, Math.sin(a) * R, Math.cos(a) * (R + 55), h, Math.sin(a) * (R + 55));
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, layer === 0 ? mat : mat2);
    m.material.side = THREE.DoubleSide;
    g.add(m);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 32), new THREE.MeshBasicMaterial({ color: 0xa59a80, fog: false }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  g.add(ground);
  return g;
}

/** Image-based light from the sky dome (PMREM): gives metals + fabrics a believable ambient without lightmaps. */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const dome = createSkyDome();
  s.add(dome);
  const ground = new THREE.Mesh(new THREE.SphereGeometry(300, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb09d7c, side: THREE.BackSide }));
  s.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}
