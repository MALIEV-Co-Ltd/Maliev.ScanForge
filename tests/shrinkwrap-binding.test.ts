import { expect, it } from "vitest";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import type { Entity } from "../src/types";
import catalog from "../src/automation/catalog.json";
const source: Entity = {
  id: "source",
  name: "scan",
  kind: "mesh",
  positions: new Float32Array(27),
  visible: true,
  color: "#aaa",
  opacity: 1,
  meshSelection: { hidden: [1], saved: [] },
};
const settings = {
  kind: "shrinkwrap" as const,
  sampleInterval: 0.5,
  gapFill: 0,
  organicShape: false,
  extraThickness: 0,
  maxDeviation: 0.1,
  scope: "selected" as const,
};
it("resolves selected masks with hidden triangles excluded without mutating selection", () => {
  const selection = new Uint8Array([1, 1, 0]);
  const request = scanToolRequest(source, settings, [source], selection);
  expect(request.operation).toMatchObject({
    ...settings,
    selection: new Uint8Array([1, 0, 0]),
  });
  expect(selection).toEqual(new Uint8Array([1, 1, 0]));
});
it("isolated scope resolves only visible triangles and requires an actual hidden subset", () => {
  expect(
    scanToolRequest(source, { ...settings, scope: "isolated" }, [source])
      .operation,
  ).toMatchObject({ selection: new Uint8Array([1, 0, 1]) });
  expect(() =>
    scanToolRequest(
      { ...source, meshSelection: undefined },
      { ...settings, scope: "isolated" },
      [source],
    ),
  ).toThrow(/isolat|hidden/i);
});
it("rejects empty local scopes and local reconstruction references", () => {
  expect(() =>
    scanToolRequest(source, settings, [source], new Uint8Array([0, 1, 0])),
  ).toThrow(/empty|select/i);
  expect(() =>
    scanToolRequest(
      source,
      { ...settings, targetIds: ["other"] },
      [source],
      new Uint8Array([1, 0, 0]),
    ),
  ).toThrow(/whole/i);
});
it("discovers shrinkwrap controls and bounded preview lifecycle", () => {
  const process = catalog.find((t) => t.name === "mesh_process")!;
  expect(JSON.stringify(process)).toContain("shrinkwrap");
  const preview = catalog.find((t) => t.name === "scan_preview");
  expect(preview).toBeDefined();
  for (const field of [
    "sampleInterval",
    "gapFill",
    "organicShape",
    "extraThickness",
    "maxDeviation",
    "scope",
  ])
    expect(JSON.stringify(process)).toContain(field);
});
