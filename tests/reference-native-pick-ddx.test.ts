import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import {
  decodeReferenceGeometry,
  encodeReferenceGeometry,
  type EncodedReferenceGeometry,
} from "../src/reference-construction-values";
import nativePick from "./fixtures/reference-point-picked-cloud-native-r10.json";

it("preserves native R10 accepted QSF bits through read-only cloud pick and server-resolved Preview/Apply", async () => {
  const state: WorkspaceSnapshot = {
    name: "Native R10 accepted point",
    entities: [
      {
        id: "cloud",
        name: "R10 source vertex",
        kind: "pointcloud",
        positions: [...nativePick.source.sourceXYZ],
        visible: true,
        color: "#abcdef",
        opacity: 1,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const source = state.entities[0];
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("Native coordinate fixture requires no CAD");
    },
    commit,
    replace: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    showReferenceConstructionPreview: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const api = new ApplicationApi(host, createOperations(host));
  async function value(command: string, args: Record<string, unknown>) {
    const reply = await api.invoke(command, args);
    expect(reply.ok, JSON.stringify(reply)).toBe(true);
    if (!reply.ok) throw Error(reply.error.message);
    return reply.result as any;
  }
  const expected: EncodedReferenceGeometry = {
    version: 1,
    kind: "point",
    bits: nativePick.accepted.geometryEncoding.bits,
  };
  try {
    // The expected bytes come from forward native QSF readback, not the
    // quantizer, application encoder, decimal formatter or editor text.
    const decoded = decodeReferenceGeometry(expected);
    expect(decoded.kind).toBe("point");
    if (decoded.kind !== "point") throw Error("Expected native point");
    expect(Object.is(decoded.position[1], -0)).toBe(true);
    const revision = api.currentRevision();
    const picked = await value("reference_construction_pick", {
      entityId: "cloud",
      pointIndex: nativePick.source.pointIndex,
    });
    expect.soft(picked.positionEncoding).toEqual(expected);
    expect
      .soft(
        encodeReferenceGeometry({ kind: "point", position: picked.position }),
      )
      .toEqual(expected);
    expect(api.currentRevision()).toBe(revision);
    expect(commit).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);

    // JSON cannot carry numeric -0. Supply the source intent independently so
    // the server must perform its own acquisition, rather than copy pick bits.
    const preview = await value("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { entityId: "cloud", pointIndex: 0 },
      expectedRevision: revision,
      requestId: "native-r10-point-preview",
    });
    expect.soft(preview.geometryEncoding).toEqual(expected);
    expect
      .soft((await value("reference_construction_get", {})).geometryEncoding)
      .toEqual(expected);
    const applied = await value("reference_construct", {
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
      expectedRevision: api.currentRevision(),
      requestId: "native-r10-point-apply",
    });
    const inspected = await value("object_get", { entityId: applied.entityId });
    expect.soft(inspected.reference.geometryEncoding).toEqual(expected);
    const accepted = state.entities.find(
      (entity) => entity.id === applied.entityId,
    )!;
    expect
      .soft(encodeReferenceGeometry(accepted.reference!.geometry))
      .toEqual(expected);
    expect(accepted.reference!.definition).toMatchObject({
      kind: "point",
      mode: "coordinates",
      sources: [],
    });
    expect(state.entities[0]).toBe(source);
    expect(source.positions).toEqual(nativePick.source.sourceXYZ);
    expect(source.constructionOrderKey).toBeUndefined();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
  } finally {
    api.dispose();
  }
});
