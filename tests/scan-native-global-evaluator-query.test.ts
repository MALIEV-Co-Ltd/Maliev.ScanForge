import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-query-native.json";
import {
  nativeGlobalEvaluatorQuery,
  type NativeGlobalEvaluatorNode,
  type NativeGlobalEvaluatorTriangle,
} from "../src/scan-native-global-evaluator-query";

function prepare(spec: any): NativeGlobalEvaluatorNode {
  return {
    bounds: spec.bounds ?? [-10, -10, -10, 10, 10, 10],
    center: spec.center ?? [0, 0, 0],
    flat: !!spec.flat,
    children: (spec.children ?? []).map((child: any) =>
      child ? prepare(child) : undefined,
    ),
    triangles: (spec.triangles ?? []).map((t: any) => ({
      id: t.id,
      vertices: t.vertices.map((v: number[]) => Float32Array.from(v)),
      normal: Float32Array.from(t.normal ?? [0, 0, 1]),
      flags: t.flags ?? 0,
      bounds: Float32Array.from(
        t.bounds ?? [
          ...[0, 1, 2].map((i) =>
            Math.min(...t.vertices.map((v: number[]) => v[i])),
          ),
          ...[0, 1, 2].map((i) =>
            Math.max(...t.vertices.map((v: number[]) => v[i])),
          ),
        ],
      ),
    })),
  };
}
const bits = (values: ArrayLike<number>) =>
  Buffer.from(Float64Array.from(values).buffer).toString("hex");

it.each(fixture.cases)(
  "matches original recursive evaluator query: $name",
  (c) => {
    const distance = Float64Array.of(c.radius),
      projection = Float64Array.of(11, 12, 13),
      edgeFlags = Uint8Array.of(255);
    const scratch = {
      stack: [] as NativeGlobalEvaluatorNode[],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    const tree = prepare(c.tree);
    const hit = nativeGlobalEvaluatorQuery(
      tree,
      c.point,
      distance,
      projection,
      edgeFlags,
      !!c.mode,
      scratch,
    );
    expect(hit?.id ?? null).toBe(c.target);
    expect(bits(distance)).toBe(c.distanceBits);
    expect(bits(projection)).toBe(c.projectionBits);
    expect(edgeFlags[0]).toBe(c.edgeFlags);
    expect(scratch.stack).toHaveLength(0);
    if (hit) {
      const all: NativeGlobalEvaluatorTriangle[] = [];
      const visit = (node: NativeGlobalEvaluatorNode) => {
        all.push(...node.triangles);
        node.children.forEach((child) => child && visit(child));
      };
      visit(tree);
      expect(all).toContain(hit);
    }
  },
);
