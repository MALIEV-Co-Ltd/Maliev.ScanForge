import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SketchPlaneDialog } from "../src/ui/SketchPlaneDialog";
import {
  coordinateSketchFrame,
  validateSketchFrame,
} from "../src/sketch-frame";
import { ORIGIN_PLANES } from "../src/origin";
import type { Entity } from "../src/types";
import type { SketchPlaneSelection } from "../src/sketch-plane-source";

it("lists stored plane frames without fit metadata, legacy planes and the custom route", () => {
  const plane: Entity = {
    id: "OXY",
    name: "Stored plane",
    kind: "plane",
    positions: [],
    color: "#fff",
    opacity: 1,
    visible: true,
    planeFrame: { center: [0, 0, 0], normal: [0, 0, 1], tangent: [0, 1, 0] },
  };
  const legacy: Entity = {
    ...plane,
    id: "legacy",
    name: "Legacy plane",
    planeFrame: undefined,
    fit: {
      kind: "plane",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      rms: 0,
      maxError: 0,
    },
  };
  const html = renderToStaticMarkup(
    <SketchPlaneDialog
      initialPlane="OXY"
      entities={[
        plane,
        legacy,
        { ...plane, id: "mesh", name: "Not a plane", kind: "mesh" },
      ]}
      onCreate={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(html).toContain('aria-labelledby="sketch-plane-title"');
  expect(html).toContain('value="source:OXY"');
  expect(html).toContain("Stored plane");
  expect(html).toContain("Legacy plane");
  expect(html).toContain("Custom plane");
  expect(html).not.toContain("Not a plane");
});

function actualAppCreate(command: ReturnType<typeof vi.fn>) {
  const source = ts.createSourceFile(
    "App.tsx",
    readFileSync(new URL("../src/ui/App.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callbacks: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createPlaneSketch"
    )
      callbacks.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(callbacks).toHaveLength(1);
  const emitted = ts.transpileModule(callbacks[0].getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  expect(
    emitted.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ),
  ).toEqual([]);
  const effects = vi.fn();
  const dependencies = {
    uiCommand: command,
    savedSketches: [],
    validateSketchFrame,
    coordinateSketchFrame,
    ORIGIN_PLANES,
    setOriginPlane: effects,
    setSelectedId: effects,
    setSketchDrawingTool: effects,
    setSketchPlaneDialog: effects,
    setPlanePicking: effects,
    setMode: effects,
    showTools: effects,
    viewport: { current: { viewReferencePlane: effects } },
    setMessage: effects,
  };
  const create = new Function(
    ...Object.keys(dependencies),
    `${emitted.outputText}\nreturn createPlaneSketch;`,
  )(...Object.values(dependencies)) as (
    selection: SketchPlaneSelection,
  ) => Promise<void>;
  return { create, effects };
}
it("actual GUI creation submits the source contract through sketch_manage", async () => {
  const frame = coordinateSketchFrame("OYZ", 4);
  const command = vi.fn(async () => ({
    ok: true,
    result: { sketchId: "created", frame },
  }));
  const h = actualAppCreate(command);
  await h.create({ planeSourceId: "plane", normalOffset: 4 });
  expect(command).toHaveBeenCalledExactlyOnceWith("sketch_manage", {
    action: "create",
    name: "Sketch 1",
    planeSourceId: "plane",
    normalOffset: 4,
  });
  expect(h.effects).toHaveBeenCalledWith(frame);
});
it("actual origin/custom GUI creation validates and submits an empty explicit sketch", async () => {
  const frame = coordinateSketchFrame("OXZ", -2);
  const command = vi.fn(async () => ({
    ok: true,
    result: { sketchId: "created", frame },
  }));
  const h = actualAppCreate(command);
  await h.create({ frame });
  expect(command).toHaveBeenCalledWith("sketch_manage", {
    action: "create",
    name: "Sketch 1",
    sketch: { version: 1, points: [], segments: [], constraints: [], frame },
  });
  await expect(h.create({ frame: { ...frame, u: [2, 0, 0] } })).rejects.toThrow(
    /orthonormal/,
  );
  expect(command).toHaveBeenCalledOnce();
});
it("actual GUI creation leaves editing state untouched on a rejected shared request", async () => {
  const command = vi.fn(async () => ({
    ok: false,
    error: { message: "Stale plane" },
  }));
  const h = actualAppCreate(command);
  await expect(
    h.create({ planeSourceId: "plane", normalOffset: 0 }),
  ).rejects.toThrow("Stale plane");
  expect(h.effects).not.toHaveBeenCalled();
});
