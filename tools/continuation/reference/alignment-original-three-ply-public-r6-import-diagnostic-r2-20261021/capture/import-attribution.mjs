// Source-only proposal. Scalar CDP counters add diagnostic timing overhead.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';

const METRICS=new Set(['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners','LayoutCount','RecalcStyleCount']);
const STAGES=['begin','after-file-input','after-dialog','after-publication'];

export async function createImportAttribution({page,directory,check}){
  const file=await open(new URL('import-stage-attribution.jsonl',directory),'wx');
  let client,clientPromise,sequence=0,bytes=0,closed=false,stageIndex=0;
  const append=async row=>{
    assert(!closed);assert(++sequence<=25,'Import diagnostic row cap');
    const wire=JSON.stringify({sequence,unixMs:Date.now(),monotonicNs:process.hrtime.bigint().toString(),...row})+'\n';
    assert(Buffer.byteLength(wire)<=4096);bytes+=Buffer.byteLength(wire);assert(bytes<=64*1024);
    await file.writeFile(wire);await file.sync();
  };
  const bounded=async operation=>{
    let timer;
    try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic counter deadline')),2000)})])}
    finally{clearTimeout(timer)}
  };
  return {
    async record({sourceIndex,stage}){
      check();assert.equal(sourceIndex,Math.floor(stageIndex/4));assert.equal(stage,STAGES[stageIndex%4]);stageIndex++;
      // Persist the stage before requesting renderer work, including on renderer failure.
      await append({kind:'import-stage',sourceIndex,stage});
      let metrics=null,geometryCounts=null,metricsStatus='unavailable',geometryStatus='unavailable';
      try{
        if(!client){
          clientPromise??=page.context().newCDPSession(page);
          client=await bounded(()=>clientPromise);await bounded(()=>client.send('Performance.enable'));
        }
        const result=await bounded(()=>client.send('Performance.getMetrics'));
        metrics={};for(const item of result.metrics){if(METRICS.has(item.name)&&Number.isFinite(item.value)&&item.value>=0)metrics[item.name]=item.value}
        assert(Object.keys(metrics).length<=METRICS.size);metricsStatus='measured';
      }catch{metrics=null}
      try{
        geometryCounts=await bounded(()=>page.evaluate(()=>globalThis.__scanforgeThreePlyBorrow.importMetadata()));
        assert(Array.isArray(geometryCounts)&&geometryCounts.length<=3);
        for(const row of geometryCounts){assert.equal(Object.keys(row).length,5);for(const value of Object.values(row))assert(value===null||(Number.isSafeInteger(value)&&value>=0))}
        geometryStatus='measured';
      }catch{geometryCounts=null}
      await append({kind:'import-counters',sourceIndex,stage,metricsStatus,metrics,geometryStatus,geometryCounts});
    },
    async close(){
      if(closed)return {rows:sequence,bytes,closed};
      try{
        if(client){try{await bounded(()=>client.detach())}catch{}}
        else if(clientPromise){void clientPromise.then(session=>session.detach()).catch(()=>{})}
      }
      finally{closed=true;await file.close()}
      return {rows:sequence,bytes,closed,scope:'Scalar import diagnostics; not exact allocations or production timings'};
    },
  };
}
