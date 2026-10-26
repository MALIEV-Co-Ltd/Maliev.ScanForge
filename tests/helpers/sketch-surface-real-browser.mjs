import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const area = (points) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p[0] * q[1] - p[1] * q[0];
    }, 0),
  ) / 2;
function distance(point, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

// This authors a new approximate profile from an actual closed reference contour.
// It never supplies reference samples as CAD edges or closes an open component.
function measuredClosedProfile(section) {
  const segments = section.reference.segments;
  assert(segments.length > 0 && segments.length % 4 === 0);
  assert(
    segments.length / 4 <= 50000,
    "Real section exceeds the 50,000 segment replay budget",
  );
  const joinToleranceMm = 1e-5,
    toleranceMm = 0.25;
  const simplificationToleranceMm = toleranceMm - joinToleranceMm - 1e-10;
  const nodes = [],
    bins = new Map(),
    adjacency = [],
    edges = [],
    unique = new Set();
  let referenceJoinDisplacementMm = 0;
  const node = (point) => {
    const cell = point.map((n) => Math.floor(n / joinToleranceMm));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++) {
        for (const id of bins.get(`${cell[0] + x},${cell[1] + y}`) ?? []) {
          const error = Math.hypot(
            point[0] - nodes[id][0],
            point[1] - nodes[id][1],
          );
          if (error <= joinToleranceMm) {
            referenceJoinDisplacementMm = Math.max(
              referenceJoinDisplacementMm,
              error,
            );
            return id;
          }
        }
      }
    const id = nodes.length,
      key = cell.join(",");
    nodes.push(point);
    adjacency.push([]);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(id);
    return id;
  };
  for (let i = 0; i < segments.length; i += 4) {
    const a = node(segments.slice(i, i + 2)),
      b = node(segments.slice(i + 2, i + 4));
    if (a === b) continue;
    const key = [a, b].sort((x, y) => x - y).join(":");
    if (unique.has(key)) continue;
    unique.add(key);
    const id = edges.length;
    edges.push([a, b]);
    adjacency[a].push(id);
    adjacency[b].push(id);
  }
  const visited = new Set(),
    loops = [];
  for (let seed = 0; seed < nodes.length; seed++) {
    if (visited.has(seed)) continue;
    const component = [],
      queue = [seed];
    visited.add(seed);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      component.push(id);
      for (const edgeId of adjacency[id]) {
        const next = edges[edgeId].find((n) => n !== id);
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    if (
      component.length < 3 ||
      component.some((id) => adjacency[id].length !== 2)
    )
      continue;
    const ordered = [],
      usedEdges = new Set();
    let current = seed;
    while (ordered.length <= component.length) {
      ordered.push(current);
      const edgeId = adjacency[current].find((id) => !usedEdges.has(id));
      if (edgeId === undefined) break;
      usedEdges.add(edgeId);
      current = edges[edgeId].find((id) => id !== current);
      if (current === seed) break;
    }
    if (current === seed && ordered.length === component.length)
      loops.push(ordered.map((id) => nodes[id]));
  }
  assert(
    loops.length > 0,
    "No actual closed unbranched scan-section contour; a synthetic closing edge is not acceptance",
  );
  loops.sort((a, b) => area(b) - area(a));
  const contour = loops[0];
  assert(area(contour) > 1e-6);
  const signedTwiceArea = contour.reduce((sum, point, index) => {
    const next = contour[(index + 1) % contour.length];
    return sum + point[0] * next[1] - point[1] * next[0];
  }, 0);
  if (signedTwiceArea < 0) contour.reverse();
  const points = [...contour, contour[0]];
  let split = 1,
    farthest = -1,
    work = 0;
  for (let i = 1; i < contour.length; i++) {
    const value = Math.hypot(
      contour[i][0] - contour[0][0],
      contour[i][1] - contour[0][1],
    );
    if (value > farthest) {
      farthest = value;
      split = i;
    }
  }
  const keep = new Set([0, split, contour.length]),
    pending = [
      [0, split],
      [split, contour.length],
    ];
  while (pending.length) {
    const [a, b] = pending.pop();
    let maximum = simplificationToleranceMm,
      index;
    for (let i = a + 1; i < b; i++) {
      assert(
        ++work <= 2000000,
        "Contour simplification exceeds two million distance checks",
      );
      const error = distance(points[i], points[a], points[b]);
      if (error > maximum) {
        maximum = error;
        index = i;
      }
    }
    if (index !== undefined) {
      keep.add(index);
      pending.push([a, index], [index, b]);
    }
  }
  const indices = [...keep].sort((a, b) => a - b);
  const profile = indices.slice(0, -1).map((index) => points[index]);
  assert(
    profile.length >= 3 && profile.length <= 32,
    `Measured 0.25 mm section profile requires ${profile.length} points; GUI replay budget is 32`,
  );
  const turn = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < profile.length; i++)
    for (let j = i + 1; j < profile.length; j++) {
      if (j === i + 1 || (i === 0 && j === profile.length - 1)) continue;
      const a = profile[i],
        b = profile[(i + 1) % profile.length];
      const c = profile[j],
        d = profile[(j + 1) % profile.length];
      const separated =
        turn(a, b, c) * turn(a, b, d) > 0 || turn(c, d, a) * turn(c, d, b) > 0;
      const boxesApart = [0, 1].some(
        (axis) =>
          Math.max(a[axis], b[axis]) < Math.min(c[axis], d[axis]) ||
          Math.max(c[axis], d[axis]) < Math.min(a[axis], b[axis]),
      );
      assert(
        separated || boxesApart,
        "Simplified reference profile intersects or touches a nonadjacent edge",
      );
    }
  assert(area(profile) > 1e-6);
  let measuredMaximumDeviationMm = 0;
  for (let edge = 0; edge < indices.length - 1; edge++) {
    const a = indices[edge],
      b = indices[edge + 1];
    for (let i = a; i <= b; i++)
      measuredMaximumDeviationMm = Math.max(
        measuredMaximumDeviationMm,
        distance(points[i], points[a], points[b]),
      );
  }
  assert(measuredMaximumDeviationMm <= simplificationToleranceMm);
  const continuousBoundMm =
    measuredMaximumDeviationMm + referenceJoinDisplacementMm;
  assert(
    continuousBoundMm <= toleranceMm,
    `Continuous reference-to-profile bound ${continuousBoundMm} exceeds ${toleranceMm} mm`,
  );
  // Each connected source span stays within this distance of its endpoint chord.
  // Continuous projection covers that chord, giving the reverse distance bound too.
  return {
    points: profile,
    areaMm2: area(profile),
    contour,
    contourAreaMm2: area(contour),
    closedReferenceContours: loops.length,
    selectedContour:
      "largest absolute enclosed area among degree-two closed components",
    authoredWinding: "counterclockwise in the source sketch UV frame",
    toleranceMm,
    simplificationToleranceMm,
    joinToleranceMm,
    referenceJoinDisplacementMm,
    measuredMaximumDeviationMm,
    continuousBoundMm,
    scope:
      "Chosen closed scan-section contour only; spanwise piecewise-linear Hausdorff bound, not fit to the full 3D scan",
  };
}

