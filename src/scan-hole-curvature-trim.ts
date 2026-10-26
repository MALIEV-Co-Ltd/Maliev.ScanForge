import type { IndexedMesh, Vec3 } from "./types";

const tolerance = 1e-5;
const rayTolerance = Math.fround(1e-7);
const maximumRecords = 1_000_000;

interface PointNode {
  id: number;
  red: boolean;
  parent?: PointNode;
  left?: PointNode;
  right?: PointNode;
}

/** Native tolerant point keys retain insertion-balanced lookup order. */
class PointTree {
  private root?: PointNode;
  constructor(private points: Vec3[]) {}
  private compare(id: number, point: Vec3) {
    const p = this.points[id],
      epsilon = Math.fround(tolerance);
    for (let a = 0; a < 3; a++) {
      if (p[a] < Math.fround(point[a] - epsilon)) return -1;
      if (!(p[a] <= Math.fround(point[a] + epsilon))) return 1;
    }
    return 0;
  }
  find(point: Vec3) {
    let node = this.root;
    while (node) {
      const direction = this.compare(node.id, point);
      if (!direction) return node.id;
      node = direction < 0 ? node.right : node.left;
    }
    return undefined;
  }
  private rotate(node: PointNode, left: boolean) {
    const next = (left ? node.right : node.left)!;
    const middle = left ? next.left : next.right;
    if (left) node.right = middle;
    else node.left = middle;
    if (middle) middle.parent = node;
    next.parent = node.parent;
    if (!node.parent) this.root = next;
    else if (node === node.parent.left) node.parent.left = next;
    else node.parent.right = next;
    if (left) next.left = node;
    else next.right = node;
    node.parent = next;
  }
  insert(id: number) {
    let parent: PointNode | undefined,
      cursor = this.root,
      direction = 0;
    while (cursor) {
      parent = cursor;
      direction = this.compare(cursor.id, this.points[id]);
      if (!direction) return;
      cursor = direction < 0 ? cursor.right : cursor.left;
    }
    let added: PointNode = { id, parent, red: true };
    if (!parent) this.root = added;
    else if (direction < 0) parent.right = added;
    else parent.left = added;
    while (added.parent?.red) {
      const p = added.parent,
        g = p.parent!;
      const left = p === g.left,
        uncle = left ? g.right : g.left;
      if (uncle?.red) {
        p.red = uncle.red = false;
        g.red = true;
        added = g;
      } else {
        if (added === (left ? p.right : p.left)) {
          added = p;
          this.rotate(added, left);
        }
        added.parent!.red = false;
        added.parent!.parent!.red = true;
        this.rotate(added.parent!.parent!, !left);
      }
    }
    this.root!.red = false;
  }
}

