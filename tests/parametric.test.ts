import { describe, expect, it, vi } from "vitest";
import {
  rebuildParametric,
  validateParametricModel,
  topologicalFeatures,
  createCadEvaluator,
  ParametricRebuildError,
  type ParametricFeature,
  type ParametricModel,
  type ParametricEvaluator,
} from "../src/parametric";
import type { KernelMesh } from "../src/types";
import type { CadClient } from "../src/cad/client";

const primitive = (id: string, size = 10): ParametricFeature => ({
  id,
  name: id,
  recipe: {
    kind: "primitive",
    input: { kind: "box", center: [0, 0, 0], size: [size, size, size] },
  },
});
const pattern = (id: string, source: string): ParametricFeature => ({
  id,
  name: id,
  recipe: {
    kind: "pattern",
    source: { featureId: source },
    pattern: { kind: "linear", count: 3, step: [20, 0, 0] },
  },
});
const model = (features: ParametricFeature[]): ParametricModel => ({
  format: "scanforge-parametric",
  version: 1,
  features,
});
function harness() {
  let sequence = 0;
  const calls: { id: string; inputs: string[] }[] = [],
    releases: string[][] = [];
  const evaluator: ParametricEvaluator = {
    async evaluate(feature, inputs) {
      calls.push({
        id: feature.id,
        inputs: inputs.map((input) => input.kernelId),
      });
      return Array.from(
        { length: feature.recipe.kind === "split" ? 2 : 1 },
        () => ({
          kernelId: `${feature.id}-${++sequence}`,
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          brep: `brep-${sequence}`,
        }),
      );
    },
    async release(ids) {
      releases.push([...ids]);
    },
  };
  return { evaluator, calls, releases };
}

