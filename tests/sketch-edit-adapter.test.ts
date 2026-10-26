import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { expect, it, vi } from "vitest";

// Execute the product's actual adapter without creating WebGL/CAD resources.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(new URL("../src/ui/App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const instances: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
function visit(node: ts.Node): void {
  if (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    node.tagName.getText(source) === "SketchTools"
  )
    instances.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
function attribute(name: string): ts.JsxAttribute | undefined {
  return instances[0]?.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(source) === name,
  );
}
function adapter(
  uiCommand: ReturnType<typeof vi.fn>,
): (intent: object) => Promise<unknown> {
  expect(instances).toHaveLength(1);
  const property = attribute("onEdit");
  expect(property, "SketchTools needs a semantic shared adapter").toBeDefined();
  if (
    !property?.initializer ||
    !ts.isJsxExpression(property.initializer) ||
    !property.initializer.expression
  )
    throw Error("Missing shared sketch edit adapter");
  let expression: ts.Expression | ts.FunctionDeclaration =
    property.initializer.expression;
  if (ts.isIdentifier(expression)) {
    const name = expression.text;
    const declaration = source.statements.flatMap((statement) => {
      const matches: ts.FunctionDeclaration[] = [];
      const find = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name)
          matches.push(node);
        ts.forEachChild(node, find);
      };
      find(statement);
      return matches;
    })[0];
    if (!declaration) throw Error("Shared sketch adapter declaration missing");
    expression = declaration;
  }
  const emitted = ts.transpileModule(
    `const adapter = ${expression.getText(source)};`,
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
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  )
    throw Error("Shared sketch adapter could not be parsed");
  return new Function("uiCommand", `${emitted.outputText}\nreturn adapter;`)(
    uiCommand,
  );
}

it.each([
  { kind: "preset", profile: "circle" },
  { kind: "pointSet", pointId: "p1", x: 0.125 },
  { kind: "constraintAdd", constraint: { kind: "fixed", point: "p1" } },
])(
  "the actual App adapter forwards semantic $kind without constructing a replacement graph",
  async (intent) => {
    const receipt = {
      changed: true,
      createdPointIds: [],
      createdCurveIds: [],
      createdConstraintIds: [],
    };
    const command = vi.fn(async () => ({ ok: true, result: receipt }));
    const invoke = adapter(command);
    expect(await invoke(intent)).toEqual(receipt);
    expect(command).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledWith("sketch_edit", intent);
    expect(command.mock.calls[0]).not.toContain("sketch_set");
  },
);

it("the product no longer passes raw graph publication or UI-built constraints into SketchTools", () => {
  expect(instances).toHaveLength(1);
  expect(attribute("onEdit")).toBeDefined();
  expect(attribute("onChange")).toBeUndefined();
  expect(attribute("onConstrain")).toBeUndefined();
});

it("the actual App adapter propagates a rejected shared edit to the panel without a local fallback", async () => {
  const command = vi.fn(async () => ({
    ok: false,
    error: { message: "Sketch work budget exceeded" },
  }));
  await expect(adapter(command)({ kind: "solve" })).rejects.toThrow(
    "Sketch work budget exceeded",
  );
  expect(command).toHaveBeenCalledOnce();
});
