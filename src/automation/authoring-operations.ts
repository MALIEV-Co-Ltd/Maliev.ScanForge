import { CadClient } from "../cad/client";
import { DEFAULT_FREEFORM_COLOR } from "../appearance";
import { cleanupMesh, alignPrincipalAxes } from "../geometry";
import {
  createGridPatch,
  insertPatchKnot,
  preparePatchCrease,
  joinPatchBoundary,
  snapControlPoint,
  importQuadGridObj,
  assemblePatchShell,
  createBoxPatchShell,
  tessellatePatch,
  type NurbsPatch,
} from "../surfaces";
import { validateSketch, rectangleSketch } from "../sketch";
import type { Handler, WorkspaceHost } from "./api";
import type { Entity } from "../types";
import { lockedObjectEdit } from "../object-operations";
import { assertSampledGeometry } from "../reference-entity";

/** Authoring tools reuse the same helpers as the editor's surface/sketch/selection controls. */
export function createAuthoringOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  const find = (id: string) => {
    const e = host.snapshot().entities.find((e) => e.id === id);
    if (!e) throw new Error("Object does not exist");
    return e;
  };
  const editable = (e: Entity) => {
    assertSampledGeometry(e);
    if (e.locked || e.kernelId || e.parametric)
      throw new Error("Use an unlocked mesh copy before this operation");
  };
  return {
    project_new: (a, c) => {
      if (a.discard !== true)
        throw new Error(
          "discard:true is required to replace this workspace; export unsaved work first",
        );
      c.check();
      host.replace(
        {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: a.name ?? "Untitled project",
          entities: [],
        },
        new CadClient(),
      );
      return { created: true };
    },
    object_select: (a, c) => {
      const e = a.entityId ? find(a.entityId) : null;
      if (e && (e.locked || e.selectable === false))
        throw new Error("Object cannot be selected");
      c.check();
      if (!e && (a.toggle || a.range))
        throw new Error("Object modifiers require an entityId.");
      host.select(e?.id ?? null, {
        toggle: a.toggle ?? false,
        range: a.range ?? false,
      });
      const state = host.snapshot();
      return {
        entityId: state.selectedId,
        selectedIds:
          state.selectedIds ?? (state.selectedId ? [state.selectedId] : []),
        anchorId: state.selectionAnchorId ?? state.selectedId,
      };
    },
    history_seek: (a, c) => {
      const s = host.snapshot(),
        count = s.history.length + s.future.length;
      if (a.index > count)
        throw new Error("Timeline index is outside retained history");
      c.check();
      const cursor = s.history.length;
      for (let i = cursor; i > a.index; i--) host.undo();
      for (let i = cursor; i < a.index; i++) host.redo();
      return { index: a.index };
    },
    selection_modify: (a, c) => {
      const s = host.snapshot(),
        e = find(a.entityId);
      assertSampledGeometry(e);
      if (e.locked || e.selectable === false)
        throw new Error("Object cannot be selected");
      const count = e.positions.length / (e.kind === "pointcloud" ? 3 : 9);
      const hidden = new Set(e.meshSelection?.hidden ?? []);
      const prior =
        s.selectedId === e.id && s.selection?.length === count
          ? s.selection
          : new Uint8Array(count);
      const mask = new Uint8Array(prior.length);
      for (let i = 0; i < mask.length; i++)
        mask[i] = hidden.has(i)
          ? 0
          : a.operation === "all"
            ? 1
            : a.operation === "invert"
              ? prior[i]
                ? 0
                : 1
              : 0;
      c.check();
      host.setSelection(e.id, mask);
      return { count: mask.reduce((n, v) => n + v, 0) };
    },
    selection_saved: (a, c) => {
      const s = host.snapshot(),
        e = find(a.entityId),
        saved = e.meshSelection?.saved ?? [];
      assertSampledGeometry(e);
      const count = e.positions.length / (e.kind === "pointcloud" ? 3 : 9);
      const selection =
        s.selectedId === e.id && s.selection?.length === count
          ? s.selection
          : null;
      if (a.action === "load") {
        const entry = saved.find((x) => x.id === a.selectionId);
        if (!entry) throw new Error("Saved selection does not exist");
        if (e.locked || e.selectable === false)
          throw new Error("Object cannot be selected");
        const mask = new Uint8Array(count);
        const hidden = new Set(e.meshSelection?.hidden ?? []);
        for (const t of entry.triangles) {
          if (t >= mask.length) throw new Error("Saved selection is stale");
          if (!hidden.has(t)) mask[t] = 1;
        }
        c.check();
        host.setSelection(e.id, mask);
        return {
          selectionId: entry.id,
          count: mask.reduce((sum, value) => sum + value, 0),
        };
      }
      let next = saved,
        selectionId = a.selectionId;
      if (a.action === "save") {
        if (!selection || !selection.some(Boolean) || !a.name)
          throw new Error("A named nonempty current selection is required");
        selectionId = crypto.randomUUID();
        next = [
          ...saved,
          {
            id: selectionId,
            name: a.name,
            triangles: Array.from(selection.entries())
              .filter(([, v]) => v)
              .map(([i]) => i),
          },
        ];
      } else {
        if (!saved.some((x) => x.id === selectionId))
          throw new Error("Saved selection does not exist");
        next = saved.filter((x) => x.id !== selectionId);
      }
      c.check();
      host.commit(
        s.entities.map((x) =>
          x.id === e.id
            ? {
                ...e,
                meshSelection: {
                  hidden: e.meshSelection?.hidden ?? [],
                  saved: next,
                },
              }
            : x,
        ),
        "Update named selection",
      );
      return { selectionId };
    },
    sketch_manage: (a, c) => {
      if (!host.setAuthoring)
        throw new Error("Authoring management unavailable");
      const state = host.snapshot(),
        authoring = { ...state.authoring },
        sketches = [...(authoring.sketches ?? [])];
      let sketchId = a.sketchId;
      const index = sketches.findIndex((s) => s.id === sketchId);
      if (a.action === "create") {
        const sketch = a.sketch ?? rectangleSketch();
        validateSketch(sketch);
        if (!a.name) throw new Error("Sketch name required");
        sketchId = crypto.randomUUID();
        sketches.push({
          id: sketchId,
          name: a.name,
          sketch: structuredClone(sketch),
        });
        authoring.activeSketchId = sketchId;
      } else {
        if (index < 0) throw new Error("Sketch does not exist");
        if (a.action === "activate") authoring.activeSketchId = sketchId;
        else if (a.action === "rename") {
          if (!a.name) throw new Error("Sketch name required");
          sketches[index] = { ...sketches[index], name: a.name };
        } else {
          sketches.splice(index, 1);
          if (authoring.activeSketchId === sketchId)
            authoring.activeSketchId = undefined;
        }
      }
      authoring.sketches = sketches;
      c.check();
      host.setAuthoring(authoring);
      return { sketchId };
    },
    mesh_quick: (a, c) => {
      const s = host.snapshot(),
        e = find(a.entityId);
      editable(e);
      const result =
        a.operation === "cleanup"
          ? { positions: cleanupMesh(e.positions) }
          : alignPrincipalAxes(e.positions);
      c.check();
      host.commit(
        s.entities.map((x) =>
          x.id === e.id
            ? {
                ...e,
                positions: result.positions,
                meshSelection: undefined,
                fit: undefined,
                planeFrame: undefined,
                surfacePatch: undefined,
                surfaceScanId: undefined,
                scanSource: undefined,
              }
            : x,
        ),
        a.operation === "cleanup" ? "Cleanup mesh" : "Align principal axes",
      );
      return { entityId: e.id };
    },
    surface_operation: async (a, c) => {
      const s = host.snapshot();
      let e = a.entityId ? find(a.entityId) : undefined;
      let patch: NurbsPatch;
      if (e) editable(e);
      if (e?.kind === "pointcloud")
        throw new Error(
          "Surface edits require a triangle mesh target; create a new patch from the point cloud instead.",
        );
      if (a.operation === "grid")
        patch = createGridPatch(
          a.countU,
          a.countV,
          a.width,
          a.height,
          a.degree,
        );
      else if (a.operation === "quadImport")
        patch = importQuadGridObj(
          await c.artifactBlob(a.artifactId).text(),
          a.countU,
          a.countV,
          a.degree,
        );
      else {
        if (!e?.surfacePatch) throw new Error("Choose a NURBS surface object");
        patch = e.surfacePatch;
        if (a.operation === "knot")
          patch = insertPatchKnot(patch, a.axis, a.parameter, a.repetitions);
        else if (a.operation === "crease")
          patch = preparePatchCrease(patch, a.axis, a.parameter);
        else if (a.operation === "snap")
          patch = snapControlPoint(patch, a.index, find(a.scanId).positions);
        else if (a.operation === "join") {
          const reference = find(a.referenceId).surfacePatch;
          if (!reference) throw new Error("Reference has no NURBS patch");
          patch = joinPatchBoundary(reference, patch, a.options);
        } else throw new Error("Unsupported surface operation");
      }
      e ??= {
        id: crypto.randomUUID(),
        name: a.name ?? "NURBS surface",
        kind: "mesh",
        positions: [],
        color: DEFAULT_FREEFORM_COLOR,
        opacity: 1,
        visible: true,
      };
      const result = {
        ...e,
        positions: tessellatePatch(patch),
        surfacePatch: patch,
        normals: undefined,
        edgePositions: undefined,
        fit: undefined,
        planeFrame: undefined,
        scanSource: undefined,
        indexedMesh: undefined,
        meshSelection: undefined,
      };
      const next = a.entityId
        ? s.entities.map((x) => (x.id === e!.id ? result : x))
        : [...s.entities, result];
      const locked = lockedObjectEdit(s.entities, next);
      if (locked) throw new Error("Surface object is locked");
      c.check();
      host.commit(next, `Surface ${a.operation}`);
      return { entityId: e.id };
    },
    surface_shell: (a, c) => {
      const patches =
        a.entityIds?.map((id: string) => {
          const p = find(id).surfacePatch;
          if (!p) throw new Error("Object has no NURBS patch");
          return p;
        }) ?? createBoxPatchShell(a.width, a.height, a.depth);
      const result = assemblePatchShell(patches, a.options);
      c.check();
      const artifact = c.artifact(
        JSON.stringify({ diagnostics: result.diagnostics, patches }),
        "patch-shell.json",
        "application/json",
      );
      return { artifact, diagnostics: result.diagnostics, patches };
    },
  };
}
