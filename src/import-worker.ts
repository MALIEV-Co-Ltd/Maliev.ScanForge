import { readScan } from "./import-parser";

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ file: File; extension: string }>) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  try {
    const positions = await readScan(data.file, data.extension, {
      onProgress: (progress) => scope.postMessage({ progress }),
    });
    scope.postMessage({ positions }, [positions.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
