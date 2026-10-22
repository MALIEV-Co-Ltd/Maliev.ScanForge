import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import path from 'node:path';
const CARRIERS=['positions','indexedPositions','triangles','indexedNormals','renderNormals'];

// Hash cache contains scalar identities and digests only; never a browser snapshot/carrier.
export function createBorrowedGeometryReader({page,directory,sources,check,onReadback}){
  const cache=new Map();let retainedBytes=0,totalChunks=0,active=0,closed=false;
  assert.equal(sources.length,3);
  return {
    async geometry(ids){
      assert(!closed);assert.equal(active,0,'Only one bounded readback may run');active++;
      try{
      assert.equal(ids.length,3);const results=[];
      for(let source=0;source<3;source++){
        const entityId=ids[source],fields=[],combined=createHash('sha256');
        for(const carrier of CARRIERS){
          check();
          const meta=await page.evaluate(({entityId,carrier})=>globalThis.__scanforgeThreePlyBorrow.describe(entityId,carrier),{entityId,carrier});
          assert(!closed,'Reader cancellation requested');
          assert.equal(meta.sourceKind,carrier==='triangles'?'Uint32Array':'Float32Array','Exact raw-bit carrier kind; no conversion');
          const expected=carrier==='positions'||carrier==='renderNormals'?sources[source].triangles*9:carrier==='triangles'?sources[source].triangles*3:sources[source].vertices*3;
          assert.equal(meta.scalarCount,expected,'Original indexed/soup scalar count');
          const key=`${entityId}:${carrier}:${meta.token}`;
          let report=cache.get(key);
          if(!report){
            assert(cache.size<90,'Bounded geometry digest cache');
            const hash=createHash('sha256');let file,outputPath;
            // Retain indexed input/committed outputs for the subsequent matched native replay.
            if(carrier==='indexedPositions'||carrier==='indexedNormals'){
              assert(retainedBytes+meta.scalarCount*4<=512*1048576,'Indexed readback512MiB disk bound');
              await mkdir(directory,{recursive:true});outputPath=path.join(directory,`source-${source}-${carrier}-borrow-${meta.token}.f32`);
              file=await open(outputPath,'wx');
            }
            try{
              let offset=0;
              while(offset<meta.scalarCount){
                check();assert(!closed,'Reader cancellation requested');const count=Math.min(16384,meta.scalarCount-offset);
                const wire=await page.evaluate(request=>globalThis.__scanforgeThreePlyBorrow.read(request),{entityId,carrier,token:meta.token,scalarCount:meta.scalarCount,offset,count});
                assert(!closed,'Reader cancellation requested');assert.equal(wire.sourceKind,meta.sourceKind);
                assert.equal(wire.entityId,entityId);assert.equal(wire.carrier,carrier);assert.equal(wire.token,meta.token);assert.equal(wire.offset,offset);assert.equal(wire.count,count);assert.equal(wire.scalarCount,meta.scalarCount);
                assert.equal(wire.base64.length,4*Math.ceil(count*4/3));
                const bytes=Buffer.from(wire.base64,'base64');assert.equal(bytes.length,count*4);assert.equal(bytes.toString('base64'),wire.base64);
                hash.update(bytes);
                if(file){let written=0;while(written<bytes.length){const result=await file.write(bytes,written,bytes.length-written,offset*4+written);assert(result.bytesWritten>0);written+=result.bytesWritten}}
                offset+=count;totalChunks++;
              }
              const after=await page.evaluate(({entityId,carrier})=>globalThis.__scanforgeThreePlyBorrow.describe(entityId,carrier),{entityId,carrier});
              assert.equal(after.token,meta.token);assert.equal(after.scalarCount,meta.scalarCount);
              report={carrier,scalarCount:meta.scalarCount,bytes:meta.scalarCount*4,sha256:hash.digest('hex')};
              if(file){await file.sync();await file.close();file=undefined;retainedBytes+=report.bytes;onReadback?.({sourceId:String(source),entityId,...report,path:outputPath,sourceKind:meta.sourceKind})}
              cache.set(key,report);
            }finally{if(file)await file.close()}
          }
          combined.update(carrier+'\0'+report.scalarCount+'\0'+report.sha256+'\n');fields.push(report);
        }
        results.push({id:entityId,sha256:combined.digest('hex'),coordinates:fields[0].scalarCount,fields});
      }
      return results;
      }finally{active--}
    },
    stats(){return {digestEntries:cache.size,totalChunks,retainedIndexedBytes:retainedBytes,scope:'Borrowed actual current published carriers; diagnostic stream/hash timing overhead included'}},
    async close(){closed=true;const deadline=Date.now()+5000;while(active){if(Date.now()>deadline)throw Error('Readback cleanup5000ms deadline; active ownership unresolved');await new Promise(resolve=>setTimeout(resolve,10))}cache.clear();return {activeReads:0}}
  };
}
