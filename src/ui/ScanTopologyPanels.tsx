import { holeListOrder } from "../scan-hole-order";
import { AppSelect } from "./AppSelect";
import "./ToolPanel.css";
import type { ScanBoundaryPath } from "../scan-boundary-edges";
import { useEffect, useRef, useState } from "react";
import type { ScanBridgeSession } from "../scan-bridge-gesture";
import { BridgePreviewController } from "../scan-bridge-preview";
import { processMesh } from "../processing-client";
import type { ScanEditRequest } from "../scan-edit";
import type { Entity, Positions, Vec3 } from "../types";
import { SCAN_TOPOLOGY_TOLERANCE } from "../scan-topology-tolerance";
import "./scan-topology-panels.css";

export interface ScanInventory {
  components: { triangles: number[]; area: number }[];
  boundaries: {
    points: number[];
    triangles: number[];
    closed: boolean;
    diameter: number;
    length: number;
  }[];
}
export interface ScanTopologyPanelsProps {
  section: "components" | "holes" | "boundaries";
  positions: Positions;
  entities: Entity[];
  selectedId: string;
  selection?: Uint8Array | null;
  onReplace: (
    positions: Float32Array,
    label: string,
    indexedMesh?: Entity["indexedMesh"],
  ) => void;
  onCreate: (segments: Float32Array[], label: string) => void;
  onSelection: (mask: Uint8Array) => void;
  onBoundaryHighlight?: (paths: readonly ScanBoundaryPath[]) => void;
  onBridgeSession?: (session: ScanBridgeSession | null) => void;
  onBridgeDisplay?: (positions?: Float32Array) => void;
  onProject: (
    curves: number[][],
    plane: { origin: Vec3; normal: Vec3 },
    label: string,
  ) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onBack: () => void;
  wireframe: boolean;
  onWireframe: (enabled: boolean) => void;
  onOpacity?: (opacity: number) => void;
}
type ScanAction =
  | "inventory"
  | "componentExtract"
  | "componentKeep"
  | "componentRemove"
  | "componentFlip"
  | "fillHoles"
  | "boundarySmooth"
  | "boundaryProject";
export interface ScanPanelOperation {
  action: ScanAction;
  indices?: number[];
  algorithm?: ScanEditRequest["algorithm"];
  mode?: "entire" | "partial" | "bridge";
  start?: number;
  end?: number;
  endBoundary?: number;
  diameter?: number;
  batch?: boolean;
  strength?: number;
  anchors?: ScanEditRequest["anchors"];
  iterations?: number;
  plane?: { origin: Vec3; normal: Vec3 };
  tolerance?: number;
  fitTolerance?: number;
}
const empty: ScanInventory = { components: [], boundaries: [] };

