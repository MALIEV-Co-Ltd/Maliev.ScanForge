import { importScan } from "./import-client";
import { DEFAULT_PART_COLOR, DEFAULT_POINT_CLOUD_COLOR } from "./appearance";
import { isSampledScan } from "./scan-source";
import type { Entity } from "./types";
import { DEFAULT_ASC_ATTRIBUTES } from "./asc-import";

export const DEFAULT_IMPORT_PLACE_AT_ORIGIN = false;

/** Parse without changing the workspace; GUI and MCP publish through their owned transactions. */
export async function prepareImportedScan(
  file: File,
  options: Parameters<typeof importScan>[1] = {},
): Promise<Entity> {
  let normals: Entity["normals"],
    pointColors: Entity["pointColors"],
    indexedMesh: Entity["indexedMesh"],
    scanSource: Entity["scanSource"];
  const positions = await importScan(file, {
    ...options,
    placeAtOrigin: options.placeAtOrigin ?? DEFAULT_IMPORT_PLACE_AT_ORIGIN,
    ascAttributes: options.ascAttributes ?? DEFAULT_ASC_ATTRIBUTES,
    onMeshNormals: (value) => {
      normals = value;
    },
    onPointCloud: (value) => {
      normals = value.normals;
      pointColors = value.pointColors;
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
    pointColors,
    ...(/\.asc$/i.test(file.name) ? { pointColorMode: "solid" as const } : {}),
    ascAttributes: /\.asc$/i.test(file.name)
      ? (options.ascAttributes ?? DEFAULT_ASC_ATTRIBUTES)
      : undefined,
    indexedMesh,
    scanSource,
    source: file.name,
    color: /\.asc$/i.test(file.name)
      ? DEFAULT_POINT_CLOUD_COLOR
      : DEFAULT_PART_COLOR,
    visible: true,
    opacity: 1,
  };
}
