import type { WorkspaceHost } from "./api";
import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "../reference-construction";
import { initializeNativeReferenceLine } from "../reference-line-evaluation";
import {
  bindReferenceConstructionWorkspace,
  type ReferenceConstructionWorkspaceBinding,
} from "./reference-construction-binding";
import {
  ReferenceConstructionSession,
  type ReferenceConstructionCachedPreview,
  type ReferenceConstructionSessionEdit,
  type ReferenceConstructionSessionInspection,
} from "../reference-construction-session";
import type { ReferenceConstructionState } from "../reference-construction-evaluation";

type Active = Extract<ReferenceConstructionSessionInspection, { active: true }>;
type Terminal = Extract<
  ReferenceConstructionSessionInspection,
  { active: false }
>;
export interface ReferenceConstructionPreviewDisplay {
  /** Stage/install synchronously; clear must be idempotent and owner-scoped. */
  show(owner: string, candidate: ReferenceConstructionCachedPreview): void;
  clear(owner: string): void;
}
export type ReferenceConstructionPreviewInspection =
  | { active: false }
  | (ReferenceConstructionSessionInspection & {
      cleanupPending?: boolean;
      cleanupError?: string;
    });
interface Lease {
  session: ReferenceConstructionSession;
  binding: ReferenceConstructionWorkspaceBinding;
  display: ReferenceConstructionPreviewDisplay;
  timer?: ReturnType<typeof setTimeout>;
  changing: boolean;
  cleanupError?: string;
}
interface Box {
  lease?: Lease;
  terminal?: Terminal;
}
const boxes = new WeakMap<WorkspaceHost, Box>();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function cleanup(box: Box, lease: Lease, reason?: "cancelled" | "disposed") {
  const changing = lease.changing;
  lease.changing = true;
  try {
    if (reason) lease.session.close(reason);
    const terminal = lease.session.inspect(lease.binding.token);
    if (terminal.active)
      throw new Error(
        "Cannot retire an active reference preview without a reason.",
      );
    clearTimeout(lease.timer);
    lease.timer = undefined;
    lease.binding.dispose();
    box.terminal = terminal;
    try {
      lease.display.clear(lease.session.id);
      lease.cleanupError = undefined;
      if (box.lease === lease) box.lease = undefined;
    } catch (error) {
      lease.cleanupError = errorText(error);
      throw error;
    }
  } finally {
    lease.changing = changing;
  }
}
function arm(host: WorkspaceHost, lease: Lease, state: Active) {
  clearTimeout(lease.timer);
  lease.timer = setTimeout(
    () => {
      lease.timer = undefined;
      if (boxes.get(host)?.lease !== lease || lease.changing) return;
      inspectReferenceConstructionPreview(host);
    },
    Math.max(0, state.expiresAt - Date.now()),
  );
}
function competing(host: WorkspaceHost) {
  const application = host.inspectApplication?.(0) as
    { previews?: Record<string, unknown> } | undefined;
  return (
    !!host.inspectInteractive?.() ||
    [
      "interactive",
      "landmarkSession",
      "sketchSection",
      "datum",
      "scan",
      "landmarks",
      "surface",
      "globalAlignment",
    ].some((key) => !!application?.previews?.[key])
  );
}

