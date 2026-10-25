import { expect, it } from "vitest";
import captures from "./fixtures/noise-octree-trees.json";
import { inspectReferenceDeviation } from "../src/inspection-reference";
import type { Entity } from "../src/types";
// These are retained controlled native query captures, not new native GUI imports.
it.each(captures.cases)(
  "preserves native point-query distances and missing coverage: $name",
  async (capture) => {
    const make = (
      id: string,
      kind: Entity["kind"],
      positions: Entity["positions"],
    ): Entity => ({
      id,
      name: id,
      kind,
      positions,
      visible: true,
      color: "#fff",
      opacity: 1,
    });
    const source = make(
      "source",
      "pointcloud",
      capture.samples.flatMap((sample) => sample.point),
    );
    const reference = make(
      "reference",
      "mesh",
      new Float32Array(capture.points.flat(2)),
    );
    const report = await inspectReferenceDeviation(source, reference, {
      maxDistance: 0.25,
      tolerance: 0.1,
      signed: true,
    });
    for (let i = 0; i < capture.samples.length; i++)
      expect(report.distances[i], capture.name + " sample " + i).toBe(
        capture.samples[i].distance,
      );
    expect(report.unmatched).toBe(
      capture.samples.filter((sample) => sample.distance === null).length,
    );
  },
);
