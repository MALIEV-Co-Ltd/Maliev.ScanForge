import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanTool } from "../src/scan-tools";

const path = process.env.SCANFORGE_M2_FIRST_STL;
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

it.skipIf(!path)(
  "matches the native original-scan Flip coordinate stream",
  () => {
    const bytes = readFileSync(path!);
    expect(hash(bytes)).toBe(
      "6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9",
    );
    const source = parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
    expect(source.length).toBe(273139 * 9);
    const before = hash(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    );
    expect(before).toBe(
      "e78677c506a4a8e98711e68a91ab5f856eedfae7b153db0c57d7f3bf77659612",
    );
    const result = runScanTool({
      kind: "scanTools",
      positions: source,
      operation: { kind: "flipNormals" },
    });
    expect(
      hash(
        new Uint8Array(
          result.positions.buffer,
          result.positions.byteOffset,
          result.positions.byteLength,
        ),
      ),
    ).toBe("ebd5c98c917d3d72a91233c602608d551792c82ec1e5b14a8b0937460c537ebf");
    expect(
      hash(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)),
    ).toBe(before);
  },
  120000,
);
