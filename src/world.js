// Assembles a complete track environment: terrain, road, sky, water, lighting, scenery.
import * as THREE from 'three';
import { ENVS } from './tracks.js';
import { buildTrackData } from './trackmath.js';
import { createTerrain } from './terrain.js';
import { buildTrackMeshes } from './trackmesh.js';
import { createSky, makeEnvMap, createWater, createLighting } from './sky.js';
import { buildScenery } from './scenery.js';

const OFF = { coast: 'grass', neon: 'gravel', mountain: 'dirt', desert: 'sand', circuit: 'grass' };

export function buildWorld(renderer, trackDef, preset, { aniso = 8, onProgress } = {}) {
  const t0 = performance.now(); const step = (label) => onProgress && onProgress(label);
  const envId = trackDef.env;
  const env = { ...ENVS[envId], id: envId, offSurface: OFF[envId] };
  step('Surveying the road');
  const td = buildTrackData(trackDef);
  step('Sculpting terrain');
  const terrain = createTerrain(td, envId, env, 11 + envId.length * 7);
  const scene = new THREE.Scene();
  step('Lighting the sky');
  scene.environment = makeEnvMap(renderer, env); scene.environmentIntensity = env.env;
  const sky = createSky(env); scene.add(sky.mesh);
  const lighting = createLighting(scene, env, preset.shadow);
  // fog distance scales with the draw-distance preset
  scene.fog.far = env.fog.far * preset.far; scene.fog.near = env.fog.near * Math.min(1, preset.far);
  const tmesh = terrain.buildMesh(renderer); scene.add(tmesh);
  step('Laying asphalt');
  const road = buildTrackMeshes({ td, terrain, envId, env, aniso, quality: preset.shadow });
  scene.add(road.group);
  let water = null;
  if (env.terrain.island) { water = createWater(env, terrain, lighting.sunDir); scene.add(water.mesh); }
  step('Planting scenery');
  const scenery = buildScenery({ scene, td, terrain, envId, env, preset, aniso });
  const world = {
    scene, td, terrain, env, envId, sky, lighting, water, road, scenery, trackDef, terrainMesh: tmesh,
    buildMs: performance.now() - t0,
    update(dt, time, camera, focus, tunnelF) {
      sky.mesh.position.copy(camera.position); sky.uniforms.time.value = time * env.cloud.speed * 60;
      lighting.update(focus, tunnelF);
      if (water) water.update(time);
      scenery.update(camera, dt, time);
    },
    dispose() {
      const tex = new Set(), mats = new Set(), geos = new Set();
      scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        if (o.isLight && o.dispose) o.dispose();                      // frees shadow maps
        if (o.isInstancedMesh && o.dispose) o.dispose();              // frees instance buffers
      });
      for (const m of mats) { for (const k in m) { const v = m[k]; if (v && v.isTexture) tex.add(v); } if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) tex.add(v); } m.dispose(); }
      if (scene.environment) tex.add(scene.environment);
      if (scene.background && scene.background.isTexture) tex.add(scene.background);
      for (const t of tex) t.dispose(); for (const g of geos) g.dispose();
      scene.clear();
    },
  };
  return world;
}