export async function replayRealSketchSurface(context) {
  const {
    page,
    call,
    mutate,
    job,
    eventually,
    artifactBytes,
    geometryDigest,
    ledger,
    out,
    sourceId,
    sourceDigest,
    state,
    authoring,
    inspect,
    onlyVisible,
    upload,
    added,
    open,
    createGui,
    thickenGui,
    stepRoundTrip,
    persist,
  } = context;
  const path = process.env.SCANFORGE_M5_SKETCH_SCAN;
  assert(path, "Required real scan acceptance needs SCANFORGE_M5_SKETCH_SCAN");
  const bytes = await readFile(path),
    sourceSha256 = sha256(bytes);
  assert(
    bytes.length <= 64 * 1024 * 1024,
    "Real scan exceeds the 64 MiB replay fixture budget",
  );
  await mutate("settings_set", { patch: { importPlaceAtOrigin: false } });
  const beforeImport = await state();
  await page
    .locator('input[type=file][accept*=".stl"]')
    .first()
    .setInputFiles(path);
  await page
    .getByRole("dialog", { name: "Import scan", exact: true })
    .getByRole("button", { name: "Import", exact: true })
    .click();
  const scanId = await added(beforeImport);
  const scan = (await call("object_get", { entityId: scanId })).result;
  assert.equal(scan.kind, "mesh");
  assert(!scan.exactCad && scan.triangles > 0);
  const scanDigest = await geometryDigest(scanId);
  const importCloneBefore = await state();
  await job(
    await mutate("project_import", {
      artifactId: await upload(bytes, basename(path)),
      unit: "mm",
      placeAtOrigin: false,
    }),
  );
  const importedCloneId = await added(importCloneBefore);
  assert.deepEqual(await geometryDigest(importedCloneId), scanDigest);
  await mutate("history_undo", { scope: "model" });
  await onlyVisible([scanId]);
  const bounds = (await call("viewport_get")).result.bounds;
  assert(bounds, "The actual real scan must provide visible bounds");
  const candidates = bounds.min
    .map((minimum, axis) => ({
      axis,
      span: bounds.max[axis] - minimum,
    }))
    .sort((a, b) => b.span - a.span);
  const attempts = [];
  let accepted;
  for (const { axis, span } of candidates) {
    if (!(span > 0)) continue;
    const options = {
      plane: ["OYZ", "OXZ", "OXY"][axis],
      offset: (bounds.min[axis] + bounds.max[axis]) / 2,
      onSlicingPlane: true,
      selectedOnly: false,
    };
    const receipt = await mutate("mesh_process", {
      entityId: scanId,
      operation: { kind: "sketchSection", options },
    });
    const terminal = await eventually(async () => {
      const result = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      assert.notEqual(result.status, "running");
      return result;
    });
    if (terminal.status !== "succeeded") {
      attempts.push({ options, error: terminal.error });
      continue;
    }
    const section = JSON.parse(
      (await artifactBytes(terminal.result.artifact)).toString("utf8"),
    ).sketchSection;
    try {
      accepted = { options, section, measured: measuredClosedProfile(section) };
      break;
    } catch (error) {
      attempts.push({ options, error: error.message });
    }
  }
  assert(
    accepted,
    `No bounded usable closed real-scan profile: ${JSON.stringify(attempts)}`,
  );
  const { options, section, measured } = accepted;
  assert.equal(section.reference.sourceId, scanId);
  assert.equal(
    section.reference.sampled,
    false,
    "This receipt requires full imported scan section references",
  );
  const beforeSection = await state();
  await mutate("object_select", { entityId: scanId });
  await page.getByRole("tab", { name: "Sketch", exact: true }).click();
  await page
    .getByRole("button", { name: "Section to sketch", exact: true })
    .click();
  const sectionPanel = page.getByRole("complementary", {
    name: "Create Sketch",
    exact: true,
  });
  await sectionPanel.waitFor();
  if (options.plane !== "OXY") {
    await sectionPanel.locator(".app-select > button").click();
    await page
      .getByRole("option", { name: new RegExp(`^${options.plane} ·`) })
      .click();
  }
  await sectionPanel
    .getByLabel("Slice offset (mm)", { exact: true })
    .fill(String(options.offset));
  await sectionPanel
    .getByRole("button", { name: "Apply section", exact: true })
    .click();
  await sectionPanel.getByRole("status").waitFor();
  await eventually(async () =>
    assert(
      await sectionPanel
        .getByRole("button", {
          name: "Create",
          exact: true,
        })
        .isEnabled(),
    ),
  );
  await sectionPanel
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await sectionPanel.waitFor({ state: "hidden" });
  const guiSection = await authoring(),
    guiSketchId = guiSection.activeSketchId;
  assert.deepEqual(guiSection.sketch.frame, section.frame);
  assert.deepEqual(guiSection.sketch.reference, section.reference);
  assert.equal(guiSection.sketch.points.length, 0);
  assert.equal(guiSection.sketch.segments.length, 0);
  assert.equal((await state()).undo, beforeSection.undo);
  const guiSketchName = guiSection.sketches.find(
    (item) => item.id === guiSketchId,
  ).name;
  const tools = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await tools.waitFor();
  const pointIds = [];
  // Actual authoring through rendered Add point and coordinate fields; no sketch_set.
  for (const [x, y] of measured.points) {
    const previous = new Set(
      (await authoring()).sketch.points.map((point) => point.id),
    );
    await tools.getByRole("button", { name: "Add point", exact: true }).click();
    const id = await eventually(async () => {
      const points = (await authoring()).sketch.points.filter(
        (point) => !previous.has(point.id),
      );
      assert.equal(points.length, 1);
      return points[0].id;
    });
    await tools
      .getByRole("spinbutton", { name: `${id} x`, exact: true })
      .fill(String(x));
    await tools
      .getByRole("spinbutton", { name: `${id} y`, exact: true })
      .fill(String(y));
    pointIds.push(id);
  }
  assert.equal(
    new Set(pointIds.map((id) => id.slice(0, 6))).size,
    pointIds.length,
    "Visible point labels must identify the intended endpoint uniquely",
  );
  const guiEndpointEdits = [];
  async function changeEndpoint(segmentId, end, pointId) {
    const before = (await authoring()).sketch.segments.find(
      (segment) => segment.id === segmentId,
    );
    assert(before);
    if (before[end] === pointId) return;
    assert.notEqual(
      pointId,
      before[end === "a" ? "b" : "a"],
      "GUI endpoint changes must keep every intermediate segment valid",
    );
    await tools
      .getByRole("button", {
        name: `${segmentId} endpoint ${end}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: pointId.slice(0, 6), exact: true })
      .click();
    const expected = { ...before, [end]: pointId };
    await eventually(async () => {
      const actual = (await authoring()).sketch.segments.find(
        (segment) => segment.id === segmentId,
      );
      assert.deepEqual(
        actual,
        expected,
        "Public authoring must acknowledge each GUI endpoint change",
      );
    });
    guiEndpointEdits.push({ segmentId, end, from: before[end], to: pointId });
  }
  for (let index = 0; index < pointIds.length; index++) {
    const previous = new Set(
      (await authoring()).sketch.segments.map((segment) => segment.id),
    );
    await tools
      .getByRole("button", { name: "Add segment", exact: true })
      .click();
    const current = await eventually(async () => {
      const segments = (await authoring()).sketch.segments.filter(
        (segment) => !previous.has(segment.id),
      );
      assert.equal(segments.length, 1);
      return segments[0];
    });
    const a = pointIds[index],
      b = pointIds[(index + 1) % pointIds.length];
    assert.notEqual(a, b);
    if (a === current.b) {
      // Add segment starts at points 0/1; moving a onto b first is invalid.
      if (b === current.a) {
        const temporary = pointIds.find(
          (pointId) => pointId !== current.a && pointId !== current.b,
        );
        assert(
          temporary,
          "Swapping endpoints needs an existing third profile point",
        );
        await changeEndpoint(current.id, "b", temporary);
      } else await changeEndpoint(current.id, "b", b);
      await changeEndpoint(current.id, "a", a);
      await changeEndpoint(current.id, "b", b);
    } else {
      await changeEndpoint(current.id, "a", a);
      await changeEndpoint(current.id, "b", b);
    }
    assert.deepEqual(
      (await authoring()).sketch.segments.find(
        (segment) => segment.id === current.id,
      ),
      { ...current, a, b },
    );
  }
  const guiProfile = (await authoring()).sketch;
  assert.deepEqual(
    guiProfile.points.map((point) => [point.x, point.y]),
    measured.points,
  );
  assert.deepEqual(guiProfile.reference, section.reference);
  assert.deepEqual(guiProfile.frame, section.frame);
  assert.equal(guiProfile.segments.length, measured.points.length);
  assert.equal(
    (await state()).undo,
    beforeSection.undo,
    "GUI authoring must not edit model history",
  );
  for (let i = 0; i < pointIds.length; i++)
    assert.deepEqual(
      [guiProfile.segments[i].a, guiProfile.segments[i].b],
      [pointIds[i], pointIds[(i + 1) % pointIds.length]],
    );
  await page.screenshot({
    path: fileURLToPath(
      new URL("sketch-surface-real-authored-profile.png", out),
    ),
  });
  await open(guiSketchName);
  const guiFace = await createGui();
  const guiFaceDigest = await geometryDigest(guiFace.entityId);
  const faceReport = await inspect(guiFace.entityId, {
    faces: 1,
    solids: 0,
    areaMm2: measured.areaMm2,
    sketch: guiProfile,
  });
  assert(faceReport.edgeReferences.items.every((edge) => edge.kind === "line"));
  const guiSolidId = await thickenGui(guiFace.entityId, 1.8);
  const guiSolidDigest = await geometryDigest(guiSolidId);
  const solidReport = await inspect(guiSolidId, {
    solids: 1,
    volumeMm3: measured.areaMm2 * 1.8,
    sketch: guiProfile,
    thickness: 1.8,
  });
  const guiStep = await stepRoundTrip(
    guiSolidId,
    {
      solids: 1,
      volumeMm3: measured.areaMm2 * 1.8,
      sketch: guiProfile,
      thickness: 1.8,
    },
    "sketch-surface-real-gui",
    true,
  );

  // Public MCP independently accepts the extracted reference, then authors its profile.
  const mcpSketch = await mutate("sketch_manage", {
    action: "create",
    name: "MCP real scan closed section profile",
    sketch: {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: section.frame,
      reference: section.reference,
    },
  });
  const beforeMcpProfile = await state();
  await mutate("sketch_set", { sketch: structuredClone(guiProfile) });
  assert.equal((await state()).undo, beforeMcpProfile.undo);
  assert.deepEqual((await authoring()).sketch, guiProfile);
  const beforeMcpFace = await state();
  const mcpFace = await job(
    await mutate("cad_create", {
      name: "MCP real scan sketch face",
      recipe: { kind: "sketchSurface", sketch: structuredClone(guiProfile) },
      selectCreated: true,
    }),
  );
  const mcpFaceId = mcpFace.entityIds[0];
  assert.equal((await state()).undo, beforeMcpFace.undo + 1);
  assert.deepEqual(await geometryDigest(mcpFaceId), guiFaceDigest);
  const mcpFaceObject = (await call("object_get", { entityId: mcpFaceId }))
    .result;
  assert.deepEqual(mcpFaceObject.parametric.feature.recipe.sketch, guiProfile);
  const mcpFaceReport = await inspect(mcpFaceId, {
    faces: 1,
    solids: 0,
    areaMm2: measured.areaMm2,
    sketch: guiProfile,
  });
  const beforeMcpSolid = await state();
  const mcpSolid = await job(
    await mutate("cad_create", {
      name: "MCP real scan section solid",
      recipe: {
        kind: "thicken",
        thickness: 1.8,
        source: { featureId: mcpFace.featureId, output: 0 },
      },
      selectCreated: true,
    }),
  );
  const mcpSolidId = mcpSolid.entityIds[0];
  assert.equal((await state()).undo, beforeMcpSolid.undo + 1);
  assert.deepEqual(await geometryDigest(mcpSolidId), guiSolidDigest);
  const mcpSolidReport = await inspect(mcpSolidId, {
    solids: 1,
    volumeMm3: measured.areaMm2 * 1.8,
    sketch: guiProfile,
    thickness: 1.8,
  });
  await mutate("history_undo", { scope: "model" });
  assert(!(await state()).objects.some((item) => item.id === mcpSolidId));
  await mutate("history_redo", { scope: "model" });
  assert.deepEqual(await geometryDigest(mcpSolidId), guiSolidDigest);
  const mcpStep = await stepRoundTrip(
    mcpSolidId,
    {
      solids: 1,
      volumeMm3: measured.areaMm2 * 1.8,
      sketch: guiProfile,
      thickness: 1.8,
    },
    "sketch-surface-real-mcp",
  );
  const persistence = await persist(
    [guiFace.entityId, guiSolidId, mcpFaceId, mcpSolidId],
    "sketch-surface-real-scan",
  );
  for (const id of [guiFace.entityId, mcpFaceId])
    assert.deepEqual(
      (await call("object_get", { entityId: id })).result.parametric.feature
        .recipe.sketch,
      guiProfile,
    );
  assert.deepEqual(
    (await authoring()).sketches.find((item) => item.id === guiSketchId).sketch,
    guiProfile,
  );
  assert.deepEqual(
    (await authoring()).sketches.find(
      (item) => item.id === mcpSketch.result.sketchId,
    ).sketch,
    guiProfile,
  );
  assert.deepEqual(await geometryDigest(scanId), scanDigest);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  assert.equal(sha256(await readFile(path)), sourceSha256);
  const result = {
    supplied: true,
    path,
    bytes: bytes.length,
    sha256: sourceSha256,
    sourceId: scanId,
    sourceBuffers: scanDigest,
    guiMcpImportBitExact: true,
    sectionOptions: options,
    sectionReference: section.reference,
    attempts,
    fit: measured,
    authoredGuiProfile: guiProfile,
    guiProfileAuthoredWithRenderedPointAndSegmentControls: true,
    guiEndpointEdits,
    guiMcpSectionMetadataEqual: true,
    guiMcpFaceGeometryBitExact: true,
    guiMcpSolidGeometryBitExact: true,
    modelUndoRedo: true,
    faceReport,
    solidReport,
    mcpFaceReport,
    mcpSolidReport,
    guiStep,
    mcpStep,
    persistence,
    sourceFileAndMeshPreserved: true,
    scope:
      "Actual real-input section to newly authored editable closed line profile to exact planar face to thickened solid to GUI/public-MCP STEP; no full-scan curved reconstruction or native operation equivalence claim",
  };
  ledger.scenarios.push({ sketchSurfaceRealScan: result });
  await writeFile(
    new URL("sketch-surface-real-scan.json", out),
    JSON.stringify(result, null, 2),
  );
}
