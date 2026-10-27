import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { Entity, Vec3 } from "../types";
import {
  referenceLineEnd,
  decodeReferenceGeometry,
} from "../reference-construction-values";
import { VectorField } from "./controls";
import { AppSelect } from "./AppSelect";
import { isStoredReferenceLine } from "../reference-midpoint";
import { ReferenceCadCoordinateDialog } from "./ReferenceCadCoordinateDialog";

export interface PickedReferenceCoordinate {
  entityId: string;
  pointIndex?: number;
  acquisitionJobId?: string;
  position: Vec3;
  revision: number;
}

export function ReferenceConstructionDialog({
  api,
  kind,
  finiteAxis = false,
  entity,
  entities = [],
  pickCoordinate,
  onClose,
}: {
  api: ApplicationApi;
  kind: "point" | "line";
  finiteAxis?: boolean;
  entity?: Entity;
  entities?: Entity[];
  pickCoordinate?(
    signal: AbortSignal,
    mode?: "cloud" | "surface",
    targetEntityId?: string,
  ): Promise<PickedReferenceCoordinate>;
  onClose(): void;
}) {
  const geometry = entity?.reference?.geometry;
  const definition = entity?.reference?.definition;
  type PointMode =
    "coordinates" | "midpoint" | "center" | "pair" | "threePlanes";
  type LineMode = "endpoints" | "pair" | "average";
  const [lineMode, setLineMode] = useState<LineMode>(
    definition?.kind === "line" ? definition.mode : "endpoints",
  );
  const [linePicksChanged, setLinePicksChanged] = useState(false);
  const [sourceParameters, setSourceParameters] = useState<
    (number | undefined)[]
  >([]);
  const [sourceObjectSelections, setSourceObjectSelections] = useState<
    boolean[]
  >([]);
  const [retainedIndices, setRetainedIndices] = useState<
    (number | undefined)[]
  >(() =>
    definition?.kind === "line" && definition.mode !== "endpoints"
      ? definition.records.map((_, index) => index)
      : [],
  );
  const [sourcePlaneUV, setSourcePlaneUV] = useState<
    ([number | undefined, number | undefined] | undefined)[]
  >([]);
  type SourceOption = {
    entityId: string;
    name: string;
    eligible: boolean;
    reason?: string;
    primitiveKind?: string;
    objectSelection?: boolean;
    planeUVBounds?: {
      min: [number, number];
      max: [number, number];
      units: "mm";
    };
  };
  const legacySources = entities.filter(isStoredReferenceLine);
  const [pointMode, setPointMode] = useState<PointMode>(() => {
    if (definition?.kind !== "point") return "coordinates";
    if (
      definition.mode === "center" &&
      definition.sources.length === 1 &&
      legacySources.some((source) => source.id === definition.sources[0].id)
    )
      return "midpoint";
    return definition.mode;
  });
  const derived =
    kind === "point" ? pointMode !== "coordinates" : lineMode !== "endpoints";
  const [sourceIds, setSourceIds] = useState<string[]>(() =>
    definition?.kind === "point" && definition.mode !== "coordinates"
      ? definition.sources.map((source) => source.id)
      : definition?.kind === "line" && definition.records.length
        ? definition.records.map((record) => record.entityId)
        : kind === "line"
          ? ["", ""]
          : [legacySources[0]?.id ?? ""],
  );
  const [sourcePage, setSourcePage] = useState<{
    sources: SourceOption[];
    nextOffset: number | null;
    revision: number;
  }>();
  const [offset, setOffset] = useState(0);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [draftRevision] = useState(() => api.currentRevision());
  useEffect(() => {
    if (
      kind === "point" ? pointMode === "coordinates" : lineMode === "endpoints"
    )
      return;
    let disposed = false;
    setLoadingSources(true);
    setSourceError("");
    void api
      .invoke("reference_construction_sources", {
        kind,
        mode: kind === "point" ? pointMode : lineMode,
        offset,
        limit: 100,
        ...(entity ? { entityId: entity.id } : {}),
      })
      .then((receipt) => {
        if (disposed) return;
        if (!receipt.ok) throw new Error(receipt.error.message);
        if (receipt.revision !== draftRevision)
          throw new Error(
            "The workspace changed. Reopen this editor before choosing sources.",
          );
        const page = receipt.result as {
          sources: SourceOption[];
          nextOffset: number | null;
        };
        setSourcePage((previous) => ({
          sources: offset
            ? [...(previous?.sources ?? []), ...page.sources]
            : page.sources,
          nextOffset: page.nextOffset,
          revision: receipt.revision,
        }));
      })
      .catch((failure) => {
        if (!disposed)
          setSourceError(
            failure instanceof Error ? failure.message : String(failure),
          );
      })
      .finally(() => {
        if (!disposed) setLoadingSources(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, kind, pointMode, lineMode, offset, entity?.id, draftRevision]);
  const sourceCount =
    kind === "point" && pointMode === "midpoint"
      ? 1
      : Math.max(
          kind === "point" && pointMode === "threePlanes" ? 3 : 2,
          sourceIds.length,
        );
  const retainedSources = [...new Set(sourceIds)]
    .filter(Boolean)
    .filter(
      (id) => !sourcePage?.sources.some((source) => source.entityId === id),
    );
  const sourceOptions = sourcePage?.sources ?? [];
  const [start, setStart] = useState<Vec3>(() =>
    geometry?.kind === "point"
      ? [...geometry.position]
      : geometry
        ? [...geometry.start]
        : [0, 0, 0],
  );
  const [end, setEnd] = useState<Vec3>(() =>
    geometry?.kind === "line" ? [...referenceLineEnd(geometry)] : [10, 0, 0],
  );
  const [startPick, setStartPick] = useState<PickedReferenceCoordinate>();
  const [endPick, setEndPick] = useState<PickedReferenceCoordinate>();
  const [cadTarget, setCadTarget] = useState<"start" | "end">();
  const [initializing, setInitializing] = useState(!!entity);
  const [initializationError, setInitializationError] = useState("");
  const [useInitializedFields, setUseInitializedFields] = useState(
    !!entity &&
      (definition?.mode === "coordinates" || definition?.mode === "endpoints"),
  );
  useEffect(() => {
    if (!entity) return;
    let disposed = false;
    void api
      .invoke("object_get", { entityId: entity.id })
      .then((receipt) => {
        if (disposed) return;
        if (!receipt.ok) throw Error(receipt.error.message);
        if (receipt.revision !== draftRevision)
          throw Error("The workspace changed. Reopen this editor.");
        const reference = (
          receipt.result as {
            reference: {
              editorInputs?: ReturnType<
                typeof import("../reference-numeric-edit-fields").referenceNumericEditFields
              >;
              editorInputsError?: string;
            };
          }
        ).reference;
        if (reference.editorInputsError)
          throw Error(reference.editorInputsError);
        const fields = reference.editorInputs;
        if (!fields || fields.kind !== kind)
          throw Error("Numeric editor inputs are unavailable.");
        const position = (
          encoding: Parameters<typeof decodeReferenceGeometry>[0],
        ): Vec3 => {
          const geometry = decodeReferenceGeometry(encoding);
          if (geometry.kind !== "point")
            throw Error("Invalid numeric editor coordinate encoding.");
          return [...geometry.position];
        };
        if (fields.kind === "point")
          setStart(position(fields.positionEncoding));
        else {
          setStart(position(fields.startEncoding));
          setEnd(position(fields.endEncoding));
        }
      })
      .catch((failure) => {
        if (!disposed)
          setInitializationError(
            failure instanceof Error ? failure.message : String(failure),
          );
      })
      .finally(() => {
        if (!disposed) setInitializing(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, entity?.id, kind, draftRevision]);
  const [session, setSession] = useState<{
    sessionId: string;
    version: number;
  }>();
  const [previewOutcome, setPreviewOutcome] = useState("");
  const [dirty, setDirty] = useState(true),
    [busy, setBusy] = useState(false),
    [closing, setClosing] = useState(false),
    [error, setError] = useState("");
  const activePick = useRef<AbortController | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  useEffect(
    () => () => {
      activePick.current?.abort();
      activePick.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (!picking) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        activePick.current?.abort();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [picking]);
  async function acquireCoordinate(target: "start" | "end") {
    if (!pickCoordinate || busy || closing) return;
    const controller = new AbortController();
    activePick.current = controller;
    setPicking(true);
    setError("");
    try {
      const value = await pickCoordinate(controller.signal);
      if (controller.signal.aborted || activePick.current !== controller)
        return;
      (target === "start" ? setStart : setEnd)(value.position);
      (target === "start" ? setStartPick : setEndPick)(value);
      setUseInitializedFields(false);
      setInitializationError("");
      setDirty(true);
    } catch (failure) {
      if (!controller.signal.aborted && activePick.current === controller)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (activePick.current === controller) {
        activePick.current = undefined;
        setPicking(false);
      }
    }
  }
  async function command(action: "preview" | "apply" | "cancel") {
    if (action === "cancel" && !session) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      let owner = session;
      if (owner && action !== "apply") {
        const receipt = await api.invoke("reference_construction_get", {});
        if (!receipt.ok) throw new Error(receipt.error.message);
        const current = receipt.result as {
          active: boolean;
          sessionId?: string;
          version?: number;
          cleanupPending?: boolean;
        };
        if (
          current.sessionId !== owner.sessionId ||
          (!current.active && !current.cleanupPending)
        ) {
          owner = undefined;
          setSession(undefined);
          setClosing(false);
          if (action === "cancel") {
            onClose();
            return;
          }
          if (
            kind === "line" &&
            lineMode !== "endpoints" &&
            retainedIndices.some((index) => index !== undefined)
          ) {
            setRetainedIndices([]);
            setSourceObjectSelections([]);
            setSourceParameters([]);
            setSourcePlaneUV([]);
            setLinePicksChanged(true);
            throw new Error(
              "The preview expired or changed. Choose each source again before previewing.",
            );
          }
        } else if (action === "cancel" && current.version !== undefined) {
          owner = { sessionId: owner.sessionId, version: current.version };
        } else if (current.cleanupPending) {
          setClosing(true);
          throw new Error(
            "The preview could not be closed. Retry closing it before continuing.",
          );
        }
      }
      const picks =
        kind === "line" && lineMode === "endpoints"
          ? [startPick, endPick].filter(Boolean)
          : kind === "point" && pointMode === "coordinates" && startPick
            ? [startPick]
            : [];
      if (
        action === "preview" &&
        picks.some(
          (pick) =>
            pick!.revision !== picks[0]!.revision ||
            (entity && pick!.revision !== draftRevision),
        )
      )
        throw new Error(
          "The workspace changed. Pick the coordinates again before previewing.",
        );
      const selection = (pick: PickedReferenceCoordinate) =>
        pick.acquisitionJobId !== undefined
          ? { acquisitionJobId: pick.acquisitionJobId }
          : { entityId: pick.entityId, pointIndex: pick.pointIndex };
      const result = await api.invoke("reference_construct", {
        action,
        ...owner,
        ...(action === "preview"
          ? {
              kind,
              ...(entity && useInitializedFields && !derived
                ? { initialize: true }
                : kind === "point"
                  ? pointMode === "midpoint"
                    ? { mode: "midpoint", sourceEntityId: sourceIds[0] }
                    : pointMode === "coordinates"
                      ? startPick
                        ? { positionPick: selection(startPick) }
                        : { position: start }
                      : {
                          mode: pointMode,
                          sourceEntityIds: sourceIds.filter(Boolean),
                        }
                  : lineMode !== "endpoints"
                    ? {
                        mode: lineMode,
                        ...(linePicksChanged ||
                        !(
                          definition?.kind === "line" &&
                          definition.records.length
                        )
                          ? {
                              sourcePicks: sourceIds.map((entityId, index) => ({
                                entityId,
                                ...(retainedIndices[index] !== undefined
                                  ? { retainedIndex: retainedIndices[index] }
                                  : sourceOptions.find(
                                        (row) => row.entityId === entityId,
                                      )?.primitiveKind === "plane"
                                    ? { planeUV: sourcePlaneUV[index] ?? [] }
                                    : lineMode === "pair" &&
                                        sourceObjectSelections[index]
                                      ? { selection: "object" }
                                      : sourceParameters[index] === undefined
                                        ? {}
                                        : {
                                            parameter: sourceParameters[index],
                                          }),
                              })),
                            }
                          : {}),
                      }
                    : {
                        ...(startPick
                          ? { startPick: selection(startPick) }
                          : { start }),
                        ...(endPick
                          ? { endPick: selection(endPick) }
                          : { end }),
                      }),
              ...(!owner && entity ? { entityId: entity.id } : {}),
              ...(!owner && !entity && finiteAxis
                ? { name: "Reference axis" }
                : {}),
            }
          : {}),
        expectedRevision:
          action === "cancel"
            ? api.currentRevision()
            : entity
              ? draftRevision
              : action === "preview" && picks.length
                ? picks[0]!.revision
                : api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.error.message);
      if (action === "preview") {
        const {
          sessionId,
          version,
          outcome,
          diagnostics,
          definition: previewDefinition,
        } = result.result as {
          sessionId: string;
          version: number;
          outcome?: string;
          diagnostics?: { reason?: string };
          definition?: typeof definition;
        };
        setSession({ sessionId, version });
        setRetainedIndices(
          previewDefinition?.kind === "line" &&
            previewDefinition.mode !== "endpoints"
            ? previewDefinition.records.map((_, index) => index)
            : [],
        );
        setDirty(false);
        setPreviewOutcome(
          outcome === "unchanged"
            ? "Previous geometry retained."
            : outcome === "fallback"
              ? "Fallback geometry; review before applying."
              : diagnostics?.reason === "average-prior-extent"
                ? "Updated; prior extent retained."
                : "Updated.",
        );
      } else if (
        action === "apply" &&
        (result.result as { cleanupPending?: boolean }).cleanupPending
      ) {
        setClosing(true);
        setDirty(true);
        setError(
          "The reference was applied, but its preview could not be closed. Retry closing the preview.",
        );
      } else onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  if (cadTarget)
    return (
      <ReferenceCadCoordinateDialog
        api={api}
        entities={entities}
        pickSurface={
          pickCoordinate
            ? (signal, sourceId) => pickCoordinate(signal, "surface", sourceId)
            : undefined
        }
        onPick={(value) => {
          (cadTarget === "start" ? setStart : setEnd)(value.position);
          (cadTarget === "start" ? setStartPick : setEndPick)(value);
          setUseInitializedFields(false);
          setInitializationError("");
          setDirty(true);
          setCadTarget(undefined);
        }}
        onCancel={() => setCadTarget(undefined)}
      />
    );
  if (picking)
    return (
      <section
        className="modal"
        data-reference-coordinate-pick="true"
        role="dialog"
        aria-label="Pick reference coordinate"
        style={{ position: "fixed", right: 16, top: 160, zIndex: 60 }}
      >
        <h2>Pick reference coordinate</h2>
        <p>
          Click a visible, unlocked point-cloud vertex. The coordinate is copied
          into this form.
        </p>
        <button autoFocus onClick={() => activePick.current?.abort()}>
          Cancel picking
        </button>
      </section>
    );
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          finiteAxis ? "Reference axis (finite)" : `Reference ${kind}`
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            void command("cancel");
          }
        }}
      >
        <div className="modal-title">
          <h2>
            {entity ? "Edit" : "Create"} reference{" "}
            {finiteAxis ? "axis (finite)" : kind}
          </h2>
        </div>
        <p>
          {finiteAxis
            ? "A finite directed line in world millimeters. Its start and end define the axis direction and extent."
            : "World coordinates in millimeters."}
        </p>
        <fieldset
          disabled={busy || closing || initializing}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {kind === "point" && (
            <label className="select-field">
              Point construction
              <AppSelect
                value={pointMode}
                onChange={(event) => {
                  setPointMode(event.target.value as PointMode);
                  setOffset(0);
                  setSourcePage(undefined);
                  setDirty(true);
                }}
              >
                <option value="coordinates">Coordinates</option>
                <option value="midpoint">Line midpoint</option>
                <option value="center">Primitive center</option>
                <option value="pair">Two primitives</option>
                <option value="threePlanes">Three planes</option>
              </AppSelect>
            </label>
          )}
          {kind === "line" && (
            <label className="select-field">
              Line construction
              <AppSelect
                value={lineMode}
                disabled={busy || closing}
                onChange={(event) => {
                  setLineMode(event.target.value as LineMode);
                  setOffset(0);
                  setSourcePage(undefined);
                  setDirty(true);
                }}
              >
                <option value="endpoints">Endpoints</option>
                <option value="pair" disabled={!entity && !session}>
                  Two primitives
                </option>
                <option value="average" disabled={!entity && !session}>
                  Average lines
                </option>
              </AppSelect>
              {!entity && !session && (
                <span>
                  Preview explicit endpoints before choosing a derived line.
                </span>
              )}
            </label>
          )}
          {derived ? (
            <>
              {kind === "line" && linePicksChanged && (
                <p>
                  Choose a position from 0 to 1 for each selected line, select
                  an eligible source object, or use local U/V millimetres within
                  the authored plane extent. Accepted picks keep their world
                  coordinates when sources change.
                </p>
              )}
              {Array.from({ length: sourceCount }, (_, index) => (
                <div key={index}>
                  <label className="select-field">
                    {kind === "point" && pointMode === "midpoint"
                      ? "Source line"
                      : `Source ${index + 1}`}
                    <AppSelect
                      value={sourceIds[index] ?? ""}
                      disabled={busy || closing || loadingSources}
                      onChange={(event) => {
                        setSourceIds((previous) => {
                          const next = [...previous];
                          next[index] = event.target.value;
                          return next;
                        });
                        if (kind === "line") {
                          setLinePicksChanged(true);
                          setRetainedIndices((previous) => {
                            const next = [...previous];
                            next[index] = undefined;
                            return next;
                          });
                          setSourceObjectSelections((previous) => {
                            const next = [...previous];
                            next[index] = false;
                            return next;
                          });
                          setSourceParameters((previous) => {
                            const next = [...previous];
                            next[index] = undefined;
                            return next;
                          });
                          setSourcePlaneUV((previous) => {
                            const next = [...previous];
                            next[index] = undefined;
                            return next;
                          });
                        }
                        setDirty(true);
                      }}
                    >
                      <option value="">
                        {kind === "point" && pointMode === "midpoint"
                          ? "Select a stored reference line"
                          : "Select a source"}
                      </option>
                      {retainedSources.map((id) => (
                        <option key={id} value={id} disabled={!!sourcePage}>
                          {entities.find((source) => source.id === id)?.name ??
                            id}
                          {sourcePage
                            ? sourcePage.nextOffset !== null
                              ? " (not loaded)"
                              : " (unavailable)"
                            : ""}
                        </option>
                      ))}
                      {sourceOptions.map((source) => (
                        <option
                          key={source.entityId}
                          value={source.entityId}
                          disabled={!source.eligible}
                        >
                          {source.name}
                          {source.reason ? ` (${source.reason})` : ""}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  {kind === "line" &&
                    lineMode === "pair" &&
                    sourceOptions.find(
                      (row) => row.entityId === sourceIds[index],
                    )?.objectSelection && (
                      <label>
                        <input
                          type="checkbox"
                          disabled={busy || closing}
                          checked={!!sourceObjectSelections[index]}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSourceObjectSelections((previous) => {
                              const next = [...previous];
                              next[index] = checked;
                              return next;
                            });
                            setLinePicksChanged(true);
                            setRetainedIndices((previous) => {
                              const next = [...previous];
                              next[index] = undefined;
                              return next;
                            });
                            setDirty(true);
                          }}
                        />
                        Select source {index + 1} object without a position
                      </label>
                    )}
                  {kind === "line" &&
                    sourceOptions.find(
                      (row) => row.entityId === sourceIds[index],
                    )?.primitiveKind === "axis" && (
                      <label>
                        Source {index + 1} position along line (0–1)
                        <input
                          aria-label={`Source ${index + 1} fraction`}
                          type="number"
                          disabled={
                            lineMode === "pair" &&
                            !!sourceObjectSelections[index]
                          }
                          min="0"
                          max="1"
                          step="any"
                          value={sourceParameters[index] ?? ""}
                          onChange={(event) => {
                            const parameter = event.target.valueAsNumber;
                            setSourceParameters((previous) => {
                              const next = [...previous];
                              next[index] = Number.isFinite(parameter)
                                ? parameter
                                : undefined;
                              return next;
                            });
                            setLinePicksChanged(true);
                            setRetainedIndices((previous) => {
                              const next = [...previous];
                              next[index] = undefined;
                              return next;
                            });
                            setDirty(true);
                          }}
                        />
                      </label>
                    )}
                  {kind === "line" &&
                    sourceOptions.find(
                      (row) => row.entityId === sourceIds[index],
                    )?.primitiveKind === "plane" && (
                      <div className="vector-field">
                        <span>Source {index + 1} plane (mm)</span>
                        <div
                          style={{
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          }}
                        >
                          {(["U", "V"] as const).map((axis, component) => {
                            const bounds = sourceOptions.find(
                              (row) => row.entityId === sourceIds[index],
                            )?.planeUVBounds;
                            return (
                              <label key={axis}>
                                <span>{axis}</span>
                                <input
                                  aria-label={`Source ${index + 1} plane ${axis}`}
                                  type="number"
                                  step="any"
                                  min={bounds?.min[component]}
                                  max={bounds?.max[component]}
                                  value={
                                    sourcePlaneUV[index]?.[component] ?? ""
                                  }
                                  onChange={(event) => {
                                    const value = event.target.valueAsNumber;
                                    setSourcePlaneUV((previous) => {
                                      const next = [...previous];
                                      const uv: [
                                        number | undefined,
                                        number | undefined,
                                      ] = [
                                        previous[index]?.[0],
                                        previous[index]?.[1],
                                      ];
                                      uv[component] = Number.isFinite(value)
                                        ? value
                                        : undefined;
                                      next[index] = uv;
                                      return next;
                                    });
                                    setLinePicksChanged(true);
                                    setRetainedIndices((previous) => {
                                      const next = [...previous];
                                      next[index] = undefined;
                                      return next;
                                    });
                                    setDirty(true);
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  {kind === "line" &&
                    !linePicksChanged &&
                    definition?.kind === "line" &&
                    definition.records[index] && (
                      <span>
                        Retained pick:{" "}
                        {definition.records[index].coordinates.join(", ")} mm
                      </span>
                    )}
                </div>
              ))}
              {loadingSources && <p role="status">Loading sources...</p>}
              {sourceError && <p role="alert">{sourceError}</p>}
              {sourcePage?.nextOffset != null && (
                <button
                  disabled={busy || loadingSources}
                  onClick={() => setOffset(sourcePage.nextOffset!)}
                >
                  Load more sources
                </button>
              )}
              {(kind === "line" || pointMode !== "midpoint") && (
                <div className="button-row">
                  <button
                    disabled={busy || closing}
                    onClick={() => {
                      setSourceIds((previous) =>
                        Array.from(
                          { length: sourceCount + 1 },
                          (_, index) => previous[index] ?? "",
                        ),
                      );
                      if (kind === "line") setLinePicksChanged(true);
                      setDirty(true);
                    }}
                  >
                    Add source
                  </button>
                  {sourceIds.length >
                    (kind === "point" && pointMode === "threePlanes"
                      ? 3
                      : 2) && (
                    <button
                      disabled={busy || closing}
                      onClick={() => {
                        setSourceIds((previous) => previous.slice(0, -1));
                        setRetainedIndices((previous) => previous.slice(0, -1));
                        if (kind === "line") setLinePicksChanged(true);
                        setDirty(true);
                      }}
                    >
                      Remove last source
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <VectorField
              label={kind === "point" ? "Position" : "Start"}
              value={start}
              onChange={(value) => {
                setStart(value);
                setUseInitializedFields(false);
                setInitializationError("");
                setStartPick(undefined);
                setDirty(true);
              }}
            />
          )}
          {pickCoordinate && !derived && (
            <button
              disabled={busy || closing}
              onClick={() => void acquireCoordinate("start")}
            >
              {kind === "point" ? "Pick position" : "Pick start"}
            </button>
          )}
          {!derived && (
            <button onClick={() => setCadTarget("start")}>
              {kind === "point"
                ? "Choose CAD/mesh position"
                : "Choose CAD/mesh start"}
            </button>
          )}
          {kind === "line" && lineMode === "endpoints" && (
            <VectorField
              label="End"
              value={end}
              onChange={(value) => {
                setEnd(value);
                setUseInitializedFields(false);
                setInitializationError("");
                setEndPick(undefined);
                setDirty(true);
              }}
            />
          )}
          {pickCoordinate && kind === "line" && lineMode === "endpoints" && (
            <button
              disabled={busy || closing}
              onClick={() => void acquireCoordinate("end")}
            >
              Pick end
            </button>
          )}
          {kind === "line" && lineMode === "endpoints" && (
            <button onClick={() => setCadTarget("end")}>
              Choose CAD/mesh end
            </button>
          )}
        </fieldset>
        {initializing && <p role="status">Preparing numeric fields...</p>}
        {initializationError && !derived && (
          <p role="alert">{initializationError}</p>
        )}
        {error && <p role="alert">{error}</p>}
        {!dirty && previewOutcome && (
          <p role="status">Preview: {previewOutcome}</p>
        )}
        <p className="muted">
          Preview expires after 60 seconds. Apply adds one history step.
        </p>
        <div className="button-row">
          <button
            disabled={
              busy ||
              closing ||
              initializing ||
              (!!initializationError && useInitializedFields && !derived) ||
              (derived && (loadingSources || !sourcePage || !!sourceError))
            }
            onClick={() => void command("preview")}
          >
            Preview
          </button>
          <button
            disabled={busy || closing || !session || dirty}
            onClick={() => void command("apply")}
          >
            Apply
          </button>
          <button disabled={busy} onClick={() => void command("cancel")}>
            {closing ? "Retry closing preview" : "Cancel"}
          </button>
        </div>
      </section>
    </div>
  );
}
