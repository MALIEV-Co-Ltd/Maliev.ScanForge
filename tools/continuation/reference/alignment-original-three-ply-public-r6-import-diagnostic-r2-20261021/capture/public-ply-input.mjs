import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Public API only: one source upload/import/delete completes before opening the next.
export async function importOriginalPlySequentially({sources,call,mutate,awaitJob,check,onImported}) {
  assert.equal(sources.length,3);
  const reports=[];
  for(let i=0;i<3;i++){
    const source=sources[i];
    assert.equal(source.name,`ply-${i+1}.ply`);
    assert.equal(source.path,`B:/temp/alignment-example-files/${source.name}`);
    assert(Number.isSafeInteger(source.bytes)&&source.bytes>0);
    assert(/^[a-f0-9]{64}$/.test(source.sha256));
    check();let handle,artifactId,primary;const cleanup=[];
    try{
      handle=await open(source.path,'r');assert.equal((await handle.stat()).size,source.bytes);
      const buffer=Buffer.alloc(65536),hash=createHash('sha256');let offset=0;
      while(offset<source.bytes){
        check();const length=Math.min(buffer.length,source.bytes-offset);
        const {bytesRead}=await handle.read(buffer,0,length,offset);assert.equal(bytesRead,length);
        hash.update(buffer.subarray(0,length));
        const upload=(await call('artifact_put',{name:source.name,offset,base64:buffer.subarray(0,length).toString('base64'),...(artifactId?{artifactId}:{})})).result;
        assert.equal(typeof upload.artifactId,'string');
        if(artifactId)assert.equal(upload.artifactId,artifactId);else artifactId=upload.artifactId;
        offset+=length;
      }
      assert.equal(hash.digest('hex'),source.sha256,'Original PLY file pin drift');
      await handle.close();handle=undefined;check();
      const imported=await awaitJob(await mutate('project_import',{artifactId,unit:'mm'}));
      const report={sourceId:String(i),name:source.name,bytes:source.bytes,sha256:source.sha256,publicImportCompleted:true};
      if(onImported)await onImported(report,imported);
      reports.push(report);
    }catch(error){primary=error;throw error}
    finally{
      if(handle)try{await handle.close()}catch(error){cleanup.push(error)}
      if(artifactId)try{await call('artifact_delete',{artifactId})}catch(error){cleanup.push(error)}
      if(cleanup.length)throw new AggregateError(primary?[primary,...cleanup]:cleanup,'Exact public PLY input cleanup failed');
    }
  }
  return reports;
}

// PLYLoader topology preserves file vertex IDs and triangle order. No welding/repacking.
export function soupScalarAddress(triangles,slot,axis,vertexScalars){
  assert(triangles instanceof Uint32Array);
  assert(Number.isSafeInteger(slot)&&slot>=0&&slot<triangles.length);
  assert(Number.isSafeInteger(axis)&&axis>=0&&axis<3);
  const scalar=triangles[slot]*3+axis;
  assert(Number.isSafeInteger(vertexScalars)&&vertexScalars%3===0&&scalar<vertexScalars);
  return scalar;
}
