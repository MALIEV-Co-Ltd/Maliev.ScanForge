import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { Line3, Matrix4, Triangle, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

const args = Object.fromEntries(
  Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
    process.argv[i * 2 + 2],
    process.argv[i * 2 + 3],
  ]),
);
assert(
  args["--source"] && args["--report"],
  "Usage: node scripts/verify-poisson-quality.mjs --source original.ply --report receipt.json [--mesh reconstructed.ply] [--settings settings.json]",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = async (path) => {
  const bytes = await readFile(path),
    loader = new PLYLoader();
  if (
    bytes
      .subarray(0, bytes.indexOf("end_header"))
      .toString()
      .includes("property float density")
  )
    loader.setCustomPropertyNameMapping({ density: ["density"] });
  const geometry = loader.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert(
    geometry.index && geometry.index.count > 0,
    "Quality reference and reconstruction must retain triangle topology.",
  );
  assert(
    geometry.attributes.position.array.every(Number.isFinite),
    "Nonfinite geometry",
  );
  const positions = geometry.attributes.position.array,
    triangles = geometry.index.array;
  return {
    geometry,
    sha256: hash(bytes),
    geometrySha256: hash(
      Buffer.concat([
        Buffer.from(
          positions.buffer,
          positions.byteOffset,
          positions.byteLength,
        ),
        Buffer.from(
          triangles.buffer,
          triangles.byteOffset,
          triangles.byteLength,
        ),
      ]),
    ),
    bytes: bytes.length,
    path,
  };
};
const stats = (values) => {
  assert(values.length > 0);
  let sum = 0,
    square = 0,
    maximum = -Infinity,
    minimum = Infinity;
  for (const v of values) {
    sum += v;
    square += v * v;
    maximum = Math.max(maximum, v);
    minimum = Math.min(minimum, v);
  }
  const sorted = Float64Array.from(values).sort(),
    percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    samples: values.length,
    minimum,
    mean: sum / values.length,
    rms: Math.sqrt(square / values.length),
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    maximum,
  };
};
function analyzeTopology(geometry) {
  const p = geometry.attributes.position,
    ix = geometry.index.array,
    n = p.count,
    parents = Int32Array.from({ length: n }, (_, i) => i),
    used = new Uint8Array(n),
    edges = new Map(),
    faces = new Set(),
    locations = new Set(),
    links = Array.from({ length: n }, () => []),
    minIncidentEdge = new Float64Array(n).fill(Infinity),
    edgeLengths = [];
  const find = (id) => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const v = (id) => new Vector3().fromBufferAttribute(p, id);
  let duplicateVertices = 0,
    duplicateTriangles = 0,
    degenerateTriangles = 0,
    area = 0,
    volume = 0;
  geometry.computeBoundingBox();
  for (let i = 0; i < n; i++) {
    const key = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    if (locations.has(key)) duplicateVertices++;
    locations.add(key);
  }
  for (let i = 0; i < ix.length; i += 3) {
    const ids = [ix[i], ix[i + 1], ix[i + 2]];
    assert(ids.every((id) => Number.isInteger(id) && id >= 0 && id < n));
    const key = ids
      .slice()
      .sort((a, b) => a - b)
      .join(",");
    if (faces.has(key)) duplicateTriangles++;
    faces.add(key);
    const [a, b, c] = ids.map(v),
      cross = b.clone().sub(a).cross(c.clone().sub(a));
    area += cross.length() / 2;
    volume += a.dot(b.clone().cross(c)) / 6;
    if (cross.lengthSq() === 0) degenerateTriangles++;
    for (let j = 0; j < 3; j++) {
      const x = ids[j],
        y = ids[(j + 1) % 3],
        z = ids[(j + 2) % 3],
        key = x < y ? `${x},${y}` : `${y},${x}`;
      used[x] = 1;
      parents[find(x)] = find(y);
      links[x].push(y, z);
      const edge = edges.get(key) ?? { incidence: 0, direction: 0 };
      edge.incidence++;
      edge.direction += x < y ? 1 : -1;
      if (!edges.has(key)) {
        const length = v(x).distanceTo(v(y));
        edgeLengths.push(length);
        minIncidentEdge[x] = Math.min(minIncidentEdge[x], length);
        minIncidentEdge[y] = Math.min(minIncidentEdge[y], length);
      }
      edges.set(key, edge);
    }
  }
  let nonManifoldVertices = 0;
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const adjacency = new Map();
    for (let j = 0; j < links[i].length; j += 2) {
      const a = links[i][j],
        b = links[i][j + 1];
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    const degrees = [...adjacency.values()].map((v) => v.length),
      ends = degrees.filter((v) => v === 1).length;
    const seen = new Set(),
      queue = [adjacency.keys().next().value];
    while (queue.length) {
      const a = queue.pop();
      if (seen.has(a)) continue;
      seen.add(a);
      queue.push(...adjacency.get(a));
    }
    if (
      seen.size !== adjacency.size ||
      degrees.some((v) => v < 1 || v > 2) ||
      (ends !== 0 && ends !== 2)
    )
      nonManifoldVertices++;
  }
  const edgeValues = [...edges.values()],
    usedIds = [];
  for (let i = 0; i < n; i++) if (used[i]) usedIds.push(i);
  const normal = geometry.attributes.normal;
  let invalidNormals = 0;
  if (normal)
    for (let i = 0; i < n; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (!Number.isFinite(length) || length === 0) invalidNormals++;
    }
  return {
    vertices: n,
    usedVertices: usedIds.length,
    triangles: ix.length / 3,
    edges: edges.size,
    components: new Set(usedIds.map(find)).size,
    boundaryEdges: edgeValues.filter((e) => e.incidence === 1).length,
    nonManifoldEdges: edgeValues.filter((e) => e.incidence > 2).length,
    inconsistentWindingEdges: edgeValues.filter(
      (e) => e.incidence === 2 && e.direction !== 0,
    ).length,
    nonManifoldVertices,
    duplicateVertices,
    duplicateTriangles,
    degenerateTriangles,
    eulerCharacteristic: usedIds.length - edges.size + ix.length / 3,
    surfaceArea: area,
    signedVolume: volume,
    bbox: {
      min: geometry.boundingBox.min.toArray(),
      max: geometry.boundingBox.max.toArray(),
      diagonal: geometry.boundingBox.getSize(new Vector3()).length(),
    },
    edgeLength: stats(edgeLengths),
    minimumIncidentEdgeLength: stats(usedIds.map((i) => minIncidentEdge[i])),
    suppliedNormals: normal
      ? { count: normal.count, invalidOrZero: invalidNormals }
      : null,
  };
}
const source = await load(args["--source"]),
  sourceTopology = analyzeTopology(source.geometry);
