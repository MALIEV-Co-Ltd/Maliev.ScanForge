import type { ApplicationApi } from "../automation/api";
import {
  runApplicationJobCommand,
  type ApplicationJobOptions,
} from "./application-job-command";

/** GUI and MCP share reference binding, base choice, worker and publication. */
export function runAverageCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  args: { entityId: string; targetIds: string[]; tolerance?: number },
  options: ApplicationJobOptions = {},
) {
  return runApplicationJobCommand(
    api,
    "mesh_process",
    {
      entityId: args.entityId,
      targetIds: args.targetIds,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "averageMesh",
          ...(args.tolerance !== undefined
            ? { tolerance: args.tolerance }
            : {}),
        },
      },
    },
    {
      ...options,
      cancelledMessage: "Average mesh cancelled.",
      leaseMessage: "Average mesh reached its operation lease.",
    },
  );
}
