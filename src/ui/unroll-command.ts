import type { ApplicationApi } from "../automation/api";
import type { UnrollCommandInput } from "../scan-unroll-reference";
import {
  runApplicationJobCommand,
  type ApplicationJobOptions,
} from "./application-job-command";

/** Publish through the same revision-checked operation used by MCP. */
export function runUnrollCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  entityId: string,
  operation: UnrollCommandInput,
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
