import { expect, it } from "vitest";
import { inspectReferenceDeviation } from "../src/inspection-reference";
import type { Entity } from "../src/types";
const make = (
  id: string,
  kind: Entity["kind"],
  positions: number[],
  hidden: number[] = [],
): Entity => ({
  id,
  name: id,
  kind,
  positions: new Float32Array(positions),
  visible: true,
  opacity: 1,
  color: "#fff",
  meshSelection: { hidden, saved: [] },
});
const reference = make("reference", "mesh", [0, 0, 0, 10, 0, 0, 0, 10, 0]);
it("compares sparse clouds to an open reference with explicit winding signs and radius coverage", async () => {
  const source = make(
    "source",
    "pointcloud",
    [1, 1, -1, 1, 1, 1, 1, 1, 3, 1, 1, 100],
    [3],
  );
  const before = source.positions.slice(),
    target = reference.positions.slice();
  const report = await inspectReferenceDeviation(source, reference, {
    maxDistance: 2,
    tolerance: 1,
    signed: true,
  });
  expect(report).toMatchObject({
    distances: [-1, 1, null, null],
    samples: 2,
    excluded: 1,
    unmatched: 1,
    eligible: 3,
    coverage: 2 / 3,
    rms: 1,
    mean: 0,
    withinTolerance: 2,
    semantics: "reference-triangle-winding",
    referenceId: "reference",
  });
  expect(source.positions).toEqual(before);
  expect(reference.positions).toEqual(target);
  expect(
    (
      await inspectReferenceDeviation(source, reference, {
        maxDistance: 2,
        tolerance: 1,
      })
    ).distances,
  ).toEqual([1, 1, null, null]);
});
it("filters hidden reference triangles and reports zero coverage without inventing a zero error", async () => {
  const source = make("source", "pointcloud", [1, 1, 1]);
  expect(
    await inspectReferenceDeviation(source, reference, { maxDistance: 0.5 }),
  ).toMatchObject({
    samples: 0,
    unmatched: 1,
    coverage: 0,
    rms: null,
    maximum: null,
  });
  await expect(
    inspectReferenceDeviation(
      source,
      { ...reference, meshSelection: { hidden: [0], saved: [] } },
      { maxDistance: 2 },
    ),
  ).rejects.toThrow(/visible/);
  await expect(
    inspectReferenceDeviation(source, source, { maxDistance: 2 }),
  ).rejects.toThrow();
});
it("cancels between indexing and sampling without publishing a partial report", async () => {
  let checks = 0;
  await expect(
    inspectReferenceDeviation(
      make("source", "pointcloud", [1, 1, 1]),
      reference,
      { maxDistance: 2 },
      {
        check: () => {
          if (++checks === 3) throw new DOMException("cancelled", "AbortError");
        },
      },
    ),
  ).rejects.toThrow(/cancelled/);
});
