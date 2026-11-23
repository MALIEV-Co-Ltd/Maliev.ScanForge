import {it, expect} from "vitest";
import {runScanEdit} from "../src/scan-edit";
it("compares equivalent boundary cutter tessellations",()=>{
 const source=new Float32Array([0,1,0,1,1,0,0,2,0]);
 const single=new Float32Array([.5,1,0,.5,1.3,0,.5,1.15,1]);
 const two=new Float32Array([.5,1,0,.5,1.15,0,.5,1.15,1,.5,1.15,0,.5,1.3,0,.5,1.15,1]);
 const summarize=(target: Float32Array)=>{const result=runScanEdit({kind:"scanEdit",action:"split",positions:source,target});const mesh=result.indexedMesh!;const e=new Map<string,number>();for(let i=0;i<mesh.triangles.length;i+=3)for(let j=0;j<3;j++){const a=mesh.triangles[i+j],b=mesh.triangles[i+(j+1)%3],k=[a,b].sort((x,y)=>x-y).join(":");e.set(k,(e.get(k)??0)+1)};return {faces:mesh.triangles.length/3,boundaries:[...e.values()].filter(x=>x===1).length,vertices:mesh.vertices.length/3,parts:result.diagnostics.parts};};
 const results=[summarize(single),summarize(two)];console.log(JSON.stringify(results));expect(results[0]).toEqual(results[1]);
});
