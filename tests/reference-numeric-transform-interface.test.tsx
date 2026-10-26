import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import {
  coordinateAlignmentInterface,
  createWorkflowOperations,
  type InterfacePatch,
} from "../src/automation/workflow-operations";
import {
  getRibbonToolMetadata,
  ribbonToolAvailability,
  type RibbonState,
} from "../src/ui/ribbon-model";
import { RibbonToolButton } from "../src/ui/RibbonToolButton";
import { createReferenceFrameEntity } from "../src/reference-frame";
import type { Entity } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => apis.splice(0).forEach((api) => api.dispose()));

function numeric(kind: "point" | "line"): Entity {
  return {
    id: "numeric",
    name: "Numeric reference",
    kind: kind === "point" ? "referencePoint" : "referenceLine",
    positions: [],
    color: "#123456",
    opacity: 1,
    visible: true,
    constructionOrderKey: "01".repeat(16),
    reference:
      kind === "point"
        ? {
            version: 1,
            definition: {
              version: 1,
              kind,
              mode: "coordinates",
              position: [1, 2, 3],
              sources: [],
            },
            geometry: { kind, position: [1, 2, 3] },
            evaluation: { completionWord: 0x100 },
          }
        : {
            version: 1,
            definition: {
              version: 1,
              kind,
              mode: "endpoints",
              start: [1, 2, 3],
              end: [9, 2, 3],
              sources: [],
              records: [],
            },
            geometry: {
              kind,
              start: [1, 2, 3],
              direction: [2, 0, 0],
              length: 4,
            },
            evaluation: { completionWord: 0x100 },
          },
  };
}

