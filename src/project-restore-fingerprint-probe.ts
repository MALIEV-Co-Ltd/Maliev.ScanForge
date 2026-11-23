import { sha256 } from '@noble/hashes/sha2.js';
export type Witness = {values:number[];digest:string};
export function fingerprint(values:ArrayLike<number>,check:()=>void=()=>{}):string {
  const started=performance.now();
  console.log(`M2_WORKER_TRACE ${JSON.stringify({event:'witness-start',length:values.length,at:Date.now()})}`);
  const hash=sha256.create(), bytes=new Uint8Array(65536*8), view=new DataView(bytes.buffer);
  for(let first=0;first<values.length;first+=65536) {
    check();
    const count=Math.min(65536,values.length-first);
    for(let i=0;i<count;i++) {
      const descriptor=Array.isArray(values) ? Object.getOwnPropertyDescriptor(values,String(first+i)) : undefined;
      if(Array.isArray(values) && (!descriptor || !('value' in descriptor)))throw Error('Project numeric data changed during restore.');
      const value=descriptor ? descriptor.value : values[first+i];
      if(typeof value!=='number'||!Number.isFinite(value))throw Error('Project numeric data changed during restore.');
      view.setFloat64(i*8,value,true);
    }
    hash.update(bytes.subarray(0,count*8));
  }
  const digest=Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('');
  console.log(`M2_WORKER_TRACE ${JSON.stringify({event:'witness-end',length:values.length,at:Date.now(),durationMs:performance.now()-started})}`);
  return digest;
}
export function captureWitness(values:number[]):Witness { return {values,digest:fingerprint(values)}; }
