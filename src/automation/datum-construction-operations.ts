import type { Handler, WorkspaceHost } from "./api";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../datum-construction";
import { validatePlaneFrame } from "../plane-frame";
import {
  createReferenceFrameEntity,
  validateReferenceFrameEntity,
} from "../reference-frame";

/** Source-detached numeric datums share the GUI/MCP mutation and history lane. */
export function createDatumConstructionOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    datum_construct: (args, context) => {
      context.check();
      if (args.kind !== "plane" && args.kind !== "frame")
        throw new Error(
          "Only numeric plane or coordinate frame datums are supported.",
        );
      const isFrame = args.kind === "frame";
      if (!context.mutate)
        throw new Error(
          "Datum construction requires the shared mutation context.",
        );
      const snapshot = host.snapshot();
      const existing =
        args.entityId === undefined
          ? undefined
          : snapshot.entities.find((entity) => entity.id === args.entityId);
      if (args.entityId !== undefined && !existing)
        throw new Error(
          isFrame
            ? "Coordinate frame does not exist."
            : "Datum plane does not exist.",
        );
      if (existing) {
        if (existing.locked)
          throw new Error(
            isFrame ? "Coordinate frame is locked." : "Datum plane is locked.",
          );
        if (isFrame) {
          if (existing.kind !== "referenceFrame")
            throw new Error("Edit requires a coordinate frame entity.");
          validateReferenceFrameEntity(existing);
        } else if (
          existing.kind !== "plane" ||
          !existing.planeFrame ||
          existing.fit !== undefined ||
          existing.kernelId !== undefined ||
          existing.brep !== undefined ||
          existing.parametric !== undefined
        )
          throw new Error(
            "Edit requires a numeric plane with a stored plane frame, without fitted or exact CAD geometry.",
          );
        if (args.name !== undefined)
          throw new Error("Use object_update to rename an existing datum.");
        if (!isFrame)
          validatePlaneFrame(
            existing.planeFrame,
            existing.positions,
            existing.kind,
          );
      }
      const name =
        existing?.name ??
        (args.name === undefined
          ? isFrame
            ? "Coordinate system"
            : "Reference plane"
          : args.name);
      if (typeof name !== "string" || !name.trim() || name.length > 200)
        throw new Error("Datum name must contain 1 to 200 characters.");
      const frame = numericDatumFrame(
        args.origin,
        args.normal,
        args.xDirection,
      );
      const built = (
        isFrame ? createReferenceFrameEntity : createNumericDatumPlane
      )(
        frame,
        args.displaySize,
        existing?.id ?? crypto.randomUUID(),
        name.trim(),
      );
      const entity = existing
        ? {
            ...built,
            name: existing.name,
            color: existing.color,
            opacity: existing.opacity,
            visible: existing.visible,
            ...(existing.locked !== undefined
              ? { locked: existing.locked }
              : {}),
            ...(existing.selectable !== undefined
              ? { selectable: existing.selectable }
              : {}),
            ...(existing.constructionOrderKey !== undefined
              ? { constructionOrderKey: existing.constructionOrderKey }
              : {}),
          }
        : built;
      context.mutate(() => {
        host.commit(
          existing
            ? snapshot.entities.map((item) =>
                item.id === entity.id ? entity : item,
              )
            : [...snapshot.entities, entity],
          isFrame
            ? existing
              ? "Edit coordinate system"
              : "Create coordinate system"
            : existing
              ? "Edit reference plane"
              : "Create reference plane",
        );
        host.select(entity.id);
      });
      return {
        entityId: entity.id,
        frame,
        units: "mm",
        displaySize: args.displaySize,
      };
    },
  };
}
