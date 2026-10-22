import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const files=['import-attribution.mjs','import-attribution.fixture.mjs','public-ply-input.mjs','public-gui-ply-input.mjs','gui-import.fixed.fixture.mjs','instrument-current-workspace.mjs','browser-borrowed-observer.mjs','borrowed-geometry-reader.mjs','original-three-ply-public.current.mjs','probe-contract.fixture.mjs','run-original-three-ply-cli.mjs'];
for(const name of files){const result=spawnSync(process.execPath,['--max-old-space-size=128','--check',fileURLToPath(new URL(name,import.meta.url))],{shell:false,windowsHide:true,timeout:30000,maxBuffer:65536});assert(!result.error,result.error?.message);assert.equal(result.status,0,`${name}: ${result.stderr}`)}
console.log(JSON.stringify({syntaxFiles:files.length,scope:'Standalone diagnostic syntax only; no browser/application/native execution'}));
