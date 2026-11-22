import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let _loader: GLTFLoader | null = null;
export function gltfLoader(): GLTFLoader {
  if (!_loader) { _loader = new GLTFLoader(); _loader.setMeshoptDecoder(MeshoptDecoder); }
  return _loader;
}

/** Base URL for packaged assets (overridable: the single-file build inlines them as data URLs). */
export const assetUrl = (name: string): string => {
  const inl = (globalThis as any).__HF_ASSETS__ as Record<string, string> | undefined;
  return inl?.[name] ?? `${import.meta.env.BASE_URL}assets/${name}`;
};

export function loadGLB(name: string): Promise<GLTF> {
  return gltfLoader().loadAsync(assetUrl(name));
}

/** Convert any (possibly quantized / normalized) attribute to plain Float32 so matrices can be baked safely. */
export function toFloatAttribute(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = attr.count, sz = attr.itemSize;
  const out = new Float32Array(n * sz);
  for (let i = 0; i < n; i++) {
    out[i * sz] = attr.getX(i);
    if (sz > 1) out[i * sz + 1] = attr.getY(i);
    if (sz > 2) out[i * sz + 2] = attr.getZ(i);
    if (sz > 3) out[i * sz + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, sz);
}

export function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, toFloatAttribute(a));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(Array.from(src.index.array as ArrayLike<number>)), 1));
  return g;
}

export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
  });
  return n;
}
