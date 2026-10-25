import type { ApplicationApi } from "../automation/api";
import {
  runApplicationJobCommand,
  type ApplicationJobOptions,
} from "./application-job-command";

/** Reconstruction geometry, validation and commit belong to mesh_process. */
export function runReconstructionCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  args: { entityId: string; targetIds?: string[]; resolution?: number },
  options: ApplicationJobOptions = {},
) {
  return runApplicationJobCommand(
    api,
    "mesh_process",
    {
      entityId: args.entityId,
      ...(args.targetIds !== undefined ? { targetIds: args.targetIds } : {}),
      operation: {
        kind: "scanTools",
        operation: {
          kind: "repolygonize",
          ...(args.resolution !== undefined
            ? { resolution: args.resolution }
            : {}),
        },
      },
    },
    {
      ...options,
      cancelledMessage: "Reconstruction operation cancelled.",
      leaseMessage:
        "Reconstruction reached its operation lease; retry with a smaller region.",
    },
  );
}
