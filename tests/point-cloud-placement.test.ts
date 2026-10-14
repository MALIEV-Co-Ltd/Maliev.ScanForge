import { expect, it } from "vitest";
import native from "./fixtures/alignment-cloud-pose-native.json";
import { transformDatumScan } from "../src/datum-alignment";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply";
import {
  cloudPlacement,
  canonicalCloud,
  cloudSelectionSource,
} from "../src/point-cloud-placement";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import { serializeProject, parseProject } from "../src/io";
import type { Entity, Project } from "../src/types";
import { Viewport } from "../src/viewport";
import * as THREE from "three";
import { vi } from "vitest";

function values(hex: string) {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
}
function boundsBits(a: Entity["positions"]) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i++) {
    min[i % 3] = Math.min(min[i % 3], a[i]);
    max[i % 3] = Math.max(max[i % 3], a[i]);
  }
  const b = Buffer.alloc(24);
  [...min, ...max].forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b.toString("hex");
}
function source(sample: (typeof native.cases)[number]): Entity {
  return {
    id: "cloud",
    name: sample.file,
    kind: "pointcloud",
    positions: values(sample.positionsBits),
    normals: Array.from(values(sample.normalsBits)),
    color: "#abcdef",
    visible: true,
    opacity: 1,
  };
}

it.each(native.cases)(
  "retains native pose, raw buffers and world bounds: $file",
  async (sample) => {
    const original = source(sample);
    let entity = original;
    const executor = createDatumTransformExecutor({ parallel: false });
    try {
      for (const step of sample.steps) {
        entity = (
          await executor.transformScan(
            entity,
            nativeDatumInverseFrame(step.frame),
          )
        ).entity;
        const p = cloudPlacement(entity)!;
        expect(p.matrixBits).toBe(step.poseBits);
        expect(p.sourcePositions).toBe(original.positions);
        expect(p.sourceNormals).toBe(original.normals);
        expect(boundsBits(entity.positions)).toBe(step.worldBoundsBits);
        entity = canonicalCloud({ ...entity, name: "Renamed" });
      }
    } finally {
      executor.close();
    }
    const project: Project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Pose",
      units: "mm",
      entities: [entity],
    };
    const file = await encodeProjectFile({
      project,
      history: [{ entities: [original], label: "Align" }],
      future: [],
    });
    const reopened = await decodeProjectFile(file);
    expect(cloudPlacement(reopened.project.entities[0])?.matrixBits).toBe(
      sample.steps.at(-1)!.poseBits,
    );
    expect(boundsBits(reopened.project.entities[0].positions)).toBe(
      sample.steps.at(-1)!.worldBoundsBits,
    );
    const json = parseProject(serializeProject(project.name, project.entities));
    expect(cloudPlacement(json.entities[0])?.matrixBits).toBe(
      sample.steps.at(-1)!.poseBits,
    );
    expect(boundsBits(json.entities[0].positions)).toBe(
      sample.steps.at(-1)!.worldBoundsBits,
    );
  },
);

it("invalidates the pose when an existing world-space tool edits geometry", () => {
  const original = source(native.cases[0]);
  const moved = transformDatumScan(
    original,
    nativeDatumInverseFrame(native.cases[0].steps[0].frame),
  );
  const edited = canonicalCloud({
    ...moved,
    positions: Float32Array.from(moved.positions, (x) => x + 1),
  });
  expect(edited.pointCloudPlacement).toBeUndefined();
  expect(edited.positions[0]).toBe(Math.fround(moved.positions[0] + 1));
});

it("preserves point identities when the first alignment normalizes legacy JSON storage", () => {
  const original = source(native.cases[0]);
  original.positions = Array.from(original.positions);
  const first = transformDatumScan(
    original,
    nativeDatumInverseFrame(native.cases[0].steps[0].frame),
  );
  expect(cloudPlacement(first)?.sourcePositions).toBeInstanceOf(Float32Array);
  expect(cloudSelectionSource(first)).toBe(original.positions);
  const renamed = canonicalCloud({ ...first, name: "Renamed" });
  const second = transformDatumScan(
    renamed,
    nativeDatumInverseFrame(native.cases[0].steps[1].frame),
  );
  expect(cloudSelectionSource(second)).toBe(original.positions);
  const edited = canonicalCloud({
    ...second,
    positions: second.positions.slice(),
  });
  expect(cloudSelectionSource(edited)).toBe(edited.positions);
  expect(cloudSelectionSource(edited)).not.toBe(original.positions);
});

it("retains the actual GPU geometry and local attributes while updating the object frame", () => {
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    objects: new Map(),
    scene: new THREE.Scene(),
    bounds: new THREE.Box3(),
    theme: "dark",
    setNoiseComparison: vi.fn(),
    clearDeviations: vi.fn(),
    applyClipPlanes: vi.fn(),
    invalidate: vi.fn(),
  });
  const first = source(native.cases[0]);
  view.setEntities([first], first.id);
  const moved = transformDatumScan(
    first,
    nativeDatumInverseFrame(native.cases[0].steps[0].frame),
  );
  view.setEntities([moved], moved.id);
  const item = view.objects.get(first.id),
    geometry = item.pointCloud.geometry;
  const position = geometry.getAttribute("position");
  expect(position.array).toBe(first.positions);
  const again = transformDatumScan(
    moved,
    nativeDatumInverseFrame(native.cases[0].steps[1].frame),
  );
  view.setEntities([again], again.id);
  expect(item.pointCloud.geometry).toBe(geometry);
  expect(geometry.getAttribute("position")).toBe(position);
  expect(item.positions).toBe(again.positions);
  expect(item.mesh.matrixAutoUpdate).toBe(false);
  expect(item.worldBounds.min.toArray()).toEqual([
    view.bounds.min.x,
    view.bounds.min.y,
    view.bounds.min.z,
  ]);
  geometry.dispose();
  item.pointCloud.material.dispose();
  item.mesh.geometry.dispose();
  item.mesh.material.dispose();
});
