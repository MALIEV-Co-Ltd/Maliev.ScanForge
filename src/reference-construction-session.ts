import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "./reference-construction";
import { copyReferenceGeometry } from "./reference-construction-values";
import {
  applyReferenceConstructionNumericInputs,
  evaluateReferenceConstruction,
  type ReferenceConstructionEvaluation,
  type ReferenceConstructionState,
} from "./reference-construction-evaluation";

export interface ReferenceConstructionSessionEdit {
  readonly definition: ReferenceConstructionDefinition;
  readonly resolvedInputs?: unknown;
  /** Numeric controller writes are explicit, separate from evaluation/mode changes. */
  readonly writeNumericInputs: boolean;
  readonly evaluationAllowed: boolean;
}
export interface ReferenceConstructionCachedPreview {
  readonly definition: ReferenceConstructionDefinition;
  readonly preview: ReferenceConstructionEvaluation;
}
type CloseReason = "cancelled" | "disposed" | "expired" | "stale" | "applied";
export type ReferenceConstructionSessionInspection = {
  readonly sessionId: string;
  readonly version: number;
} & (
  | ({
      readonly active: true;
      readonly expiresAt: number;
    } & ReferenceConstructionCachedPreview)
  | { readonly active: false; readonly reason: CloseReason }
);

function copy(
  cache: ReferenceConstructionCachedPreview,
): ReferenceConstructionCachedPreview {
  return {
    definition: copyReferenceConstruction(cache.definition),
    preview: {
      ...cache.preview,
      geometry: copyReferenceGeometry(cache.preview.geometry),
      state: { ...cache.preview.state },
      diagnostics: { ...cache.preview.diagnostics },
    },
  };
}
function evaluate(
  edit: ReferenceConstructionSessionEdit,
  prior: ReferenceConstructionState,
): ReferenceConstructionCachedPreview {
  if (typeof edit.evaluationAllowed !== "boolean")
    throw new Error("Invalid reference evaluation guard.");
  if (typeof edit.writeNumericInputs !== "boolean")
    throw new Error("Invalid reference numeric-write intent.");
  const definition = copyReferenceConstruction(edit.definition);
  const state = edit.writeNumericInputs
    ? applyReferenceConstructionNumericInputs(definition, prior)
    : prior;
  const preview = evaluateReferenceConstruction(
    definition,
    edit.resolvedInputs,
    state,
    edit.evaluationAllowed,
  );
  return copy({ definition, preview });
}
/**
 * Internal cached-preview state, shared by the future GUI/MCP host operations.
 * The private workspace token must come from authoritative model/source binding;
 * it is not a caller-supplied API revision or a lock/admission/ownership check.
 * This class owns no display resources or timer. The host must retire its preview
 * when inspection closes the session, and wire cancellation/disposal and retries.
 */
export class ReferenceConstructionSession {
  readonly id = crypto.randomUUID();
  private version = 1;
  private cache: ReferenceConstructionCachedPreview | undefined;
  private reason: CloseReason | undefined;
  private expiresAt: number;
  private publishing = false;
  constructor(
    private readonly workspaceToken: object,
    prior: ReferenceConstructionState,
    edit: ReferenceConstructionSessionEdit,
  ) {
    if (!workspaceToken || typeof workspaceToken !== "object")
      throw new Error("Reference session requires a private workspace token.");
    this.cache = evaluate(edit, prior);
    this.expiresAt = Date.now() + 60000;
  }
  private finish(reason: CloseReason) {
    this.reason = reason;
    this.cache = undefined;
  }
  private settle(workspaceToken: object) {
    if (this.reason || this.publishing) return;
    if (Date.now() >= this.expiresAt) this.finish("expired");
    else if (workspaceToken !== this.workspaceToken) this.finish("stale");
  }
  private writable(version: number, workspaceToken: object) {
    if (this.publishing)
      throw new Error("Reference publication is in progress.");
    this.settle(workspaceToken);
    if (this.reason)
      throw new Error("Reference session is " + this.reason + ".");
    if (version !== this.version)
      throw new Error(
        "Reference session version changed; inspect its current state.",
      );
  }
  inspect(workspaceToken: object): ReferenceConstructionSessionInspection {
    this.settle(workspaceToken);
    const common = { sessionId: this.id, version: this.version };
    return this.reason
      ? { ...common, active: false, reason: this.reason }
      : {
          ...common,
          active: true,
          expiresAt: this.expiresAt,
          ...copy(this.cache!),
        };
  }
  edit(
    version: number,
    workspaceToken: object,
    edit: ReferenceConstructionSessionEdit,
    publish?: (candidate: ReferenceConstructionCachedPreview) => void,
  ): ReferenceConstructionSessionInspection {
    this.writable(version, workspaceToken);
    const candidate = evaluate(edit, this.cache!.preview);
    this.publishing = true;
    try {
      publish?.(copy(candidate));
    } finally {
      this.publishing = false;
    }
    this.cache = candidate;
    this.version++;
    this.expiresAt = Date.now() + 60000;
    return this.inspect(workspaceToken);
  }
  /** Publish synchronously through the host's context.mutate/atomic commit boundary. */
  apply(
    version: number,
    workspaceToken: object,
    publish: (candidate: ReferenceConstructionCachedPreview) => void,
  ): ReferenceConstructionCachedPreview {
    this.writable(version, workspaceToken);
    const result = copy(this.cache!);
    this.publishing = true;
    try {
      publish(copy(this.cache!));
      this.finish("applied");
      return result;
    } finally {
      this.publishing = false;
    }
  }
  close(reason: "cancelled" | "disposed"): void {
    if (this.publishing)
      throw new Error("Reference publication is in progress.");
    if (reason !== "cancelled" && reason !== "disposed")
      throw new Error("Invalid reference session close reason.");
    if (!this.reason) this.finish(reason);
  }
}
