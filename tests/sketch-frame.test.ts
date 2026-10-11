import { describe, expect, it, vi } from "vitest";
import {
  coordinateSketchFrame,
  sketchWorldPoint,
  validateSketchFrame,
} from "../src/sketch-frame";
import { rectangleSketch, solveSketch, validateSketch } from "../src/sketch";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import {
  createCadEvaluator,
  rebuildParametric,
  validateParametricModel,
  type ParametricModel,
} from "../src/parametric";
import type { CadClient } from "../src/cad/client";

describe("sketch world placement", () => {
  it.each([
    ["OXY", [2, 3, 7]],
    ["OYZ", [7, 2, 3]],
    ["OXZ", [3, 7, 2]],
  ] as const)("maps local UV into %s", (plane, world) => {
    const frame = coordinateSketchFrame(plane, 7);
    expect(sketchWorldPoint(frame, [2, 3])).toEqual(world);
    const sketch = { ...rectangleSketch(), frame };
    expect(solveSketch(sketch).sketch.frame).toEqual(frame);
  });
  it("rejects scaled, sheared, reflected and nonfinite frames", () => {
    const base = coordinateSketchFrame("OXY", 0);
    for (const malformed of [
      { ...base, u: [2, 0, 0] },
      { ...base, v: [1, 1, 0] },
      { ...base, normal: [0, 0, -1] },
      { ...base, origin: [0, 0, Infinity] },
      { ...base, origin: [0, 0] },
      null,
    ]) {
      expect(() => validateSketchFrame(malformed)).toThrow(/frame/i);
      expect(() =>
        validateSketch({ ...rectangleSketch(), frame: malformed }),
      ).toThrow(/frame/i);
    }
  });
  it("retains legacy identity placement and persists planes in both project paths", async () => {
    const legacy = rectangleSketch();
    const placed = { ...legacy, frame: coordinateSketchFrame("OXZ", -12) };
    for (const sketch of [legacy, placed]) {
      for (const text of [
        serializeProject("Sketch", [], { sketch }),
        await (await serializeProjectBlob("Sketch", [], { sketch })).text(),
      ])
        expect(parseProject(text).authoring?.sketch).toEqual(sketch);
    }
    const data = JSON.parse(serializeProject("Sketch", [], { sketch: placed }));
    data.authoring.sketch.frame.normal = [0, -1, 0];
    expect(() => parseProject(JSON.stringify(data))).toThrow(/right-handed/);
  });
  it("rebuilds the exact CAD request when the saved sketch plane changes", async () => {
    let next = 0;
    const client = {
      extrude: vi.fn(async () => ({
        kernelId: `shape-${++next}`,
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      })),
      release: vi.fn(async () => {}),
    } as unknown as CadClient;
    const evaluator = createCadEvaluator(client);
    const frame = coordinateSketchFrame("OYZ", 21);
    const model = (plane = frame): ParametricModel => ({
      format: "scanforge-parametric",
      version: 1,
      features: [
        {
          id: "extrusion",
          name: "Extrusion",
          recipe: {
            kind: "extrude",
            height: 8,
            profile: {
              kind: "sketch",
              sketch: { ...rectangleSketch(), frame: plane },
            },
          },
        },
      ],
    });
    const first = await rebuildParametric(undefined, model(), evaluator);
    expect(client.extrude).toHaveBeenLastCalledWith(
      expect.any(Array),
      8,
      frame,
    );
    const moved = coordinateSketchFrame("OXZ", -5);
    const second = await rebuildParametric(first, model(moved), evaluator);
    expect(client.extrude).toHaveBeenLastCalledWith(
      expect.any(Array),
      8,
      moved,
    );
    expect(second).not.toEqual(first);
    const invalid = JSON.parse(JSON.stringify(model()));
    invalid.features[0].recipe.profile.sketch.frame.u = [0, 2, 0];
    expect(() => validateParametricModel(invalid)).toThrow(/orthonormal/);
  });
});
