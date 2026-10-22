import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {instrumentCurrentWorkspace,injection} from './instrument-current-workspace.mjs';
import {installBorrowedThreePlyObserver} from './browser-borrowed-observer.mjs';
import {createBorrowedGeometryReader} from './borrowed-geometry-reader.mjs';
import {soupScalarAddress} from './public-ply-input.mjs';

let checks=0;const ok=()=>checks++;
const source=await readFile(new URL('./hook-parent.preview.ts',import.meta.url));
const sha=createHash('sha256').update(source).digest('hex');
const patched=instrumentCurrentWorkspace(source,sha);
assert(Buffer.from(patched.output.toString().replace(injection,'')).equals(source));ok();
assert(patched.output.equals(await readFile(new URL('./hook-postimage.preview.ts',import.meta.url))));ok();
assert.throws(()=>instrumentCurrentWorkspace(source,'0'.repeat(64)));ok();
const ambiguous=Buffer.concat([source,Buffer.from('\n  current.current = host;\n')]);
assert.throws(()=>instrumentCurrentWorkspace(ambiguous,createHash('sha256').update(ambiguous).digest('hex')));ok();

const keys=['Worker','location','__scanforgePublicPlyEvent','__globalAlignmentWorkerEvidence','__scanforgeThreePlyBorrow'];
const previous=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const seen=[],originalFailure=Error('exact original terminate failure');let failStop=true;
class FakeWorker extends EventTarget{
  constructor(url,options){super();this.url=url;this.options=options;seen.push(['construct',url,options]);}
  postMessage(){seen.push(['post',this,[...arguments]]);return 'original-post-return'}
  terminate(){if(failStop)throw originalFailure;seen.push(['stop',this]);return 'original-stop-return'}
}
let api;
try{
 globalThis.Worker=FakeWorker;globalThis.location=new URL('http://127.0.0.1:12345/');
 globalThis.__scanforgePublicPlyEvent=async wire=>{seen.push(['wire',wire]);return {recorded:true}};
installBorrowedThreePlyObserver({scenePath:'/assets/scene.js',controllerPath:'/assets/controller.js',leaseMs:5000});
 api=globalThis.__scanforgeThreePlyBorrow;
 const values=new Float32Array(3);new Uint32Array(values.buffer).set([0x80000000,0x3f800000,0x3f000000]);
 let current={entities:['a','b','c'].map(id=>({id,positions:values,normals:values,indexedMesh:{vertices:values,normals:values,triangles:new Uint32Array([0,0,0])}}))};
 api.register(()=>current);
 const meta=api.describe('a','indexedNormals');
 const wire=api.read({...meta,offset:0,count:3});
 assert.equal(Buffer.from(wire.base64,'base64').readUInt32LE(0),0x80000000);ok();
 assert.throws(()=>api.read({...meta,offset:0,count:16385}));ok();
 current={entities:current.entities.map(e=>({...e,indexedMesh:{...e.indexedMesh,normals:new Float32Array(3)}}))};
 assert.throws(()=>api.read({...meta,offset:0,count:3}));ok();
 current.entities[0].positions=[1,2,3];assert.throws(()=>api.describe('a','positions'));ok();
 const url='/assets/controller.js',options={type:'module',name:'actual-options'};
 const worker=new globalThis.Worker(url,options);
 assert.equal(worker.url,url);assert.equal(worker.options,options);ok();
 const packet={ordinary:true},transfer=[];
 assert.equal(worker.postMessage(packet,transfer),'original-post-return');
 const sent=seen.find(entry=>entry[0]==='post');assert.equal(sent[1],worker);assert.equal(sent[2][0],packet);assert.equal(sent[2][1],transfer);ok();
 let production=0;worker.addEventListener('message',()=>production++);
 const event=new MessageEvent('message',{data:{kind:'ready',capability:{isolated:true,workers:true,hardware:2}}});
 worker.dispatchEvent(event);assert.equal(production,1);ok();
 assert.throws(()=>worker.terminate(),error=>error===originalFailure);
 assert.equal(globalThis.__globalAlignmentWorkerEvidence[0].terminatedAt,null);
 worker.dispatchEvent(new MessageEvent('message',{data:{kind:'ready',capability:{isolated:true,workers:true,hardware:2}}}));
 assert.equal(production,2);await api.flush();assert.equal(seen.filter(entry=>entry[0]==='wire'&&entry[1].event==='controller-ready').length,2);ok();
 failStop=false;assert.equal(worker.terminate(),'original-stop-return');
 assert.equal(typeof globalThis.__globalAlignmentWorkerEvidence[0].terminatedAt,'number');
 worker.dispatchEvent(new MessageEvent('message',{data:{kind:'ready'}}));
 await api.flush();assert.equal(production,3);assert.equal(seen.filter(entry=>entry[0]==='wire'&&entry[1].event==='controller-ready').length,2);ok();
 await api.close();assert.equal(globalThis.Worker,FakeWorker);assert.equal(globalThis.__scanforgeThreePlyBorrow,undefined);assert.throws(()=>api.describe('a','positions'));ok();
}finally{
 if(api)await api.close().catch(()=>{});
 for(const key of keys){if(previous[key])Object.defineProperty(globalThis,key,previous[key]);else delete globalThis[key]}
}
assert.equal(soupScalarAddress(new Uint32Array([2,0,1]),0,2,9),8);
assert.throws(()=>soupScalarAddress(new Uint32Array([3]),0,0,9));ok();
let release;
const gate=new Promise(resolve=>{release=resolve});
const reader=createBorrowedGeometryReader({page:{evaluate:()=>gate},directory:'UNUSED-NO-READBACK-OPENED',sources:[{},{},{}],check:()=>{}});
const pending=reader.geometry(['a','b','c']).then(()=>null,error=>error);
let closeSettled=false;const stop=reader.close().then(value=>{closeSettled=true;return value});
await Promise.resolve();assert.equal(closeSettled,false);
release({scalarCount:3,sourceKind:'Float32Array',token:1});
assert.match((await pending).message,/Reader cancellation/);assert.equal((await stop).activeReads,0);ok();
console.log(JSON.stringify({checks,failures:0,scope:'Standalone fake Worker/getter/patch contracts only; actual browser and native UNRUN'}));
