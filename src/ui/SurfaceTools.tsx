import { useEffect, useRef, useState } from "react";
import type { Positions, Vec3 } from "../types";
import {
  createGridPatch,
  editControlPoint,
  importQuadGridObj,
  joinPatchBoundary,
  insertPatchKnot,
  preparePatchCrease,
  parsePatch,
  serializePatch,
  snapControlPoint,
  tessellatePatch,
  type NurbsPatch,
  type SurfaceFitOptions,
  type PatchEdge,
  type PatchAxis,
} from "../surfaces";
import { fitGridSurfaceAsync } from "../surface-client";

export interface SurfaceToolsProps {
  scan?: Positions;
  patch?: NurbsPatch;
  onPatchChange: (patch: NurbsPatch) => void;
  onCreateMesh: (positions: Float32Array, name: string) => void;
  onExportPatch: (json: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/** The caller owns patch persistence and scene insertion; this panel keeps no hidden geometry. */
export function SurfaceTools({
  scan,
  patch,
  onPatchChange,
  onCreateMesh,
  onExportPatch,
  onError,
  disabled,
  onBusyChange,
}: SurfaceToolsProps) {
  const fitting = useRef<AbortController | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const [fitBusy, setFitBusy] = useState(false);
  useEffect(
    () => () => {
      fitting.current?.abort();
    },
    [scan],
  );
  const [u, setU] = useState(4),
    [v, setV] = useState(4),
    [degree, setDegree] = useState(3);
  const [width, setWidth] = useState(100),
    [height, setHeight] = useState(100);
  const [samples, setSamples] = useState(4000),
    [segments, setSegments] = useState(32);
  const [projection, setProjection] =
    useState<SurfaceFitOptions["projection"]>("xy");
  const [index, setIndex] = useState(0),
    [message, setMessage] = useState("");
  const [referencePatch, setReferencePatch] = useState<NurbsPatch | null>(null);
  const [refineAxis, setRefineAxis] = useState<PatchAxis>("u"),
    [refineParameter, setRefineParameter] = useState(0.5);
  const [referenceEdge, setReferenceEdge] = useState<PatchEdge>("u1"),
    [targetEdge, setTargetEdge] = useState<PatchEdge>("u0");
  const [continuity, setContinuity] = useState<"C0" | "C1">("C0"),
    [reverseSeam, setReverseSeam] = useState(false);
  const controlIndex = Math.min(index, (patch?.points.length ?? 1) - 1);
  const run = (task: () => void) => {
    try {
      task();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      onError?.(text);
    }
  };
  const fitScan = async () => {
    if (!scan?.length || fitting.current) return;
    const controller = new AbortController();
    fitting.current = controller;
    setFitBusy(true);
    busyCallback.current?.(true);
    setMessage("Preparing independent scan copy for surface worker…");
    try {
      const result = await fitGridSurfaceAsync(
        scan,
        { countU: u, countV: v, degree, projection, sampleLimit: samples },
        {
          signal: controller.signal,
          onProgress: () =>
            setMessage(
              "Fitting projected control grid in a cancellable worker…",
            ),
        },
      );
      if (controller.signal.aborted) return;
      onPatchChange(result.patch);
      setMessage(
        `${result.samples} samples · projected RMS ${result.rms.toPrecision(4)} mm · maximum ${result.maxError.toPrecision(4)} mm · solver ${(result.solverBytes / 1048576).toFixed(2)} MiB`,
      );
    } catch (error) {
      const text = controller.signal.aborted
        ? "Surface fit cancelled."
        : error instanceof Error
          ? error.message
          : String(error);
      setMessage(text);
      if (!controller.signal.aborted) onError?.(text);
    } finally {
      if (fitting.current === controller) {
        fitting.current = null;
        setFitBusy(false);
        busyCallback.current?.(false);
      }
    }
  };
  const number = (
    label: string,
    value: number,
    update: (value: number) => void,
    min: number,
    max?: number,
  ) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => update(Number(event.target.value))}
      />
    </label>
  );
  return (
    <section
      className="tool-section surface-tools"
      aria-label="Freeform surface tools"
    >
      <h3>Freeform NURBS patch</h3>
      <p className="muted">
        Create or fit an editable tensor grid. Scan fitting uses the selected
        projection as a height field; overhangs and closed bodies need separate
        patches.
      </p>
      {fitBusy && (
        <button onClick={() => fitting.current?.abort()}>
          Cancel surface fit
        </button>
      )}
      <fieldset disabled={disabled || fitBusy}>
        {number("U controls", u, setU, 2, 16)}
        {number("V controls", v, setV, 2, 16)}
        {number("Degree", degree, setDegree, 1, 5)}
        {number("Width (mm)", width, setWidth, 0.001)}
        {number("Height (mm)", height, setHeight, 0.001)}
        <button
          onClick={() =>
            run(() => {
              onPatchChange(createGridPatch(u, v, width, height, degree));
              setMessage("Planar control grid created.");
            })
          }
        >
          Create grid
        </button>
        <label className="field">
          Fit projection
          <select
            value={projection}
            onChange={(event) =>
              setProjection(
                event.target.value as SurfaceFitOptions["projection"],
              )
            }
          >
            <option value="xy">XY → Z</option>
            <option value="xz">XZ → Y</option>
            <option value="yz">YZ → X</option>
          </select>
        </label>
        {number("Fit sample limit", samples, setSamples, 16, 100000)}
        <button disabled={!scan?.length} onClick={() => void fitScan()}>
          Fit selected scan
        </button>
        {patch && (
          <>
            <label className="field">
              Control point
              <select
                value={controlIndex}
                onChange={(event) => setIndex(Number(event.target.value))}
              >
                {patch.points.map((_, i) => (
                  <option key={i} value={i}>
                    U {(i % patch.countU) + 1}, V{" "}
                    {Math.floor(i / patch.countU) + 1}
                  </option>
                ))}
              </select>
            </label>
            {(["X", "Y", "Z"] as const).map((axis, k) => (
              <label className="field" key={axis}>
                {axis} (mm)
                <input
                  type="number"
                  step="any"
                  value={patch.points[controlIndex][k]}
                  onChange={(event) =>
                    run(() => {
                      const point = [...patch.points[controlIndex]] as Vec3;
                      point[k] = Number(event.target.value);
                      onPatchChange(
                        editControlPoint(
                          patch,
                          controlIndex,
                          point,
                          patch.weights[controlIndex],
                        ),
                      );
                    })
                  }
                />
              </label>
            ))}
            <label className="field">
              Rational weight
              <input
                type="number"
                min="0.000001"
                step="any"
                value={patch.weights[controlIndex]}
                onChange={(event) =>
                  run(() =>
                    onPatchChange(
                      editControlPoint(
                        patch,
                        controlIndex,
                        patch.points[controlIndex],
                        Number(event.target.value),
                      ),
                    ),
                  )
                }
              />
            </label>
            <button
              disabled={!scan?.length}
              onClick={() =>
                run(() =>
                  onPatchChange(snapControlPoint(patch, controlIndex, scan!)),
                )
              }
            >
              Snap control to scan
            </button>
            {(["U", "V"] as const).map((axis) => (
              <label className="field" key={axis}>
                {axis} knots
                <input
                  key={JSON.stringify(
                    axis === "U" ? patch.knotsU : patch.knotsV,
                  )}
                  defaultValue={(axis === "U"
                    ? patch.knotsU
                    : patch.knotsV
                  ).join(", ")}
                  onBlur={(event) =>
                    run(() => {
                      const knots = event.target.value
                        .split(",")
                        .map((value) => Number(value.trim()));
                      const next = {
                        ...patch,
                        ...(axis === "U"
                          ? { knotsU: knots }
                          : { knotsV: knots }),
                      };
                      // Validate before handing an edited patch to the caller.
                      serializePatch(next);
                      onPatchChange(next);
                    })
                  }
                />
              </label>
            ))}
            <h4>Exact grid refinement</h4>
            <p className="muted">
              Active grid: {patch.countU} × {patch.countV} controls; U degree{" "}
              {patch.degreeU}, V degree {patch.degreeV}. Maximum 16 controls per
              axis. Insertion preserves the rational surface. Crease preparation
              raises interior knot multiplicity to degree; move the new controls
              to create the crease.
            </p>
            <label className="field">
              Refinement axis
              <select
                value={refineAxis}
                onChange={(event) =>
                  setRefineAxis(event.target.value as PatchAxis)
                }
              >
                <option value="u">U</option>
                <option value="v">V</option>
              </select>
            </label>
            {number(
              "Normalized interior parameter",
              refineParameter,
              setRefineParameter,
              0.000001,
              0.999999,
            )}
            <button
              onClick={() =>
                run(() => {
                  onPatchChange(
                    insertPatchKnot(patch, refineAxis, refineParameter),
                  );
                  setMessage("Knot inserted exactly; surface shape preserved.");
                })
              }
            >
              Insert knot
            </button>
            <button
              onClick={() =>
                run(() => {
                  onPatchChange(
                    preparePatchCrease(patch, refineAxis, refineParameter),
                  );
                  setMessage(
                    "Interior knot raised to degree multiplicity. Shape is preserved until control points move.",
                  );
                })
              }
            >
              Prepare editable crease
            </button>
            {number(
              "Tessellation segments per axis",
              segments,
              setSegments,
              1,
              1024,
            )}
            <p className="muted">
              Output: {2 * segments * segments} triangles; approximately{" "}
              {((segments * segments * 72) / 1048576).toFixed(2)} MiB of
              coordinates.
            </p>
            <button
              onClick={() =>
                run(() =>
                  onCreateMesh(
                    tessellatePatch(patch, segments, segments),
                    "Freeform patch mesh",
                  ),
                )
              }
            >
              Create surface mesh
            </button>
            <button
              onClick={() => run(() => onExportPatch(serializePatch(patch)))}
            >
              Export editable patch JSON
            </button>
            <h4>Join to a reference patch</h4>
            <p className="muted">
              The imported reference stays fixed. Joining moves this patch's
              boundary; C1 also moves its adjacent control row. Seam degree,
              count and normalized knots must match. C1 matches derivatives in
              normalized transverse parameters.
            </p>
            <label className="field">
              Import reference patch JSON
              <input
                type="file"
                accept=".json,.nurbs"
                onChange={async (event) => {
                  const input = event.target,
                    file = input.files?.[0];
                  if (!file) return;
                  try {
                    setReferencePatch(parsePatch(await file.text()));
                    setMessage("Reference patch loaded for seam joining.");
                  } catch (error) {
                    const text =
                      error instanceof Error ? error.message : String(error);
                    setMessage(text);
                    onError?.(text);
                  }
                  input.value = "";
                }}
              />
            </label>
            {referencePatch && (
              <>
                <label className="field">
                  Fixed reference boundary
                  <select
                    value={referenceEdge}
                    onChange={(event) =>
                      setReferenceEdge(event.target.value as PatchEdge)
                    }
                  >
                    {(["u0", "u1", "v0", "v1"] as const).map((edge) => (
                      <option key={edge} value={edge}>
                        {edge.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Active patch boundary
                  <select
                    value={targetEdge}
                    onChange={(event) =>
                      setTargetEdge(event.target.value as PatchEdge)
                    }
                  >
                    {(["u0", "u1", "v0", "v1"] as const).map((edge) => (
                      <option key={edge} value={edge}>
                        {edge.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Continuity
                  <select
                    value={continuity}
                    onChange={(event) =>
                      setContinuity(event.target.value as "C0" | "C1")
                    }
                  >
                    <option value="C0">C0 · shared boundary</option>
                    <option value="C1">
                      C1 · shared boundary and derivative
                    </option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={reverseSeam}
                    onChange={(event) => setReverseSeam(event.target.checked)}
                  />
                  Reverse reference seam direction
                </label>
                <button
                  onClick={() =>
                    run(() => {
                      onPatchChange(
                        joinPatchBoundary(referencePatch, patch, {
                          referenceEdge,
                          targetEdge,
                          continuity,
                          reverse: reverseSeam,
                        }),
                      );
                      setMessage(
                        `${continuity} boundary applied to active patch. Reference remains fixed.`,
                      );
                    })
                  }
                >
                  Apply boundary join
                </button>
                <button
                  onClick={() =>
                    run(() =>
                      onCreateMesh(
                        tessellatePatch(referencePatch, segments, segments),
                        "Reference patch mesh",
                      ),
                    )
                  }
                >
                  Create reference surface mesh
                </button>
                <button onClick={() => setReferencePatch(null)}>
                  Clear reference patch
                </button>
              </>
            )}
          </>
        )}
        <label className="field">
          Import patch JSON or ordered quad OBJ (current U/V dimensions)
          <input
            type="file"
            accept=".json,.nurbs,.obj"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                onPatchChange(
                  file.name.toLowerCase().endsWith(".obj")
                    ? importQuadGridObj(text, u, v, degree)
                    : parsePatch(text),
                );
                setMessage("Editable patch imported.");
              } catch (error) {
                const text =
                  error instanceof Error ? error.message : String(error);
                setMessage(text);
                onError?.(text);
              }
              event.target.value = "";
            }}
          />
        </label>
      </fieldset>
      <p role="status">{message}</p>
    </section>
  );
}
