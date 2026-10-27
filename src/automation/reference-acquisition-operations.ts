import type { CommandContext, Handler, WorkspaceHost } from "./api";
import type {
  CadClient,
  CadReferenceCoordinateSelection,
  CadReferenceFeatureFamily,
  CadReferenceFeatureRow,
} from "../cad/client";
import type { Entity, Vec3 } from "../types";
import { objectPickable } from "../object-operations";
import { isSampledScan } from "../scan-source";
import { indexedMeshMatches } from "../indexed-mesh";
import { encodeReferenceGeometry } from "../reference-construction-values";
import {
  bakeNativeMillimetreFloatPick,
  roundTripNativePickedCoordinate,
} from "../reference-pick-coordinates";
import { roundTripNativePreciseCoordinate } from "../reference-numeric-edit-fields";
import {
  copyReferenceCoordinateView,
  resolveReferenceScreenCoordinate,
  REFERENCE_SCREEN_TRIANGLE_LIMIT,
} from "../reference-coordinate-screen";

type Selection =
  | CadReferenceCoordinateSelection
  | {
      kind: "screen";
      x: number;
      y: number;
      view?: "main" | "moving" | "fixed";
      faceIndex?: number;
    };
type Witness = {
  entity: Entity;
  positions: Entity["positions"];
  indexedMesh: Entity["indexedMesh"];
  hidden: number[] | undefined;
  scanSource: Entity["scanSource"];
  recipe: Entity["parametric"];
  kernelId: string | undefined;
  brep: string | undefined;
  client: CadClient | undefined;
  generation: number | undefined;
};
type Acquisition = { position: Readonly<Vec3>; witness: Witness };

function source(host: WorkspaceHost, id: unknown): Entity {
  const matches = host.snapshot().entities.filter((entity) => entity.id === id);
  if (matches.length !== 1)
    throw new Error(
      "Reference acquisition requires one unique existing source entity.",
    );
  const entity = matches[0];
  if (!entity.visible || !objectPickable(entity))
    throw new Error(
      "Reference acquisition requires a visible unlocked selectable source.",
    );
  if (entity.kernelId) {
    if (!entity.brep)
      throw new Error("Exact CAD acquisition requires the source BREP.");
  } else if (entity.kind !== "mesh" || isSampledScan(entity.scanSource)) {
    throw new Error(
      "Reference acquisition requires exact CAD or an original unsampled source mesh; use reference_construction_pick for clouds.",
    );
  }
  return entity;
}

function witness(host: WorkspaceHost, entity: Entity): Witness {
  const client = entity.kernelId ? host.cad() : undefined;
  return Object.freeze({
    entity,
    positions: entity.positions,
    indexedMesh: entity.indexedMesh,
    hidden: entity.meshSelection?.hidden,
    scanSource: entity.scanSource,
    recipe: entity.parametric,
    kernelId: entity.kernelId,
    brep: entity.brep,
    client,
    generation: client?.referenceGeneration,
  });
}

function verify(host: WorkspaceHost, binding: Witness): void {
  const current = source(host, binding.entity.id);
  if (
    current !== binding.entity ||
    current.positions !== binding.positions ||
    current.indexedMesh !== binding.indexedMesh ||
    current.meshSelection?.hidden !== binding.hidden ||
    current.scanSource !== binding.scanSource ||
    current.parametric !== binding.recipe ||
    current.kernelId !== binding.kernelId ||
    current.brep !== binding.brep
  )
    throw new Error(
      "Reference acquisition source identity, geometry or BREP changed; acquire again.",
    );
  if (
    binding.client &&
    (host.cad() !== binding.client ||
      binding.client.referenceGeneration !== binding.generation)
  )
    throw new Error(
      "Reference acquisition CAD client or kernel generation changed; acquire again.",
    );
}

function vector(position: unknown): Vec3 {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    position.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9,
    )
  )
    throw new Error(
      "Reference acquisition coordinates exceed finite world bounds +/-1e9 mm.",
    );
  return [position[0], position[1], position[2]];
}

/** Original indexed IDs when their source witness remains valid; flat records otherwise. */
function meshCarrier(entity: Entity, screen = false) {
  // Refuse over-budget screen work before the existing linear topology validation.
  if (screen && entity.positions.length / 9 > REFERENCE_SCREEN_TRIANGLE_LIMIT)
    throw new Error(
      "Reference screen work exceeds 2000000 triangle visits. Split the source.",
    );
  const indexed = entity.indexedMesh;
  return indexed && indexedMeshMatches(indexed, entity.positions)
    ? { vertices: indexed.vertices, triangles: indexed.triangles }
    : { vertices: entity.positions, triangles: undefined };
}

