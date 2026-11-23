import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMesh } from '../src/io';
import { runScanEdit } from '../src/scan-edit';
import { inspectFiniteTriangleContact } from '../src/scan-edit-general-split';
import type { Vec3 } from '../src/types';
it('records raw and rounded rotated contact and facet differences', () => {
  const root = 'tests/fixtures/m2-rotated-recovery-20261029/';
  const load = (name:string) => { const b=readFileSync(root+name); return parseMesh(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'stl'); };
  const source=load('vertical-source.stl'), cutter=load('grid-128.stl'), native=load('native-rotated-result-20261029.stl');
  const tri=(a:ArrayLike<number>, n:number)=>[0,3,6].map(k=>[0,1,2].map(j=>a[n*9+k+j])) as [Vec3,Vec3,Vec3];
  const contact=inspectFiniteTriangleContact(tri(source,1),tri(cutter,73),{preciseCoordinates:true});
  const output=runScanEdit({kind:'scanEdit',action:'split',positions:source,target:cutter}).positions!;
  const facets=(a:ArrayLike<number>)=>Array.from({length:a.length/9},(_,i)=>[0,3,6].map(k=>[0,1,2].map(j=>Math.fround(a[i*9+k+j]))).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y))));
  const remaining=facets(native), actual=facets(output), extra=[];
  for(const face of actual) { const index=remaining.findIndex(value=>JSON.stringify(value)===JSON.stringify(face)); if(index<0)extra.push(face);else remaining.splice(index,1); }
  expect(remaining).toHaveLength(0); expect(extra).toHaveLength(0);
  const area=(a:ArrayLike<number>)=>{let sum=0;for(let i=0;i<a.length;i+=9){const u=[0,1,2].map(j=>a[i+3+j]-a[i+j]);const v=[0,1,2].map(j=>a[i+6+j]-a[i+j]);sum+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return sum;};
  writeFileSync('C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-one-ulp-candidate-20261105.json',JSON.stringify({contact, rounded:contact.points.map(p=>p.map(Math.fround)),nativeMissing:remaining,appExtra:extra,sourceArea:area(source),nativeArea:area(native),appArea:area(output)},null,2));
});
