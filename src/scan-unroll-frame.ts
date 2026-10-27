import { Vector3 } from "three";

/** Project the least-aligned world axis into the cylinder's radial plane. */
export function unrollRadialAxis(axis: Vector3): Vector3 {
  const x = Math.abs(axis.x),
    y = Math.abs(axis.y),
    z = Math.abs(axis.z);
  const index = Math.min(y, z) < x ? (z < y ? 2 : 1) : 0;
  const radial = new Vector3(
    index === 0 ? 1 : 0,
    index === 1 ? 1 : 0,
    index === 2 ? 1 : 0,
  );
  return radial.addScaledVector(axis, -radial.dot(axis)).normalize();
}