/** Geometry-scoped worker ownership prevents a late operation from replacing another scan. */
export function ScanTopologyPanels(props: ScanTopologyPanelsProps) {
  const sourceIndexed = props.entities.find(
    (entity) =>
      entity.id === props.selectedId && entity.positions === props.positions,
  )?.indexedMesh;
  const [inventory, setInventory] = useState<ScanInventory>(empty);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState("");
  const bridgeOwner = useRef<BridgePreviewController | null>(null);
  const owner = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  function cancel() {
    bridgeOwner.current?.cancel();
    owner.current?.abort();
    owner.current = null;
    callbacks.current.onBusyChange?.(false);
  }
  async function run(operation: ScanPanelOperation, label: string) {
    if (owner.current || props.positions.length < 9) return;
    const controller = new AbortController();
    owner.current = controller;
    setBusy(true);
    props.onBusyChange?.(true);
    setProgress(`${label}…`);
    try {
      const request = {
        kind: "scanEdit",
        positions: props.positions,
        sourceIndexed,
        tolerance: SCAN_TOPOLOGY_TOLERANCE,
        ...operation,
      } satisfies ScanEditRequest;
      const result = await processMesh(request, {
        reuseTopology: true,
        signal: controller.signal,
        onProgress: (fraction, stage) => {
          if (owner.current === controller)
            setProgress(`${stage} · ${Math.round(fraction * 100)}%`);
        },
      });
      if (controller.signal.aborted || owner.current !== controller) return;
      const outcome = result.scanEdit;
      if (!outcome) throw new Error("Scan editing worker returned no result.");
      if (outcome.inventory) setInventory(outcome.inventory);
      if (outcome.selection) props.onSelection(outcome.selection);
      if (outcome.positions && outcome.diagnostics.changed !== false) {
        if (result.indexedMesh)
          props.onReplace(outcome.positions, label, result.indexedMesh);
        else props.onReplace(outcome.positions, label);
      }
      if (outcome.segments) props.onCreate(outcome.segments, label);
      if (outcome.curves && operation.plane)
        props.onProject(outcome.curves, operation.plane, label);
      if (operation.action !== "inventory")
        props.onStatus(
          operation.action === "fillHoles"
            ? `${outcome.diagnostics.filledHoles ?? 0} holes filled · ${outcome.diagnostics.skippedHoles ?? 0} skipped${Number(outcome.diagnostics.boundedFallbackHoles) > 0 ? ` · ${outcome.diagnostics.boundedFallbackHoles} filled from boundary` : ""}`
            : `${label} complete.`,
        );
    } catch (error) {
      if (!controller.signal.aborted && owner.current === controller)
        props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (owner.current === controller) {
        owner.current = null;
        setBusy(false);
        setProgress("");
        callbacks.current.onBusyChange?.(false);
      }
    }
  }
  useEffect(() => {
    const bridge = new BridgePreviewController(
      props.positions,
      async (operation, signal) => {
        const result = await processMesh(
          {
            kind: "scanEdit",
            positions: props.positions,
            sourceIndexed,
            tolerance: SCAN_TOPOLOGY_TOLERANCE,
            ...operation,
          },
          { signal, reuseTopology: true },
        );
        if (!result.scanEdit)
          throw new Error("Bridge worker returned no result.");
        return result.scanEdit;
      },
      {
        display: (positions) => callbacks.current.onBridgeDisplay?.(positions),
        status: setBridgeStatus,
        error: (message) => callbacks.current.onError(message),
        commit: (positions, label) => {
          const current = callbacks.current;
          if (
            current.selectedId !== props.selectedId ||
            current.positions !== props.positions ||
            current.entities.find((e) => e.id === current.selectedId)?.locked
          )
            throw new Error("The source mesh changed; draw the bridge again.");
          current.onReplace(positions, label);
        },
      },
    );
    bridgeOwner.current = bridge;
    return () => {
      bridge.dispose();
      if (bridgeOwner.current === bridge) bridgeOwner.current = null;
    };
  }, [props.positions, props.selectedId, sourceIndexed]);
  useEffect(() => {
    cancel();
    setInventory(empty);
    setBusy(false);
    void run({ action: "inventory" }, "Inspect mesh");
    return cancel;
  }, [props.positions, props.selectedId, sourceIndexed]);
  return (
    <ScanTopologyControls
      {...props}
      inventory={inventory}
      busy={busy}
      progress={progress}
      bridgeStatus={bridgeStatus}
      onBridgePreview={(operation, accept) =>
        bridgeOwner.current?.request(operation, accept)
      }
      onOperation={(operation, label) => {
        void run(operation, label);
      }}
      onBack={() => {
        cancel();
        props.onBack();
      }}
    />
  );
}

