import { validateSpatialCurves } from "./spatial-sketch";
import { validateMeshFacetNormals } from "./mesh-geometry-normals";
import { validateInspectionDefinitions } from "./inspection-definition";
import { validateSavedSketchDisplay } from "./saved-sketch-display";
import {
  encodeReferenceFrame,
  decodeReferenceFrame,
  validateReferenceFrameEntity,
} from "./reference-frame";
import { validateRollMappingEntity } from "./scan-unroll-auxiliary";
import * as THREE from "three";
import {
  validatePointCloudDisplay,
  DEFAULT_POINT_CLOUD_COLOR,
} from "./appearance";
import {
  placedCloud,
  cloudPlacement,
  cloudPlacementJson,
  cloudPoseMatrix,
} from "./point-cloud-placement";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { parsePlyTopology, expandPlyTopology } from "./ply-topology";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type {
  Entity,
  Project,
  Positions,
  MeshSelectionState,
  SavedSketch,
} from "./types";
import { validatePatch } from "./surfaces";
import { validateSketch } from "./sketch";
import { entityFeatureModel } from "./parametric-entities";
import { validatePlaneFrame } from "./plane-frame";
import { indexedMeshMatches, retainIndexedMesh } from "./indexed-mesh";
import {
  isReferenceEntity,
  validateReferenceEntity,
  validateConstructionOrderKeys,
  encodeReferenceEntityData,
  decodeReferenceEntityData,
} from "./reference-entity";

/** Validate imported cloud attributes before converting untrusted JSON bytes. */
export function validatePointCloudAttributes(entity: {
  kind?: unknown;
  positions: { length: number };
  pointColors?: unknown;
  ascAttributes?: unknown;
}): Uint8Array | undefined {
  if (
    entity.ascAttributes !== undefined &&
    (entity.kind !== "pointcloud" ||
      !["xyz-normal", "xyz-rgb"].includes(entity.ascAttributes as string))
  )
    throw new Error("Invalid ASC attribute interpretation.");
  const colors = entity.pointColors;
  if (colors === undefined) return undefined;
  if (
    entity.kind !== "pointcloud" ||
    !(colors instanceof Uint8Array || Array.isArray(colors)) ||
    colors.length !== (entity.positions.length / 3) * 4
  )
    throw new Error("Invalid point-cloud RGBA colors.");
  for (let i = 0; i < colors.length; i++)
    if (
      !Number.isInteger(colors[i]) ||
      colors[i] < 0 ||
      colors[i] > 255 ||
      (i % 4 === 3 && colors[i] !== 255)
    )
      throw new Error("Point-cloud colors must be opaque RGBA bytes.");
  return colors instanceof Uint8Array ? colors : Uint8Array.from(colors);
}

/** Validate sparse triangle slots without allocating a mask proportional to mesh size. */
export function validateMeshSelection(
  value: unknown,
  triangleCount: number,
): asserts value is MeshSelectionState {
  const invalid = () => {
    throw new Error("Invalid mesh selection metadata.");
  };
  if (!Number.isSafeInteger(triangleCount) || triangleCount < 1) invalid();
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const state = value as Partial<MeshSelectionState>;
  const validateSlots = (slots: unknown) => {
    if (!Array.isArray(slots) || slots.length > triangleCount) invalid();
    let previous = -1;
    for (const slot of slots as unknown[]) {
      if (
        typeof slot !== "number" ||
        !Number.isSafeInteger(slot) ||
        slot <= previous ||
        slot >= triangleCount
      )
        invalid();
      previous = slot as number;
    }
  };
  validateSlots(state.hidden);
  if (!Array.isArray(state.saved)) invalid();
  const ids = new Set<string>();
  for (const saved of state.saved!) {
    if (
      !saved ||
      typeof saved !== "object" ||
      Array.isArray(saved) ||
      typeof saved.id !== "string" ||
      !saved.id.trim() ||
      saved.id.length > 200 ||
      ids.has(saved.id) ||
      typeof saved.name !== "string" ||
      !saved.name.trim() ||
      saved.name.length > 200
    )
      invalid();
    ids.add(saved.id);
    validateSlots(saved.triangles);
  }
}

