import { expect, it } from "vitest";
import { serializeProject, parseProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import {
  prepareModelSketchPublication,
  applyModelSketchChanges,
} from "../src/model-sketch-history";
import { validateSavedSketchDisplay } from "../src/saved-sketch-display";
import native from "../docs/evidence/native-boundary-3d-sketch-20261027.json";
import type { SavedSketch } from "../src/types";

const curve = native.originalSelectedControl.curve;
const spatial = {
  id: "spatial-1",
  name: "Boundary sketch",
  kind: "spatial",
  visible: true,
  curves: [
    {
      degree: 3,
      poles: curve.controlPoints.flat(),
      knots: curve.knots,
      periodic: true,
      maxError: 0,
      meanError: 0,
      toleranceMet: true,
    },
  ],
} as unknown as SavedSketch;

it("preserves spatial curves through versioned JSON, binary and owned history", async () => {
  validateSavedSketchDisplay(spatial);
  const publication = prepareModelSketchPublication({ sketches: [] }, [
    spatial,
  ]);
  const text = serializeProject("Spatial", [], publication.authoring);
  expect(JSON.parse(text).version).toBe(5);
  expect(parseProject(text).authoring?.sketches).toEqual([spatial]);
  const project = parseProject(text);
  const file = await encodeProjectFileLocally({
    project,
    history: [
      { label: "Spatial", entities: [], sketchChanges: publication.changes },
    ],
    future: [],
  });
  const header = await file.slice(0, 16).arrayBuffer();
  const manifestLength = new DataView(header).getUint32(8, true);
  const originalManifest = await file.slice(16, 16 + manifestLength).text();
  const manifest = JSON.parse(originalManifest);
  expect(manifest.version).toBe(7);
  const downgraded = originalManifest.replace(
    /("version"\s*:\s*)7/,
    (_, prefix: string) => `${prefix}6`,
  );
  expect(new TextEncoder().encode(downgraded).length).toBe(manifestLength);
  await expect(
    decodeProjectContents(
      new Blob([header, downgraded, file.slice(16 + manifestLength)]),
    ),
  ).rejects.toThrow();
  const restored = await decodeProjectContents(file);
  expect(restored.project.authoring?.sketches).toEqual([spatial]);
  expect(restored.history[0].sketchChanges).toEqual(publication.changes);
  expect(
    applyModelSketchChanges(restored.project.authoring!, publication.changes)
      .sketches,
  ).toEqual([]);
});

it("rejects invalid spatial curves and older JSON versions", () => {
  expect(() =>
    validateSavedSketchDisplay({
      ...spatial,
      curves: [{ ...spatial.curves![0], poles: [NaN] }],
    } as SavedSketch),
  ).toThrow();
  const text = serializeProject("Spatial", [], { sketches: [spatial] });
  const data = JSON.parse(text);
  data.version = 4;
  expect(() => parseProject(JSON.stringify(data))).toThrow(/version/i);
  data.version = 5;
  data.authoring.activeSketchId = spatial.id;
  expect(() => parseProject(JSON.stringify(data))).toThrow(/active/i);
});

it("rejects excessive display basis work before sampling", () => {
  const expensive = {
    degree: 3,
    poles: Array.from({ length: 96 }, (_, i) => i / 100),
    knots: [
      ...Array(4).fill(0),
      ...Array.from({ length: 28 }, (_, i) => (i + 1) / 29),
      ...Array(4).fill(1),
    ],
    periodic: false,
    maxError: 0,
    meanError: 0,
    toleranceMet: true,
  };
  expect(() =>
    validateSavedSketchDisplay({
      ...spatial,
      kind: "spatial",
      curves: Array(100).fill(expensive),
    } as SavedSketch),
  ).toThrow(/work limit/i);
});

it("admits 32 poles and rejects 33 before sampling", () => {
  const make = (count: number) => ({
    degree: 3,
    poles: Array.from({ length: count * 3 }, (_, i) => i / 100),
    knots: [
      ...Array(4).fill(0),
      ...Array.from({ length: count - 4 }, (_, i) => (i + 1) / (count - 3)),
      ...Array(4).fill(1),
    ],
    periodic: false,
    maxError: 0,
    meanError: 0,
    toleranceMet: true,
  });
  expect(() =>
    validateSavedSketchDisplay({
      ...spatial,
      kind: "spatial",
      curves: [make(32)],
    } as SavedSketch),
  ).not.toThrow();
  expect(() =>
    validateSavedSketchDisplay({
      ...spatial,
      kind: "spatial",
      curves: [make(33)],
    } as SavedSketch),
  ).toThrow(/invalid/i);
});

it("uses the spatial binary version when only redo history retains the sketch", async () => {
  const project = parseProject(serializeProject("Spatial", []));
  const file = await encodeProjectFileLocally({
    project,
    history: [],
    future: [
      {
        label: "Spatial",
        entities: [],
        sketchChanges: [{ id: spatial.id, index: 0, value: spatial }],
      },
    ],
  });
  const header = await file.slice(0, 16).arrayBuffer();
  const length = new DataView(header).getUint32(8, true);
  const manifest = JSON.parse(await file.slice(16, 16 + length).text());
  expect(manifest.version).toBe(7);
  const restored = await decodeProjectContents(file);
  expect(restored.future[0].sketchChanges![0].value).toEqual(spatial);
});
