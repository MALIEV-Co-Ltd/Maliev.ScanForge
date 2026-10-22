import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApplicationApi } from "../src/automation/api";
import type { Entity } from "../src/types";
import { cloudPoseBits } from "../src/point-cloud-placement";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
import {
  GlobalAlignmentDiagnostics,
  GlobalAlignmentTools,
} from "../src/ui/GlobalAlignmentTools";
import {
  getRibbonToolMetadata,
  ribbonToolAvailability,
} from "../src/ui/ribbon-model";

const mesh = (id: string, patch: Partial<Entity> = {}): Entity => ({
  id,
  name: `Scan ${id}`,
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  color: "#ffffff",
  opacity: 1,
  ...patch,
});

it("offers Preview before Apply with the observed tolerance and visible scene targets", () => {
  const html = renderToStaticMarkup(
    <GlobalAlignmentTools
      api={{} as ApplicationApi}
      entities={[
        mesh("a"),
        mesh("b"),
        mesh("hidden", { visible: false }),
        mesh("locked", { locked: true }),
        mesh("cloud", { kind: "pointcloud" }),
      ]}
      onClose={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Global fine align"');
  expect(html).toContain('value="0.5"');
  expect(html).toContain("Negative values use their absolute distance");
  expect(html).toContain("Scan a");
  expect(html).toContain("Scan hidden");
  expect(html).toContain("Scan locked");
  expect(html).toContain("Point clouds and CAD objects are not supported");
  expect(html).toMatch(/<button disabled="">Apply<\/button>/);
});

it("reports nonconvergence, native coverage, unavailable mean and per-scan stability honestly", () => {
  const html = renderToStaticMarkup(
    <GlobalAlignmentDiagnostics
      entities={[mesh("a")]}
      state={{
        state: "preview",
        entityIds: ["a"],
        converged: false,
        outer: {
          matrixFormat: "row-major-3x4",
          matrixEncoding: "float64-le-hex",
          translationUnits: "mm",
          applications: [0, 1].map(() => ({
            id: "a",
            matrix: [...identity],
            matrixBits: cloudPoseBits(identity),
          })),
          passes: 19,
          order: ["a"],
          seed: 1,
          states: [
            {
              id: "a",
              matrix: [...identity],
              matrixBits: cloudPoseBits(identity),
              pointCount: 3,
              mean: null,
              std: 42,
              coveragePercent: 42,
              stable: false,
              converged: false,
            },
          ],
        },
      }}
    />,
  );
  expect(html).toContain("Alignment did not converge");
  expect(html).toContain("Apply anyway");
  expect(html).toContain("Coverage (%)");
  expect(html).toContain("42.000");
  expect(html).toContain("Unavailable");
  expect(html).toContain("19 refinement passes");
  expect(html).not.toContain("Standard deviation");
  expect(html).not.toContain("alignment successful");
});

it("admits two visible raw meshes and disables Preview for a single target", () => {
  const render = (entities: Entity[]) =>
    renderToStaticMarkup(
      <GlobalAlignmentTools
        api={{} as ApplicationApi}
        entities={entities}
        onClose={() => {}}
      />,
    );
  expect(render([mesh("a"), mesh("b")])).toContain("<button>Preview</button>");
  expect(render([mesh("a")])).toContain('<button disabled="">Preview</button>');
});

it("enables global fine alignment independently of selection and respects scene admission", () => {
  const tool = getRibbonToolMetadata("globalFineAlign")!;
  expect(tool.action).toBe("globalFineAlign");
  const state = {
    disabled: false,
    hasSelection: false,
    canUndo: false,
    canRedo: false,
    globalAlignmentError: null,
  };
  expect(
    ribbonToolAvailability(tool, state, { globalFineAlign() {} }).available,
  ).toBe(true);
  expect(
    ribbonToolAvailability(
      tool,
      { ...state, globalAlignmentError: "Choose two visible meshes" },
      { globalFineAlign() {} },
    ),
  ).toEqual({ available: false, reason: "Choose two visible meshes" });
});
