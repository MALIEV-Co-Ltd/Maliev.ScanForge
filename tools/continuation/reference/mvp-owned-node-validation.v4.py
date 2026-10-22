"""SOURCE ONLY until parent grants a validation window. Runs only pinned Node validation modes."""
import argparse, ctypes as C, ctypes.wintypes as W, hashlib, importlib.util, json, os
from pathlib import Path
import subprocess, sys, time

ROOT=Path(__file__).resolve().parent
PLAN=ROOT/'mvp-owned-node-validation-plan-20261017.json'
OUT=ROOT/'mvp-owned-node-validation-evidence'
VALIDATION_DEADLINE=None
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(65536),b''):
            if VALIDATION_DEADLINE is not None and time.monotonic()>VALIDATION_DEADLINE:raise TimeoutError('Overall validation lease expired')
            h.update(b)
    return h.hexdigest()
def save(path,data):path.write_text(json.dumps(data,indent=2),encoding='utf8')

def verify_source_receipt(plan):
    spec=plan['sourceReceipt'];assert sha(spec['path'])==spec['sha256'],'Source receipt identity'
    receipt=json.loads(Path(spec['path']).read_text(encoding='utf-8-sig'))
    assert receipt['tree']==plan['expectedTree'],'Source snapshot tree identity'
    assert receipt['sourceManifestSha256']==plan['expectedSourceManifestSha256'],'Source manifest content digest'
    root=Path(plan['cwd']).resolve();assert root==Path(receipt['snapshotPath']).resolve(),'Source snapshot location'
    expected={x['path'].replace('\\','/'):x for x in receipt['entries']}
    assert len(expected)<=10000,'Source receipt entry cap'
    for relative,row in expected.items():
        path=(root/relative).resolve();assert path.is_relative_to(root),'Source receipt path escaped snapshot'
        assert path.stat().st_size==row['bytes'] and sha(path)==row['sha256'],'Frozen validation input changed: '+relative
    actual=set()
    for name in plan['sourceRoots']:
        path=root/name
        if path.is_dir():
            for item in path.rglob('*'):
                if '.resources' in item.parts or 'node_modules' in item.parts:continue
                assert not item.is_symlink() and not item.is_junction(),'Unreviewed source reparse point'
                if item.is_file():actual.add(item.relative_to(root).as_posix())
        elif path.is_file():actual.add(name)
    assert actual==set(expected),'Source snapshot file additions/removals require a new reviewed receipt'

class MEMORY(C.Structure):
    _fields_=[('length',W.DWORD),('load',W.DWORD)]+[(s,C.c_ulonglong) for s in ('total','available','pageTotal','pageAvailable','virtualTotal','virtualAvailable','extended')]
class BASIC_LIMIT(C.Structure):
    _fields_=[('processTime',C.c_longlong),('jobTime',C.c_longlong),('flags',W.DWORD),('minWS',C.c_size_t),('maxWS',C.c_size_t),('active',W.DWORD),('affinity',C.c_size_t),('priority',W.DWORD),('scheduling',W.DWORD)]
