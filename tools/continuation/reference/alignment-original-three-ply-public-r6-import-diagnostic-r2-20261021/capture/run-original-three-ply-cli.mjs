import {pathToFileURL} from 'node:url';
// Existing finite CLI-step pattern; unchanged original v4 owns every descendant.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {freemem} from 'node:os';
import {spawnSync} from 'node:child_process';
assert(freemem() >= 5120 * 1048576, 'Browser entry requires unchanged5120MiB admission');
assert.equal(process.argv.length, 3);
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sha = file => {
  const hash = createHash('sha256'), bytes = Buffer.alloc(65536), fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, bytes, 0, bytes.length, null))) hash.update(bytes.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
for (const pin of cfg.pins) { assert.equal(fs.statSync(pin.path).size, pin.bytes); assert.equal(sha(pin.path), pin.sha256, pin.path); }
// Additive accepted-R4/R14 provenance gate; existing lifecycle assertions unchanged.
const accepted = JSON.parse(fs.readFileSync(cfg.acceptedR4Review.path,'utf8'));
assert.equal(accepted.status,'ACTUAL_R4_REPLAY_PREREQUISITES_ROOT_REVIEWED');assert.equal(accepted.rootReviewed,true);
assert.equal(accepted.sourceManifestSha256,cfg.acceptedR4SourceManifestSha256);assert.equal(accepted.buildZeroWarningsErrors,true);
assert.equal(accepted.sourceReceiptSha256,cfg.acceptedSourceReceipt.sha256);
assert.deepEqual(accepted.validationLedgerSha256,cfg.acceptedR4ValidationLedgerSha256);
const native = JSON.parse(fs.readFileSync(cfg.acceptedR14Review.path,'utf8'));
assert.equal(native.status,'CONTROLLED_THREE_SCAN_CONTROLLER_AND_FINAL_FIELDS_ROOT_ACCEPTED');
assert.equal(native.sourceManifestSha256,cfg.acceptedR4SourceManifestSha256);assert.equal(native.r4Prerequisites.sha256,cfg.acceptedR4Review.sha256);
assert.equal(native.fullControllerCompared,true);assert.equal(native.finalGeometryByteExact,true);assert.equal(native.finalFields,6);assert.equal(native.finalBytes,81154920);
assert.equal(native.controllerIsolationObserved,true);assert.equal(native.jobMemoryLimitBytes,2147483648);assert.equal(native.jobActiveProcesses,0);assert.deepEqual(native.cleanupErrors,[]);
const nativeEvidence=JSON.parse(fs.readFileSync(native.evidence.path,'utf8'));assert.equal(nativeEvidence.passed,true);
assert.equal(cfg.prerequisites.length,3,'Actual isolated focused/suite/format required');
for(const check of cfg.prerequisites){
  const ledger=JSON.parse(fs.readFileSync(check.ledger.path,'utf8'));
  assert.equal(ledger.completed,true);assert.equal(ledger.planSha256,check.planSha256);assert.equal(ledger.phases.length,1);
  const p=ledger.phases[0];assert.equal(p.name,check.mode);assert.deepEqual(p.arguments,check.args);
  assert.equal(p.exitCode,0);assert.equal(p.finalJobAccounting.activeProcesses,0);
  for(const flag of ['verifiedExited','allObservedExited','allJobChildrenObserved','handlesClosed','completionPortClosed'])assert.equal(p[flag],true);
  assert.deepEqual(p.cleanupErrors,[]);assert.deepEqual(p.captureErrors,[]);
}
const build = JSON.parse(fs.readFileSync(cfg.buildLedger.path, 'utf8'));
assert.equal(build.completed, true); assert.equal(build.planSha256, cfg.buildPlan.sha256);
assert.equal(build.phases.length, 1);
const phase = build.phases[0];
assert.equal(phase.exitCode, 0); assert.equal(phase.finalJobAccounting.activeProcesses, 0);
for (const key of ['allObservedExited','handlesClosed','completionPortClosed']) assert.equal(phase[key], true);
assert.deepEqual(phase.cleanupErrors, []); assert.deepEqual(phase.captureErrors, []);
assert.equal(fs.statSync(cfg.buildStderr.path).size, 0, 'Actual build stderr must remain empty');
const actualDist = [];
const collect = directory => { for (const item of fs.readdirSync(directory, {withFileTypes:true})) {
  assert(!item.isSymbolicLink(), 'No dist reparse input');
  const full = path.join(directory, item.name);
  if (item.isDirectory()) collect(full); else if (item.isFile()) actualDist.push(path.relative(cfg.dist, full).replaceAll('\\','/'));
}};
collect(cfg.dist);
assert.deepEqual(actualDist.sort(), cfg.distEntries.map(row => row.relative).sort(), 'Exact built file set');
assert(fs.readFileSync(path.join(cfg.dist, 'sw.js'), 'utf8').includes(cfg.buildManifest));
assert(!fs.existsSync(path.dirname(cfg.harnessOutputs[0])), 'Preserve prior global browser directory');
for (const destination of cfg.harnessOutputs) assert(!fs.existsSync(destination), 'Snapshot harness output must be absent; preserve prior snapshot receipts');
assert(!fs.existsSync(cfg.outputDirectory), 'Preserve previous wrapper run');
assert(freemem() >= 4608 * 1048576, 'Browser child requires unchanged4608MiB admission');
fs.mkdirSync(cfg.outputDirectory);
const record = {owner:'global-alignment-browser-existing-cli-step',purpose:'Shared GUI/MCP Global Fine Align preview/Apply/Cancel/Undo workflow',
  startedUnixMs:Date.now(),leaseSeconds:240,innerHeapMiB:768,outputCapBytes:8388608,
  command:process.execPath,args:['--max-old-space-size=768','--max-semi-space-size=16','--import',pathToFileURL(cfg.preload.path).href,cfg.harness.path],
  inheritedOwnership:'Original unchanged v4 private Job captures and cleans every descendant',
  buildManifest:cfg.buildManifest,buildLedgerSha256:cfg.buildLedger.sha256,
  passed:false,inFlightCancellationProved:false,heapReleaseProved:false};
try {
  const denialReceipt = path.join(cfg.outputDirectory,'taskkill-denied.json');
  const result = spawnSync(process.execPath, record.args, {cwd:cfg.repo,env:{...process.env,SCANFORGE_TASKKILL_DENY_RECEIPT:denialReceipt},
    stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,timeout:240000,maxBuffer:8388608});
  record.pid=result.pid;record.exitCode=result.status;record.signal=result.signal;record.error=result.error?.message;
  for (const key of ['stdout','stderr']) fs.writeFileSync(path.join(cfg.outputDirectory,key+'.log'),result[key]??Buffer.alloc(0),{flag:'wx'});
  assert(!fs.existsSync(denialReceipt),'Forbidden fallback attempted; require outer Job cleanup and preserve failure');
  assert(!result.error && result.status===0, 'Existing browser harness failed; preserve logs and require outer Job cleanup');
  const evidence = JSON.parse(fs.readFileSync(cfg.harnessOutputs[0],'utf8'));
  assert.equal(evidence.owner,'global-alignment-browser');assert.equal(evidence.passed,true);assert.equal(evidence.completed,true);
  assert.equal(evidence.pid,result.pid);assert(Date.parse(evidence.expiresAt)-240000>=record.startedUnixMs-1000,'Fresh harness receipt required');
  assert.equal(evidence.fixture.scans,3);assert.deepEqual(evidence.fixture.sources.map(s=>s.sha256),cfg.originalPlySources.map(s=>s.sha256));assert.equal(evidence.nativeComparison.status,'MATCHED_NATIVE_REPLAY_PENDING');assert.equal(evidence.nativeComparison.fixedR14OutputInherited,false);assert.equal(evidence.actualPublicControllerResults.length,2);
  assert.equal(evidence.admission.requiredMiB,4608);assert.equal(evidence.admission.oldSpaceMiB,768);assert.equal(evidence.admission.semiSpaceMiB,16);
  assert.deepEqual(evidence.checks.map(row=>row.check),['GUI preview/cancel','MCP mismatched job cleanup preserves current preview','MCP cached Apply + one history step + Undo/Redo','MCP actual in-flight preview cancellation']);
  assert.equal(evidence.checks[2].noWorkersStartedOnApply,true);
  const globalWorkers=evidence.workers.filter(row=>/global-(alignment|scene|query)/.test(row.url));
  assert(globalWorkers.length>0);assert(globalWorkers.every(row=>row.terminatedAt!==null));
  assert(evidence.cleanup.every(row=>!row.error && row.verified!==false));
  const server = evidence.resources.find(row=>row.kind==='http-server');
  assert.equal(server.pid,result.pid);assert.equal(server.bind,'127.0.0.1');assert.notEqual(server.port,5173);
  for(const resource of evidence.resources.filter(row=>row.port)){assert.notEqual(resource.port,5173);assert(evidence.cleanup.some(row=>row.port===resource.port&&row.closed===true));}
  for(const resource of evidence.resources.filter(row=>['mcp-stdio-child','disposable-browser'].includes(row.kind))){assert(evidence.cleanup.some(row=>row.pid===resource.pid&&row.exited===true));}
  for(const file of cfg.harnessOutputs){assert(fs.existsSync(file));record[path.basename(file)+'Sha256']=sha(file);}
  for(const pin of cfg.distEntries) assert.equal(sha(pin.path),pin.sha256,'Built app changed during browser run');
  // Large run contains one MCP Apply; GUI cached Apply remains covered by separate legacy five-case evidence.
  assert.equal(evidence.checks[3].observedPreparing,true);assert.equal(evidence.checks[3].observedRunning,true);assert.equal(evidence.checks[3].ownedJob,true);assert.equal(evidence.checks[3].terminalStatus,'cancelled');assert.equal(evidence.checks[3].noArtificialDelays,true);assert(evidence.checks[3].workerCount>0);
  record.passed=true;
} finally {
  record.finishedUnixMs=Date.now();
  fs.writeFileSync(path.join(cfg.outputDirectory,'cli-step-record.json'),JSON.stringify(record,null,2),{flag:'wx'});
}
