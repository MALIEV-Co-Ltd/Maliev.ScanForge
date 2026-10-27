import { describe, expect, it, vi } from "vitest";
import {
  createCadEvaluator,
  featureDependencies,
  rebuildParametric,
  validateParametricModel,
  type ParametricFeature,
} from "../src/parametric";
import { coordinateSketchFrame } from "../src/sketch-frame";
import type { CadClient } from "../src/cad/client";
import type { Sketch, SketchConstraint } from "../src/sketch";
import * as sketchModule from "../src/sketch";
import {
  entityFeatureModel,
  entityFeatureState,
} from "../src/parametric-entities";
import { validateProject } from "../src/io";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import type { Entity, Project } from "../src/types";

function circle(): Sketch {
  return {
    version: 1,
    frame: coordinateSketchFrame("OYZ", 7),
    reference: {
      kind: "section",
      sourceId: "scan",
      axis: "x",
      offset: 7,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [2, 0, -2, 0],
    },
    points: [
      { id: "a", x: 2, y: 0 },
      { id: "b", x: -2, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    segments: [{ id: "guide", a: "a", b: "c", construction: true }],
    arcs: [
      { id: "top", a: "a", b: "b", center: "c", clockwise: false },
      { id: "bottom", a: "b", b: "a", center: "c", clockwise: false },
    ],
    constraints: [
      { id: "fixed-center", kind: "fixed", point: "c", x: 0, y: 0 },
    ],
  };
}
function model(sketch: unknown, extra = {}) {
  return {
    format: "scanforge-parametric",
    version: 1,
    features: [
      {
        id: "face",
        name: "Sketch face",
        recipe: { kind: "sketchSurface", sketch, ...extra },
      },
    ],
  };
}
function feature(sketch: Sketch): ParametricFeature {
  const value: unknown = model(sketch);
  validateParametricModel(value);
  return value.features[0];
}
const mesh = {
  kernelId: "face-native",
  brep: "exact-face",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
};
function harness() {
  const sketchSurface = vi.fn(async (..._args: unknown[]) => mesh),
    extrude = vi.fn(),
    extrudeCurves = vi.fn(),
    surface = vi.fn(),
    release = vi.fn(async () => {});
  const client = {
    sketchSurface,
    extrude,
    extrudeCurves,
    surface,
    release,
  } as unknown as CadClient;
  return {
    sketchSurface,
    extrude,
    extrudeCurves,
    surface,
    release,
    evaluator: createCadEvaluator(client),
  };
}

describe("editable analytic sketch surface recipes", () => {
  it("retains cached legacy CAD sketch recipes through project reopen and model binding without solving", async () => {
    const sketch: Sketch = {
      version: 1,
      points: Array.from({ length: 129 }, (_, i) => ({
        id: `p${i}`,
        x: 10 * Math.cos((2 * Math.PI * i) / 129),
        y: 10 * Math.sin((2 * Math.PI * i) / 129),
      })),
      segments: Array.from({ length: 129 }, (_, i) => ({
        id: `edge${i}`,
        a: `p${i}`,
        b: `p${(i + 1) % 129}`,
      })),
      constraints: [],
    };
    sketchModule.validateSketch(sketch);
    expect(sketchModule.sketchCurveProfile(sketch)).toHaveLength(129);
    const legacy: Entity = {
      id: "legacy",
      name: "Retained large sketch extrusion",
      kind: "cad",
      positions: new Float32Array(mesh.positions),
      color: "#ffffff",
      opacity: 1,
      visible: true,
      kernelId: "retained-legacy-native",
      brep: "retained-exact-legacy-brep",
      parametric: {
        output: 0,
        feature: {
          id: "legacy-feature",
          name: "Legacy extrusion",
          recipe: {
            kind: "extrude",
            profile: { kind: "sketch-curves", sketch },
            height: 5,
          },
        },
      },
    };
    const project: Project = {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Legacy CAD",
      entities: [legacy],
    };
    const solve = vi
      .spyOn(sketchModule, "solveSketch")
      .mockImplementation(() => {
        throw Error("LEGACY_SOLVER_TRAP: cached CAD must not solve");
      });
    try {
      expect(entityFeatureModel([legacy]).features[0].recipe).toEqual(
        legacy.parametric!.feature.recipe,
      );
      const checked = validateProject(project);
      expect(checked.entities[0].positions).toBe(legacy.positions);
      expect(checked.entities[0].brep).toBe(legacy.brep);
      const reopened = await decodeProjectFile(
        await encodeProjectFile({
          project,
          history: [{ label: "Cached legacy extrusion", entities: [legacy] }],
          future: [],
        }),
      );
      expect(reopened.project.entities[0].brep).toBe(legacy.brep);
      expect(Array.from(reopened.project.entities[0].positions)).toEqual(
        Array.from(legacy.positions),
      );
      expect(reopened.history[0].entities[0].positions).toBe(
        reopened.project.entities[0].positions,
      );
      expect(reopened.project.entities[0].parametric).toEqual(
        legacy.parametric,
      );
      const previous = entityFeatureState([legacy]);
      const independent: ParametricFeature = {
        id: "new-box",
        name: "Independent box",
        recipe: {
          kind: "primitive",
          input: { kind: "box", center: [0, 0, 0], size: [1, 1, 1] },
        },
      };
      const evaluate = vi.fn(async (feature: ParametricFeature) => {
        if (feature.id === "legacy-feature")
          throw Error("LEGACY_NATIVE_TRAP: cached CAD must not rebuild");
        return [{ ...mesh, kernelId: "new-independent" }];
      });
      const release = vi.fn(async () => {});
      const rebuilt = await rebuildParametric(
        previous,
        {
          ...previous.model,
          features: [...previous.model.features, independent],
        },
        { evaluate, release },
      );
      expect(rebuilt.rebuiltFeatureIds).toEqual(["new-box"]);
      expect(rebuilt.results["legacy-feature"]).toBe(
        previous.results["legacy-feature"],
      );
      expect(rebuilt.results["legacy-feature"][0].brep).toBe(legacy.brep);
      await expect(
        rebuildParametric(
          previous,
          previous.model,
          { evaluate, release },
          { forceFeatureIds: ["legacy-feature"] },
        ),
      ).rejects.toThrow(/CAD sketch solver.*limit/i);
      await expect(
        rebuildParametric(
          previous,
          previous.model,
          { evaluate, release },
          { admitFeatureIds: ["legacy-feature"] },
        ),
      ).rejects.toThrow(/CAD sketch solver.*limit/i);
      await expect(
        rebuildParametric(undefined, previous.model, { evaluate, release }),
      ).rejects.toThrow(/CAD sketch solver.*limit/i);
      const changed: ParametricFeature = {
        ...previous.model.features[0],
        recipe: {
          kind: "extrude",
          profile: { kind: "sketch-curves", sketch },
          height: 6,
        },
      };
      await expect(
        rebuildParametric(
          previous,
          { ...previous.model, features: [changed] },
          { evaluate, release },
        ),
      ).rejects.toThrow(/CAD sketch solver.*limit/i);
      const validate = vi
        .spyOn(sketchModule, "validateSketch")
        .mockImplementation(() => {
          throw Error(
            "LEGACY_VALIDATION_TRAP: admission must precede detailed validation when cache is missing",
          );
        });
      try {
        await expect(
          rebuildParametric({ ...previous, results: {} }, previous.model, {
            evaluate,
            release,
          }),
        ).rejects.toThrow(/CAD sketch solver.*limit/i);
        await expect(
          rebuildParametric(
            {
              ...previous,
              results: {
                "legacy-feature": [
                  { ...previous.results["legacy-feature"][0], kernelId: "" },
                ],
              },
            },
            previous.model,
            { evaluate, release },
          ),
        ).rejects.toThrow(/CAD sketch solver.*limit/i);
        expect(validate).not.toHaveBeenCalled();
      } finally {
        validate.mockRestore();
      }
      expect(evaluate).toHaveBeenCalledOnce();
      expect(release).not.toHaveBeenCalled();
      expect(solve).not.toHaveBeenCalled();
    } finally {
      solve.mockRestore();
    }
  });

  it.each(["sketchSurface", "sketch-curves", "sketch"])(
    "admits solver work before %s CAD sketch solving",
    async (kind) => {
      for (const budget of [
        "points",
        "constraints",
        "residuals",
        "work",
        "curves",
        "construction-arcs",
      ]) {
        const count = budget === "points" ? 129 : budget === "work" ? 80 : 4;
        const sketch: Sketch = {
          version: 1,
          points: Array.from({ length: count }, (_, i) => ({
            id: `p${i}`,
            x: 10 * Math.cos((2 * Math.PI * i) / count),
            y: 10 * Math.sin((2 * Math.PI * i) / count),
          })),
          segments: Array.from({ length: count }, (_, i) => ({
            id: `edge${i}`,
            a: `p${i}`,
            b: `p${(i + 1) % count}`,
          })),
          constraints: Array.from(
            {
              length:
                budget === "constraints"
                  ? 257
                  : budget === "residuals"
                    ? 256
                    : 1,
            },
            (_, i): SketchConstraint => ({
              id: `fixed${i}`,
              kind: "fixed",
              point: "p0",
              x: 11,
              y: 0,
            }),
          ),
        };
        // The residual fixture has two implicit arc rows in addition to 512 fixed rows.
        if (budget === "residuals") {
          const arcSketch = circle();
          sketch.points = arcSketch.points;
          sketch.segments = arcSketch.segments;
          sketch.arcs = arcSketch.arcs;
          sketch.constraints = sketch.constraints.map((c) => ({
            ...c,
            point: "a",
          }));
        }
        if (budget === "curves")
          sketch.segments.push(
            ...Array.from({ length: 9997 }, (_, i) => ({
              id: `construction${i}`,
              a: "p0",
              b: "p1",
              construction: true,
            })),
          );
        if (budget === "construction-arcs") {
          const arcSketch = circle();
          sketch.points = arcSketch.points;
          sketch.segments = arcSketch.segments;
          sketch.arcs = [
            ...arcSketch.arcs!,
            ...Array.from({ length: 511 }, (_, i) => ({
              ...arcSketch.arcs![0],
              id: `construction-arc${i}`,
              construction: true,
            })),
          ];
          sketch.constraints = [];
        }
        sketchModule.validateSketch(sketch);
        expect(sketchModule.sketchCurveProfile(sketch)).toHaveLength(
          budget === "residuals" || budget === "construction-arcs" ? 2 : count,
        );
        const before = structuredClone(sketch),
          h = harness();
        const candidate: ParametricFeature = {
          id: "bounded",
          name: "Bounded sketch",
          recipe:
            kind === "sketchSurface"
              ? { kind: "sketchSurface", sketch }
              : {
                  kind: "extrude",
                  profile:
                    kind === "sketch-curves"
                      ? { kind: "sketch-curves", sketch }
                      : { kind: "sketch", sketch },
                  height: 2,
                },
        };
        const graph: unknown = {
          format: "scanforge-parametric",
          version: 1,
          features: [candidate],
        };
        const solve = vi
          .spyOn(sketchModule, "solveSketch")
          .mockImplementation(() => {
            throw Error("SOLVER_ADMISSION_TRAP: dense solver must not start");
          });
        const validate = vi
          .spyOn(sketchModule, "validateSketch")
          .mockImplementation(() => {
            throw Error(
              "VALIDATION_ADMISSION_TRAP: detailed validation must not start",
            );
          });
        try {
          expect(() =>
            validateParametricModel(graph, { admitFeatureIds: [candidate.id] }),
          ).toThrow(/CAD sketch solver.*(?:budget|limit)/i);
          await expect(h.evaluator.evaluate(candidate, [])).rejects.toThrow(
            /CAD sketch solver.*(?:budget|limit)/i,
          );
          expect(solve).not.toHaveBeenCalled();
          expect(validate).not.toHaveBeenCalled();
          expect(h.sketchSurface).not.toHaveBeenCalled();
          expect(h.extrudeCurves).not.toHaveBeenCalled();
          expect(h.extrude).not.toHaveBeenCalled();
          expect(sketch).toEqual(before);
        } finally {
          validate.mockRestore();
          solve.mockRestore();
        }
      }
    },
  );

  it.each(["sketchSurface", "sketch-curves", "sketch"])(
    "preserves admissible %s CAD solver boundaries including residual-free sketches",
    async (kind) => {
      for (const boundary of [
        "points",
        "constraints",
        "implicit-residuals",
        "curves",
        "work",
      ]) {
        let sketch: Sketch = {
          version: 1,
          points: [
            { id: "p0", x: 0, y: 0 },
            { id: "p1", x: 4, y: 0 },
            { id: "p2", x: 4, y: 3 },
            { id: "p3", x: 0, y: 3 },
          ],
          segments: Array.from({ length: 4 }, (_, i) => ({
            id: `edge${i}`,
            a: `p${i}`,
            b: `p${(i + 1) % 4}`,
          })),
          constraints: [],
        };
        if (boundary === "points")
          sketch.points.push(
            ...Array.from({ length: 124 }, (_, i) => ({
              id: `unused${i}`,
              x: i,
              y: 10,
            })),
          );
        if (boundary === "constraints")
          sketch.constraints = Array.from({ length: 256 }, (_, i) => ({
            id: `fixed${i}`,
            kind: "fixed",
            point: "p0",
            x: 0,
            y: 0,
          }));
        if (boundary === "implicit-residuals") {
          sketch = circle();
          sketch.constraints = Array.from({ length: 255 }, (_, i) => ({
            id: `fixed${i}`,
            kind: "fixed",
            point: "a",
            x: 2,
            y: 0,
          }));
        }
        if (boundary === "curves")
          sketch.segments.push(
            ...Array.from({ length: 9996 }, (_, i) => ({
              id: `construction${i}`,
              a: "p0",
              b: "p1",
              construction: true,
            })),
          );
        if (boundary === "work") {
          sketch.points = Array.from({ length: 53 }, (_, i) => ({
            id: `p${i}`,
            x: 10 * Math.cos((2 * Math.PI * i) / 53),
            y: 10 * Math.sin((2 * Math.PI * i) / 53),
          }));
          sketch.segments = Array.from({ length: 53 }, (_, i) => ({
            id: `edge${i}`,
            a: `p${i}`,
            b: `p${(i + 1) % 53}`,
          }));
          sketch.constraints = [
            { id: "fixed", kind: "fixed", point: "p0", x: 10, y: 0 },
          ];
        }
        const candidate: ParametricFeature = {
          id: "admitted",
          name: "Admitted sketch",
          recipe:
            kind === "sketchSurface"
              ? { kind: "sketchSurface", sketch }
              : {
                  kind: "extrude",
                  profile:
                    kind === "sketch-curves"
                      ? { kind: "sketch-curves", sketch }
                      : { kind: "sketch", sketch },
                  height: 2,
                },
        };
        const h = harness(),
          before = structuredClone(sketch);
        h.extrude.mockResolvedValue(mesh);
        h.extrudeCurves.mockResolvedValue(mesh);
        const solve = vi.spyOn(sketchModule, "solveSketch").mockReturnValue({
          sketch,
          converged: true,
          maxResidual: 0,
          conflictingConstraintIds: [],
          degreesOfFreedom: 0,
          iterations: 0,
        });
        try {
          expect(() =>
            validateParametricModel(
              {
                format: "scanforge-parametric",
                version: 1,
                features: [candidate],
              },
              { admitFeatureIds: [candidate.id] },
            ),
          ).not.toThrow();
          expect(await h.evaluator.evaluate(candidate, [])).toEqual([mesh]);
          expect(solve).toHaveBeenCalledExactlyOnceWith(sketch);
          expect(sketch).toEqual(before);
        } finally {
          solve.mockRestore();
        }
      }
    },
  );

  it("retains a cloned full snapshot with no feature dependency on the scan or saved sketch", async () => {
    const sketch = circle(),
      before = structuredClone(sketch),
      h = harness();
    const graph = model(sketch);
    validateParametricModel(graph);
    expect(featureDependencies(graph.features[0].recipe)).toEqual([]);
    const rebuilt = await rebuildParametric(undefined, graph, h.evaluator);
    expect(rebuilt.results.face).toEqual([mesh]);
    expect(rebuilt.model.features[0].recipe).toEqual({
      kind: "sketchSurface",
      sketch: before,
    });
    expect(rebuilt.model.features[0].recipe).not.toBe(graph.features[0].recipe);
    expect(Object.isFrozen(rebuilt.model.features[0].recipe)).toBe(true);
    sketch.points[0].x = 9;
    sketch.reference!.segments[0] = 9;
    expect(rebuilt.model.features[0].recipe).toEqual({
      kind: "sketchSurface",
      sketch: before,
    });
  });

  it("passes exact arcs and placement to the typed face operation without chord conversion", async () => {
    const sketch = circle(),
      before = structuredClone(sketch),
      h = harness();
    expect(await h.evaluator.evaluate(feature(sketch), [])).toEqual([mesh]);
    expect(h.sketchSurface).toHaveBeenCalledExactlyOnceWith(
      [
        {
          kind: "arc",
          start: [2, 0],
          end: [-2, 0],
          center: [0, 0],
          clockwise: false,
        },
        {
          kind: "arc",
          start: [-2, 0],
          end: [2, 0],
          center: [0, 0],
          clockwise: false,
        },
      ],
      sketch.frame,
    );
    expect(h.extrude).not.toHaveBeenCalled();
    expect(h.extrudeCurves).not.toHaveBeenCalled();
    expect(h.surface).not.toHaveBeenCalled();
    expect(sketch).toEqual(before);
  });

  it("keeps mixed analytic profiles and excludes construction curves", async () => {
    const sketch = circle(),
      h = harness();
    sketch.segments.push({ id: "diameter", a: "b", b: "a" });
    sketch.arcs = [sketch.arcs![0]];
    await h.evaluator.evaluate(feature(sketch), []);
    expect(h.sketchSurface.mock.calls[0][0]).toEqual([
      { kind: "line", start: [-2, 0], end: [2, 0] },
      {
        kind: "arc",
        start: [2, 0],
        end: [-2, 0],
        center: [0, 0],
        clockwise: false,
      },
    ]);
  });

  it("solves centrally without publishing solved coordinates into authored input", async () => {
    const sketch = circle(),
      h = harness();
    sketch.points[0].x = 2.1;
    sketch.constraints.push(
      { id: "fix-a", kind: "fixed", point: "a", x: 2, y: 0 },
      { id: "fix-b", kind: "fixed", point: "b", x: -2, y: 0 },
    );
    const before = structuredClone(sketch);
    await h.evaluator.evaluate(feature(sketch), []);
    const edges = h.sketchSurface.mock.calls[0][0] as { start: number[] }[];
    expect(edges[0].start[0]).toBeCloseTo(2, 6);
    expect(edges[0].start[0]).not.toBe(2.1);
    expect(sketch).toEqual(before);
  });

  it("rejects unconverged constraints before native acquisition and preserves authoring", async () => {
    const sketch = circle(),
      h = harness();
    sketch.constraints.push(
      { id: "fix-a", kind: "fixed", point: "a", x: 2, y: 0 },
      { id: "conflict-a", kind: "fixed", point: "a", x: 4, y: 0 },
    );
    const before = structuredClone(sketch);
    await expect(h.evaluator.evaluate(feature(sketch), [])).rejects.toThrow(
      /conflict/i,
    );
    expect(h.sketchSurface).not.toHaveBeenCalled();
    expect(sketch).toEqual(before);
  });

  it.each(["open", "branch", "disconnected", "radius", "reference-only"])(
    "rejects %s profiles without silently closing or changing authored curves",
    async (mode) => {
      const sketch = circle(),
        h = harness();
      if (mode === "open") sketch.arcs!.pop();
      if (mode === "branch")
        sketch.segments.push({ id: "branch", a: "a", b: "c" });
      if (mode === "radius") {
        sketch.points[1].x = -3;
        sketch.constraints.push(
          { id: "pin-a", kind: "fixed", point: "a", x: 2, y: 0 },
          { id: "pin-b", kind: "fixed", point: "b", x: -3, y: 0 },
        );
      }
      if (mode === "reference-only") {
        sketch.arcs = [];
        sketch.segments = [];
      }
      if (mode === "disconnected") {
        const other = circle();
        sketch.points.push(
          ...other.points.map((p) => ({
            ...p,
            id: `other-${p.id}`,
            x: p.x + 10,
          })),
        );
        sketch.arcs!.push(
          ...other.arcs!.map((a) => ({
            ...a,
            id: `other-${a.id}`,
            a: `other-${a.a}`,
            b: `other-${a.b}`,
            center: `other-${a.center}`,
          })),
        );
      }
      const before = structuredClone(sketch);
      await expect(h.evaluator.evaluate(feature(sketch), [])).rejects.toThrow(
        /closed|cycle|radius|circle|conflict/i,
      );
      expect(h.sketchSurface).not.toHaveBeenCalled();
      expect(sketch).toEqual(before);
    },
  );

  it("validates malformed sketches and frame invariants before native evaluation", () => {
    for (const sketch of [
      { ...circle(), version: 2 },
      { ...circle(), points: [{ id: "a", x: NaN, y: 0 }] },
      {
        ...circle(),
        frame: { ...coordinateSketchFrame("OXY", 0), normal: [0, 0, -1] },
      },
      {
        ...circle(),
        frame: { ...coordinateSketchFrame("OXY", 0), origin: [0, 0, 1e10] },
      },
    ])
      expect(() => validateParametricModel(model(sketch))).toThrow();
  });

  it.each([
    { chordTolerance: 0.1 },
    { height: 2 },
    { source: { featureId: "saved-sketch" } },
  ])("rejects extraneous recipe options %j", (extra) => {
    expect(() => validateParametricModel(model(circle(), extra))).toThrow(
      /unknown|field/i,
    );
  });
});
