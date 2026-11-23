import { it, expect } from "vitest";
import { unpackProjectTransport } from "../src/project-transport-hash-probe";
it("measures representative reused staging lifetimes", async () => {
  const lengths=[266108040,44896128,127929168,21541272].map(n=>n/8);
  const sources=lengths.map((n,i)=>new Array(n).fill(i+0.5));
  const entries=lengths.map((n,i)=>({ref:{},values:new Float64Array(n).fill(i+0.5)}));
  const packet={kind:"scanforge-numeric-transport-v1" as const,graph:{entries:entries.map(e=>e.ref)},numbers:entries};
  const snapshots:number[]=[];let i=0;
  const out=await unpackProjectTransport<{entries:number[][]}>(packet,{releaseOwnedNumericBuffers:true,reuseNumericArray:async()=>{snapshots.push(process.memoryUsage().arrayBuffers);return sources[i++];}});
  expect(out.entries.every((v,j)=>v===sources[j])).toBe(true);
  console.log(JSON.stringify({lengths,snapshots,after:process.memoryUsage().arrayBuffers}));
});
