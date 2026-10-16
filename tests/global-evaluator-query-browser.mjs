import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

if (freemem() < 3072 * 1048576)
  throw Error("Evaluator worker replay requires 3072 MiB free.");
const out = new URL(
  "../.resources/global-evaluator-query-browser/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
const origin = "http://127.0.0.1:5173";
function identity(pid) {
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-Process -Id ${pid} | Select-Object Id,@{Name='actualStartUtc';Expression={$_.StartTime.ToUniversalTime().ToString('O')}},Path | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    ),
  );
}
const ledger = {
  owner: "global-evaluator-query-browser",
  identity: identity(process.pid),
  expiresUtc: new Date(Date.now() + 120000).toISOString(),
  persistentData: false,
  ports: [],
};
let server, browser, lease;
try {
  server = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    timeout: 30000,
  });
  ledger.browser = identity(server.process().pid);
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  lease = setTimeout(() => void server.close().catch(() => {}), 110000);
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(origin + "/evaluator-worker-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Evaluator worker verification</title>",
    }),
  );
  await page.goto(origin + "/evaluator-worker-probe");
  const report = await page.evaluate(async (origin) => {
    const code = `
      import {nativeGlobalEvaluatorQuery} from '${origin}/src/scan-native-global-evaluator-query.ts';
      import {nativeGlobalEvaluatorExtent} from '${origin}/src/scan-native-global-evaluator-policy.ts';
      const fixture=await fetch('${origin}/tests/fixtures/global-fine-evaluator-query-native.json').then(r=>r.json());
      const policy=await fetch('${origin}/tests/fixtures/global-fine-evaluator-preparation-native.json').then(r=>r.json());
      function prepare(s){return {
        bounds:s.bounds??[-10,-10,-10,10,10,10],center:s.center??[0,0,0],flat:!!s.flat,
        children:(s.children??[]).map(c=>c?prepare(c):undefined),
        triangles:(s.triangles??[]).map(t=>({id:t.id,
          vertices:t.vertices.map(v=>Float32Array.from(v)),normal:Float32Array.from(t.normal??[0,0,1]),flags:t.flags??0,
          bounds:Float32Array.from(t.bounds??[...[0,1,2].map(i=>Math.min(...t.vertices.map(v=>v[i]))),...[0,1,2].map(i=>Math.max(...t.vertices.map(v=>v[i])))])}))
      }}
      const bits=v=>Array.from(new Uint8Array(v.buffer,v.byteOffset,v.byteLength),x=>x.toString(16).padStart(2,'0')).join('');
      const scratch={stack:[],projection:new Float64Array(3),edgeFlags:new Uint8Array(1)};
      const distance=new Float64Array(1),projection=new Float64Array(3),flags=new Uint8Array(1);
      let comparisons=0;
      for(const c of fixture.cases){const tree=prepare(c.tree);
        for(let repeat=0;repeat<2;repeat++){
          distance[0]=c.radius;projection.set([11,12,13]);flags[0]=255;
          const hit=nativeGlobalEvaluatorQuery(tree,c.point,distance,projection,flags,!!c.mode,scratch);
          if((hit?.id??null)!==c.target||bits(distance)!==c.distanceBits||bits(projection)!==c.projectionBits||flags[0]!==c.edgeFlags||scratch.stack.length)
            throw Error('Original query mismatch: '+c.name+' repeat '+repeat);
          comparisons++;
        }
      }
      for(const c of policy.cases){
        if(bits(Float32Array.of(nativeGlobalEvaluatorExtent(Float32Array.from(c.bounds))))!==c.extentBits)
          throw Error('Original extent mismatch: '+c.name);
      }
      self.postMessage({cases:fixture.cases.length,comparisons,extentCases:policy.cases.length,stackEmpty:scratch.stack.length===0});
    `;
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    const worker = new Worker(url, { type: "module" });
    try {
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.onerror = (event) => reject(Error(event.message));
      });
      return { ...result, workerTerminated: true };
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, origin);
  assert.equal(report.cases, 392);
  assert.equal(report.comparisons, 784);
  assert.equal(report.extentCases, 12);
  assert.equal(report.stackEmpty, true);
  assert.equal(errors.length, 0);
  report.errors = errors;
  report.scope =
    "Original supplied-tree query and mesh-worker extent cases in an isolated browser Worker; not owner-scan alignment or index-builder verification.";
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(lease);
  try {
    await browser?.close();
  } finally {
    await server?.close();
    await writeFile(
      new URL("cleanup.json", out),
      JSON.stringify(
        {
          browserClosed: !server || server.process().exitCode !== null,
          ownedBrowserPid: server?.process().pid,
        },
        null,
        2,
      ),
    );
  }
}
