import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  collectNativeLandmarkRoots,
  publishedLandmarkRoots,
  type NativeLandmarkRoot,
} from "../src/native-landmark-roots";
import {
  beginLandmarkAlignment,
  landmarkSceneUnchanged,
  landmarkState,
  visibleLandmarkTargets,
} from "../src/landmark-alignment";
import type { Entity } from "../src/types";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../docs/evidence/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
interface CapturedRoot extends Omit<
  NativeLandmarkRoot,
  "excludedInterface" | "exempt" | "level" | "ready" | "consumers"
> {
  excludeKind: number | null;
  specialKind: number | null;
  rank: number;
  enabled: boolean;
  dependencies: (string | null)[];
}
const original = fixture("landmark-root-collector-native") as {
  cases: {
    name: string;
    roots: (string | null)[];
    objects: CapturedRoot[];
    visibleOnly: boolean;
    result: string[];
  }[];
};
it.each(original.cases)(
  "matches original complete collector: $name",
  (sample) => {
    expect(
      collectNativeLandmarkRoots(
        sample.roots,
        sample.objects.map((object) => ({
          ...object,
          excludedInterface: object.excludeKind !== null,
          exempt: object.specialKind !== null || !object.supported,
          level: object.rank,
          ready: object.enabled,
          consumers: object.dependencies,
        })),
        sample.visibleOnly,
      ),
    ).toEqual(sample.result);
  },
);
interface ProjectionCase {
  graphMask: number;
  exemptMask: number;
  hiddenMask: number;
  result: number[];
}
const projection = fixture("landmark-authoring-roots-native") as {
  edgeOrder: [number, number][];
  cases: ProjectionCase[];
  additionalProtocolCases: typeof original.cases;
};
it.each(projection.additionalProtocolCases)(
  "matches original child query: $name",
  (sample) => {
    expect(
      collectNativeLandmarkRoots(
        sample.roots,
        sample.objects.map((object) => ({
          ...object,
          excludedInterface: object.excludeKind !== null,
          exempt: object.specialKind !== null || !object.supported,
          level: object.rank,
          ready: object.enabled,
          consumers: object.dependencies,
        })),
        sample.visibleOnly,
      ),
    ).toEqual(sample.result);
  },
);
const base: Entity = {
  id: "moving",
  name: "Scan",
  kind: "mesh",
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
  indexedMesh: {
    vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    triangles: [0, 1, 2],
  },
  color: "#aaa",
  visible: true,
  opacity: 1,
};
function scene(sample: ProjectionCase) {
  return Array.from({ length: 4 }, (_, node): Entity => ({
    ...base,
    id: String(node),
    kind: sample.exemptMask & (1 << node) ? "plane" : "cad",
    indexedMesh: undefined,
    kernelId: `body-${node}`,
    visible: !(sample.hiddenMask & (1 << node)),
    authoringLinks: {
      featureId: `f-${node}`,
      output: 0,
      references: projection.edgeOrder
        .filter(
          ([, child], index) =>
            child === node && sample.graphMask & (1 << index),
        )
        .map(([parent]) => String(parent)),
    },
  }));
}
it("matches 2048 complete native DAG root captures independently of scene order", () => {
  for (const sample of projection.cases) {
    const entities = scene(sample),
      expected = sample.result.map(String);
    expect(publishedLandmarkRoots(entities), JSON.stringify(sample)).toEqual(
      expected,
    );
    expect(publishedLandmarkRoots([...entities].reverse())).toEqual(
      [...expected].reverse(),
    );
    expect(
      visibleLandmarkTargets(base, [base, ...entities]).map((e) => e.id),
    ).toEqual(expected);
  }
});
it("retains raw scan targets and detects a hidden consumer changing a CAD root", () => {
  const entities = scene({
    graphMask: 1,
    exemptMask: 0,
    hiddenMask: 2,
    result: [],
  });
  const fixed = { ...base, id: "fixed" };
  const session = beginLandmarkAlignment(base, fixed, {
    scene: [base, fixed, ...entities],
  });
  expect(landmarkState(session)).toHaveProperty("refinementTargetIds", [
    "2",
    "3",
    "fixed",
  ]);
  const changed = entities.map((e) =>
    e.id === "1"
      ? { ...e, authoringLinks: { ...e.authoringLinks!, references: [] } }
      : e,
  );
  expect(landmarkSceneUnchanged(session, [base, fixed, ...changed])).toBe(
    false,
  );
  expect(
    visibleLandmarkTargets(base, [base, fixed, ...changed]).map((e) => e.id),
  ).toEqual(["0", "2", "3", "fixed"]);
});
it("resolves parametric output references rather than names or browser positions", () => {
  const first: Entity = {
    ...base,
    id: "first",
    kind: "cad",
    kernelId: "first",
    parametric: {
      output: 1,
      feature: {
        id: "a",
        name: "same",
        recipe: {
          kind: "primitive",
          input: { kind: "sphere", center: [0, 0, 0], radius: 1 },
        },
      },
    },
  };
  const unused: Entity = {
    ...first,
    id: "unused",
    parametric: { ...first.parametric!, output: 0 },
  };
  const last: Entity = {
    ...first,
    id: "last",
    kernelId: "last",
    parametric: {
      output: 0,
      feature: {
        id: "b",
        name: "same",
        recipe: {
          kind: "offset",
          source: { featureId: "a", output: 1 },
          distance: 1,
        },
      },
    },
  };
  expect(publishedLandmarkRoots([last, unused, first])).toEqual([
    "last",
    "unused",
  ]);
});
it("rejects cyclic authoring metadata instead of inventing native update levels", () => {
  const a = {
    ...base,
    id: "a",
    authoringLinks: { featureId: "a", output: 0, references: ["b"] },
  };
  const b = {
    ...a,
    id: "b",
    authoringLinks: { featureId: "b", output: 0, references: ["a"] },
  };
  expect(() => publishedLandmarkRoots([a, b])).toThrow("contain a cycle");
});
