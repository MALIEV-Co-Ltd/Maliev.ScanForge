import type { ScanBoundaryPath } from "../scan-boundary-edges";
import { useEffect, useRef, useState } from "react";
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
  onReplace: (positions: Float32Array, label: string) => void;
  onCreate: (segments: Float32Array[], label: string) => void;
  onSelection: (mask: Uint8Array) => void;
  onBoundaryHighlight?: (paths: readonly ScanBoundaryPath[]) => void;
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
  algorithm?: "automatic" | "flat" | "tangent" | "curvature";
  mode?: "entire" | "partial" | "bridge";
  start?: number;
  end?: number;
  diameter?: number;
  strength?: number;
  iterations?: number;
  plane?: { origin: Vec3; normal: Vec3 };
  tolerance?: number;
  fitTolerance?: number;
}
const empty: ScanInventory = { components: [], boundaries: [] };

/** Geometry-scoped worker ownership prevents a late operation from replacing another scan. */
export function ScanTopologyPanels(props: ScanTopologyPanelsProps) {
  const [inventory, setInventory] = useState<ScanInventory>(empty);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const owner = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  function cancel() {
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
        tolerance: SCAN_TOPOLOGY_TOLERANCE,
        ...operation,
      } satisfies ScanEditRequest;
      const result = await processMesh(request, {
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
      if (outcome.positions) props.onReplace(outcome.positions, label);
      if (outcome.segments) props.onCreate(outcome.segments, label);
      if (outcome.curves && operation.plane)
        props.onProject(outcome.curves, operation.plane, label);
      if (operation.action !== "inventory")
        props.onStatus(
          operation.action === "fillHoles"
            ? `${outcome.diagnostics.filledHoles ?? 0} holes filled · ${outcome.diagnostics.skippedHoles ?? 0} skipped`
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
    cancel();
    setInventory(empty);
    setBusy(false);
    void run({ action: "inventory" }, "Inspect mesh");
    return cancel;
  }, [props.positions, props.selectedId]);
  return (
    <ScanTopologyControls
      {...props}
      inventory={inventory}
      busy={busy}
      progress={progress}
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
  const [strength, setStrength] = useState(0.3),
    [tolerance, setTolerance] = useState(0.05);
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
      : inventory.boundaries.flatMap((boundary, index) =>
          section === "holes" && !boundary.closed
            ? []
            : [
                {
                  index,
                  triangles: boundary.triangles,
                  label: `${section === "holes" ? "Hole" : "Boundary"} ${index + 1} · ${boundary.closed ? "closed" : "open"} · ${boundary.length.toFixed(2)} mm`,
                },
              ],
        );
  const current = items[Math.min(selected, Math.max(0, items.length - 1))];
  const boundary =
    current && section !== "components"
      ? inventory.boundaries[current.index]
      : undefined;
  useEffect(() => {
    setStart(0);
    setEnd(Math.max(2, Math.floor((boundary?.points.length ?? 0) / 6)));
  }, [boundary?.points]);
  const blocked = props.busy || props.positions.length < 9;
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
    if (!props.busy) highlight(Math.min(selected, items.length - 1));
  }, [inventory, section, selected, props.positions, props.busy]);
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
          ? items
              .map((item) => item.index)
              .filter(
                (index) =>
                  diameter <= 0 ||
                  inventory.boundaries[index].diameter <= diameter,
              )
          : current
            ? [current.index]
            : [],
        algorithm,
        mode,
        start,
        end,
      },
      multiple ? "Fill multiple holes" : "Fill selected hole",
    );
  return (
    <section
      className="scan-topology-panel"
      aria-label={title}
      aria-busy={props.busy}
    >
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      <p className="scan-topology-summary">
        {inventory.components.length} meshes ·{" "}
        {inventory.boundaries.filter((item) => item.closed).length} holes ·{" "}
        {inventory.boundaries.length} boundaries
      </p>
      <fieldset disabled={blocked}>
        <div className="scan-topology-cycle">
          <button
            disabled={!items.length}
            onClick={() => choose((selected + items.length - 1) % items.length)}
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
              <select
                value={cleanup}
                onChange={(event) => {
                  setCleanup(event.target.value);
                  setThreshold(event.target.value === "triangles" ? 10 : 1);
                }}
              >
                <option value="triangles">Maximum triangle count</option>
                <option value="area">Area smaller than (mm²)</option>
              </select>
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
                    indices: inventory.components.flatMap((component, index) =>
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
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="entire">Entire hole</option>
                <option value="partial">Semi hole</option>
                <option value="bridge">Bridge</option>
              </select>
            </label>
            <label>
              Fill algorithm
              <select
                value={algorithm}
                onChange={(event) =>
                  setAlgorithm(event.target.value as typeof algorithm)
                }
              >
                <option value="automatic">Automatically decided</option>
                <option value="flat">Flat</option>
                <option value="tangent">Tangent</option>
                <option value="curvature">Curvature</option>
              </select>
            </label>
            {mode !== "entire" && (
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
            <button
              disabled={!current || (mode !== "entire" && start === end)}
              onClick={() => fill(false)}
            >
              Fill selected hole
            </button>
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
            </p>
            <div className="scan-topology-actions">
              <button
                disabled={!boundary}
                onClick={() => {
                  setDiameter(boundary!.diameter);
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
                Fill multiple holes
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              Smooth strength
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
              />
            </label>
            <div className="scan-topology-actions">
              <button
                disabled={!current}
                onClick={() =>
                  run(
                    {
                      action: "boundarySmooth",
                      indices: [current!.index],
                      strength,
                      iterations: 3,
                    },
                    "Smooth selected boundary",
                  )
                }
              >
                Smooth selected
              </button>
              <button
                disabled={!items.length}
                onClick={() =>
                  run(
                    {
                      action: "boundarySmooth",
                      indices: items.map((item) => item.index),
                      strength,
                      iterations: 3,
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
              <select
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
              </select>
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
      {props.progress && <p role="status">{props.progress}</p>}
      <button className="scan-topology-back" onClick={props.onBack}>
        {props.busy ? "Cancel and back" : "Back"}
      </button>
    </section>
  );
}
