import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Entity, Project, Positions, MeshSelectionState } from "./types";
import { validatePatch } from "./surfaces";
import { validateSketch } from "./sketch";
import { entityFeatureModel } from "./parametric-entities";

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

export function validatePositions(value: unknown): asserts value is Positions {
  if (
    (!Array.isArray(value) && !(value instanceof Float32Array)) ||
    !value.length ||
    value.length % 9 !== 0 ||
    !value.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    throw new Error(
      "Invalid triangle geometry: coordinates must be finite complete triangles.",
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
  if (extension === "stl" || extension === "ply") {
    const geometry =
      extension === "stl"
        ? new STLLoader().parse(data)
        : new PLYLoader().parse(data);
    try {
      if (extension === "ply" && !geometry.index)
        throw new Error(
          "PLY must contain polygon faces. Point clouds are not supported yet.",
        );
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
  const input = JSON.parse(text) as Partial<Project>;
  if (
    input.format !== "maliev-scanforge" ||
    input.version !== 1 ||
    input.units !== "mm" ||
    typeof input.name !== "string" ||
    input.name.length > 200 ||
    !Array.isArray(input.entities)
  ) {
    throw new Error("Unsupported ScanForge project format.");
  }
  const ids = new Set<string>();
  const entities: Entity[] = input.entities.map((entity) => {
    validatePositions(entity.positions);
    if (
      typeof entity.id !== "string" ||
      ids.has(entity.id) ||
      typeof entity.name !== "string" ||
      entity.name.length > 200 ||
      !["mesh", "cad", "plane", "sphere", "cylinder", "cone", "box"].includes(
        entity.kind,
      ) ||
      typeof entity.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(entity.color) ||
      typeof entity.visible !== "boolean" ||
      typeof entity.opacity !== "number" ||
      !Number.isFinite(entity.opacity) ||
      entity.opacity < 0 ||
      entity.opacity > 1
    )
      throw new Error("Invalid project object.");
    ids.add(entity.id);
    if (entity.meshSelection !== undefined)
      validateMeshSelection(entity.meshSelection, entity.positions.length / 9);
    if (
      entity.scanSource !== undefined &&
      (!Number.isSafeInteger(entity.scanSource.bytes) ||
        entity.scanSource.bytes < 0 ||
        !Number.isSafeInteger(entity.scanSource.triangles) ||
        entity.scanSource.triangles < 1 ||
        !Number.isSafeInteger(entity.scanSource.displayedTriangles) ||
        entity.scanSource.displayedTriangles < 1 ||
        entity.scanSource.displayedTriangles > entity.scanSource.triangles)
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
      entity.surfaceScanId !== undefined &&
      typeof entity.surfaceScanId !== "string"
    )
      throw new Error("Invalid surface scan reference.");
    return {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      positions: entity.positions,
      edgePositions: entity.edgePositions,
      color: entity.color,
      visible: entity.visible,
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
      source:
        typeof entity.source === "string"
          ? entity.source.slice(0, 200)
          : undefined,
      scanSource: entity.scanSource,
      parametric: entity.parametric,
    };
  });
  entityFeatureModel(entities);
  if (
    input.authoring !== undefined &&
    (!input.authoring || typeof input.authoring !== "object")
  )
    throw new Error("Invalid authoring metadata.");
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
        item.name.length > 200
      )
        throw new Error("Invalid saved sketch identity.");
      sketchIds.add(item.id);
      validateSketch(item.sketch);
    }
  }
  if (
    input.authoring?.activeSketchId !== undefined &&
    !input.authoring.sketches?.some(
      (s) => s.id === input.authoring!.activeSketchId,
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
  for (const entity of entities)
    if (entity.meshSelection !== undefined)
      validateMeshSelection(entity.meshSelection, entity.positions.length / 9);
  return JSON.stringify({
    format: "maliev-scanforge",
    version: 1,
    name,
    units: "mm",
    authoring,
    entities: entities.map(({ kernelId: _kernelId, fit: _fit, ...entity }) => ({
      ...entity,
      positions: Array.from(entity.positions),
    })),
  });
}
/** Preserve the v1 JSON wire format without boxing an entire large scan. */
export async function serializeProjectBlob(
  name: string,
  entities: Entity[],
  authoring?: Project["authoring"],
): Promise<Blob> {
  const parts: BlobPart[] = [
    `{"format":"maliev-scanforge","version":1,"name":${JSON.stringify(name)},"units":"mm",${authoring ? `"authoring":${JSON.stringify(authoring)},` : ""}"entities":[`,
  ];
  for (let index = 0; index < entities.length; index++) {
    const {
      kernelId: _kernelId,
      fit: _fit,
      positions,
      ...metadata
    } = entities[index];
    validatePositions(positions);
    if (metadata.meshSelection !== undefined)
      validateMeshSelection(metadata.meshSelection, positions.length / 9);
    if (index) parts.push(",");
    parts.push(JSON.stringify(metadata).slice(0, -1), ',"positions":[');
    for (let start = 0; start < positions.length; start += 65_536) {
      const end = Math.min(start + 65_536, positions.length);
      const values: string[] = [];
      for (let coordinate = start; coordinate < end; coordinate++)
        values.push(String(positions[coordinate]));
      parts.push(start ? "," : "", new Blob([values.join(",")]));
      // Yield between bounded batches so project saving remains cancellable by navigation.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    parts.push("]}");
  }
  parts.push("]}");
  return new Blob(parts, { type: "application/json" });
}
export function exportStl(entities: Entity[]): DataView {
  const group = new THREE.Group();
  for (const entity of entities) {
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
