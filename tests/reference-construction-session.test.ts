import { afterEach, expect, it, vi } from "vitest";
import { ReferenceConstructionSession } from "../src/reference-construction-session";
import type { ReferenceConstructionDefinition } from "../src/reference-construction";
const definition: ReferenceConstructionDefinition = {
  version: 1,
  kind: "point",
  mode: "coordinates",
  position: [1, -0, 3],
  sources: [],
};
const prior = {
  geometry: { kind: "point" as const, position: [9, 8, 7] as const },
  state: { completionWord: 0x324 },
};
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const token = {};
  const session = new ReferenceConstructionSession(token, prior, {
    definition,
    writeNumericInputs: true,
    evaluationAllowed: true,
  });
  return { session, token };
}
afterEach(() => vi.useRealTimers());
it("captures a detached evaluated preview and the finite lease", () => {
  const { session, token } = setup();
  const state = session.inspect(token);
  expect(state).toMatchObject({
    active: true,
    version: 1,
    expiresAt: 61000,
    preview: {
      geometry: { kind: "point", position: [1, -0, 3] },
      state: { completionWord: 256 },
    },
  });
  if (!state.active) throw Error("active");
  (state.preview.geometry as any).position[0] = 999;
  (state.definition as any).position[0] = 999;
  expect(session.inspect(token)).toMatchObject({
    preview: { geometry: { position: [1, -0, 3] } },
    definition: { position: [1, -0, 3] },
  });
  expect(prior.geometry.position).toEqual([9, 8, 7]);
});
it("keeps evaluation distinct from explicit numeric controller writes", () => {
  const { session, token } = setup();
  const next = { ...definition, position: [4, 5, 6] as const };
  session.edit(1, token, {
    definition: next,
    writeNumericInputs: false,
    evaluationAllowed: true,
  });
  expect(session.inspect(token)).toMatchObject({
    version: 2,
    definition: next,
    preview: { geometry: { position: [1, -0, 3] } },
  });
  session.edit(2, token, {
    definition: next,
    writeNumericInputs: true,
    evaluationAllowed: true,
  });
  expect(session.inspect(token)).toMatchObject({
    version: 3,
    preview: { geometry: { position: [4, 5, 6] } },
  });
});
it("renews the lease only for a successful edit", () => {
  const { session, token } = setup();
  vi.setSystemTime(20000);
  expect(() =>
    session.edit(1, token, {
      definition: { ...definition, position: [NaN, 0, 0] },
      writeNumericInputs: true,
      evaluationAllowed: true,
    }),
  ).toThrow();
  expect(session.inspect(token)).toMatchObject({
    version: 1,
    expiresAt: 61000,
  });
  session.edit(1, token, {
    definition,
    writeNumericInputs: false,
    evaluationAllowed: true,
  });
  expect(session.inspect(token)).toMatchObject({
    version: 2,
    expiresAt: 80000,
  });
});
it("rejects wrong versions without changing the cached preview", () => {
  const { session, token } = setup();
  expect(() =>
    session.edit(0, token, {
      definition,
      writeNumericInputs: true,
      evaluationAllowed: true,
    }),
  ).toThrow(/version/i);
  const publish = vi.fn();
  expect(() => session.apply(0, token, publish)).toThrow(/version/i);
  expect(publish).not.toHaveBeenCalled();
  expect(session.inspect(token)).toMatchObject({ active: true, version: 1 });
});
it("expires at the exact lease boundary and cannot apply", () => {
  const { session, token } = setup();
  vi.setSystemTime(60999);
  expect(session.inspect(token).active).toBe(true);
  vi.setSystemTime(61000);
  const publish = vi.fn();
  expect(() => session.apply(1, token, publish)).toThrow(/expired/i);
  expect(publish).not.toHaveBeenCalled();
  expect(session.inspect(token)).toMatchObject({
    active: false,
    reason: "expired",
  });
});
it("invalidates on a different host workspace token", () => {
  const { session, token } = setup();
  expect(session.inspect({})).toMatchObject({ active: false, reason: "stale" });
  expect(() => session.apply(1, token, vi.fn())).toThrow(/stale/i);
});
it("applies the exact cached result once without reevaluating mutable resolver input", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const token = {};
  const point = { id: "source", constructionOrderKey: "01".repeat(16) };
  const primitive = { kind: "point", position: [2, 4, 6] };
  const session = new ReferenceConstructionSession(token, prior, {
    definition: { version: 1, kind: "point", mode: "center", sources: [point] },
    resolvedInputs: { kind: "point", sources: [{ source: point, primitive }] },
    writeNumericInputs: false,
    evaluationAllowed: true,
  });
  primitive.position[0] = 200;
  const publish = vi.fn();
  const result = session.apply(1, token, publish);
  expect(result.preview.geometry).toEqual({
    kind: "point",
    position: [2, 4, 6],
  });
  expect(publish).toHaveBeenCalledOnce();
  expect(session.inspect(token)).toMatchObject({
    active: false,
    reason: "applied",
  });
  expect(() => session.apply(1, token, publish)).toThrow(/applied/i);
  expect(publish).toHaveBeenCalledOnce();
});
it("retains a retryable cached preview when synchronous publication fails", () => {
  const { session, token } = setup();
  expect(() =>
    session.apply(1, token, () => {
      throw Error("commit rejected");
    }),
  ).toThrow("commit rejected");
  expect(session.inspect(token)).toMatchObject({ active: true, version: 1 });
  expect(session.apply(1, token, vi.fn()).preview.geometry).toEqual({
    kind: "point",
    position: [1, -0, 3],
  });
});
it("blocks reentrant edits/cancellation during publication", () => {
  const { session, token } = setup();
  session.apply(1, token, () => {
    expect(() => session.close("cancelled")).toThrow(/publication/i);
    expect(() =>
      session.edit(1, token, {
        definition,
        writeNumericInputs: true,
        evaluationAllowed: true,
      }),
    ).toThrow(/publication/i);
  });
  expect(session.inspect(token)).toMatchObject({
    active: false,
    reason: "applied",
  });
});
it("cancels idempotently without exposing a cached payload", () => {
  const { session, token } = setup();
  session.close("cancelled");
  session.close("disposed");
  expect(session.inspect(token)).toMatchObject({
    active: false,
    reason: "cancelled",
  });
  expect(session.inspect(token)).not.toHaveProperty("preview");
});
it("keeps native average fallback semantics through session edits", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const token = {};
  const line: ReferenceConstructionDefinition = {
    version: 1,
    kind: "line",
    mode: "average",
    sources: [],
    records: [
      {
        entityId: "inactive",
        storage: "native-pick-record-f32",
        coordinates: [0, 0, 0],
      },
    ],
  };
  const session = new ReferenceConstructionSession(
    token,
    {
      geometry: {
        kind: "line",
        start: [1, 2, 3],
        direction: [2, 0, 0],
        length: 4,
      },
      state: { completionWord: 0x324 },
    },
    { definition: line, writeNumericInputs: false, evaluationAllowed: true },
  );
  expect(session.inspect(token)).toMatchObject({
    preview: {
      geometry: { direction: [1, 0, 0], length: 8 },
      state: { completionWord: 256 },
      diagnostics: { contributingRecords: 0 },
    },
  });
});
it("rejects kind changes and malformed control intent atomically", () => {
  const { session, token } = setup();
  expect(() =>
    session.edit(1, token, {
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start: [0, 0, 0],
        end: [1, 0, 0],
        sources: [],
        records: [],
      },
      writeNumericInputs: true,
      evaluationAllowed: true,
    }),
  ).toThrow();
  expect(() =>
    session.edit(1, token, {
      definition,
      writeNumericInputs: "yes" as never,
      evaluationAllowed: true,
    }),
  ).toThrow();
  expect(session.inspect(token)).toMatchObject({ active: true, version: 1 });
});

