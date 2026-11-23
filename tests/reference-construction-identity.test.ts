import { describe, expect, it } from "vitest";
import { resolveConstructionIdentities } from "../src/reference-construction-identity";

const row = (id: string, constructionOrderKey: string) => ({
  id,
  constructionOrderKey,
});

describe("provisional construction source identities", () => {
  it.each([
    ["legacy scan/1", "281b48d6041214025f19b4b8f88390dd"],
    ["e\u0301", "2f14a7f96612fac5d13c9c6123f0469b"],
    ["\u00e9", "52e035c090d32e5c1158fd9c1c001911"],
    ["\ud800", "710d10bf49814afd247db6faa1d2ac01"],
    ["\ufffd", "7f542132e983023fbf81e921b8508ab2"],
    ["", "9ae2a89e233d9feb7bd930456ba5f287"],
  ])(
    "derives the specified domain-separated UTF-16LE key for %j",
    (id, key) => {
      // Fixed vectors computed independently with Python hashlib and surrogatepass.
      expect(resolveConstructionIdentities([{ id }], [id])).toEqual({
        orderedSources: [row(id, key)],
        assignments: [row(id, key)],
      });
    },
  );

  it("sorts unsigned raw bytes, retains explicit keys, and deduplicates source IDs", () => {
    const scene = [
      row("z", "01" + "ff".repeat(15)),
      row("a", "02" + "00".repeat(15)),
      row("ignored", "03".repeat(16)),
    ];
    expect(resolveConstructionIdentities(scene, ["a", "z", "a"])).toEqual({
      orderedSources: [scene[0], scene[1]],
      assignments: [],
    });
  });

  it("does not reinterpret UUID-shaped IDs as native GUID bytes", () => {
    const id = "12345678-1234-5678-9abc-def012345678";
    const key = "ff".repeat(16);
    expect(
      resolveConstructionIdentities([row(id, key)], [id]).orderedSources,
    ).toEqual([row(id, key)]);
  });

  it("is deterministic across scene/pick ordering and cancelled previews without mutation", () => {
    const scene = Object.freeze([
      Object.freeze({ id: "é" }),
      Object.freeze({ id: "e\u0301" }),
      Object.freeze({ id: "unused" }),
    ]);
    const first = resolveConstructionIdentities(scene, ["é", "e\u0301"]);
    expect(
      resolveConstructionIdentities([...scene].reverse(), [
        "e\u0301",
        "é",
        "é",
      ]),
    ).toEqual(first);
    expect(scene).toEqual([{ id: "é" }, { id: "e\u0301" }, { id: "unused" }]);
    expect(first.assignments.map((value) => value.id)).not.toContain("unused");
    expect(
      resolveConstructionIdentities(first.assignments, ["é", "e\u0301"]),
    ).toEqual({ orderedSources: first.orderedSources, assignments: [] });
  });

  it("returns detached records, including assignments versus ordered sources", () => {
    const source = row("saved", "01".repeat(16));
    const result = resolveConstructionIdentities(
      [source, { id: "new" }],
      ["saved", "new"],
    );
    expect(
      result.orderedSources.find((value) => value.id === "saved"),
    ).not.toBe(source);
    expect(result.assignments[0]).not.toBe(
      result.orderedSources.find((value) => value.id === "new"),
    );
  });

  it("detects collisions involving an unselected explicit and provisional key", () => {
    const scene = [
      { id: "legacy scan/1" },
      row("other", "281b48d6041214025f19b4b8f88390dd"),
      { id: "selected" },
    ];
    expect(() => resolveConstructionIdentities(scene, ["selected"])).toThrow(
      /collision/i,
    );
  });

  it("detects duplicate saved keys even with no selected sources", () => {
    expect(() =>
      resolveConstructionIdentities(
        [row("a", "00".repeat(16)), row("b", "00".repeat(16))],
        [],
      ),
    ).toThrow(/collision/i);
  });

  it("rejects duplicate scene IDs before resolving sources", () => {
    expect(() =>
      resolveConstructionIdentities(
        [{ id: "a" }, row("a", "00".repeat(16))],
        ["a"],
      ),
    ).toThrow(/duplicate.*id/i);
  });

  it("rejects a missing source and handles prototype-looking IDs normally", () => {
    expect(() => resolveConstructionIdentities([], ["missing"])).toThrow(
      /missing.*source/i,
    );
    expect(
      resolveConstructionIdentities(
        [{ id: "__proto__" }, { id: "constructor" }],
        ["__proto__", "constructor"],
      ).orderedSources,
    ).toHaveLength(2);
  });

  it.each([
    "",
    "0".repeat(31),
    "0".repeat(33),
    "G".repeat(32),
    "AA".repeat(16),
  ])("rejects malformed or noncanonical saved keys %j", (key) => {
    expect(() =>
      resolveConstructionIdentities([row("unselected", key)], []),
    ).toThrow(/order key/i);
  });
});
