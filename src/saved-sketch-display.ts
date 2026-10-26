import * as THREE from "three";
import { sampleSketchArc } from "./sketch";
import { coordinateSketchFrame, sketchWorldPoint } from "./sketch-frame";
import type { SavedSketch, Vec3 } from "./types";

/** A saved sketch can remain visible without replacing the user's active edit session. */
function visitSavedSketchSegments(
  saved: SavedSketch,
  emit?: (a: Vec3, b: Vec3) => void,
) {
  const sketch = saved.sketch,
    frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
  if (
    sketch.points.length > 2000002 ||
    sketch.segments.length > 1000000 ||
    sketch.points.length * (sketch.arcs?.length ?? 0) > 50000000
  )
    throw Error(
      "Saved sketch display exceeds the bounded geometry work limit.",
    );
  const localFrame = {
    ...frame,
    origin: [0, 0, 0] as [number, number, number],
  };
  const points = new Map(sketch.points.map((point) => [point.id, point]));
  let count = 0;
  const add = (a: [number, number], b: [number, number]) => {
    if (++count > 1000000)
      throw Error("Saved sketch display exceeds the segment limit.");
    sketchWorldPoint(frame, a);
    sketchWorldPoint(frame, b);
    emit?.(sketchWorldPoint(localFrame, a), sketchWorldPoint(localFrame, b));
  };
  for (const line of sketch.segments) {
    const a = points.get(line.a),
      b = points.get(line.b);
    if (a && b) add([a.x, a.y], [b.x, b.y]);
  }
  for (const arc of sketch.arcs ?? []) {
    const samples = sampleSketchArc(sketch, arc, false, 0.1),
      end = points.get(arc.b);
    if (end) samples.push([end.x, end.y]);
    for (let i = 1; i < samples.length; i++) add(samples[i - 1], samples[i]);
  }
  return frame;
}
/** No GPU objects or full display buffers are allocated during publication admission. */
export function validateSavedSketchDisplay(saved: SavedSketch): void {
  visitSavedSketchSegments(saved);
}
export function createSavedSketchDisplay(saved: SavedSketch) {
  const values: number[] = [];
  const frame = visitSavedSketchSegments(saved, (a, b) =>
    values.push(...a, ...b),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(values, 3),
  );
  const object = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: "#ed8a30", depthTest: false }),
  );
  object.position.set(...frame.origin);
  object.name = saved.name;
  object.userData.sketchId = saved.id;
  object.renderOrder = 5;
  return object;
}
