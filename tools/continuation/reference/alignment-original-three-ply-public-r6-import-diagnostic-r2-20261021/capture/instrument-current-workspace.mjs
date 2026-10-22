import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const anchor='  current.current = host;';
export const injection='\n  (globalThis as typeof globalThis & { __scanforgeThreePlyBorrow?: { register(getter: () => ReturnType<WorkspaceHost["snapshot"]>): void } }).__scanforgeThreePlyBorrow?.register(() => current.current.snapshot());';
export function instrumentCurrentWorkspace(bytes,expectedSha256){
  assert(Buffer.isBuffer(bytes));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedSha256,'Exact uninstrumented parent pin required');
  const text=bytes.toString('utf8');assert(Buffer.from(text).equals(bytes),'UTF8 byte roundtrip');
  assert.equal(text.split(anchor).length,2,'Unique current host assignment required');
  assert(!text.includes('__scanforgeThreePlyBorrow'),'No pre-existing diagnostic hook');
  const output=Buffer.from(text.replace(anchor,anchor+injection));
  assert(Buffer.from(output.toString('utf8').replace(injection,'')).equals(bytes),'Removing ONLY declared injection must recover parent bytes');
  return {output,proof:{parentSha256:expectedSha256,postimageSha256:createHash('sha256').update(output).digest('hex'),injection,exactOneHunkInverse:true,computeStatementsChanged:0}};
}
