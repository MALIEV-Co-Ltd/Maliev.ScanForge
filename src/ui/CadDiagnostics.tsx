import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { CadInspection } from "../cad/client";
import { runApplicationJobCommand } from "./application-job-command";
import { CadJobCancel } from "./CadJobCancel";

export function CadDiagnostics({
  entityId,
  api,
}: {
  entityId: string;
  api: Pick<ApplicationApi, "invoke" | "currentRevision">;
}) {
  const [result, setResult] = useState<CadInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [entityId, api]);
  async function inspect() {
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const report = await runApplicationJobCommand(
        api,
        "cad_inspect",
        { entityId },
        {
          readOnly: true,
          signal: run.signal,
          cancelledMessage: "CAD inspection cancelled.",
          leaseMessage: "CAD inspection exceeded its time limit.",
        },
      );
      if (!run.signal.aborted) setResult(report as unknown as CadInspection);
    } catch (failure) {
      if (!run.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "CAD inspection failed.",
        );
    } finally {
      if (controller.current === run) setBusy(false);
    }
  }
  return (
    <section aria-label="Exact CAD inspection">
      <h4>Exact CAD</h4>
      <button disabled={busy} onClick={() => void inspect()}>
        Inspect exact CAD
      </button>
      {busy && (
        <CadJobCancel
          label="Cancel CAD inspection"
          onCancel={() => controller.current?.abort()}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p role="status">{result.valid ? "Valid BREP" : "Invalid BREP"}</p>
          <dl>
            <dt>Solids / shells / faces</dt>
            <dd>
              {result.solids} / {result.shells} / {result.faces}
            </dd>
            <dt>Edges / vertices</dt>
            <dd>
              {result.edges} / {result.vertices}
            </dd>
            <dt>Exact area (mm²)</dt>
            <dd>{result.areaMm2.toPrecision(10)}</dd>
            {result.solids > 0 && (
              <>
                <dt>Signed exact volume (mm³)</dt>
                <dd>{result.signedVolumeMm3.toPrecision(10)}</dd>
              </>
            )}
          </dl>
          {result.solids === 0 && <p>Surface geometry; no solid volume.</p>}
        </>
      )}
    </section>
  );
}
