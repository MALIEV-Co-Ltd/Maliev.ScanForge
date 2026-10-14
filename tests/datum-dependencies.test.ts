import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-dependencies-native.json";
import {
  datumEntityDependencies,
  nativeDatumDependentCandidates,
} from "../src/datum-dependencies";
import type { Entity } from "../src/types";

it("matches all 6144 complete native collector captures", () => {
  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  for (const sample of native.cases) {
    const candidates = [0, 1, 2, 3, 0, 2].map((node) => ({
      id: String(node),
      references: [
        ...edges
          .filter(
            ([source], index) => source === node && sample.mask & (1 << index),
          )
          .map(([, target]) => String(target)),
        ...(sample.selfAndMissing ? [String(node), "missing"] : []),
      ],
      eligible: !(sample.category === 2 && node === 1),
      excluded: sample.category === 1 && node === 2,
    }));
    const seeds = [0, 1, 2, 3]
      .filter((node) => sample.seedMask & (1 << node))
      .map(String);
    expect(
      nativeDatumDependentCandidates(candidates, seeds),
      JSON.stringify(sample),
    ).toEqual(sample.collected.map(String));
  }
});

it("maps exact output identities and retained source scans without matching names", () => {
  const base: Entity = {
    id: "scan",
    name: "same",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    color: "#ffffff",
    visible: true,
    opacity: 1,
  };
  const source: Entity = {
    ...base,
    id: "source",
    kind: "cad",
    kernelId: "source",
    parametric: {
      output: 1,
      feature: {
        id: "f",
        name: "same",
        recipe: {
          kind: "primitive",
          input: { kind: "sphere", center: [0, 0, 0], radius: 1 },
        },
      },
    },
  };
  const other = {
    ...source,
    id: "other",
    parametric: { ...source.parametric!, output: 0 },
  };
  const dependent: Entity = {
    ...source,
    id: "dependent",
    surfaceScanId: "scan",
    parametric: {
      output: 0,
      feature: {
        id: "g",
        name: "same",
        recipe: {
          kind: "offset",
          source: { featureId: "f", output: 1 },
          distance: 1,
        },
      },
    },
  };
  const candidates = datumEntityDependencies([base, source, other, dependent]);
  expect(candidates[3].references).toEqual(["scan", "source"]);
  expect(nativeDatumDependentCandidates(candidates, ["source"])).toEqual([
    "dependent",
  ]);
  expect(nativeDatumDependentCandidates(candidates, ["other"])).toEqual([]);
  expect(nativeDatumDependentCandidates(candidates, ["scan"])).toEqual([
    "dependent",
  ]);
});

it("bounds cycles and skips unresolved/self references", () => {
  const candidates = [
    {
      id: "a",
      references: ["a", "b", "missing"],
      eligible: true,
      excluded: false,
    },
    { id: "b", references: ["a"], eligible: true, excluded: false },
  ];
  expect(nativeDatumDependentCandidates(candidates, ["a"])).toEqual(["a", "b"]);
  expect(nativeDatumDependentCandidates(candidates, ["missing"])).toEqual([]);
});
