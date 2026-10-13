import type { ScanFile } from "./import-parser";

export interface AscPointCloud {
  positions: Float32Array;
  normals?: Float32Array;
}

/** Two bounded streaming passes retain every point without retaining the full text. */
export async function readAscPointCloud(
  file: ScanFile,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<AscPointCloud> {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Import cancelled", "AbortError");
  };
  let count = 0,
    columns = 0;
  const scan = async (
    pass: number,
    accept: (values: number[], line: number) => void,
  ) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let carry = "",
      line = 0;
    const consume = (text: string) => {
      line++;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))
        return;
      const tokens = trimmed.split(/[\s,;]+/);
      if (tokens.length !== 3 && tokens.length !== 6)
        throw new Error(`ASC line ${line}: expected XYZ or XYZ with NX NY NZ.`);
      const values = tokens.map(Number);
      if (
        values.some(
          (v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)),
        ) ||
        values.slice(0, 3).some((v) => Math.abs(v) > 1e9)
      )
        throw new Error(
          `ASC line ${line}: coordinates and normals must be finite numbers.`,
        );
      if (columns && columns !== values.length)
        throw new Error(`ASC line ${line}: inconsistent point columns.`);
      columns = values.length;
      accept(values, line);
    };
    for (let offset = 0; offset < file.size; offset += 1_048_576) {
      check();
      const end = Math.min(file.size, offset + 1_048_576);
      carry += decoder.decode(await file.slice(offset, end).arrayBuffer(), {
        stream: true,
      });
      const lines = carry.split("\n");
      carry = lines.pop()!;
      for (let i = 0; i < lines.length; i++) {
        if (i % 4096 === 0) check();
        consume(lines[i]);
      }
      if (carry.length > 65_536)
        throw new Error(`ASC line ${line + 1}: point record is too long.`);
      options.onProgress?.((pass + end / file.size) / 2);
    }
    carry += decoder.decode();
    if (carry) consume(carry);
    check();
  };
  await scan(0, () => count++);
  if (!count) throw new Error("ASC file contains no points.");
  const positions = new Float32Array(count * 3),
    normals = columns === 6 ? new Float32Array(count * 3) : undefined;
  let point = 0;
  await scan(1, (values) => {
    if (point >= count) throw new Error("ASC file changed during import.");
    positions.set(values.slice(0, 3), point * 3);
    normals?.set(values.slice(3), point * 3);
    point++;
  });
  if (point !== count) throw new Error("ASC file changed during import.");
  options.onProgress?.(1);
  return { positions, normals };
}