export interface ScanTopologyControlsProps extends ScanTopologyPanelsProps {
  bridgeStatus?: string;
  onBridgePreview?: (
    operation: ScanPanelOperation | null,
    accept: boolean,
  ) => void;
  inventory: ScanInventory;
  busy: boolean;
  progress: string;
  onOperation: (operation: ScanPanelOperation, label: string) => void;
}
/** The controls are separate from worker ownership so their requests can be validated independently. */
export function ScanTopologyControls(props: ScanTopologyControlsProps) {
  const [selected, setSelected] = useState(0);
  const [algorithm, setAlgorithm] =
    useState<NonNullable<ScanPanelOperation["algorithm"]>>("automatic");
  const [mode, setMode] =
    useState<NonNullable<ScanPanelOperation["mode"]>>("entire");
  const [start, setStart] = useState(0),
    [end, setEnd] = useState(1);
  const [diameter, setDiameter] = useState(0);
  const [cleanup, setCleanup] = useState("triangles"),
    [threshold, setThreshold] = useState(10);
  const [strength, setStrength] = useState(1),
    [tolerance, setTolerance] = useState(0.05);
  const [anchorEnabled, setAnchorEnabled] = useState(false);
  const [anchorPoint, setAnchorPoint] = useState(0);
  const [planeId, setPlaneId] = useState("XY");
  const [transparent, setTransparent] = useState(false);
  useEffect(() => {
    setSelected(0);
  }, [props.section, props.positions]);
  const { inventory, section } = props;
  const items =
    section === "components"
      ? inventory.components.map((component, index) => ({
          index,
          triangles: component.triangles,
          label: `Mesh ${index + 1} · ${component.triangles.length} triangles · ${component.area.toFixed(2)} mm²`,
        }))
      : (section === "holes"
          ? holeListOrder(inventory.boundaries)
          : inventory.boundaries.map((_, index) => index)
        ).map((index) => {
          const boundary = inventory.boundaries[index];
          return {
            index,
            triangles: boundary.triangles,
            label: `${section === "holes" ? "Hole" : "Boundary"} ${index + 1} · ${boundary.closed ? "closed" : "open"} · ${boundary.length.toFixed(2)} mm`,
          };
        });
  const current = items[Math.min(selected, Math.max(0, items.length - 1))];
  const boundary =
    current && section !== "components"
      ? inventory.boundaries[current.index]
      : undefined;
  useEffect(() => {
    setAnchorEnabled(false);
    setAnchorPoint(0);
    setStart(0);
    setEnd(Math.max(2, Math.floor((boundary?.points.length ?? 0) / 6)));
  }, [boundary?.points]);
  const blocked =
    props.busy ||
    props.positions.length < 9 ||
    !!props.entities.find((e) => e.id === props.selectedId)?.locked;
  useEffect(() => {
    if (section !== "holes" || blocked || !inventory.boundaries.length) {
      props.onBridgeSession?.(null);
      return;
    }
    if (mode !== "bridge") {
      props.onBridgeSession?.({
        mode: "holes",
        boundaries: inventory.boundaries,
        onGesture: () => {},
        onSelectBoundary: (boundary) => {
          const index = items.findIndex((item) => item.index === boundary);
          if (index >= 0) choose(index);
        },
        onFillBoundary: (boundary) => {
          const index = items.findIndex((item) => item.index === boundary);
          if (index < 0) return;
          choose(index);
          run(
            {
              action: "fillHoles",
              indices: [boundary],
              algorithm,
              mode: "entire",
            },
            "Fill selected hole",
          );
        },
      });
      return () => props.onBridgeSession?.(null);
    }
    props.onBridgeSession?.({
      boundaries: inventory.boundaries,
      onGesture: (phase, start, end) => {
        // Pointer movement draws a lightweight provisional surface in the viewport.
        // Only release runs the shared validated edit and adopts its topology.
        if (phase === "preview") return;
        if (phase === "cancel" || end === null)
          props.onBridgePreview?.(null, false);
        else
          props.onBridgePreview?.(
            {
              action: "fillHoles",
              mode: "bridge",
              indices: [start.boundary],
              endBoundary: end.boundary,
              algorithm,
              start: start.edge,
              end: end.edge,
            },
            phase === "commit",
          );
      },
    });
    props.onStatus(
      "Hover any exposed boundary edge, then drag to another boundary edge.",
    );
    return () => {
      props.onBridgeSession?.(null);
      props.onBridgePreview?.(null, false);
    };
  }, [
    section,
    mode,
    blocked,
    inventory.boundaries,
    algorithm,
    props.positions,
    props.selectedId,
  ]);
  const run = (operation: ScanPanelOperation, label: string) =>
    props.onOperation(operation, label);
  function choose(index: number) {
    setSelected(index);
    highlight(index);
  }
  function highlight(index: number) {
    if (section !== "components") {
      const rim = inventory.boundaries[items[index]?.index];
      props.onBoundaryHighlight?.(rim ? [rim] : []);
      return;
    }
    props.onBoundaryHighlight?.([]);
    const mask = new Uint8Array(Math.floor(props.positions.length / 9));
    for (const triangle of items[index]?.triangles ?? []) mask[triangle] = 1;
    props.onSelection(mask);
  }
  useEffect(() => {
    if (!props.busy) {
      if (section === "holes" && mode === "bridge")
        props.onBoundaryHighlight?.(inventory.boundaries);
      else highlight(Math.min(selected, items.length - 1));
    }
  }, [inventory, section, mode, selected, props.positions, props.busy]);
  useEffect(() => () => props.onBoundaryHighlight?.([]), []);
  const plane =
    planeId === "XY"
      ? { origin: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 }
      : planeId === "YZ"
        ? { origin: [0, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 }
        : planeId === "XZ"
          ? { origin: [0, 0, 0] as Vec3, normal: [0, 1, 0] as Vec3 }
          : (() => {
              const fit = props.entities.find(
                (entity) => entity.id === planeId,
              )?.fit;
              return fit?.kind === "plane"
                ? { origin: fit.center, normal: fit.axis }
                : undefined;
            })();
  const title =
    section === "components"
      ? "Individual meshes"
      : section === "holes"
        ? "Fill holes"
        : "Edit boundaries";
  const fill = (multiple: boolean) =>
    run(
      {
        action: "fillHoles",
        indices: multiple
          ? items.map((item) => item.index)
          : current
            ? [current.index]
            : [],
        ...(multiple && algorithm !== "surfaceRecovery"
          ? { batch: true, diameter }
          : { algorithm, ...(multiple ? { diameter } : {}) }),
        mode,
        start,
        end,
      },
      multiple
        ? algorithm === "surfaceRecovery"
          ? "Recover multiple holes"
          : "Fill multiple holes"
        : "Fill selected hole",
    );
  return (
    <section
      className="scan-topology-panel tool-panel"
      aria-label={title}
      aria-busy={props.busy}
    >
      <h3>
        {title}
        <span>
          {section === "holes" && mode === "bridge"
            ? inventory.boundaries.length
            : items.length}
        </span>
      </h3>
      <div className="tool-panel-content">
        <p className="scan-topology-summary">
          {inventory.components.length} meshes ·{" "}
          {inventory.boundaries.filter((item) => item.closed).length} holes ·{" "}
          {inventory.boundaries.length} boundaries
        </p>
        <fieldset disabled={blocked}>
          {!(section === "holes" && mode === "bridge") && (
            <>
              <div className="scan-topology-cycle">
                <button
                  disabled={!items.length}
                  onClick={() =>
                    choose((selected + items.length - 1) % items.length)
                  }
                  aria-label="Previous item"
                >
                  ‹
                </button>
                <span>
                  {items.length
                    ? `${Math.min(selected + 1, items.length)} / ${items.length}`
                    : "No items"}
                </span>
                <button
                  disabled={!items.length}
                  onClick={() => choose((selected + 1) % items.length)}
                  aria-label="Next item"
                >
                  ›
                </button>
              </div>
              <div
                className="scan-topology-list"
                role="group"
                aria-label={`${title} items`}
              >
                {items.map((item, index) => (
                  <button
                    key={item.index}
                    aria-pressed={current?.index === item.index}
                    onClick={() => choose(index)}
                    onMouseEnter={() => highlight(index)}
                    onMouseLeave={() => highlight(selected)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {section === "components" ? (
            <>
              <div className="scan-topology-actions">
                {(
                  [
                    ["componentFlip", "Flip normals"],
                    ["componentKeep", "Leave selected only"],
                    ["componentExtract", "Create new object"],
                  ] as const
                ).map(([action, label]) => (
                  <button
                    key={action}
                    disabled={!current}
                    onClick={() =>
                      run({ action, indices: [current!.index] }, label)
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                Remove small meshes by
                <AppSelect
                  value={cleanup}
                  onChange={(event) => {
                    setCleanup(event.target.value);
                    setThreshold(event.target.value === "triangles" ? 10 : 1);
                  }}
                >
                  <option value="triangles">Maximum triangle count</option>
                  <option value="area">Area smaller than (mm²)</option>
                </AppSelect>
              </label>
              <label>
                Threshold
                <input
                  type="number"
                  min="0"
                  step={cleanup === "triangles" ? "1" : "0.1"}
                  value={threshold}
                  onChange={(event) =>
                    setThreshold(Math.max(0, Number(event.target.value)))
                  }
                />
              </label>
              <button
                disabled={!items.length}
                onClick={() =>
                  run(
                    {
                      action: "componentRemove",
                      indices: inventory.components.flatMap(
                        (component, index) =>
                          (
                            cleanup === "triangles"
                              ? component.triangles.length <= threshold
                              : component.area < threshold
                          )
                            ? [index]
                            : [],
                      ),
                    },
                    "Remove small meshes",
                  )
                }
              >
                Remove small meshes
              </button>
            </>
          ) : section === "holes" ? (
            <>
              <label>
                Fill mode
                <AppSelect
                  value={mode}
                  onChange={(event) => {
                    const next = event.target.value as typeof mode;
                    setMode(next);
                    if (next !== "entire" && algorithm === "surfaceRecovery")
                      setAlgorithm("automatic");
                  }}
                >
                  <option value="entire">Entire hole</option>
                  <option value="partial">Semi hole</option>
                  <option value="bridge">Bridge</option>
                </AppSelect>
              </label>
              <label>
                Fill algorithm
                <AppSelect
                  value={algorithm}
                  onChange={(event) =>
                    setAlgorithm(event.target.value as typeof algorithm)
                  }
                >
                  <option value="automatic">Automatically decided</option>
                  <option value="flat">Flat</option>
                  <option value="tangent">Tangent</option>
                  <option value="curvature">Curvature</option>
                  <option value="surfaceRecovery" disabled={mode !== "entire"}>
                    Recover surface
                  </option>
                </AppSelect>
              </label>
              {mode === "bridge" && (
                <p
                  role="status"
                  aria-live="polite"
                  className="scan-topology-summary"
                >
                  {props.bridgeStatus ||
                    "Hover an exposed edge, then drag to see a live provisional bridge. Release on another edge to validate and create it with the chosen continuity. Edges may be on separate boundaries. Esc cancels; Undo removes it."}
                </p>
              )}
              {mode !== "bridge" && (
                <p className="scan-topology-summary">
                  Hover a hole to highlight its boundary, then click it to
                  select it. Double-click a highlighted hole to fill it.
                </p>
              )}
              {mode === "partial" && (
                <div className="scan-topology-actions">
                  <label>
                    Start vertex
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, (boundary?.points.length ?? 0) / 3 - 1)}
                      value={start}
                      onChange={(event) =>
                        setStart(Math.max(0, Number(event.target.value)))
                      }
                    />
                  </label>
                  <label>
                    End vertex
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, (boundary?.points.length ?? 0) / 3 - 1)}
                      value={end}
                      onChange={(event) =>
                        setEnd(Math.max(0, Number(event.target.value)))
                      }
                    />
                  </label>
                </div>
              )}
              {mode !== "bridge" && (
                <button
                  disabled={!current || (mode !== "entire" && start === end)}
                  onClick={() => fill(false)}
                >
                  Fill selected hole
                </button>
              )}
              {mode !== "bridge" && (
                <>
                  <label>
                    Maximum hole diameter (mm)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={diameter}
                      onChange={(event) =>
                        setDiameter(Math.max(0, Number(event.target.value)))
                      }
                    />
                  </label>
                  <p className="scan-topology-summary">
                    0 includes every closed boundary.
                    {algorithm === "surfaceRecovery"
                      ? " Recovery applies to each included hole."
                      : " Multiple-hole filling uses Tangent."}
                  </p>
                  <div className="scan-topology-actions">
                    <button
                      disabled={!boundary}
                      onClick={() => {
                        setDiameter(boundary!.diameter + 0.1);
                        props.onStatus(
                          `Hole diameter: ${boundary!.diameter.toFixed(3)} mm`,
                        );
                      }}
                    >
                      Measure hole
                    </button>
                    <button
                      disabled={!items.length || mode !== "entire"}
                      onClick={() => fill(true)}
                    >
                      {algorithm === "surfaceRecovery"
                        ? "Recover multiple holes"
                        : "Fill multiple holes"}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label>
                Smooth strength
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={strength}
                  onChange={(event) => setStrength(Number(event.target.value))}
                />
              </label>
              <label className="scan-topology-check">
                <input
                  type="checkbox"
                  checked={anchorEnabled}
                  onChange={(event) => setAnchorEnabled(event.target.checked)}
                />
                Anchor a point on the selected boundary
              </label>
              {anchorEnabled && boundary && (
                <label>
                  Boundary point index (starts at 0)
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, boundary.points.length / 3 - 1)}
                    step="1"
                    value={anchorPoint}
                    onChange={(event) =>
                      setAnchorPoint(Number(event.target.value))
                    }
                  />
                  <span>
                    {boundary.points
                      .slice(anchorPoint * 3, anchorPoint * 3 + 3)
                      .map((v) => v.toFixed(3))
                      .join(", ")}{" "}
                    mm
                  </span>
                </label>
              )}
              <div className="scan-topology-actions">
                <button
                  disabled={
                    !current ||
                    (anchorEnabled &&
                      (!Number.isSafeInteger(anchorPoint) ||
                        anchorPoint < 0 ||
                        anchorPoint >= (boundary?.points.length ?? 0) / 3))
                  }
                  onClick={() =>
                    run(
                      {
                        action: "boundarySmooth",
                        indices: [current!.index],
                        strength,
                        iterations: 1,
                        ...(anchorEnabled
                          ? {
                              anchors: [
                                {
                                  boundary: current!.index,
                                  point: anchorPoint,
                                },
                              ],
                            }
                          : {}),
                      },
                      "Smooth selected boundary",
                    )
                  }
                >
                  Smooth selected
                </button>
                <button
                  disabled={
                    !items.length ||
                    (anchorEnabled &&
                      (!current ||
                        !Number.isSafeInteger(anchorPoint) ||
                        anchorPoint < 0 ||
                        anchorPoint >= (boundary?.points.length ?? 0) / 3))
                  }
                  onClick={() =>
                    run(
                      {
                        action: "boundarySmooth",
                        indices: items.map((item) => item.index),
                        strength,
                        iterations: 1,
                        ...(anchorEnabled
                          ? {
                              anchors: [
                                {
                                  boundary: current!.index,
                                  point: anchorPoint,
                                },
                              ],
                            }
                          : {}),
                      },
                      "Smooth all boundaries",
                    )
                  }
                >
                  Smooth all
                </button>
              </div>
              <label>
                Projection plane
                <AppSelect
                  value={planeId}
                  onChange={(event) => setPlaneId(event.target.value)}
                >
                  <option value="XY">XY plane</option>
                  <option value="YZ">YZ plane</option>
                  <option value="XZ">XZ plane</option>
                  {props.entities
                    .filter((entity) => entity.fit?.kind === "plane")
                    .map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                </AppSelect>
              </label>
              <label>
                Fit tolerance (mm)
                <input
                  type="number"
                  min="0.000001"
                  step="0.01"
                  value={tolerance}
                  onChange={(event) =>
                    setTolerance(Math.max(0.000001, Number(event.target.value)))
                  }
                />
              </label>
              <div className="scan-topology-actions">
                <button
                  disabled={!current || !plane}
                  onClick={() =>
                    run(
                      {
                        action: "boundaryProject",
                        indices: [current!.index],
                        plane,
                        fitTolerance: tolerance,
                      },
                      "Project selected boundary",
                    )
                  }
                >
                  Project selected
                </button>
                <button
                  disabled={!items.length || !plane}
                  onClick={() =>
                    run(
                      {
                        action: "boundaryProject",
                        indices: items.map((item) => item.index),
                        plane,
                        fitTolerance: tolerance,
                      },
                      "Project all boundaries",
                    )
                  }
                >
                  Project all
                </button>
              </div>
            </>
          )}
          {props.onOpacity && (
            <label className="scan-topology-check">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(event) => {
                  setTransparent(event.target.checked);
                  props.onOpacity?.(event.target.checked ? 0.3 : 1);
                }}
              />
              Draw mesh transparent
            </label>
          )}
          <label className="scan-topology-check">
            <input
              type="checkbox"
              checked={props.wireframe}
              onChange={(event) => props.onWireframe(event.target.checked)}
            />
            Show mesh wireframe
          </label>
        </fieldset>
      </div>
      <footer className="tool-panel-actions">
        <button className="scan-topology-back" onClick={props.onBack}>
          {props.busy ? "Cancel and back" : "Back"}
        </button>
      </footer>
    </section>
  );
}
