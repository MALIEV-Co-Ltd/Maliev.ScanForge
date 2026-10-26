import { ApiError, ARTIFACT_BYTES, type CommandContext } from "./api";

/** Count the actual UTF-8 JSON before expanding typed carriers into JS arrays.
 * The aggregate artifact store still performs its authoritative capacity check. */
export function geometryArtifact(context: CommandContext, geometry: unknown) {
  const root = geometry as Record<string, any>;
  const indexed = root.indexedMesh;
  // Match object_get's established explicit array fields. Other typed metadata,
  // including edgePositions and semantic references, retains its JSON object form.
  const arrayField = (holder: unknown, key: string) =>
    holder === root
      ? ["positions", "normals", "pointColors"].includes(key)
      : holder === indexed &&
        [
          "vertices",
          "triangles",
          "normals",
          "geometryNormals",
          "facetNormals",
        ].includes(key);
  let bytes = 0,
    visited = 0;
  const encoder = new TextEncoder();
  const add = (count: number) => {
    bytes += count;
    if (bytes > ARTIFACT_BYTES)
      throw new ApiError(
        "RESOURCE_LIMIT",
        "Geometry JSON exceeds the 1 GiB artifact limit; use object_geometry_digest or project_export instead.",
      );
  };
  const visit = (value: unknown, array = Array.isArray(value)): void => {
    if (++visited % 65536 === 0) context.check();
    if (array) {
      const values = value as ArrayLike<unknown>;
      // Each element needs at least one byte and each pair a comma. Reject
      // impossible payloads before reading or allocating their coordinates.
      if (values.length * 2 + 1 > ARTIFACT_BYTES - bytes)
        add(ARTIFACT_BYTES + 1);
      add(2 + Math.max(0, values.length - 1));
      for (let i = 0; i < values.length; i++) visit(values[i] ?? null);
    } else if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, entry] of entries) {
        add(encoder.encode(JSON.stringify(key)).byteLength + 1);
        visit(
          entry,
          Array.isArray(entry) ||
            (arrayField(value, key) && ArrayBuffer.isView(entry)),
        );
      }
    } else {
      add(encoder.encode(JSON.stringify(value ?? null)).byteLength);
    }
  };
  context.check();
  visit(geometry);
  context.check();
  return context.artifact(
    JSON.stringify(geometry, function (key, value) {
      return arrayField(this, key) && ArrayBuffer.isView(value)
        ? Array.from(value as unknown as ArrayLike<number>)
        : value;
    }),
    "geometry.json",
    "application/json",
  );
}
