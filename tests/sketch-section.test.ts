import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSketchSection,
  referenceWorldSegments,
  type SketchSectionOptions,
} from "../src/sketch-section";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import {
  rectangleSketch,
  solveSketch,
  sketchProfile,
  type Sketch,
} from "../src/sketch";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
const positions = new Float32Array([
  0, 0, 0, 2, 0, 2, 0, 2, 0, 10, 0, 0, 12, 0, 2, 10, 2, 0,
]);
const options: SketchSectionOptions = {
  plane: "OXY",
  offset: 1,
  onSlicingPlane: true,
  selectedOnly: false,
};
afterEach(() => vi.unstubAllGlobals());
describe("scan section sketch references", () => {
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "preserves the section plane or projects it for %s",
    (plane) => {
      const world = Float32Array.from(positions);
      for (let i = 0; i < world.length; i += 3) {
        const [x, y, z] = positions.slice(i, i + 3);
        world.set(
          plane === "OYZ" ? [z, x, y] : plane === "OXZ" ? [y, z, x] : [x, y, z],
          i,
        );
      }
      const slice = extractSketchSection(world, { ...options, plane }, "scan");
      const projected = extractSketchSection(
        world,
        { ...options, plane, onSlicingPlane: false },
        "scan",
      );
      expect(slice.reference.segments).toEqual(projected.reference.segments);
      const axis = plane === "OXY" ? 2 : plane === "OYZ" ? 0 : 1;
      for (let i = axis; i < slice.placedSegments.length; i += 3) {
        expect(slice.placedSegments[i]).toBe(1);
        expect(projected.placedSegments[i]).toBe(0);
      }
      expect(projected.actualSegments).toEqual(slice.actualSegments);
      expect(referenceWorldSegments(slice.frame, slice.reference)).toEqual(
        slice.placedSegments,
      );
    },
  );
  it("filters original slots and refuses empty or stale selected regions", () => {
    const selected = extractSketchSection(
      positions,
      { ...options, selectedOnly: true },
      "scan",
      [0],
      new Uint8Array([0, 1]),
      true,
    );
    expect(selected.eligibleTriangles).toBe(1);
    expect(selected.reference.segments).toHaveLength(4);
    expect(selected.reference.segments[0]).toBe(11);
    expect(selected.reference.sampled).toBe(true);
    for (const mask of [
      new Uint8Array([0, 0]),
      new Uint8Array([1, 0]),
      new Uint8Array([1]),
    ])
      expect(() =>
        extractSketchSection(
          positions,
          { ...options, selectedOnly: true },
          "scan",
          [0],
          mask,
        ),
      ).toThrow(/eligible|Select/);
    expect(() => extractSketchSection(positions, options, "scan", [2])).toThrow(
      /slots/,
    );
    expect(() =>
      extractSketchSection(positions, { ...options, offset: 3 }, "scan"),
    ).toThrow(/intersect/);
  });
  it("keeps samples separate from editable curves and round-trips owned sketches", async () => {
    const result = extractSketchSection(positions, options, "scan");
    const sketch: Sketch = {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: result.frame,
      reference: result.reference,
    };
    expect(solveSketch(sketch).converged).toBe(true);
    expect(() => sketchProfile(sketch)).toThrow();
    const authoring = {
      sketch: rectangleSketch(),
      sketches: [{ id: "section", name: "Section sketch", sketch }],
      activeSketchId: "section",
    };
    for (const text of [
      serializeProject("Sections", [], authoring),
      await (await serializeProjectBlob("Sections", [], authoring)).text(),
    ]) {
      const parsed = parseProject(text);
      expect(parsed.authoring).toEqual(authoring);
      expect(parsed.entities).toEqual([]);
    }
    for (const bad of [
      { ...authoring, activeSketchId: "missing" },
      {
        ...authoring,
        sketches: [authoring.sketches[0], authoring.sketches[0]],
      },
      {
        ...authoring,
        sketches: [
          {
            ...authoring.sketches[0],
            sketch: {
              ...sketch,
              reference: { ...result.reference, segments: [1, 2, 3] },
            },
          },
        ],
      },
    ])
      expect(() => parseProject(serializeProject("Bad", [], bad))).toThrow();
  });
  it("returns reference and placement metadata through the actual processing worker", async () => {
    const before = positions.slice(),
      replies: ProcessingResponse[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (reply: ProcessingResponse) => replies.push(reply),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage!({
      data: {
        kind: "sketchSection",
        positions,
        options,
        sourceId: "scan",
        hidden: [],
        sampled: false,
      },
    });
    const reply = replies.at(-1)!;
    expect(
      "result" in reply &&
        reply.result.sketchSection?.reference.segments.length,
    ).toBe(8);
    expect(positions).toEqual(before);
  });
});
