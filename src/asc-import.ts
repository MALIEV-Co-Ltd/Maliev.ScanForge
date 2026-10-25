import type { ScanFile } from "./import-parser";

export interface AscPointCloud {
  positions: Float32Array;
  normals?: Float32Array;
  pointColors?: Uint8Array;
}

export type AscAttributes = "xyz-rgb" | "xyz-normal";
export const DEFAULT_ASC_ATTRIBUTES: AscAttributes = "xyz-rgb";

/** Two bounded streaming passes retain every point without retaining the full text. */
export async function readAscPointCloud(
  file: ScanFile,
  options: {
    attributes?: AscAttributes;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<AscPointCloud> {
  const attributes = options.attributes ?? DEFAULT_ASC_ATTRIBUTES;
  if (attributes !== "xyz-rgb" && attributes !== "xyz-normal")
    throw new Error("Unsupported ASC attribute interpretation.");
  if (attributes === "xyz-rgb") return readAscColors(file, options);
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

/** Observed native XYZ/RGB scan formats; the explicit normal mode retains the extension. */
async function readAscColors(
  file: ScanFile,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void },
): Promise<AscPointCloud> {
  const check = () => options.signal?.throwIfAborted();
  let separator: string | undefined;
  let examined = 0;
  const float =
    /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|infinity|inf|nan)/i;
  const integer = /^[+-]?\d+/;
  const parse = (
    text: string,
    delimiter: string,
    rgb = false,
  ): number[] | undefined => {
    const values: number[] = [];
    let rest = text;
    for (let i = 0; i < (rgb ? 6 : 3); i++) {
      if (i && delimiter !== " ") {
        if (!rest.startsWith(delimiter)) return;
        rest = rest.slice(1);
      }
      rest = rest.trimStart();
      const match = (i < 3 ? float : integer).exec(rest);
      if (!match) return;
      values.push(Number(match[0]));
      rest = rest.slice(match[0].length);
    }
    return values;
  };
  const scan = async (
    pass: number,
    accept: (values: number[], colors: number[]) => void,
  ) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let carry = "";
    const consume = (text: string) => {
      if (!separator) {
        if (++examined > 50)
          throw new Error(
            "ASC has no XYZ record in its first 50 native reader chunks.",
          );
        separator = [" ", ",", ";"].find((candidate) => parse(text, candidate));
        if (!separator) return;
      }
      const xyz = parse(text, separator);
      if (!xyz) return;
      if (
        xyz.some(
          (value) =>
            !Number.isFinite(Math.fround(value)) || Math.abs(value) > 1e9,
        )
      )
        throw new Error(
          "ASC coordinates must be finite and within the supported range.",
        );
      const colored = parse(text, separator, true);
      const rgb = colored?.slice(3);
      // CRT overflow is not yet bound; reject it rather than inventing native conversion results.
      if (
        rgb?.some(
          (value) =>
            !Number.isInteger(value) ||
            value < -2147483648 ||
            value > 2147483647,
        )
      )
        throw new Error("ASC RGB integers must fit the signed 32-bit range.");
      accept(xyz, rgb ? rgb.map((value) => value & 255) : [255, 255, 255]);
    };
    for (let offset = 0; offset < file.size; offset += 1_048_576) {
      check();
      const end = Math.min(file.size, offset + 1_048_576);
      carry += decoder.decode(await file.slice(offset, end).arrayBuffer(), {
        stream: true,
      });
      let cursor = 0,
        chunks = 0;
      while (cursor < carry.length) {
        const newline = carry.indexOf("\n", cursor);
        const size =
          newline >= cursor && newline - cursor < 199
            ? newline - cursor + 1
            : carry.length - cursor >= 199
              ? 199
              : 0;
        if (!size) break;
        if (++chunks % 4096 === 0) check();
        consume(carry.slice(cursor, cursor + size));
        cursor += size;
      }
      carry = carry.slice(cursor);
      options.onProgress?.((pass + end / file.size) / 2);
    }
    carry += decoder.decode();
    if (carry) consume(carry);
    check();
  };
  let count = 0;
  await scan(0, () => count++);
  if (!count) throw new Error("ASC file contains no points.");
  const positions = new Float32Array(count * 3);
  const pointColors = new Uint8Array(count * 4);
  let point = 0;
  await scan(1, (xyz, rgb) => {
    if (point >= count) throw new Error("ASC file changed during import.");
    positions.set(xyz, point * 3);
    pointColors.set([...rgb, 255], point * 4);
    point++;
  });
  if (point !== count) throw new Error("ASC file changed during import.");
  options.onProgress?.(1);
  return { positions, pointColors };
}
