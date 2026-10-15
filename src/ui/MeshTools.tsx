import { AppSelect } from "./AppSelect";
import { useEffect, useRef, useState } from "react";
import type { ProcessingRequest, ProcessingResult } from "../processing-client";
import type { Entity } from "../types";
import type { RegionClassification } from "../mesh-processing";
import { Field, Panel } from "./controls";
import { alignmentTriangleMask } from "../registration-selection";
import { nativeSurfaceRefinementRequest } from "../native-surface-refinement";
import { parseLandmarkSeedVertices } from "../native-landmark-region";
import { processScanRegistration } from "../scan-registration";

export type MeshTool =
  | "fineAlign"
  | "repairMesh"
  | "segmentMesh"
  | "smoothMesh"
  | "decimateMesh"
  | "globalAlignment"
  | "landmarkAlignment";
export interface MeshToolsProps {
  tool?: MeshTool;
  entities: Entity[];
  selected?: Entity;
  triangleSelection?: Uint8Array | null;
  disabled?: boolean;
  onReplace: (
    positions: Float32Array,
    label: string,
    indexedMesh?: Entity["indexedMesh"],
    cloudPreview?: Entity,
  ) => void;
  onCreateSegments: (
    positions: Float32Array[],
    label: string,
    classifications?: RegionClassification[],
  ) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}
