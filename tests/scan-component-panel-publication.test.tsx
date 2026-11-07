import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import {
  ScanTopologyPanels,
  type ScanTopologyPanelsProps,
  type ScanTopologyControlsProps,
} from "../src/ui/ScanTopologyPanels";
import { processMesh, type ProcessingResult } from "../src/processing-client";
import type { Entity } from "../src/types";

vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: () => {},
}));
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));

it("publishes the source remainder and component together from the panel", async () => {
  const source: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
    ]),
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const part = source.positions.slice(0, 9),
    normals = new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1,
    ]),
    remainder = {
      positions: source.positions.slice(9),
      normals: normals.slice(9),
    },
    segmentNormals = [normals.slice(0, 9)];
  source.normals = normals;
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      diagnostics: {},
      segments: [part],
      componentRemainder: remainder,
      segmentNormals,
    },
  });
  const props: ScanTopologyPanelsProps = {
    section: "components",
    positions: source.positions,
    selectedId: source.id,
    entities: [source],
    onReplace: vi.fn(),
    onCreate: vi.fn(),
    onSelection: vi.fn(),
    onProject: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onBack: vi.fn(),
    wireframe: false,
    onWireframe: vi.fn(),
  };
  const controls = ScanTopologyPanels(
    props,
  ) as ReactElement<ScanTopologyControlsProps>;
  controls.props.onOperation(
    { action: "componentExtract", indices: [0] },
    "Create new object",
  );
  await vi.waitFor(() =>
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith(
      [part],
      "Create new object",
      undefined,
      remainder,
      segmentNormals,
    ),
  );
  expect(props.onReplace).not.toHaveBeenCalled();
  expect(processMesh).toHaveBeenCalledWith(
    expect.objectContaining({ action: "componentExtract" }),
    expect.objectContaining({
      includeComponentRemainder: true,
      componentCornerNormals: normals,
    }),
  );
  expect(props.onError).not.toHaveBeenCalled();
});

it.each(["locked", "normals", "topology"])(
  "does not publish after source %s changes during extraction",
  async (change) => {
    const source: Entity = {
      id: "scan",
      name: "Scan",
      kind: "mesh",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      visible: true,
      color: "#ffffff",
      opacity: 1,
    };
    let finish!: (result: ProcessingResult) => void;
    vi.mocked(processMesh).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props: ScanTopologyPanelsProps = {
      section: "components",
      positions: source.positions,
      selectedId: source.id,
      entities: [source],
      onReplace: vi.fn(),
      onCreate: vi.fn(),
      onSelection: vi.fn(),
      onProject: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn(),
      onBack: vi.fn(),
      wireframe: false,
      onWireframe: vi.fn(),
    };
    const controls = ScanTopologyPanels(
      props,
    ) as ReactElement<ScanTopologyControlsProps>;
    controls.props.onOperation(
      { action: "componentExtract", indices: [0] },
      "Create new object",
    );
    props.entities = [
      {
        ...source,
        ...(change === "locked"
          ? { locked: true }
          : change === "normals"
            ? { normals: new Float32Array(9) }
            : {
                indexedMesh: {
                  vertices: source.positions,
                  triangles: new Uint32Array([0, 1, 2]),
                },
              }),
      },
    ];
    finish({
      kind: "scanEdit",
      diagnostics: {},
      scanEdit: {
        diagnostics: {},
        segments: [source.positions],
        componentRemainder: { positions: [] },
      },
    });
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith(
        expect.stringMatching(/changed or is locked/i),
      ),
    );
    expect(props.onCreate).not.toHaveBeenCalled();
  },
);
