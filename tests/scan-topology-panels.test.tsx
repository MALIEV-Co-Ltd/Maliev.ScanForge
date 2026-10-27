import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScanTopologyControls,
  type ScanTopologyControlsProps,
} from "../src/ui/ScanTopologyPanels";
import type { ReactElement, ReactNode } from "react";
import type { ScanBridgeSession } from "../src/scan-bridge-gesture";

const effects = vi.hoisted(() => [] as (() => unknown)[]);
beforeEach(() => {
  effects.length = 0;
});

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => unknown) => {
      effects.push(effect);
    },
    useState: (value: unknown) => [value, vi.fn()],
  };
});
const defaults = (): ScanTopologyControlsProps => ({
  section: "components",
  positions: new Float32Array(18),
  selectedId: "scan",
  entities: [],
  inventory: {
    components: [
      { triangles: [0], area: 4 },
      { triangles: [1], area: 20 },
    ],
    boundaries: [
      {
        points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        triangles: [0],
        closed: true,
        diameter: 2,
        length: 3,
      },
      {
        points: [0, 0, 0, 1, 0, 0],
        triangles: [1],
        closed: false,
        diameter: 1,
        length: 1,
      },
    ],
  },
  busy: false,
  progress: "",
  wireframe: false,
  onWireframe: vi.fn(),
  onOperation: vi.fn(),
  onReplace: vi.fn(),
  onCreate: vi.fn(),
  onSelection: vi.fn(),
  onProject: vi.fn(),
  onStatus: vi.fn(),
  onError: vi.fn(),
  onBack: vi.fn(),
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props?.children as ReactNode)];
}
function click(tree: ReactNode, label: string) {
  const button = elements(tree).find(
    (element) => element.type === "button" && element.props.children === label,
  );
  expect(button).toBeDefined();
  (button!.props.onClick as () => void)();
}
it("fills the double-clicked hole by its topology index rather than the selected list row", () => {
  const props = { ...defaults(), section: "holes" as const };
  const small = props.inventory.boundaries[0];
  props.inventory.boundaries = [small, { ...small, length: 12 }];
  let session: ScanBridgeSession | null = null;
  props.onBridgeSession = (value) => {
    session = value;
  };
  ScanTopologyControls(props);
  effects.forEach((effect) => effect());
  const active = session as ScanBridgeSession | null;
  expect(active?.mode).toBe("holes");
  expect(active).toHaveProperty("onFillBoundary", expect.any(Function));
  active!.onFillBoundary!(99);
  expect(props.onOperation).not.toHaveBeenCalled();
  active!.onFillBoundary!(0);
  expect(props.onOperation).toHaveBeenCalledExactlyOnceWith(
    {
      action: "fillHoles",
      indices: [0],
      algorithm: "automatic",
      mode: "entire",
    },
    "Fill selected hole",
  );
});

