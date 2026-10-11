import { describe, expect, it } from "vitest";
import { SketchUndo } from "../src/sketch-undo";
import {
  drawSketchCircle,
  drawSketchLine,
  drawThreePointCurve,
} from "../src/sketch-drawing";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { parseProject, serializeProject } from "../src/io";
import type { Sketch } from "../src/sketch";

function empty(): Sketch {
  return {
    version: 1,
    points: [],
    segments: [],
    constraints: [],
    frame: coordinateSketchFrame("OXZ", 12),
    reference: {
      kind: "section",
      sourceId: "scan",
      axis: "y",
      offset: 12,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [0, 0, 1, 1],
    },
  };
}
describe("one-step sketch authoring undo", () => {
  it("undoes and redoes line creation while preserving placement and frozen scan references", () => {
    const session = new SketchUndo(),
      before = empty();
    Object.freeze(before.reference!.segments);
    Object.freeze(before.reference);
    const drawn = drawSketchLine(before, [0, 0], [10, 0], 0.1, true);
    session.record(before, drawn);
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
    const restored = session.undo(drawn)!;
    expect(restored.points).toEqual([]);
    expect(restored.frame).toEqual(before.frame);
    expect(restored.reference).toBe(before.reference);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
    expect(session.undo(restored)).toBeUndefined();
    const redone = session.redo(restored)!;
    expect(redone).toEqual(drawn);
    expect(redone.reference).toBe(before.reference);
    expect(
      parseProject(serializeProject("redo", [], { sketch: redone })).authoring
        ?.sketch,
    ).toEqual(redone);
    expect(session.redo(redone)).toBeUndefined();
  });
  it("retains only the last accepted operation and invalidates redo after new authoring", () => {
    const session = new SketchUndo(),
      before = empty();
    const line = drawSketchLine(before, [0, 0], [10, 0], 0.1, false);
    session.record(before, line);
    const circle = drawSketchCircle(line, [20, 0], [25, 0]);
    session.record(line, circle);
    const restored = session.undo(circle)!;
    expect(restored).toEqual(line);
    expect(session.undo(restored)).toBeUndefined();
    const arc = drawThreePointCurve(
      restored,
      [
        [5, 0],
        [0, 5],
        [-5, 0],
      ],
      "arc3",
    );
    session.record(restored, arc);
    expect(session.canRedo).toBe(false);
    expect(session.redo(arc)).toBeUndefined();
    expect(session.undo(arc)).toEqual(line);
  });
  it("owns editable snapshot arrays and rejects invalid changes without losing a prior undo", () => {
    const session = new SketchUndo(),
      before = empty(),
      drawn = drawSketchCircle(before, [0, 0], [10, 0]);
    session.record(before, drawn);
    const invalid = {
      ...drawn,
      points: [{ id: "invalid", x: Infinity, y: 0 }],
    };
    expect(() => session.record(drawn, invalid)).toThrow();
    const restored = session.undo(drawn)!;
    drawn.points[0].x = 400;
    drawn.arcs![0].clockwise = true;
    drawn.frame!.origin[0] = 500;
    const redone = session.redo(restored)!;
    expect(redone.points[0].x).toBe(0);
    expect(redone.arcs![0].clockwise).toBe(false);
    expect(redone.frame!.origin[0]).toBe(0);
  });
  it("keeps different sketches isolated and leaves undo available on identical-object updates", () => {
    const first = new SketchUndo(),
      second = new SketchUndo(),
      before = empty(),
      next = drawSketchCircle(before, [0, 0], [10, 0]);
    first.record(before, next);
    first.record(next, next);
    expect(first.canUndo).toBe(true);
    expect(second.canUndo).toBe(false);
    expect(second.undo(before)).toBeUndefined();
    expect(first.undo(next)?.points).toEqual([]);
  });
});
