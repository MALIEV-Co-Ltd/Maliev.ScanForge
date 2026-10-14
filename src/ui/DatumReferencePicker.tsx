import { useEffect, useRef, useState } from "react";
import type {
  AlignmentReference,
  AlignmentReferencePage,
} from "../automation/alignment-operations";
import type { Entity } from "../types";

export function DatumReferencePicker({
  entities,
  index,
  value,
  onChange,
  read,
  onPickFace,
}: {
  entities: Entity[];
  index: number;
  value?: { entityId: string; referenceId: string };
  onChange: (
    value: { entityId: string; reference: AlignmentReference } | undefined,
    required: boolean,
  ) => void;
  read: (
    entityId: string,
    offset: number,
    signal: AbortSignal,
    triangleIndex?: number,
  ) => Promise<AlignmentReferencePage>;
  onPickFace: (
    callback: ((entityId: string, triangleIndex?: number) => void) | null,
  ) => void;
}) {
  const [source, setSource] = useState(value?.entityId ?? "");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AlignmentReferencePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pickedRead = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pickedRead.current?.abort();
      onPickFace(null);
    },
    [],
  );
  function startFacePick() {
    pickedRead.current?.abort();
    setError("");
    onPickFace((entityId, triangleIndex) => {
      if (triangleIndex === undefined) {
        setError("Pick an exact CAD face.");
        return;
      }
      const controller = new AbortController();
      pickedRead.current = controller;
      setLoading(true);
      void read(entityId, 0, controller.signal, triangleIndex)
        .then((result) => {
          if (controller.signal.aborted) return;
          const reference = result.references[0];
          if (!reference || reference.kind === "unsupported")
            throw new Error("This face cannot define an alignment reference.");
          setSource(entityId);
          setOffset(Math.floor((reference.faceIndex ?? 0) / 50) * 50);
          setPage(result);
          onChange({ entityId, reference }, true);
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : "Face picking failed.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
  }
  useEffect(() => {
    if (!source) {
      setPage(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPage(null);
    void read(source, offset, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Reference inspection failed.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, offset, entities]);
  return (
    <>
      <button disabled={loading} onClick={startFacePick}>
        Pick reference face on canvas
      </button>
      <label className="field">
        <span>Reference object</span>
        <select
          aria-label={`Reference ${index + 1} object`}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setOffset(0);
            onChange(undefined, !!event.target.value);
          }}
        >
          <option value="">Manual coordinates</option>
          {entities
            .filter((entity) => entity.kernelId || entity.fit)
            .map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
        </select>
      </label>
      {source && (
        <label className="field">
          <span>Feature / face</span>
          <select
            aria-label={`Reference ${index + 1} feature`}
            disabled={loading || !page}
            value={value?.referenceId ?? ""}
            onChange={(event) => {
              const reference = page?.references.find(
                (item) => item.id === event.target.value,
              );
              onChange(
                reference ? { entityId: source, reference } : undefined,
                true,
              );
            }}
          >
            <option value="">
              {loading ? "Reading references…" : "Choose a reference"}
            </option>
            {page?.references.map((reference) => (
              <option
                key={reference.id}
                value={reference.id}
                disabled={reference.kind === "unsupported"}
              >
                {reference.source === "cadFace"
                  ? `Face ${(reference.faceIndex ?? 0) + 1}`
                  : "Fitted feature"}{" "}
                · {reference.surfaceKind} · {reference.kind}
              </option>
            ))}
          </select>
        </label>
      )}
      {page && (offset > 0 || page.nextOffset !== null) && (
        <div className="display-row">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous references
          </button>
          <button
            disabled={page.nextOffset === null || loading}
            onClick={() => setOffset(page.nextOffset ?? offset)}
          >
            Next references
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
