"""Rebind observation-only helpers; retain the exact validated product and limits."""
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path('B:/codex/artifacts/native-scan-analysis/rea-inventory-fix')
PROPOSAL = Path(__file__).resolve().parent
OLD = ROOT/'alignment-original-three-ply-public-r5-indexed-display-prepared-20261020/capture'
NEW = ROOT/'alignment-original-three-ply-public-r6-import-diagnostic-r2-20261021/capture'
STARTED = time.monotonic()

def sha(p):
    digest = hashlib.sha256()
    with Path(p).open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            assert time.monotonic()-STARTED < 120
            digest.update(chunk)
    return digest.hexdigest()

def pin(p):
    p = Path(p)
    return dict(path=p.as_posix(), bytes=p.stat().st_size, sha256=sha(p))

def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def save(p, value):
    with Path(p).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

def admission():
    class Memory(C.Structure):
        _fields_ = [('length', W.DWORD), ('load', W.DWORD)] + [(n, C.c_uint64) for n in
            ('total','available','pageTotal','pageAvailable','virtualTotal','virtualAvailable','extended')]
    m = Memory(); m.length = C.sizeof(m)
    assert C.WinDLL('kernel32').GlobalMemoryStatusEx(C.byref(m)) and m.available >= 4096*1048576
    assert time.monotonic()-STARTED < 120

def identity():
    k = C.WinDLL('kernel32'); k.GetCurrentProcess.restype = W.HANDLE
    k.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(W.FILETIME)]*4
    times = [W.FILETIME() for _ in range(4)]
    assert k.GetProcessTimes(k.GetCurrentProcess(), *(C.byref(t) for t in times))
    return dict(pid=os.getpid(),startFileTime=str(times[0].dwLowDateTime | times[0].dwHighDateTime<<32), executable=sys.executable)

