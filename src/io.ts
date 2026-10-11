import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Entity, Project } from "./types";

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_POSITION_VALUES = 6_000_000;
export function validatePositions(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length % 9 !== 0 ||
    value.length > MAX_POSITION_VALUES ||
    !value.every(
      (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e9,
    )
  ) {
    throw new Error(
      "Invalid or oversized triangle geometry. Maximum 666,666 triangles per object.",
    );
  }
}
export function geometryPositions(geometry: THREE.BufferGeometry): number[] {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  try {
    const attr = flat.getAttribute("position");
    if (!attr || attr.count % 3 !== 0)
      throw new Error(
        "A triangle mesh is required; point clouds are not supported yet.",
      );
    const positions = Array.from(attr.array);
    validatePositions(positions);
    return positions;
  } finally {
    if (flat !== geometry) flat.dispose();
  }
}
export function parseMesh(data: ArrayBuffer, extension: string): number[] {
  if (data.byteLength > MAX_FILE_BYTES)
    throw new Error("File exceeds the 64 MiB browser import limit.");
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
    const positions: number[] = [];
    try {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
        try {
          const part = geometryPositions(geometry);
          if (positions.length + part.length > MAX_POSITION_VALUES)
            throw new Error("OBJ exceeds the geometry import limit.");
          for (const x of part) positions.push(x);
        } finally {
          geometry.dispose();
        }
      });
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
  if (text.length > MAX_FILE_BYTES)
    throw new Error("Project exceeds the 64 MiB import limit.");
  const input = JSON.parse(text) as Partial<Project>;
  if (
    input.format !== "maliev-scanforge" ||
    input.version !== 1 ||
    input.units !== "mm" ||
    typeof input.name !== "string" ||
    input.name.length > 200 ||
    !Array.isArray(input.entities) ||
    input.entities.length > 100
  ) {
    throw new Error("Unsupported ScanForge project format.");
  }
  const ids = new Set<string>();
  let total = 0;
  const entities: Entity[] = input.entities.map((entity) => {
    validatePositions(entity.positions);
    total += entity.positions.length;
    if (
      total > MAX_POSITION_VALUES ||
      typeof entity.id !== "string" ||
      ids.has(entity.id) ||
      typeof entity.name !== "string" ||
      entity.name.length > 200 ||
      !["mesh", "cad", "plane", "sphere", "cylinder", "box"].includes(
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
    // Kernel handles are ephemeral; exact BRep is restored in a new worker.
    if (
      entity.brep !== undefined &&
      (typeof entity.brep !== "string" || entity.brep.length > MAX_FILE_BYTES)
    )
      throw new Error("Invalid CAD data.");
    return {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      positions: entity.positions,
      color: entity.color,
      visible: entity.visible,
      opacity: entity.opacity,
      brep: entity.brep,
      source:
        typeof entity.source === "string"
          ? entity.source.slice(0, 200)
          : undefined,
    };
  });
  return {
    format: "maliev-scanforge",
    version: 1,
    name: input.name,
    units: "mm",
    entities,
  };
}
export function serializeProject(name: string, entities: Entity[]): string {
  if (
    entities.length > 100 ||
    entities.reduce((sum, e) => sum + e.positions.length, 0) >
      MAX_POSITION_VALUES
  )
    throw new Error("Project exceeds the browser geometry limit.");
  const text = JSON.stringify({
    format: "maliev-scanforge",
    version: 1,
    name,
    units: "mm",
    entities: entities.map(
      ({ kernelId: _kernelId, fit: _fit, ...entity }) => entity,
    ),
  });
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES)
    throw new Error(
      "Project exceeds the 64 MiB save limit. Export smaller projects.",
    );
  return text;
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