function gated(
  family:
    "derived-point" | "derived-line" | "inactive-records" | "locked" | "frame",
): Entity {
  if (family === "frame")
    return createReferenceFrameEntity(
      { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
      10,
      "frame",
      "Frame",
    );
  const entity = numeric(
    family === "derived-point" || family === "locked" ? "point" : "line",
  );
  if (family === "locked") {
    entity.locked = true;
    return entity;
  }
  const data = entity.reference!;
  const source = { id: "source", constructionOrderKey: "02".repeat(16) };
  if (family === "derived-point")
    data.definition = {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [source],
    };
  else if (family === "derived-line")
    data.definition = {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [source],
      records: [
        {
          entityId: source.id,
          storage: "native-pick-record-f32",
          coordinates: [1, -0, 3],
        },
      ],
    };
  else if (data.definition.kind === "line")
    data.definition = {
      ...data.definition,
      records: [
        {
          entityId: source.id,
          storage: "native-pick-record-f32",
          coordinates: [1, -0, 3],
        },
      ],
    };
  return entity;
}

function ribbon(
  entity: Entity,
  eligibility?: { eligible: boolean; reason?: string },
): RibbonState {
  // The result must come from the actual selected Entity in App; a kind alone
  // cannot authorize derived or inactive-record references.
  return {
    disabled: false,
    hasSelection: true,
    canUndo: true,
    canRedo: true,
    selectionKind: entity.kind,
    ...(eligibility === undefined
      ? {}
      : { referenceTransformEligibility: eligibility }),
  };
}

function setup(entity: Entity) {
  const state: WorkspaceSnapshot = {
    name: "Reference transform interface",
    entities: [entity],
    selectedId: entity.id,
    history: [{ entities: [entity], label: "Before" }],
    future: [{ entities: [entity], label: "After" }],
    authoring: {},
    settings: {},
    selection: null,
  };
  const ui: InterfacePatch = {
    workspace: "properties",
    toolPanelOpen: false,
    mode: "inspect",
  };
  const setInterface = vi.fn((patch: InterfacePatch) =>
    Object.assign(ui, patch),
  );
  const host: WorkspaceHost = {
    snapshot: () => state,
    busy: () => false,
    activity: vi.fn(),
    setInterface,
    inspectApplication: () => ui,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    cad: () => {
      throw Error("Interface entry must not allocate geometry");
    },
  };
  const api = new ApplicationApi(host, createWorkflowOperations(host));
  apis.push(api);
  const invoke = (patch: InterfacePatch) =>
    api.invoke("ui_set", {
      ...patch,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { api, state, ui, setInterface, host, invoke };
}

it.each([
  ["point", "transform"],
  ["point", "scaleBody"],
  ["line", "transform"],
  ["line", "scaleBody"],
] as const)(
  "enables and renders %s numeric reference %s from explicit shared eligibility",
  (kind, command) => {
    const tool = getRibbonToolMetadata(command)!;
    const state = ribbon(numeric(kind), { eligible: true });
    const actions = { transform: vi.fn() };
    expect(ribbonToolAvailability(tool, state, actions).available).toBe(true);
    const html = renderToStaticMarkup(
      <RibbonToolButton tool={tool} state={state} actions={actions} />,
    );
    const button = html.match(
      new RegExp(`<button[^>]*data-command="${command}"[^>]*>`),
    )?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
  },
);

it.each(["point", "line"] as const)(
  "does not infer numeric %s transform eligibility from the semantic kind",
  (kind) => {
    for (const command of ["transform", "scaleBody"]) {
      expect(
        ribbonToolAvailability(
          getRibbonToolMetadata(command)!,
          ribbon(numeric(kind)),
          { transform: vi.fn() },
        ).available,
      ).toBe(false);
    }
  },
);

it("does not promote the broader CAD workflow or unknown commands from a numeric eligibility flag", () => {
  const tool = getRibbonToolMetadata("transform")!;
  for (const selectionKind of [
    "cad",
    "mesh",
    "pointcloud",
    "referenceFrame",
  ] as const) {
    const state: RibbonState = {
      ...ribbon(numeric("point"), { eligible: true }),
      selectionKind,
    };
    expect(
      ribbonToolAvailability(tool, state, { transform: vi.fn() }).available,
    ).toBe(false);
  }
  const unknown = { ...tool, id: "unverifiedReferenceTransform" };
  expect(
    ribbonToolAvailability(
      unknown,
      ribbon(numeric("point"), { eligible: true }),
      { transform: vi.fn() },
    ).available,
  ).toBe(false);
});

it.each([
  "derived-point",
  "derived-line",
  "inactive-records",
  "locked",
  "frame",
] as const)(
  "keeps %s transform UI and MCP entry gated without changing interface/history",
  async (family) => {
    const entity = gated(family),
      h = setup(entity);
    const history = h.state.history,
      future = h.state.future,
      entities = h.state.entities;
    const before = { ...h.ui },
      revision = h.api.currentRevision();
    expect(() =>
      coordinateAlignmentInterface(
        { workspace: "transform", toolPanelOpen: true },
        entity,
      ),
    ).toThrow();
    const result = await h.invoke({
      workspace: "transform",
      toolPanelOpen: true,
    });
    expect(result.ok, JSON.stringify(result)).toBe(false);
    expect(h.setInterface).not.toHaveBeenCalled();
    expect(h.ui).toEqual(before);
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toBe(history);
    expect(h.state.future).toBe(future);
    expect(h.api.currentRevision()).toBe(revision);
    for (const command of ["transform", "scaleBody"]) {
      const reason =
        "Numeric references only; retained source or pick policy is unavailable";
      const availability = ribbonToolAvailability(
        getRibbonToolMetadata(command)!,
        ribbon(entity, { eligible: false, reason }),
        { transform: vi.fn() },
      );
      expect(availability).toEqual({ available: false, reason });
    }
  },
);

it.each(["point", "line"] as const)(
  "opens transform for a numeric %s through public ui_set with one retry-protected interface write",
  async (kind) => {
    const entity = numeric(kind),
      h = setup(entity);
    const history = h.state.history,
      future = h.state.future,
      entities = h.state.entities;
    const request = {
      workspace: "transform",
      toolPanelOpen: true,
      expectedRevision: h.api.currentRevision(),
      requestId: `open-${kind}`,
    };
    const first = await h.api.invoke("ui_set", request);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(await h.api.invoke("ui_set", request)).toEqual(first);
    expect(h.setInterface).toHaveBeenCalledOnce();
    expect(h.setInterface).toHaveBeenCalledWith(
      coordinateAlignmentInterface(
        { workspace: "transform", toolPanelOpen: true },
        entity,
      ),
    );
    expect(h.ui).toMatchObject({ workspace: "transform", toolPanelOpen: true });
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toBe(history);
    expect(h.state.future).toBe(future);
    expect(h.host.commit).not.toHaveBeenCalled();
  },
);

it("retains revision and request conflict checks before opening a numeric transform panel", async () => {
  const h = setup(numeric("point"));
  const first = {
    workspace: "transform",
    expectedRevision: h.api.currentRevision(),
    requestId: "transform-panel-once",
  };
  expect(await h.api.invoke("ui_set", first)).toMatchObject({ ok: true });
  expect(
    await h.api.invoke("ui_set", { ...first, workspace: "properties" }),
  ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  expect(
    await h.api.invoke("ui_set", {
      ...first,
      requestId: "stale-transform-panel",
      expectedRevision: 1 + h.api.currentRevision(),
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.setInterface).toHaveBeenCalledOnce();
});

it.each(["point", "line"] as const)(
  "does not use numeric %s transform eligibility to admit other sampled commands or brush/section modes",
  async (kind) => {
    const entity = numeric(kind),
      h = setup(entity),
      state = ribbon(entity, { eligible: true });
    for (const command of [
      "scaleMesh",
      "editScan",
      "reducePolygons",
      "flipNormals",
      "align",
    ]) {
      const tool = getRibbonToolMetadata(command)!;
      expect(
        ribbonToolAvailability(tool, state, { [tool.action!]: vi.fn() })
          .available,
        command,
      ).toBe(false);
    }
    for (const patch of [
      { workspace: "mesh" },
      { workspace: "section" },
      { workspace: "fit" },
      { workspace: "transform", mode: "brush" },
      { workspace: "transform", mode: "section" },
    ] as InterfacePatch[]) {
      expect(() => coordinateAlignmentInterface(patch, entity)).toThrow();
      expect((await h.invoke(patch)).ok).toBe(false);
    }
    expect(h.setInterface).not.toHaveBeenCalled();
  },
);

it("retains disabled/no-selection/absent-action ribbon guards for an otherwise eligible numeric reference", () => {
  const tool = getRibbonToolMetadata("transform")!,
    state = ribbon(numeric("point"), { eligible: true });
  expect(
    ribbonToolAvailability(
      tool,
      { ...state, disabled: true },
      { transform: vi.fn() },
    ).available,
  ).toBe(false);
  expect(
    ribbonToolAvailability(
      tool,
      { ...state, hasSelection: false },
      { transform: vi.fn() },
    ).available,
  ).toBe(false);
  expect(ribbonToolAvailability(tool, state, {}).available).toBe(false);
});

it("leaves reference appearance and properties available when its transform remains gated", async () => {
  const entity = gated("derived-point"),
    h = setup(entity);
  expect(
    (await h.invoke({ workspace: "properties", toolPanelOpen: true })).ok,
  ).toBe(true);
  const color = getRibbonToolMetadata("objectColor")!;
  expect(
    ribbonToolAvailability(
      color,
      ribbon(entity, {
        eligible: false,
        reason: "Derived transform policy unavailable",
      }),
      { objectColor: vi.fn() },
    ).available,
  ).toBe(true);
});
