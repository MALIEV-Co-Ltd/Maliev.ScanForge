import { describe, expect, it, vi } from "vitest";
import { resetSketchRectangle } from "../src/sketch-authoring";
import {
  rectangleSketch,
  sketchProfile,
  validateSketch,
  type Sketch,
} from "../src/sketch";
import { coordinateSketchFrame, sketchWorldPoint } from "../src/sketch-frame";
import { drawSketchCircle } from "../src/sketch-drawing";
import { parseProject, serializeProject } from "../src/io";
import { createOperations } from "../src/automation/operations";
import { ApplicationApi, type WorkspaceHost } from "../src/automation/api";

const placedSketch = (plane: "OXY" | "OYZ" | "OXZ"): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  constraints: [],
  frame: coordinateSketchFrame(plane, 17),
  reference: {
    kind: "section",
    sourceId: "scan",
    axis: plane === "OXY" ? "z" : plane === "OYZ" ? "x" : "y",
    offset: 17,
    onSlicingPlane: true,
    selectedOnly: false,
    sampled: false,
    segments: [0, 0, 2, 2],
  },
});

describe("reset rectangle placement", () => {
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "replaces editable curves while preserving the %s frame and section references",
    (plane) => {
      const source = drawSketchCircle(placedSketch(plane), [3, 4], [8, 4]);
      const before = structuredClone(source);
      const reset = resetSketchRectangle(source);
      expect(reset).toEqual({
        ...rectangleSketch(),
        frame: before.frame,
        reference: before.reference,
      });
      expect(source).toEqual(before);
      expect(reset.arcs).toBeUndefined();
      expect(() => validateSketch(reset)).not.toThrow();
      expect(sketchProfile(reset)).toHaveLength(4);
      const point = sketchProfile(reset)[2];
      expect(sketchWorldPoint(reset.frame!, point)).toEqual(
        sketchWorldPoint(before.frame!, point),
      );
      expect(
        parseProject(serializeProject("reset", [], { sketch: reset }))
          .authoring!.sketch,
      ).toEqual(reset);
    },
  );

  it("retains legacy identity placement when the sketch has no frame or reference", () => {
    const reset = resetSketchRectangle(rectangleSketch(12, 9));
    expect(reset).toEqual(rectangleSketch());
    expect(reset).not.toHaveProperty("frame");
    expect(reset).not.toHaveProperty("reference");
  });

  it("retains an arbitrary translated and rotated sketch frame", () => {
    const source: Sketch = {
      ...rectangleSketch(12, 9),
      frame: {
        origin: [11, -23, 17],
        u: [0.6, 0.8, 0],
        v: [-0.8, 0.6, 0],
        normal: [0, 0, 1],
      },
    };
    const reset = resetSketchRectangle(source);
    expect(() => validateSketch(reset)).not.toThrow();
    expect(sketchWorldPoint(reset.frame!, [40, 30])).toEqual([11, 27, 17]);
    expect(reset.reference).toBeUndefined();
  });

  it("represents the same placed reset through the existing guarded MCP sketch_set", async () => {
    let sketch = placedSketch("OXZ");
    let busy = false;
    const setSketch = vi.fn((next: Sketch) => {
      sketch = next;
    });
    const host = {
      snapshot: () => ({
        name: "Test",
        entities: [],
        history: [],
        future: [],
        authoring: { sketch },
        selectedId: null,
        selection: null,
        settings: {},
      }),
      setSketch,
      busy: () => busy,
      activity: (running: boolean) => {
        busy = running;
      },
    } as unknown as WorkspaceHost;
    const api = new ApplicationApi(host, createOperations(host));
    const expected = resetSketchRectangle(sketch);
    const request = {
      sketch: expected,
      expectedRevision: api.currentRevision(),
      requestId: "reset-placed-sketch",
    };
    try {
      const first = await api.invoke("sketch_set", request);
      expect(first.ok, JSON.stringify(first)).toBe(true);
      expect(await api.invoke("sketch_set", request)).toEqual(first);
      expect(setSketch).toHaveBeenCalledTimes(1);
      expect(sketch).toEqual(expected);
      expect(await api.invoke("sketch_get", {})).toMatchObject({
        ok: true,
        result: { sketch: expected },
      });
      expect(busy).toBe(false);
    } finally {
      api.dispose();
    }
  });
});
