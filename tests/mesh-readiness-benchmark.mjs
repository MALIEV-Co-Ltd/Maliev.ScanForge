import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { freemem } from "node:os";
import { fileURLToPath } from "node:url";
import { build, stop } from "esbuild";

// node tests/mesh-readiness-benchmark.mjs FILE [triangle limit, 0=all] [baseline commit]
const [file, limitText = "0", baseline] = process.argv.slice(2);
assert(file, "Supply a binary STL path.");
const limit = Number(limitText);
assert(Number.isSafeInteger(limit) && limit >= 0, "Invalid triangle limit.");
const required = limit && limit <= 250000 ? 1536 : 4096;
assert(
  freemem() >= required * 1048576,
  `Benchmark requires ${required} MiB free; retry after capacity becomes available.`,
);
const root = new URL("../", import.meta.url);
const out = new URL(`.resources/mesh-readiness-${Date.now()}/`, root);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "mesh-readiness-benchmark",
  persistentData: false,
  resources: [],
};
let failed;
try {
  let source = `export { analyzeMesh } from ${JSON.stringify(fileURLToPath(new URL("src/mesh-processing.ts", root)))}; export {packTopology, unpackTopology, packedTopologyBytes, estimatedPackedTopologyBytes} from ${JSON.stringify(fileURLToPath(new URL("src/topology-cache-codec.ts", root)))};`;
  let revision = "working-tree";
  if (baseline) {
    assert(!baseline.startsWith("-"), "Invalid baseline commit.");
    revision = execFileSync(
      "git",
      ["rev-parse", "--verify", `${baseline}^{commit}`],
      { cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true },
    ).trim();
    source = execFileSync(
      "git",
      ["show", `${revision}:src/mesh-processing.ts`],
      { cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true },
    );
  }
  await build({
    stdin: {
      contents: source,
      resolveDir: fileURLToPath(new URL("src/", root)),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: fileURLToPath(new URL("engine.mjs", out)),
  });
  stop();
  const entry = `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as engine from './engine.mjs';
const {analyzeMesh}=engine;
const identity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command', 'Get-Process -Id '+process.pid+" | Select-Object Id,Path,@{Name='actualStartedAt';Expression={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,timeout:10000}));
writeFileSync(new URL('./worker-ledger.json',import.meta.url),JSON.stringify({purpose:'cold mesh preparation benchmark',...identity,expiresAt:new Date(Date.now()+600000).toISOString(),persistentData:false}));
const data=readFileSync(process.argv[2]);
assert(data.length>=84,'Expected a binary STL.');
const total=data.readUInt32LE(80);assert.equal(data.length,84+total*50,'Expected a binary STL.');
const count=Math.min(total,Number(process.argv[3])||total),p=new Float32Array(count*9);
for(let f=0;f<count;f++)for(let k=0;k<9;k++)p[f*9+k]=data.readFloatLE(84+f*50+12+k*4);
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const original=hash(p),stages=[],cache={};let stage='',begin=performance.now();const start=begin;
const t=analyzeMesh(p,{tolerance:0.001,topologyCache:cache,onProgress:(_,next)=>{if(next!==stage){const now=performance.now();if(stage)stages.push({stage,ms:now-begin});begin=now;stage=next;}}});
const coldMs=performance.now()-start,hot=performance.now();assert.equal(analyzeMesh(p,{tolerance:0.001,topologyCache:cache}),t);const cachedMs=performance.now()-hot;
assert.equal(hash(p),original,'Source coordinates changed.');
const analysisMemory=process.memoryUsage();
const rowHash=rows=>{const h=createHash('sha256'), buffer=new Uint32Array(4096);let count=0;const flush=()=>{h.update(new Uint8Array(buffer.buffer,0,count*4));count=0;};const add=value=>{buffer[count++]=value;if(count===buffer.length)flush();};for(const row of rows){add(row.length);for(const value of row)add(value);}flush();return h.digest('hex');};
const orderedHashes={neighbors:rowHash(t.neighbors),components:rowHash(t.components),loops:rowHash(t.boundaryLoops),chains:rowHash(t.boundaryChains)};
let persistent;
if(engine.packTopology){
 const estimated=engine.estimatedPackedTopologyBytes(t), packStart=performance.now(), packed=engine.packTopology(t), packMs=performance.now()-packStart;
 assert.equal(engine.packedTopologyBytes(packed),estimated);
 assert(estimated<=128*1048576,'Exported STL exceeds persistent-cache record limit.');
 const hydrateStart=performance.now(), restored=engine.unpackTopology(packed,p.length),hydrateMs=performance.now()-hydrateStart;
 assert(restored,'Packed topology failed hydration.');assert.equal(hash(restored.vertices),hash(t.vertices));assert.equal(hash(restored.triangles),hash(t.triangles));
 for(const [key,rows] of [['neighbors',restored.neighbors],['components',restored.components],['loops',restored.boundaryLoops],['chains',restored.boundaryChains]])assert.equal(rowHash(rows),orderedHashes[key]);
 assert.equal(restored.edges.size,t.edges.size);
 persistent={bytes:estimated,packMs,hydrateMs};
}

console.log(JSON.stringify({file:process.argv[2],sourceSha256:createHash('sha256').update(data).digest('hex'),total,count,coldMs,cachedMs,stages,analysisMemory,orderedHashes,persistent,vertices:t.vertices.length/3,vertexHash:hash(t.vertices),triangleHash:hash(t.triangles),edges:t.edges.size,components:t.components.length,loops:t.boundaryLoops.length,chains:t.boundaryChains.length,nonManifoldEdges:t.nonManifoldEdges,nonManifoldVertices:t.nonManifoldVertices,duplicates:t.duplicateTriangles,degenerates:t.degenerateTriangles,memory:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS}));
`;
  await writeFile(new URL("run.mjs", out), entry);
  const log = execFileSync(
    process.execPath,
    [
      "--max-old-space-size=3072",
      fileURLToPath(new URL("run.mjs", out)),
      file,
      String(limit),
    ],
    {
      cwd: fileURLToPath(root),
      encoding: "utf8",
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 1048576,
    },
  );
  const result = { revision, ...JSON.parse(log) };
  await writeFile(new URL("result.json", out), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      report: fileURLToPath(new URL("result.json", out)),
      ...result,
    }),
  );
} catch (error) {
  failed = error;
  throw error;
} finally {
  stop();
  try {
    const worker = JSON.parse(
      await readFile(new URL("worker-ledger.json", out), "utf8"),
    );
    let exited = false;
    try {
      process.kill(worker.Id, 0);
    } catch {
      exited = true;
    }
    ledger.resources.push({ ...worker, exited });
    if (!exited) {
      process.exitCode = 1;
      failed ??= Error("Benchmark worker exit could not be verified.");
    }
  } catch {}
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
}
