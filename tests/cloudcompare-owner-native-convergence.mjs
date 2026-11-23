import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile, readFile, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const run = promisify(execFile),
  exe = "C:/tools/CloudCompare-2.13.2/CloudCompare.exe";
const out = resolve(
  "docs/evidence/cloudcompare-20261029/alignment/owner-native-convergence",
);
const staged =
  "C:/Users/Shoung/Downloads/CloudCompare-2.13.2-investigation/20261029-owner15";
const cases = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["1", "20", "200", "adaptive"];
for (const item of cases) {
  const [label, iterations = item] = item.split(":");
  const initialMatrix = process.env.SCANFORGE_NATIVE_INITIAL_MATRIX;
  const folder = join(out, label);
  await mkdir(folder, { recursive: true });
  for (const name of ["moving.ply", "fixed.ply"])
    await copyFile(join(staged, name), join(folder, name));
  const args = [
    "-SILENT",
    "-LOG_FILE",
    join(folder, "native.log"),
    "-AUTO_SAVE",
    "OFF",
    "-NO_TIMESTAMP",
    "-O",
    join(folder, "moving.ply"),
    ...(initialMatrix ? ["-APPLY_TRANS", resolve(initialMatrix)] : []),
    "-O",
    join(folder, "fixed.ply"),
    "-ICP",
    "-OVERLAP",
    "15",
    ...(iterations === "adaptive"
      ? ["-MIN_ERROR_DIFF", "1e-6"]
      : ["-ITER", iterations]),
    "-RANDOM_SAMPLING_LIMIT",
    "20000",
    "-MAX_TCOUNT",
    "2",
  ];
  const started = Date.now(),
    observations = [];
  const timer = setInterval(async () => {
    let log = "";
    try {
      log = await readFile(join(folder, "native.log"), "utf8");
    } catch {}
    observations.push({
      elapsedSeconds: (Date.now() - started) / 1000,
      lastLines: log.trim().split(/\r?\n/).slice(-3),
    });
  }, 10000);
  let result, error;
  try {
    result = await run(exe, args, {
      timeout: 600000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    error = {
      message: e.message,
      code: e.code,
      signal: e.signal,
      killed: e.killed,
    };
    result = { stdout: e.stdout, stderr: e.stderr };
  } finally {
    clearInterval(timer);
  }
  const receipt = {
    case: item,
    initialMatrix: initialMatrix ?? null,
    arguments: args,
    durationSeconds: (Date.now() - started) / 1000,
    deadlineSeconds: 600,
    error: error ?? null,
    observations,
    executableSha256: createHash("sha256")
      .update(await readFile(exe))
      .digest("hex"),
    inputHashes: {},
  };
  for (const name of ["moving.ply", "fixed.ply"])
    receipt.inputHashes[name] = createHash("sha256")
      .update(await readFile(join(folder, name)))
      .digest("hex");
  await writeFile(
    join(folder, "process-output.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    join(folder, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  for (const name of ["moving.ply", "fixed.ply"])
    await unlink(join(folder, name));
  console.log(JSON.stringify(receipt));
}
