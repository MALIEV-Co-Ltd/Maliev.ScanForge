import { yieldScanTask } from "./scan-task";

/** Weak candidates only; callers publish validated arrays after successful save. */
export class ProjectNumericReuse {
  private candidates: WeakRef<number[]>[] = [];

  constructor(
    private readonly limit = 128,
    private readonly chunk = 65536,
  ) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(chunk) ||
      chunk < 1
    )
      throw new Error("Invalid numeric reuse limits.");
  }

  clear(): void {
    this.candidates = [];
  }

  remember(arrays: readonly number[][]): void {
    if (typeof WeakRef === "undefined") return;
    const live = this.candidates.flatMap((ref) => {
      const value = ref.deref();
      return value ? [value] : [];
    });
    for (const value of arrays) {
      if (!Array.isArray(value)) continue;
      const at = live.indexOf(value);
      if (at >= 0) live.splice(at, 1);
      live.push(value);
      if (live.length > this.limit) live.shift();
    }
    this.candidates = live.map((value) => new WeakRef(value));
  }

  async match(
    bytes: Float64Array,
    check: () => void,
    yieldTask: () => Promise<void> = yieldScanTask,
    excluded: ReadonlySet<number[]> = new Set(),
  ): Promise<number[] | undefined> {
    check();
    let compared = 0;
    const budget = bytes.length * 4;
    const same = (left: number, right: number) =>
      Number.isFinite(left) &&
      left === right &&
      (left !== 0 || 1 / left === 1 / right);
    for (const weak of this.candidates) {
      const candidate = weak.deref();
      if (
        !candidate ||
        excluded.has(candidate) ||
        candidate.length !== bytes.length
      )
        continue;
      let equal = true;
      for (let first = 0; first < bytes.length && equal; first += this.chunk) {
        check();
        const end = Math.min(bytes.length, first + this.chunk);
        for (let i = first; i < end; i++) {
          if (++compared > budget) return undefined;
          if (!same(candidate[i], bytes[i])) {
            equal = false;
            break;
          }
        }
        if (equal && end < bytes.length) await yieldTask();
      }
      if (!equal || candidate.length !== bytes.length) continue;
      // Nothing can mutate a normal array concurrently during this final pass.
      // Rechecking catches a mutation of an earlier chunk while we yielded.
      for (let i = 0; i < bytes.length; i++) {
        if (i % this.chunk === 0) check();
        if (++compared > budget || !same(candidate[i], bytes[i])) {
          equal = false;
          break;
        }
      }
      check();
      if (equal && candidate.length === bytes.length) return candidate;
    }
    return undefined;
  }
}

export const projectNumericReuse = new ProjectNumericReuse();
globalThis.addEventListener?.("pagehide", () => projectNumericReuse.clear());
