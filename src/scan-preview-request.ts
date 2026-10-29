import type { Entity, Vec3 } from "./types";
import type { ScanToolOperation } from "./scan-tools";
import {
  bindShrinkwrap,
  type ShrinkwrapParameters,
} from "./shrinkwrap-request";
import { mirrorReference } from "./scan-tools-reference";

export type ScanPreviewParameters =
  | ShrinkwrapParameters
  | Omit<Extract<ScanToolOperation, { kind: "reduceNoise" }>, "selection">
  | Extract<ScanToolOperation, { kind: "reducePolygons" | "scaleMesh" }>
  | {
      kind: "mirrorMesh";
      plane: "OXY" | "OYZ" | "OXZ" | "object";
      referenceId?: string;
    };

/** Public settings resolve against the same source, references and mask for GUI and MCP. */
export function bindScanPreview(
  source: Entity,
  settings: ScanPreviewParameters,
  entities: Entity[],
  selection?: Uint8Array | null,
): ScanToolOperation {
  if (settings.kind === "shrinkwrap")
    return bindShrinkwrap(source, settings, entities, selection);
  if (settings.kind === "mirrorMesh") {
    const object = entities.find(
      (e) => e.id === settings.referenceId && e.id !== source.id,
    );
    const reference =
      settings.plane === "object"
        ? object && mirrorReference(object)
        : {
            center: [0, 0, 0] as Vec3,
            normal: (settings.plane === "OXY"
              ? [0, 0, 1]
              : settings.plane === "OYZ"
                ? [1, 0, 0]
                : [0, 1, 0]) as Vec3,
          };
    if (!reference) throw Error("Choose a planar CAD or construction object.");
    return { kind: "mirrorMesh", ...reference };
  }
  if (settings.kind === "reduceNoise" && settings.selectionOnly) {
    if (
      !selection ||
      selection.length !== source.positions.length / 9 ||
      !selection.some(Boolean)
    )
      throw Error("Select triangles before reducing noise on a selection.");
    return { ...settings, selection: new Uint8Array(selection) };
  }
  return settings;
}
