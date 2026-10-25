import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  structuredClone,
  AbortController,
  setTimeout,
  clearTimeout,
  self: { location: { href: new URL("public/cad-worker.js", root).href } },
});
let helperSha256;
context.importScripts = (url) => {
  const bytes = readFileSync(new URL(url));
  vm.runInContext(bytes.toString("utf8"), context);
  if (new URL(url).pathname.endsWith("/sketch-backend.js"))
    helperSha256 = createHash("sha256").update(bytes).digest("hex");
  if (new URL(url).pathname.endsWith("/opencascade.js")) {
    const factory = context.opencascade;
    context.opencascade = (options) =>
      factory({ ...options, wasmBinary: binary });
  }
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
);
const expiry = setTimeout(() => process.exit(124), 90000);
const owners = [];
const mismatches = [];
const vector = (p) => [p.X(), p.Y(), p.Z()];
const bits = (n) => {
  const a = new ArrayBuffer(8);
  new DataView(a).setFloat64(0, n, false);
  return new DataView(a).getBigUint64(0, false).toString(16).padStart(16, "0");
};
let seed = 123456789;
const next = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 200 - 100;
};
try {
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  const curve = new classes.SketchLineCurve(oc);
  owners.push(curve);

  for (let n = 0; n < 100; n++) {
    const request = {
      kind: "line",
      points: [
        [next(), next(), next()],
        [next(), next(), next()],
      ],
    };
    assert.equal(curve.rebuildCurve(request), true);
    const prepared = curve.prepareBodyEndpoints(0.001);
    const candidate = classes.SketchLineWireCandidate.create(
      oc,
      prepared,
      5e-9,
    );
    assert.ok(candidate);
    const adaptor = new oc.BRepAdaptor_Curve_2(candidate.firstEdge);
    let line, dir, loc, first, last;
    try {
      line = adaptor.Line();
      dir = line.Direction();
      loc = line.Location();
      first = adaptor.Value(adaptor.FirstParameter());
      last = adaptor.Value(adaptor.LastParameter());
      const actual = {
        direction: vector(dir),
        origin: vector(loc),
        start: vector(first),
        end: vector(last),
      };
      const expected = {
        direction: prepared.conversion.direction,
        origin: prepared.conversion.origin,
        start: prepared.start,
        end: prepared.end,
      };
      const differs = Object.keys(actual).filter((k) =>
        actual[k].some((x, a) => !Object.is(x, expected[k][a])),
      );
      if (differs.length && mismatches.length < 12)
        mismatches.push({
          request,
          prepared,
          actual,
          expected,
          differs,
          bits: Object.fromEntries(
            Object.keys(actual).map((k) => [
              k,
              { actual: actual[k].map(bits), expected: expected[k].map(bits) },
            ]),
          ),
        });
    } finally {
      for (const h of [last, first, loc, dir, line, adaptor]) h?.delete();
      candidate.dispose();
    }
  }

  const fixture = {
    conversion: {
      origin: [
        -0.04481225521303713, -0.04852493875660002, -0.010334359342232346,
      ],
      direction: [
        -0.37644629233720306, 0.7665563822667325, -0.5202686823091621,
      ],
      interval: [0, 0.10831645107573151],
    },
    start: [-0.04481225521303713, -0.04852493875660002, -0.010334359342232346],
    end: [-0.08558758161962031, 0.03450572811998426, -0.066688016615808],
  };
  const allocations = [];
  const unavailableHeap = new Proxy(oc, {
    get(target, key) {
      if (key === "HEAPF64") return undefined;
      if (key !== "gp_Dir_4") return target[key];
      return function (...args) {
        const handle = new target.gp_Dir_4(...args);
        allocations.push(handle);
        return handle;
      };
    },
  });
  assert.throws(
    () =>
      classes.SketchLineWireCandidate.create(unavailableHeap, fixture, 5e-9),
    /kernel binding/,
  );
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].isDeleted(), true);
  for (const mode of ["metadata", "layout", "readback", "cleanup"]) {
    const retained = [];
    let before, after, fakeHeap;
    const broken = new Proxy(oc, {
      get(target, key) {
        if (key === "HEAPF64" && mode === "cleanup") return undefined;
        if (key === "HEAPF64" && mode === "layout")
          return (fakeHeap ??= new Float64Array(target.HEAPF64.length));
        if (key !== "gp_Dir_4") return target[key];
        return function (...args) {
          const handle = new target.gp_Dir_4(...args);
          retained.push(handle);
          before = [handle.X(), handle.Y(), handle.Z()];
          let reads = 0;
          return new Proxy(
            {},
            {
              get(_facade, property) {
                const object = handle;
                if (property === "$$" && mode === "metadata")
                  return { ...object.$$, ptr: -1 };
                if (property === "X" && mode === "readback")
                  return () => (++reads === 2 ? object.X() + 1 : object.X());
                if (property === "delete")
                  return () => {
                    after = [object.X(), object.Y(), object.Z()];
                    object.delete();
                    if (mode === "cleanup")
                      throw new Error("Controlled direction cleanup failure");
                  };
                const value = object[property];
                return typeof value === "function" ? value.bind(object) : value;
              },
            },
          );
        };
      },
    });
    assert.throws(
      () => classes.SketchLineWireCandidate.create(broken, fixture, 5e-9),
      (error) =>
        mode === "cleanup"
          ? error.name === "AggregateError" &&
            error.errors.some((cause) =>
              /kernel binding/.test(cause.message),
            ) &&
            error.errors.some((cause) =>
              /Controlled direction cleanup/.test(cause.message),
            )
          : /kernel (binding|layout|readback)/.test(error.message),
    );
    assert.equal(retained.length, 1);
    assert.equal(retained[0].isDeleted(), true);
    assert.deepEqual(
      after,
      before,
      "Failed adapter must preserve or restore direction before deletion.",
    );
  }
  const unprepared = {
    conversion: { origin: [0, 0, 0], direction: [2, 0, 0], interval: [0, 1] },
    start: [0, 0, 0],
    end: [2, 0, 0],
  };
  assert.throws(
    () => classes.SketchLineWireCandidate.create(oc, unprepared, 5e-9),
    /near unit/,
  );
  const result = {
    helperSha256,
    wasmSha256: createHash("sha256").update(binary).digest("hex"),
    fixturesChecked: 100,
    retainedMismatches: mismatches.length,
    mismatches,
    scope:
      "Own kernel differential against retained canonical prepared line data; not original-native execution or full admission.",
  };
  console.log(
    JSON.stringify({
      fixturesChecked: 100,
      retainedMismatches: mismatches.length,
      guardChecks: 6,
      first: mismatches[0],
      helperSha256,
      wasmSha256: result.wasmSha256,
    }),
  );
  assert.equal(
    mismatches.length,
    0,
    "Converted kernel curve must preserve prepared direction, origin and both endpoint bits.",
  );
} finally {
  for (const x of owners) x.dispose();
  clearTimeout(expiry);
}
