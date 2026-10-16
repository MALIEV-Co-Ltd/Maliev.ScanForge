import { beforeEach, expect, it, vi } from "vitest";
import {
  ScanTopologyControls,
  type ScanTopologyControlsProps,
} from "../src/ui/ScanTopologyPanels";
const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (value: unknown) => [
    value === "entire" ? "bridge" : value,
    vi.fn(),
  ],
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
}));
beforeEach(() => {
  hooks.effects.length = 0;
});
function mount(closed: boolean) {
  const boundaries = [
    {
      points: [-2, -1, 0, -2, 1, 0],
      closed,
      triangles: [0],
      diameter: 2,
      length: 2,
    },
    {
      points: [2, 1, 0, 2, -1, 0],
      closed: false,
      triangles: [1],
      diameter: 2,
      length: 2,
    },
  ];
  const props: ScanTopologyControlsProps = {
    section: "holes",
    positions: new Float32Array(18),
    entities: [],
    selectedId: "scan",
    inventory: { components: [], boundaries },
    busy: false,
    progress: "",
    wireframe: false,
    onWireframe: vi.fn(),
    onReplace: vi.fn(),
    onCreate: vi.fn(),
    onSelection: vi.fn(),
    onBoundaryHighlight: vi.fn(),
    onProject: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onBack: vi.fn(),
    onOperation: vi.fn(),
    onBridgePreview: vi.fn(),
    onBridgeSession: vi.fn(),
  };
  ScanTopologyControls(props);
  for (const effect of hooks.effects) effect();
  return props;
}
it("enables bridge picking across all boundaries even when there are no closed holes", () => {
  const props = mount(false);
  const session = vi
    .mocked(props.onBridgeSession!)
    .mock.calls.find(([session]) => session)?.[0];
  expect(session).toBeDefined();
  expect(session!.boundaries).toBe(props.inventory.boundaries);
  expect(props.onBoundaryHighlight).toHaveBeenLastCalledWith(
    props.inventory.boundaries,
  );
});
it("routes independent source and destination boundary edge references to the shared operation", () => {
  const props = mount(true);
  const session = vi
    .mocked(props.onBridgeSession!)
    .mock.calls.find(([session]) => session)?.[0];
  expect(session).toBeDefined();
  session!.onGesture(
    "commit",
    { boundary: 0, edge: 0 },
    { boundary: 1, edge: 0 },
  );
  expect(props.onBridgePreview).toHaveBeenCalledWith(
    {
      action: "fillHoles",
      mode: "bridge",
      indices: [0],
      endBoundary: 1,
      algorithm: "automatic",
      start: 0,
      end: 0,
    },
    true,
  );
});
