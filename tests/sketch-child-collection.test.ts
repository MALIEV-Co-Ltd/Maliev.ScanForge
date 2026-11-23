import { expect, it } from "vitest";
import { SketchChildCollection } from "../src/cad/sketch-child-collection";
import { SKETCH_SOURCE_LIMITS } from "../src/sketch-source-records";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
class Child {
  disposed = false;
  records: number[][] | undefined = [[1, 2, 3]];
  constructor(
    readonly kind: "line" | "arc" | "circle" | "ellipse" | "spline" = "line",
  ) {}
  snapshot() {
    return {
      kind: this.kind,
      disposed: this.disposed,
      preparation: {
        frame: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        sourceRecords: this.records,
      },
      diagnostic: "retained",
    };
  }
  dispose() {
    this.disposed = true;
  }
}
const owner = () => new SketchChildCollection<Child>("owner", frame);
it("feeds current ordered sources into shared construction pick resolution", () => {
  const c = new SketchChildCollection<Child>("owner", [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
  ]);
  const a = new Child(),
    b = new Child();
  a.records = [[1 - 2 ** -26, 0, 0]];
  b.records = [[1 + 2 ** -26, 0, 0]];
  c.splice(0, 0, [
    { id: "a", child: a },
    { id: "b", child: b },
  ]);
  const selection = { sourceId: "owner", childId: "b", recordIndex: 0 };
  expect(
    resolveSketchConstructionPick(c.snapshot().sources, selection).primitive,
  ).toEqual({
    kind: "point",
    position: [1 - 2 ** -26, 0, 0],
    objectResolved: true,
  });
  c.reorder(["b", "a"]);
  expect(
    resolveSketchConstructionPick(c.snapshot().sources, selection).primitive,
  ).toEqual({
    kind: "point",
    position: [1 + 2 ** -26, 0, 0],
    objectResolved: true,
  });
  c.dispose();
});
it("derives ordered records from current child state while retaining separate placements", () => {
  const c = owner(),
    a = new Child("arc"),
    b = new Child("circle");
  c.splice(0, 0, [
    { id: "a", child: a },
    { id: "b", child: b },
  ]);
  const before = c.snapshot();
  a.records = [[4, 5, 6]];
  expect(c.snapshot().sources.children[0].records).toEqual([[4, 5, 6]]);
  expect(before.sources.children[0].records).toEqual([[1, 2, 3]]);
  expect(before.sources.frame).toEqual(frame);
  expect(before.children[0].state.preparation.frame[0][3]).toBe(0);
  expect(before.children[0].state.diagnostic).toBe("retained");
  c.dispose();
});
it("preserves missing versus empty records and all five child kinds", () => {
  const c = owner();
  const kinds = ["line", "arc", "circle", "ellipse", "spline"] as const;
  c.splice(
    0,
    0,
    kinds.map((kind, i) => {
      const child = new Child(kind);
      child.records = i === 0 ? undefined : [];
      return { id: kind, child };
    }),
  );
  expect(c.snapshot().sources.children.map((x) => x.kind)).toEqual(kinds);
  expect(c.snapshot().sources.children[0].records).toBeUndefined();
  expect(c.snapshot().sources.children[1].records).toEqual([]);
  c.dispose();
});
it("returns replaced children alive for caller history/disposal ownership", () => {
  const c = owner(),
    a = new Child(),
    b = new Child();
  c.splice(0, 0, [{ id: "a", child: a }]);
  expect(c.splice(0, 1, [{ id: "b", child: b }])).toEqual([
    { id: "a", child: a },
  ]);
  expect(a.disposed).toBe(false);
  const other = owner();
  other.splice(0, 0, [{ id: "a", child: a }]);
  c.dispose();
  expect(a.disposed).toBe(false);
  other.dispose();
});
it("rejects duplicate identities and cross-owner sharing without taking candidates", () => {
  const c = owner(),
    other = owner(),
    a = new Child(),
    b = new Child();
  c.splice(0, 0, [{ id: "a", child: a }]);
  expect(() => other.splice(0, 0, [{ id: "x", child: a }])).toThrow();
  expect(() => c.splice(1, 0, [{ id: "a", child: b }])).toThrow();
  expect(b.disposed).toBe(false);
  expect(c.snapshot().sources.children).toHaveLength(1);
  expect(() =>
    other.splice(0, 0, [
      { id: "x", child: b },
      { id: "y", child: b },
    ]),
  ).toThrow();
  c.dispose();
  other.dispose();
  b.dispose();
});
it("checks exact reorder permutations without changing records", () => {
  const c = owner();
  c.splice(0, 0, [
    { id: "a", child: new Child() },
    { id: "b", child: new Child() },
  ]);
  c.reorder(["b", "a"]);
  expect(c.snapshot().sources.children.map((x) => x.id)).toEqual(["b", "a"]);
  for (const ids of [["a"], ["a", "a"], ["a", "c"]])
    expect(() => c.reorder(ids)).toThrow();
  expect(c.snapshot().sources.children.map((x) => x.id)).toEqual(["b", "a"]);
  c.dispose();
});
it("validates range, child state and aggregate source budget before publication", () => {
  const c = owner(),
    a = new Child();
  c.splice(0, 0, [{ id: "a", child: a }]);
  const b = new Child();
  b.records = Array.from({ length: SKETCH_SOURCE_LIMITS.records }, () => [
    0, 0, 0,
  ]);
  expect(() => c.splice(1, 0, [{ id: "b", child: b }])).toThrow(/budget/);
  expect(() => c.splice(-1, 0, [])).toThrow();
  expect(() => c.splice(0, 2, [])).toThrow();
  const dead = new Child();
  dead.dispose();
  expect(() => c.splice(1, 0, [{ id: "dead", child: dead }])).toThrow(
    /disposed/,
  );
  const invalid = new Child();
  invalid.records = [[NaN, 0, 0]];
  expect(() => c.splice(1, 0, [{ id: "bad", child: invalid }])).toThrow();
  expect(c.snapshot().sources.children).toHaveLength(1);
  expect(b.disposed).toBe(false);
  c.dispose();
  b.dispose();
  invalid.dispose();
});
it("forks independently and cleans only fresh copies on partial failure", () => {
  const c = owner();
  c.splice(0, 0, [
    { id: "a", child: new Child() },
    { id: "b", child: new Child() },
  ]);
  const allocated: Child[] = [];
  expect(() =>
    c.fork((child, id) => {
      if (id === "b") throw new Error("copy failure");
      const copy = new Child(child.kind);
      allocated.push(copy);
      return copy;
    }),
  ).toThrow(/copy failure/);
  expect(allocated[0].disposed).toBe(true);
  expect(c.snapshot().children.every((x) => !x.state.disposed)).toBe(true);
  const copy = c.fork((child) => new Child(child.kind));
  expect(copy.snapshot()).toEqual(c.snapshot());
  copy.dispose();
  expect(c.snapshot().children.every((x) => !x.state.disposed)).toBe(true);
  expect(() => c.fork((child) => child)).toThrow(/owned/);
  c.dispose();
});
it("retires every owned child even when one disposal throws", () => {
  const c = owner(),
    a = new Child(),
    b = new Child();
  a.dispose = () => {
    a.disposed = true;
    throw new Error("cleanup failure");
  };
  c.splice(0, 0, [
    { id: "a", child: a },
    { id: "b", child: b },
  ]);
  expect(() => c.dispose()).toThrow();
  expect(a.disposed && b.disposed).toBe(true);
  expect(() => c.snapshot()).toThrow(/disposed/);
  c.dispose();
});

