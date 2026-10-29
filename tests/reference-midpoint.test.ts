import { expect, it } from "vitest";
import {
  referenceMidpointDefinition,
  createReferencePointSeed,
  evaluateReferenceMidpoint,
  refreshReferenceMidpoints,
  referenceDeletionDependents,
} from "../src/reference-midpoint";
import { assertReferenceWorkspaceAdmission } from "../src/reference-entity";
import type { Entity } from "../src/types";
const line = (): Entity => ({
  id: "line",
  name: "Line",
  kind: "referenceLine",
  positions: [],
  color: "#ffffff",
  opacity: 1,
  visible: true,
  constructionOrderKey: "01".repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [2, 0, 0],
      end: [10, 0, 0],
      sources: [],
      records: [],
    },
    geometry: {
      kind: "line",
      start: [2, -0, 0],
      direction: [2, -0, 0],
      length: 4,
    },
    evaluation: { completionWord: 0x100 },
  },
});
function point(source = line()): Entity {
  return {
    ...source,
    id: "midpoint",
    name: "Midpoint",
    kind: "referencePoint",
    constructionOrderKey: "02".repeat(16),
    reference: {
      version: 1,
      definition: referenceMidpointDefinition([source], source.id),
      geometry: { kind: "point", position: [6, -0, 0] },
      evaluation: { completionWord: 0x100 },
    },
  };
}
it("keeps the recovered finite constructor seed private and detached", () => {
  const seed = createReferencePointSeed();
  expect(seed).toEqual({
    geometry: { kind: "point", position: [3.4028234663852886e38, 0, 0] },
    state: { completionWord: 0x100 },
  });
  expect(createReferencePointSeed().geometry).not.toBe(seed.geometry);
});
it("uses stored line endpoint reconstruction and midpoint arithmetic, with dirty-to-final state", () => {
  const entity = line();
  const definition = referenceMidpointDefinition([entity], "line");
  const result = evaluateReferenceMidpoint([entity], definition, {
    geometry: { kind: "point", position: [99, 99, 99] },
    state: { completionWord: 1 },
  });
  expect(result).toMatchObject({
    geometry: { kind: "point", position: [6, -0, 0] },
    state: { completionWord: 0x100 },
    outcome: "updated",
    diagnostics: { reason: "center" },
  });
  expect(entity.reference!.evaluation.completionWord).toBe(0x100);
});
it("rejects missing, duplicate, malformed and unsupported source identities without assigning keys", () => {
  const entity = line();
  for (const entities of [
    [],
    [entity, entity],
    [{ ...entity, constructionOrderKey: undefined }],
    [{ ...entity, kind: "referencePoint" as const }],
  ])
    expect(() => referenceMidpointDefinition(entities, "line")).toThrow();
  expect(entity.constructionOrderKey).toBe("01".repeat(16));
});
it("refreshes independently of scene order without mutating source arrays or a prior midpoint", () => {
  const root = line(),
    child = point(root),
    next = structuredClone(root);
  next.reference!.geometry = {
    kind: "line",
    start: [4, 0, 0],
    direction: [1, 0, 0],
    length: 16,
  };
  const staged = [child, next];
  const result = refreshReferenceMidpoints(staged, "line");
  expect(result.refreshedEntityIds).toEqual(["midpoint"]);
  expect(result.entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [12, 0, 0],
  });
  expect(child.reference!.geometry).toEqual({
    kind: "point",
    position: [6, -0, 0],
  });
  expect(result.entities[1]).toBe(next);
});
it("rejects locked dependents, cancellation and mismatched source keys atomically", () => {
  const root = line(),
    child = point(root);
  expect(() =>
    refreshReferenceMidpoints([root, { ...child, locked: true }], "line"),
  ).toThrow(/locked/i);
  expect(() =>
    refreshReferenceMidpoints([root, child], "line", () => {
      throw Error("cancelled");
    }),
  ).toThrow("cancelled");
  root.constructionOrderKey = "03".repeat(16);
  expect(() => refreshReferenceMidpoints([root, child], "line")).toThrow(
    /identity|binding/i,
  );
  expect(child.reference!.geometry).toEqual({
    kind: "point",
    position: [6, -0, 0],
  });
});
it("rejects midpoint arithmetic overflow instead of publishing a constructor or origin fallback", () => {
  const root = line();
  root.reference!.geometry = {
    kind: "line",
    start: [Number.MAX_VALUE, 0, 0],
    direction: [0, 0, 0],
    length: 1,
  };
  expect(() =>
    evaluateReferenceMidpoint(
      [root],
      referenceMidpointDefinition([root], "line"),
      createReferencePointSeed(),
    ),
  ).toThrow();
});
it("validates stored links in every imported state without imposing derived-mode arity", () => {
  const root = line(),
    child = point(root);
  const session = {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      name: "Midpoint",
      units: "mm" as const,
      entities: [root, child],
    },
    history: [],
    future: [],
  };
  expect(() => assertReferenceWorkspaceAdmission(session)).not.toThrow();
  expect(() =>
    assertReferenceWorkspaceAdmission({
      ...session,
      history: [{ entities: [child], label: "broken" }],
    }),
  ).toThrow();
  const invalid = structuredClone(child);
  invalid.reference!.definition = {
    ...invalid.reference!.definition,
    sources: [],
  };
  expect(() =>
    assertReferenceWorkspaceAdmission({
      ...session,
      future: [{ entities: [root, invalid], label: "retained fallback" }],
    }),
  ).not.toThrow();
  expect(referenceDeletionDependents([root, child], [root.id])).toEqual([
    child.id,
  ]);
  expect(
    referenceDeletionDependents([root, child], [root.id, child.id]),
  ).toEqual([]);
});
it("rejects affected cycles and exceeded refresh work before returning staged geometry", () => {
  const root = line(),
    child = point(root);
  root.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "pair",
    records: [],
    sources: [
      { id: child.id, constructionOrderKey: child.constructionOrderKey! },
    ],
  };
  expect(() => refreshReferenceMidpoints([root, child], root.id)).toThrow(
    /cycle/i,
  );
  const source = line();
  const children = Array.from({ length: 600 }, (_, index) => ({
    ...point(source),
    id: `child-${index}`,
    constructionOrderKey: (index + 2).toString(16).padStart(32, "0"),
  }));
  expect(() =>
    refreshReferenceMidpoints([source, ...children], source.id),
  ).toThrow(/work limit/i);
  expect(children[0].reference!.geometry).toEqual({
    kind: "point",
    position: [6, -0, 0],
  });
});
it("reopens a valid midpoint after unrelated objects grow its scene beyond the operation limit", () => {
  const root = line(),
    child = point(root);
  const unrelated: Entity[] = Array.from({ length: 10001 }, (_, index) => ({
    id: `mesh-${index}`,
    name: "Unrelated",
    kind: "mesh",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
  }));
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    name: "Larger scene",
    units: "mm" as const,
    entities: [root, child, ...unrelated],
  };
  expect(() =>
    assertReferenceWorkspaceAdmission({
      project,
      history: [{ entities: project.entities, label: "Saved" }],
      future: [],
    }),
  ).not.toThrow();
});
