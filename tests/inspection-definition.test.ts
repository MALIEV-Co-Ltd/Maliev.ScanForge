import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import { expect, it } from "vitest";
import { validateInspectionDefinitions } from "../src/inspection-definition";
import { validateProject, serializeProject } from "../src/io";
const saved = {
  id: "inspection-1",
  name: "Open plane inspection",
  definition: {
    kind: "deviation",
    entityId: "scan",
    fit: {
      kind: "plane",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      rms: 0,
      maxError: 0,
    },
    tolerance: 0.2,
  },
};
it("preserves bounded inspection definitions through project validation and JSON persistence", () => {
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    name: "Inspection",
    units: "mm",
    entities: [],
    authoring: { inspections: [saved] },
  });
  expect(project.authoring?.inspections).toEqual([saved]);
  expect(
    validateProject(
      JSON.parse(
        serializeProject(project.name, project.entities, project.authoring),
      ),
    ).authoring?.inspections,
  ).toEqual([saved]);
});
it("rejects corrupt definitions, duplicates and excessive saved records", () => {
  expect(() =>
    validateInspectionDefinitions([
      { ...saved, definition: { ...saved.definition, tolerance: 0 } },
    ]),
  ).toThrow();
  expect(() => validateInspectionDefinitions([saved, saved])).toThrow();
  expect(() =>
    validateInspectionDefinitions(
      Array.from({ length: 33 }, (_, i) => ({ ...saved, id: String(i) })),
    ),
  ).toThrow();
  expect(() =>
    validateInspectionDefinitions([
      {
        ...saved,
        definition: {
          kind: "deviation",
          entityId: "scan",
          referenceId: "target",
          maxDistance: Infinity,
        },
      },
    ]),
  ).toThrow();
  expect(() =>
    validateInspectionDefinitions([
      {
        ...saved,
        definition: {
          kind: "measurement",
          kindOfMeasurement: "radius",
          first: [0, 0, 0],
          second: [1, 0, 0],
          third: [2, 0, 0],
        },
      },
    ]),
  ).toThrow();
});

it("retains inspection parameters through binary project save/reopen", async () => {
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    name: "Inspection",
    units: "mm",
    entities: [],
    authoring: { inspections: [saved] },
  });
  const file = await encodeProjectFile({ project, history: [], future: [] });
  const reopened = await decodeProjectFile(file);
  expect(reopened.project.authoring?.inspections).toEqual([saved]);
});

it("normalizes saved definitions without retaining arbitrary caller payloads", () => {
  const record = structuredClone(saved) as any;
  record.definition.fit.unrelated = { large: [1, 2, 3] };
  expect(
    (validateInspectionDefinitions([record])[0].definition as any).fit
      .unrelated,
  ).toBeUndefined();
});
