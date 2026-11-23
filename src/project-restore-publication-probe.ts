import { cacheScanRenderData, clearPreparedScanRenderData, scanRenderData, type ScanRenderData } from './scan-render-data';
import type { Positions } from './types';
import { fingerprint, type Witness } from './project-restore-fingerprint-probe';
export { captureWitness } from './project-restore-fingerprint-probe';
type Display = {positions:Positions;data:ScanRenderData};
const staged = new WeakMap<object,{witnesses:Witness[];displays:Display[]}>();
export function stageRestore(session:object,witnesses:Witness[],displays:Display[]=[]):void {
  staged.set(session,{witnesses,displays});
}
export function publishRestore<T>(session:object,publish:()=>T,check:()=>void=()=>{}):T {
  const pending=staged.get(session);
  if(pending) for(const entry of pending.witnesses) {
    check();
    if(fingerprint(entry.values,check)!==entry.digest)throw Error('Project numeric data changed during restore.');
  }
  check();
  const previous = pending?.displays.map(({positions}) => ({positions, data: scanRenderData(positions)})) ?? [];
  try {
    for(const display of pending?.displays ?? [])cacheScanRenderData(display.positions,display.data);
    const result=publish();
    staged.delete(session);
    return result;
  } catch(error) {
    for(const entry of previous) {
      if(entry.data) cacheScanRenderData(entry.positions,entry.data);
      else clearPreparedScanRenderData(entry.positions);
    }
    throw error;
  }
}
