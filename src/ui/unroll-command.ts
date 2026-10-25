import type { ApplicationApi } from "../automation/api";
import type { ScanToolOperation } from "../scan-tools";
import {
  runApplicationJobCommand,
  type ApplicationJobOptions,
} from "./application-job-command";

/** Publish through the same revision-checked operation used by MCP. */
export function runUnrollCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  entityId: string,
  operation: Extract<ScanToolOperation, { kind: "unroll" }>,
  options: ApplicationJobOptions = {},
) {
  return runApplicationJobCommand(
    api,
    "mesh_process",
    {
      entityId,
      operation: { kind: "scanTools", operation },
    },
    {
      ...options,
      cancelledMessage: "Unroll cancelled.",
      leaseMessage: "Unroll reached its operation lease.",
    },
  );
}
