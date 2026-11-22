/**
 * Analytic two-bone IK used to keep the support hand on the weapon's forend.
 * Runs AFTER the animation mixer has posed the skeleton. The elbow keeps the side the animation chose (pole = current elbow offset),
 * and the correction is blended by `weight` so it can fade out for reloads / deaths.
 */
import * as THREE from 'three';

const sV = new THREE.Vector3(), eV = new THREE.Vector3(), hV = new THREE.Vector3(), pV = new THREE.Vector3(), tV = new THREE.Vector3();
const dir = new THREE.Vector3(), pole = new THREE.Vector3(), e2 = new THREE.Vector3(), v1 = new THREE.Vector3(), c1 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), pq = new THREE.Quaternion(), wq = new THREE.Quaternion();

function setWorldQuat(bone: THREE.Object3D, worldQ: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(pq).invert();
  bone.quaternion.copy(pq).multiply(worldQ);
}

/**
 * @param upper   UpperArm bone, @param lower LowerArm bone, @param hand Hand bone
 * @param tip     the point of the hand that must reach the target (Socket_Hand_L)
 * @param target  world-space target for `tip`
 * @returns the distance (m) between tip and target after solving (diagnostic)
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, tip: THREE.Object3D, target: THREE.Vector3, weight: number): number {
  if (weight <= 0.001) return -1;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(sV); lower.getWorldPosition(eV); hand.getWorldPosition(hV); tip.getWorldPosition(pV);
  const a = sV.distanceTo(eV), b = eV.distanceTo(hV);
  if (a < 1e-4 || b < 1e-4) return -1;
  // desired hand-bone position: shift the target by the (hand bone -> tip) offset
  tV.copy(target).sub(pV).add(hV);
  // blend the target toward the animated hand position by weight
  tV.lerp(hV, 1 - Math.min(1, weight));
  const reach = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, sV.distanceTo(tV)));
  dir.copy(tV).sub(sV).normalize();
  // elbow stays on the side the animation put it: perpendicular component of the current elbow offset
  pole.copy(eV).sub(sV); pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(dir, dir.y);
  pole.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + reach * reach - b * b) / (2 * a * reach), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  e2.copy(sV).addScaledVector(dir, a * cosA).addScaledVector(pole, a * sinA);

  // 1) rotate the upper arm so the elbow lands on e2
  v1.copy(e2).sub(sV).normalize(); c1.copy(eV).sub(sV).normalize();
  q1.setFromUnitVectors(c1, v1);
  upper.getWorldQuaternion(wq); qa.copy(q1).multiply(wq); setWorldQuat(upper, qa);
  upper.updateWorldMatrix(false, true);
  // 2) rotate the forearm so the hand reaches the target
  lower.getWorldPosition(eV); hand.getWorldPosition(hV);
  c1.copy(hV).sub(eV).normalize(); v1.copy(tV).sub(eV).normalize();
  q1.setFromUnitVectors(c1, v1);
  lower.getWorldQuaternion(wq); qb.copy(q1).multiply(wq); setWorldQuat(lower, qb);
  lower.updateWorldMatrix(false, true);
  tip.getWorldPosition(pV);
  return pV.distanceTo(target);
}
