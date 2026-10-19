import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { Entity } from "../src/types";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateSketchDialog } from "../src/ui/CreateSketchDialog";
import { SketchTools } from "../src/ui/SketchTools";
import { coordinateSketchFrame } from "../src/sketch-frame";
it("keeps Cancel available while extracting and gates creation on a current preview", () => {
  const html = renderToStaticMarkup(
    <CreateSketchDialog
      source={{
        id: "scan",
        name: "Scan",
        kind: "mesh",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        color: "#aaaaaa",
        visible: true,
        opacity: 1,
      }}
      busy
      onApply={() => {}}
      onCreate={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Create Sketch"');
  expect(html).toContain("Through selection only");
  expect(html).toContain('disabled="">Create');
  expect(html).toContain("<button>Cancel</button>");
});
it("renders large reference samples as one path without converting them to editable curves", () => {
  const segments: number[] = [];
  for (let i = 0; i < 65000; i++) segments.push(i, 0, i, 1);
  const html = renderToStaticMarkup(
    <SketchTools
      value={{
        version: 1,
        points: [],
        segments: [],
        constraints: [],
        frame: coordinateSketchFrame("OXY", 2),
        reference: {
          kind: "section",
          sourceId: "scan",
          axis: "z",
          offset: 2,
          onSlicingPlane: true,
          selectedOnly: false,
          sampled: false,
          segments,
        },
      }}
      onExtrude={() => {}}
    />,
  );
  expect(html.match(/aria-label="Scan section references"/g)).toHaveLength(1);
  expect(html).not.toContain("Remove segment");
});

it("actual App section command admits raw meshes and captures immutable original slots", () => {
  const source = ts.createSourceFile(
    "App.tsx",
    readFileSync(new URL("../src/ui/App.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const actions: ts.Expression[] = [];
  const openers: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "sketchFromSection"
    )
      actions.push(node.initializer);
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "openScanSketchCreation"
    )
      openers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(actions).toHaveLength(1);
  expect(openers).toHaveLength(1);
  const emit = (code: string) => {
    const out = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    });
    expect(
      out.diagnostics?.filter(
        (row) => row.category === ts.DiagnosticCategory.Error,
      ) ?? [],
    ).toEqual([]);
    return out.outputText;
  };
  const actionFactory = new Function(
    "selected",
    "openScanSketchCreation",
    emit(`const action=${actions[0].getText(source)};`) + "return action;",
  );
  const positions = Float32Array.from([
    0, 0, -1, 2, 0, 1, 0, 2, 1, 10, 0, -1, 12, 0, 1, 10, 2, 1,
  ]);
  const selected: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions,
    color: "#aaaaaa",
    visible: true,
    opacity: 1,
    meshSelection: { hidden: [0], saved: [] },
  };
  const open = vi.fn();
  expect(actionFactory(selected, open)).toBe(open);
  for (const invalid of [
    null,
    { ...selected, kind: "pointcloud" },
    { ...selected, kind: "cad" },
    { ...selected, surfacePatch: {} },
  ])
    expect(actionFactory(invalid, open)).toBeUndefined();
  const factory = new Function(
    "selected",
    "busy",
    "triangleMask",
    "showTools",
    "setError",
    "setMode",
    "setToolPanelOpen",
    "setCreateSketch",
    emit(openers[0].getText(source)) + "return openScanSketchCreation;",
  );
  const triangleMask = Uint8Array.from([0, 1]);
  const hidden = selected.meshSelection!.hidden;
  const captured = vi.fn();
  const mode = vi.fn();
  const panel = vi.fn();
  factory(
    selected,
    false,
    triangleMask,
    vi.fn(),
    vi.fn(),
    mode,
    panel,
    captured,
  )();
  expect(captured).toHaveBeenCalledOnce();
  const session = captured.mock.calls[0][0];
  expect(session.source).toBe(selected);
  expect(session.source.positions).toBe(positions);
  expect(session.hidden).toEqual([0]);
  expect(session.hidden).not.toBe(hidden);
  expect(session.selection).toEqual(triangleMask);
  expect(session.selection).not.toBe(triangleMask);
  expect(mode).toHaveBeenCalledWith("inspect");
  expect(panel).toHaveBeenCalledWith(true);
  captured.mockClear();
  factory(
    selected,
    true,
    triangleMask,
    vi.fn(),
    vi.fn(),
    mode,
    panel,
    captured,
  )();
  expect(captured).not.toHaveBeenCalled();
  const error = vi.fn();
  factory(null, false, triangleMask, vi.fn(), error, mode, panel, captured)();
  expect(error).toHaveBeenCalledOnce();
  expect(captured).not.toHaveBeenCalled();
});
