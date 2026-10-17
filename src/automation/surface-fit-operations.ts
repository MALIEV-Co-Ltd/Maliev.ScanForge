import { fitGridSurfaceAsync } from "../surface-client";
import { retainIndexedMesh } from "../indexed-mesh";
import { editPointCloud } from "../point-cloud-processing";
import { selectionCount } from "../selection";
import {
  beginSurfaceFit,
  surfaceFitEntity,
  surfaceFitSourceUnchanged,
  type SurfaceFitSession,
} from "../surface-fit-session";
import type { Handler, WorkspaceHost } from "./api";

/** Shares selected-visible scan extraction and accepted patch construction with the GUI. */
export function createSurfaceFitOperation(host: WorkspaceHost): Handler {
  return async (args, context) => {
    context.check();
    const snapshot = host.snapshot();
    const source = snapshot.entities.find(
      (entity) => entity.id === args.entityId,
    );
    if (!source) throw new Error("Object not found.");
    let session: SurfaceFitSession;
    if (args.selectionOnly && source.kind === "pointcloud") {
      const selection =
        snapshot.selectedId === source.id ? snapshot.selection : null;
      if (!selection || selection.length !== source.positions.length / 3)
        throw new Error("Select points on the specified object first.");
      if (!selectionCount(selection)) throw new Error("Selection is empty.");
      const extracted = editPointCloud({
        kind: "pointCloudEdit",
        action: "extract",
        positions: source.positions,
        selection: new Uint8Array(selection),
      });
      session = { source, scan: extracted.positions!, triangles: 0 };
    } else if (args.selectionOnly)
      session = beginSurfaceFit(
        source,
        snapshot.selectedId === source.id ? snapshot.selection : null,
        source.meshSelection?.hidden ?? [],
      );
    else
      session = {
        source,
        scan: source.positions,
        triangles:
          source.kind === "pointcloud" ? 0 : source.positions.length / 9,
      };
    const preview = await fitGridSurfaceAsync(session.scan, args.options, {
      signal: context.signal,
      onProgress: () => context.progress(0.5, "Fitting surface"),
    });
    context.check();
    if (!surfaceFitSourceUnchanged(session, host.snapshot().entities))
      throw new Error("The scan changed; start a new surface fit.");
    const entity = surfaceFitEntity(
      { ...session, preview },
      crypto.randomUUID(),
      {
        name: args.name ?? `${source.name} fitted surface`,
        color: source.color,
      },
    );
    const write = () => {
      context.check();
      const current = host.snapshot();
      if (!surfaceFitSourceUnchanged(session, current.entities))
        throw new Error("The scan changed; start a new surface fit.");
      host.commit(
        [...current.entities, entity].map(retainIndexedMesh),
        "Fit surface",
      );
    };
    if (context.mutate) context.mutate(write);
    else write();
    const { patch: _patch, ...report } = preview;
    return { entityId: entity.id, ...report };
  };
}
