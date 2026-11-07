import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { expect, vi } from "vitest";

/** Actual CAD protocol with VM transport; browser worker ownership is tested separately. */
export async function withCurvatureKernel<T>(
  run: () => Promise<T>,
): Promise<T> {
  const root = new URL("../../", import.meta.url);
  const binary = readFileSync(
    new URL("public/kernel/opencascade.wasm.wasm", root),
  );
  const workers: { terminated: boolean }[] = [];
  class KernelWorker {
    terminated = false;
    onmessage?: (event: { data: unknown }) => void;
    context: vm.Context;
    constructor() {
      workers.push(this);
      const scope = {
        location: { href: new URL("public/cad-worker.js", root).href },
        onmessage: undefined as
          undefined | ((event: { data: unknown }) => void),
        postMessage: (data: unknown) => {
          if (!this.terminated) this.onmessage?.({ data });
        },
      };
      this.context = vm.createContext({
        console,
        WebAssembly,
        Uint8Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        ArrayBuffer,
        TextDecoder,
        TextEncoder,
        URL,
        crypto: webcrypto,
        setTimeout,
        clearTimeout,
        self: scope,
      });
      this.context.importScripts = (url: string) => {
        vm.runInContext(readFileSync(new URL(url), "utf8"), this.context);
        const factory = this.context.opencascade;
        this.context.opencascade = (options: object) =>
          factory({ ...options, wasmBinary: binary });
      };
      vm.runInContext(
        readFileSync(new URL("public/cad-worker.js", root), "utf8"),
        this.context,
      );
    }
    postMessage(data: unknown) {
      this.context.self.onmessage({ data });
    }
    terminate() {
      expect(vm.runInContext("shapes.size", this.context)).toBe(0);
      this.terminated = true;
    }
  }
  vi.stubGlobal("Worker", KernelWorker);
  vi.stubGlobal("self", {
    location: { href: new URL("assets/processing-worker.js", root).href },
  });
  try {
    const result = await run();
    expect(workers).toHaveLength(1);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    return result;
  } finally {
    vi.unstubAllGlobals();
  }
}
