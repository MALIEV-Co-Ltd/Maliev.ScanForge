import { expect, it } from "vitest";
import { publishedLandmarkRoots } from "../src/native-landmark-roots";
import {
  beginLandmarkAlignment,
  landmarkState,
  visibleLandmarkTargets,
} from "../src/landmark-alignment";
import type { Entity } from "../src/types";

const moving: Entity = {
  id: "moving",
  name: "Moving scan",
  kind: "mesh",
  visible: true,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indexedMesh: { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] },
  color: "#aaa",
  opacity: 1,
};
const parent: Entity = {
  ...moving,
  id: "cad-parent",
  name: "Exact CAD parent",
  kind: "cad",
  kernelId: "parent-body",
  constructionOrderKey: "01".repeat(16),
};

it.each([
  { kind: "point" as const, visible: true },
  { kind: "point" as const, visible: false },
  { kind: "line" as const, visible: true },
  { kind: "line" as const, visible: false },
])(
  "keeps a CAD target consumed by a $visible semantic $kind",
  ({ kind, visible }) => {
    const reference: Entity = {
      id: "reference",
      name: "Dependent reference",
      kind: kind === "point" ? "referencePoint" : "referenceLine",
      visible,
      positions: [],
      color: "#f00",
      opacity: 1,
      constructionOrderKey: "02".repeat(16),
      reference: {
        version: 1,
        definition:
          kind === "point"
            ? {
                version: 1,
                kind: "point",
                mode: "coordinates",
                position: [0, 0, 0],
                sources: [
                  {
                    id: parent.id,
                    constructionOrderKey: parent.constructionOrderKey!,
                  },
                ],
              }
            : {
                version: 1,
                kind: "line",
                mode: "endpoints",
                start: [0, 0, 0],
                end: [1, 0, 0],
                records: [],
                sources: [
                  {
                    id: parent.id,
                    constructionOrderKey: parent.constructionOrderKey!,
                  },
                ],
              },
        geometry:
          kind === "point"
            ? { kind: "point", position: [0, 0, 0] }
            : {
                kind: "line",
                start: [0, 0, 0],
                direction: [1, 0, 0],
                length: 1,
              },
        evaluation: { completionWord: 256 },
      },
    };
    for (const scene of [
      [moving, parent, reference],
      [reference, parent, moving],
    ]) {
      const before = JSON.stringify(scene);
      expect(publishedLandmarkRoots(scene)).toEqual(
        scene
          .filter(
            (e) => e.id === parent.id || (e.id === reference.id && visible),
          )
          .map((e) => e.id),
      );
      expect(visibleLandmarkTargets(moving, scene).map((e) => e.id)).toEqual([
        parent.id,
      ]);
      expect(
        landmarkState(beginLandmarkAlignment(moving, parent, { scene })),
      ).toMatchObject({ refinementTargetIds: [parent.id] });
      expect(JSON.stringify(scene)).toBe(before);
    }
  },
);
