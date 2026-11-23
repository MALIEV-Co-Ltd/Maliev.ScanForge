import { expect, it, vi } from "vitest";
import type { Entity } from "../src/types";
import {
  datumEntityDependencies,
  nativeDatumDependentCandidates,
} from "../src/datum-dependencies";
import { publishedLandmarkRoots } from "../src/native-landmark-roots";
import { createDatumOperations } from "../src/automation/datum-operations";
import { ApplicationApi, type WorkspaceHost } from "../src/automation/api";

const scan: Entity = {
  id: "scan",
  name: "same",
  kind: "mesh",
  positions: [0, 0, 0],
  color: "#fff",
  opacity: 1,
  visible: true,
};
function point(id: string, sourceId: string): Entity {
  return {
    ...scan,
    id,
    kind: "referencePoint",
    positions: [],
    constructionOrderKey: (id === "first" ? "02" : "03").repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "center",
        sources: [{ id: sourceId, constructionOrderKey: "01".repeat(16) }],
      },
      geometry: { kind: "point", position: [0, 0, 0] },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function line(): Entity {
  return {
    ...scan,
    id: "line",
    kind: "referenceLine",
    positions: [],
    constructionOrderKey: "04".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "average",
        sources: [{ id: "scan", constructionOrderKey: "01".repeat(16) }],
        records: [0, 1].map(() => ({
          entityId: "pick-only",
          storage: "native-pick-record-f32" as const,
          coordinates: [0, 0, 0] as const,
        })),
      },
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 1,
      },
      evaluation: { completionWord: 0x100 },
    },
  };
}
it("discovers transitive semantic dependencies in scene order without mutation", () => {
  const entities = [point("last", "first"), scan, point("first", "scan")];
  const before = JSON.stringify(entities);
  const graph = datumEntityDependencies(entities);
  expect(graph.map((x) => x.references)).toEqual([["first"], [], ["scan"]]);
  expect(nativeDatumDependentCandidates(graph, ["scan"])).toEqual([
    "last",
    "first",
  ]);
  expect(JSON.stringify(entities)).toBe(before);
});
it("uses common identities rather than duplicate or extra pick records", () => {
  const entity = line();
  const graph = datumEntityDependencies([
    scan,
    { ...scan, id: "pick-only" },
    entity,
  ]);
  expect(graph[2].references).toEqual(["scan"]);
  expect(nativeDatumDependentCandidates(graph, ["pick-only"])).toEqual([]);
  expect(nativeDatumDependentCandidates(graph, ["scan"])).toEqual(["line"]);
});
it("keeps retained common links independent of active construction mode", () => {
  const entity = point("first", "scan");
  entity.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "coordinates",
    position: [1, 2, 3],
    sources: entity.reference!.definition.sources,
  };
  expect(datumEntityDependencies([entity])[0].references).toEqual(["scan"]);
  const empty = line();
  empty.reference!.definition = { ...empty.reference!.definition, sources: [] };
  expect(datumEntityDependencies([empty])[0].references).toEqual([]);
});
it("rejects malformed semantic metadata before collecting its links", () => {
  const entity = point("first", "scan");
  entity.positions = [0, 0, 0];
  expect(() => datumEntityDependencies([entity])).toThrow(
    /empty display positions/,
  );
});
it("feeds reference cycles into existing landmark DAG validation", () => {
  expect(() =>
    publishedLandmarkRoots([point("first", "last"), point("last", "first")]),
  ).toThrow(/contain a cycle/);
});
it("exposes dependent reference links and blocked movement through the shared MCP handler", async () => {
  const commit = vi.fn();
  const entities = [scan, point("first", "scan"), point("last", "first")];
  const host = {
    snapshot: () => ({
      name: "test",
      entities,
      history: [],
      future: [],
      authoring: {},
      settings: {},
      selectedId: "scan",
      selection: null,
    }),
    commit,
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createDatumOperations(host));
  const revision = api.currentRevision();
  try {
    const response = await api.invoke("alignment_targets", {
      entityIds: ["scan"],
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.result).toMatchObject({
      entityIds: ["scan", "first", "last"],
      dependentIds: ["first", "last"],
      references: [
        { entityId: "scan", references: [] },
        { entityId: "first", references: ["scan"] },
        { entityId: "last", references: ["first"] },
      ],
      blocked: [
        { entityId: "first", reason: "Target has no valid XYZ geometry." },
        { entityId: "last", reason: "Target has no valid XYZ geometry." },
      ],
    });
    expect(commit).not.toHaveBeenCalled();
    expect(api.currentRevision()).toBe(revision);
  } finally {
    api.dispose();
  }
});
