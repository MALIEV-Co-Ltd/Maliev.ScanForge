import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { collectFiniteCutterHits } from '../src/scan-edit-general-split';
import { buildSparseFiniteEdgeContactsIndexed } from '../src/scan-split-finite-edges';
import { buildFiniteFaceInput } from '../src/scan-split-finite-face-input';

it('retains a distinct seam endpoint on a real two-triangle cutter', () => {
  const y=1+2**-23;
  const vertices=new Float64Array([0,1,0,1,1,0,0,2,0]);
  const triangles=new Uint32Array([0,1,2]);
  const cutter=new Float64Array([0.5,y,-1,0.5,y,1,0.5,0,-1, 0.5,y,1,0.5,y,-1,0.5,2,-1]);
  const collected=collectFiniteCutterHits(vertices,triangles,cutter,{preciseCoordinates:true});
  const registered=buildSparseFiniteEdgeContactsIndexed(vertices,triangles,collected.contacts,{preciseCoordinates:true});
  const hits=collected.faces.get(0)!;
  const result=buildFiniteFaceInput([0,1,2],hits,registered.get(0)??[],{preciseCoordinates:true});
  writeFileSync('C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-adjacent-seam-control-20261105.json',JSON.stringify({y,cutter:Array.from(cutter),hits,segments:result.segments,bindings:result.endpointBindings},null,2));
  const face0=[0,3,6].map(i=>Array.from(cutter.slice(i,i+3)).join(','));
  const face1=[9,12,15].map(i=>Array.from(cutter.slice(i,i+3)).join(','));
  expect(face0.filter(p=>face1.includes(p))).toHaveLength(2);
  expect(hits).toHaveLength(2);
  expect(hits.every(hit=>hit.points.some(p=>p[1]===y))).toBe(true);
  expect(hits.some(hit=>hit.points.some(p=>p[1]===y))).toBe(true);
  expect(result.segments.some(segment=>segment.some(p=>p[1]===y))).toBe(true);
});