describe("dependent parametric feature rebuild", () => {
  it("rejects malformed mesh outputs and cleans newly owned invalid handles", async () => {
    const release = vi.fn(async () => {});
    for (const positions of [[], [0, 0, 0], [0, 0, 0, 1, 0, 0, NaN, 1, 0]])
      await expect(
        rebuildParametric(undefined, model([primitive("seed")]), {
          evaluate: async () => [{ kernelId: "invalid-new", positions }],
          release,
        }),
      ).rejects.toThrow(/invalid native outputs/);
    expect(release).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenLastCalledWith(["invalid-new"]);
    expect(() =>
      validateParametricModel(
        model([
          {
            id: "x",
            name: "x",
            recipe: {
              ...primitive("x").recipe,
              unrecognized: true,
            } as unknown as ParametricFeature["recipe"],
          },
        ]),
      ),
    ).toThrow(/unknown fields/);
  });
  it("topologically rebuilds only edited feature descendants and replaces dependency handles", async () => {
    const source = model([
        pattern("copies", "seed"),
        primitive("seed"),
        pattern("nested", "copies"),
        primitive("independent"),
      ]),
      h = harness();
    const first = await rebuildParametric(undefined, source, h.evaluator);
    expect(h.calls.map((call) => call.id)).toEqual([
      "seed",
      "independent",
      "copies",
      "nested",
    ]);
    h.calls.length = 0;
    const changed = model(
      source.features.map((feature) =>
        feature.id === "seed" ? primitive("seed", 15) : feature,
      ),
    );
    const next = await rebuildParametric(first, changed, h.evaluator);
    expect(next.rebuiltFeatureIds).toEqual(["seed", "copies", "nested"]);
    expect(h.calls[1].inputs).toEqual([next.results.seed[0].kernelId]);
    expect(h.calls[2].inputs).toEqual([next.results.copies[0].kernelId]);
    expect(next.results.independent).toBe(first.results.independent);
    expect(h.releases[0].sort()).toEqual(
      [
        first.results.seed[0].kernelId,
        first.results.copies[0].kernelId,
        first.results.nested[0].kernelId,
      ].sort(),
    );
    expect(Object.isFrozen(next.model.features[0].recipe)).toBe(true);
    expect(Object.isFrozen(next.model)).toBe(true);
    expect(source.features[1].recipe).toEqual(primitive("seed").recipe);
  });
  it("propagates a changed dependency reference and supports the second split output", async () => {
    const split: ParametricFeature = {
      id: "split",
      name: "split",
      recipe: {
        kind: "split",
        source: { featureId: "a" },
        cutter: { featureId: "b" },
      },
    };
    const dependent: ParametricFeature = {
      id: "copies",
      name: "copies",
      recipe: {
        kind: "pattern",
        source: { featureId: "split", output: 1 },
        pattern: { kind: "linear", count: 2, step: [20, 0, 0] },
      },
    };
    const h = harness();
    const first = await rebuildParametric(
      undefined,
      model([primitive("a"), primitive("b"), split, dependent]),
      h.evaluator,
    );
    expect(h.calls.at(-1)?.inputs).toEqual([first.results.split[1].kernelId]);
    h.calls.length = 0;
    const changed = model([
      primitive("a"),
      primitive("b"),
      split,
      pattern("copies", "b"),
    ]);
    const next = await rebuildParametric(first, changed, h.evaluator);
    expect(next.rebuiltFeatureIds).toEqual(["copies"]);
    expect(h.calls[0].inputs).toEqual([first.results.b[0].kernelId]);
  });
  it("validates missing dependencies, cycles, invalid output slots and malformed recipes before evaluation", async () => {
    const h = harness();
    for (const graph of [
      model([pattern("a", "missing")]),
      model([pattern("a", "b"), pattern("b", "a")]),
      model([
        primitive("a"),
        {
          id: "b",
          name: "b",
          recipe: {
            kind: "mirror",
            source: { featureId: "a", output: 1 },
            planeOrigin: [0, 0, 0],
            normal: [1, 0, 0],
          },
        },
      ]),
      model([primitive("a", -1)]),
    ])
      await expect(
        rebuildParametric(undefined, graph, h.evaluator),
      ).rejects.toThrow();
    expect(h.calls).toEqual([]);
    expect(h.releases).toEqual([]);
    expect(() =>
      validateParametricModel({
        ...model([]),
        features: [{ id: "x", name: "x", recipe: { kind: "unknown" } }],
      }),
    ).toThrow(/Unsupported/);
    expect(
      topologicalFeatures(model([pattern("b", "a"), primitive("a")])).map(
        (feature) => feature.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("rolls back all newly generated native outputs when a descendant fails and preserves old state", async () => {
    const h = harness(),
      graph = model([primitive("a"), pattern("b", "a"), pattern("c", "b")]);
    const previous = await rebuildParametric(undefined, graph, h.evaluator);
    h.releases.length = 0;
    h.calls.length = 0;
    const generated: string[] = [];
    const failing: ParametricEvaluator = {
      async evaluate(feature, inputs) {
        if (feature.id === "c") throw new Error("Native failure");
        const outputs = await h.evaluator.evaluate(feature, inputs);
        generated.push(...outputs.map((output) => output.kernelId));
        return outputs;
      },
      release: h.evaluator.release,
    };
    await expect(
      rebuildParametric(
        previous,
        model([primitive("a", 25), ...graph.features.slice(1)]),
        failing,
      ),
    ).rejects.toThrow("Native failure");
    expect(h.releases).toEqual([generated]);
    expect(previous.results.a[0].kernelId).not.toBe(generated[0]);
    expect(
      generated.some((id) =>
        Object.values(previous.results)
          .flat()
          .some((output) => output.kernelId === id),
      ),
    ).toBe(false);
  });
  it("cancels after an in-flight operation resolves and releases its generated handles", async () => {
    const controller = new AbortController(),
      release = vi.fn(async () => {});
    let resolveOperation!: (outputs: KernelMesh[]) => void;
    const evaluator: ParametricEvaluator = {
      evaluate: () =>
        new Promise((resolve) => {
          resolveOperation = resolve;
        }),
      release,
    };
    const pending = rebuildParametric(
      undefined,
      model([primitive("a"), pattern("b", "a")]),
      evaluator,
      { signal: controller.signal },
    );
    controller.abort();
    resolveOperation([
      { kernelId: "new-a", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    ]);
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(release).toHaveBeenCalledWith(["new-a"]);
  });
  it("retains history-protected native handles and releases removed features", async () => {
    const h = harness(),
      previous = await rebuildParametric(
        undefined,
        model([primitive("a"), primitive("b")]),
        h.evaluator,
      );
    const keep = new Set([previous.results.a[0].kernelId]);
    const next = await rebuildParametric(
      previous,
      model([primitive("a", 30)]),
      h.evaluator,
      { preserveKernelIds: keep },
    );
    expect(next.releasedKernelIds).toEqual([previous.results.b[0].kernelId]);
    expect(next.cleanupFailures).toEqual([]);
  });
  it("reports cleanup failure without losing successful new results or hiding rollback failures", async () => {
    const h = harness(),
      previous = await rebuildParametric(
        undefined,
        model([primitive("a")]),
        h.evaluator,
      ),
      release = async () => {
        throw new Error("Release unavailable");
      };
    const next = await rebuildParametric(
      previous,
      model([primitive("a", 20)]),
      { ...h.evaluator, release },
    );
    expect(next.results.a[0].kernelId).not.toBe(previous.results.a[0].kernelId);
    expect(next.cleanupFailures[0].kernelIds).toEqual([
      previous.results.a[0].kernelId,
    ]);
    expect(next.releasedKernelIds).toEqual([]);
    const failing: ParametricEvaluator = {
      async evaluate(feature, inputs) {
        if (feature.id === "b") throw new Error("Operation failed");
        return h.evaluator.evaluate(feature, inputs);
      },
      release,
    };
    let failure: unknown;
    try {
      await rebuildParametric(
        undefined,
        model([primitive("a"), pattern("b", "a")]),
        failing,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ParametricRebuildError);
    expect((failure as ParametricRebuildError).cleanupFailures[0].message).toBe(
      "Release unavailable",
    );
  });
  it("uses exact CAD adapter inputs and never releases borrowed handles returned by a faulty evaluator", async () => {
    const native: KernelMesh = {
        kernelId: "native",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      },
      client = {
        primitive: vi.fn(async () => native),
        pattern: vi.fn(async () => ({ ...native, kernelId: "pattern" })),
        release: vi.fn(async () => {}),
      } as unknown as CadClient;
    const evaluator = createCadEvaluator(client);
    const graph = model([primitive("a"), pattern("b", "a")]);
    const first = await rebuildParametric(undefined, graph, evaluator);
    expect(client.pattern).toHaveBeenCalledWith("native", {
      kind: "linear",
      count: 3,
      step: [20, 0, 0],
    });
    await expect(
      rebuildParametric(first, model([primitive("a", 20)]), {
        evaluate: async () => [native],
        release: evaluator.release,
      }),
    ).rejects.toThrow(/newly owned/);
    expect(client.release).not.toHaveBeenCalled();
  });
});