class IO_COUNTERS(C.Structure):_fields_=[(x,C.c_ulonglong) for x in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
class EXTENDED_LIMIT(C.Structure):
    _fields_=[('basic',BASIC_LIMIT),('io',IO_COUNTERS),('processMemory',C.c_size_t),('jobMemory',C.c_size_t),('peakProcess',C.c_size_t),('peakJob',C.c_size_t)]
class CPU_LIMIT(C.Structure):_fields_=[('flags',W.DWORD),('rate',W.DWORD)]
class COMPLETION_PORT(C.Structure):_fields_=[('key',W.LPVOID),('port',W.HANDLE)]
class SECURITY(C.Structure):_fields_=[('length',W.DWORD),('descriptor',W.LPVOID),('inherit',W.BOOL)]
class STARTUP(C.Structure):
    _fields_=[('cb',W.DWORD),('reserved',W.LPWSTR),('desktop',W.LPWSTR),('title',W.LPWSTR)]+[(x,W.DWORD) for x in ('x','y','xSize','ySize','xChars','yChars','fill','flags')]+[('show',W.WORD),('reserved2Size',W.WORD),('reserved2',C.POINTER(C.c_ubyte)),('stdin',W.HANDLE),('stdout',W.HANDLE),('stderr',W.HANDLE)]
class STARTUP_EX(C.Structure):_fields_=[('startup',STARTUP),('attributes',W.LPVOID)]
class PROCESS_INFO(C.Structure):_fields_=[('process',W.HANDLE),('thread',W.HANDLE),('pid',W.DWORD),('tid',W.DWORD)]
class ACCOUNTING(C.Structure):
    _fields_=[(x,C.c_longlong) for x in ('user','kernel','periodUser','periodKernel')]+[(x,W.DWORD) for x in ('faults','totalProcesses','activeProcesses','terminatedProcesses')]

def main():
    global VALIDATION_DEADLINE
    VALIDATION_DEADLINE=time.monotonic()+720
    assert sys.platform=='win32','Windows required'
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--authorized-validation-window',action='store_true')
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--mode',choices=['build','focused','suite','kernel'],required=True)
    options=parser.parse_args()
    assert options.authorized_validation_window,'Parent must explicitly grant this validation window first'
    assert C.sizeof(C.c_void_p)==8 and C.sizeof(COMPLETION_PORT)==16,'Win64 completion association ABI'
    k=C.WinDLL('kernel32',use_last_error=True)
    signatures={
      'CreateIoCompletionPort':([W.HANDLE,W.HANDLE,C.c_size_t,W.DWORD],W.HANDLE),
      'GetQueuedCompletionStatus':([W.HANDLE,C.POINTER(W.DWORD),C.POINTER(C.c_size_t),C.POINTER(W.LPVOID),W.DWORD],W.BOOL),
      'GlobalMemoryStatusEx':([C.POINTER(MEMORY)],W.BOOL),
      'CreateJobObjectW':([W.LPVOID,W.LPCWSTR],W.HANDLE),
      'SetInformationJobObject':([W.HANDLE,C.c_int,W.LPVOID,W.DWORD],W.BOOL),
      'QueryInformationJobObject':([W.HANDLE,C.c_int,W.LPVOID,W.DWORD,W.LPVOID],W.BOOL),
      'AssignProcessToJobObject':([W.HANDLE,W.HANDLE],W.BOOL),
      'TerminateJobObject':([W.HANDLE,W.UINT],W.BOOL),
      'CloseHandle':([W.HANDLE],W.BOOL),
      'CreateFileW':([W.LPCWSTR,W.DWORD,W.DWORD,C.POINTER(SECURITY),W.DWORD,W.DWORD,W.HANDLE],W.HANDLE),
      'CreateProcessW':([W.LPCWSTR,W.LPWSTR,W.LPVOID,W.LPVOID,W.BOOL,W.DWORD,W.LPVOID,W.LPCWSTR,W.LPVOID,C.POINTER(PROCESS_INFO)],W.BOOL),
      'ResumeThread':([W.HANDLE],W.DWORD),
      'WaitForSingleObject':([W.HANDLE,W.DWORD],W.DWORD),
      'GetExitCodeProcess':([W.HANDLE,C.POINTER(W.DWORD)],W.BOOL),
      'GetProcessTimes':([W.HANDLE]+[C.POINTER(W.FILETIME)]*4,W.BOOL),
      'QueryFullProcessImageNameW':([W.HANDLE,W.DWORD,W.LPWSTR,C.POINTER(W.DWORD)],W.BOOL),
      'OpenProcess':([W.DWORD,W.BOOL,W.DWORD],W.HANDLE),
      'IsProcessInJob':([W.HANDLE,W.HANDLE,C.POINTER(W.BOOL)],W.BOOL),
      'InitializeProcThreadAttributeList':([W.LPVOID,W.DWORD,W.DWORD,C.POINTER(C.c_size_t)],W.BOOL),
      'UpdateProcThreadAttribute':([W.LPVOID,W.DWORD,C.c_size_t,W.LPVOID,C.c_size_t,W.LPVOID,W.LPVOID],W.BOOL),
      'DeleteProcThreadAttributeList':([W.LPVOID],None)}
    for name,(args,ret) in signatures.items():getattr(k,name).argtypes=args;getattr(k,name).restype=ret
    def must(ok,name):
        if not ok:raise OSError(C.get_last_error(),name)
    def admission(minimum=4096):
        m=MEMORY();m.length=C.sizeof(m);must(k.GlobalMemoryStatusEx(C.byref(m)),'GlobalMemoryStatusEx')
        assert minimum in (3072,4096),'Guard must remain3072 or4096MiB'
        assert m.available>=minimum*1048576,f'Unchanged{minimum}MiB guard rejected {m.available/1048576:.2f}MiB'
        return m.available
    def identity(handle,pid):
        ts=[W.FILETIME() for _ in range(4)];must(k.GetProcessTimes(handle,*[C.byref(t) for t in ts]),'GetProcessTimes')
        name=C.create_unicode_buffer(32768);length=W.DWORD(32768)
        must(k.QueryFullProcessImageNameW(handle,0,name,C.byref(length)),'QueryFullProcessImageNameW')
        return dict(pid=pid,startFileTime=str((ts[0].dwHighDateTime<<32)|ts[0].dwLowDateTime),executable=name.value)
    def preserve(job):
        for expected in plan['preservedProcesses']:
            handle=k.OpenProcess(0x1000,False,expected['pid']);must(handle,'preserve existing app process')
            try:
                actual=identity(handle,expected['pid'])
                assert actual['startFileTime']==expected['startFileTime'] and Path(actual['executable']).resolve()==Path(expected['executable']).resolve(),'Preserved app identity changed'
                belongs=W.BOOL();must(k.IsProcessInJob(handle,job,C.byref(belongs)),'verify preserved app outside exact Job')
                assert not belongs.value,'Existing user app must remain outside validation Job'
            finally:k.CloseHandle(handle)
    plan=json.loads(options.plan.read_text(encoding='utf-8-sig'))
    config=plan['modes'][options.mode]
    assert config['guardMiB']==(4096 if options.mode in ('build','kernel') else 3072),'Unchanged phase guard'
    admission(config['guardMiB'])
    OUT=Path(plan['outputPrefix']+'-'+options.mode).resolve()
    assert OUT.parent==ROOT and OUT.name.startswith('mvp-owned-node-'),'Owned off-repo output directory required'
    for row in plan['frozenInputs']+plan['toolsAndLibraries']:
        assert sha(row['path'])==row['sha256'],'Immutable input mismatch '+row['path']
    assert not OUT.exists(),'Output collision; retain evidence and use a separately reviewed new run directory'
    OUT.mkdir();ledger=dict(scope='Pinned Node validation mode with exact private Job ownership',parentPid=os.getpid(),overallLeaseSeconds=720,phases=[],completed=False,planPath=str(options.plan.resolve()),planSha256=sha(options.plan),mode=options.mode)
    own=k.OpenProcess(0x1000,False,os.getpid());must(own,'OpenProcess self')
    try:ledger['parentIdentity']=identity(own,os.getpid())
    finally:k.CloseHandle(own)
    def persist():save(OUT/'resource-ledger.json',ledger)
    persist()
    def phase(name,exe,args,config):
        row=dict(name=name,executable=exe,executableSha256=sha(exe),arguments=args,leaseSeconds=600,jobMemoryBytes=config['jobMiB']*1048576,cpuPercent=25,children=[])
        assert any(Path(x['path']).resolve()==Path(exe).resolve() and x['sha256']==row['executableSha256'] for x in plan['toolsAndLibraries']),'Exact tool executable hash not pinned'
        for x in plan['frozenInputs']+plan['toolsAndLibraries']:assert sha(x['path'])==x['sha256'],'Prephase immutable input mismatch '+x['path']
        ledger['phases'].append(row);persist()
        job=None;pi=PROCESS_INFO();handles=[];attributes=None;attributes_initialized=False;started=False;ended=False
        completion=None;completion_key=0x4e4f44454a4f42;seen={};retained={};new_seen=set();event_bytes=2
        row.update(jobEvents=[],captureErrors=[],completionPortClosed=False,observedHandleClosures=[],allObservedExited=False)
        def capture_events(wait_ms=0):
            nonlocal event_bytes
            assert isinstance(wait_ms,int) and 0<=wait_ms<=20,'Completion wait bound20ms'
            if not completion:return
            while True:
                message=W.DWORD();key=C.c_size_t();payload=W.LPVOID();C.set_last_error(0)
                available=k.GetQueuedCompletionStatus(completion,C.byref(message),C.byref(key),C.byref(payload),wait_ms)
                wait_ms=0
                if not available:
                    error=C.get_last_error()
                    if error==258 and not payload.value:break
                    raise OSError(error,'Owned Job completion dequeue')
                assert key.value==completion_key,'Unexpected private completion key'
                assert len(row['jobEvents'])<4096,'Job completion cap4096 exceeded'
                code=message.value;pid=int(payload.value or 0)
                names={1:'END_OF_JOB_TIME',2:'END_OF_PROCESS_TIME',3:'ACTIVE_PROCESS_LIMIT',4:'ACTIVE_PROCESS_ZERO',
                       6:'NEW_PROCESS',7:'EXIT_PROCESS',8:'ABNORMAL_EXIT_PROCESS',9:'PROCESS_MEMORY_LIMIT',10:'JOB_MEMORY_LIMIT'}
                event=dict(sequence=len(row['jobEvents']),observedMonotonicNs=time.monotonic_ns(),message=code,event=names.get(code,'OTHER'),payload=pid)
                try:
                    if code==6:
                        assert pid>0 and pid not in new_seen and len(new_seen)<1024,'Missing/duplicate/excess NEW_PROCESS'
                        new_seen.add(pid)
                        if pid==pi.pid:
                            child=pi.process;child_id=dict(row['identity']);event['primaryHandleReused']=True
                        else:
                            child=k.OpenProcess(0x1000|0x100000,False,pid);must(child,'retain NEW_PROCESS handle immediately')
                            retained[pid]=child
                            # Query start/path now; NO synchronous executable hashing in capture.
                            child_id=identity(child,pid)
                        event['identity']=dict(child_id)
                        member=W.BOOL();must(k.IsProcessInJob(child,job,C.byref(member)),'captured exact Job membership')
                        assert member.value,'Captured PID is not an exact private Job member'
                        matches=[x for x in plan['toolsAndLibraries'] if Path(x['path']).resolve()==Path(child_id['executable']).resolve()]
                        assert len(matches)==1,'Unexpected resolved private Job executable '+child_id['executable']
                        seen[pid]=child_id
                    elif code in (7,8):
                        assert pid in seen,'Exit event without retained exact NEW_PROCESS identity'
                    elif code==3:
                        event['attemptedActiveLimitEvent']=True
                        raise AssertionError('Active-limit event; opaque payload is not proof a child ran')
                    elif code!=4:
                        raise AssertionError('Time/memory/unknown Job completion event')
                except BaseException as error:
                    event['captureError']=repr(error);row['captureErrors'].append(repr(error))
                encoded=len(json.dumps(event).encode('utf8'))+1
                if event_bytes+encoded>1048576:
                    row['captureErrors'].append('Job event byte cap1MiB exceeded')
                    raise AssertionError('Job event byte cap1MiB exceeded')
                event_bytes+=encoded;row['jobEvents'].append(event);row['jobEventBytes']=event_bytes
            row['children']=list(seen.values());persist()
        def require_capture():
            assert not row['captureErrors'],'Private Job identity capture failed; retain exact event diagnostic'
        try:
            job=k.CreateJobObjectW(None,None);must(job,'CreateJobObject')
            preserve(job)
            assert config['jobMiB'] in (1024,2048,3072),'Reviewed private memory bound'
            limits=EXTENDED_LIMIT();limits.basic.flags=0x2000|0x100|0x200|8;limits.basic.active=64
            limits.processMemory=config['jobMiB']*1048576;limits.jobMemory=limits.processMemory
            must(k.SetInformationJobObject(job,9,C.byref(limits),C.sizeof(limits)),'private Job memory/process limit')
            cpu=CPU_LIMIT(1|4,2500);must(k.SetInformationJobObject(job,15,C.byref(cpu),C.sizeof(cpu)),'private Job CPU limit')
            completion=k.CreateIoCompletionPort(W.HANDLE(-1),None,0,1);must(completion,'owned completion port')
            association=COMPLETION_PORT(completion_key,completion)
            must(k.SetInformationJobObject(job,7,C.byref(association),C.sizeof(association)),'associate completion before assign/resume')
            row['completionAssociatedBeforeAssign']=True;persist()
            sec=SECURITY(C.sizeof(SECURITY),None,True)
            for path,access,creation in ((OUT/(name+'-stdout.log'),0x40000000,1),(OUT/(name+'-stderr.log'),0x40000000,1),('NUL',0x80000000,3)):
                h=k.CreateFileW(str(path),access,1,C.byref(sec),creation,0x80,None)
                assert h not in (None,C.c_void_p(-1).value),'CreateFile for exact logs';handles.append(h)
            si=STARTUP_EX();si.startup.cb=C.sizeof(si);si.startup.flags=0x100;si.startup.stdout=handles[0];si.startup.stderr=handles[1];si.startup.stdin=handles[2]
            needed=C.c_size_t();k.InitializeProcThreadAttributeList(None,1,0,C.byref(needed))
            attributes=C.create_string_buffer(needed.value);si.attributes=C.cast(attributes,W.LPVOID)
            must(k.InitializeProcThreadAttributeList(si.attributes,1,0,C.byref(needed)),'initialize explicit handle list')
            attributes_initialized=True
            inherited=(W.HANDLE*3)(*handles)
            must(k.UpdateProcThreadAttribute(si.attributes,0,0x20002,C.cast(inherited,W.LPVOID),C.sizeof(inherited),None,None),'restrict inherited handles')
            # Every child starts suspended; admission is rechecked immediately here.
            row['admittedFreeBytes']=admission(config['guardMiB']);persist()
            command=C.create_unicode_buffer(subprocess.list2cmdline([exe]+args))
            row['phaseStartUnixNs']=time.time_ns()
            must(k.CreateProcessW(exe,command,None,None,True,4|0x08000000|0x00080000,None,plan['cwd'],C.byref(si),C.byref(pi)),'CreateProcess suspended')
            started=True;row['identity']=identity(pi.process,pi.pid)
            assert Path(row['identity']['executable']).resolve()==Path(exe).resolve(),'actual Node executable identity'
            must(k.AssignProcessToJobObject(job,pi.process),'assign suspended tool to private Job')
            row['privateJobAssigned']=True;persist()
            capture_events();require_capture()
            admission(config['guardMiB']);must(k.ResumeThread(pi.thread)!=0xffffffff,'ResumeThread')
            deadline=min(time.monotonic()+600,VALIDATION_DEADLINE)
            while True:
                capture_events(20);require_capture()
                accounting=ACCOUNTING();must(k.QueryInformationJobObject(job,1,C.byref(accounting),C.sizeof(accounting),None),'Job accounting')
                if k.WaitForSingleObject(pi.process,0)==0 and accounting.activeProcesses==0:ended=True;break
                if time.monotonic()>=deadline:raise TimeoutError(name+' exact private Job lease expired')
                if any((OUT/(name+'-'+stream+'.log')).stat().st_size>16*1024*1024 for stream in ('stdout','stderr')):raise RuntimeError('Complete-log disk cap reached; outputs retained')
            capture_events();require_capture()
            # Hash only AFTER identity/event draining and actual Job exit. Every
            # observed resolved executable still needs its own exact path+SHA pin.
            verified_hashes={}
            for child_id in seen.values():
                path=Path(child_id['executable']).resolve()
                if path not in verified_hashes:verified_hashes[path]=sha(path)
                child_id['sha256']=verified_hashes[path]
                matches=[x for x in plan['toolsAndLibraries'] if Path(x['path']).resolve()==path]
                assert len(matches)==1 and child_id['sha256']==matches[0]['sha256'],'Unexpected actual executable hash '+str(path)
            row['children']=list(seen.values());persist()
            assert time.monotonic()<deadline,'Identity/hash validation exceeded unchanged phase lease'
            row['verifiedExited']=True
            for stream in ('stdout','stderr'):
                assert (OUT/(name+'-'+stream+'.log')).stat().st_size<=16*1024*1024,'Final complete-log disk cap exceeded; failed outputs retained'
            code=W.DWORD();must(k.GetExitCodeProcess(pi.process,C.byref(code)),'GetExitCodeProcess')
            row.update(exitCode=code.value,verifiedExited=True,totalJobProcesses=accounting.totalProcesses,allJobChildrenObserved=accounting.totalProcesses==len(seen)==len(new_seen) and pi.pid in seen and not row['captureErrors'])
            assert row['allJobChildrenObserved'],'Short-lived Job child identity unobserved; retain for review'
            assert code.value==0,name+' failed; complete logs retained'
        finally:
            cleanup_errors=[]
            try:
                if started and not ended:
                    if row.get('privateJobAssigned'):must(k.TerminateJobObject(job,124),'terminate exact private Job')
                    else:
                        # Sole owned suspended process; it has never been resumed.
                        k.TerminateProcess.argtypes=[W.HANDLE,W.UINT];k.TerminateProcess.restype=W.BOOL
                        must(k.TerminateProcess(pi.process,125),'terminate exact suspended tool')
                    must(k.WaitForSingleObject(pi.process,10000)==0,'await exact tool exit')
                    if row.get('privateJobAssigned'):
                        until=time.monotonic()+10
                        while True:
                            a=ACCOUNTING();must(k.QueryInformationJobObject(job,1,C.byref(a),C.sizeof(a),None),'cleanup Job accounting')
                            if not a.activeProcesses:break
                            assert time.monotonic()<until,'private Job cleanup incomplete'
                            time.sleep(.02)
                    row['verifiedExited']=True
            except Exception as error:cleanup_errors.append(str(error))
            try:
                capture_events()
                final_accounting=ACCOUNTING()
                if job:
                    must(k.QueryInformationJobObject(job,1,C.byref(final_accounting),C.sizeof(final_accounting),None),'final exact Job accounting')
                    row['finalJobAccounting']=dict(totalProcesses=final_accounting.totalProcesses,activeProcesses=final_accounting.activeProcesses)
                exits=[]
                for pid in seen:
                    handle=pi.process if pid==pi.pid else retained[pid]
                    exited=k.WaitForSingleObject(handle,0)==0;exits.append(exited)
                    exit_row=dict(identity=seen[pid],verifiedExited=exited)
                    if exited:
                        actual_code=W.DWORD();must(k.GetExitCodeProcess(handle,C.byref(actual_code)),'retained actual child exit')
                        exit_row['exitCode']=actual_code.value
                    row.setdefault('observedExits',[]).append(exit_row)
                row['allObservedExited']=bool(exits) and all(exits)
                if row.get('allJobChildrenObserved'):
                    row['allJobChildrenObserved']=(final_accounting.totalProcesses==len(seen)==len(new_seen) and not row['captureErrors'])
            except BaseException as error:cleanup_errors.append('Completion/exit proof: '+repr(error))
            for pid,handle in retained.items():
                closed=bool(k.CloseHandle(handle));row['observedHandleClosures'].append(dict(pid=pid,closed=closed))
                if not closed:cleanup_errors.append('Exact observed process handle closure failed: '+str(pid))
            if completion:
                row['completionPortClosed']=bool(k.CloseHandle(completion))
                if not row['completionPortClosed']:cleanup_errors.append('Owned completion port closure failed')
            try:
                if job:preserve(job)
            except Exception as error:cleanup_errors.append(str(error))
            if attributes_initialized:k.DeleteProcThreadAttributeList(C.cast(attributes,W.LPVOID))
            for h in [pi.thread,pi.process]+handles+([job] if job else []):
                if h and not k.CloseHandle(h):cleanup_errors.append('Owned handle close failure '+str(C.get_last_error()))
            if ended and row.get('exitCode')==0 and (not row.get('allJobChildrenObserved') or not row['allObservedExited'] or not row['completionPortClosed'] or row['captureErrors'] or not all('sha256' in x for x in seen.values())):cleanup_errors.append('Observed Job count/identity/hash/exit proof incomplete')
            row['handlesClosed']=not cleanup_errors;row['cleanupErrors']=cleanup_errors;persist()
            if cleanup_errors:raise RuntimeError('Exact Job cleanup requires review: '+repr(cleanup_errors))
    try:
        verify_source_receipt(plan)
        old=os.environ.get('NODE_OPTIONS')
        os.environ['NODE_OPTIONS']='--max-old-space-size='+str(config['heapMiB'])
        try:phase(options.mode,plan['nodeExecutable'],config['args'],config)
        finally:
            if old is None:os.environ.pop('NODE_OPTIONS',None)
            else:os.environ['NODE_OPTIONS']=old
        verify_source_receipt(plan)
        for row in plan['frozenInputs']+plan['toolsAndLibraries']:assert sha(row['path'])==row['sha256'],'Input changed during validation'
        ledger['completed']=True
        ledger['validationMeaning']='Exact pinned command returned0; inspect complete logs for build diagnostics/test counts/kernel assertions'
    except Exception as e:ledger['error']=str(e);raise
    finally:persist()

def struct_unpack_u32(buffer,offset):return int.from_bytes(buffer[offset:offset+4],'little')
if __name__=='__main__':main()
