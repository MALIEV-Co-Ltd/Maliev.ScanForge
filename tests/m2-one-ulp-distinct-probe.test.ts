import { expect, it } from 'vitest';
import { buildFiniteFaceInput } from '../src/scan-split-finite-face-input';
import type { Vec3 } from '../src/types';

it('keeps a distinct interior endpoint one Float32 step from a registered boundary contact', () => {
  const boundary: Vec3 = [0.5, 1, 0];
  const interior: Vec3 = [0.5, 1 + 2 ** -23, 0];
  const hit = {points:[interior, [0.5, 1.25, 0] as Vec3],coplanar:false,sourceEdges:[[],[]]};
  const registered = [{edge:[0,1] as [number,number],contacts:[{t:0.5,point:boundary,canonical:{t:0.5,reversed:false}}]}];
  const result=buildFiniteFaceInput([0,1,2],[hit],registered,{preciseCoordinates:true});
  expect(result.segments[0][0]).toEqual(interior);
  expect(result.endpointBindings).toEqual([]);
});
