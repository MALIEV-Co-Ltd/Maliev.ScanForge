export interface SelectionState {
  mask: Uint8Array;
  hidden: number[];
}
const clone = (state: SelectionState): SelectionState => ({
  mask: new Uint8Array(state.mask),
  hidden: [...state.hidden],
});
function equal(a: SelectionState, b: SelectionState): boolean {
  return (
    a.mask.length === b.mask.length &&
    a.mask.every((v, i) => v === b.mask[i]) &&
    a.hidden.length === b.hidden.length &&
    a.hidden.every((v, i) => v === b.hidden[i])
  );
}
/** Selection/display undo is independent of model history. One brush gesture is one step. */
export class SelectionSession {
  private past: SelectionState[] = [];
  private future: SelectionState[] = [];
  private gesture: SelectionState | null = null;
  state: SelectionState;
  constructor(triangles: number, hidden: number[] = []) {
    this.state = { mask: new Uint8Array(triangles), hidden: [...hidden] };
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
  begin() {
    this.gesture ??= clone(this.state);
  }
  end() {
    if (this.gesture) {
      this.record(this.gesture);
      this.gesture = null;
    }
  }
  private record(previous: SelectionState) {
    if (equal(previous, this.state)) return;
    this.past = [...this.past.slice(-19), clone(previous)];
    this.future = [];
  }
  set(next: SelectionState) {
    if (
      next.mask.length !== this.state.mask.length ||
      next.mask.some((v) => v !== 0 && v !== 1) ||
      next.hidden.some(
        (v, i) =>
          !Number.isInteger(v) ||
          v < 0 ||
          v >= next.mask.length ||
          (i > 0 && v <= next.hidden[i - 1]),
      )
    )
      throw new Error("Invalid selection state.");
    const previous = this.state;
    this.state = clone(next);
    if (!this.gesture) this.record(previous);
  }
  undo() {
    this.end();
    const previous = this.past.pop();
    if (previous) {
      this.future.unshift(clone(this.state));
      this.state = previous;
    }
    return clone(this.state);
  }
  redo() {
    this.end();
    const next = this.future.shift();
    if (next) {
      this.past.push(clone(this.state));
      this.state = next;
    }
    return clone(this.state);
  }
}
export function maskIndices(mask: Uint8Array): number[] {
  const result: number[] = [];
  mask.forEach((v, i) => {
    if (v) result.push(i);
  });
  return result;
}
export function indicesMask(triangles: number, indices: number[]): Uint8Array {
  const mask = new Uint8Array(triangles);
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= triangles)
      throw new Error("Selection index out of range.");
    mask[i] = 1;
  }
  return mask;
}
export function hideRegion(
  state: SelectionState,
  isolate = false,
): SelectionState {
  const hidden = new Set(isolate ? [] : state.hidden);
  state.mask.forEach((v, i) => {
    if (isolate ? !v : !!v) hidden.add(i);
  });
  return {
    mask: isolate
      ? new Uint8Array(state.mask)
      : new Uint8Array(state.mask.length),
    hidden: [...hidden].sort((a, b) => a - b),
  };
}
