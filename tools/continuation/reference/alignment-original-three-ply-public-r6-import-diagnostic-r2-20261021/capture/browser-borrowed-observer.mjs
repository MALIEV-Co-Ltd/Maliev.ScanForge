// Serialized by Playwright.addInitScript before the diagnostic application loads.
// Owns only a getter, weak identities, scalar records and exact event listeners.
export function installBorrowedThreePlyObserver(config){
  const key='__scanforgeThreePlyBorrow',Original=globalThis.Worker;
  if(globalThis[key])throw Error('Duplicate diagnostic installation');
  let getter,closing,closed=false,failure=null,sequence=0,objectId=0,workerId=0,epoch='startup';
  const identities=new WeakMap(),listeners=new Map(),pending=new Set(),records=[];
  const limit=config.leaseMs;
  if(!Number.isSafeInteger(limit)||limit<=0||limit>240000)throw Error('Diagnostic finite lease required');
  const deadline=Date.now()+limit;
  const check=()=>{if(closed||Date.now()>deadline)throw Error('Diagnostic reader closed/expired')};
  const note=error=>{failure??=String(error).slice(0,240)};
  const bits=value=>{if(typeof value!=='number')throw Error('Numeric scalar required');const b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,value,false);return v.getBigUint64(0,false).toString(16).padStart(16,'0')};
  const id=value=>{if(!identities.has(value)){if(++objectId>256)throw Error('Weak carrier identity bound');identities.set(value,objectId)}return identities.get(value)};
  function emit(row){
    // Never throw, await, stop or redispatch a production message.
    try{
      if(closed)return;
      if(Date.now()>deadline)throw Error('Observer lease expired');
      if(records.length>=512||pending.size>=32)throw Error('Observer metadata/pending bound');
      const wire={sequence:++sequence,epoch,unixMs:Date.now(),...row};
      if(JSON.stringify(wire).length>60000)throw Error('Observer record60KiB bound');
      records.push(wire);
      const task=Promise.resolve(globalThis.__scanforgePublicPlyEvent(wire));pending.add(task);
      task.then(ack=>{if(ack?.recorded!==true)note('Observer sink refused metadata')},note).finally(()=>pending.delete(task));
    }catch(error){note(error)}
  }
  const state=s=>({id:s.id,pointCount:s.pointCount,matrixBits:s.matrix.map(bits),meanBits:bits(s.mean),stdBits:bits(s.std),converged:s.converged,stable:s.stable});
  function outgoing(data,record){
    if(record.kind==='scene'&&Array.isArray(data?.scans)){
      if(data.scans.length!==3)throw Error('Three actual scene sources required');
      emit({event:'scene-input',workerId:record.identity,settings:{radiusBits:bits(data.radius),spacing:data.spacing,budget:data.budget,mask:data.mask},sources:data.scans.map(scan=>({id:scan.id,pointCount:scan.geometry.points.length/3,normalFirstBits:bits(scan.geometry.normals[0]),flagsPresent:scan.geometry.flags!==undefined,rawTargetCount:scan.geometry.rawTargetIds?.length??null,meshes:scan.geometry.targetMeshes?.map(mesh=>({vertices:mesh.vertices.length/3,triangles:mesh.triangles.length/3}))??[]}))});
    }
    if(record.kind!=='controller'||data?.kind!=='start')return;
    const input=data.input;
    if(!Array.isArray(input?.scans)||input.scans.length!==3)throw Error('Exact public three-scan start required');
    emit({event:'controller-start',workerId:record.identity,runId:data.runId,settings:{radiusBits:bits(data.radius),mode:data.mode,parallel:data.parallel,localToleranceBits:bits(data.localTolerance),coverageToleranceBits:bits(data.coverageTolerance),spacing:input.spacing,budget:input.budget,mask:input.mask},sources:input.scans.map(scan=>({id:scan.id,pointCount:scan.geometry.points.length/3})),externalReservedBytes:data.externalReservedBytes,metadataReservedBytes:data.metadataReservedBytes,expectedWorkers:data.expectedWorkers});
  }
  function incoming(data,record){
    if(record.kind==='scene'&&data?.result){
      const result=data.result;
      if(!Array.isArray(result.clocks)||result.clocks.length!==3)throw Error('Actual three source clocks required');
      let total=0;
      for(let source=0;source<3;source++){
        const clocks=result.clocks[source];if(!Array.isArray(clocks)||(total+=clocks.length)>65536)throw Error('Clock record bound');
        for(let offset=0;offset<clocks.length;offset+=256)emit({event:'scene-clock-chunk',workerId:record.identity,source,offset,total:clocks.length,bits:clocks.slice(offset,offset+256).map(bits)});
      }
      emit({event:'scene-result',workerId:record.identity,clockCounts:result.clocks.map(c=>c.length)});
    }
    if(record.kind!=='controller')return;
    if(data?.kind==='ready')emit({event:'controller-ready',workerId:record.identity,capability:data.capability});
    if(data?.kind==='rpc'&&data.action==='pass'){
      if(!Array.isArray(data.ordered)||data.ordered.length!==3)throw Error('Three pass states required');
      emit({event:'controller-pass',workerId:record.identity,runId:data.runId,pass:data.pass,ordered:data.ordered.map(state)});
    }
    if(data?.kind==='result'){
      const outer=data.result?.outer;
      if(!outer||outer.states?.length!==3||outer.applications?.length!==6)throw Error('Actual public controller result shape');
      emit({event:'controller-result',workerId:record.identity,runId:data.runId,childrenCloseRequested:data.childrenCloseRequested,outer:{passes:outer.passes,order:outer.order,gaugeId:outer.gaugeId,seedBits:bits(outer.seed),states:outer.states.map(state),applications:outer.applications.map(a=>({id:a.id,matrixBits:a.matrix.map(bits)}))}});
    }
    if(data?.kind==='failed')emit({event:'controller-failed',workerId:record.identity,runId:data.runId,error:String(data.error).slice(0,240),childrenCloseRequested:data.childrenCloseRequested});
  }
  const workers=[];globalThis.__globalAlignmentWorkerEvidence=workers;
  const classify=url=>{const path=new URL(String(url),location.href).pathname;return path===config.scenePath?'scene':path===config.controllerPath?'controller':'ordinary'};
  class ObservedWorker extends Original{
    constructor(url,options){
      super(url,options);
      try{
        const record={identity:++workerId,url:String(url),name:options?.name,createdAt:Date.now(),terminatedAt:null,kind:classify(url)};
        if(workerId>64){note('Worker identity bound');return}workers.push(record);
        const basename=new URL(String(url),location.href).pathname.split('/').pop();
        emit({event:'worker-created',workerId:record.identity,kind:record.kind,basename:/^[A-Za-z0-9_.-]{1,160}$/.test(basename)?basename:'unavailable'});
        const listener=event=>{try{incoming(event.data,record)}catch(error){note(error)}};
        this.addEventListener('message',listener);listeners.set(this,{listener,record});
      }catch(error){note(error)}
    }
    postMessage(){const owned=listeners.get(this);try{if(owned)outgoing(arguments[0],owned.record)}catch(error){note(error)};return Reflect.apply(Original.prototype.postMessage,this,arguments)}
    terminate(){const owned=listeners.get(this);const result=Reflect.apply(Original.prototype.terminate,this,arguments);if(owned){owned.record.terminatedAt??=Date.now();emit({event:'worker-termination-request',workerId:owned.record.identity,kind:owned.record.kind});try{this.removeEventListener('message',owned.listener);listeners.delete(this)}catch(error){note(error)}}return result}
  }
  globalThis.Worker=ObservedWorker;
  const carriers={positions:e=>e.positions,indexedPositions:e=>e.indexedMesh?.vertices,triangles:e=>e.indexedMesh?.triangles,indexedNormals:e=>e.indexedMesh?.normals,renderNormals:e=>e.normals};
  function borrow(entityId,carrier,fn){
    check();let snapshot,entity,values;
    try{snapshot=getter?.();if(!snapshot||snapshot.entities.length!==3)throw Error('Three current entities required');entity=snapshot.entities.find(e=>e.id===entityId);if(!entity||!carriers[carrier])throw Error('Current carrier identity absent');values=carriers[carrier](entity);const expected=carrier==='triangles'?Uint32Array:Float32Array;if(!(values instanceof expected))throw Error('Exact Float32Array/Uint32Array carrier required; no diagnostic conversion');return fn(values,{entityId,carrier,scalarCount:values.length,token:id(values),sourceKind:values.constructor.name});}
    finally{values=entity=snapshot=undefined}
  }
  async function drain(){
    let timeout;
    try{await Promise.race([Promise.allSettled([...pending]),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Diagnostic sink cleanup5000ms deadline')),5000)})])}
    finally{clearTimeout(timeout)}
  }
  const api={
    register(fn){if(closed)return;if(typeof fn!=='function')throw Error('Borrowed getter required');getter=fn},
    setEpoch(value){check();if(typeof value!=='string'||value.length>80)throw Error('Epoch bound');epoch=value},
    importMetadata(){check();let snapshot;try{snapshot=getter?.();const entities=snapshot?.entities??[];if(entities.length>3)throw Error('Import entity bound');return entities.map(e=>({positionScalars:e.positions?.length??null,normalScalars:e.normals?.length??null,indexedVertexScalars:e.indexedMesh?.vertices?.length??null,triangleIndices:e.indexedMesh?.triangles?.length??null,indexedNormalScalars:e.indexedMesh?.normals?.length??null}))}finally{snapshot=undefined}},
    describe(entityId,carrier){return borrow(entityId,carrier,(_values,meta)=>meta)},
    read({entityId,carrier,token,offset,scalarCount,count}){
      return borrow(entityId,carrier,(values,meta)=>{
        if(meta.token!==token||meta.scalarCount!==scalarCount)throw Error('Carrier changed during bounded observation');
        if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<0||count<1||count>16384||offset+count>values.length)throw Error('64KiB slice bound');
        const array=carrier==='triangles'?new Uint32Array(count):new Float32Array(count);
        array.set(values.subarray(offset,offset+count));
        const bytes=new Uint8Array(array.buffer);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
        return {...meta,offset,count,base64:btoa(binary)};
      });
    },
    async flush(){await drain();if(failure)throw Error(failure);return {records:records.length,failure}},
    close(){if(closing)return closing;closed=true;clearTimeout(timer);getter=undefined;for(const [worker,{listener}] of listeners){try{worker.removeEventListener('message',listener)}catch(error){note(error)}}listeners.clear();if(globalThis.Worker===ObservedWorker)globalThis.Worker=Original;if(globalThis[key]===api)delete globalThis[key];closing=(async()=>{await drain();if(failure)throw Error(failure)})();return closing}
  };
  const timer=setTimeout(()=>{note('Observer lease expired');api.close().catch(note)},limit);
  globalThis[key]=api;
}
