import { validateSketch, type Sketch } from "./sketch";

function snapshot(sketch: Sketch): Sketch {
  validateSketch(sketch);
  // Scan references are immutable authoring inputs; do not duplicate their large sample arrays.
  return {
    ...sketch,
    frame: sketch.frame ? structuredClone(sketch.frame) : undefined,
    points: sketch.points.map((point) => ({ ...point })),
    segments: sketch.segments.map((segment) => ({ ...segment })),
    arcs: sketch.arcs?.map((arc) => ({ ...arc })),
    constraints: sketch.constraints.map((constraint) => ({ ...constraint })),
  };
}

/** One authoring step, separate from CAD model history and viewport preferences. */
export class SketchUndo {
  private previous?: Sketch;
  private following?: Sketch;
  get canUndo(): boolean {
    return this.previous !== undefined;
  }
  get canRedo(): boolean {
    return this.following !== undefined;
  }
  record(current: Sketch, next: Sketch): void {
    if (current === next) return;
    validateSketch(next);
    const previous = snapshot(current);
    this.previous = previous;
    this.following = undefined;
  }
  undo(current: Sketch): Sketch | undefined {
    if (!this.previous) return;
    const following = snapshot(current),
      previous = snapshot(this.previous);
    this.following = following;
    this.previous = undefined;
    return previous;
  }
  redo(current: Sketch): Sketch | undefined {
    if (!this.following) return;
    const previous = snapshot(current),
      following = snapshot(this.following);
    this.previous = previous;
    this.following = undefined;
    return following;
  }
}
