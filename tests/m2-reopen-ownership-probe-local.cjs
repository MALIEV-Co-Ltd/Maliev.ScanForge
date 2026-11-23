const {
  Worker,
  isMainThread,
  workerData,
  parentPort,
} = require("node:worker_threads");
const sizes = [33306813, 5626452, 16012539, 2699811];
const value = (i, k) => (i === 1 ? -0 : (i % 997) + k / 4);
if (!isMainThread) {
  const arrays = sizes.map((n, k) => {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = value(i, k);
    return a;
  });
  const buffers = arrays.map((a) => Float64Array.from(a));
  if (workerData === "baseline") {
    parentPort.postMessage(
      { buffers },
      buffers.map((v) => v.buffer),
    );
    parentPort.close();
  } else {
    let i = 0;
    parentPort.on("message", () => {
      i++;
      if (i === buffers.length) {
        if (workerData === "stream" && arrays[3][100] !== value(100, 3))
          throw Error("source lost");
        parentPort.close();
      } else send();
    });
    const send = () => {
      const v = buffers[i];
      if (workerData === "stream-release") {
        if (arrays[i][100] !== value(100, i)) throw Error("source lost");
        arrays[i] = null;
      }
      parentPort.postMessage({ index: i, buffer: v }, [v.buffer]);
      buffers[i] = null;
    };
    send();
  }
} else {
  const mode = process.argv[2];
  if (!["baseline", "stream", "stream-release"].includes(mode))
    throw Error("mode");
  const worker = new Worker(__filename, { workerData: mode });
  const output = [];
  let packet;
  const convert = (v, k) => {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = v[i];
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], value(i, k))) throw Error(`mismatch ${k}:${i}`);
    output[k] = a;
    if (v.buffer.transfer) v.buffer.transfer(0);
  };
  worker.on("message", (data) => {
    if (mode === "baseline") packet = data;
    else {
      convert(data.buffer, data.index);
      worker.postMessage("next");
    }
  });
  worker.on("error", (e) => {
    throw e;
  });
  worker.on("exit", (code) => {
    if (code) throw Error(`worker ${code}`);
    if (mode === "baseline") packet.buffers.forEach(convert);
    if (output.length !== sizes.length) throw Error("missing arrays");
    process.stdout.write(
      JSON.stringify({
        mode,
        bytes: sizes.reduce((a, n) => a + n * 8, 0),
        verified: true,
        arrays: output.length,
      }) + "\n",
    );
  });
}