/** Recovered endpoint insertion, edge splitting and outside-face removal in UV. */
export function trimNativeCurvatureMesh(
  mesh: Pick<IndexedMesh, "vertices" | "triangles">,
  inputBoundary: readonly (readonly number[])[],
  check?: () => void,
): { vertices: Float32Array; triangles: Uint32Array; boundary: Uint8Array } {
  check?.();
  const budget = () =>
    new Error("Curvature trimming exceeds its resource budget.");
  if (
    mesh.vertices.length / 3 > maximumRecords ||
    mesh.triangles.length / 3 > maximumRecords ||
    inputBoundary.length > maximumRecords
  )
    throw budget();
  if (mesh.vertices.length % 3 || mesh.triangles.length % 3)
    throw new Error(
      "Curvature trimming requires complete indexed UV triangles.",
    );
  if (inputBoundary.length < 3)
    throw new Error("Curvature trimming requires a closed polygon boundary.");
  const points: Vec3[] = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const p = [0, 1, 2].map((a) => Math.fround(mesh.vertices[i + a])) as Vec3;
    if (!p.every(Number.isFinite) || p[2] !== 0)
      throw new Error(
        "Curvature trimming requires finite planar UV coordinates.",
      );
    points.push(p);
  }
  const polygon = inputBoundary.map((p) => {
    if (p.length !== 3 || !p.every(Number.isFinite) || p[2] !== 0)
      throw new Error(
        "Curvature boundary coordinates must be finite planar UV values.",
      );
    return p.map(Math.fround) as Vec3;
  });
  if (polygon.some((p) => !p.every(Number.isFinite)))
    throw new Error("Curvature boundary exceeds Float32 precision.");
  if (
    polygon.length > 3 &&
    polygon[0].reduce((sum, v, a) => sum + (v - polygon.at(-1)![a]) ** 2, 0) <=
      9.99999949475751e-9
  )
    polygon.pop();
  type Face = { ids: [number, number, number]; deleted: boolean };
  const faces: Face[] = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const ids = [
      mesh.triangles[i],
      mesh.triangles[i + 1],
      mesh.triangles[i + 2],
    ] as Face["ids"];
    if (
      ids.some((id) => !Number.isInteger(id) || id < 0 || id >= points.length)
    )
      throw new Error("Curvature UV triangle index is out of range.");
    faces.push({ ids, deleted: false });
  }
  const boundary = Array<number>(points.length).fill(0),
    tree = new PointTree(points);
  let work = 0;
  const visit = () => {
    if (++work > 50_000_000) throw budget();
  };
  function insert(face: Face, position: Vec3, opposite = -1) {
    const point = position.map(Math.fround) as Vec3;
    let id = tree.find(point);
    if (id === undefined) {
      if (points.length >= maximumRecords) throw budget();
      id = points.length;
      points.push(point);
      boundary.push(1);
      tree.insert(id);
    }
    if (face.ids.includes(id)) return false;
    if (faces.length + 3 > maximumRecords) throw budget();
    for (let corner = 0; corner < 3; corner++)
      if (opposite < 0 || opposite !== (corner + 2) % 3)
        faces.push({
          ids: [face.ids[corner], face.ids[(corner + 1) % 3], id],
          deleted: false,
        });
    face.deleted = true;
    return true;
  }
  const overlap = (a: Vec3, b: Vec3, p: Vec3[]) =>
    [0, 1].every(
      (axis) =>
        Math.min(a[axis], b[axis]) <= Math.max(...p.map((v) => v[axis])) &&
        Math.min(...p.map((v) => v[axis])) <= Math.max(a[axis], b[axis]),
    );
  function insideTriangle(point: Vec3, [a, b, c]: Vec3[]) {
    const denominator =
      (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
    const epsilon = tolerance * 0.1;
    if (!(epsilon < Math.abs(denominator))) return false;
    const second =
      ((c[1] - a[1]) * (point[0] - a[0]) - (point[1] - a[1]) * (c[0] - a[0])) *
      (1 / denominator);
    const third =
      ((point[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (point[0] - a[0])) *
      (1 / denominator);
    return (
      -epsilon < second &&
      second < 1 + epsilon &&
      -epsilon < third &&
      third < 1 + epsilon &&
      -epsilon < second + third &&
      second + third < 1 + epsilon
    );
  }
  function degenerate(p: Vec3[]) {
    const edges = p.map((a, i) => {
      const b = p[(i + 1) % 3],
        d = [b[0] - a[0], b[1] - a[1]];
      if (Math.abs(d[0]) < tolerance && Math.abs(d[1]) < tolerance)
        return undefined;
      const length = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
      return d.map((v) => v * (1 / length));
    });
    return edges.some(
      (a, i) =>
        !a ||
        !edges[(i + 1) % 3] ||
        Math.abs(
          a[0] * edges[(i + 1) % 3]![1] - a[1] * edges[(i + 1) % 3]![0],
        ) < tolerance,
    );
  }
  function inside(point: readonly number[]) {
    let crossings = 0,
      upward = 0,
      downward = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      let dyA = a[1] - point[1],
        dyB = b[1] - point[1];
      const dxA = a[0] - point[0],
        dxB = b[0] - point[0];
      if (Math.abs(dyA) < tolerance) dyA = tolerance;
      if (Math.abs(dyB) < tolerance) dyB = tolerance;
      if (
        dyA * dyB <= 0 &&
        (rayTolerance <= dxA || rayTolerance <= dxB) &&
        tolerance <= Math.abs(a[1] - b[1]) &&
        ((-rayTolerance < dxA && -rayTolerance < dxB) ||
          point[0] <=
            ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      ) {
        crossings++;
        if (b[1] <= a[1]) downward++;
        else upward++;
      }
    }
    return crossings % 2 !== 0 || upward !== downward;
  }
  function intersect(face: Face, a: Vec3, b: Vec3) {
    const sx = b[0] - a[0],
      sy = b[1] - a[1];
    const lengthSquared = sx * sx + sy * sy + 0;
    const lineDistance = (p: Vec3) => {
      const dx = p[0] - a[0],
        dy = p[1] - a[1];
      const t = (dy * sy + dx * sx + 0) / lengthSquared;
      const x = dx - t * sx,
        y = dy - t * sy,
        z = 0 - t * 0;
      return { distance: Math.sqrt(x * x + y * y + z * z), along: t };
    };
    for (let corner = 0; corner < 3; corner++) {
      visit();
      const first = face.ids[corner],
        second = face.ids[(corner + 1) % 3];
      const p = points[first],
        q = points[second];
      if (
        Math.abs(p[0] - q[0]) < tolerance &&
        Math.abs(p[1] - q[1]) < tolerance
      )
        continue;
      if (boundary[first] && boundary[second]) continue;
      const pLine = lineDistance(p),
        qLine = lineDistance(q);
      // A point on the infinite extension is not a constrained boundary vertex.
      if (pLine.distance < tolerance) {
        if (0 <= pLine.along && pLine.along <= 1) boundary[first] = 1;
        continue;
      }
      if (qLine.distance < tolerance) {
        if (0 <= qLine.along && qLine.along <= 1) boundary[second] = 1;
        continue;
      }
      const ex = q[0] - p[0],
        ey = q[1] - p[1];
      const determinant = sy * ex - ey * sx;
      if (!(tolerance <= Math.abs(determinant))) continue;
      const dx = p[0] - a[0],
        dy = p[1] - a[1];
      const alongEdge = (dy * sx - dx * sy) / determinant;
      const alongSegment = (dy * ex - dx * ey) / determinant;
      if (!(
        0 <= alongEdge &&
        alongEdge <= 1 &&
        0 <= alongSegment &&
        alongSegment <= 1
      ))
        continue;
      const x = alongEdge * ex + p[0],
        y = alongEdge * ey + p[1];
      if (Math.abs(x - p[0]) < tolerance && Math.abs(y - p[1]) < tolerance)
        continue;
      if (Math.abs(x - q[0]) < tolerance && Math.abs(y - q[1]) < tolerance)
        continue;
      const firstDistance = Math.sqrt((x - p[0]) ** 2 + (y - p[1]) ** 2);
      const secondDistance = Math.sqrt((x - q[0]) ** 2 + (y - q[1]) ** 2);
      if (firstDistance < tolerance) {
        boundary[first] = 1;
        continue;
      }
      if (secondDistance < tolerance) {
        boundary[second] = 1;
        continue;
      }
      if (insert(face, [x, y, 0], (corner + 2) % 3)) return true;
    }
    return false;
  }
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    if (faceIndex % 128 === 0) check?.();
    const face = faces[faceIndex];
    if (face.deleted) continue;
    const p = face.ids.map((id) => points[id]),
      thin = degenerate(p);
    for (let segment = 0; segment < polygon.length; segment++) {
      visit();
      const a = polygon[segment],
        b = polygon[(segment + 1) % polygon.length];
      if (
        !(Number.EPSILON <= Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))
      )
        continue;
      if (!overlap(a, b, p)) continue;
      if (!thin && insideTriangle(a, p)) {
        let matched = false;
        for (let corner = 0; corner < 3; corner++)
          if (
            Math.abs(a[0] - p[corner][0]) < tolerance &&
            Math.abs(a[1] - p[corner][1]) < tolerance
          ) {
            matched = true;
            boundary[face.ids[corner]] = 1;
          }
        if (!matched && insert(face, [a[0], a[1], 0])) break;
      }
      if (intersect(face, a, b)) break;
    }
  }
  function removeDeleted() {
    for (let i = 0; i < faces.length;) {
      if (i % 4096 === 0) check?.();
      if (!faces[i].deleted) {
        i++;
        continue;
      }
      const last = faces.pop()!;
      if (i < faces.length) faces[i] = last;
    }
  }
  removeDeleted();
  for (let i = 0; i < faces.length; i++) {
    if (i % 4096 === 0) check?.();
    const face = faces[i],
      [a, b, c] = face.ids.map((id) => points[id]);
    const center = [0, 1].map((axis) =>
      Math.fround(Math.fround(Math.fround(b[axis] + a[axis]) + c[axis]) / 3),
    );
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // The join discards zero-area facets before publishing the completed mesh.
    face.deleted = area === 0 || !inside(center);
  }
  removeDeleted();
  check?.();
  return {
    vertices: Float32Array.from(points.flat()),
    triangles: Uint32Array.from(faces.flatMap((face) => face.ids)),
    boundary: Uint8Array.from(boundary),
  };
}