def main():
    admission()
    assert not NEW.exists(), 'Preserve prior attempts'
    proof = load(PROPOSAL/'inverse-proof.json')
    for row in proof['changes']:
        base = Path(row['basePath']).read_bytes()
        candidate = (PROPOSAL/row['path']).read_bytes()
        assert hashlib.sha256(candidate).hexdigest() == row['candidateSha256']
        text = candidate.decode('utf-8')
        for edit in reversed(row['replacements']):
            assert text.count(edit['new']) == 1
            text = text.replace(edit['new'],edit['old'])
        assert text.encode('utf-8') == base, row['path']
    receipt = load(OLD/'standalone-source-receipt.json')
    names = receipt['sourceRoots'] + ['import-attribution.mjs','import-attribution.fixture.mjs','current-browser-runtime.json']
    assert len(names) == len(set(names))
    NEW.mkdir(parents=True)
    ledger = dict(owner='root-R6-import-attribution-derivation',identity=identity(),leaseSeconds=120,
                  children=[],helpersRetained=0,productWrites=0,completed=False)
    try:
        for name in names:
            if name == 'browser-config.ACTUAL.json': continue
            source = PROPOSAL/name if (PROPOSAL/name).exists() else OLD/name
            assert source.is_file() and source.stat().st_size < 4194304
            with (NEW/name).open('xb') as output: output.write(source.read_bytes())
        syntax = NEW/'syntax.current.mjs'
        text = syntax.read_text()
        old = "const files=['public-ply-input.mjs'"
        assert text.count(old) == 1
        text = text.replace(old,"const files=['import-attribution.mjs','import-attribution.fixture.mjs','public-ply-input.mjs'")
        syntax.write_text(text, encoding='utf-8', newline='\n')

        def remap(value):
            if isinstance(value,list): return [remap(v) for v in value]
            if not isinstance(value,dict): return value
            if {'path','bytes','sha256'} <= value.keys():
                p = Path(value['path'])
                if p.parent == OLD and p.name in names:
                    return {**value,**pin(NEW/p.name)}
            return {k:remap(v) for k,v in value.items()}

        def unique(rows):
            result = {}
            for row in rows:
                p = row['path'].casefold()
                if p in result: assert result[p] == row, p
                result[p] = row
            return list(result.values())

        original_cfg = load(OLD/'browser-config.ACTUAL.json')
        cfg = remap(original_cfg)
        cfg['outputDirectory'] = (NEW/'browser-actual-r01').as_posix()
        cfg['harnessOutputs'] = [(NEW/'harness-output'/Path(p).name).as_posix() for p in original_cfg['harnessOutputs']]
        cfg['pins'] = unique(cfg['pins'] + [pin(NEW/n) for n in ('import-attribution.mjs','import-attribution.fixture.mjs')])
        for key in ('repo','dist','distEntries','buildManifest','buildLedger','buildPlan','buildStderr','prerequisites',
                    'acceptedR4Review','acceptedR14Review','actualLiveSourceReceipt','diagnosticSourceReceipt','originalPlySources','preservedProcesses'):
            assert cfg[key] == original_cfg[key],key
        save(NEW/'browser-config.ACTUAL.json',cfg)
        files = receipt['sourceRoots'] + ['import-attribution.mjs','import-attribution.fixture.mjs']
        entries = [dict(path=n,bytes=(NEW/n).stat().st_size,sha256=sha(NEW/n)) for n in files]
        digest = hashlib.sha256(json.dumps(entries,separators=(',',':')).encode()).hexdigest()
        new_receipt = dict(snapshotPath=NEW.as_posix(),tree='public-R6-import-diagnostic-'+digest,
                           sourceManifestSha256=digest,sourceRoots=files,entries=entries)
        save(NEW/'standalone-source-receipt.json',new_receipt)
        names.append('standalone-source-receipt.json')
        plan_paths = []
        for kind,driver in [('syntax','syntax.current.mjs'),('fixtures','probe-contract.fixture.mjs'),
                            ('gui-import','gui-import.fixed.fixture.mjs'),('attribution','import-attribution.fixture.mjs')]:
            plan = remap(load(OLD/('owned-node-'+('gui-import' if kind=='attribution' else kind)+'-plan.json')))
            assert (plan['modes']['focused']['guardMiB'],plan['modes']['focused']['heapMiB'],
                    plan['modes']['focused']['jobMiB'],plan['modes']['focused']['leaseSeconds']) == (3072,384,2048,600)
            plan.update(cwd=NEW.as_posix(),sourceRoots=files,sourceReceipt=pin(NEW/'standalone-source-receipt.json'),
                        expectedTree=new_receipt['tree'],expectedSourceManifestSha256=digest,
                        owner='R6-import-diagnostics-'+kind,status='OBSERVATION_ONLY_UNRUN',
                        outputPrefix=(ROOT/('mvp-owned-node-original-three-ply-public-r6r2-diagnostic-'+kind)).as_posix())
            plan['modes']['focused']['args']=['--max-old-space-size=384',(NEW/driver).as_posix()]
            plan['frozenInputs']=unique(plan['frozenInputs']+[pin(NEW/n) for n in ('import-attribution.mjs','import-attribution.fixture.mjs')])
            destination = NEW/('owned-node-'+kind+'-plan.json'); save(destination,plan); plan_paths.append(pin(destination))
        original = load(OLD/'public-profile-plan.ACTUAL.json')
        plan = remap(original)
        for key in ('cwd','expectedTree','expectedSourceManifestSha256','sourceRoots','sourceReceipt','preservedProcesses','requiredRunner','additionalParentAdmissionMiB'):
            assert plan[key] == original[key],key
        assert plan['additionalParentAdmissionMiB'] == 5376
        assert (plan['modes']['kernel']['guardMiB'],plan['modes']['kernel']['heapMiB'],plan['modes']['kernel']['jobMiB'],plan['modes']['kernel']['leaseSeconds']) == (4096,384,2048,600)
        plan['modes']['kernel']['args']=[(NEW/'run-original-three-ply-cli.mjs').as_posix(),(NEW/'browser-config.ACTUAL.json').as_posix()]
        plan.update(owner='R6-observation-only-full-original-three-PLY',status='OBSERVATION_ONLY_UNRUN',
                    outputPrefix=(ROOT/'mvp-owned-node-original-three-ply-public-r6r2-import-diagnostic').as_posix())
        plan['frozenInputs']=unique(plan['frozenInputs']+[pin(NEW/n) for n in ('import-attribution.mjs','import-attribution.fixture.mjs')])
        save(NEW/'public-profile-plan.ACTUAL.json',plan); plan_paths.append(pin(NEW/'public-profile-plan.ACTUAL.json'))
        for row in cfg['pins']:
            actual = pin(row['path'])
            assert Path(actual['path']).resolve() == Path(row['path']).resolve()
            assert all(actual[key] == row[key] for key in ('bytes','sha256'))
        for row in plan_paths:
            assert pin(row['path']) == row
        assert load(NEW/'public-run.ACTUAL.json') == load(OLD/'public-run.ACTUAL.json')
        save(NEW/'ROOT-REVIEWED-DERIVATION.json',dict(status='OBSERVATION_ONLY_BOUND_VALIDATION_UNRUN',
             originalProductUnchanged=True,nativeAcceptance=False,originalBuild=cfg['buildManifest'],plans=plan_paths,
             inverseProof=pin(PROPOSAL/'inverse-proof.json'),deriver=pin(__file__)))
        ledger['completed']=True
    except BaseException as error:
        ledger['error']=repr(error); raise
    finally:
        ledger['elapsedSeconds']=time.monotonic()-STARTED
        save(NEW/'derivation-resource-terminal.json',ledger)
    print(json.dumps(dict(status='R6_DIAGNOSTIC_DERIVED_UNRUN',path=NEW.as_posix(),plans=len(plan_paths))))

if __name__ == '__main__': main()
