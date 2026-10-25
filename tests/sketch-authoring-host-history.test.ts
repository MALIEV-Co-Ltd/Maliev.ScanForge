import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { expect, it, vi } from "vitest";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import type {
  CommandContext,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "../src/automation/api";
import { rectangleSketch, type Sketch } from "../src/sketch";
import * as sketchUndo from "../src/sketch-undo";

// Execute the actual App callback without importing App's renderer or CAD runtime.
const appSource = ts.createSourceFile(
  "App.tsx",
  readFileSync(new URL("../src/ui/App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const callbacks: ts.ArrowFunction[] = [];
function visit(node: ts.Node): void {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(appSource) === "setAuthoring" &&
    ts.isArrowFunction(node.initializer)
  )
    callbacks.push(node.initializer);
  ts.forEachChild(node, visit);
}
visit(appSource);
if (callbacks.length !== 1)
  throw new Error(
    `Expected one actual App setAuthoring callback, got ${callbacks.length}`,
  );
const emitted = ts.transpileModule(
  `const setter = ${callbacks[0].getText(appSource)};`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  },
);
if (
  emitted.diagnostics?.some(
    (item) => item.category === ts.DiagnosticCategory.Error,
  )
)
  throw new Error("Actual App setAuthoring callback could not be parsed");
const setterFactory = new Function(
  "sketchUndoSessions",
  "setSavedSketches",
  "setSavedInspections",
  "setActiveSketchId",
  "legacySketch",
  "setSketchDraft",
  "setDirty",
  "rectangleSketch",
  "pruneSketchUndoSessions",
  `${emitted.outputText}\nreturn setter;`,
);

function setup(activeSketchId: string) {
  const before = rectangleSketch();
  const edited = structuredClone(before);
  edited.points[0].x += 2;
  const sessions = new Map<string, sketchUndo.SketchUndo>();
  for (const key of ["saved:a", "saved:b", "legacy"]) {
    const session = new sketchUndo.SketchUndo();
    session.record(before, edited);
    sessions.set(key, session);
  }
  const state: WorkspaceSnapshot = {
    name: "Sketch history ownership",
    entities: [],
    history: [],
    future: [],
    authoring: {
      sketch: edited,
      inspections: [
        {
          id: "inspection",
          name: "Retained",
          definition: {
            kind: "measurement",
            measurement: { first: [0, 0, 0], second: [1, 0, 0] },
          },
        },
      ],
      activeSketchId,
      sketches: ["a", "b"].map((id) => ({ id, name: id, sketch: edited })),
    },
    selectedId: null,
    selection: null,
    sketchDraft: edited,
    settings: {},
  };
  const legacy = { current: edited };
  const dirty = vi.fn();
  const setAuthoring = setterFactory(
    { current: sessions },
    (items: NonNullable<WorkspaceSnapshot["authoring"]["sketches"]>) => {
      state.authoring.sketches = items;
    },
    (items: WorkspaceSnapshot["authoring"]["inspections"]) => {
      state.authoring.inspections = items;
    },
    (id: string | null) => {
      state.authoring.activeSketchId = id ?? undefined;
    },
    legacy,
    (value: Sketch) => {
      state.sketchDraft = value;
    },
    dirty,
    rectangleSketch,
    // Baseline has no helper; its actual callback does not reference this value.
    Reflect.get(sketchUndo, "pruneSketchUndoSessions"),
  ) as NonNullable<WorkspaceHost["setAuthoring"]>;
  const host = { snapshot: () => state, setAuthoring } as WorkspaceHost;
  const operations = createAuthoringOperations(host);
  const context = {
    check: vi.fn(),
    signal: new AbortController().signal,
  } as unknown as CommandContext;
  return { state, sessions, before, edited, dirty, context, operations };
}

it("MCP deletion releases the active saved session through the actual App setter", () => {
  const h = setup("a");
  const survivor = h.sessions.get("saved:b");
  const legacy = h.sessions.get("legacy");
  h.operations.sketch_manage({ action: "delete", sketchId: "a" }, h.context);
  expect(h.state.authoring.sketches?.map((item) => item.id)).toEqual(["b"]);
  expect(h.state.authoring.activeSketchId).toBeUndefined();
  expect(h.state.authoring.inspections?.[0].name).toBe("Retained");
  expect(h.state.sketchDraft).toBe(h.edited);
  expect(h.sessions.has("saved:a")).toBe(false);
  expect(h.sessions.get("saved:b")).toBe(survivor);
  expect(h.sessions.get("legacy")).toBe(legacy);
  expect(survivor?.undo(h.edited)).toEqual(h.before);
  expect(legacy?.undo(h.edited)).toEqual(h.before);
  expect(h.context.check).toHaveBeenCalledOnce();
  expect(h.dirty).toHaveBeenCalledWith(true);
});

it("MCP deletion of an inactive sketch retains the active live history", () => {
  const h = setup("b");
  const active = h.sessions.get("saved:b");
  h.operations.sketch_manage({ action: "delete", sketchId: "a" }, h.context);
  expect(h.state.authoring.activeSketchId).toBe("b");
  expect(h.sessions.has("saved:a")).toBe(false);
  expect(h.sessions.get("saved:b")).toBe(active);
  expect(active?.undo(h.edited)).toEqual(h.before);
});

it("MCP activation and rename preserve every existing saved and legacy history", () => {
  const h = setup("a");
  const entries = [...h.sessions];
  expect(h.sessions.get("saved:a")?.undo(h.edited)).toEqual(h.before);
  h.operations.sketch_manage({ action: "activate", sketchId: "b" }, h.context);
  h.operations.sketch_manage(
    { action: "rename", sketchId: "a", name: "Renamed" },
    h.context,
  );
  expect([...h.sessions]).toEqual(entries);
  expect(h.state.authoring.activeSketchId).toBe("b");
  expect(h.sessions.get("saved:a")?.redo(h.before)).toEqual(h.edited);
  expect(h.sessions.get("saved:b")?.undo(h.edited)).toEqual(h.before);
  expect(h.sessions.get("legacy")?.canUndo).toBe(true);
});
