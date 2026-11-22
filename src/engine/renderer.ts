import * as THREE from 'three';
import { QUALITY, type QualityName, type QualityProfile } from './quality.ts';
import { SUN_DIR, createSkyDome, createHills, buildEnvironment } from './sky.ts';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hills: THREE.Group;
  quality: QualityProfile;
  /** keep the shadow frustum centred on a world point (snapped to texels to avoid shimmering) */
  followShadow(x: number, y: number, z: number): void;
  setQuality(q: QualityName): void;
  resize(): void;
  /** dynamic-resolution multiplier applied on top of the profile (0.5..1) */
  dynamicScale: number;
}

export function createStage(canvas: HTMLCanvasElement, qualityName: QualityName = 'medium'): Stage {
  let quality = QUALITY[qualityName];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcdd7da, 30, quality.fogFar);
  scene.add(createSkyDome());
  const hills = createHills(); hills.visible = quality.hills; scene.add(hills);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 1.0;

  const hemi = new THREE.HemisphereLight(0xf4efe6, 0xb59a6e, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 2.3);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 420);

  const stage: Stage = {
    renderer, scene, camera, sun, hills, quality, dynamicScale: 1,
    followShadow(x, y, z) {
      const r = stage.quality.shadowRadius;
      const cam = sun.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 140;
      cam.updateProjectionMatrix();
      const texel = (2 * r) / sun.shadow.mapSize.x;
      const sx = Math.round(x / texel) * texel, sz = Math.round(z / texel) * texel;
      sun.target.position.set(sx, y, sz);
      sun.position.set(sx + SUN_DIR.x * 70, y + SUN_DIR.y * 70, sz + SUN_DIR.z * 70);
      sun.target.updateMatrixWorld();
    },
    setQuality(q) {
      quality = QUALITY[q]; stage.quality = quality;
      renderer.shadowMap.enabled = quality.shadows; sun.castShadow = quality.shadows;
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      sun.shadow.map?.dispose(); (sun.shadow as any).map = null;
      (scene.fog as THREE.Fog).far = quality.fogFar; hills.visible = quality.hills;
      stage.resize();
    },
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, stage.quality.maxPixelRatio);
      const scale = stage.quality.renderScale * stage.dynamicScale;
      renderer.setPixelRatio(dpr * scale);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    },
  };
  stage.resize();
  window.addEventListener('resize', () => stage.resize());
  return stage;
}