const receipt = {
  scope:
    "Independent Three.js / three-mesh-bvh comparison against the complete original PLY triangle topology. The original scan is an exchange reference, not physical ground truth.",
  source: {
    path: source.path,
    sha256: source.sha256,
    geometrySha256: source.geometrySha256,
    bytes: source.bytes,
    topology: sourceTopology,
  },
  predeclaredAcceptance: {
    method:
      "No arbitrary distance thresholds. Compare full-cloud distance distributions in source coordinate units with the source incident-edge spacing and edge-length distributions, measured before reconstruction. Topological defects and incomplete self-intersection analysis are reported explicitly.",
    sourceScaleMeasuredBeforeOutput: !args["--mesh"],
  },
  limitations: [
    "Distances are exact point-to-triangle queries at every source vertex, output vertex, and output face centroid; these finite sample sets are not a continuous symmetric Hausdorff certificate.",
    "Source coordinate units are preserved and are not independently certified as millimetres.",
    "Vertex-link manifold classification follows retained indices; coincident unmerged vertices are separately reported.",
    "The original scan may contain holes, noise and normal defects. Agreement with it does not establish physical accuracy.",
    "Vertex and centroid distance quantiles weight samples equally, not by triangle surface area. Signed volume is an oriented triangle integral and is not an enclosed volume for an open mesh.",
  ],
};
if (args["--settings"]) {
  const bytes = await readFile(args["--settings"]);
  receipt.settings = { sha256: hash(bytes), ...JSON.parse(bytes) };
}
if (args["--mesh"]) {
  const mesh = await load(args["--mesh"]),
    targetTopology = analyzeTopology(mesh.geometry),
    sourceBvh = new MeshBVH(source.geometry, { indirect: true }),
    meshBvh = new MeshBVH(mesh.geometry, { indirect: true });
  const sourcePoint = new Vector3(),
    nearest = { point: new Vector3() },
    triangle = new Triangle(),
    bary = new Vector3(),
    n = new Vector3(),
    reference = new Vector3();
  const readTriangle = (geometry, id) => {
    const ix = geometry.index.array,
      p = geometry.attributes.position;
    triangle.a.fromBufferAttribute(p, ix[id * 3]);
    triangle.b.fromBufferAttribute(p, ix[id * 3 + 1]);
    triangle.c.fromBufferAttribute(p, ix[id * 3 + 2]);
    return triangle;
  };
  const normalAt = (geometry, face, point, out) => {
    const normals = geometry.attributes.normal;
    readTriangle(geometry, face);
    if (!normals) return triangle.getNormal(out);
    triangle.getBarycoord(point, bary);
    out.set(0, 0, 0);
    const ix = geometry.index.array;
    for (let a = 0; a < 3; a++) {
      n.fromBufferAttribute(normals, ix[face * 3 + a]);
      out.addScaledVector(n, bary.getComponent(a));
    }
    return out.normalize();
  };
  const sourceDistances = [],
    sourceAgreement = [],
    vertexDistances = [],
    vertexAgreement = [],
    centroidDistances = [],
    centroidAgreement = [];
  let invalidSourceAgreement = 0,
    invalidVertexAgreement = 0,
    invalidCentroidAgreement = 0;
  for (let i = 0; i < source.geometry.attributes.position.count; i++) {
    sourcePoint.fromBufferAttribute(source.geometry.attributes.position, i);
    assert(meshBvh.closestPointToPoint(sourcePoint, nearest));
    sourceDistances.push(nearest.distance);
    if (source.geometry.attributes.normal) {
      reference
        .fromBufferAttribute(source.geometry.attributes.normal, i)
        .normalize();
      readTriangle(mesh.geometry, nearest.faceIndex).getNormal(n);
      if (reference.lengthSq() > 0 && n.lengthSq() > 0)
        sourceAgreement.push(reference.dot(n));
      else invalidSourceAgreement++;
    }
  }
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    sourcePoint.fromBufferAttribute(mesh.geometry.attributes.position, i);
    assert(sourceBvh.closestPointToPoint(sourcePoint, nearest));
    vertexDistances.push(nearest.distance);
    normalAt(source.geometry, nearest.faceIndex, nearest.point, reference);
    if (mesh.geometry.attributes.normal) {
      n.fromBufferAttribute(mesh.geometry.attributes.normal, i).normalize();
      if (n.lengthSq() > 0 && reference.lengthSq() > 0)
        vertexAgreement.push(n.dot(reference));
      else invalidVertexAgreement++;
    }
  }
  for (let i = 0; i < mesh.geometry.index.count / 3; i++) {
    readTriangle(mesh.geometry, i).getMidpoint(sourcePoint);
    triangle.getNormal(reference);
    assert(sourceBvh.closestPointToPoint(sourcePoint, nearest));
    centroidDistances.push(nearest.distance);
    const outputNormal = reference.clone();
    normalAt(source.geometry, nearest.faceIndex, nearest.point, reference);
    if (outputNormal.lengthSq() > 0 && reference.lengthSq() > 0)
      centroidAgreement.push(outputNormal.dot(reference));
    else invalidCentroidAgreement++;
  }
  let candidates = 0,
    selfIntersections = 0,
    adjacentPairsExcluded = 0,
    complete = true;
  const examples = [],
    intersectionDetails = [],
    classifications = {
      properCrossings: 0,
      coplanarPositiveAreaOverlaps: 0,
      pointOrEdgeContacts: 0,
      degenerateOrUnclassified: 0,
    };
  const segment = new Line3(),
    midpoint = new Vector3(),
    firstBary = new Vector3(),
    secondBary = new Vector3();
  const coplanarArea = (first, second, normal) => {
    const axis = [
      Math.abs(normal.x),
      Math.abs(normal.y),
      Math.abs(normal.z),
    ].indexOf(
      Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)),
    );
    const axes = [0, 1, 2].filter((value) => value !== axis),
      project = (v) => axes.map((a) => v.getComponent(a));
    let polygon = [first.a, first.b, first.c].map(project);
    const clip = [second.a, second.b, second.c].map(project),
      cross = (a, b, c) =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      sign = Math.sign(cross(...clip));
    if (!sign) return 0;
    for (let i = 0; i < 3; i++) {
      const a = clip[i],
        b = clip[(i + 1) % 3],
        next = [];
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j],
          q = polygon[(j + 1) % polygon.length],
          dp = sign * cross(a, b, p),
          dq = sign * cross(a, b, q);
        if (dp >= 0) next.push(p);
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
          const fraction = dp / (dp - dq);
          next.push([
            p[0] + fraction * (q[0] - p[0]),
            p[1] + fraction * (q[1] - p[1]),
          ]);
        }
      }
      polygon = next;
    }
    let area = 0;
    for (let i = 1; i + 1 < polygon.length; i++)
      area += cross(polygon[0], polygon[i], polygon[i + 1]) / 2;
    return Math.abs(area);
  };
  meshBvh.bvhcast(meshBvh, new Matrix4(), {
    intersectsTriangles: (a, b, rawA, rawB) => {
      const fa = meshBvh.resolveTriangleIndex(rawA),
        fb = meshBvh.resolveTriangleIndex(rawB);
      if (fa >= fb) return false;
      if (++candidates > 20000000) {
        complete = false;
        return true;
      }
      const ix = mesh.geometry.index.array;
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++)
          if (ix[fa * 3 + x] === ix[fb * 3 + y]) {
            adjacentPairsExcluded++;
            return false;
          }
      if (a.intersectsTriangle(b, segment, true)) {
        selfIntersections++;
        if (examples.length < 20) examples.push([fa, fb]);
        const na = a.getNormal(new Vector3()),
          nb = b.getNormal(new Vector3()),
          sharedCoordinates = [a.a, a.b, a.c].some((v) =>
            [b.a, b.b, b.c].some((w) => v.equals(w)),
          );
        let kind = "pointOrEdgeContacts",
          overlapArea = 0;
        if (na.lengthSq() === 0 || nb.lengthSq() === 0)
          kind = "degenerateOrUnclassified";
        else if (
          na.clone().cross(nb).lengthSq() === 0 &&
          na.dot(b.a.clone().sub(a.a)) === 0
        ) {
          overlapArea = coplanarArea(a, b, na);
          if (overlapArea > 0) kind = "coplanarPositiveAreaOverlaps";
        } else if (segment.distanceSq() > 0) {
          segment.getCenter(midpoint);
          a.getBarycoord(midpoint, firstBary);
          b.getBarycoord(midpoint, secondBary);
          if (
            Math.min(
              firstBary.x,
              firstBary.y,
              firstBary.z,
              secondBary.x,
              secondBary.y,
              secondBary.z,
            ) > 0
          )
            kind = "properCrossings";
        }
        classifications[kind]++;
        if (intersectionDetails.length < 100) {
          const ix = mesh.geometry.index.array,
            idsA = Array.from(ix.slice(fa * 3, fa * 3 + 3)),
            idsB = Array.from(ix.slice(fb * 3, fb * 3 + 3));
          intersectionDetails.push({
            faces: [fa, fb],
            kind,
            sharedCoordinates,
            segmentLength: segment.distance(),
            coplanarProjectedOverlapArea: overlapArea,
            vertexIds: [idsA, idsB],
            vertices: [
              [a.a.toArray(), a.b.toArray(), a.c.toArray()],
              [b.a.toArray(), b.b.toArray(), b.c.toArray()],
            ],
            density: mesh.geometry.attributes.density
              ? [idsA, idsB].map((ids) =>
                  ids.map((id) => mesh.geometry.attributes.density.getX(id)),
                )
              : null,
          });
        }
      }
      return false;
    },
  });
  receipt.reconstruction = {
    path: mesh.path,
    sha256: mesh.sha256,
    geometrySha256: mesh.geometrySha256,
    bytes: mesh.bytes,
    topology: targetTopology,
  };
  receipt.distances = {
    sourceVerticesToMesh: stats(sourceDistances),
    meshVerticesToSourceTopology: stats(vertexDistances),
    meshFaceCentroidsToSourceTopology: stats(centroidDistances),
  };
  const outputDensity = mesh.geometry.attributes.density;
  if (outputDensity) {
    const intervalLimit = sourceTopology.minimumIncidentEdgeLength.p50 * 2,
      near = [],
      far = [];
    for (let i = 0; i < vertexDistances.length; i++)
      (vertexDistances[i] <= intervalLimit ? near : far).push(
        outputDensity.getX(i),
      );
    receipt.densityVersusReferenceSupport = {
      distanceLimit: intervalLimit,
      method:
        "Output vertex density grouped by exact closest distance to original source triangles; this is a parameter diagnostic, not a changed acceptance gate.",
      withinTwoSourceIntervals: near.length ? stats(near) : null,
      fartherThanTwoSourceIntervals: far.length ? stats(far) : null,
    };
  }
  const normalStats = (values, invalid) =>
    values.length
      ? {
          normalizedSignedDot: stats(values),
          fractionOpposed: values.filter((v) => v < 0).length / values.length,
          invalidOrZero: invalid,
        }
      : { available: false, invalidOrZero: invalid };
  receipt.normalAgreement = {
    sourceVerticesAgainstClosestReconstructedGeometricFace: normalStats(
      sourceAgreement,
      invalidSourceAgreement,
    ),
    outputVertexNormalsAgainstInterpolatedSourceNormals: normalStats(
      vertexAgreement,
      invalidVertexAgreement,
    ),
    outputGeometricFaceNormalsAgainstInterpolatedSourceNormals: normalStats(
      centroidAgreement,
      invalidCentroidAgreement,
    ),
  };
  receipt.selfIntersection = {
    complete,
    candidatePairs: candidates,
    adjacentPairsExcluded,
    nonAdjacentIntersectingTrianglePairs: selfIntersections,
    examples,
    classifications,
    intersectionDetails,
    classificationMethod:
      "No epsilon introduced. Exact Float32 coordinate equality is separately flagged. Noncoplanar positive-length intersections are proper crossings only if their segment midpoint has strictly positive barycentric coordinates inside both triangles. Coplanar positive projected polygon area is reported separately; degenerate cases remain unclassified. Floating-point predicates are diagnostic rather than exact arithmetic certification.",
    method:
      "MeshBVH broadphase self-cast, unique face pairs, ExtendedTriangle narrowphase; pairs sharing any indexed vertex are excluded. Fixed 20 million candidate work limit reports incomplete instead of passing.",
  };
  mesh.geometry.dispose();
}
if (args["--acceptance"]) {
  const bytes = await readFile(args["--acceptance"]),
    gates = JSON.parse(bytes);
  assert.equal(
    gates.sourceSha256,
    source.sha256,
    "Acceptance gates reference a different source scan.",
  );
  const checks = [];
  if (receipt.reconstruction) {
    for (const [name, limits] of Object.entries(gates.distanceGates)) {
      for (const [metric, limit] of Object.entries(limits)) {
        const field = metric.replace(/Maximum$/, ""),
          actual = receipt.distances[name][field];
        checks.push({
          name: `${name}.${field}`,
          actual,
          maximum: limit,
          passed: Number.isFinite(actual) && actual <= limit,
        });
      }
    }
    for (const [metric, limit] of Object.entries(gates.topologyGates)) {
      if (metric === "selfIntersectionAnalysisComplete") {
        checks.push({
          name: metric,
          actual: receipt.selfIntersection.complete,
          required: limit,
          passed: receipt.selfIntersection.complete === limit,
        });
      } else {
        const field = metric.replace(/Maximum$/, ""),
          actual =
            field === "nonAdjacentIntersectingTrianglePairs"
              ? receipt.selfIntersection[field]
              : receipt.reconstruction.topology[field];
        checks.push({
          name: field,
          actual,
          maximum: limit,
          passed: Number.isFinite(actual) && actual <= limit,
        });
      }
    }
  }
  receipt.acceptance = {
    path: args["--acceptance"],
    sha256: hash(bytes),
    checks,
    passed: receipt.reconstruction
      ? checks.every((check) => check.passed)
      : null,
  };
  if (receipt.acceptance.passed === false) process.exitCode = 1;
}
receipt.analyzerSha256 = hash(await readFile(new URL(import.meta.url)));
await mkdir(dirname(args["--report"]), { recursive: true });
await writeFile(args["--report"], JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
source.geometry.dispose();
