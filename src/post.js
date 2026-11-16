// Post-processing + graphics presets + dynamic resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const PRESETS = {
  low: { label: 'Low', pr: 1.0, shadow: 0, post: false, msaa: 0, bloom: false, blur: false, scenery: 0.35, particles: 0.35, far: 0.6, reflections: false, aa: false },
  medium: { label: 'Medium', pr: 1.25, shadow: 1, post: true, msaa: 0, bloom: true, blur: true, scenery: 0.7, particles: 0.7, far: 0.85, reflections: false, aa: true },
  high: { label: 'High', pr: 1.6, shadow: 2, post: true, msaa: 4, bloom: true, blur: true, scenery: 1.0, particles: 1.0, far: 1.0, reflections: true, aa: true },
  ultra: { label: 'Ultra', pr: 2.0, shadow: 3, post: true, msaa: 4, bloom: true, blur: true, scenery: 1.3, particles: 1.4, far: 1.15, reflections: true, aa: true },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, blur: { value: 0 }, chroma: { value: 0 }, vignette: { value: 0.28 }, sat: { value: 1 }, contrast: { value: 1 },
    tint: { value: new THREE.Vector3(1, 1, 1) }, flash: { value: 0 }, time: { value: 0 }, boost: { value: 0 }, grain: { value: 0.03 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float blur, chroma, vignette, sat, contrast, flash, time, boost, grain; uniform vec3 tint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      float edge = smoothstep(0.08, 0.75, r);
      vec3 col;
      if (blur > 0.002) {
        col = vec3(0.0); float tot = 0.0;
        for (int i = 0; i < 9; i++) { float t = float(i) / 8.0; float w = 1.0 - t * 0.55; col += texture2D(tDiffuse, vUv - c * blur * edge * t).rgb * w; tot += w; }
        col /= tot;
      } else col = texture2D(tDiffuse, vUv).rgb;
      if (chroma > 0.0005) {
        vec2 o = c * chroma * edge;
        col.r = mix(col.r, texture2D(tDiffuse, vUv + o).r, 0.8); col.b = mix(col.b, texture2D(tDiffuse, vUv - o).b, 0.8);
      }
      col *= tint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat);
      col = (col - 0.18) * contrast + 0.18;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, r);
      col += vec3(0.1, 0.6, 1.0) * boost * edge * 0.18;
      col += vec3(1.0, 0.25, 0.2) * flash * smoothstep(0.3, 0.8, r) * 0.35;
      col += (hash(vUv * 900.0) - 0.5) * grain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.preset = PRESETS.high; this.composer = null; this.enabled = true; this.opts = { bloom: true, motionBlur: true };
    this.grade = { sat: 1, contrast: 1, tint: [1, 1, 1], bloom: 0.3 };
    this.w = 0; this.h = 0;
    this.speed = 0; this.boost = 0; this.flash = 0;
  }
  setScene(scene) { this.scene = scene; if (this.renderPass) this.renderPass.scene = scene; }
  setCamera(camera) { this.camera = camera; if (this.renderPass) this.renderPass.camera = camera; }
  setGrade(g) { this.grade = g; if (this.bloom) this.bloom.strength = g.bloom * (this.preset.bloom && this.opts.bloom ? 1 : 0); }

  build(preset, opts) {
    this.preset = preset; this.opts = opts;
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    this.enabled = !!preset.post;
    if (!this.enabled) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.msaa || 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), this.grade.bloom, 0.55, 0.88);
    this.bloom.enabled = preset.bloom && opts.bloom; this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(GradeShader); this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(size.x / this.renderer.getPixelRatio(), size.y / this.renderer.getPixelRatio());
  }

  setSize(w, h) { this.w = w; this.h = h; if (this.composer) this.composer.setSize(w, h); }

  render(dt, time) {
    if (!this.enabled || !this.composer) { this.renderer.render(this.scene, this.camera); return; }
    const u = this.gradePass.uniforms, g = this.grade;
    const mb = this.preset.blur && this.opts.motionBlur;
    u.blur.value = mb ? Math.max(0, this.speed - 0.45) * 0.085 + this.boost * 0.05 : 0;
    u.chroma.value = this.preset.post ? (this.speed * this.speed * 0.006 + this.boost * 0.006) : 0;
    u.sat.value = g.sat; u.contrast.value = g.contrast; u.tint.value.set(g.tint[0], g.tint[1], g.tint[2]);
    u.flash.value = this.flash; u.boost.value = this.boost; u.time.value = time % 10; u.vignette.value = 0.3 + this.speed * 0.12;
    this.flash *= Math.exp(-6 * dt);
    this.composer.render(dt);
  }
}

/** Dynamic resolution: nudges the pixel ratio to hold the target frame time. */
export class ResolutionGovernor {
  constructor(target = 1 / 55) { this.target = target; this.acc = 0; this.n = 0; this.scale = 1; this.cool = 0; }
  sample(dt, maxPr, setPr, current) {
    this.acc += dt; this.n++;
    if (this.acc < 1.5) return current;
    const avg = this.acc / this.n; this.acc = 0; this.n = 0;
    let pr = current;
    if (avg > this.target * 1.25 && pr > 0.7) pr = Math.max(0.7, pr - 0.15);
    else if (avg < this.target * 0.82 && pr < maxPr) pr = Math.min(maxPr, pr + 0.1);
    if (Math.abs(pr - current) > 0.01) setPr(pr);
    return pr;
  }
}
