import { CadClient } from "../cad/client";
import type { Handler, WorkspaceHost } from "./api";

export function createCadInspectionOperation(host: WorkspaceHost): Handler {
  return async (args, context) => {
    context.check();
    const entity = host
      .snapshot()
      .entities.find((item) => item.id === args.entityId);
    if (!entity?.kernelId || !entity.brep)
      throw Error("Choose an exact CAD object with saved BREP geometry.");
    if (entity.brep.length > 64 * 1024 * 1024)
      throw Error("CAD inspection BREP exceeds the 64 MiB resource limit.");
    const client = new CadClient();
    const cancel = () => client.dispose();
    context.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await client.inspectBrep(entity.brep);
      context.check();
      return { entityId: entity.id, ...result };
    } finally {
      context.signal.removeEventListener("abort", cancel);
      client.dispose();
    }
  };
}