function parseLandmarks(text: string): number[] {
  const lines = text.trim().split(/\r?\n/);
  if (!text.trim() || lines.length < 3)
    throw new Error(
      "Enter at least three corresponding XYZ landmarks per scan.",
    );
  const positions: number[] = [];
  for (const line of lines) {
    const values = line
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (values.length !== 3 || !values.every(Number.isFinite))
      throw new Error(
        "Each landmark line must contain three finite XYZ coordinates.",
      );
    positions.push(...values);
  }
  return positions;
}
/** Heavy processing uses cancellable workers; cloud registration retains native local buffers and pose. */
export function MeshTools({
  tool = "fineAlign",
  entities,
  selected,
  triangleSelection,
  disabled = false,
  onReplace,
  onCreateSegments,
  onError,
  onStatus,
  onBusyChange,
}: MeshToolsProps) {
  const [tolerance, setTolerance] = useState(0.001),
    [planarity, setPlanarity] = useState(0.05),
    [perimeter, setPerimeter] = useState(100);
  const [fillHoles, setFillHoles] = useState(false),
    [splitNonManifold, setSplitNonManifold] = useState(true),
    [iterations, setIterations] = useState(3),
    [strength, setStrength] = useState(0.3),
    [cellSize, setCellSize] = useState(0.5),
    [angle, setAngle] = useState(25);
  const [targetId, setTargetId] = useState(""),
    [surfaceSamples, setSurfaceSamples] = useState(500),
    [distance, setDistance] = useState(10),
    [icpIterations, setIcpIterations] = useState(40);
  const [additionalTargetIds, setAdditionalTargetIds] = useState<string[]>([]);
  const [parallelRefinement, setParallelRefinement] = useState(false);
  const [landmarkSeeds, setLandmarkSeeds] = useState("");
  const [sourceLandmarks, setSourceLandmarks] = useState(""),
    [targetLandmarks, setTargetLandmarks] = useState("");
  const [working, setWorking] = useState(false),
    [progress, setProgress] = useState(""),
    [result, setResult] = useState<ProcessingResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      busyCallback.current?.(false);
    },
    [],
  );
  useEffect(() => {
    controller.current?.abort();
  }, [selected?.id, selected?.positions]);
  useEffect(() => {
    setResult(null);
  }, [selected?.id]);
  const targets = entities.filter(
    (entity) => entity.id !== selected?.id && entity.positions.length >= 9,
  );
  const blocked = disabled || working || !selected;
  const fixedTargets = [
    targets.find((entity) => entity.id === targetId),
    ...additionalTargetIds
      .filter((id) => id !== targetId)
      .map((id) => targets.find((entity) => entity.id === id)),
  ].filter((entity): entity is Entity => !!entity);
  async function run(request: ProcessingRequest, label: string) {
    if (controller.current || !selected) return;
    const cancellation = new AbortController();
    controller.current = cancellation;
    setWorking(true);
    setResult(null);
    setProgress("Starting worker…");
    try {
      busyCallback.current?.(true);
      onStatus(`${label}…`);
      if (
        (request.kind === "paired" ||
          request.kind === "icp" ||
          request.kind === "global") &&
        selected?.kind === "mesh" &&
        request.positions === selected.positions
      )
        request = { ...request, sourceIndexed: selected.indexedMesh };
      const outcome = await processScanRegistration(selected, request, {
        signal: cancellation.signal,
        onProgress: (fraction, stage) =>
          setProgress(`${stage} · ${Math.round(fraction * 100)}%`),
      });
      if (cancellation.signal.aborted) return;
      if (outcome.positions)
        onReplace(
          outcome.positions,
          label,
          outcome.indexedMesh,
          outcome.cloudPreview,
        );
      if (outcome.segments)
        onCreateSegments(
          outcome.segments,
          label,
          outcome.segmentClassifications,
        );
      setResult(outcome);
      if (outcome.refinement && !outcome.refinement.accepted) {
        onStatus("Surface refinement did not converge · geometry unchanged");
        return;
      }
      onStatus(
        `${label} complete${outcome.registration ? ` · RMS ${outcome.registration.rms.toPrecision(4)} mm${outcome.registration.converged ? "" : " · iteration limit reached"}` : ""}`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        onStatus("Mesh operation cancelled; original geometry retained.");
      else onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (controller.current === cancellation) {
        controller.current = null;
        setWorking(false);
        setProgress("");
        busyCallback.current?.(false);
      }
    }
  }
  function paired() {
    if (!selected) return;
    try {
      void run(
        {
          kind: "paired",
          positions: selected.positions,
          sourceLandmarks: parseLandmarks(sourceLandmarks),
          targetLandmarks: parseLandmarks(targetLandmarks),
        },
        "Align paired landmarks",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <Panel
      title={
        {
          fineAlign: "Fine alignment",
          repairMesh: "Repair topology",
          segmentMesh: "Segment surfaces",
          smoothMesh: "Smooth mesh",
          decimateMesh: "Reduce polygons",
          globalAlignment: "Global alignment",
          landmarkAlignment: "Paired landmarks",
        }[tool]
      }
      className="mesh-processing-panel"
    >
      {!selected && (
        <p className="muted">Select a scan to inspect or process.</p>
      )}
      {working && (
        <div role="status">
          <p>{progress}</p>
          <button className="wide" onClick={() => controller.current?.abort()}>
            Cancel mesh operation
          </button>
        </div>
      )}
      <fieldset
        disabled={blocked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {["repairMesh", "segmentMesh", "smoothMesh"].includes(tool) && (
          <>
            <Field
              label="Weld tolerance (mm)"
              value={tolerance}
              onChange={setTolerance}
              min={0.000001}
              step={0.001}
            />
          </>
        )}
        {tool === "repairMesh" && (
          <>
            <button
              className="wide"
              onClick={() =>
                selected &&
                void run(
                  { kind: "report", positions: selected.positions, tolerance },
                  "Inspect mesh topology",
                )
              }
            >
              Inspect topology
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={splitNonManifold}
                onChange={(event) => setSplitNonManifold(event.target.checked)}
              />{" "}
              Split nonmanifold sheets and vertex fans
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={fillHoles}
                onChange={(event) => setFillHoles(event.target.checked)}
              />{" "}
              Fill simple planar boundaries
            </label>
            {fillHoles && (
              <>
                <Field
                  label="Planarity tolerance (mm)"
                  value={planarity}
                  onChange={setPlanarity}
                  min={0.000001}
                  step={0.01}
                />
                <Field
                  label="Maximum hole perimeter (mm)"
                  value={perimeter}
                  onChange={setPerimeter}
                  min={0.001}
                  step={1}
                />
              </>
            )}
            <button
              className="wide"
              onClick={() =>
                selected &&
                void run(
                  {
                    kind: "repair",
                    positions: selected.positions,
                    tolerance,
                    fillHoles,
                    splitNonManifold,
                    planarityTolerance: planarity,
                    maxPerimeter: perimeter,
                  },
                  "Repair mesh topology",
                )
              }
            >
              Repair mesh topology
            </button>
            <p className="muted">
              Ambiguous junctions split into separate objects with unchanged
              coordinates; the source is retained. Planar capping is optional
              and rejects branching, crossing or overlapping flat boundaries.
              Watertight reports describe topology, not a global
              self-intersection certificate. Inspect the result and use Undo
              when needed.
            </p>
          </>
        )}
        {tool === "smoothMesh" && (
          <>
            <Field
              label="Smoothing iterations"
              value={iterations}
              onChange={setIterations}
              min={1}
              step={1}
            />
            <Field
              label="Smoothing strength"
              value={strength}
              onChange={setStrength}
              min={0.01}
              max={1}
              step={0.05}
            />
            <button
              className="wide"
              onClick={() =>
                selected &&
                void run(
                  {
                    kind: "smooth",
                    positions: selected.positions,
                    tolerance,
                    iterations,
                    strength,
                  },
                  "Smooth mesh",
                )
              }
            >
              Smooth with boundaries pinned
            </button>
            <p className="muted">
              Uniform Laplacian smoothing may shrink curved surfaces.
            </p>
          </>
        )}
        {tool === "decimateMesh" && (
          <>
            <Field
              label="Reduction cell size (mm)"
              value={cellSize}
              onChange={setCellSize}
              min={0.000001}
              step={0.1}
            />
            <button
              className="wide"
              onClick={() =>
                selected &&
                void run(
                  { kind: "decimate", positions: selected.positions, cellSize },
                  "Reduce mesh by grid clustering",
                )
              }
            >
              Reduce polygons
            </button>
            <p className="muted">
              Grid clustering reports vertex displacement. It can change
              topology and does not guarantee a target triangle count.
            </p>
          </>
        )}
        {tool === "segmentMesh" && (
          <>
            <Field
              label="Segmentation angle (°)"
              value={angle}
              onChange={setAngle}
              min={0}
              max={180}
              step={1}
            />
            <button
              className="wide"
              onClick={() =>
                selected &&
                void run(
                  {
                    kind: "segment",
                    positions: selected.positions,
                    tolerance,
                    angleDegrees: angle,
                  },
                  "Segment normal-continuous regions",
                )
              }
            >
              Create meshes from automatic segments
            </button>
            <p className="muted">
              Regions grow through shared manifold edges by local normal angle,
              then fit plane, sphere, cylinder and cone candidates. Small or
              unsupported regions remain freeform. Classifications use bounded
              samples and verify residuals on every vertex; they are estimates.
            </p>
          </>
        )}
        {["fineAlign", "globalAlignment"].includes(tool) && (
          <>
            <label className="select-field">
              Registration target
              <AppSelect
                aria-label="Registration target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">Choose another scan</option>
                {targets.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <Field
              label="Alignment search distance (mm)"
              value={distance}
              onChange={setDistance}
              min={0.000001}
              step={1}
            />
          </>
        )}
        {tool === "fineAlign" && (
          <>
            <fieldset>
              <legend>Additional fixed surfaces</legend>
              {targets
                .filter(
                  (entity) =>
                    entity.id !== targetId &&
                    entity.indexedMesh &&
                    !entity.meshSelection?.hidden.length,
                )
                .map((entity) => (
                  <label key={entity.id}>
                    <input
                      type="checkbox"
                      checked={additionalTargetIds.includes(entity.id)}
                      disabled={
                        blocked ||
                        (!additionalTargetIds.includes(entity.id) &&
                          additionalTargetIds.length >= 31)
                      }
                      onChange={(event) =>
                        setAdditionalTargetIds((ids) =>
                          event.target.checked
                            ? [...ids, entity.id]
                            : ids.filter((id) => id !== entity.id),
                        )
                      }
                    />
                    {entity.name}
                  </label>
                ))}
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={parallelRefinement}
                disabled={blocked}
                onChange={(event) =>
                  setParallelRefinement(event.target.checked)
                }
              />
              Use multiple CPU cores
            </label>
            <details>
              <summary>Landmark refinement region</summary>
              <label>
                Source seed vertex IDs
                <input
                  value={landmarkSeeds}
                  disabled={blocked}
                  onChange={(event) => setLandmarkSeeds(event.target.value)}
                  placeholder="Optional, e.g. 0, 15, 42"
                />
              </label>
              <p>
                Refine around these indexed vertices using the grown region. All
                region vertices participate; the whole scan moves.
              </p>
            </details>
            {!landmarkSeeds.trim() && (
              <Field
                label="Surface refinement samples"
                value={surfaceSamples}
                onChange={setSurfaceSamples}
                min={1}
                step={1}
              />
            )}
            <Field
              label="ICP maximum iterations"
              value={icpIterations}
              onChange={setIcpIterations}
              min={1}
              step={1}
            />
            <button
              className="wide"
              disabled={
                !selected?.indexedMesh ||
                !!selected.meshSelection?.hidden.length ||
                fixedTargets.some(
                  (entity) =>
                    !entity.indexedMesh ||
                    !!entity.meshSelection?.hidden.length,
                ) ||
                !!targets.find((entity) => entity.id === targetId)
                  ?.meshSelection?.hidden.length ||
                !targets.find((entity) => entity.id === targetId)?.indexedMesh
              }
              onClick={() => {
                const target = targets.find((entity) => entity.id === targetId);
                if (selected && target)
                  try {
                    void run(
                      nativeSurfaceRefinementRequest(
                        selected,
                        fixedTargets,
                        surfaceSamples,
                        distance,
                        triangleSelection?.some(Boolean)
                          ? triangleSelection
                          : undefined,
                        parallelRefinement ? 2 : 1,
                        true,
                        parseLandmarkSeedVertices(landmarkSeeds),
                      ),
                      "Surface refinement",
                    );
                  } catch (error) {
                    onError(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
              }}
            >
              Refine indexed mesh surfaces
            </button>
          </>
        )}
        {tool === "fineAlign" && (
          <>
            <button
              className="wide"
              disabled={!targets.some((entity) => entity.id === targetId)}
              onClick={() => {
                const target = targets.find((entity) => entity.id === targetId);
                if (selected && target)
                  void run(
                    {
                      kind: "icp",
                      positions: selected.positions,
                      sourceTriangleMask:
                        selected.kind === "pointcloud"
                          ? undefined
                          : alignmentTriangleMask(
                              selected.positions.length / 9,
                              triangleSelection,
                              selected.meshSelection?.hidden,
                            ),
                      target: target.positions,
                      maxDistance: distance,
                      maxIterations: icpIterations,
                      sampleSize: 4000,
                      targetSampleSize: 20000,
                      tolerance: 0.00001,
                      trimFraction: 0.85,
                    },
                    "Fine align scans with sampled ICP",
                  );
              }}
            >
              Fine align with sampled ICP
            </button>
            <p className="muted">
              {selected?.kind === "pointcloud"
                ? "All points drive alignment; the whole cloud moves. "
                : triangleSelection?.some((value) => value !== 0)
                  ? "Selected visible triangles drive fine alignment; the whole scan moves. "
                  : "Visible triangles drive fine alignment; the whole scan moves. "}
              ICP uses up to 4,000 source and 20,000 target samples. Start from
              approximate alignment; symmetric geometry can settle into an
              incorrect local match.
            </p>
          </>
        )}
        {tool === "globalAlignment" && (
          <>
            <button
              className="wide"
              disabled={!targets.some((entity) => entity.id === targetId)}
              onClick={() => {
                const target = targets.find((entity) => entity.id === targetId);
                if (selected && target)
                  void run(
                    {
                      kind: "global",
                      positions: selected.positions,
                      target: target.positions,
                      maxDistance: distance,
                      maxIterations: icpIterations,
                      sampleSize: 4000,
                      targetSampleSize: 20000,
                      tolerance: 0.00001,
                      trimFraction: 0.85,
                    },
                    "Globally initialize and align scans",
                  );
              }}
            >
              Global coarse alignment + ICP
            </button>
            <p className="muted">
              Global initialization scores 24 proper principal-axis poses,
              refines the best four, then runs sampled ICP. Symmetric shapes,
              repeated patterns and partial overlap can produce a wrong pose;
              inspect the result or use paired landmarks.
            </p>
          </>
        )}
        {tool === "landmarkAlignment" && (
          <>
            <label className="sketch-input">
              Source landmarks (world XYZ mm)
              <textarea
                aria-label="Source registration landmarks"
                rows={4}
                value={sourceLandmarks}
                spellCheck={false}
                placeholder={"0,0,0\n10,0,0\n0,10,0"}
                onChange={(event) => setSourceLandmarks(event.target.value)}
              />
            </label>
            <label className="sketch-input">
              Corresponding target landmarks (world XYZ mm)
              <textarea
                aria-label="Target registration landmarks"
                rows={4}
                value={targetLandmarks}
                spellCheck={false}
                placeholder={"5,0,0\n15,0,0\n5,10,0"}
                onChange={(event) => setTargetLandmarks(event.target.value)}
              />
            </label>
            <button className="wide" onClick={paired}>
              Align paired landmarks
            </button>
          </>
        )}
      </fieldset>
      {result && (
        <div role="status" aria-label="Mesh operation result">
          <h4>Result</h4>
          {result.topology && (
            <dl>
              {Object.entries(result.topology).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd>{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
          {Object.entries(result.diagnostics)
            .filter(
              ([key]) =>
                !["pointCloudPose", "localBuffersRetained"].includes(key),
            )
            .map(([key, value]) => (
              <p key={key}>
                {key.replace(/([A-Z])/g, " $1")}: {String(value)}
              </p>
            ))}
          {result.segmentClassifications?.map((classification, index) => (
            <p key={index}>
              Region {index + 1}:{" "}
              {classification.kind === "freeform"
                ? "unclassified / freeform"
                : classification.kind}{" "}
              · {classification.samples} samples
              {classification.rms !== undefined
                ? ` · RMS ${classification.rms.toPrecision(4)} mm · max ${classification.maxError?.toPrecision(4)} mm`
                : ""}{" "}
              · tolerance {classification.tolerance.toPrecision(4)} mm ·{" "}
              {classification.reason}
            </p>
          ))}
          {result.repairSheets?.map((sheet, index) => (
            <p key={`sheet-${index}`}>
              Sheet {index + 1}: {sheet.triangles.toLocaleString()} triangles ·{" "}
              {sheet.watertight
                ? "watertight topology"
                : `${sheet.boundaryEdges} boundary edges`}{" "}
              · {sheet.nonManifoldEdges} nonmanifold edges ·{" "}
              {sheet.nonManifoldVertices} nonmanifold vertices
            </p>
          ))}
        </div>
      )}
      <p className="muted">Cancel releases the operation worker immediately.</p>
    </Panel>
  );
}
