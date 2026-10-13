import { readScan, type ScanSource } from "./import-parser";
import { convertScanUnits, type ScanUnit } from "./import-units";
import { placeScanOnOrigin } from "./import-origin";
import { readAscPointCloud } from "./asc-import";
import type { parsePlyTopology } from "./ply-topology";

const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      file: File;
      extension: string;
      previewTriangles?: number;
      unit?: ScanUnit;
      placeAtOrigin?: boolean;
    }>,
  ) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  try {
    let source: ScanSource | undefined;
    let indexedMesh: ReturnType<typeof parsePlyTopology> | undefined;
    if (data.extension === "asc") {
      const cloud = await readAscPointCloud(data.file, {
        onProgress: (progress) => scope.postMessage({ progress }),
      });
      convertScanUnits(cloud.positions, data.unit);
      if (data.placeAtOrigin) placeScanOnOrigin(cloud.positions, true);
      const transfers = [cloud.positions.buffer as ArrayBuffer];
      if (cloud.normals) transfers.push(cloud.normals.buffer as ArrayBuffer);
      scope.postMessage(
        { positions: cloud.positions, pointCloud: { normals: cloud.normals } },
        transfers,
      );
      return;
    }
    const positions = await readScan(data.file, data.extension, {
      onIndexedMesh: (mesh) => {
        indexedMesh = mesh;
      },
      previewTriangles: data.previewTriangles,
      onSource: (value) => {
        source = value;
      },
      onProgress: (progress) => scope.postMessage({ progress }),
    });
    convertScanUnits(positions, data.unit);
    if (indexedMesh) convertScanUnits(indexedMesh.vertices, data.unit);
    if (data.placeAtOrigin)
      placeScanOnOrigin(
        positions,
        false,
        indexedMesh ? [indexedMesh.vertices] : [],
      );
    const transfers = [positions.buffer as ArrayBuffer];
    if (indexedMesh)
      transfers.push(
        indexedMesh.vertices.buffer as ArrayBuffer,
        indexedMesh.triangles.buffer as ArrayBuffer,
      );
    scope.postMessage({ positions, source, indexedMesh }, transfers);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