function meshVertex(positions: Entity["positions"], index: number): Vec3 {
  if (
    positions.length % 3 !== 0 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= positions.length / 3
  )
    throw new Error(
      "Reference source vertex index is outside the original complete XYZ records.",
    );
  const offset = index * 3;
  return vector([
    positions[offset],
    positions[offset + 1],
    positions[offset + 2],
  ]);
}

function pageRows(
  rows: CadReferenceFeatureRow[],
  limit: number,
): CadReferenceFeatureRow[] {
  if (!Array.isArray(rows) || rows.length > limit)
    throw new Error("Invalid CAD reference feature page.");
  return rows.map((row) => {
    if (
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      typeof row.eligible !== "boolean"
    )
      throw new Error("Invalid CAD reference feature identity.");
    const result: CadReferenceFeatureRow = {
      index: row.index,
      eligible: row.eligible,
    };
    if (row.reason !== undefined)
      result.reason = String(row.reason).slice(0, 500);
    if (row.position !== undefined) result.position = vector(row.position);
    for (const key of ["firstParameter", "lastParameter"] as const)
      if (row[key] !== undefined) {
        if (!Number.isFinite(row[key]))
          throw new Error("Invalid CAD reference curve parameter.");
        result[key] = row[key];
      }
    for (const key of ["faceIndex", "firstTriangle", "triangleCount"] as const)
      if (row[key] !== undefined) {
        if (!Number.isSafeInteger(row[key]) || row[key]! < 0)
          throw new Error("Invalid CAD reference face range.");
        result[key] = row[key];
      }
    if (row.degenerate !== undefined) result.degenerate = !!row.degenerate;
    if (row.kind !== undefined) result.kind = String(row.kind).slice(0, 200);
    return result;
  });
}

/** Job-row data is API-owned and never a caller-authored point or persistent link. */
export function resolveReferenceAcquisitionJob(
  host: WorkspaceHost,
  context: CommandContext,
  jobId: string,
): Vec3 {
  if (!context.getCompletedJobData)
    throw new Error("Reference acquisition job ownership is unavailable.");
  const data = context.getCompletedJobData(
    jobId,
    "reference_construction_acquire",
    (value) => {
      const binding = value as Acquisition;
      if (!binding?.witness || !binding.position)
        throw new Error("Reference acquisition binding is unavailable.");
      verify(host, binding.witness);
    },
  ) as Acquisition;
  return vector(data.position);
}

