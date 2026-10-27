import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { checkPlanarThickening } from "./helpers/planar-thickening-kernel.mjs";
import { checkEdgeShellOwnership } from "./helpers/edge-shell-ownership-kernel.mjs";

// Actual-worker production regression. Run only after coordinator admission.
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const requests = new Map();
let nextId = 0;
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) return;
      const pending = requests.get(reply.id);
      requests.delete(reply.id);
      if (reply.error) pending.reject(Error(reply.error));
      else pending.resolve(reply.result);
    },
  },
});
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context);
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
);
const request = (operation, payload) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    context.self.onmessage({ data: { id, operation, payload } });
  });
const expiry = setTimeout(() => {
  console.error("Planar thickening kernel regression exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
try {
  const oc = await vm.runInContext("kernel()", context);
  const planar = await checkPlanarThickening({ context, oc, request });
  const realProfile = await checkEdgeShellOwnership({
    context,
    oc,
    request,
    root,
  });
  assert.equal(vm.runInContext("shapes.size", context), 0);
  console.log(
    JSON.stringify({
      planarThickeningKernel: planar,
      realProfile,
      releasedAllHandles: true,
    }),
  );
} finally {
  clearTimeout(expiry);
}
