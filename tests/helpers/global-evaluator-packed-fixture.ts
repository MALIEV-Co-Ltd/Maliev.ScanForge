import type { NativeGlobalEvaluatorSearchNode } from "../../src/scan-native-global-evaluator-query";
import type { NativeGlobalPackedEvaluatorSurface } from "../../src/scan-native-global-packed-evaluator";

/** Controlled native fixture layout, not an application index builder. */
export function packGlobalEvaluatorFixture(spec: any) {
  const records = new Map<number, any>();
  const collect = (node: any) => {
    for (const t of node.triangles ?? []) records.set(t.id, t);
    for (const child of node.children ?? []) if (child) collect(child);
  };
  collect(spec);
  const count = Math.max(-1, ...records.keys()) + 1;
  const surface: NativeGlobalPackedEvaluatorSurface = {
    vertices: new Float32Array(count * 9),
    triangles: new Uint32Array(count * 3),
    normals: new Float32Array(count * 3),
    bounds: new Float32Array(count * 6),
    flags: new Uint8Array(count),
  };
  for (let i = 0; i < surface.triangles.length; i++) surface.triangles[i] = i;
  for (const [id, t] of records) {
    surface.vertices.set(t.vertices.flat(), id * 9);
    surface.normals.set(t.normal ?? [0, 0, 1], id * 3);
    surface.flags![id] = t.flags ?? 0;
    surface.bounds.set(
      t.bounds ?? [
        ...[0, 1, 2].map((i) =>
          Math.min(...t.vertices.map((v: number[]) => v[i])),
        ),
        ...[0, 1, 2].map((i) =>
          Math.max(...t.vertices.map((v: number[]) => v[i])),
        ),
      ],
      id * 6,
    );
  }
  const node = (s: any): NativeGlobalEvaluatorSearchNode<number> => ({
    bounds: s.bounds ?? [-10, -10, -10, 10, 10, 10],
    center: s.center ?? [0, 0, 0],
    flat: !!s.flat,
    triangles: Uint32Array.from((s.triangles ?? []).map((t: any) => t.id)),
    children: (s.children ?? []).map((c: any) => (c ? node(c) : undefined)),
  });
  return { root: node(spec), surface };
}
