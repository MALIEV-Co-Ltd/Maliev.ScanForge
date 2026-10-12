import { readScan, type ScanSource } from "./import-parser";
import { convertScanUnits, type ScanUnit } from "./import-units";

const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      file: File;
      extension: string;
      previewTriangles?: number;
      unit?: ScanUnit;
    }>,
  ) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  try {
    let source: ScanSource | undefined;
    const positions = await readScan(data.file, data.extension, {
      previewTriangles: data.previewTriangles,
      onSource: (value) => {
        source = value;
      },
      onProgress: (progress) => scope.postMessage({ progress }),
    });
    convertScanUnits(positions, data.unit);
    scope.postMessage({ positions, source }, [positions.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
