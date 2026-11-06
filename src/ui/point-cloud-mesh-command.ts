import type { ApplicationApi } from "../automation/api";
import type { PointCloudPoissonOptions } from "../point-cloud-poisson-input";
import {
  runApplicationJobCommand,
  type ApplicationJobOptions,
} from "./application-job-command";

export type CloudMeshingOperation =
  | {
      kind?: "pointCloudMesh";
      plane: "xy" | "xz" | "yz";
      maxEdgeLength: number;
    }
  | ({ kind: "pointCloudPoisson" } & PointCloudPoissonOptions);

export function runPointCloudMeshCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  entityId: string,
  operation: CloudMeshingOperation,
  options: ApplicationJobOptions = {},
) {
  const label =
    operation.kind === "pointCloudPoisson"
      ? "Poisson reconstruction"
      : "Projected meshing";
  return runApplicationJobCommand(
    api,
    "mesh_process",
    {
      entityId,
      operation: { kind: "pointCloudMesh", ...operation },
    },
    {
      ...options,
      cancelledMessage: `${label} cancelled.`,
      leaseMessage: `${label} reached its operation lease; reduce the point cloud before retrying.`,
    },
  );
}