export function validatePositions(
  value: unknown,
  pointCloud = false,
): asserts value is Positions {
  if (
    (!Array.isArray(value) && !(value instanceof Float32Array)) ||
    !value.length ||
    value.length % (pointCloud ? 3 : 9) !== 0 ||
    !value.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    throw new Error(
      pointCloud
        ? "Invalid point geometry: coordinates must be finite complete XYZ points."
        : "Invalid triangle geometry: coordinates must be finite complete triangles.",
    );
  }
}
export function geometryPositions(
  geometry: THREE.BufferGeometry,
): Float32Array {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  try {
    const attr = flat.getAttribute("position");
    if (!attr || attr.count % 3 !== 0)
      throw new Error(
        "A triangle mesh is required; point clouds are not supported yet.",
      );
    const positions =
      attr.array instanceof Float32Array
        ? attr.array
        : new Float32Array(attr.array);
    validatePositions(positions);
    return positions;
  } finally {
    if (flat !== geometry) flat.dispose();
  }
}
export function parseMesh(data: ArrayBuffer, extension: string): Float32Array {
  if (extension === "ply") return expandPlyTopology(parsePlyTopology(data));
  if (extension === "stl") {
    const geometry = new STLLoader().parse(data);
    try {
      return geometryPositions(geometry);
    } finally {
      geometry.dispose();
    }
  }
  if (extension === "obj") {
    const object = new OBJLoader().parse(new TextDecoder().decode(data));
    object.updateMatrixWorld(true);
    const parts: Float32Array[] = [];
    let size = 0;
    try {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
        try {
          const part = geometryPositions(geometry);
          parts.push(part);
          size += part.length;
        } finally {
          geometry.dispose();
        }
      });
      const positions = new Float32Array(size);
      let offset = 0;
      for (const part of parts) {
        positions.set(part, offset);
        offset += part.length;
      }
      validatePositions(positions);
      return positions;
    } finally {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const material of materials) material.dispose();
        }
      });
    }
  }
  throw new Error("Supported scan formats: STL, OBJ and polygon PLY.");
}
export function parseProject(text: string): Project {
  const input = JSON.parse(text);
  if (Array.isArray(input?.entities))
    input.entities = input.entities.map((entity: Entity) => {
      if (entity?.rollMapping !== undefined && ![4, 5].includes(input.version))
        throw Error("Unroll mapping requires project JSON version 4.");
      if (
        entity?.reference !== undefined ||
        entity?.coordinateFrame !== undefined ||
        entity?.constructionOrderKey !== undefined
      ) {
        if (![3, 4, 5].includes(input.version))
          throw new Error(
            "Construction metadata requires project JSON version 3.",
          );
        return {
          ...entity,
          ...(entity.reference !== undefined
            ? { reference: decodeReferenceEntityData(entity.reference) }
            : {}),
          ...(entity.coordinateFrame !== undefined
            ? { coordinateFrame: decodeReferenceFrame(entity.coordinateFrame) }
            : {}),
        };
      }
      return entity;
    });
  if (
    input.authoring?.sketches?.some(
      (row: SavedSketch) => row.visible !== undefined,
    ) &&
    ![4, 5].includes(input.version)
  )
    throw Error("Saved sketch visibility requires project JSON version 4.");
  if (
    input.authoring?.sketches?.some(
      (row: SavedSketch) => row.kind === "spatial",
    ) &&
    input.version !== 5
  )
    throw Error("Spatial sketches require project JSON version 5.");
  return validateProject(input);
}
/** Validate decoded project data without expanding binary geometry into JSON. */
export function validateProject(value: unknown): Project {
  if (!value || typeof value !== "object")
    throw new Error("Unsupported ScanForge project format.");
  const input = value as Partial<Project>;
  if (
    input.format !== "maliev-scanforge" ||
    ![1, 2, 3, 4, 5].includes(input.version as number) ||
    input.units !== "mm" ||
    typeof input.name !== "string" ||
    input.name.length > 200 ||
    !Array.isArray(input.entities)
  ) {
    throw new Error("Unsupported ScanForge project format.");
  }
  const ids = new Set<string>();
  validateConstructionOrderKeys(input.entities);
  const entities: Entity[] = input.entities.map((entity) => {
    const reference = validateReferenceEntity(entity);
    const coordinateFrame = validateReferenceFrameEntity(entity);
    const rollMapping = validateRollMappingEntity(entity);
    if (!isReferenceEntity(entity) && entity.kind !== "referenceFrame")
      validatePositions(entity.positions, entity.kind === "pointcloud");
    const pointColors = validatePointCloudAttributes(entity);
    if (
      entity.indexedMesh !== undefined &&
      (entity.kind !== "mesh" ||
        !indexedMeshMatches(entity.indexedMesh, entity.positions))
    )
      throw new Error("Invalid or stale indexed mesh topology.");
    if (
      typeof entity.id !== "string" ||
      ids.has(entity.id) ||
      typeof entity.name !== "string" ||
      entity.name.length > 200 ||
      ![
        "mesh",
        "pointcloud",
        "cad",
        "plane",
        "sphere",
        "cylinder",
        "cone",
        "box",
        "referencePoint",
        "referenceLine",
        "referenceFrame",
      ].includes(entity.kind) ||
      typeof entity.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(entity.color) ||
      typeof entity.visible !== "boolean" ||
      (entity.selectable !== undefined &&
        typeof entity.selectable !== "boolean") ||
      (entity.locked !== undefined && typeof entity.locked !== "boolean") ||
      typeof entity.opacity !== "number" ||
      !Number.isFinite(entity.opacity) ||
      entity.opacity < 0 ||
      entity.opacity > 1
    )
      throw new Error("Invalid project object.");
    validatePointCloudDisplay(entity);
    ids.add(entity.id);
    if (entity.planeFrame !== undefined)
      validatePlaneFrame(entity.planeFrame, entity.positions, entity.kind);
    if (entity.meshSelection !== undefined)
      validateMeshSelection(
        entity.meshSelection,
        entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9),
      );
    if (
      entity.scanSource !== undefined &&
      (!Number.isSafeInteger(entity.scanSource.bytes) ||
        entity.scanSource.bytes < 0 ||
        !Number.isSafeInteger(entity.scanSource.triangles) ||
        entity.scanSource.triangles < 1 ||
        !Number.isSafeInteger(entity.scanSource.displayedTriangles) ||
        entity.scanSource.displayedTriangles < 1 ||
        entity.scanSource.displayedTriangles > entity.scanSource.triangles ||
        (entity.scanSource.acceptedTriangles !== undefined &&
          (!Number.isSafeInteger(entity.scanSource.acceptedTriangles) ||
            entity.scanSource.acceptedTriangles < 1 ||
            entity.scanSource.acceptedTriangles > entity.scanSource.triangles ||
            entity.scanSource.displayedTriangles >
              entity.scanSource.acceptedTriangles)))
    )
      throw new Error("Invalid scan source counts.");
    // Kernel handles are ephemeral; exact BRep is restored in a new worker.
    if (entity.brep !== undefined && typeof entity.brep !== "string")
      throw new Error("Invalid CAD data.");
    if (
      entity.edgePositions !== undefined &&
      (!Array.isArray(entity.edgePositions) ||
        entity.edgePositions.length % 6 !== 0 ||
        entity.edgePositions.some(
          (v) => !Number.isFinite(v) || Math.abs(v) > 1e9,
        ))
    )
      throw new Error("Invalid CAD edge geometry.");
    if (entity.surfacePatch !== undefined) validatePatch(entity.surfacePatch);
    if (
      entity.normals !== undefined &&
      (!(
        Array.isArray(entity.normals) || entity.normals instanceof Float32Array
      ) ||
        entity.normals.length !== entity.positions.length ||
        !entity.normals.every(Number.isFinite))
    )
      throw new Error("Invalid CAD normals or point-cloud normals.");
    if (
      entity.surfaceScanId !== undefined &&
      typeof entity.surfaceScanId !== "string"
    )
      throw new Error("Invalid surface scan reference.");
    if (entity.authoringLinks !== undefined) {
      const links = entity.authoringLinks;
      if (
        !links ||
        typeof links !== "object" ||
        Array.isArray(links) ||
        Object.keys(links).some(
          (key) => !["featureId", "output", "references"].includes(key),
        ) ||
        typeof links.featureId !== "string" ||
        !links.featureId.length ||
        links.featureId.length > 200 ||
        !Number.isInteger(links.output) ||
        links.output < 0 ||
        links.output > 10000 ||
        !Array.isArray(links.references) ||
        links.references.length > 10000 ||
        links.references.some(
          (id) => typeof id !== "string" || !id.length || id.length > 200,
        ) ||
        new Set(links.references).size !== links.references.length
      )
        throw new Error("Invalid retained authoring references.");
    }
    const result: Entity = {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      positions: entity.positions,
      ...(entity.constructionOrderKey !== undefined
        ? { constructionOrderKey: entity.constructionOrderKey }
        : {}),
      ...(reference !== undefined ? { reference } : {}),
      ...(coordinateFrame !== undefined ? { coordinateFrame } : {}),
      ...(rollMapping !== undefined ? { rollMapping } : {}),
      indexedMesh: entity.indexedMesh,
      normals: entity.normals,
      ...(pointColors !== undefined ? { pointColors } : {}),
      ...(entity.ascAttributes !== undefined
        ? { ascAttributes: entity.ascAttributes }
        : {}),
      edgePositions: entity.edgePositions,
      planeFrame:
        entity.planeFrame === undefined
          ? undefined
          : {
              center: [...entity.planeFrame.center],
              normal: [...entity.planeFrame.normal],
              tangent: [...entity.planeFrame.tangent],
            },
      color: entity.color,
      ...(entity.pointAutoDensity !== undefined
        ? { pointAutoDensity: entity.pointAutoDensity }
        : {}),
      ...(entity.pointDensity !== undefined
        ? { pointDensity: entity.pointDensity }
        : {}),
      ...(entity.pointSize !== undefined
        ? { pointSize: entity.pointSize }
        : {}),
      ...(entity.pointColorMode !== undefined
        ? { pointColorMode: entity.pointColorMode }
        : {}),
      visible: entity.visible,
      selectable: entity.selectable,
      locked: entity.locked,
      opacity: entity.opacity,
      meshSelection:
        entity.meshSelection === undefined
          ? undefined
          : {
              hidden: [...entity.meshSelection.hidden],
              saved: entity.meshSelection.saved.map(
                ({ id, name, triangles }) => ({
                  id,
                  name,
                  triangles: [...triangles],
                }),
              ),
            },
      brep: entity.brep,
      surfacePatch: entity.surfacePatch,
      surfaceScanId: entity.surfaceScanId,
      authoringLinks:
        entity.authoringLinks === undefined
          ? undefined
          : {
              featureId: entity.authoringLinks.featureId,
              output: entity.authoringLinks.output,
              references: [...entity.authoringLinks.references],
            },
      source:
        typeof entity.source === "string"
          ? entity.source.slice(0, 200)
          : undefined,
      scanSource: entity.scanSource,
      parametric: entity.parametric,
    };
    // Old neutral cloud colors were implicit defaults, before color modes existed.
    if (
      result.kind === "pointcloud" &&
      result.pointColorMode === undefined &&
      /^#(?:ffffff|a6a6a6)$/i.test(result.color)
    ) {
      result.color = DEFAULT_POINT_CLOUD_COLOR;
      result.pointColorMode = "solid";
    }
    if (entity.pointCloudPlacement !== undefined) {
      const p = entity.pointCloudPlacement;
      if (
        entity.kind !== "pointcloud" ||
        !p ||
        typeof p !== "object" ||
        Object.keys(p).some(
          (k) =>
            !["matrixBits", "sourcePositions", "sourceNormals"].includes(k),
        )
      )
        throw new Error("Invalid point-cloud placement.");
      cloudPoseMatrix(p.matrixBits);
      validatePositions(p.sourcePositions, true);
      if (
        p.sourcePositions.length !== entity.positions.length ||
        (p.sourceNormals !== undefined &&
          (!(
            Array.isArray(p.sourceNormals) ||
            p.sourceNormals instanceof Float32Array
          ) ||
            p.sourceNormals.length !== p.sourcePositions.length ||
            !p.sourceNormals.every(Number.isFinite)))
      )
        throw new Error("Invalid point-cloud placement buffers.");
      const existing = cloudPlacement(entity);
      const placement = existing ?? {
        matrixBits: p.matrixBits,
        sourcePositions:
          p.sourcePositions instanceof Float32Array
            ? p.sourcePositions
            : new Float32Array(p.sourcePositions),
        sourceNormals: p.sourceNormals,
      };
      const posed = placedCloud(result, placement);
      // Compatibility positions must describe the same world geometry as the pose.
      const world = posed.positions;
      const compatibilityPositions = entity.positions;
      if (world.some((v, i) => v !== compatibilityPositions[i]))
        throw new Error("Point-cloud placement disagrees with world geometry.");
      const normals = posed.normals,
        compatibilityNormals = entity.normals;
      if (
        !!normals !== !!compatibilityNormals ||
        normals?.some((v, i) => v !== compatibilityNormals![i])
      )
        throw new Error("Point-cloud placement disagrees with world normals.");
      return posed;
    }
    return result;
  });
  entityFeatureModel(entities);
  if (
    input.authoring !== undefined &&
    (!input.authoring || typeof input.authoring !== "object")
  )
    throw new Error("Invalid authoring metadata.");
  if (input.authoring?.inspections !== undefined)
    validateInspectionDefinitions(input.authoring.inspections);
  if (input.authoring?.sketch !== undefined)
    validateSketch(input.authoring.sketch);
  if (input.authoring?.sketches !== undefined) {
    if (!Array.isArray(input.authoring.sketches))
      throw new Error("Invalid saved sketches.");
    const sketchIds = new Set<string>();
    for (const item of input.authoring.sketches) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        sketchIds.has(item.id) ||
        typeof item.name !== "string" ||
        (item.visible !== undefined && typeof item.visible !== "boolean") ||
        item.name.length > 200
      )
        throw new Error("Invalid saved sketch identity.");
      sketchIds.add(item.id);
      if (item.kind === "spatial") {
        if ("sketch" in item)
          throw Error("Spatial sketch cannot contain planar data.");
        validateSpatialCurves(item.curves);
      } else {
        if (
          (item.kind !== undefined && item.kind !== "planar") ||
          "curves" in item
        )
          throw Error("Invalid planar sketch variant.");
        validateSketch(item.sketch);
      }
      if (item.visible) validateSavedSketchDisplay(item);
    }
  }
  if (
    input.authoring?.activeSketchId !== undefined &&
    !input.authoring.sketches?.some(
      (s) => s.id === input.authoring!.activeSketchId && s.kind !== "spatial",
    )
  )
    throw new Error("Active saved sketch is missing.");
  return {
    format: "maliev-scanforge",
    version: 1,
    name: input.name,
    units: "mm",
    entities,
    authoring: input.authoring
      ? {
          inspections:
            input.authoring.inspections === undefined
              ? undefined
              : validateInspectionDefinitions(input.authoring.inspections),
          sketch: input.authoring.sketch,
          sketches: input.authoring.sketches,
          activeSketchId: input.authoring.activeSketchId,
        }
      : undefined,
  };
}
export function serializeProject(
  name: string,
  entities: Entity[],
  authoring?: Project["authoring"],
): string {
  validateConstructionOrderKeys(entities);
  for (const entity of entities) {
    validateReferenceEntity(entity);
    if (entity.indexedMesh) validateMeshFacetNormals(entity.indexedMesh);
    validateRollMappingEntity(entity);
  }
  entities = entities.map(retainIndexedMesh);
  for (const entity of entities) validatePointCloudAttributes(entity);
  for (const entity of entities)
    if (entity.planeFrame !== undefined)
      validatePlaneFrame(entity.planeFrame, entity.positions, entity.kind);
  for (const entity of entities)
    if (entity.meshSelection !== undefined)
      validateMeshSelection(
        entity.meshSelection,
        entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9),
      );
  return JSON.stringify({
    format: "maliev-scanforge",
    version: authoring?.sketches?.some((row) => row.kind === "spatial")
      ? 5
      : entities.some((e) => e.rollMapping !== undefined) ||
          authoring?.sketches?.some((row) => row.visible !== undefined)
        ? 4
        : entities.some(
              (e) =>
                e.reference !== undefined ||
                e.coordinateFrame !== undefined ||
                e.constructionOrderKey !== undefined,
            )
          ? 3
          : entities.some(
                (e) =>
                  e.pointColors !== undefined || e.ascAttributes !== undefined,
              )
            ? 2
            : 1,
    name,
    units: "mm",
    authoring,
    entities: entities.map(({ kernelId: _kernelId, fit: _fit, ...entity }) => ({
      ...entity,
      ...(entity.reference !== undefined
        ? { reference: encodeReferenceEntityData(entity.reference) }
        : {}),
      ...(entity.coordinateFrame !== undefined
        ? { coordinateFrame: encodeReferenceFrame(entity.coordinateFrame) }
        : {}),
      positions: Array.from(entity.positions),
      ...(entity.pointColors !== undefined
        ? { pointColors: Array.from(entity.pointColors) }
        : {}),
      ...(entity.normals instanceof Float32Array
        ? { normals: Array.from(entity.normals) }
        : {}),
      pointCloudPlacement: cloudPlacementJson(entity as Entity),
      indexedMesh: entity.indexedMesh
        ? {
            vertices: Array.from(entity.indexedMesh.vertices),
            triangles: Array.from(entity.indexedMesh.triangles),
            ...(entity.indexedMesh.normals
              ? { normals: Array.from(entity.indexedMesh.normals) }
              : {}),
            ...(entity.indexedMesh.facetNormals
              ? { facetNormals: Array.from(entity.indexedMesh.facetNormals) }
              : {}),
            ...(entity.indexedMesh.geometryNormals
              ? {
                  geometryNormals: Array.from(
                    entity.indexedMesh.geometryNormals,
                  ),
                }
              : {}),
          }
        : undefined,
    })),
  });
}
/** Preserve the v1 JSON wire format without boxing an entire large scan. */
export async function serializeProjectBlob(
  name: string,
  entities: Entity[],
  authoring?: Project["authoring"],
): Promise<Blob> {
  validateConstructionOrderKeys(entities);
  for (const entity of entities) {
    validateReferenceEntity(entity);
    if (entity.indexedMesh) validateMeshFacetNormals(entity.indexedMesh);
    validateRollMappingEntity(entity);
  }
  entities = entities.map(retainIndexedMesh);
  for (const entity of entities) validatePointCloudAttributes(entity);
  const version = authoring?.sketches?.some((row) => row.kind === "spatial")
    ? 5
    : entities.some((e) => e.rollMapping !== undefined) ||
        authoring?.sketches?.some((row) => row.visible !== undefined)
      ? 4
      : entities.some(
            (e) =>
              e.reference !== undefined ||
              e.coordinateFrame !== undefined ||
              e.constructionOrderKey !== undefined,
          )
        ? 3
        : entities.some(
              (e) =>
                e.pointColors !== undefined || e.ascAttributes !== undefined,
            )
          ? 2
          : 1;
  const parts: BlobPart[] = [
    `{"format":"maliev-scanforge","version":${version},"name":${JSON.stringify(name)},"units":"mm",${authoring ? `"authoring":${JSON.stringify(authoring)},` : ""}"entities":[`,
  ];
  for (let index = 0; index < entities.length; index++) {
    const {
      kernelId: _kernelId,
      fit: _fit,
      positions,
      normals,
      pointColors,
      indexedMesh,
      pointCloudPlacement: _placement,
      ...metadata
    } = entities[index];
    if (!isReferenceEntity(metadata) && metadata.kind !== "referenceFrame")
      validatePositions(positions, metadata.kind === "pointcloud");
    if (metadata.planeFrame !== undefined)
      validatePlaneFrame(metadata.planeFrame, positions, metadata.kind);
    if (metadata.meshSelection !== undefined)
      validateMeshSelection(
        metadata.meshSelection,
        positions.length / (metadata.kind === "pointcloud" ? 3 : 9),
      );
    if (index) parts.push(",");
    parts.push(
      JSON.stringify({
        ...metadata,
        ...(metadata.reference !== undefined
          ? { reference: encodeReferenceEntityData(metadata.reference) }
          : {}),
        ...(metadata.coordinateFrame !== undefined
          ? { coordinateFrame: encodeReferenceFrame(metadata.coordinateFrame) }
          : {}),
        pointCloudPlacement: cloudPlacementJson(entities[index]),
      }).slice(0, -1),
      ',"positions":[',
    );
    for (let start = 0; start < positions.length; start += 65_536) {
      const end = Math.min(start + 65_536, positions.length);
      const values: string[] = [];
      for (let coordinate = start; coordinate < end; coordinate++)
        values.push(String(positions[coordinate]));
      parts.push(start ? "," : "", new Blob([values.join(",")]));
      // Yield between bounded batches so project saving remains cancellable by navigation.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    parts.push("]");
    if (pointColors !== undefined) {
      parts.push(',"pointColors":[');
      for (let first = 0; first < pointColors.length; first += 65536) {
        parts.push(
          first ? "," : "",
          new Blob([
            Array.from(pointColors.subarray(first, first + 65536), String).join(
              ",",
            ),
          ]),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      parts.push("]");
    }
    if (normals) {
      if (
        normals.length !== positions.length ||
        !normals.every(Number.isFinite)
      )
        throw new Error("Invalid project normals.");
      parts.push(',"normals":[');
      for (let first = 0; first < normals.length; first += 65536) {
        parts.push(
          first ? "," : "",
          new Blob([
            Array.from(
              normals.slice(first, Math.min(normals.length, first + 65536)),
              String,
            ).join(","),
          ]),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      parts.push("]");
    }
    if (indexedMesh) {
      parts.push(',"indexedMesh":{');
      for (const [field, values] of [
        ["vertices", indexedMesh.vertices],
        ["triangles", indexedMesh.triangles],
        ["normals", indexedMesh.normals],
        ["geometryNormals", indexedMesh.geometryNormals],
        ["facetNormals", indexedMesh.facetNormals],
      ] as const) {
        if (!values) continue;
        parts.push(field === "vertices" ? "" : ",", `"${field}":[`);
        for (let start = 0; start < values.length; start += 65_536) {
          const batch: string[] = [];
          for (
            let id = start;
            id < Math.min(start + 65_536, values.length);
            id++
          )
            batch.push(String(values[id]));
          parts.push(start ? "," : "", new Blob([batch.join(",")]));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        parts.push("]");
      }
      parts.push("}");
    }
    parts.push("}");
  }
  parts.push("]}");
  return new Blob(parts, { type: "application/json" });
}
export function exportStl(entities: Entity[]): DataView {
  const group = new THREE.Group();
  for (const entity of entities) {
    if (entity.kind === "pointcloud" || entity.kind === "referenceFrame")
      continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(entity.positions, 3),
    );
    group.add(new THREE.Mesh(geometry));
  }
  try {
    return new STLExporter().parse(group, { binary: true });
  } finally {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
}
export function download(
  data: BlobPart,
  name: string,
  type = "application/octet-stream",
): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
