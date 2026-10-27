import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { assertSketchPlacement } from "./sketch-surface-placement.mjs";

// Equality between GUI/MCP buffers is exact. Independent geometry uses these
// separate tolerances; native GProp's nonadaptive curved-surface integration is
// approximate. No display-mesh tolerance is used for exact endpoints or bounds.
const tolerances = {
  endpointMm: 1e-7,
  boundsMm: 1e-6,
  normal: 1e-8,
  massAbsoluteMm3: 1e-6,
  massRelative: 1e-8,
  curvedAreaRelative: 1e-5,
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const scale = (a, factor) => a.map((value) => value * factor);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const unit = (a) => scale(a, 1 / Math.hypot(...a));
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const near = (a, b, tolerance = tolerances.endpointMm) =>
  a.length === b.length &&
  a.every((n, axis) => Math.abs(n - b[axis]) <= tolerance);
function close(actual, expected, absolute, relative = 0, label = "value") {
  assert(Number.isFinite(actual) && Number.isFinite(expected));
  assert(
    Math.abs(actual - expected) <=
      Math.max(absolute, Math.abs(expected) * relative),
    `${label}: actual ${actual}, independent expected ${expected}`,
  );
}
function polygonStats(points) {
  let twiceArea = 0,
    momentX = 0,
    momentY = 0,
    perimeter = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = cross2(point, next);
    twiceArea += cross;
    momentX += (point[0] + next[0]) * cross;
    momentY += (point[1] + next[1]) * cross;
    perimeter += Math.hypot(...subtract(next, point));
  });
  assert(twiceArea > 0, "Retained profile must have positive CCW area");
  return {
    area: twiceArea / 2,
    centroid: [momentX / (3 * twiceArea), momentY / (3 * twiceArea)],
    perimeter,
  };
}
function polygonSketch(points, z) {
  return {
    version: 1,
    points: points.map(([x, y], index) => ({ id: `p${index}`, x, y })),
    segments: points.map((_, index) => ({
      id: `e${index}`,
      a: `p${index}`,
      b: `p${(index + 1) % points.length}`,
    })),
    constraints: [],
    frame: { origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  };
}
function exactBounds(report) {
  const edges = report.edgeReferences;
  assert(
    edges && edges.nextOffset === null && edges.items.length === edges.total,
  );
  return Object.fromEntries(
    ["min", "max"].map((key) => [
      key,
      [0, 1, 2].map((axis) => {
        const values = edges.items.map((edge) => {
          assert(edge.boundsMm, "Public native bounds are required");
          return edge.boundsMm[key][axis];
        });
        return key === "min" ? Math.min(...values) : Math.max(...values);
      }),
    ]),
  );
}
function assertBounds(report, expected) {
  const actual = exactBounds(report);
  for (const key of ["min", "max"])
    assert(
      near(actual[key], expected[key], tolerances.boundsMm),
      `Exact ${key} bounds ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
  return actual;
}
function assertMass(report, expected) {
  assert.equal(report.valid, true, JSON.stringify(report));
  assert.equal(report.solids, 1);
  assert(
    report.signedVolumeMm3 > 0,
    "A valid solid must retain outward orientation",
  );
  close(
    report.signedVolumeMm3,
    expected,
    tolerances.massAbsoluteMm3,
    tolerances.massRelative,
    "signed volume mm3",
  );
  close(
    report.volumeMm3,
    expected,
    tolerances.massAbsoluteMm3,
    tolerances.massRelative,
    "volume mm3",
  );
}
function assertArea(report, expected, curved = false) {
  close(
    report.areaMm2,
    expected,
    1e-6,
    curved ? tolerances.curvedAreaRelative : tolerances.massRelative,
    "area mm2",
  );
}
function planePresent(references, point, normal) {
  const expected = unit(normal);
  return references.find(
    (item) =>
      item.kind === "plane" &&
      item.point &&
      item.direction &&
      Math.abs(Math.abs(dot(unit(item.direction), expected)) - 1) <=
        tolerances.normal &&
      Math.abs(dot(subtract(item.point, point), expected)) <=
        tolerances.endpointMm,
  );
}
function assertPrismPlanes(references, points, z, height) {
  assert(
    planePresent(references, [0, 0, z], [0, 0, 1]),
    "Bottom plane missing",
  );
  assert(
    planePresent(references, [0, 0, z + height], [0, 0, 1]),
    "Top plane missing",
  );
  points.forEach((point, index) => {
    const edge = subtract(points[(index + 1) % points.length], point);
    assert(
      planePresent(references, [...point, z], [edge[1], -edge[0], 0]),
      `Independent side plane missing at profile vertex ${index}`,
    );
  });
}
function assertPrismSeams(report, points, bottom, depth, levels) {
  // Boolean fusion can retain coplanar split faces. Their seam vertices must
  // still lie at independently known source/overlap levels on the same prism.
  const all = report.edgeReferences.items.flatMap((edge) => {
    assert.equal(edge.kind, "line");
    assert(edge.endpoints);
    const [a, b] = edge.endpoints;
    if (!near(a.slice(0, 2), b.slice(0, 2))) {
      close(a[2], b[2], tolerances.endpointMm);
      assert(
        points.some((point, index) => {
          const next = points[(index + 1) % points.length];
          return (
            (near(a.slice(0, 2), point) && near(b.slice(0, 2), next)) ||
            (near(b.slice(0, 2), point) && near(a.slice(0, 2), next))
          );
        }),
        "Boolean boundary line must join adjacent authored vertices",
      );
    }
    return edge.endpoints;
  });
  for (const point of all) {
    assert(points.some((expected) => near(point.slice(0, 2), expected)));
    assert(
      levels.some(
        (level) => Math.abs(point[2] - level) <= tolerances.endpointMm,
      ),
    );
  }
  for (const point of points)
    for (const level of [bottom, bottom + depth])
      assert(all.some((actual) => near(actual, [...point, level])));
  assertBounds(report, {
    min: [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      bottom,
    ],
    max: [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
      bottom + depth,
    ],
  });
}
function cornerGeometry(points, index, amount, operation, z) {
  const vertex = points[index];
  const previous = points[(index + points.length - 1) % points.length];
  const next = points[(index + 1) % points.length];
  const a = unit(subtract(previous, vertex)),
    b = unit(subtract(next, vertex));
  assert(
    cross2(subtract(vertex, previous), subtract(next, vertex)) > 0,
    "Edge-treatment oracle requires a convex CCW vertex",
  );
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const turn = Math.PI - theta;
  const distance =
    operation === "fillet" ? amount / Math.tan(theta / 2) : amount;
  assert(
    distance <
      Math.min(
        Math.hypot(...subtract(previous, vertex)),
        Math.hypot(...subtract(next, vertex)),
      ) /
        4,
    "Treatment must fit adjacent edges",
  );
  const before = add(vertex, scale(a, distance));
  const after = add(vertex, scale(b, distance));
  const footprint = points.flatMap((point, slot) =>
    slot === index ? [before, after] : [point],
  );
  const sketch = polygonSketch(footprint, z);
  const cutIndex = index;
  const center = add(
    vertex,
    scale(unit(add(a, b)), amount / Math.sin(theta / 2)),
  );
  if (operation === "fillet") {
    const edge = sketch.segments.splice(cutIndex, 1)[0];
    sketch.points.push({ id: "fillet-center", x: center[0], y: center[1] });
    sketch.arcs = [{ ...edge, center: "fillet-center", clockwise: false }];
  }
  return {
    sketch,
    footprint,
    before,
    after,
    center,
    theta,
    turn,
    distance,
    removedArea:
      operation === "fillet"
        ? amount * amount * (1 / Math.tan(theta / 2) - turn / 2)
        : (amount * amount * Math.sin(theta)) / 2,
    perimeterChange:
      -2 * distance +
      (operation === "fillet"
        ? amount * turn
        : Math.hypot(...subtract(after, before))),
  };
}
function inwardPolygon(points, thickness) {
  return points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const a = unit(subtract(point, previous)),
      b = unit(subtract(next, point));
    assert(
      cross2(a, b) > 0,
      "Shell oracle requires a strictly convex retained polygon",
    );
    const first = add(point, scale([-a[1], a[0]], thickness));
    const second = add(point, scale([-b[1], b[0]], thickness));
    const parameter = cross2(subtract(second, first), b) / cross2(a, b);
    return add(first, scale(a, parameter));
  });
}
function brepHashes(bytes, entityIds) {
  assert.equal(bytes.subarray(0, 8).toString(), "SCANFRG2");
  const size = bytes.readUInt32LE(8);
  const manifest = JSON.parse(bytes.subarray(16, 16 + size).toString("utf8"));
  const records = manifest.current.map((index) => manifest.records[index]);
  return entityIds.map((entityId) => {
    const record = records.find((item) => item.id === entityId);
    assert.equal(record?.brep?.type, "text");
    const chunk = manifest.chunks[record.brep.chunk];
    const stored = bytes.subarray(
      16 + size + chunk.offset,
      16 + size + chunk.offset + chunk.bytes,
    );
    const raw = chunk.codec === "gzip" ? gunzipSync(stored) : stored;
    assert.equal(raw.length, chunk.rawBytes);
    assert.equal(hash(raw), chunk.sha256);
    return { entityId, bytes: raw.length, sha256: hash(raw) };
  });
}

/** Optional, isolated from full scan GUI authoring; the retained profile was
 * already authored through those controls in the separate accepted chain. */
export async function replayRealCadMatrix({
  page,
  call,
  mutate,
  job,
  eventually,
  geometryDigest,
  artifactBytes,
  ledger,
  out,
  sourceId,
}) {
  const started = Date.now();
  const checkpoint = () =>
    assert(
      Date.now() - started < 180_000,
      "Real CAD matrix exceeded its existing 180-second browser case budget",
    );
  const state = async () => (await call("project_get")).result;
  const idle = () =>
    eventually(async () => {
      const session = (await call("session_get")).result;
      assert.equal(session.busy, false);
      assert.equal(session.activeJobId, null);
    });
  const original = await state();
  const baselineDigest = await geometryDigest(sourceId);
  const baselineAuthoring = original.authoring;
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../docs/evidence/m5-20261025/sketch-surface-real-scan.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const scanPath = process.env.SCANFORGE_M5_SKETCH_SCAN;
  assert(scanPath, "Real CAD matrix requires SCANFORGE_M5_SKETCH_SCAN");
  const sourceBytes = await readFile(scanPath);
  assert.equal(sourceBytes.length, fixture.bytes);
  assert.equal(
    hash(sourceBytes),
    fixture.sha256,
    "The retained profile requires the exact proven scan",
  );
  assert(fixture.guiProfileAuthoredWithRenderedPointAndSegmentControls);
  assert(fixture.fit.continuousBoundMm <= 0.25);
  assert(
    fixture.fit.measuredMaximumDeviationMm +
      fixture.fit.referenceJoinDisplacementMm <=
      0.25,
  );
  assert.equal(fixture.authoredGuiProfile.points.length, 16);
  const sketch = structuredClone(fixture.authoredGuiProfile);
  assert.deepEqual(sketch.reference, fixture.sectionReference);
  assert.equal(sketch.frame.origin[2], fixture.sectionOptions.offset);
  assert.equal(sketch.arcs?.length ?? 0, 0);
  assert(sketch.segments.every((edge) => !edge.construction));
  const pointMap = new Map(
    sketch.points.map((point) => [point.id, [point.x, point.y]]),
  );
  const points = sketch.segments.map((edge, index) => {
    assert.equal(
      edge.b,
      sketch.segments[(index + 1) % sketch.segments.length].a,
    );
    return pointMap.get(edge.a);
  });
  assert.equal(points.length, 16);
  assert(points.every(Boolean));
  const stats = polygonStats(points),
    z = sketch.frame.origin[2],
    height = 1.8;
  close(stats.area, 84.28827382618772, 1e-10);
  assert.deepEqual(sketch.frame, {
    origin: [0, 0, z],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  });
  const matrix = [],
    createdIds = [];
  const receipt = {
    scope:
      "Real scan-derived retained 16-point profile; GUI/public-MCP CAD operations and independent analytic geometry. No native procedural/oracle equivalence claim.",
    tolerances,
    source: { path: scanPath, sha256: fixture.sha256, bytes: fixture.bytes },
    retainedFit: fixture.fit,
    profile: sketch,
    analyticProfile: stats,
    matrix,
    normalScope:
      "Public plane/axis directions are surface-parametric and checked up to sign; outward solid orientation is checked independently by positive signed volume.",
    passed: false,
    fullGuiProfileAuthoringReplayed: false,
    fullGuiProfileAuthoringEvidence:
      "docs/evidence/m5-20261025/sketch-surface-real-scan.json",
  };
  const saveReceipt = () =>
    writeFile(
      new URL("real-cad-matrix.json", out),
      JSON.stringify(receipt, null, 2),
    );
  const allocatedArtifacts = new Set();
  const ownArtifact = (artifactId) => {
    allocatedArtifacts.add(artifactId);
    return artifactId;
  };
  receipt.artifactCleanup = [];
  const releaseArtifact = async (artifactId) => {
    try {
      await call("artifact_delete", { artifactId });
      allocatedArtifacts.delete(artifactId);
      receipt.artifactCleanup.push({ artifactId, status: "deleted" });
    } catch (failure) {
      receipt.artifactCleanup.push({
        artifactId,
        status: "delete-failed",
        message: failure instanceof Error ? failure.message : String(failure),
      });
      throw failure;
    }
  };
  const withArtifact = async (artifactId, operation) => {
    let operationFailed = false;
    try {
      return await operation();
    } catch (failure) {
      operationFailed = true;
      throw failure;
    } finally {
      try {
        await releaseArtifact(artifactId);
      } catch (failure) {
        // Preserve the read/import/assertion error. A failed delete remains
        // registered and is retried independently by the outer finally.
        if (!operationFailed) throw failure;
      }
    }
  };
  const exportArtifact = async (args) => {
    const artifact = await job(await call("project_export", args));
    ownArtifact(artifact.artifactId);
    return artifact;
  };
  const upload = async (bytes, name) => {
    assert(bytes.length > 0 && bytes.length <= 64 * 1024 * 1024);
    let artifactId;
    for (let offset = 0; offset < bytes.length; offset += 1048576) {
      artifactId = (
        await call("artifact_put", {
          name,
          offset,
          ...(artifactId ? { artifactId } : {}),
          base64: bytes.subarray(offset, offset + 1048576).toString("base64"),
        })
      ).result.artifactId;
      // Register the first acknowledged allocation before another chunk can fail.
      ownArtifact(artifactId);
    }
    return artifactId;
  };
  const inspect = async (entityId) => {
    checkpoint();
    const report = await job(
      await call("cad_inspect", { entityId, edgeOffset: 0, edgeLimit: 128 }),
    );
    assert(
      report.edgeReferences.nextOffset === null,
      "Matrix expects at most 128 exact edges",
    );
    return report;
  };
  const references = async (entityId) => {
    const result = await job(
      await call("alignment_references", { entityId, offset: 0, limit: 100 }),
    );
    assert.equal(result.nextOffset, null);
    return result.references;
  };
  const ref = async (entityId) => {
    const object = (await call("object_get", { entityId })).result;
    return {
      featureId: object.parametric.feature.id,
      output: object.parametric.output,
    };
  };
  const create = async (recipe, name) => {
    const before = await state();
    const result = await job(
      await mutate("cad_create", { recipe, name, selectCreated: true }),
    );
    assert.equal(result.entityIds.length, 1);
    assert.equal((await state()).undo, before.undo + 1);
    return result.entityIds[0];
  };
  const onlyVisible = async (entityIds) => {
    const changes = (await state()).objects.filter(
      (item) => item.visible !== entityIds.includes(item.id),
    );
    if (changes.length)
      await mutate("object_visibility_toggle", {
        entityIds: changes.map((item) => item.id),
      });
  };
  let primaryFailure;
  try {
    const sourceBeforeImport = await state();
    const scanArtifact = await upload(sourceBytes, basename(scanPath));
    const imported = await withArtifact(scanArtifact, async () =>
      job(
        await mutate("project_import", {
          artifactId: scanArtifact,
          unit: "mm",
          placeAtOrigin: false,
        }),
      ),
    );
    const scanAdded = (await state()).objects.filter(
      (item) => !sourceBeforeImport.objects.some((old) => old.id === item.id),
    );
    assert.equal(scanAdded.length, 1, JSON.stringify(imported));
    const scanId = scanAdded[0].id;
    const scanDigest = await geometryDigest(scanId);
    assert.deepEqual(scanDigest, fixture.sourceBuffers);
    sketch.reference.sourceId = scanId;
    receipt.source.entityId = scanId;
    receipt.source.buffers = scanDigest;
    // Shared CAD setup consumes the retained snapshot without modifying active authoring.
    const faceId = await create(
      { kind: "sketchSurface", sketch },
      "Real matrix retained profile face",
    );
    const baseId = await create(
      { kind: "thicken", source: await ref(faceId), thickness: height },
      "Real matrix prism",
    );
    const baseReport = await inspect(baseId);
    assertMass(baseReport, stats.area * height);
    assertSketchPlacement(baseReport, sketch, height);
    assertArea(baseReport, 2 * stats.area + stats.perimeter * height);
    const baseReferences = await references(baseId);
    assertPrismPlanes(baseReferences, points, z, height);
    const baseRef = await ref(baseId);
    const toolId = await create(
      {
        kind: "transform",
        source: baseRef,
        translation: [0, 0, height / 2],
        rotation: [0, 0, 0],
        scale: 1,
      },
      "Real matrix half-height tool",
    );
    const farId = await create(
      {
        kind: "transform",
        source: baseRef,
        translation: [0, 0, 10 * height],
        rotation: [0, 0, 0],
        scale: 1,
      },
      "Real matrix disjoint tool",
    );
    const toolRef = await ref(toolId),
      farRef = await ref(farId);
    const protectedIds = [faceId, baseId, toolId, farId];
    const protectedDigests = [];
    for (const id of protectedIds)
      protectedDigests.push(await geometryDigest(id));
    const snapshotBytes = async () => {
      const artifact = await exportArtifact({ format: "project" });
      return withArtifact(artifact.artifactId, () => artifactBytes(artifact));
    };
    const projectBreps = async (entityIds, captureLabel) => {
      const artifact = await exportArtifact({ format: "project" });
      const range = async (offset, length) => {
        const chunks = [];
        for (let read = 0; read < length;) {
          const count = Math.min(65536, length - read);
          const part = (
            await call("artifact_read", {
              artifactId: artifact.artifactId,
              offset: offset + read,
              length: count,
            })
          ).result;
          const chunk = Buffer.from(part.base64, "base64");
          assert.equal(chunk.length, count);
          chunks.push(chunk);
          read += count;
        }
        return Buffer.concat(chunks);
      };
      return withArtifact(artifact.artifactId, async () => {
        const header = await range(0, 16);
        assert.equal(header.subarray(0, 8).toString(), "SCANFRG2");
        const size = header.readUInt32LE(8);
        assert(size > 0 && size <= 4 * 1024 * 1024, "Bounded project manifest");
        const manifest = JSON.parse((await range(16, size)).toString("utf8"));
        const records = manifest.current.map(
          (index) => manifest.records[index],
        );
        const result = [];
        for (const entityId of entityIds) {
          const record = records.find((item) => item.id === entityId);
          assert.equal(record?.brep?.type, "text");
          const chunk = manifest.chunks[record.brep.chunk];
          assert(chunk.bytes > 0 && chunk.bytes <= 4 * 1024 * 1024);
          const stored = await range(16 + size + chunk.offset, chunk.bytes);
          const raw = chunk.codec === "gzip" ? gunzipSync(stored) : stored;
          assert.equal(raw.length, chunk.rawBytes);
          assert.equal(hash(raw), chunk.sha256);
          if (captureLabel) {
            const file = `${captureLabel}-${entityId}.brep`;
            await writeFile(new URL(file, out), raw);
            (receipt.brepFiles ??= []).push({
              entityId,
              file,
              bytes: raw.length,
              sha256: hash(raw),
            });
          }
          result.push({ entityId, bytes: raw.length, sha256: hash(raw) });
        }
        return result;
      });
    };
    const protectedBreps = await projectBreps(protectedIds);
    const assertSources = async () => {
      assert.deepEqual(await geometryDigest(sourceId), baselineDigest);
      assert.deepEqual(await geometryDigest(scanId), scanDigest);
      assert.deepEqual((await state()).authoring, baselineAuthoring);
      for (let index = 0; index < protectedIds.length; index++)
        assert.deepEqual(
          await geometryDigest(protectedIds[index]),
          protectedDigests[index],
        );
    };
    const open = async (workspace, selected = baseId) => {
      checkpoint();
      await mutate("object_select", { entityId: selected });
      await page
        .getByRole("tab", {
          name: ["loft", "sweep"].includes(workspace) ? "Surfacing" : "CAD",
          exact: true,
        })
        .click();
      const command = (await call("command_get")).result.commands.find(
        (item) => item.name === `ribbon:${workspace}`,
      );
      assert.equal(
        command?.available,
        true,
        `Ribbon/MCP discovery must admit ${workspace}`,
      );
      const button = page.locator(`button[data-command="${workspace}"]`);
      assert.equal(await button.count(), 1);
      assert(await button.isEnabled());
      await button.click();
    };
    const text = (name) => page.getByRole("textbox", { name, exact: true });
    const field = (name) => page.getByRole("spinbutton", { name, exact: true });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const select = async (label, name) => {
      await button(label).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    const terminal = async (jobId) =>
      eventually(async () => {
        const result = (await call("job_get", { jobId })).result;
        assert.notEqual(result.status, "running");
        return result;
      });
    const unchanged = (before, after) => {
      assert.equal(after.revision, before.revision);
      const core = (project) => ({
        ...project,
        objects: project.objects.map(
          ({ meshPreparation, ...object }) => object,
        ),
      });
      assert.deepEqual(core(after.result), core(before.result));
    };
    const failPair = async (spec) => {
      await spec.prepare(true);
      await mutate("ui_set", { dismissError: true });
      const before = await call("project_get");
      await button(spec.button).click();
      const banner = page.locator(".error-banner");
      await banner.waitFor();
      const guiMessage = await banner.locator("span").textContent();
      await idle();
      unchanged(before, await call("project_get"));
      const pending = await mutate("cad_create", {
        name: "Rejected real matrix case",
        recipe: spec.invalid,
      });
      const failed = await terminal(pending.result.jobId);
      assert.equal(failed.status, "failed", JSON.stringify(failed));
      assert.equal(guiMessage, failed.error.message);
      unchanged(before, await call("project_get"));
      await assertSources();
      await mutate("ui_set", { dismissError: true });
      return {
        message: failed.error.message,
        code: failed.error.code,
        sourcesAndHistoryPreserved: true,
      };
    };
    const stepRoundTrip = async (entityId, verify, label, gui) => {
      await onlyVisible([entityId]);
      const beforeExport = await call("project_get");
      let bytes, artifactId;
      if (gui) {
        const pending = page.waitForEvent("download");
        await page
          .locator(".header-actions")
          .getByRole("button", { name: "Export STEP", exact: true })
          .click();
        const download = await pending;
        const path = new URL(`${label}-gui.step`, out);
        await download.saveAs(fileURLToPath(path));
        bytes = await readFile(path);
        await idle();
        artifactId = await upload(bytes, `${label}-gui.step`);
      } else {
        const artifact = await exportArtifact({
          format: "step",
          visible: true,
          cadOnly: true,
        });
        bytes = await artifactBytes(artifact);
        artifactId = artifact.artifactId;
        await writeFile(new URL(`${label}-mcp.step`, out), bytes);
      }
      unchanged(beforeExport, await call("project_get"));
      const beforeImport = await state();
      await withArtifact(artifactId, async () => {
        await job(
          await mutate("project_import", {
            artifactId,
            unit: "mm",
            placeAtOrigin: false,
          }),
        );
      });
      const imported = (await state()).objects.filter(
        (item) => !beforeImport.objects.some((old) => old.id === item.id),
      );
      assert.equal(imported.length, 1);
      assert.equal((await state()).undo, beforeImport.undo + 1);
      const report = await inspect(imported[0].id);
      await verify(imported[0].id, report);
      return {
        via: gui ? "GUI" : "MCP",
        sha256: hash(bytes),
        bytes: bytes.length,
        report,
      };
    };
    const runPair = async (spec) => {
      checkpoint();
      receipt.currentCase = { family: spec.key, intendedRecipe: spec.recipe };
      await open(spec.workspace);
      const failure = spec.invalid ? await failPair(spec) : null;
      await spec.prepare(false);
      await page.screenshot({
        path: fileURLToPath(new URL(`real-cad-${spec.key}-form.png`, out)),
      });
      const before = await state();
      const oldJobs = new Set(
        (await call("session_get")).result.jobs.map((item) => item.jobId),
      );
      assert(await button(spec.button).isEnabled());
      await button(spec.button).click();
      const guiId = await eventually(async () => {
        const next = await state();
        const added = next.objects.filter(
          (item) => !before.objects.some((old) => old.id === item.id),
        );
        assert.equal(added.length, 1);
        assert.equal(next.undo, before.undo + 1);
        assert.equal(next.selectedId, added[0].id);
        return added[0].id;
      });
      await idle();
      const guiJobs = (await call("session_get")).result.jobs.filter(
        (item) => !oldJobs.has(item.jobId) && item.command === "cad_create",
      );
      assert.equal(guiJobs.length, 1);
      const guiTerminal = await terminal(guiJobs[0].jobId);
      assert.equal(guiTerminal.status, "succeeded");
      assert.deepEqual(guiTerminal.result.entityIds, [guiId]);
      const guiObject = (await call("object_get", { entityId: guiId })).result;
      assert.deepEqual(
        guiObject.parametric.feature.recipe,
        spec.recipe,
        "GUI must submit the intended real-derived recipe",
      );
      assert.equal(guiObject.name, spec.name);
      const guiReport = await inspect(guiId);
      await spec.verify(guiId, guiReport);
      const guiDigest = await geometryDigest(guiId);
      const guiBrep = (await projectBreps([guiId], `${spec.key}-gui`))[0];
      await mutate("history_undo", { scope: "model" });
      assert(!(await state()).objects.some((item) => item.id === guiId));
      await mutate("history_redo", { scope: "model" });
      assert.deepEqual(await geometryDigest(guiId), guiDigest);
      assert.equal((await projectBreps([guiId]))[0].sha256, guiBrep.sha256);
      await mutate("history_undo", { scope: "model" });
      const cloneBefore = await state();
      const mcp = await job(
        await mutate("cad_create", {
          name: spec.name,
          recipe: structuredClone(spec.recipe),
          hideInputs: spec.hideInputs ?? false,
          selectCreated: true,
        }),
      );
      assert.equal(mcp.entityIds.length, 1);
      const mcpId = mcp.entityIds[0];
      assert.equal((await state()).undo, cloneBefore.undo + 1);
      assert.equal((await state()).selectedId, mcpId);
      assert.deepEqual(await geometryDigest(mcpId), guiDigest);
      const mcpReport = await inspect(mcpId);
      await spec.verify(mcpId, mcpReport);
      await mutate("history_undo", { scope: "model" });
      assert(!(await state()).objects.some((item) => item.id === mcpId));
      await mutate("history_redo", { scope: "model" });
      assert.equal((await state()).undo, cloneBefore.undo + 1);
      assert.deepEqual(await geometryDigest(mcpId), guiDigest);
      const mcpBrep = (await projectBreps([mcpId], `${spec.key}-mcp`))[0];
      receipt.currentCase = {
        ...receipt.currentCase,
        guiId,
        mcpId,
        guiBrep,
        mcpBrep,
        guiReport,
        mcpReport,
        displayBuffersBitExact: true,
      };
      if (mcpBrep.sha256 !== guiBrep.sha256) {
        receipt.currentCase.storedSourceBreps = await projectBreps(
          protectedIds,
          `${spec.key}-stored-source`,
        );
        receipt.currentCase.sourceBrepScope =
          "Stored entity BREP strings only; separate focused worker probe is required to inspect live native source mutation.";
        await saveReceipt();
      }
      assert.equal(
        mcpBrep.sha256,
        guiBrep.sha256,
        "GUI/MCP exact saved BREP bytes must match",
      );
      if (spec.hideInputs) {
        assert.equal(
          (await call("object_get", { entityId: baseId })).result.visible,
          false,
        );
        assert.equal(
          (await call("object_get", { entityId: toolId })).result.visible,
          false,
        );
      }
      const guiStep = await stepRoundTrip(mcpId, spec.verify, spec.key, true);
      const mcpStep = await stepRoundTrip(mcpId, spec.verify, spec.key, false);
      await assertSources();
      await onlyVisible([mcpId]);
      await mutate("object_select", { entityId: mcpId });
      await mutate("viewport_control", { action: "fit", entityId: mcpId });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const renderedResult = `real-cad-${spec.key}-result.png`;
      await page.screenshot({
        path: fileURLToPath(new URL(renderedResult, out)),
      });
      createdIds.push(mcpId);
      matrix.push({
        family: spec.key,
        intendedRecipe: spec.recipe,
        independent: spec.independent,
        guiJobId: guiJobs[0].jobId,
        failure,
        guiReport,
        mcpReport,
        guiMcpRawGeometryAndBrepEqual: true,
        oneModelEditPerCreate: true,
        modelUndoRedoExact: true,
        activeAuthoringUnchanged: true,
        guiStep,
        mcpStep,
        renderedResult,
      });
      await saveReceipt();
    };

    // Family cases follow below; no synthetic default profile substitutes for P16.
    const prism =
      (bottom, depth, profile = points, seamLevels = null) =>
      async (entityId, report) => {
        const profileStats = polygonStats(profile);
        assertMass(report, profileStats.area * depth);
        assertArea(
          report,
          2 * profileStats.area + profileStats.perimeter * depth,
        );
        if (seamLevels)
          assertPrismSeams(report, profile, bottom, depth, seamLevels);
        else
          assertSketchPlacement(report, polygonSketch(profile, bottom), depth);
        assertPrismPlanes(await references(entityId), profile, bottom, depth);
      };
    const loft = {
      kind: "loft",
      profiles: [
        { points, z },
        { points, z: z + height },
      ],
      ruled: true,
    };
    const invalidLoft = {
      ...loft,
      profiles: [
        { points, z },
        { points, z },
      ],
    };
    await runPair({
      key: "loft",
      workspace: "loft",
      name: "Loft",
      button: "Create exact loft",
      recipe: loft,
      invalid: invalidLoft,
      independent: { volumeMm3: stats.area * height, z, height },
      prepare: async (invalid) => {
        await text("Loft profiles").fill(
          JSON.stringify((invalid ? invalidLoft : loft).profiles),
        );
        await page
          .getByRole("checkbox", { name: "Ruled sides", exact: true })
          .check();
      },
      verify: prism(z, height),
    });
    const sweep = {
      kind: "sweep",
      points,
      path: [
        [0, 0, z],
        [0, 0, z + height],
      ],
    };
    const invalidSweep = {
      ...sweep,
      path: [
        [0, 0, z],
        [0, 0, z],
      ],
    };
    await runPair({
      key: "sweep",
      workspace: "sweep",
      name: "Sweep",
      button: "Create exact sweep",
      recipe: sweep,
      invalid: invalidSweep,
      independent: {
        volumeMm3: stats.area * height,
        positiveTangent: [0, 0, 1],
      },
      prepare: async (invalid) => {
        await text("Sweep profile").fill(JSON.stringify(points));
        await text("Sweep path").fill(
          JSON.stringify((invalid ? invalidSweep : sweep).path),
        );
      },
      verify: prism(z, height),
    });
    const minX = Math.min(...points.map((point) => point[0]));
    const radialProfile = points.map(([x, y]) => [x - minX + 10, z + y]);
    const radial = polygonStats(radialProfile);
    const revolve = {
      kind: "revolve",
      points: radialProfile,
      angleDegrees: 360,
    };
    const invalidRevolve = {
      ...revolve,
      points: radialProfile.map(([r, elevation]) => [-r, elevation]),
    };
    const radiusMax = Math.max(...radialProfile.map((point) => point[0]));
    const revolveVolume = 2 * Math.PI * radial.area * radial.centroid[0];
    const revolveArea = radialProfile.reduce((sum, point, index) => {
      const next = radialProfile[(index + 1) % radialProfile.length];
      return (
        sum +
        Math.PI * (point[0] + next[0]) * Math.hypot(...subtract(next, point))
      );
    }, 0);
    await runPair({
      key: "revolve",
      workspace: "revolve",
      name: "Revolved solid",
      button: "Revolve profile to CAD",
      recipe: revolve,
      invalid: invalidRevolve,
      independent: {
        volumeMm3: revolveVolume,
        areaMm2: revolveArea,
        rigidProfilePlacement: {
          radiusTranslation: 10 - minX,
          zTranslation: z,
        },
      },
      prepare: async (invalid) => {
        await text("Revolve profile").fill(
          (invalid ? invalidRevolve : revolve).points
            .map((point) => point.join(","))
            .join("\n"),
        );
        await field("Revolution (°)").fill("360");
      },
      verify: async (_entityId, report) => {
        assertMass(report, revolveVolume);
        assertArea(report, revolveArea, true);
        assertBounds(report, {
          min: [
            -radiusMax,
            -radiusMax,
            Math.min(...radialProfile.map((p) => p[1])),
          ],
          max: [
            radiusMax,
            radiusMax,
            Math.max(...radialProfile.map((p) => p[1])),
          ],
        });
        const edges = report.edgeReferences.items;
        for (const [radius, elevation] of radialProfile) {
          const circle = edges.find(
            (edge) =>
              edge.kind === "circle" &&
              near(
                edge.boundsMm.min,
                [-radius, -radius, elevation],
                tolerances.boundsMm,
              ) &&
              near(
                edge.boundsMm.max,
                [radius, radius, elevation],
                tolerances.boundsMm,
              ),
          );
          assert(
            circle,
            `Independent revolution circle missing at r=${radius}, z=${elevation}`,
          );
          close(circle.lengthMm, 2 * Math.PI * radius, 1e-7);
        }
      },
    });
    for (const operation of ["subtract", "intersect", "union"]) {
      const recipe = {
        kind: "boolean",
        operation,
        first: baseRef,
        second: toolRef,
      };
      const bottom = operation === "intersect" ? z + height / 2 : z;
      const depth = operation === "union" ? 1.5 * height : height / 2;
      const invalid =
        operation === "intersect" ? { ...recipe, second: farRef } : null;
      await runPair({
        key: `boolean-${operation}`,
        workspace: "boolean",
        name: `${operation} result`,
        button: "Create boolean result",
        recipe,
        invalid,
        hideInputs: true,
        independent: {
          volumeMm3: stats.area * depth,
          bottom,
          depth,
          normalTranslationMm: height / 2,
        },
        prepare: async (bad) => {
          await select(
            "Boolean operation",
            { subtract: "Subtract", intersect: "Intersect", union: "Union" }[
              operation
            ],
          );
          await select(
            "Boolean tool body",
            bad ? "Real matrix disjoint tool" : "Real matrix half-height tool",
          );
        },
        verify: prism(
          bottom,
          depth,
          points,
          operation === "union"
            ? [z, z + height / 2, z + height, z + 1.5 * height]
            : null,
        ),
      });
    }
    // Pick a well-separated convex corner from its geometry, then discover its
    // actual native vertical-edge index. No index-0/topological-order assumption.
    const cornerCandidates = points
      .map((point, index) => {
        const previous = points[(index + points.length - 1) % points.length];
        const next = points[(index + 1) % points.length];
        const incoming = subtract(point, previous),
          outgoing = subtract(next, point);
        return {
          index,
          turn: Math.atan2(cross2(incoming, outgoing), dot(incoming, outgoing)),
        };
      })
      .filter((item) => item.turn > 0)
      .sort((a, b) => b.turn - a.turn);
    assert(cornerCandidates.length);
    const cornerIndex = cornerCandidates[0].index,
      cornerPoint = points[cornerIndex];
    const edgeSourceReport = await inspect(baseId);
    const vertical = edgeSourceReport.edgeReferences.items.filter(
      (edge) =>
        edge.kind === "line" &&
        edge.endpoints &&
        edge.endpoints.every((point) => near(point.slice(0, 2), cornerPoint)) &&
        near(
          [...edge.endpoints.map((point) => point[2])].sort((a, b) => a - b),
          [z, z + height],
        ),
    );
    assert.equal(vertical.length, 1);
    const edgeIndex = vertical[0].index;
    for (const operation of ["fillet", "chamfer"]) {
      const amount = 0.15;
      const corner = cornerGeometry(points, cornerIndex, amount, operation, z);
      const volume = (stats.area - corner.removedArea) * height;
      const area =
        2 * (stats.area - corner.removedArea) +
        (stats.perimeter + corner.perimeterChange) * height;
      const recipe = {
        kind: "edges",
        source: baseRef,
        edgeIndices: [edgeIndex],
        amount,
        operation,
      };
      const invalid = {
        ...recipe,
        edgeIndices: [baseReport.edgeReferences.total],
      };
      await runPair({
        key: operation,
        workspace: operation,
        name: operation,
        button: operation === "fillet" ? "Create fillet" : "Create chamfer",
        recipe,
        invalid,
        independent: {
          sourceEdge: vertical[0],
          vertexIndex: cornerIndex,
          amountMm: amount,
          volumeMm3: volume,
          areaMm2: area,
          corner,
        },
        prepare: async (bad) => {
          await field(
            operation === "fillet"
              ? "Fillet radius (mm)"
              : "Chamfer distance (mm)",
          ).fill(String(amount));
          await text("CAD edge indices").fill(
            bad ? String(baseReport.edgeReferences.total) : "",
          );
          if (bad) return;
          const panel = page.getByRole("region", {
            name: "Exact CAD edge references",
            exact: true,
          });
          await panel
            .getByRole("button", { name: "Inspect CAD edges", exact: true })
            .click();
          let offset = 0;
          while (true) {
            await eventually(async () => {
              assert.equal(
                await panel.getByRole("checkbox").count(),
                Math.min(32, baseReport.edges - offset),
              );
              assert(await panel.getByRole("checkbox").first().isEnabled());
            });
            if (edgeIndex >= offset && edgeIndex < offset + 32) break;
            offset += 32;
            assert(offset < baseReport.edges);
            await panel
              .getByRole("button", { name: "Next edges", exact: true })
              .click();
          }
          await panel
            .getByRole("checkbox", {
              name: `Edge ${edgeIndex} line`,
              exact: true,
            })
            .check();
          assert.equal(
            await text("CAD edge indices").inputValue(),
            String(edgeIndex),
          );
        },
        verify: async (entityId, report) => {
          assertMass(report, volume);
          assertArea(report, area, operation === "fillet");
          assertSketchPlacement(report, corner.sketch, height);
          const refs = await references(entityId);
          if (operation === "fillet") {
            const cylinders = refs.filter(
              (item) => item.surfaceKind === "cylinder",
            );
            assert.equal(cylinders.length, 1);
            close(cylinders[0].radiusMm, amount, 1e-7);
            assert(near(cylinders[0].point.slice(0, 2), corner.center));
            close(
              Math.abs(dot(unit(cylinders[0].direction), [0, 0, 1])),
              1,
              tolerances.normal,
            );
            const circles = report.edgeReferences.items.filter(
              (edge) => edge.kind === "circle",
            );
            assert.equal(circles.length, 2);
            circles.forEach((edge) =>
              close(edge.lengthMm, amount * corner.turn, 1e-7),
            );
          } else {
            const edge = subtract(corner.after, corner.before);
            assert(
              planePresent(refs, [...corner.before, z], [edge[1], -edge[0], 0]),
              "Chamfer plane missing",
            );
          }
        },
      });
    }
    const wall = 0.1,
      inner = inwardPolygon(points, wall),
      innerStats = polygonStats(inner);
    const shellSourceReferences = await references(baseId);
    const topCaps = shellSourceReferences.filter(
      (item) =>
        item.kind === "plane" &&
        item.point &&
        item.direction &&
        Math.abs(item.point[2] - (z + height)) <= tolerances.endpointMm &&
        Math.abs(Math.abs(dot(unit(item.direction), [0, 0, 1])) - 1) <=
          tolerances.normal,
    );
    assert.equal(
      topCaps.length,
      1,
      "Discover the actual removable top face by its plane",
    );
    const shell = {
      kind: "shell",
      source: baseRef,
      faceIndices: [topCaps[0].faceIndex],
      thickness: -wall,
    };
    const invalidShell = { ...shell, faceIndices: [baseReport.faces] };
    const shellVolume = stats.area * height - innerStats.area * (height - wall);
    const shellArea =
      stats.perimeter * height +
      2 * stats.area +
      innerStats.perimeter * (height - wall);
    const shellBoundsChecks = [];
    await runPair({
      key: "shell",
      workspace: "shell",
      name: "Shell",
      button: "Create hollow shell",
      recipe: shell,
      invalid: invalidShell,
      independent: {
        removedFace: topCaps[0],
        inwardThicknessMm: wall,
        innerPolygon: inner,
        volumeMm3: shellVolume,
        areaMm2: shellArea,
        boundsOracle:
          "All analytic line edges: curve endpoints define exact physical extrema; public native boxes include kernel tolerance.",
        boundsChecks: shellBoundsChecks,
      },
      prepare: async (bad) => {
        await text("Shell face indices").fill(
          String(bad ? baseReport.faces : topCaps[0].faceIndex),
        );
        await field("Signed wall thickness (mm)").fill(String(-wall));
      },
      verify: async (entityId, report) => {
        assertMass(report, shellVolume);
        assertArea(report, shellArea);
        const expectedVertices = points
          .flatMap((point) => [
            [...point, z],
            [...point, z + height],
          ])
          .concat(
            inner.flatMap((point) => [
              [...point, z + wall],
              [...point, z + height],
            ]),
          );
        const actualVertices = report.edgeReferences.items.flatMap((edge) => {
          assert.equal(
            edge.kind,
            "line",
            "Shell extrema require analytic line edges",
          );
          assert(edge.endpoints, "Shell exact edge endpoints missing");
          return edge.endpoints;
        });
        const vertexBounds = (vertices) =>
          Object.fromEntries(
            ["min", "max"].map((key) => [
              key,
              [0, 1, 2].map((axis) =>
                (key === "min" ? Math.min : Math.max)(
                  ...vertices.map((point) => point[axis]),
                ),
              ),
            ]),
          );
        const endpointBounds = vertexBounds(actualVertices);
        const independentBounds = vertexBounds(expectedVertices);
        const nativeToleranceInclusiveBounds = exactBounds(report);
        const boundsCheck = {
          entityId,
          endpointBounds,
          independentBounds,
          nativeToleranceInclusiveBounds,
        };
        shellBoundsChecks.push(boundsCheck);
        receipt.currentCase = { ...receipt.currentCase, shellBoundsChecks };
        for (const key of ["min", "max"])
          assert(
            near(endpointBounds[key], independentBounds[key]),
            `Shell physical ${key} bounds differ: ${JSON.stringify(boundsCheck)}`,
          );
        // BRepBndLib.Add includes native edge/vertex tolerances; these boxes
        // must enclose the physical endpoints, not equal their exact extrema.
        for (const point of actualVertices)
          for (let axis = 0; axis < 3; axis++)
            assert(
              point[axis] >=
                nativeToleranceInclusiveBounds.min[axis] -
                  tolerances.endpointMm &&
                point[axis] <=
                  nativeToleranceInclusiveBounds.max[axis] +
                    tolerances.endpointMm,
              "Native tolerance-inclusive shell bounds must enclose each exact endpoint",
            );
        for (const expected of expectedVertices)
          assert(
            actualVertices.some((actual) => near(actual, expected)),
            `Shell oracle vertex missing: ${expected}`,
          );
        for (const actual of actualVertices)
          assert(
            expectedVertices.some((expected) => near(actual, expected)),
            `Unexpected shell endpoint: ${actual}`,
          );
        const refs = await references(entityId);
        assert(planePresent(refs, [0, 0, z], [0, 0, 1]));
        assert(planePresent(refs, [0, 0, z + wall], [0, 0, 1]));
        inner.forEach((point, index) => {
          const edge = subtract(inner[(index + 1) % inner.length], point);
          assert(
            planePresent(refs, [...point, z + wall], [edge[1], -edge[0], 0]),
          );
        });
      },
    });
    assert.deepEqual(
      matrix.map((item) => item.family),
      [
        "loft",
        "sweep",
        "revolve",
        "boolean-subtract",
        "boolean-intersect",
        "boolean-union",
        "fillet",
        "chamfer",
        "shell",
      ],
    );
    // Actual source-handle consumption after all failed/successful makers.
    const liveId = await create(
      {
        kind: "transform",
        source: baseRef,
        translation: [0, 0, height],
        rotation: [0, 0, 0],
        scale: 1,
      },
      "Real matrix live source recovery",
    );
    await prism(z + height, height)(liveId, await inspect(liveId));
    await assertSources();
    assert.deepEqual(await projectBreps(protectedIds), protectedBreps);
    const persistedIds = [...protectedIds, ...createdIds];
    const beforePersist = await state();
    const expectedDigests = [];
    for (const id of persistedIds)
      expectedDigests.push(await geometryDigest(id));
    const projectBytes = await snapshotBytes();
    const expectedBreps = brepHashes(projectBytes, persistedIds);
    const verifyReopen = async () => {
      await idle();
      const after = await state();
      assert.equal(after.undo, beforePersist.undo);
      assert.equal(after.redo, beforePersist.redo);
      assert.deepEqual(after.authoring, beforePersist.authoring);
      const objects = (project) =>
        project.objects.map(({ meshPreparation, ...object }) => object);
      assert.deepEqual(objects(after), objects(beforePersist));
      for (let index = 0; index < persistedIds.length; index++)
        assert.deepEqual(
          await geometryDigest(persistedIds[index]),
          expectedDigests[index],
        );
      assert.deepEqual(
        brepHashes(await snapshotBytes(), persistedIds),
        expectedBreps,
      );
      await assertSources();
    };
    const revision = (await call("session_get")).revision;
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator('input[type=file][accept*=".scanforge"]')
      .first()
      .setInputFiles({
        name: "real-cad-matrix.scanforge",
        mimeType: "application/octet-stream",
        buffer: projectBytes,
      });
    await eventually(async () =>
      assert((await call("session_get")).revision > revision),
    );
    await verifyReopen();
    const projectArtifact = await upload(
      projectBytes,
      "real-cad-matrix.scanforge",
    );
    await withArtifact(projectArtifact, async () => {
      await job(
        await mutate("project_import", {
          artifactId: projectArtifact,
          replace: true,
        }),
      );
    });
    await verifyReopen();
    assert.equal(hash(await readFile(scanPath)), fixture.sha256);
    receipt.persistence = {
      guiAndMcpReopen: true,
      displayBuffersBitExact: true,
      exactBreps: expectedBreps,
    };
    receipt.sourcePreservation = {
      scanAndBaselineBuffers: true,
      activeAuthoring: true,
      protectedBreps,
      liveOriginalHandleConsumed: true,
      sourceFileHash: fixture.sha256,
    };
  } catch (failure) {
    primaryFailure = failure;
    receipt.passed = false;
    receipt.failure =
      failure instanceof Error ? failure.message : String(failure);
    receipt.elapsedMs = Date.now() - started;
    await saveReceipt();
    throw failure;
  } finally {
    // This helper never creates/replaces a blank project. Restore initial object
    // visibility/selection while retaining the baseline scene and matrix outputs.
    const cleanupFailures = [];
    // Also handles an upload failing after its first acknowledged chunk: its
    // caller never received an ID, but the allocation remains owned here.
    for (const artifactId of allocatedArtifacts) {
      try {
        await releaseArtifact(artifactId);
      } catch (failure) {
        cleanupFailures.push(failure);
      }
    }
    try {
      await idle();
      const current = await state();
      const changes = original.objects.filter((old) =>
        current.objects.some(
          (item) => item.id === old.id && item.visible !== old.visible,
        ),
      );
      if (changes.length)
        await mutate("object_visibility_toggle", {
          entityIds: changes.map((item) => item.id),
        });
      await mutate("object_select", {});
      const selectedIds =
        original.selectedIds ??
        (original.selectedId ? [original.selectedId] : []);
      for (let index = 0; index < selectedIds.length; index++)
        await mutate("object_select", {
          entityId: selectedIds[index],
          ...(index ? { toggle: true } : {}),
        });
      assert.deepEqual(await geometryDigest(sourceId), baselineDigest);
    } catch (cleanupFailure) {
      cleanupFailures.push(cleanupFailure);
    }
    if (cleanupFailures.length) {
      receipt.passed = false;
      receipt.cleanupFailure = cleanupFailures
        .map((failure) =>
          failure instanceof Error ? failure.message : String(failure),
        )
        .join("; ");
      await saveReceipt();
      if (!primaryFailure) throw cleanupFailures[0];
    }
  }
  receipt.elapsedMs = Date.now() - started;
  checkpoint();
  assert.equal(
    allocatedArtifacts.size,
    0,
    "All acknowledged helper artifacts must be released before acceptance",
  );
  receipt.artifactOwnershipReleased = true;
  receipt.passed = true;
  ledger.scenarios.push({ realCadMatrix: receipt });
  await saveReceipt();
}
