import {
  unpackProjectTransport,
  type ProjectTransport,
} from "./project-transport";
import type { ProjectEncodingSnapshot } from "./project-encoding-snapshot";

// These buffers exist only inside the disposable encoder worker. Public project
// validation continues to reject arbitrary Float64Array geometry.
const owned = new WeakSet<Float64Array>();
export function isEncodingNumeric(value: unknown): value is Float64Array {
  return value instanceof Float64Array && owned.has(value);
}

/** Retain only numeric refs used exclusively as mesh coordinates. Other array
 * roles keep their ordinary-array representation and identity. */
export async function unpackProjectEncodingTransport(
  packet: ProjectTransport,
): Promise<ProjectEncodingSnapshot> {
  const refs = new Set(packet.numbers.map((entry) => entry.ref));
  const meshOwners = new Set<object>();
  const indexedOwners = new Set<object>();
  const graph = packet.graph as any;
  const session = graph?.session;
  const states = [
    session?.project,
    ...(session?.history ?? []),
    ...(session?.future ?? []),
  ];
  for (const state of states) {
    if (!Array.isArray(state?.entities)) continue;
    for (const entity of state.entities) {
      if (!entity || typeof entity !== "object" || entity.kind !== "mesh")
        continue;
      meshOwners.add(entity);
      if (entity.indexedMesh && typeof entity.indexedMesh === "object")
        indexedOwners.add(entity.indexedMesh);
    }
  }
  const eligible = new Set<object>();
  const excluded = new Set<object>();
  const seen = new Set<object>();
  const visit = (value: unknown, parent?: object, key?: string) => {
    if (!value || typeof value !== "object") return;
    if (refs.has(value)) {
      if (
        parent &&
        ((meshOwners.has(parent) && key === "positions") ||
          (indexedOwners.has(parent) && key === "vertices"))
      )
        eligible.add(value);
      else excluded.add(value);
      return;
    }
    if (
      seen.has(value) ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        value instanceof SharedArrayBuffer)
    )
      return;
    seen.add(value);
    for (const [name, child] of Object.entries(value))
      visit(child, value, name);
  };
  visit(packet.graph);
  return unpackProjectTransport<ProjectEncodingSnapshot>(packet, {
    cooperative: false,
    retainNumericBuffer(ref, values) {
      if (!eligible.has(ref) || excluded.has(ref)) return false;
      owned.add(values);
      return true;
    },
  });
}
