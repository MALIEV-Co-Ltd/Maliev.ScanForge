import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const errors = [config.error, ...parsed.errors].filter(Boolean);
if (errors.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
  process.exit(1);
}
const tests = parsed.fileNames.filter((name) =>
  relative(root, name).replaceAll("\\", "/").startsWith("tests/"),
);
const source = parsed.fileNames.filter((name) => !tests.includes(name));
const batches = [source];
for (let offset = 0; offset < tests.length; offset += 32)
  batches.push([...source, ...tests.slice(offset, offset + 32)]);
const outputRoot = join(root, ".resources");
await mkdir(outputRoot, { recursive: true });
const temporary = await mkdtemp(join(outputRoot, "typecheck-"));
const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
let exitCode = 0;
try {
  for (const [index, files] of batches.entries()) {
    console.log(
      `Typecheck ${index + 1}/${batches.length}: ${index ? "source and test batch" : "source"} (${files.length} root files; 1536 MiB heap)`,
    );
    const path = join(temporary, "tsconfig.json");
    await writeFile(
      path,
      JSON.stringify({ extends: configPath, files, include: [] }),
    );
    const child = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=1536",
        compiler,
        "--noEmit",
        "--project",
        path,
        "--pretty",
        "false",
      ],
      { stdio: "inherit", timeout: 180000 },
    );
    if (child.error) throw child.error;
    if (child.status !== 0) {
      exitCode = child.status ?? 1;
      break;
    }
  }
} finally {
  const inside = relative(outputRoot, resolve(temporary));
  if (inside.startsWith("..") || !inside)
    throw new Error("Invalid owned typecheck directory.");
  await rm(temporary, { recursive: true });
}
process.exitCode = exitCode;
