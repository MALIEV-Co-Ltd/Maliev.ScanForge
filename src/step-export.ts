import type { Entity } from "./types";

/** STEP contains exact kernel shapes; scan and datum display geometry is excluded. */
export function selectStepExportEntities(
  entities: readonly Entity[],
  visibleOnly = true,
): Entity[] {
  const shapes = entities.filter(
    (entity) => (!visibleOnly || entity.visible) && !!entity.kernelId,
  );
  if (!shapes.length)
    throw new Error(
      "Create or import exact CAD first. Scan meshes cannot be exported as editable STEP solids.",
    );
  return shapes;
}
