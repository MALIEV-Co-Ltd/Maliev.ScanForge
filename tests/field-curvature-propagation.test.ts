import { describe, expect, it } from "vitest";
import { propagateCurvatureRadii } from "../src/field-curvature-propagation";
import { buildTriangleAdjacency } from "../src/field-triangle-adjacency";
import native from "./fixtures/field-native-propagation.json";

function pair(selected = [0, 6], masks = [3, 3, 3, 3, 3, 3, 3]) {
  const adjacency = buildTriangleAdjacency(
    4,
    new Uint32Array([0, 1, 2, 1, 0, 3]),
  );
  const choices = new Int32Array(selected);
  const candidates = masks.map((value) => new Uint8Array([value]));
  const previous = new Int32Array([99, 98]);
  return { adjacency, choices, candidates, previous };
}

describe("curvature radius propagation", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated native radius-index finalization case $id",
    (entry) => {
      const selected = new Int32Array(entry.selected);
      const previous = new Int32Array(entry.previous);
      const candidates = entry.candidates.map((v) => new Uint8Array(v));
      const result = propagateCurvatureRadii(
        {
          faceEdges: new Int32Array(entry.faceEdges),
          edgeOffsets: new Uint32Array(entry.edgeOffsets),
          halfedges: new Uint32Array(entry.halfedges),
        },
        selected,
        candidates,
        previous,
        {
          enabled: entry.enabled,
          skippedFaces: new Uint8Array(entry.skipped),
          firstFace: entry.first,
          endFace: entry.end,
        },
      );
      expect(Array.from(result)).toEqual(entry.output);
      expect(Array.from(selected)).toEqual(entry.selected);
      expect(Array.from(previous)).toEqual(entry.previous);
      expect(candidates.map((v) => Array.from(v))).toEqual(entry.candidates);
    },
  );
  it("weights the corner-zero neighbor three times using frozen choices", () => {
    const { adjacency, choices, candidates, previous } = pair();
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous),
      ),
    ).toEqual([5, 2]);
    expect(Array.from(choices)).toEqual([0, 6]);
  });
  it("searches toward the original index but excludes that index", () => {
    const { adjacency, choices, candidates, previous } = pair(
      [0, 6],
      [3, 0, 0, 3, 0, 0, 3],
    );
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous),
      ),
    ).toEqual([3, 3]);
    candidates[3][0] = 0;
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous),
      ),
    ).toEqual([99, 98]);
  });
  it("preserves previous outputs when disabled, masked or unchanged", () => {
    const { adjacency, choices, candidates, previous } = pair([2, 2]);
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous),
      ),
    ).toEqual([99, 98]);
    choices.set([0, 6]);
    for (const options of [
      { enabled: false },
      { skippedFaces: new Uint8Array([3]) },
      { firstFace: 1, endFace: 1 },
    ]) {
      const output = propagateCurvatureRadii(
        adjacency,
        choices,
        candidates,
        previous,
        options,
      );
      expect(output).not.toBe(previous);
      expect(Array.from(output)).toEqual([99, 98]);
    }
  });
  it("reads a skipped neighbor choice and honors half-open worker partitions", () => {
    const { adjacency, choices, candidates, previous } = pair();
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous, {
          skippedFaces: new Uint8Array([2]),
          firstFace: 0,
          endFace: 1,
        }),
      ),
    ).toEqual([5, 98]);
  });
  it("ignores missing neighbor choices and edges other than corner zero", () => {
    const { adjacency, choices, candidates, previous } = pair([0, -1]);
    expect(
      Array.from(
        propagateCurvatureRadii(adjacency, choices, candidates, previous),
      ),
    ).toEqual([99, 98]);
    choices.set([0, 6]);
    adjacency.faceEdges[0] = adjacency.faceEdges[1];
    expect(
      propagateCurvatureRadii(adjacency, choices, candidates, previous)[0],
    ).toBe(99);
  });
  it("handles empty state", () => {
    expect(
      propagateCurvatureRadii(
        {
          faceEdges: new Int32Array(),
          edgeOffsets: new Uint32Array([0]),
          halfedges: new Uint32Array(),
        },
        new Int32Array(),
        [],
        new Int32Array(),
      ).length,
    ).toBe(0);
  });
  it("rejects unsafe dimensions, choices and incidence references", () => {
    const { adjacency, choices, candidates, previous } = pair();
    const run = () =>
      propagateCurvatureRadii(adjacency, choices, candidates, previous);
    expect(() =>
      propagateCurvatureRadii(adjacency, choices, candidates, previous, {
        firstFace: 0.5,
      }),
    ).toThrow(/dimensions/);
    expect(() =>
      propagateCurvatureRadii(adjacency, choices, candidates, previous, {
        endFace: 3,
      }),
    ).toThrow(/dimensions/);
    expect(() =>
      propagateCurvatureRadii(
        adjacency,
        choices,
        candidates,
        new Int32Array(1),
      ),
    ).toThrow(/dimensions/);
    candidates[0] = new Uint8Array(2);
    expect(run).toThrow(/dimensions/);
    candidates[0] = new Uint8Array([3]);
    choices[0] = -2;
    expect(run).toThrow(/radius/);
    choices[0] = 0;
    choices[1] = 7;
    expect(run).toThrow(/neighbor radius/);
    choices[1] = 6;
    adjacency.faceEdges[0] = -1;
    expect(run).toThrow(/edge/);
    adjacency.faceEdges[0] = 0;
    adjacency.edgeOffsets[1] = 999;
    expect(run).toThrow(/incidence/);
    adjacency.edgeOffsets[1] = 2;
    adjacency.halfedges[0] = 999;
    expect(run).toThrow(/neighbor/);
  });
});