it("previews independently and accepts once, returning the previous children alive", () => {
  const c = owner(),
    a = new Child(),
    b = new Child();
  c.splice(0, 0, [{ id: "a", child: a }]);
  const revision = c.revision;
  const input = [{ id: "b", child: b }];
  const stage = c.stageSplice(0, 1, input);
  input[0].id = "changed externally";
  expect(stage.snapshot().sources.children[0].id).toBe("b");
  expect(c.snapshot().sources.children[0].id).toBe("a");
  expect(c.revision).toBe(revision);
  const other = owner();
  expect(() => other.splice(0, 0, [{ id: "b", child: b }])).toThrow(/owned/);
  expect(stage.accept()).toEqual([{ id: "a", child: a }]);
  expect(c.revision).toBe(revision + 1);
  expect(a.disposed).toBe(false);
  expect(c.snapshot().sources.children[0].id).toBe("b");
  stage.discard();
  expect(b.disposed).toBe(false);
  expect(() => stage.accept()).toThrow(/closed/);
  expect(() => stage.snapshot()).toThrow(/closed/);
  other.splice(0, 0, [{ id: "a", child: a }]);
  c.dispose();
  other.dispose();
});

it("bounds pending edits to one and preserves caller ownership on failed admission", () => {
  const c = owner(),
    a = new Child(),
    b = new Child();
  const stage = c.stageSplice(0, 0, [{ id: "a", child: a }]);
  expect(() => c.stageSplice(0, 0, [{ id: "b", child: b }])).toThrow(/pending/);
  expect(b.disposed).toBe(false);
  stage.discard();
  stage.discard();
  expect(a.disposed).toBe(true);
  expect(c.snapshot().sources.children).toEqual([]);
  const accepted = c.stageSplice(0, 0, [{ id: "b", child: b }]);
  accepted.accept();
  c.dispose();
});

it("rejects stale previews after reorder or replacement and cleans only candidates", () => {
  for (const change of ["reorder", "splice"]) {
    for (const access of ["snapshot", "accept"] as const) {
      const c = owner(),
        a = new Child(),
        b = new Child(),
        candidate = new Child();
      c.splice(0, 0, [
        { id: "a", child: a },
        { id: "b", child: b },
      ]);
      const stage = c.stageSplice(0, 1, [{ id: "new", child: candidate }]);
      if (change === "reorder") c.reorder(["b", "a"]);
      else c.splice(2, 0, [{ id: "c", child: new Child() }]);
      expect(() => stage[access]()).toThrow(/stale/);
      expect(candidate.disposed).toBe(true);
      expect(a.disposed || b.disposed).toBe(false);
      const retry = c.stageSplice(0, 0, []);
      retry.discard();
      c.dispose();
    }
  }
});

