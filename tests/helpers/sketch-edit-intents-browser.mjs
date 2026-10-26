import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Independent semantic requests, real controls and the public SDK; no GUI graph replacement. */
export async function sketchSemanticEdits({
  page,
  call,
  raw,
  mutate,
  settled,
  eventually,
  canonical,
  ledger,
  artifactDir,
  signal,
}) {
  const read = async () => (await call("sketch_get")).result;
  const artifactJson = async (artifact) => {
    const chunks = [];
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const row = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const bytes = Buffer.from(row.base64, "base64");
      assert.equal(row.nextOffset, offset + bytes.length);
      assert(
        row.nextOffset <= 8 * 1024 * 1024,
        "Analytic fixture artifact exceeds its8MiB test budget",
      );
      chunks.push(bytes);
      if (row.eof) break;
      assert(row.nextOffset > offset, "Artifact read must advance");
      offset = row.nextOffset;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  await mutate("project_new", {
    discard: true,
    name: "Semantic sketch edit parity",
  });
  // project_new publishes a dirty document. Explicitly approve replacing this
  // disposable fixture; Playwright otherwise dismisses the native confirmation.
  page.once("dialog", async (dialog) => {
    assert.equal(dialog.type(), "confirm");
    assert.match(dialog.message(), /Replace the current project/);
    await dialog.accept();
  });
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles({
      name: "semantic-sketch-source.scanforge",
      mimeType: "application/x-scanforge",
      buffer: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "Semantic sketch source",
          entities: [
            {
              id: "semantic-source",
              name: "Semantic source triangle",
              kind: "mesh",
              positions: [-20, -20, -1, 20, -20, 1, 0, 20, 1],
              color: "#447799",
              opacity: 1,
              visible: true,
            },
          ],
        }),
      ),
    });
  await page
    .getByRole("button", { name: "Semantic source triangle", exact: true })
    .waitFor();
  await eventually(async () =>
    assert.equal(
      (await call("application_inspect", { maxControls: 1 })).result.busy,
      false,
    ),
  );
  const extracted = await settled(
    await mutate("mesh_process", {
      entityId: "semantic-source",
      operation: {
        kind: "sketchSection",
        options: {
          plane: "OXY",
          offset: 0,
          onSlicingPlane: true,
          selectedOnly: false,
        },
      },
    }),
  );
  const section = (await artifactJson(extracted.artifact)).sketchSection;
  assert.equal(section.reference.sourceId, "semantic-source");
  assert(section.reference.segments.length > 0);
  const seed = {
    version: 1,
    points: [],
    segments: [],
    arcs: [],
    constraints: [],
    frame: section.frame,
    reference: section.reference,
  };
  const guiId = (
    await mutate("sketch_manage", {
      action: "create",
      name: "GUI semantic edits",
      sketch: seed,
    })
  ).result.sketchId;
  const mcpId = (
    await mutate("sketch_manage", {
      action: "create",
      name: "Independent MCP semantic edits",
      sketch: seed,
    })
  ).result.sketchId;
  await mutate("sketch_manage", { action: "activate", sketchId: guiId });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
    dismissError: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.waitFor();
  const baseline = (await call("project_get")).result;
  const stableObjects = (objects) =>
    objects.map(({ meshPreparation: _preparation, ...object }) => object);
  const steps = [];
  async function choose(control, option) {
    await panel.getByRole("button", { name: control, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  async function pair(name, guiAction, request) {
    signal.throwIfAborted();
    const before = (await read()).sketch;
    await guiAction();
    const numericDraft = panel.locator('input[type="number"]:focus');
    if (await numericDraft.count()) await numericDraft.press("Tab");
    await eventually(async () =>
      assert.notDeepEqual((await read()).sketch, before),
    );
    const gui = (await read()).sketch;
    await mutate("sketch_manage", { action: "activate", sketchId: mcpId });
    const requested = typeof request === "function" ? request() : request;
    let response;
    for (const intent of Array.isArray(requested) ? requested : [requested])
      response = (await mutate("sketch_edit", intent)).result;
    const mcp = (await read()).sketch;
    assert.deepEqual(
      canonical(gui),
      canonical(mcp),
      `${name}: independent intent reproduces GUI state`,
    );
    assert.deepEqual(
      gui.reference,
      section.reference,
      `${name}: actual extracted reference provenance retained`,
    );
    assert.deepEqual(mcp.reference, section.reference);
    const model = (await call("project_get")).result;
    assert.deepEqual(
      stableObjects(model.objects),
      stableObjects(baseline.objects),
      `${name}: no model geometry publication`,
    );
    assert.equal(model.undo, baseline.undo);
    assert.equal(model.redo, baseline.redo);
    await mutate("sketch_manage", { action: "activate", sketchId: guiId });
    steps.push(name);
    return { before, gui, mcp, response };
  }
  await pair(
    "rectangle preset",
    () =>
      panel
        .getByRole("button", { name: "Reset rectangle", exact: true })
        .click(),
    { kind: "preset", profile: "rectangle" },
  );
  const canceledDraftBefore = await read(),
    canceledRevision = (await call("project_get")).revision;
  const canceledInput = panel.getByLabel("p2 x", { exact: true });
  await canceledInput.click();
  await canceledInput.press("ControlOrMeta+A");
  await canceledInput.pressSequentially("-12.5", { delay: 50 });
  assert.equal(await canceledInput.inputValue(), "-12.5");
  assert.deepEqual(
    await read(),
    canceledDraftBefore,
    "Unaccepted numeric text is not published",
  );
  await canceledInput.press("Escape");
  assert.equal(await canceledInput.inputValue(), "40");
  assert.deepEqual(await read(), canceledDraftBefore);
  assert.equal((await call("project_get")).revision, canceledRevision);
  const numeric = await pair(
    "unsnapped unsolved point axis",
    async () => {
      const input = panel.getByLabel("p2 x", { exact: true });
      await input.click();
      await input.press("ControlOrMeta+A");
      await input.pressSequentially("51.125", { delay: 80 });
      assert.equal(
        await input.inputValue(),
        "51.125",
        "Numeric editing retains every typed character",
      );
      assert(
        await input.evaluate((element) => document.activeElement === element),
        "Numeric editing retains focus while typing",
      );
    },
    { kind: "pointSet", pointId: "p2", x: 51.125 },
  );
  assert.equal(numeric.gui.points[1].x, 51.125);
  assert.equal(
    numeric.gui.constraints.find((constraint) => constraint.id === "c6").value,
    40,
  );
  const dimension = await pair(
    "unsolved dimension",
    () => panel.getByLabel("c6 dimension", { exact: true }).fill("17"),
    { kind: "dimension", constraintId: "c6", value: 17 },
  );
  assert.equal(dimension.gui.points[1].x, 51.125);
  const solved = await pair(
    "numeric edit followed by one direct Solve click",
    async () => {
      await panel.getByLabel("c6 dimension", { exact: true }).fill("18");
      await panel
        .getByRole("button", { name: "Solve constraints", exact: true })
        .click();
    },
    [{ kind: "dimension", constraintId: "c6", value: 18 }, { kind: "solve" }],
  );
  assert.equal(solved.response.solution.converged, true);
  await pair(
    "normal offset",
    () => panel.getByLabel("Plane offset (mm)", { exact: true }).fill("17"),
    { kind: "planeOffset", offsetMm: 17 },
  );
  await pair(
    "origin-plane orientation",
    () => choose("Sketch plane", "OYZ · U=Y, V=Z"),
    { kind: "plane", plane: "OYZ" },
  );
  await pair(
    "remove dimensional relation",
    () =>
      panel
        .getByRole("button", { name: "Remove constraint c6", exact: true })
        .click(),
    { kind: "remove", target: "constraint", id: "c6" },
  );
  await pair(
    "numeric endpoint coordinate",
    () => panel.getByLabel("p2 x", { exact: true }).fill("20"),
    { kind: "pointSet", pointId: "p2", x: 20 },
  );
  await choose("Constraint", "distance");
  await choose("First reference", "p1");
  await choose("Second reference", "p2");
  await panel.getByLabel("Dimension", { exact: true }).fill("20");
  await pair(
    "server-owned constraint construction",
    () =>
      panel
        .getByRole("button", { name: "Add constraint", exact: true })
        .click(),
    {
      kind: "constraintAdd",
      constraint: { kind: "distance", a: "p1", b: "p2", value: 20 },
    },
  );
  const beforeConflict = (await read()).sketch,
    conflictRevision = (await call("project_get")).revision;
  await panel.getByLabel("Dimension", { exact: true }).fill("10");
  await panel
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await panel.getByText(/Conflicting or unsolved constraints:/).waitFor();
  assert.deepEqual((await read()).sketch, beforeConflict);
  assert.equal((await call("project_get")).revision, conflictRevision);
  await mutate("sketch_manage", { action: "activate", sketchId: mcpId });
  const beforeMcpConflict = (await read()).sketch;
  const rejected = await raw("sketch_edit", {
    kind: "constraintAdd",
    constraint: { kind: "distance", a: "p1", b: "p2", value: 10 },
    expectedRevision: (await call("project_get")).revision,
    requestId: randomUUID(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "OPERATION_FAILED");
  assert.deepEqual((await read()).sketch, beforeMcpConflict);
  await mutate("sketch_manage", { action: "activate", sketchId: guiId });
  await mutate("ui_set", { dismissError: true });
  await pair(
    "circular preset",
    () =>
      panel
        .getByRole("button", { name: "New circular profile", exact: true })
        .click(),
    { kind: "preset", profile: "circle" },
  );
  const addedPoint = await pair(
    "add numeric point",
    () => panel.getByRole("button", { name: "Add point", exact: true }).click(),
    { kind: "pointAdd" },
  );
  const guiPoint = addedPoint.gui.points.at(-1).id,
    mcpPoint = addedPoint.response.createdPointIds[0];
  await pair(
    "new point x",
    () => panel.getByLabel(`${guiPoint} x`, { exact: true }).fill("0.125"),
    { kind: "pointSet", pointId: mcpPoint, x: 0.125 },
  );
  await pair(
    "new point y",
    () => panel.getByLabel(`${guiPoint} y`, { exact: true }).fill("-0.25"),
    { kind: "pointSet", pointId: mcpPoint, y: -0.25 },
  );
  const addedSegment = await pair(
    "add segment",
    () =>
      panel.getByRole("button", { name: "Add segment", exact: true }).click(),
    { kind: "segmentAdd" },
  );
  const guiSegment = addedSegment.gui.segments.at(-1).id,
    mcpSegment = addedSegment.response.createdCurveIds[0];
  await pair(
    "segment topology",
    () => choose(`${guiSegment} endpoint b`, "west"),
    { kind: "segmentSet", segmentId: mcpSegment, b: "west" },
  );
  await pair(
    "segment construction flag",
    () =>
      panel
        .getByLabel(`${guiSegment} For construction`, { exact: true })
        .check(),
    { kind: "construction", curveId: mcpSegment, enabled: true },
  );
  const addedArc = await pair(
    "add analytic arc",
    () => panel.getByRole("button", { name: "Add arc", exact: true }).click(),
    { kind: "arcAdd" },
  );
  const guiArc = addedArc.gui.arcs.at(-1).id,
    mcpArc = addedArc.response.createdCurveIds[0];
  const arcRow = panel
    .locator(".field-row")
    .filter({ has: page.locator(`span[title="${guiArc}"]`) });
  await pair(
    "arc direction",
    () => arcRow.getByLabel("Clockwise", { exact: true }).check(),
    { kind: "arcSet", arcId: mcpArc, clockwise: true },
  );
  await pair(
    "arc construction flag",
    () =>
      panel.getByLabel(`${guiArc} For construction`, { exact: true }).check(),
    { kind: "construction", curveId: mcpArc, enabled: true },
  );
  await pair(
    "remove arc",
    () =>
      panel
        .getByRole("button", { name: `Remove arc ${guiArc}`, exact: true })
        .click(),
    { kind: "remove", target: "arc", id: mcpArc },
  );
  await pair(
    "remove segment",
    () =>
      panel
        .getByRole("button", {
          name: `Remove segment ${guiSegment}`,
          exact: true,
        })
        .click(),
    { kind: "remove", target: "segment", id: mcpSegment },
  );
  await pair(
    "remove point",
    () =>
      panel
        .getByRole("button", { name: `Remove point ${guiPoint}`, exact: true })
        .click(),
    { kind: "remove", target: "point", id: mcpPoint },
  );
  const closed = (await read()).sketch;
  await pair(
    "open profile edit",
    () =>
      panel
        .getByRole("button", { name: "Remove arc upper", exact: true })
        .click(),
    { kind: "remove", target: "arc", id: "upper" },
  );
  const open = (await read()).sketch,
    openRevision = (await call("project_get")).revision;
  await panel.getByLabel("Extrusion height", { exact: true }).fill("4");
  await panel
    .getByRole("button", { name: "Extrude solved profile", exact: true })
    .click();
  await panel
    .getByText(/closed profile|unbranched cycle|Resolve conflicting/)
    .waitFor();
  assert.deepEqual((await read()).sketch, open);
  assert.equal((await call("project_get")).revision, openRevision);
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  await eventually(async () => assert.deepEqual((await read()).sketch, closed));
  await mutate("sketch_manage", { action: "activate", sketchId: mcpId });
  const mcpOpen = (await read()).sketch;
  const profileFailure = await raw("sketch_edit", {
    kind: "solve",
    forProfile: true,
    expectedRevision: (await call("project_get")).revision,
    requestId: randomUUID(),
  });
  assert.equal(profileFailure.ok, false);
  assert.deepEqual((await read()).sketch, mcpOpen);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual(canonical((await read()).sketch), canonical(closed));
  await mutate("sketch_manage", { action: "activate", sketchId: guiId });
  await mutate("ui_set", { dismissError: true });
  await page.screenshot({
    path: fileURLToPath(new URL("semantic-sketch-edits.png", artifactDir)),
  });
  const beforeBodies = new Set(
    (await call("project_get")).result.objects.map((item) => item.id),
  );
  await panel
    .getByRole("button", { name: "Extrude solved profile", exact: true })
    .click();
  let guiBody;
  await eventually(async () => {
    guiBody = (await call("project_get")).result.objects.find(
      (item) => !beforeBodies.has(item.id),
    );
    assert(guiBody?.exactCad);
  });
  await mutate("sketch_manage", { action: "activate", sketchId: mcpId });
  const prepared = (
    await mutate("sketch_edit", { kind: "solve", forProfile: true })
  ).result;
  const mcpBodyId = (
    await settled(
      await mutate("cad_create", {
        name: "Independent semantic profile extrusion",
        recipe: { kind: "extrude", profile: prepared.profile, height: 4 },
        selectCreated: true,
      }),
    )
  ).entityIds[0];
  async function body(id) {
    const object = (
      await call("object_get", { entityId: id, includeGeometry: true })
    ).result;
    assert(object.exactCad);
    const profile = object.parametric.feature.recipe.profile;
    assert.deepEqual(profile.sketch.reference, section.reference);
    assert.deepEqual(profile.sketch.frame, closed.frame);
    const geometry = await artifactJson(object.geometry);
    const positions = geometry.indexedMesh
      ? geometry.indexedMesh.triangles.flatMap((index) =>
          geometry.indexedMesh.vertices.slice(index * 3, index * 3 + 3),
        )
      : geometry.positions;
    let sixVolume = 0;
    for (let index = 0; index < positions.length; index += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(
        index,
        index + 9,
      );
      sixVolume +=
        ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx);
    }
    return {
      volume: Math.abs(sixVolume / 6),
      profile: canonical(profile.sketch),
    };
  }
  const guiSolid = await body(guiBody.id),
    mcpSolid = await body(mcpBodyId);
  assert.deepEqual(guiSolid.profile, mcpSolid.profile);
  assert(Math.abs(guiSolid.volume - mcpSolid.volume) < 1e-8);
  assert(
    Math.abs(guiSolid.volume - Math.PI * 100 * 4) / (Math.PI * 100 * 4) < 0.03,
    "Tessellated circle extrusion volume must match the analytic fixture within3%; this is not exact kernel mass",
  );
  const beforeReopen = await read(),
    modelBeforeReopen = (await call("project_get")).result;
  const exported = await settled(
    await call("project_export", { format: "project" }),
  );
  await settled(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await read(), beforeReopen);
  const reopened = (await call("project_get")).result;
  assert.equal(reopened.undo, modelBeforeReopen.undo);
  assert.equal(reopened.redo, modelBeforeReopen.redo);
  assert(
    reopened.objects.some((item) => item.id === guiBody.id && item.exactCad),
  );
  assert(
    reopened.objects.some((item) => item.id === mcpBodyId && item.exactCad),
  );
  ledger.sketchSemanticEdits = {
    steps,
    independentIntents: true,
    noGuiGraphReplacement: true,
    actualScanSectionReference: true,
    sourceId: "semantic-source",
    scopedHistory: true,
    failedConstraintAtomicity: true,
    failedProfileAtomicity: true,
    numericTypingFocusAndEscape: true,
    guiMcpExtrusion: true,
    triangleVolume: guiSolid.volume,
    projectWorkerReopen: true,
    nativeAcceptance: false,
  };
}
