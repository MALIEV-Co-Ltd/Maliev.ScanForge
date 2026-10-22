import { readScan, type ScanSource } from "./import-parser";
import { convertScanUnits, type ScanUnit } from "./import-units";
import { placeScanOnOrigin } from "./import-origin";
import { readAscPointCloud, type AscAttributes } from "./asc-import";
import type { parsePlyTopology } from "./ply-topology";
import { prepareScanRenderData } from "./scan-render-data";

const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      file: File;
      extension: string;
      previewTriangles?: number;
      unit?: ScanUnit;
      placeAtOrigin?: boolean;
      ascAttributes?: AscAttributes;
    }>,
  ) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  try {
    let source: ScanSource | undefined;
    let indexedMesh: ReturnType<typeof parsePlyTopology> | undefined;
    let meshNormals: Float32Array | undefined;
    if (data.extension === "asc") {
      const cloud = await readAscPointCloud(data.file, {
        attributes: data.ascAttributes,
        onProgress: (progress) =>
          scope.postMessage({ progress: progress * 0.85 }),
      });
      convertScanUnits(cloud.positions, data.unit);
      if (data.placeAtOrigin) placeScanOnOrigin(cloud.positions, true);
      scope.postMessage({ progress: 0.9 });
      const renderData = prepareScanRenderData(
        cloud.positions,
        undefined,
        true,
      );
      const transfers = [cloud.positions.buffer as ArrayBuffer];
      if (cloud.normals) transfers.push(cloud.normals.buffer as ArrayBuffer);
      if (cloud.pointColors)
        transfers.push(cloud.pointColors.buffer as ArrayBuffer);
      scope.postMessage(
        {
          positions: cloud.positions,
          pointCloud: {
            normals: cloud.normals,
            pointColors: cloud.pointColors,
          },
          renderData,
        },
        transfers,
      );
      return;
    }
    const positions = await readScan(data.file, data.extension, {
      onMeshNormals: (normals) => {
        meshNormals = normals;
      },
      onIndexedMesh: (mesh) => {
        indexedMesh = mesh;
      },
      previewTriangles: data.previewTriangles,
      sharedReadonlyBuffers: true,
      onSource: (value) => {
        source = value;
      },
      onProgress: (progress) =>
        scope.postMessage({ progress: progress * 0.85 }),
    });
    convertScanUnits(positions, data.unit);
    if (indexedMesh) convertScanUnits(indexedMesh.vertices, data.unit);
    if (data.placeAtOrigin)
      placeScanOnOrigin(
        positions,
        false,
        indexedMesh ? [indexedMesh.vertices] : [],
      );
    scope.postMessage({ progress: 0.9 });
    const renderData = prepareScanRenderData(positions, indexedMesh);
    scope.postMessage({ progress: 0.95 });
    const transfers = [positions.buffer as ArrayBuffer];
    if (meshNormals) transfers.push(meshNormals.buffer as ArrayBuffer);
    if (renderData.normals)
      transfers.push(renderData.normals.buffer as ArrayBuffer);
    if (indexedMesh)
      transfers.push(
        indexedMesh.vertices.buffer as ArrayBuffer,
        indexedMesh.triangles.buffer as ArrayBuffer,
      );
    if (indexedMesh?.normals instanceof Float32Array)
      transfers.push(indexedMesh.normals.buffer as ArrayBuffer);
    scope.postMessage(
      { positions, source, indexedMesh, renderData, meshNormals },
      transfers.filter((buffer) => buffer instanceof ArrayBuffer),
    );
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
