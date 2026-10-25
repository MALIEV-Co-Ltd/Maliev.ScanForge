import { expect, it } from "vitest";
import { SketchLineChild } from "../src/cad/sketch-line-child";
import { SketchChildCollection } from "../src/cad/sketch-child-collection";
import {
  decodeSketchSourceRecordStore,
  encodeSketchSourceRecordStore,
} from "../src/sketch-source-records";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";
import type { NativeSketchLineState } from "../src/sketch-line-rebuild";

const frame = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
] as const;
function fixture(
  succeeds = false,
  records: NativeSketchLineState["sourceRecords"] = [
    [1 + 2 ** -26, -0, 3],
    [4, 5, 6],
  ],
) {
  let disposed = false,
    hasCurve = false;
  const child = new SketchLineChild(
    {
      frame: [
        [1, 0, 0, 10],
        [0, 1, 0, 20],
        [0, 0, 1, 30],
      ],
      start: [1, 2, 3],
      middle: [2, 3, 4],
      end: [3, 4, 5],
      sourceRecords: records,
    },
    {
      edge: undefined,
      snapshot: () => ({ disposed, hasCurve }),
      rebuild: () => {
        hasCurve = true;
        return succeeds;
      },
      midpoint: () => [7, 8, 9],
      dispose: () => {
        disposed = true;
        hasCurve = false;
      },
    },
  );
  return child;
}
it("retains actual line sources and distinct owner/child frames through collection and codec", () => {
  const child = fixture(),
    owner = new SketchChildCollection<SketchLineChild>("owner", frame);
  try {
    owner.splice(0, 0, [{ id: "line", child }]);
    const snapshot = owner.snapshot();
    expect(snapshot.sources.children[0].records).toEqual(
      child.snapshot().state!.sourceRecords,
    );
    expect(snapshot.sources.frame).toEqual(frame);
    expect(snapshot.children[0].state.preparation!.frame[0][3]).toBe(10);
    expect(
      decodeSketchSourceRecordStore(
        encodeSketchSourceRecordStore(snapshot.sources),
      ),
    ).toEqual(snapshot.sources);
    expect(
      resolveSketchConstructionPick(snapshot.sources, {
        sourceId: "owner",
        childId: "line",
        recordIndex: 0,
      }).primitive,
    ).toEqual({
      kind: "point",
      position: [1 + 2 ** -26, 0, 3],
      objectResolved: true,
    });
    (snapshot.sources.children[0].records![0] as [number, number, number])[0] =
      99;
    expect(owner.snapshot().sources.children[0].records![0][0]).toBe(
      1 + 2 ** -26,
    );
  } finally {
    owner.dispose();
  }
});
it("projects retained records after backend failure rather than proposed endpoints", () => {
  const child = fixture(),
    owner = new SketchChildCollection<SketchLineChild>("owner", frame);
  try {
    expect(
      child.replaceLocalRecords([
        [10, 11, 12],
        [20, 21, 22],
      ]).builderSucceeded,
    ).toBe(false);
    owner.splice(0, 0, [{ id: "line", child }]);
    expect(owner.snapshot().sources.children[0].records).toEqual([
      [1 + 2 ** -26, -0, 3],
      [4, 5, 6],
    ]);
    expect(owner.snapshot().children[0].state.state!.start).toEqual([
      10, 11, 12,
    ]);
  } finally {
    owner.dispose();
  }
});
it("stages successful line source replacement without publishing it before acceptance", () => {
  const old = fixture(),
    next = fixture(true),
    owner = new SketchChildCollection<SketchLineChild>("owner", frame);
  try {
    owner.splice(0, 0, [{ id: "line", child: old }]);
    expect(
      next.replaceLocalRecords([
        [10, 11, 12],
        [20, 21, 22],
      ]).builderSucceeded,
    ).toBe(true);
    const stage = owner.stageSplice(0, 1, [{ id: "line", child: next }]);
    expect(stage.snapshot().sources.children[0].records).toEqual([
      [10, 11, 0],
      [20, 21, 0],
    ]);
    expect(owner.snapshot().sources.children[0].records![0][0]).toBe(
      1 + 2 ** -26,
    );
    const retired = stage.accept();
    expect(retired[0].child).toBe(old);
    expect(old.snapshot().disposed).toBe(false);
    expect(owner.snapshot().sources.children[0].records).toEqual([
      [10, 11, 0],
      [20, 21, 0],
    ]);
  } finally {
    owner.dispose();
    old.dispose();
    next.dispose();
  }
});
it("preserves explicitly empty sources and removes the projection on disposal", () => {
  const child = fixture(false, []),
    owner = new SketchChildCollection<SketchLineChild>("owner", frame);
  owner.splice(0, 0, [{ id: "line", child }]);
  expect(owner.snapshot().sources.children[0].records).toEqual([]);
  owner.dispose();
  expect(child.snapshot().preparation).toBeUndefined();
});
