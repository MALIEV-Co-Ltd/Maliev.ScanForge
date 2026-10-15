import { expect, it } from "vitest";
import native from "../docs/evidence/interactive-pose-controller-native.json";
import { InteractiveAlignmentSession } from "../src/interactive-alignment-session";
import type { Entity } from "../src/types";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
import { placedCloud, cloudPoseBits } from "../src/point-cloud-placement";
const pivot = [3.125, -2.5, 10000.1];
function entities(count: number, pose: number[]) {
  return Array.from({ length: count }, (_, i): Entity => {
    const sourcePositions = new Float32Array([1, 2, 3]);
    const positions = transformDatumCoordinates(sourcePositions, pose);
    return placedCloud(
      {
        id: String(i),
        name: String(i),
        kind: "pointcloud",
        positions,
        color: "#aaa",
        opacity: 1,
        visible: true,
      },
      { sourcePositions, matrixBits: cloudPoseBits(pose) },
      { positions },
    );
  });
}
it.each(
  native.cases
    .filter((c) => c.targetCount > 0)
    .map((c, index) => ({ ...c, index })),
)("retains original pose-controller contract $index", (c) => {
  const base = entities(c.targetCount, native.poses[c.pose]);
  const s = new InteractiveAlignmentSession(
    base,
    base.map((e) => e.id),
    pivot,
  );
  s.advance(
    native.transforms[c.delta],
    c.refresh
      ? base.map((_, i) => ({
          min: [1 + i * 10, 2 + i * 10, 3 + i * 10],
          max: [4 + i * 10, 5 + i * 10, 6 + i * 10],
        }))
      : undefined,
  );
  const result = s.inspect();
  expect(result.targets.map((t) => t.poseBits)).toEqual(c.poseBits);
  expect(
    Buffer.from(new Float64Array(result.pivot).buffer).toString("hex"),
  ).toBe(c.pivotBits);
  expect(base[0].positions).toHaveLength(3);
  expect(s.baseEntities).toBe(base);
  expect(result.boundsFresh).toBe(!!c.refresh);
});
it("keeps all buffers and history outside preview state and refuses stale geometry publication", async () => {
  const base = entities(1, native.poses[0]);
  const s = new InteractiveAlignmentSession(base, ["0"], pivot);
  const positions = base[0].positions;
  s.advance(native.transforms[1]);
  expect(base[0].positions).toBe(positions);
  expect(() => s.validate([...base])).toThrow("changed");
  expect(s.inspect().version).toBe(1);
  s.reset();
  expect(s.inspect().matrix).toEqual(native.poses[0]);
  expect(s.inspect().pivot).toEqual(pivot);
});
it("rejects missing, repeated, locked, invisible and empty targets before preview mutation", () => {
  const base = entities(1, native.poses[0]);
  for (const ids of [[], ["missing"], ["0", "0"]])
    expect(() => new InteractiveAlignmentSession(base, ids, pivot)).toThrow();
  for (const patch of [{ locked: true }, { visible: false }, { positions: [] }])
    expect(
      () =>
        new InteractiveAlignmentSession(
          [{ ...base[0], ...patch }],
          ["0"],
          pivot,
        ),
    ).toThrow();
});
it("bakes once after repeated preview steps, avoiding intermediate Float32 coordinate loss", async () => {
  const base: Entity[] = [
    {
      id: "cloud",
      name: "cloud",
      kind: "pointcloud",
      positions: new Float32Array([100000000, 0, 0]),
      normals: [1, 0, 0],
      color: "#aaa",
      opacity: 1,
      visible: true,
    },
  ];
  const s = new InteractiveAlignmentSession(base, ["cloud"], [0, 0, 0]);
  const move = [1, 0, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0];
  s.advance(move);
  s.advance(move);
  expect(base[0].positions[0]).toBe(100000000);
  const result = await s.bake({ parallel: false });
  expect(result[0].positions[0]).toBe(100000008);
  expect(result[0].normals).toEqual([1, 0, 0]);
  expect(result[0].pointCloudPlacement?.sourcePositions).toBe(
    base[0].positions,
  );
  expect(result[0].pointCloudPlacement?.matrixBits).toBe(
    s.inspect().targets[0].poseBits,
  );
  expect(s.inspect().applying).toBe(false);
  expect(base[0].positions[0]).toBe(100000000);
});
it("returns the original entities for a no-op and discards cancelled baking without mutating them", async () => {
  const base = entities(1, native.poses[0]);
  const s = new InteractiveAlignmentSession(base, ["0"], pivot);
  expect(await s.bake({ parallel: false })).toBe(base);
  s.advance(native.transforms[1]);
  const abort = new AbortController();
  abort.abort();
  await expect(
    s.bake({ signal: abort.signal, parallel: false }),
  ).rejects.toThrow();
  expect(s.inspect().applying).toBe(false);
  expect(s.baseEntities).toBe(base);
});
