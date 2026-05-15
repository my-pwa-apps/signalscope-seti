import * as THREE from 'three';

/**
 * Convert RA (hours) and Dec (degrees) to a unit-sphere XYZ position. The
 * resulting frame is a right-handed cartesian frame: +X toward (RA=0,Dec=0).
 */
export function raDecToVec3(raHours: number, decDeg: number, radius = 1): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = (decDeg / 180) * Math.PI;
  const cd = Math.cos(dec);
  return new THREE.Vector3(
    radius * cd * Math.cos(ra),
    radius * Math.sin(dec),
    radius * cd * Math.sin(ra)
  );
}

/** Map an apparent magnitude to a render size for the 3D scene. */
export function magToSize(mag: number): number {
  // Brighter (lower mag) → larger sprite. Clamp gently.
  return Math.max(0.7, 3.2 - mag * 0.55);
}
