import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { checkCadCacheOwnership } from "./helpers/cad-cache-ownership-kernel.mjs";

// Actual-worker focused source/cache ownership gate. Coordinator admission only.
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
  console.error("CAD cache ownership kernel regression exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
try {
  const oc = await vm.runInContext("kernel()", context);
  const result = await checkCadCacheOwnership({ context, oc, request });
  assert.equal(vm.runInContext("shapes.size", context), 0);
  console.log(
    JSON.stringify({
      cadCacheOwnershipKernel: result,
      releasedAllHandles: true,
    }),
  );
} finally {
  clearTimeout(expiry);
}
