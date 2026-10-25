import {
  inspectionFit,
  measureGeometry,
  type MeasurementInput,
} from "./inspection";
import type { FitResult } from "./types";
export type InspectionDefinition =
  | { kind: "measurement"; measurement: MeasurementInput }
  | ({ kind: "deviation"; entityId: string; tolerance?: number } & (
      | { fit: FitResult }
      | { referenceId: string; maxDistance: number; signed?: boolean }
    ));
export interface SavedInspection {
  id: string;
  name: string;
  definition: InspectionDefinition;
}
const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
/** Persist small reproducible definitions, never stale heatmap buffers or native handles. */
export function validateInspectionDefinitions(
  value: unknown,
): SavedInspection[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error("At most 32 inspection definitions may be saved.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      !text(item.id) ||
      ids.has(item.id) ||
      !text(item.name) ||
      !item.definition ||
      typeof item.definition !== "object"
    )
      throw new Error("Invalid saved inspection identity.");
    ids.add(item.id);
    const d = item.definition;
    if (d.kind === "measurement") measureGeometry(d.measurement);
    else if (d.kind === "deviation") {
      if (
        !text(d.entityId) ||
        !(
          d.tolerance === undefined ||
          (Number.isFinite(d.tolerance) && d.tolerance > 0)
        )
      )
        throw new Error("Invalid saved deviation parameters.");
      if (d.referenceId !== undefined) {
        if (
          d.fit !== undefined ||
          !text(d.referenceId) ||
          d.referenceId === d.entityId ||
          !(d.maxDistance > 0) ||
          !Number.isFinite(d.maxDistance) ||
          !(d.signed === undefined || typeof d.signed === "boolean")
        )
          throw new Error("Invalid saved reference comparison.");
      } else {
        if (d.maxDistance !== undefined || d.signed !== undefined)
          throw new Error(
            "Analytic deviation does not accept reference-surface settings.",
          );
        inspectionFit(d.fit);
      }
    } else throw new Error("Unsupported saved inspection kind.");
    // Normalize to the supported fields instead of retaining arbitrary project payloads.
    const definition: InspectionDefinition =
      d.kind === "measurement"
        ? {
            kind: "measurement",
            measurement: {
              ...(d.measurement.kind === undefined
                ? {}
                : { kind: d.measurement.kind }),
              first: [
                d.measurement.first[0],
                d.measurement.first[1],
                d.measurement.first[2],
              ],
              second: [
                d.measurement.second[0],
                d.measurement.second[1],
                d.measurement.second[2],
              ],
              ...(d.measurement.kind && d.measurement.kind !== "distance"
                ? {
                    third: [
                      d.measurement.third[0],
                      d.measurement.third[1],
                      d.measurement.third[2],
                    ],
                  }
                : {}),
            },
          }
        : {
            kind: "deviation",
            entityId: d.entityId,
            ...(d.tolerance === undefined ? {} : { tolerance: d.tolerance }),
            ...(d.referenceId === undefined
              ? { fit: inspectionFit(d.fit) }
              : {
                  referenceId: d.referenceId,
                  maxDistance: d.maxDistance,
                  ...(d.signed === undefined ? {} : { signed: d.signed }),
                }),
          };
    return { id: item.id, name: item.name, definition };
  });
}
