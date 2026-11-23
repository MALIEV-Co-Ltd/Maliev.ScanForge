import { expect, it } from "vitest";
import { decodeProjectContents, encodeProjectFileLocally } from "../src/project-file-codec";
import { packProjectTransport, unpackProjectTransport } from "../src/project-transport";
import { isEncodingNumeric } from "../src/project-encoding-numeric";
import { validatePositions } from "../src/io";
import { prepareRestoredProjectDisplays } from "../src/restored-scan-display";
import { projectEncodingSnapshot } from "../src/project-encoding-snapshot";
import { scanRenderData } from "../src/scan-render-data";

function makeSession(metadataAlias = false) {
  const positions = Array.from({ length: 65538 }, (_, i) => i === 0 ? -0 : i / 17);
  const entity = { id: "scan", name: "Scan", kind: "mesh" as const, positions,
    indexedMesh: { vertices: positions, triangles: Uint32Array.from({length: positions.length / 3}, (_, i) => i) },
    color: "#ffffff", visible: true, opacity: 1,
    ...(metadataAlias ? {edgePositions: positions} : {}),
  };
  return { positions, session: {project: {format: "maliev-scanforge" as const, version: 1 as const, units: "mm" as const, name: "test", entities: [entity]}, history: [{label:"Import",entities:[entity]}], future: []} };
}

it("retains private worker coordinates until transport and restores normal array aliases", async () => {
  const {positions, session} = makeSession();
  const blob = await encodeProjectFileLocally(session);
  const decoded = await decodeProjectContents(blob, {privateFloat64Chunks: true, deferMeshFloat64: true});
  const entity = decoded.project.entities[0];
  expect(isEncodingNumeric(entity.positions)).toBe(true);
  expect(entity.indexedMesh!.vertices).toBe(entity.positions);
  expect(decoded.history[0].entities[0].positions).toBe(entity.positions);
  const packed = await packProjectTransport(decoded, {ownedTypedArrays:true, deferredNumeric:isEncodingNumeric});
  const restored = await unpackProjectTransport<typeof decoded>(packed.packet);
  const actual = restored.project.entities[0].positions;
  expect(Array.isArray(actual)).toBe(true);
  expect(actual).toEqual(positions);
  expect(Object.is(actual[0], -0)).toBe(true);
  expect(restored.project.entities[0].indexedMesh!.vertices).toBe(actual);
  expect(restored.history[0].entities[0].positions).toBe(actual);
  expect(() => validatePositions(new Float64Array(9))).toThrow();
});

it("retains ordinary arrays when a coordinate chunk also serves another role", async () => {
  const {session} = makeSession(true);
  const blob = await encodeProjectFileLocally(session);
  const decoded = await decodeProjectContents(blob, {privateFloat64Chunks:true, deferMeshFloat64:true});
  const entity = decoded.project.entities[0];
  expect(Array.isArray(entity.positions)).toBe(true);
  expect(entity.edgePositions).toBe(entity.positions);
});

it("prepares and transports restored displays without changing public coordinate type", async () => {
  const {positions, session} = makeSession();
  const blob = await encodeProjectFileLocally(session);
  const decoded = await decodeProjectContents(blob, {privateFloat64Chunks:true, deferMeshFloat64:true});
  const prepared = prepareRestoredProjectDisplays(decoded);
  const entity = prepared.project.entities[0];
  const display = scanRenderData(entity.positions);
  expect(display).toBeDefined();
  const input = {snapshot:projectEncodingSnapshot(prepared),displays:[{positions:entity.positions,data:display}]};
  const packet = await packProjectTransport(input, {ownedTypedArrays:true, deferredNumeric:isEncodingNumeric});
  const restored = await unpackProjectTransport<typeof input>(packet.packet);
  expect(Array.isArray(restored.snapshot.session.project.entities[0].positions)).toBe(true);
  expect(restored.snapshot.session.project.entities[0].positions).toEqual(positions);
  expect(restored.displays[0].positions).toBe(restored.snapshot.session.project.entities[0].positions);
});