it("does not infer a missing evaluation guard", () => {
  const { session, token } = setup();
  expect(() =>
    session.edit(1, token, {
      definition,
      writeNumericInputs: true,
      evaluationAllowed: undefined as never,
    }),
  ).toThrow(/guard/);
  expect(session.inspect(token)).toMatchObject({ version: 1, active: true });
});
it("retains exact cache after a rejected publisher mutates its detached proposal", () => {
  const { session, token } = setup();
  expect(() =>
    session.apply(1, token, (candidate) => {
      (candidate.preview.geometry as any).position[0] = 999;
      (candidate.definition as any).position[0] = 888;
      throw Error("reject");
    }),
  ).toThrow("reject");
  expect(session.inspect(token)).toMatchObject({
    definition: { position: [1, -0, 3] },
    preview: { geometry: { position: [1, -0, 3] } },
  });
});
it("preserves disabled-evaluation completion state after an explicit numeric write", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const token = {};
  const session = new ReferenceConstructionSession(token, prior, {
    definition,
    writeNumericInputs: true,
    evaluationAllowed: false,
  });
  expect(session.inspect(token)).toMatchObject({
    preview: {
      geometry: { position: [1, -0, 3] },
      state: { completionWord: 0x324 },
      diagnostics: { reason: "evaluation-disabled" },
    },
  });
});
