import { sha256 } from "@noble/hashes/sha2.js";

export interface ConstructionIdentitySource {
  readonly id: string;
  readonly constructionOrderKey?: string;
}
export interface ConstructionIdentityAssignment {
  id: string;
  constructionOrderKey: string;
}
export interface ResolvedConstructionIdentities {
  orderedSources: ConstructionIdentityAssignment[];
  /** Provisional assignments for selected sources only; accepting owns mutation. */
  assignments: ConstructionIdentityAssignment[];
}

const domain = new TextEncoder().encode("ScanForge construction-order v1\0");

/** Application migration identity; deliberately not a UUID/GUID conversion. */
function legacyOrderKey(id: string): string {
  const hash = sha256.create();
  hash.update(domain);
  // Stream exact UTF-16 code units, including lone surrogates, with bounded scratch.
  const bytes = new Uint8Array(1024);
  const view = new DataView(bytes.buffer);
  for (let first = 0; first < id.length; first += bytes.length / 2) {
    const count = Math.min(bytes.length / 2, id.length - first);
    for (let index = 0; index < count; index++)
      view.setUint16(index * 2, id.charCodeAt(first + index), true);
    hash.update(bytes.subarray(0, count * 2));
  }
  return Array.from(hash.digest().subarray(0, 16), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

/** Resolve a native-style common source set, never an ordered pick-record vector. */
export function resolveConstructionIdentities(
  scene: readonly ConstructionIdentitySource[],
  sourceIds: readonly string[],
): ResolvedConstructionIdentities {
  const byId = new Map<string, ConstructionIdentityAssignment>();
  const keyOwners = new Map<string, string>();
  const provisional = new Set<string>();
  for (const source of scene) {
    if (!source || typeof source.id !== "string")
      throw new Error("Invalid construction source ID.");
    if (byId.has(source.id))
      throw new Error("Duplicate construction source ID.");
    const saved = source.constructionOrderKey;
    if (
      saved !== undefined &&
      (typeof saved !== "string" || !/^[0-9a-f]{32}$/.test(saved))
    )
      throw new Error("Invalid construction order key.");
    const key = saved ?? legacyOrderKey(source.id);
    if (keyOwners.has(key))
      throw new Error("Construction order key collision.");
    keyOwners.set(key, source.id);
    byId.set(source.id, { id: source.id, constructionOrderKey: key });
    if (saved === undefined) provisional.add(source.id);
  }
  const selected = new Set(sourceIds);
  const orderedSources = [...selected].map((id) => {
    if (typeof id !== "string" || !byId.has(id))
      throw new Error("Missing construction source.");
    return { ...byId.get(id)! };
  });
  // Canonical hexadecimal has the same order as its unsigned raw bytes.
  orderedSources.sort((a, b) =>
    a.constructionOrderKey < b.constructionOrderKey
      ? -1
      : a.constructionOrderKey > b.constructionOrderKey
        ? 1
        : 0,
  );
  return {
    orderedSources,
    assignments: orderedSources
      .filter((source) => provisional.has(source.id))
      .map((source) => ({ ...source })),
  };
}
