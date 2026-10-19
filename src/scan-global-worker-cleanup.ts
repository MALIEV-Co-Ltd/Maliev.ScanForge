/** Exact Web Worker handles only. A successful terminate call proves a request,
 * never physical exit or decommit. Failed requests retain recovery ownership. */
export interface OwnedWorkerIdentity {
  owner: string;
  runId: number;
  target: string;
  createdUnixMs: number;
  expiresUnixMs: number;
}
export interface WorkerCleanupOutcome extends OwnedWorkerIdentity {
  attempts: number;
  status:
    | "termination-requested"
    | "termination-unconfirmed"
    | "nested-cleanup-unconfirmed";
  retained: boolean;
  errors: string[];
}
const pending = new Map<
  string,
  { worker: Worker; control?: SharedArrayBuffer; outcome: WorkerCleanupOutcome }
>();
const history: WorkerCleanupOutcome[] = [];
const save = (outcome: WorkerCleanupOutcome) => {
  history.push({ ...outcome, errors: [...outcome.errors] });
  if (history.length > 32) history.shift();
};
export const ownedWorkerCleanupPending = () =>
  [...pending.values()].map(({ outcome }) => ({
    ...outcome,
    errors: [...outcome.errors],
  }));
export const ownedWorkerCleanupHistory = () =>
  history.map((value) => ({ ...value, errors: [...value.errors] }));
export function assertNoUnresolvedOwnedWorkers() {
  // A retry of the existing shared command can recover transient stop failures.
  // Each exact handle receives only its existing bounded stop/retry operation;
  // asynchronous nested acknowledgments leave the gate closed until received.
  retryOwnedWorkerStops();
  if (pending.size)
    throw Error(
      "Unresolved exact worker cleanup retains recovery ownership; retry before starting another worker.",
    );
}
export function requestOwnedWorkerStop(
  worker: Worker,
  identity: OwnedWorkerIdentity,
  control?: SharedArrayBuffer,
): WorkerCleanupOutcome {
  const outcome: WorkerCleanupOutcome = {
    ...identity,
    attempts: 0,
    status: "termination-unconfirmed",
    retained: true,
    errors: [],
  };
  worker.onmessage = worker.onerror = worker.onmessageerror = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    outcome.attempts++;
    try {
      worker.terminate();
      outcome.status = "termination-requested";
      outcome.retained = false;
      pending.delete(identity.owner);
      save(outcome);
      return outcome;
    } catch (error) {
      outcome.errors.push(
        String(error instanceof Error ? error.message : error).slice(0, 240),
      );
    }
  }
  // No timer/helper is created. The worker's original finite lease is unchanged.
  // Recovery handles remain available even after expiry; expiry is not exit proof.
  pending.set(identity.owner, { worker, control, outcome });
  save(outcome);
  return outcome;
}
export function retainNestedControllerCleanup(
  worker: Worker,
  identity: OwnedWorkerIdentity,
  control?: SharedArrayBuffer,
) {
  const outcome: WorkerCleanupOutcome = {
    ...identity,
    attempts: 1,
    status: "nested-cleanup-unconfirmed",
    retained: true,
    errors: ["Nested worker closure request not confirmed."],
  };
  pending.set(identity.owner, { worker, control, outcome });
  save(outcome);
  worker.onerror = worker.onmessageerror = null;
  worker.onmessage = ({ data }) => {
    if (
      data?.kind !== "cleanup" ||
      data.runId !== identity.runId ||
      data.unresolved !== 0
    )
      return;
    requestOwnedWorkerStop(worker, identity, control);
  };
  try {
    worker.postMessage({ kind: "retry-cleanup", runId: identity.runId });
  } catch (error) {
    outcome.errors.push(String(error).slice(0, 240));
    save(outcome);
  }
}
export function retryOwnedWorkerStops(owners?: readonly string[]) {
  for (const [owner, value] of [...pending]) {
    if (owners && !owners.includes(owner)) continue;
    if (value.outcome.status === "nested-cleanup-unconfirmed") {
      value.outcome.attempts++;
      try {
        value.worker.postMessage({
          kind: "retry-cleanup",
          runId: value.outcome.runId,
        });
      } catch (error) {
        value.outcome.errors = [
          ...value.outcome.errors.slice(-2),
          String(error).slice(0, 240),
        ];
      }
      save(value.outcome);
    } else requestOwnedWorkerStop(value.worker, value.outcome, value.control);
  }
  return ownedWorkerCleanupPending();
}