/** Read-only native queries share the same serial API lane as other kernel jobs. */
export function createReferenceAcquisitionOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    reference_construction_features: async (args, context) => {
      context.check();
      const entity = source(host, args.entityId),
        binding = witness(host, entity);
      const family = args.family as CadReferenceFeatureFamily,
        offset = (args.offset as number | undefined) ?? 0,
        limit = (args.limit as number | undefined) ?? 50;
      let total: number,
        nextOffset: number | null,
        rows: CadReferenceFeatureRow[];
      if (binding.client) {
        const page = await binding.client.referenceFeatures(binding.kernelId!, {
          family,
          offset,
          limit,
        });
        context.check();
        verify(host, binding);
        if (
          !Number.isSafeInteger(page.total) ||
          page.total < 0 ||
          (page.nextOffset !== null &&
            (!Number.isSafeInteger(page.nextOffset) ||
              page.nextOffset <= offset ||
              page.nextOffset > page.total))
        )
          throw new Error("Invalid CAD feature pagination.");
        total = page.total;
        nextOffset = page.nextOffset;
        rows = pageRows(page.rows, limit);
      } else {
        if (family !== "vertices")
          throw new Error(
            "Source meshes expose original vertex records, not invented CAD edge/face topology.",
          );
        const carrier = meshCarrier(entity);
        if (carrier.vertices.length % 3 !== 0)
          throw new Error("Original mesh source has incomplete XYZ records.");
        total = carrier.vertices.length / 3;
        rows = [];
        for (
          let index = offset;
          index < Math.min(total, offset + limit);
          index++
        ) {
          context.check();
          try {
            rows.push({
              index,
              position: meshVertex(carrier.vertices, index),
              eligible: true,
            });
          } catch (error) {
            rows.push({
              index,
              eligible: false,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
        nextOffset = offset + rows.length < total ? offset + rows.length : null;
      }
      context.check();
      verify(host, binding);
      return {
        entityId: entity.id,
        sourceRevision: context.startRevision,
        units: "mm",
        coordinateSpace: "world",
        selectionModel: binding.client
          ? "exact-cad-topology"
          : "original-mesh-records",
        total,
        nextOffset,
        rows,
      };
    },
    reference_construction_acquire: async (args, context) => {
      context.check();
      const entity = source(host, args.entityId),
        binding = witness(host, entity),
        selection = args.selection as Selection;
      const check = () => {
        context.check();
        verify(host, binding);
      };
      let raw: Vec3, acquisition: string, selectionModel: string;
      if (selection.kind === "screen") {
        if (binding.client && binding.hidden?.length)
          throw new Error(
            "CAD screen acquisition cannot map hidden display triangles to canonical topology; clear hidden faces or select an exact vertex/edge.",
          );
        if (!host.referenceCoordinateView)
          throw new Error(
            "Reference camera and clipping capture is unavailable.",
          );
        const capture = copyReferenceCoordinateView(
          host.referenceCoordinateView(entity.id, selection.view),
        );
        const sameView = () => {
          check();
          if (
            JSON.stringify(
              copyReferenceCoordinateView(
                host.referenceCoordinateView!(entity.id, selection.view),
              ),
            ) !== JSON.stringify(capture)
          )
            throw new Error(
              "Reference acquisition camera/view/clipping changed while resolving the source; acquire again.",
            );
        };
        let mesh: {
            vertices: Entity["positions"];
            triangles: readonly number[] | Uint32Array;
          },
          range: { firstTriangle?: number; triangleCount?: number } = {};
        if (binding.client) {
          mesh = await binding.client.alignmentMesh(binding.kernelId!, {
            referenceAcquisition: true,
          });
          sameView();
          if (selection.faceIndex !== undefined) {
            const faces = await binding.client.alignmentReferences(
              binding.kernelId!,
            );
            sameView();
            const face = faces.find(
              (row) =>
                "faceIndex" in row && row.faceIndex === selection.faceIndex,
            );
            if (
              !face ||
              !("firstTriangle" in face) ||
              !("triangleCount" in face)
            )
              throw new Error(
                "Selected CAD face has no canonical triangle range.",
              );
            range = {
              firstTriangle: face.firstTriangle,
              triangleCount: face.triangleCount,
            };
          }
          acquisition = "cad-face-screen";
        } else {
          if (selection.faceIndex !== undefined)
            throw new Error(
              "Face indices require exact CAD topology; source meshes use normalized screen acquisition.",
            );
          const carrier = meshCarrier(entity, true);
          const positions = entity.positions;
          if (positions.length % 9 !== 0)
            throw new Error(
              "Reference source mesh requires complete original triangles.",
            );
          const count = positions.length / 9;
          if (count > REFERENCE_SCREEN_TRIANGLE_LIMIT)
            throw new Error(
              "Reference screen work exceeds 2000000 triangle visits. Split the source.",
            );
          if (carrier.triangles) {
            mesh = { vertices: carrier.vertices, triangles: carrier.triangles };
          } else {
            const triangles = new Uint32Array(count * 3);
            for (let index = 0; index < triangles.length; index++) {
              if ((index & 4095) === 0) check();
              triangles[index] = index;
            }
            mesh = { vertices: positions, triangles };
          }
          acquisition = "source-mesh-screen";
        }
        raw = resolveReferenceScreenCoordinate(mesh, capture, selection, {
          ...range,
          hiddenTriangles: binding.hidden,
          check,
        }).position;
        sameView();
        selectionModel = "application-canonical-triangle";
      } else if (binding.client) {
        raw = vector(
          (
            await binding.client.referenceCoordinate(
              binding.kernelId!,
              selection,
            )
          ).position,
        );
        check();
        acquisition = `cad-${selection.kind}`;
        selectionModel = "exact-cad-topology";
      } else {
        if (selection.kind !== "vertex")
          throw new Error(
            "Source mesh curve acquisition is unavailable; select an original vertex or screen surface.",
          );
        raw = meshVertex(meshCarrier(entity).vertices, selection.vertexIndex);
        acquisition = "source-mesh-vertex";
        selectionModel = "original-mesh-records";
      }
      check();
      const position =
        binding.client && selection.kind !== "screen"
          ? (raw.map(roundTripNativePreciseCoordinate) as Vec3)
          : (bakeNativeMillimetreFloatPick(raw).map(
              roundTripNativePickedCoordinate,
            ) as Vec3);
      if (!context.retainPrivateJobData)
        throw new Error("Reference acquisition job retention is unavailable.");
      context.retainPrivateJobData(
        Object.freeze({
          position: Object.freeze([...position]) as Readonly<Vec3>,
          witness: binding,
        }),
      );
      return {
        entityId: entity.id,
        sourceRevision: context.startRevision,
        position,
        positionEncoding: encodeReferenceGeometry({ kind: "point", position }),
        units: "mm",
        coordinateSpace: "world",
        acquisition,
        selectionModel,
        numericOnly: true,
        sourceDependencyRetained: false,
      };
    },
  };
}
