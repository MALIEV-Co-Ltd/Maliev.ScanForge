import type { Positions, Vec3 } from "./types";
import {
  analyzeMesh,
  type MeshProcessingOptions,
  type MeshTopology,
} from "./mesh-processing";
import { runHoleFill } from "./scan-edit-holes";
import { splitByPlane } from "./scan-edit-split";
import { simplifyBoundaryCurve } from "./scan-boundary-simplify";

export interface ScanEditRequest {
  kind: "scanEdit";
  positions: Positions;
  action:
    | "inventory"
    | "componentExtract"
    | "componentKeep"
    | "componentRemove"
    | "componentFlip"
    | "fillHoles"
    | "boundarySmooth"
    | "boundaryProject"
    | "smoothSelected"
    | "defeature"
    | "split";
  selection?: Uint8Array;
  indices?: number[];
  algorithm?: "automatic" | "flat" | "tangent" | "curvature";
  mode?: "entire" | "partial" | "bridge";
  start?: number;
  end?: number;
  diameter?: number;
  strength?: number;
  iterations?: number;
  plane?: { origin: Vec3; normal: Vec3 };
  target?: Positions;
  tolerance?: number;
  fitTolerance?: number;
}
export interface ScanEditInventory {
  components: { triangles: number[]; area: number }[];
  boundaries: {
    points: number[];
    triangles: number[];
    closed: boolean;
    diameter: number;
    length: number;
  }[];
}
export interface ScanEditResult {
  positions?: Float32Array;
  segments?: Float32Array[];
  selection?: Uint8Array;
  inventory?: ScanEditInventory;
  curves?: number[][];
  diagnostics: Record<string, number | string | boolean>;
}
export const pointAt = (p: ArrayLike<number>, i: number): Vec3 => [
  p[i * 3],
  p[i * 3 + 1],
  p[i * 3 + 2],
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const crossProduct = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dotProduct = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const edgeId = (a: number, b: number) =>
  a < b ? `${a}:${b}` : `${b}:${a}`;
export function checkProgress(
  o: MeshProcessingOptions,
  f: number,
  stage: string,
) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(f, stage);
}
export function finiteOutput(values: ArrayLike<number>): Float32Array {
  const output = new Float32Array(values);
  if (output.some((v) => !Number.isFinite(v)))
    throw new Error("Coordinates exceed Float32 output precision.");
  return output;
}
export function inventoryOf(t: MeshTopology): ScanEditInventory {
  return {
    components: t.components.map((triangles) => ({
      triangles,
      area: triangles.reduce((a, f) => {
        const [p, q, r] = [0, 1, 2].map((c) =>
          pointAt(t.vertices, t.triangles[f * 3 + c]),
        );
        return (
          a + Math.hypot(...crossProduct(subtract(q, p), subtract(r, p))) / 2
        );
      }, 0),
    })),
    boundaries: [
      ...t.boundaryLoops.map((ids) => ({ ids, closed: true })),
      ...t.boundaryChains.map((ids) => ({ ids, closed: false })),
    ].map(({ ids, closed }) => {
      const points = ids.flatMap((id) => pointAt(t.vertices, id));
      const faces = new Set<number>();
      let length = 0;
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      ids.forEach((id, i) => {
        const p = pointAt(t.vertices, id);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], p[a]);
          max[a] = Math.max(max[a], p[a]);
        }
        if (i < ids.length - 1 || closed) {
          const next = ids[(i + 1) % ids.length];
          length += Math.hypot(...subtract(pointAt(t.vertices, next), p));
          for (const use of t.edges.get(edgeId(id, next)) ?? [])
            faces.add(use.face);
        }
      });
      return {
        points,
        triangles: [...faces],
        closed,
        diameter: Math.hypot(...subtract(max as Vec3, min as Vec3)),
        length,
      };
    }),
  };
}
function selectedIndices(
  indices: number[] | undefined,
  count: number,
): number[] {
  const result = indices ?? Array.from({ length: count }, (_, i) => i);
  if (result.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
    throw new Error("Selection index is outside the mesh inventory.");
  return [...new Set(result)];
}
function smoothing(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): Float32Array {
  const strength = r.strength ?? 0.3,
    iterations = r.iterations ?? 3;
  if (
    !Number.isFinite(strength) ||
    strength <= 0 ||
    strength > 1 ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 100
  )
    throw new Error("Smoothing needs strength in (0,1] and 1–100 iterations.");
  let vertices = t.vertices.slice();
  const movable = new Set<number>(),
    neighbors = new Map<number, Set<number>>();
  if (r.action === "boundarySmooth") {
    const all = [...t.boundaryLoops, ...t.boundaryChains];
    for (const idx of selectedIndices(r.indices, all.length)) {
      const ids = all[idx],
        closed = idx < t.boundaryLoops.length;
      ids.forEach((id, i) => {
        if (closed || (i > 0 && i < ids.length - 1)) {
          movable.add(id);
          neighbors.set(
            id,
            new Set([
              ids[(i + ids.length - 1) % ids.length],
              ids[(i + 1) % ids.length],
            ]),
          );
        }
      });
    }
  } else {
    if (!r.selection?.some(Boolean))
      throw new Error("Select triangles to smooth.");
    const outside = new Set<number>();
    for (let f = 0; f < t.triangles.length / 3; f++)
      for (let c = 0; c < 3; c++)
        (r.selection[f] ? movable : outside).add(t.triangles[f * 3 + c]);
    for (const id of outside) movable.delete(id);
    for (const uses of t.edges.values()) {
      const { from, to } = uses[0];
      if (uses.length !== 2) {
        movable.delete(from);
        movable.delete(to);
      }
      if (!neighbors.has(from)) neighbors.set(from, new Set());
      if (!neighbors.has(to)) neighbors.set(to, new Set());
      neighbors.get(from)!.add(to);
      neighbors.get(to)!.add(from);
    }
  }
  for (let step = 0; step < iterations; step++) {
    checkProgress(o, step / iterations, "Smoothing selected vertices");
    const next = vertices.slice();
    for (const id of movable) {
      const adjacent = neighbors.get(id)!;
      if (!adjacent.size) continue;
      for (let a = 0; a < 3; a++) {
        let sum = 0;
        for (const n of adjacent) sum += vertices[n * 3 + a];
        next[id * 3 + a] +=
          strength * (sum / adjacent.size - vertices[id * 3 + a]);
      }
    }
    vertices = next;
  }
  return finiteOutput(
    Array.from(t.triangles).flatMap((id) => pointAt(vertices, id)),
  );
}
export function runScanEdit(
  r: ScanEditRequest,
  options: MeshProcessingOptions = {},
): ScanEditResult {
  if (
    ![
      "inventory",
      "componentExtract",
      "componentKeep",
      "componentRemove",
      "componentFlip",
      "fillHoles",
      "boundarySmooth",
      "boundaryProject",
      "smoothSelected",
      "defeature",
      "split",
    ].includes(r.action)
  )
    throw new Error("Unknown scan edit action.");
  let phaseStart = 0,
    phaseSpan = 0.35,
    lastFraction = 0;
  const o = {
    ...options,
    tolerance: r.tolerance ?? options.tolerance,
    onProgress:
      r.action === "defeature"
        ? (fraction: number, stage: string) => {
            lastFraction = Math.max(
              lastFraction,
              phaseStart + Math.min(fraction, 1) * phaseSpan,
            );
            options.onProgress?.(
              lastFraction,
              `Defeature: ${stage.replace(/Hole filling complete/i, "Seam triangulation ready").replace(/complete/gi, "ready")}`,
            );
          }
        : options.onProgress,
  };
  const t = analyzeMesh(r.positions, o),
    inventory = inventoryOf(t),
    count = r.positions.length / 9;
  if (
    r.selection &&
    (r.selection.length !== count ||
      r.selection.some((v) => v !== 0 && v !== 1))
  )
    throw new Error(
      "Triangle selection mask must contain one 0 or 1 per triangle.",
    );
  checkProgress(o, 0, "Preparing scan edit");
  if (r.action === "inventory")
    return {
      inventory,
      diagnostics: {
        components: inventory.components.length,
        boundaries: inventory.boundaries.length,
        holes: t.boundaryLoops.length,
      },
    };
  if (r.action === "fillHoles") return runHoleFill(r, t, o);
  if (r.action === "split") return splitByPlane(r, o);
  if (r.action === "smoothSelected" || r.action === "boundarySmooth")
    return {
      positions: smoothing(r, t, o),
      diagnostics: { method: "Boundary-preserving Laplacian smoothing" },
    };
  if (r.action === "boundaryProject") {
    if (!r.plane) throw new Error("Choose a projection plane.");
    const { origin, normal } = r.plane,
      n2 = dotProduct(normal, normal);
    if (![...origin, ...normal].every(Number.isFinite) || n2 === 0)
      throw new Error("Projection plane must be finite with a nonzero normal.");
    const curves = selectedIndices(r.indices, inventory.boundaries.length).map(
      (i) => {
        const b = inventory.boundaries[i],
          out: number[] = [];
        for (let j = 0; j < b.points.length; j += 3) {
          const p = pointAt(b.points, j / 3),
            d = dotProduct(subtract(p, origin), normal) / n2;
          out.push(...p.map((v, a) => v - d * normal[a]));
        }
        if (b.closed) out.push(...out.slice(0, 3));
        return r.fitTolerance === undefined
          ? out
          : simplifyBoundaryCurve(out, r.fitTolerance);
      },
    );
    return { curves, diagnostics: { projectedBoundaries: curves.length } };
  }
  if (r.action === "defeature") {
    if (!r.selection?.some(Boolean) || r.selection.every(Boolean))
      throw new Error("Select a bounded patch, leaving surrounding triangles.");
    const retained: number[] = [];
    for (let f = 0; f < count; f++)
      if (!r.selection[f])
        retained.push(...Array.from(r.positions.slice(f * 9, f * 9 + 9)));
    const remainder = finiteOutput(retained);
    phaseStart = 0.35;
    phaseSpan = 0.25;
    const rt = analyzeMesh(remainder, o);
    const oldEdges = new Set(
      [...t.edges]
        .filter(([, uses]) => uses.length === 1)
        .map(([key]) => {
          const [a, b] = key.split(":").map(Number);
          return [
            pointAt(t.vertices, a).map(Math.fround).join(","),
            pointAt(t.vertices, b).map(Math.fround).join(","),
          ]
            .sort()
            .join("|");
        }),
    );
    const newLoops = rt.boundaryLoops
      .map((ids, i) => ({ ids, i }))
      .filter(({ ids }) =>
        ids.every(
          (id, j) =>
            !oldEdges.has(
              [
                pointAt(rt.vertices, id).join(","),
                pointAt(rt.vertices, ids[(j + 1) % ids.length]).join(","),
              ]
                .sort()
                .join("|"),
            ),
        ),
      )
      .map((v) => v.i);
    if (!newLoops.length)
      throw new Error(
        "Selected patch must have a closed seam separate from existing boundaries.",
      );
    phaseStart = 0.6;
    phaseSpan = 0.35;
    const filled = runHoleFill(
      {
        ...r,
        positions: remainder,
        action: "fillHoles",
        indices: newLoops,
        mode: "entire",
        algorithm: r.algorithm ?? "automatic",
      },
      rt,
      o,
    );
    if (filled.diagnostics.filledHoles !== newLoops.length)
      throw new Error(
        "The selected patch could not be safely repatched. Its seam may be folded, self-intersecting or overlap existing faces. Try a smaller contiguous selection; the original mesh is retained.",
      );
    checkProgress(options, 1, "Defeature complete");
    return {
      ...filled,
      diagnostics: {
        ...filled.diagnostics,
        removedTriangles: r.selection.reduce((n, v) => n + v, 0),
        method: "Remove patch and retriangulate closed seam",
      },
    };
  }
  const selected = new Set(
    selectedIndices(r.indices, t.components.length).flatMap(
      (i) => t.components[i],
    ),
  );
  if (r.action === "componentExtract")
    return {
      segments: selectedIndices(r.indices, t.components.length).map((i) =>
        finiteOutput(
          [...t.components[i]]
            .sort((a, b) => a - b)
            .flatMap((f) => Array.from(r.positions.slice(f * 9, f * 9 + 9))),
        ),
      ),
      diagnostics: {
        extractedComponents: selectedIndices(r.indices, t.components.length)
          .length,
      },
    };
  const out: number[] = [];
  for (let f = 0; f < count; f++) {
    if (
      (r.action === "componentKeep" && !selected.has(f)) ||
      (r.action === "componentRemove" && selected.has(f))
    )
      continue;
    const face = Array.from(r.positions.slice(f * 9, f * 9 + 9));
    if (r.action === "componentFlip" && selected.has(f))
      face.splice(3, 6, ...face.slice(6, 9), ...face.slice(3, 6));
    out.push(...face);
  }
  checkProgress(o, 1, "Scan edit complete");
  return {
    positions: finiteOutput(out),
    diagnostics: { triangles: out.length / 9 },
  };
}
