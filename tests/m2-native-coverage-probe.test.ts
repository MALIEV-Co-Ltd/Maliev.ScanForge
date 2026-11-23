import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMesh } from '../src/io';
import { exactSplitCoverage } from '../src/scan-split-exact-coverage';
import { assembleFiniteFaceMesh } from '../src/scan-split-finite-assembly';
import type { Vec3 } from '../src/types';

it('compares retained native source-face area and exact coverage', () => {
  const root='C:/Users/Shoung/.codex/worktrees/m2-cavity-safety-recheck/Maliev.ScanForge/tests/fixtures/';
  const cases=[['below','m2-split-point-radius','native-below-20261029.stl'],['at','m2-split-point-radius','native-at-20261029.stl'],['above','m2-split-point-radius','native-above-20261029.stl'],['wide-below','m2-split-wide-radius-20261029','native-wide-radius-below-20261029.stl'],['wide-above','m2-split-wide-radius-20261029','native-wide-radius-above-20261029.stl']];
  const rows=[];
  for(const [name,dir,file] of cases) {
    const b=readFileSync(root+dir+'/'+file), native=parseMesh(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'stl');
    const vertices:Vec3[]=[[0,0,0],[1,0,0],[0,1,0]], ids=new Map(vertices.map((v,i)=>[v.join(','),i]));
    const triangles:[number,number,number][]=[]; let area=0;
    for(let i=0;i<native.length;i+=9){const tri:number[]=[];for(let j=0;j<9;j+=3){const p=[native[i+j],native[i+j+1],native[i+j+2]] as Vec3,key=p.join(',');let id=ids.get(key);if(id===undefined){id=vertices.length;ids.set(key,id);vertices.push(p);}tri.push(id);}triangles.push(tri as [number,number,number]);const [a,b,c]=tri.map(id=>vertices[id]);area+=Math.hypot((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
    rows.push({name,facets:triangles.length,area,sourceArea:0.5,areaDifference:0.5-area,exactCoverage:exactSplitCoverage(vertices,triangles,[0,1,2],x=>x,()=>{})});
    if(['below','at','above'].includes(name)) {
      expect(() => assembleFiniteFaceMesh(new Float64Array([0,0,0,1,0,0,0,1,0]), [{ids:[0,1,2],boundaries:[],mesh:{vertices,triangles,constraints:[],boundaryVertices:[]}}], {preciseCoordinates:true})).toThrow(/coverage/i);
    }
  }
  expect(rows.slice(0,3).every(r=>!r.exactCoverage && r.areaDifference>0)).toBe(true);
  writeFileSync('C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-native-coverage-probe-20261105.json',JSON.stringify({scope:'retained binary STL coordinates, no new native run',rows},null,2));
});
