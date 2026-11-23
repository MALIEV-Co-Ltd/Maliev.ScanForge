import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMesh } from '../src/io';
import { runScanEdit } from '../src/scan-edit';

it('compares a diagnostic post-output first-seen point weld against retained native facets', () => {
  const root='C:/Users/Shoung/.codex/worktrees/m2-split-precision/Maliev.ScanForge/tests/fixtures/';
  const cases = [
    ['rotated','m2-native-rotated-dense-20261029','vertical-source.stl','grid-128.stl','native-rotated-result-20261029.stl'],
    ...['below','at','above'].map(x=>[x,'m2-split-point-radius','source-triangle.stl',`cutter-${x}.stl`,`native-${x}-20261029.stl`]),
    ...['below','above'].map(x=>[`wide-${x}`,'m2-split-wide-radius-20261029','source-triangle.stl',`cutter-near-0p001-${x}.stl`,`native-wide-radius-${x}-20261029.stl`]),
    ['convex','m2-native-convex-split-20261029','square-source.stl','convex-cutter.stl','native-convex-result-20261029.stl'],
    ['concave','m2-native-concave-split-20261029','square-source.stl','concave-cutter.stl','native-concave-result-20261029.stl'],
    ['cyclic','m2-native-cyclic-split-20261029','square-source-cyclic.stl','convex-cutter.stl','native-convex-cyclic-result-20261029.stl'],
  ];
  const facets=(values:ArrayLike<number>)=>Array.from({length:values.length/9},(_,i)=>[0,3,6].map(k=>[0,1,2].map(j=>Math.fround(values[9*i+k+j])).join(',')).sort().join('|'));
  const compare=(native:string[],actual:string[])=>{const remaining=[...native];let extra=0;for(const face of actual){const i=remaining.indexOf(face);if(i<0)extra++;else remaining.splice(i,1);}return {nativeMissing:remaining.length,extra};};
  const rows=[];
  for(const [name,dir,src,cut,nat] of cases) {
    const load=(file:string)=>{const b=readFileSync(`${root}${dir}/${file}`);return parseMesh(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'stl');};
    try {
      const source=load(src), target=load(cut), native=facets(load(nat));
      const result=runScanEdit({kind:'scanEdit',action:'split',positions:source,target}).positions!;
      const tree:number[][]=[];
      for(let i=0;i<source.length;i+=3){const p=Array.from(source.slice(i,i+3));if(!tree.some(q=>q.every((v,j)=>v===p[j])))tree.push(p);}
      const output:number[]=[], radius=Math.fround(Math.fround(1e-5)*10);let removed=0,reused=0;
      for(let i=0;i<result.length;i+=9){const points=[];for(let j=0;j<9;j+=3){const p=Array.from(result.slice(i+j,i+j+3),Math.fround);let found=tree.find(q=>Math.hypot(...q.map((v,k)=>v-p[k]))<=radius);if(found)reused++;else {found=p;tree.push(found);}points.push(found);}const [a,b,c]=points;const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)===0){removed++;continue;}output.push(...a,...b,...c);}
      rows.push({name, original:compare(native,facets(result)), welded:compare(native,facets(output)), removed,reused});
    } catch(error) { rows.push({name,error:String(error)}); }
  }
  expect(rows).toHaveLength(9);
  writeFileSync('C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-posthoc-weld-probe-20261105.json',JSON.stringify({scope:'diagnostic model only; not native algorithm or production change',rows},null,2));
});