it("selects the triangles of an individual connected mesh and extracts that component", () => {
  const props = defaults(),
    tree = ScanTopologyControls(props);
  const item = elements(tree).find(
    (element) =>
      element.type === "button" && element.props["aria-pressed"] === true,
  );
  (item!.props.onClick as () => void)();
  expect(props.onSelection).toHaveBeenCalledWith(new Uint8Array([1, 0]));
  click(tree, "Create new object");
  expect(props.onOperation).toHaveBeenCalledWith(
    { action: "componentExtract", indices: [0] },
    "Create new object",
  );
  click(tree, "Remove small meshes");
  expect(props.onOperation).toHaveBeenLastCalledWith(
    { action: "componentRemove", indices: [0, 1] },
    "Remove small meshes",
  );
});
it("defaults to entire-hole automatic fill and excludes open boundary chains from multiple fill", () => {
  const props = { ...defaults(), section: "holes" as const },
    tree = ScanTopologyControls(props);
  const html = renderToStaticMarkup(tree);
  expect(html).toContain(
    '<option value="automatic" selected="">Automatically decided',
  );
  expect(html).toContain('<option value="entire" selected="">Entire hole');
  expect(html).not.toContain("Hole 2");
  click(tree, "Fill multiple holes");
  expect(props.onOperation).toHaveBeenCalledWith(
    {
      action: "fillHoles",
      indices: [0],
      batch: true,
      diameter: 0,
      mode: "entire",
      start: 0,
      end: 1,
    },
    "Fill multiple holes",
  );
  click(tree, "Measure hole");
  expect(props.onStatus).toHaveBeenCalledWith("Hole diameter: 2.000 mm");
});
it("projects every boundary to the actual origin XY plane and forwards smoothing parameters", () => {
  const props = { ...defaults(), section: "boundaries" as const },
    tree = ScanTopologyControls(props);
  click(tree, "Project all");
  expect(props.onOperation).toHaveBeenCalledWith(
    {
      action: "boundaryProject",
      indices: [0, 1],
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      fitTolerance: 0.05,
    },
    "Project all boundaries",
  );
  click(tree, "Smooth selected");
  expect(props.onOperation).toHaveBeenLastCalledWith(
    { action: "boundarySmooth", indices: [0], strength: 1, iterations: 1 },
    "Smooth selected boundary",
  );
  click(tree, "Smooth all");
  expect(props.onOperation).toHaveBeenLastCalledWith(
    { action: "boundarySmooth", indices: [0, 1], strength: 1, iterations: 1 },
    "Smooth all boundaries",
  );
});
it("requests a spatial sketch for the selected closed boundary", () => {
  const props = { ...defaults(), section: "boundaries" as const };
  const tree = ScanTopologyControls(props);
  click(tree, "3D sketch from selected");
  expect(props.onOperation).toHaveBeenCalledWith(
    { action: "boundarySpatialSketch", indices: [0], fitTolerance: 0.05 },
    "Create 3D sketch from selected boundary",
  );
});
it("blocks geometry operations for empty input and during processing while preserving cancellation", () => {
  const props = {
    ...defaults(),
    positions: new Float32Array(),
    busy: true,
    inventory: { components: [], boundaries: [] },
  };
  const tree = ScanTopologyControls(props),
    html = renderToStaticMarkup(tree);
  expect(html).toContain('<fieldset disabled="">');
  expect(html).toContain("No items");
  click(tree, "Cancel and back");
  expect(props.onBack).toHaveBeenCalledOnce();
});

it("highlights boundary and hole edges without selecting their incident faces", () => {
  for (const section of ["holes", "boundaries"] as const) {
    const onBoundaryHighlight = vi.fn();
    const props = { ...defaults(), section, onBoundaryHighlight };
    const tree = ScanTopologyControls(props);
    const item = elements(tree).find(
      (element) =>
        element.type === "button" && element.props["aria-pressed"] === true,
    );
    (item!.props.onClick as () => void)();
    expect(onBoundaryHighlight).toHaveBeenCalledWith([
      props.inventory.boundaries[0],
    ]);
    expect(props.onSelection).not.toHaveBeenCalled();
  }
});

it("lists holes largest first and fills the original boundary reference", () => {
  const props = defaults();
  props.section = "holes";
  const small = props.inventory.boundaries[0];
  props.inventory.boundaries = [
    small,
    { ...small, diameter: 8, length: 12, triangles: [1] },
    { ...small, closed: false, diameter: 100 },
  ];
  const tree = ScanTopologyControls(props);
  const rows = elements(tree).filter(
    (e) => e.type === "button" && typeof e.props["aria-pressed"] === "boolean",
  );
  expect(rows.map((e) => e.props.children)).toEqual([
    "Hole 2 · closed · 12.00 mm",
    "Hole 1 · closed · 3.00 mm",
  ]);
  click(tree, "Fill selected hole");
  expect(props.onOperation).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "fillHoles", indices: [1] }),
    "Fill selected hole",
  );
});
