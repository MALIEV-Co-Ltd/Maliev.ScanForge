import { expect, it } from "vitest";
import {
  bridgePreviewResponse,
  validateBridgePreview,
} from "../src/automation/bridge-preview";
import type { CommandContext } from "../src/automation/api";
import { runScanEdit } from "../src/scan-edit";

const operation = {
  kind: "scanEdit",
  action: "fillHoles",
  mode: "bridge",
  indices: [0],
  start: 0,
  end: 2,
};

it("accepts only explicit, single-boundary bridge previews", () => {
  expect(validateBridgePreview({ operation })).toBe(false);
  expect(validateBridgePreview({ previewOnly: false, operation })).toBe(false);
  expect(validateBridgePreview({ previewOnly: true, operation })).toBe(true);
  for (const change of [
    { kind: "repair" },
    { action: "inventory" },
    { mode: "entire" },
    { indices: [] },
    { indices: [0, 1] },
    { indices: [-1] },
    { start: undefined },
    { end: undefined },
    { start: 0.5 },
    { end: 0 },
  ])
    expect(() =>
      validateBridgePreview({
        previewOnly: true,
        operation: { ...operation, ...change },
      }),
    ).toThrow(/preview/i);
  for (const field of ["createNew", "selectionOnly", "targetId", "targetIds"])
    expect(() =>
      validateBridgePreview({ previewOnly: true, operation, [field]: true }),
    ).toThrow(/preview/i);
});

const vertices = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];
const source = new Float32Array(
  faces.flatMap((face) => face.flatMap((id) => vertices[id])),
);

it("returns the shared geometry result as a patch artifact without editing source or history", () => {
  const before = source.slice();
  const edit = runScanEdit({
    ...operation,
    kind: "scanEdit",
    action: "fillHoles",
    mode: "bridge",
    algorithm: "flat",
    positions: source,
  });
  let payload = "";
  const context: CommandContext = {
    signal: new AbortController().signal,
    progress() {},
    check() {},
    mutate() {
      throw new Error("Preview must not mutate history");
    },
    artifact(data, name, mime) {
      expect(typeof data).toBe("string");
      payload = data as string;
      return { artifactId: "preview", bytes: payload.length, name, mime };
    },
    artifactBlob() {
      throw new Error("No input artifact required");
    },
  };
  const preview = bridgePreviewResponse(
    source,
    { kind: "scanEdit", scanEdit: edit, diagnostics: {} },
    context,
  );
  const patch = JSON.parse(payload);
  expect(preview.preview).toBe(true);
  expect(preview.sourceTriangleCount).toBe(source.length / 9);
  expect(preview.diagnostics).toEqual(edit.diagnostics);
  expect(preview.artifact.mime).toBe("application/json");
  expect(patch.positions).toEqual(
    Array.from(edit.positions!.slice(source.length)),
  );
  expect(patch.positions.length / 9).toBe(edit.diagnostics.addedTriangles);
  expect(patch.diagnostics.method).toBe("flat");
  expect(source).toEqual(before);
  expect(() =>
    bridgePreviewResponse(
      source,
      {
        kind: "scanEdit",
        scanEdit: { diagnostics: { filledHoles: 0 } },
        diagnostics: {},
      },
      context,
    ),
  ).toThrow(/preview/i);
  const changed = edit.positions!.slice();
  changed[0] += 1;
  expect(() =>
    bridgePreviewResponse(
      source,
      {
        kind: "scanEdit",
        scanEdit: { ...edit, positions: changed },
        diagnostics: {},
      },
      context,
    ),
  ).toThrow(/source/i);
});
