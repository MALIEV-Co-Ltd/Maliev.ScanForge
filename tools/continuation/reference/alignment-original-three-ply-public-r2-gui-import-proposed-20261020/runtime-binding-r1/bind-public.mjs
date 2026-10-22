// Metadata only. Root schedules this after ACTUAL public capture, never a native launch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {prepareMatchedNativeRequest} from '../matched-native-adapter.r2.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
assert(os.freemem() >= 4096 * 1048576, 'Unchanged4096 root staging admission');
assert(process.argv[3] === '--root-reviewed-actual-capture', 'Explicit root review required');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'source-manifest.json'), 'utf8'));
const approvedPlan = path.resolve(here, '../public-profile-plan.ACTUAL.json');
assert.equal(path.resolve(cfg.publicPlan.path), approvedPlan);
assert.equal(cfg.publicPlan.sha256, '4bc54b998c7c60bfa1067729aa803995236f9ad01ebfa701bbd0f86364356d79', 'Only root-approved publicR2 plan; futureR3 needs reviewed rebind');
assert.equal(path.resolve(cfg.publicEvidence.path), path.resolve(here, '../harness-output/evidence.json'));
assert.equal(path.resolve(cfg.publicEvents.path), path.resolve(here, '../harness-output/public-controller-events.jsonl'));
const hash = file => {
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(65536), fd = fs.openSync(file, 'r');
  try {let count;while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
    assert(Date.now() - started < 300000, 'Metadata300s lease');digest.update(buffer.subarray(0, count));
  }} finally {fs.closeSync(fd);}
  return digest.digest('hex');
};
const check = pin => {
  assert(pin && path.isAbsolute(pin.path) && fs.statSync(pin.path).size === pin.bytes);
  assert.equal(hash(pin.path), pin.sha256, 'Exact immutable authority ' + pin.path);
};
const read = pin => {check(pin);assert(pin.bytes <= 4 * 1048576);return JSON.parse(fs.readFileSync(pin.path, 'utf8'));};
for (const pin of manifest.pins) check(pin);
for (const key of ['originalInputs', 'normalDistinction']) assert.deepEqual(cfg[key], manifest.roles[key]);
const configPath = path.resolve(here, '../browser-config.ACTUAL.json');
assert.equal(hash(configPath), 'e066a9719926e0be8712f41ce3635590e56827a797bcbd6292f23a18018c555c');
const approvedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const publicRun = read(approvedConfig.publicRun);
check(publicRun.diagnosticSourceReceipt);check(publicRun.diagnosticBuildReceipt);
// The immutable approved config/run/source/build chain binds scanforge-c5282a283ba2a915,
// the reviewed1756 diagnostic copy and exact original3 source pins; no caller build override.
for (const original of publicRun.sources) check(original);
const plan = read(cfg.publicPlan), ledger = read(cfg.publicLedger), evidence = read(cfg.publicEvidence);
assert.equal(ledger.planSha256, cfg.publicPlan.sha256);assert.equal(ledger.mode, 'kernel');
assert.equal(ledger.completed, true);assert.equal(ledger.phases.length, 1);
const phase = ledger.phases[0];assert.equal(phase.exitCode, 0);assert.equal(phase.finalJobAccounting.activeProcesses, 0);
assert.deepEqual(phase.captureErrors, []);assert.deepEqual(phase.cleanupErrors, []);
for (const key of ['verifiedExited','allObservedExited','allJobChildrenObserved','handlesClosed','completionPortClosed']) assert.equal(phase[key], true);
assert.deepEqual(phase.arguments, plan.modes.kernel.args);
assert.equal(evidence.passed, true);assert.equal(evidence.completed, true);
check(cfg.publicEvents);assert(cfg.publicEvents.bytes <= 16 * 1048576);
const events = [];
const input = fs.createReadStream(cfg.publicEvents.path, {highWaterMark: 65536});
const lines = readline.createInterface({input, crlfDelay: Infinity});
try {for await (const line of lines) {
  assert(Buffer.byteLength(line) <= 61440 && events.length < 512);if (line) events.push(JSON.parse(line));
}} finally {lines.close();input.destroy();}
const request = prepareMatchedNativeRequest({evidence, events,
  originalInputs: read(cfg.originalInputs), normalDistinction: read(cfg.normalDistinction)});
const readbackRoot = path.resolve(path.dirname(cfg.publicEvidence.path), 'typed-readbacks');
for (const source of request.sources) {
  const original = publicRun.sources[source.source];
  assert.equal(source.originalPly.sha256, original.sha256);
  assert.equal(source.originalPly.bytes, original.bytes);
  assert.equal(path.resolve(source.originalPly.path), path.resolve(original.path));
  check(source.originalPly);check(source.queryNormalAuthority.inputTriangles);
  for (const key of ['originalIndexedPositions','authoredSetterNormals','publishedPositions','publishedAuthoredNormals']) {
    assert.equal(source[key].sourceKind, 'Float32Array');
    const relative = path.relative(readbackRoot, source[key].path);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Owned captured readback only');
    check(source[key]);
  }
}
const run = path.join(here, 'actual-run');assert(!fs.existsSync(run), 'Exclusive late-binding run');
fs.mkdirSync(run);
const requestPath = path.join(run, 'observed-request.json');
fs.writeFileSync(requestPath, JSON.stringify(request), {flag: 'wx'});
const requestPin = {path: requestPath, bytes: fs.statSync(requestPath).size, sha256: hash(requestPath)};
fs.writeFileSync(path.join(run, 'capture-authority.json'), JSON.stringify({
  status: 'ACTUAL_PUBLIC_CAPTURE_BOUND_NATIVE_UNRUN', request: requestPin,
  publicEvidence: cfg.publicEvidence, publicEvents: cfg.publicEvents, publicPlan: cfg.publicPlan,
  publicLedger: cfg.publicLedger, originalInputs: cfg.originalInputs, normalDistinction: cfg.normalDistinction,
  bindingSource: manifest.roles.publicBinder, approvedConfig: manifest.roles.publicConfig,
  rootReviewed: true, nativeAcceptance: false,
}), {flag: 'wx'});
console.log(JSON.stringify({request: requestPin, nativeExecuted: false}));
