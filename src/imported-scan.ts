import { importScan } from "./import-client";
import { DEFAULT_PART_COLOR } from "./appearance";
import { isSampledScan } from "./scan-source";
import type { Entity } from "./types";

export const DEFAULT_IMPORT_PLACE_AT_ORIGIN = false;

/** Parse without changing the workspace; GUI and MCP publish through their owned transactions. */
export async function prepareImportedScan(
  file: File,
  options: Parameters<typeof importScan>[1] = {},
): Promise<Entity> {
  let normals: Entity["normals"],
    indexedMesh: Entity["indexedMesh"],
    scanSource: Entity["scanSource"];
  const positions = await importScan(file, {
    ...options,
    placeAtOrigin: options.placeAtOrigin ?? DEFAULT_IMPORT_PLACE_AT_ORIGIN,
    onMeshNormals: (value) => {
      normals = value;
    },
    onPointCloud: (value) => {
      normals = value.normals;
    },
    onIndexedMesh: (value) => {
      indexedMesh = value;
    },
    onSource: (value) => {
      scanSource = value;
    },
  });
  options.signal?.throwIfAborted();
  return {
    id: crypto.randomUUID(),
    name: file.name + (isSampledScan(scanSource) ? " [sampled preview]" : ""),
    kind: /\.asc$/i.test(file.name) ? "pointcloud" : "mesh",
    positions,
    normals,
    indexedMesh,
    scanSource,
    source: file.name,
    color: DEFAULT_PART_COLOR,
    visible: true,
    opacity: 1,
  };
}