/** Internal host owner; public API/source admission and renderer hooks remain separate. */
export function inspectReferenceConstructionPreview(
  host: WorkspaceHost,
): ReferenceConstructionPreviewInspection {
  const box = boxes.get(host),
    lease = box?.lease;
  if (!lease) return box?.terminal ?? { active: false };
  if (lease.changing) return lease.session.inspect(lease.binding.token);
  const state = lease.session.inspect(lease.binding.currentToken());
  if (state.active) return state;
  if (!lease.cleanupError) {
    try {
      cleanup(box!, lease);
    } catch {
      /* Retain the owned cleanup obligation below. */
    }
  }
  return lease.cleanupError
    ? { ...state, cleanupPending: true, cleanupError: lease.cleanupError }
    : state;
}
function requireLease(host: WorkspaceHost, owner: string) {
  const box = boxes.get(host),
    lease = box?.lease;
  if (!lease || lease.session.id !== owner)
    throw new Error("Reference preview owner is not active.");
  if (lease.changing)
    throw new Error("Reference preview transition is in progress.");
  const state = inspectReferenceConstructionPreview(host);
  if (!state.active || box!.lease !== lease)
    throw new Error(
      "Reference preview is not active; inspect its terminal state.",
    );
  return { box: box!, lease, state };
}
/** New numeric draft only; existing-object edits must supply their retained prior state. */
export function beginNumericReferenceConstructionPreview(
  host: WorkspaceHost,
  display: ReferenceConstructionPreviewDisplay,
  definition: ReferenceConstructionDefinition,
  lineSceneBounds?: readonly number[] | Float32Array,
): Active {
  const saved = copyReferenceConstruction(definition);
  let prior: ReferenceConstructionState;
  if (saved.kind === "point" && saved.mode === "coordinates") {
    // These are explicit numeric inputs, not an inferred inner-constructor default.
    prior = {
      geometry: { kind: "point", position: saved.position },
      state: { completionWord: 0x100 },
    };
  } else if (saved.kind === "line" && saved.mode === "endpoints") {
    if (lineSceneBounds === undefined)
      throw new Error("New numeric lines require a scene bounds snapshot.");
    const initialized = initializeNativeReferenceLine(lineSceneBounds);
    prior = {
      geometry: initialized.geometry,
      state: { completionWord: initialized.completionWord },
    };
  } else
    throw new Error(
      "This initialization path supports explicit numeric point/endpoint inputs only.",
    );
  return beginReferenceConstructionPreview(host, display, prior, {
    definition: saved,
    writeNumericInputs: true,
    evaluationAllowed: true,
  });
}
export function beginReferenceConstructionPreview(
  host: WorkspaceHost,
  display: ReferenceConstructionPreviewDisplay,
  prior: ReferenceConstructionState,
  edit: ReferenceConstructionSessionEdit,
): Active {
  inspectReferenceConstructionPreview(host);
  const box = boxes.get(host) ?? {};
  if (box.lease)
    throw new Error(
      box.lease.cleanupError
        ? "Reference preview cleanup is pending."
        : "A reference preview is already active.",
    );
  if (competing(host))
    throw new Error(
      "Finish or discard the competing preview before constructing a reference.",
    );
  const binding = bindReferenceConstructionWorkspace(host);
  let session: ReferenceConstructionSession;
  try {
    session = new ReferenceConstructionSession(binding.token, prior, edit);
  } catch (error) {
    binding.dispose();
    throw error;
  }
  const lease: Lease = { session, binding, display, changing: true };
  box.lease = lease;
  box.terminal = undefined;
  boxes.set(host, box);
  try {
    const initial = session.inspect(binding.token);
    if (!initial.active)
      throw new Error("Reference preview initialization failed.");
    display.show(session.id, initial);
    const state = session.inspect(binding.currentToken());
    if (!state.active)
      throw new Error(
        "Reference model changed or preview expired during publication.",
      );
    arm(host, lease, state);
    return state;
  } catch (error) {
    try {
      cleanup(box, lease, "cancelled");
    } catch (retirement) {
      throw new AggregateError(
        [error, retirement],
        "Reference initialization and cleanup failed.",
      );
    }
    throw error;
  } finally {
    lease.changing = false;
  }
}
export function editReferenceConstructionPreview(
  host: WorkspaceHost,
  owner: string,
  version: number,
  edit: ReferenceConstructionSessionEdit,
): Active {
  const { box, lease, state: previous } = requireLease(host, owner);
  let attempted = false;
  lease.changing = true;
  try {
    const next = lease.session.edit(
      version,
      lease.binding.currentToken(),
      edit,
      (candidate) => {
        attempted = true;
        lease.display.show(owner, candidate);
        if (lease.binding.currentToken() !== lease.binding.token)
          throw new Error(
            "Reference model changed during display publication.",
          );
      },
    );
    if (!next.active)
      throw new Error("Reference preview became stale during edit.");
    arm(host, lease, next);
    return next;
  } catch (error) {
    if (!attempted) throw error;
    const current = lease.session.inspect(lease.binding.currentToken());
    if (!current.active) {
      try {
        cleanup(box, lease);
      } catch (retirement) {
        throw new AggregateError(
          [error, retirement],
          "Reference edit and cleanup failed.",
        );
      }
      throw error;
    }
    try {
      lease.display.show(owner, previous);
      const restored = lease.session.inspect(lease.binding.currentToken());
      if (!restored.active)
        throw new Error("Reference model changed during display restoration.");
      arm(host, lease, restored);
    } catch (restoration) {
      const errors = [error, restoration];
      try {
        const state = lease.session.inspect(lease.binding.currentToken());
        cleanup(box, lease, state.active ? "cancelled" : undefined);
      } catch (retirement) {
        errors.push(retirement);
      }
      throw new AggregateError(
        errors,
        "Reference edit and display restoration failed.",
      );
    }
    throw error;
  } finally {
    lease.changing = false;
  }
}
export function applyReferenceConstructionPreview(
  host: WorkspaceHost,
  owner: string,
  version: number,
  publish: (candidate: ReferenceConstructionCachedPreview) => void,
): ReferenceConstructionCachedPreview & {
  cleanupPending: boolean;
  cleanupError?: string;
} {
  const { box, lease } = requireLease(host, owner);
  lease.changing = true;
  try {
    let result: ReferenceConstructionCachedPreview;
    try {
      result = lease.session.apply(
        version,
        lease.binding.currentToken(),
        publish,
      );
    } catch (error) {
      const state = lease.session.inspect(lease.binding.currentToken());
      if (state.active) arm(host, lease, state);
      else {
        try {
          cleanup(box, lease);
        } catch {
          /* Exposed by inspection; publication did not succeed. */
        }
      }
      throw error;
    }
    try {
      cleanup(box, lease);
    } catch {
      return {
        ...result,
        cleanupPending: true,
        cleanupError: lease.cleanupError,
      };
    }
    return { ...result, cleanupPending: false };
  } finally {
    lease.changing = false;
  }
}
export function releaseReferenceConstructionPreview(
  host: WorkspaceHost,
  owner: string,
): boolean {
  const box = boxes.get(host),
    lease = box?.lease;
  if (!lease || lease.session.id !== owner) return false;
  if (lease.changing)
    throw new Error("Reference preview transition is in progress.");
  lease.session.inspect(lease.binding.currentToken());
  cleanup(box!, lease, "cancelled");
  return true;
}
/** API lifetime disposal only; public discard must supply its expected owner. */
export function disposeReferenceConstructionPreview(host: WorkspaceHost): void {
  const box = boxes.get(host),
    lease = box?.lease;
  if (!lease) return;
  if (lease.changing)
    throw new Error("Reference preview transition is in progress.");
  cleanup(box!, lease, "disposed");
}
