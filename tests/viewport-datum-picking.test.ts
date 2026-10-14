import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";
it("reports original triangle slots after selecting the hit object", () => {
  const view = Object.create(Viewport.prototype) as any;
  const pick = vi.fn(),
    select = vi.fn();
  const mesh = { visible: true, userData: { entityId: "cad" }, material: {} };
  Object.assign(view, {
    originPicking: false,
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
    camera: {},
    raycaster: {
      setFromCamera: vi.fn(),
      intersectObjects: () => [
        { object: mesh, point: { x: 1, y: 2, z: 3 }, faceIndex: 1 },
      ],
    },
    objects: new Map([["cad", { mesh, triangleSlots: [10, 21] }]]),
    onPick: pick,
    onSelect: select,
    brushing: false,
  });
  expect(view.pickAt({ clientX: 50, clientY: 50 })).toBe("cad");
  expect(pick).toHaveBeenCalledWith([1, 2, 3], "cad", 21);
  expect(select.mock.invocationCallOrder[0]).toBeLessThan(
    pick.mock.invocationCallOrder[0],
  );
});
