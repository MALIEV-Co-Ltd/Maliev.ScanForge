import { expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Entity } from "../src/types";
import {
  duplicateObject,
  lockedObjectEdit,
  objectPickable,
} from "../src/object-operations";
import { objectContextActions } from "../src/ui/object-context-actions";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import { restoreModelDisplay } from "../src/history";
import { Viewport } from "../src/viewport";

const source: Entity = {
  id: "scan",
  name: "Part",
  kind: "mesh",
  positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  color: "#aaaaaa",
  opacity: 1,
  visible: true,
  meshSelection: {
    hidden: [],
    saved: [{ id: "selection", name: "Area", triangles: [0] }],
  },
};
it("duplicates independent geometry and selection data with a unique name and unlocked controls", () => {
  const copy = duplicateObject(
    { ...source, locked: true, selectable: false },
    "copy",
    [source, { ...source, name: "Part copy" }],
  );
  expect(copy.name).toBe("Part copy 2");
  expect(copy.id).toBe("copy");
  expect(copy.positions).toEqual(source.positions);
  expect(copy.positions).not.toBe(source.positions);
  expect(copy.meshSelection?.saved[0].triangles).not.toBe(
    source.meshSelection?.saved[0].triangles,
  );
  expect(objectPickable(copy)).toBe(true);
});
it("prevents edits and deletion of locked geometry while allowing display and protection controls", () => {
  const locked = { ...source, locked: true };
  expect(lockedObjectEdit([locked], [])).toBe(locked);
  expect(
    lockedObjectEdit(
      [locked],
      [{ ...locked, positions: source.positions.slice() }],
    ),
  ).toBe(locked);
  expect(
    lockedObjectEdit(
      [locked],
      [
        {
          ...locked,
          name: "Renamed",
          visible: false,
          locked: false,
          selectable: false,
        },
      ],
    ),
  ).toBeUndefined();
  expect(lockedObjectEdit([source], [])).toBeUndefined();
});
it("persists protection through both project writers, accepts old files, rejects invalid flags and retains flags on undo", async () => {
  const protectedEntity = { ...source, locked: true, selectable: false };
  for (const json of [
    serializeProject("Part", [protectedEntity]),
    await (await serializeProjectBlob("Part", [protectedEntity])).text(),
  ]) {
    expect(parseProject(json).entities[0]).toMatchObject({
      locked: true,
      selectable: false,
    });
  }
  expect(
    objectPickable(parseProject(serializeProject("Old", [source])).entities[0]),
  ).toBe(true);
  for (const field of ["locked", "selectable"])
    expect(() =>
      parseProject(
        serializeProject("Bad", [{ ...source, [field]: "false" } as Entity]),
      ),
    ).toThrow("Invalid project object");
  expect(restoreModelDisplay([source], [protectedEntity])[0]).toMatchObject({
    locked: true,
    selectable: false,
  });
});
it("exposes working basic actions without a Close menu item and blocks destructive actions on a locked object", () => {
  const handlers = {
    properties: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    visibility: vi.fn(),
    selectable: vi.fn(),
    lock: vi.fn(),
    edit: vi.fn(),
    remove: vi.fn(),
  };
  const actions = objectContextActions(source, false, handlers);
  expect(actions.map((action) => action.label)).toEqual([
    "Object properties",
    "Duplicate",
    "Rename…",
    "Hide object",
    "Make unselectable",
    "Lock object",
    "Edit scan selection",
    "Delete object",
  ]);
  actions.forEach((action) => action.run());
  Object.values(handlers).forEach((handler) =>
    expect(handler).toHaveBeenCalledOnce(),
  );
  const locked = objectContextActions(
    { ...source, locked: true, selectable: false },
    false,
    handlers,
  );
  expect(
    locked.find((action) => action.label === "Unlock object")?.disabled,
  ).toBe(false);
  expect(
    locked.find((action) => action.label === "Make selectable")?.disabled,
  ).toBe(false);
  expect(
    locked.find((action) => action.label === "Delete object")?.disabled,
  ).toBe(true);
  expect(
    objectContextActions(source, true, handlers).every(
      (action) => action.disabled,
    ),
  ).toBe(true);
});
it("filters protected objects from actual viewport picking and restores picking after unlocking", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const onSelect = vi.fn();
  Object.assign(view, {
    camera,
    scene,
    objects: new Map(),
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    wireframe: false,
    clipping: false,
    invalidate: vi.fn(),
    raycaster: new THREE.Raycaster(),
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        }),
      },
    },
    onSelect,
    onPick: vi.fn(),
  });
  const picker = view as unknown as {
    pickAt(event: { clientX: number; clientY: number }): string | undefined;
  };
  try {
    for (const entity of [
      { ...source, locked: true },
      { ...source, selectable: false },
      source,
    ]) {
      view.setEntities([entity], null);
      scene.updateMatrixWorld(true);
      expect(picker.pickAt({ clientX: 50, clientY: 50 })).toBe(
        objectPickable(entity) ? source.id : undefined,
      );
    }
    expect(onSelect).toHaveBeenCalledOnce();
  } finally {
    view.setEntities([], null);
  }
});
