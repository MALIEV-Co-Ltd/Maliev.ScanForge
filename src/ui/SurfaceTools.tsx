import { AppSelect } from "./AppSelect";
import { useEffect, useRef, useState } from "react";
import type { Positions, Vec3 } from "../types";
import {
  createGridPatch,
  editControlPoint,
  importQuadGridObj,
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
  type PatchJoinOptions,
  createBoxPatchShell,
  assemblePatchShell,
  type PatchShellResult,
} from "../surfaces";
import { fitGridSurfaceAsync } from "../surface-client";
import { CadJobCancel } from "./CadJobCancel";

export interface SurfaceToolsProps {
  selectionId?: string;
  scan?: Positions;
  patch?: NurbsPatch;
  onPatchChange: (patch: NurbsPatch) => void;
  onJoin: (
    reference: NurbsPatch,
    options: PatchJoinOptions,
    signal: AbortSignal,
  ) => Promise<unknown>;
  active?: boolean;
  onCreateMesh: (positions: Float32Array, name: string) => void;
  onExportPatch: (json: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCreateClosedCad?: (patches: NurbsPatch[], tolerance: number) => void;
}

/** The caller owns patch persistence and scene insertion; this panel keeps no hidden geometry. */
export function SurfaceTools({
  selectionId,
  scan,
  patch,
  onPatchChange,
  onJoin,
  active = true,
  onCreateMesh,
  onExportPatch,
  onError,
  disabled,
  onBusyChange,
  onCreateClosedCad,
}: SurfaceToolsProps) {
  const fitting = useRef<AbortController | null>(null);
  const joining = useRef<AbortController | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  useEffect(() => {
    setJoinBusy(false);
    return () => {
      const run = joining.current;
      joining.current = null;
      run?.abort();
    };
  }, [selectionId, active]);
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
  const [shellPatches, setShellPatches] = useState<NurbsPatch[]>([]),
    [shellIndex, setShellIndex] = useState<number | null>(null);
  const [shellDepth, setShellDepth] = useState(50),
    [shellSegments, setShellSegments] = useState(16),
    [shellTolerance, setShellTolerance] = useState(0.01),
    [shellBudget, setShellBudget] = useState(200000);
  const [shellAssembly, setShellAssembly] = useState<{
    result: PatchShellResult;
    patches: NurbsPatch[];
    tolerance: number;
    segments: number;
  } | null>(null);
  const shellSelection = useRef(selectionId);
  useEffect(() => {
    if (shellSelection.current !== selectionId) {
      shellSelection.current = selectionId;
      setShellIndex(null);
      return;
    }
    if (!patch || shellIndex === null) return;
    setShellPatches((previous) =>
      previous[shellIndex] === patch
        ? previous
        : previous.map((value, i) => (i === shellIndex ? patch : value)),
    );
  }, [patch, shellIndex, selectionId]);
  const currentAssembly =
    shellAssembly?.patches === shellPatches &&
    shellAssembly.tolerance === shellTolerance &&
    shellAssembly.segments === shellSegments
      ? shellAssembly.result
      : null;
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
  async function join() {
    if (!referencePatch || !patch || joinBusy || !active) return;
    const controller = new AbortController();
    joining.current = controller;
    setJoinBusy(true);
    setMessage("Joining compatible patch boundaries…");
    try {
      await onJoin(
        referencePatch,
        { referenceEdge, targetEdge, continuity, reverse: reverseSeam },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setMessage(
          `${continuity} boundary applied to active patch. Reference remains fixed.`,
        );
    } catch (error) {
      if (controller.signal.aborted) {
        if (joining.current === controller)
          setMessage("Surface join cancellation requested.");
      } else {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(text);
        onError?.(text);
      }
    } finally {
      if (joining.current === controller) {
        joining.current = null;
        setJoinBusy(false);
      }
    }
  }
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
      <fieldset disabled={disabled || fitBusy || joinBusy}>
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
          <AppSelect
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
          </AppSelect>
        </label>
        {number("Fit sample limit", samples, setSamples, 16, 100000)}
        <button disabled={!scan?.length} onClick={() => void fitScan()}>
          Fit selected scan
        </button>
        {patch && (
          <>
            <label className="field">
              Control point
              <AppSelect
                value={controlIndex}
                onChange={(event) => setIndex(Number(event.target.value))}
              >
                {patch.points.map((_, i) => (
                  <option key={i} value={i}>
                    U {(i % patch.countU) + 1}, V{" "}
                    {Math.floor(i / patch.countU) + 1}
                  </option>
                ))}
              </AppSelect>
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
              <AppSelect
                value={refineAxis}
                onChange={(event) =>
                  setRefineAxis(event.target.value as PatchAxis)
                }
              >
                <option value="u">U</option>
                <option value="v">V</option>
              </AppSelect>
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
              Output size depends on sampling density and knot discontinuities.
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
                  <AppSelect
                    value={referenceEdge}
                    aria-label="Fixed reference boundary"
                    onChange={(event) =>
                      setReferenceEdge(event.target.value as PatchEdge)
                    }
                  >
                    {(["u0", "u1", "v0", "v1"] as const).map((edge) => (
                      <option key={edge} value={edge}>
                        {edge.toUpperCase()}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="field">
                  Active patch boundary
                  <AppSelect
                    value={targetEdge}
                    aria-label="Active patch boundary"
                    onChange={(event) =>
                      setTargetEdge(event.target.value as PatchEdge)
                    }
                  >
                    {(["u0", "u1", "v0", "v1"] as const).map((edge) => (
                      <option key={edge} value={edge}>
                        {edge.toUpperCase()}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="field">
                  Continuity
                  <AppSelect
                    value={continuity}
                    aria-label="Join continuity"
                    onChange={(event) =>
                      setContinuity(event.target.value as "C0" | "C1")
                    }
                  >
                    <option value="C0">C0 · shared boundary</option>
                    <option value="C1">
                      C1 · shared boundary and derivative
                    </option>
                  </AppSelect>
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
                  disabled={disabled || joinBusy}
                  onClick={() => void join()}
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
        <h4>Closed patch shell</h4>
        <p className="muted">
          Assemble authored patches with matching seams into a welded manifold
          mesh. Edge and vertex diagnostics verify topology; geometric
          self-intersections and nested cavities require separate validation.
          This does not automatically recover closed scans.
        </p>
        {number("Seed depth (mm)", shellDepth, setShellDepth, 0.001)}
        <button
          onClick={() =>
            run(() => {
              const faces = createBoxPatchShell(width, height, shellDepth);
              setShellPatches(faces);
              setShellIndex(0);
              onPatchChange(faces[0]);
              setMessage(
                "Six editable box-shell patches created. Select a shell patch to edit its grid.",
              );
            })
          }
        >
          Create six-patch box shell
        </button>
        <label className="field">
          Import shell patches (individual JSON files)
          <input
            type="file"
            accept=".json,.nurbs"
            multiple
            onChange={async (event) => {
              const input = event.target,
                files = Array.from(input.files ?? []);
              if (!files.length) return;
              try {
                const imported: NurbsPatch[] = [];
                for (const file of files)
                  imported.push(parsePatch(await file.text()));
                setShellPatches(imported);
                setShellIndex(0);
                onPatchChange(imported[0]);
                setMessage(`${imported.length} shell patches imported.`);
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
        <button
          disabled={!patch}
          onClick={() => {
            if (!patch) return;
            setShellPatches((previous) => [...previous, patch]);
            setShellIndex(null);
          }}
        >
          Add active patch to shell
        </button>
        {shellPatches.length > 0 && (
          <>
            <label className="field">
              Edit shell patch
              <AppSelect
                value={shellIndex ?? ""}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setShellIndex(index);
                  onPatchChange(shellPatches[index]);
                }}
              >
                <option value="" disabled>
                  Select patch
                </option>
                {shellPatches.map((face, index) => (
                  <option key={index} value={index}>
                    Patch {index + 1} · {face.countU} × {face.countV}
                  </option>
                ))}
              </AppSelect>
            </label>
            <button
              disabled={shellIndex === null}
              onClick={() => {
                setShellPatches((previous) =>
                  previous.filter((_, i) => i !== shellIndex),
                );
                setShellIndex(null);
              }}
            >
              Remove selected shell patch
            </button>
            {number(
              "Shell tessellation segments per axis",
              shellSegments,
              setShellSegments,
              1,
              128,
            )}
            {number(
              "Seam weld tolerance (mm)",
              shellTolerance,
              setShellTolerance,
              0.000001,
            )}
            {number(
              "Shell triangle operation budget",
              shellBudget,
              setShellBudget,
              1,
              2000000,
            )}
            <p className="muted">
              {shellPatches.length} patches. Validate and assemble to inspect
              triangle counts and topology. Matching patch seams must have
              matching sample locations within tolerance.
            </p>
            <button
              onClick={() =>
                run(() => {
                  const result = assemblePatchShell(shellPatches, {
                    segments: shellSegments,
                    weldTolerance: shellTolerance,
                    triangleBudget: shellBudget,
                  });
                  setShellAssembly({
                    result,
                    patches: shellPatches,
                    tolerance: shellTolerance,
                    segments: shellSegments,
                  });
                  setMessage(
                    result.diagnostics.closed
                      ? "Shell is topologically closed and consistently oriented."
                      : "Shell remains open or nonmanifold. Inspect diagnostics and repair the patch seams.",
                  );
                })
              }
            >
              Validate and assemble shell
            </button>
            {currentAssembly && (
              <>
                <p role="status">
                  {currentAssembly.diagnostics.closed
                    ? "Closed manifold"
                    : "Open / invalid shell"}{" "}
                  · {currentAssembly.diagnostics.components} components ·{" "}
                  {currentAssembly.diagnostics.triangles} triangles ·{" "}
                  {currentAssembly.diagnostics.boundaryEdges} boundary edges ·{" "}
                  {currentAssembly.diagnostics.nonManifoldEdges} nonmanifold
                  edges · {currentAssembly.diagnostics.nonManifoldVertices}{" "}
                  nonmanifold vertices ·{" "}
                  {currentAssembly.diagnostics.inconsistentEdges} orientation
                  conflicts · {currentAssembly.diagnostics.duplicateTriangles}{" "}
                  duplicate faces ·{" "}
                  {currentAssembly.diagnostics.degenerateTriangles} degenerate
                  faces removed
                  {currentAssembly.diagnostics.signedVolume === null
                    ? ""
                    : ` · volume ${currentAssembly.diagnostics.signedVolume.toPrecision(6)} mm³`}
                </p>
                <button
                  onClick={() =>
                    onCreateMesh(
                      currentAssembly.positions,
                      currentAssembly.diagnostics.closed
                        ? "Closed patch shell mesh"
                        : "Open patch shell mesh",
                    )
                  }
                >
                  Create assembled mesh
                </button>
                {onCreateClosedCad && (
                  <button
                    disabled={
                      !currentAssembly.diagnostics.closed ||
                      currentAssembly.diagnostics.components !== 1 ||
                      !(currentAssembly.diagnostics.signedVolume! > 0)
                    }
                    onClick={() =>
                      run(() => onCreateClosedCad(shellPatches, shellTolerance))
                    }
                  >
                    Create closed CAD solid
                  </button>
                )}
                <p className="muted">
                  Exact CAD conversion independently sews and validates the
                  original patches. A closed display mesh alone does not prove a
                  valid CAD solid.
                </p>
              </>
            )}
          </>
        )}
      </fieldset>
      {joinBusy && active && (
        <CadJobCancel
          label="Cancel surface join"
          onCancel={() => joining.current?.abort()}
        />
      )}
      <p role="status">{message}</p>
    </section>
  );
}
