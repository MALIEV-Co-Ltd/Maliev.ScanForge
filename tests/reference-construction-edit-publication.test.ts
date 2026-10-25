import { afterEach, expect, it, vi } from "vitest";
import { ReferenceConstructionSession } from "../src/reference-construction-session";
const definition = {
  version: 1 as const,
  kind: "point" as const,
  mode: "coordinates" as const,
  position: [1, 2, 3] as const,
  sources: [],
};
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const token = {};
  const session = new ReferenceConstructionSession(
    token,
    {
      geometry: { kind: "point", position: [0, 0, 0] },
      state: { completionWord: 0 },
    },
    { definition, writeNumericInputs: true, evaluationAllowed: true },
  );
  const edit = {
    definition: { ...definition, position: [4, 5, 6] as const },
    writeNumericInputs: true,
    evaluationAllowed: true,
  };
  return { session, token, edit };
}
afterEach(() => vi.useRealTimers());
it("keeps version, cache and deadline when preview publication fails", () => {
  const { session, token, edit } = setup();
  vi.setSystemTime(20000);
  expect(() =>
    session.edit(1, token, edit, () => {
      throw Error("display rejected");
    }),
  ).toThrow("display rejected");
  expect(session.inspect(token)).toMatchObject({
    active: true,
    version: 1,
    expiresAt: 61000,
    preview: { geometry: { position: [1, 2, 3] } },
  });
});
it("publishes a detached candidate before accepting its new cache", () => {
  const { session, token, edit } = setup();
  const publish = vi.fn((candidate) => {
    expect(candidate.preview.geometry).toMatchObject({ position: [4, 5, 6] });
    Reflect.set(candidate.preview.geometry.position, 0, 999);
  });
  session.edit(1, token, edit, publish);
  expect(publish).toHaveBeenCalledOnce();
  expect(session.inspect(token)).toMatchObject({
    version: 2,
    preview: { geometry: { position: [4, 5, 6] } },
  });
});
it("blocks reentrant cancellation or edits during preview publication", () => {
  const { session, token, edit } = setup();
  const publish = vi.fn(() => {
    expect(() => session.close("cancelled")).toThrow(/publication/);
    expect(() => session.edit(1, token, edit)).toThrow(/publication/);
  });
  session.edit(1, token, edit, publish);
  expect(publish).toHaveBeenCalledOnce();
});
it("validates the candidate before invoking a display publisher", () => {
  const { session, token, edit } = setup();
  const publish = vi.fn();
  expect(() =>
    session.edit(
      1,
      token,
      { ...edit, definition: { ...definition, position: [NaN, 0, 0] } },
      publish,
    ),
  ).toThrow();
  expect(publish).not.toHaveBeenCalled();
});
