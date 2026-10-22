import { expect, it } from "vitest";
import catalog from "../src/automation/catalog.json";
import { validateInput } from "../src/automation/api";
import { rectangleSketch } from "../src/sketch";
it.each(["cad_create", "cad_rebuild"])(
  "%s discovers and validates analytic profiles without a chord tolerance",
  (name) => {
    const schema = catalog.find((c) => c.name === name)!.inputSchema;
    const args = {
      expectedRevision: 0,
      requestId: "request",
      ...(name === "cad_create" ? { name: "Sketch extrusion" } : {}),
      ...(name === "cad_rebuild" ? { entityId: "body" } : {}),
      recipe: {
        kind: "extrude",
        height: 4,
        profile: { kind: "sketch-curves", sketch: rectangleSketch() },
      },
    };
    expect(() => validateInput(schema, args)).not.toThrow();
    expect(() =>
      validateInput(schema, {
        ...args,
        recipe: {
          ...args.recipe,
          profile: { ...args.recipe.profile, chordTolerance: 0.1 },
        },
      }),
    ).toThrow();
  },
);
