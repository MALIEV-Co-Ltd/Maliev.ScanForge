// Root must execute through an owned bounded validation plan; never imports meshes.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {createImportAttribution} from './import-attribution.mjs';
import {importOriginalPlyViaGui} from './public-gui-ply-input.mjs';
import {installBorrowedThreePlyObserver} from './browser-borrowed-observer.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'scanforge-import-attribution-fixture-'));
try{
  let selected=0,pending,detached=0,cdpCreated=0;
  const sources=[1,2,3].map(i=>({name:`ply-${i}.ply`,path:`B:/temp/alignment-example-files/ply-${i}.ply`,sha256:'a'.repeat(64),bytes:i}));
  const client={async send(method){return method==='Performance.getMetrics'?{metrics:[{name:'JSHeapUsedSize',value:123},{name:'UnapprovedCounter',value:999}]}:{}},async detach(){detached++}};
  const input={async count(){return 1},async setInputFiles(value){pending=value}};
  const dialog={async waitFor(){},locator(){return {async inputValue(){return 'mm'}}},getByRole(){return {async click(){assert.equal(pending,sources[selected].path);selected++}}}};
  const page={locator(){return input},getByRole(){return dialog},context(){return {async newCDPSession(){cdpCreated++;return client}}},async evaluate(){return []}};
  const call=async name=>({result:name==='project_get'?{objects:sources.slice(0,selected).map(s=>({name:s.name}))}:{busy:false}});
  const recorder=await createImportAttribution({page,directory:pathToFileURL(directory+path.sep),check(){}});
  let reports;
  try{reports=await importOriginalPlyViaGui({sources,page,call,waitUntil:async fn=>assert(await fn()),check(){},onImportStage:recorder.record})}
  finally{assert.equal((await recorder.close()).closed,true)}
  assert.equal(reports.length,3);assert.equal(cdpCreated,1);assert.equal(detached,1);
  const rows=(await readFile(path.join(directory,'import-stage-attribution.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,24);
  for(let i=0;i<rows.length;i++){
    assert.equal(rows[i].sequence,i+1);assert.equal(rows[i].sourceIndex,Math.floor(i/8));
    assert.equal(rows[i].stage,['begin','after-file-input','after-dialog','after-publication'][Math.floor(i/2)%4]);
    if(i%2){assert.deepEqual(rows[i].metrics,{JSHeapUsedSize:123});assert.deepEqual(rows[i].geometryCounts,[])}
  }
  const events=[];
  class Worker{
    addEventListener(){}removeEventListener(){}
    postMessage(){return 'forwarded'}terminate(){return 'terminated'}
  }
  const context=vm.createContext({Worker,URL,location:{href:'http://127.0.0.1:5173/'},setTimeout,clearTimeout,__scanforgePublicPlyEvent:async row=>{events.push(JSON.parse(JSON.stringify(row)));return {recorded:true}}});
  vm.runInContext(`(${installBorrowedThreePlyObserver.toString()})({leaseMs:2000,scenePath:'/assets/scene.js',controllerPath:'/assets/controller.js'}); const w=new Worker('http://127.0.0.1:5173/assets/picking-worker-123.js?secret=omitted#private'); if(w.postMessage({})!=='forwarded')throw Error('Forwarding changed'); w.terminate();`,context);
  await vm.runInContext('globalThis.__scanforgeThreePlyBorrow.close()',context);
  assert.equal(events[0].event,'worker-created');assert.equal(events[0].workerId,1);assert.equal(events[0].kind,'ordinary');assert.equal(events[0].basename,'picking-worker-123.js');
  assert.equal(JSON.stringify(events).includes('secret'),false);assert.equal(events[1].event,'worker-termination-request');
  console.log('PASS: 3 ordered imports, 24 bounded scalar records, one detached CDP session, sanitized worker creation, unchanged message forwarding');
}finally{await rm(directory,{recursive:true,force:true})}