it("checks cancellation before admission and at preview/accept boundaries", () => {
  const c = owner(),
    original = new Child(),
    unadmitted = new Child();
  c.splice(0, 0, [{ id: "a", child: original }]);
  const pre = new AbortController();
  pre.abort();
  expect(() =>
    c.stageSplice(0, 1, [{ id: "b", child: unadmitted }], pre.signal),
  ).toThrow(/abort/i);
  expect(unadmitted.disposed).toBe(false);
  for (const access of ["snapshot", "accept"] as const) {
    const abort = new AbortController(),
      candidate = new Child();
    const stage = c.stageSplice(
      0,
      1,
      [{ id: "b", child: candidate }],
      abort.signal,
    );
    abort.abort();
    expect(candidate.disposed).toBe(false); // No reentrant kernel disposal listener.
    expect(() => stage[access]()).toThrow(/abort/i);
    expect(candidate.disposed).toBe(true);
    expect(original.disposed).toBe(false);
  }
  expect(c.snapshot().sources.children[0].id).toBe("a");
  unadmitted.dispose();
  c.dispose();
});

it("applies range, identity, alias and aggregate source admission to staged replacements", () => {
  const c = owner(),
    original = new Child(),
    candidate = new Child();
  c.splice(0, 0, [{ id: "a", child: original }]);
  expect(() => c.stageSplice(2, 0, [])).toThrow(/range/);
  expect(() => c.stageSplice(1, 0, [{ id: "a", child: candidate }])).toThrow();
  expect(() => c.stageSplice(0, 1, [{ id: "b", child: original }])).toThrow(
    /owned/,
  );
  expect(() =>
    c.stageSplice(0, 1, [
      { id: "b", child: candidate },
      { id: "c", child: candidate },
    ]),
  ).toThrow(/repeated/);
  candidate.records = Array.from(
    { length: SKETCH_SOURCE_LIMITS.records },
    () => [0, 0, 0],
  );
  expect(() => c.stageSplice(1, 0, [{ id: "b", child: candidate }])).toThrow(
    /budget/,
  );
  candidate.records = [[NaN, 0, 0]];
  expect(() => c.stageSplice(0, 1, [{ id: "b", child: candidate }])).toThrow();
  expect(candidate.disposed).toBe(false);
  candidate.records = [[0, 0, 0]];
  c.stageSplice(0, 1, [{ id: "b", child: candidate }]).discard();
  c.dispose();
});

it("revalidates staged children on acceptance and retires invalid candidates", () => {
  const c = owner(),
    a = new Child(),
    b = new Child();
  c.splice(0, 0, [{ id: "a", child: a }]);
  const stage = c.stageSplice(0, 1, [{ id: "b", child: b }]);
  b.records = [[NaN, 0, 0]]; // Simulate a caller violating exclusive ownership.
  expect(() => stage.accept()).toThrow();
  expect(b.disposed).toBe(true);
  expect(a.disposed).toBe(false);
  expect(c.snapshot().sources.children[0].id).toBe("a");
  c.dispose();
});

it("disposes all pending and committed children even when cleanup throws", () => {
  const c = owner(),
    a = new Child(),
    b = new Child(),
    candidate = new Child(),
    second = new Child();
  c.splice(0, 0, [
    { id: "a", child: a },
    { id: "b", child: b },
  ]);
  const stage = c.stageSplice(0, 2, [
    { id: "c", child: candidate },
    { id: "d", child: second },
  ]);
  for (const child of [a, candidate])
    child.dispose = () => {
      child.disposed = true;
      throw new Error("controlled cleanup failure");
    };
  expect(() => c.dispose()).toThrow(AggregateError);
  expect([a, b, candidate, second].every((x) => x.disposed)).toBe(true);
  stage.discard();
  c.dispose();
  expect(() => stage.accept()).toThrow(/closed/);
  expect(() => c.revision).toThrow(/disposed/);
});

it("copies the committed revision without copying pending changes", () => {
  const c = owner();
  c.splice(0, 0, [{ id: "a", child: new Child() }]);
  c.reorder(["a"]);
  const stage = c.stageSplice(0, 1, [{ id: "b", child: new Child() }]);
  const copy = c.fork((child) => new Child(child.kind));
  expect(copy.revision).toBe(c.revision);
  expect(copy.snapshot()).toEqual(c.snapshot());
  copy.reorder(["a"]);
  expect(copy.revision).toBe(c.revision + 1);
  stage.accept().forEach((x) => x.child.dispose());
  expect(copy.snapshot().sources.children[0].id).toBe("a");
  c.dispose();
  copy.dispose();
});
