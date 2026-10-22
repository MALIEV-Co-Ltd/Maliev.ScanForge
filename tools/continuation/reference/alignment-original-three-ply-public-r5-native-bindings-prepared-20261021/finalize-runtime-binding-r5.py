"""Metadata-only public R5 rebind. Never starts a child, native module, or test.

Root supplies immutable ACTUAL capture pins after reviewing the public capture.
Every retained producer/controller/setter algorithm and helper remains unchanged.
"""
import copy
import ctypes as C
import hashlib
import json
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
BASE = HERE.parent / 'alignment-original-three-ply-public-r2-gui-import-proposed-20261020' / 'runtime-binding-r1'
OUT = HERE / 'runtime-binding-r5'
STARTED = time.monotonic()
BASE_SEAL_SHA = 'b80ea3aceab99a26984e6a5da2eb231db4d6a5bde14ddd48bfb2116fb00b8332'
BASE_MANIFEST_SHA = 'aac8d3f7a3415b83d669d6e47039cc26ba316d43a89fb3980b9de157c22d73ed'
POST_PLY_PARENT_SHA = '7312af61e9e47d81d0a87f7b70a7eeb4440dfe7196117aea3b325bfd12461725'
SERVER = dict(pid=50388, port=5173, executable='C:/Program Files/nodejs/node.exe',
              startFileTime='134370496637591985')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def guard():
    require(time.monotonic() - STARTED < 300, 'Metadata 300-second lease expired')
    class Memory(C.Structure):
        _fields_ = [('length', C.c_ulong), ('load', C.c_ulong)] + [(key, C.c_uint64) for key in
                    ('total', 'available', 'pageTotal', 'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]
    value = Memory(); value.length = C.sizeof(value)
    require(C.WinDLL('kernel32', use_last_error=True).GlobalMemoryStatusEx(C.byref(value)) and
            value.available >= 4096 * 1048576, 'Unchanged 4096 MiB metadata admission')


def verify_server(lease):
    require(lease['pid'] == SERVER['pid'] and lease['port'] == SERVER['port'] and
            Path(lease['executable']).resolve() == Path(SERVER['executable']).resolve() and
            lease['binding'] == '127.0.0.1', 'Reviewed loopback preview lease mismatch')
    kernel = C.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = (C.c_ulong, C.c_int, C.c_ulong)
    kernel.OpenProcess.restype = C.c_void_p
    kernel.GetProcessTimes.argtypes = (C.c_void_p,) + (C.POINTER(C.c_uint64),) * 4
    kernel.GetProcessTimes.restype = C.c_int
    kernel.QueryFullProcessImageNameW.argtypes = (C.c_void_p, C.c_ulong, C.c_wchar_p, C.POINTER(C.c_ulong))
    kernel.QueryFullProcessImageNameW.restype = C.c_int
    kernel.CloseHandle.argtypes = (C.c_void_p,)
    kernel.CloseHandle.restype = C.c_int
    handle = kernel.OpenProcess(0x1000, False, SERVER['pid'])
    require(handle, 'Preserved server identity cannot be observed')
    try:
        created, exited, system, user = (C.c_uint64() for _ in range(4))
        require(kernel.GetProcessTimes(handle, C.byref(created), C.byref(exited), C.byref(system), C.byref(user)),
                'Preserved server start time unavailable')
        require(str(created.value) == SERVER['startFileTime'] and exited.value == 0, 'Preserved server PID reused or exited')
        buffer = C.create_unicode_buffer(32768); length = C.c_ulong(len(buffer))
        require(kernel.QueryFullProcessImageNameW(handle, 0, buffer, C.byref(length)) and
                Path(buffer.value).resolve() == Path(SERVER['executable']).resolve(), 'Preserved server executable mismatch')
    finally:
        require(kernel.CloseHandle(handle), 'Read-only server handle cleanup failed')


def pin(file):
    file = Path(file).resolve()
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        while block := stream.read(65536):
            require(time.monotonic() - STARTED < 300, 'Metadata hash lease expired')
            digest.update(block)
    return dict(path=file.as_posix(), bytes=file.stat().st_size, sha256=digest.hexdigest())


def same(left, right):
    return (Path(left['path']).resolve() == Path(right['path']).resolve() and
            left['bytes'] == right['bytes'] and left['sha256'] == right['sha256'])


def check(value):
    require(isinstance(value, dict) and Path(value['path']).is_absolute(), 'Absolute immutable pin required')
    require(type(value['bytes']) is int and value['bytes'] > 0 and
            isinstance(value['sha256'], str) and len(value['sha256']) == 64 and
            all(c in '0123456789abcdef' for c in value['sha256']), 'Complete bytes/SHA256 pin required')
    require(same(pin(value['path']), value), 'Immutable pin changed: ' + value['path'])


def read(value):
    check(value)
    require(value['bytes'] <= 4 * 1048576, 'JSON 4 MiB bound')
    return json.loads(Path(value['path']).read_text(encoding='utf-8-sig'))


def write(file, value):
    data = json.dumps(value, sort_keys=True, indent=2).encode('utf-8') + b'\n'
    require(len(data) <= 4 * 1048576, 'Metadata 4 MiB bound')
    with Path(file).open('xb') as stream:
        stream.write(data)
    return pin(file)


def unique(values):
    result = {}
    for value in values:
        key = str(Path(value['path']).resolve()).casefold()
        require(key not in result or same(result[key], value), 'Conflicting immutable pin')
        result[key] = value
    return list(result.values())


def clean(ledger, plan_pin, plan):
    require(ledger['planSha256'] == plan_pin['sha256'] and ledger['mode'] == 'kernel' and
            ledger['completed'] is True and len(ledger['phases']) == 1, 'Actual exact-plan kernel terminal required')
    phase = ledger['phases'][0]
    require(phase['exitCode'] == 0 and phase['finalJobAccounting']['activeProcesses'] == 0 and
            phase['captureErrors'] == [] and phase['cleanupErrors'] == [] and
            phase['arguments'] == plan['modes']['kernel']['args'], 'Unclean or mismatched public kernel phase')
    for key in ('verifiedExited', 'allObservedExited', 'allJobChildrenObserved', 'handlesClosed', 'completionPortClosed'):
        require(phase[key] is True, 'Public cleanup not proven: ' + key)


def derive(file, edits, proof):
    original = file.read_bytes()
    source = original.decode('utf-8')
    newline = '\r\n' if '\r\n' in source else '\n'
    changes = []
    for before, after in edits:
        before = before.replace('\r\n', '\n').replace('\n', newline)
        after = after.replace('\r\n', '\n').replace('\n', newline)
        require(source.count(before) == 1, 'Missing/ambiguous exact rebind: ' + before[:100])
        source = source.replace(before, after, 1)
        changes.append(dict(before=before, after=after))
    inverse = source
    for change in reversed(changes):
        require(inverse.count(change['after']) == 1, 'Ambiguous rebind inverse')
        inverse = inverse.replace(change['after'], change['before'], 1)
    require(inverse.encode('utf-8') == original, 'Exact byte inverse failed')
    target = OUT / file.name
    with target.open('xb') as stream:
        stream.write(source.encode('utf-8'))
    proof.append(dict(basis=pin(file), candidate=pin(target), inverseBytesExact=True, changes=changes))
    return pin(target)


def main():
    guard()
    require(len(sys.argv) == 3 and sys.argv[2] == '--root-reviewed-actual-public-r5',
            'Usage: finalize-runtime-binding-r5.py reviewed-public-r5.ACTUAL.json --root-reviewed-actual-public-r5')
    require(not OUT.exists(), 'Exclusive runtime-binding-r5; preserve any partial package for review')
    review_pin = pin(sys.argv[1]); review = read(review_pin)
    require(review.get('status') == 'ROOT_REVIEWED_ACTUAL_PUBLIC_R5_BINDING' and
            review.get('rootReviewed') is True and review.get('nativeAcceptance') is False,
            'Explicit root review and native-unrun authority required')
    required = ('publicPlan', 'publicConfig', 'publicRun', 'parentSourceReceipt', 'diagnosticSourceReceipt',
                'diagnosticBuildReceipt', 'publicEvidence', 'publicEvents', 'publicLedger', 'previewLease')
    for key in required:
        check(review[key])
    require(review['parentSourceReceipt']['sha256'] == POST_PLY_PARENT_SHA,
            'Only reviewed packed-PLY dbb3994 committed parent source receipt')
    require(read(review['parentSourceReceipt']).get('head') == 'ba4804435ede15040a3d4198f7c4ff65ba055757',
            'Exact current packed-PLY product head required')
    require(pin(BASE / 'seal.json')['sha256'] == BASE_SEAL_SHA and
            pin(BASE / 'source-manifest.json')['sha256'] == BASE_MANIFEST_SHA, 'Reviewed R1 basis changed')
    seal = read(pin(BASE / 'seal.json')); manifest = read(pin(BASE / 'source-manifest.json'))
    for value in seal['files'] + [seal['authorityTemplate'], seal['sourceManifest'], seal['proof']]:
        check(value)
    # Full retained source and original native-image verification, streamed and bounded.
    for value in manifest['pins'] + list(manifest['roles'].values()):
        check(value)
    config, run, plan = (read(review[key]) for key in ('publicConfig', 'publicRun', 'publicPlan'))
    require(same(config['publicRun'], review['publicRun']), 'Actual config/run chain mismatch')
    for key in ('parentSourceReceipt', 'diagnosticSourceReceipt', 'diagnosticBuildReceipt'):
        require(same(run[key], review[key]), 'Actual public source/build authority mismatch: ' + key)
    require(same(plan['sourceReceipt'], review['diagnosticSourceReceipt']), 'Public plan diagnostic source mismatch')
    require(review['publicPlan']['sha256'] != manifest['roles']['publicPlan']['sha256'] and
            review['publicConfig']['sha256'] != manifest['roles']['publicConfig']['sha256'] and
            not same(review['parentSourceReceipt'], read(manifest['roles']['publicRun'])['parentSourceReceipt']),
            'Fresh post-PLY R3 authority required; old R2 authority is forbidden')
    require(plan['preservedProcesses'] == [SERVER], 'Only reviewed 50388 exact preserved server tuple')
    verify_server(read(review['previewLease']))
    require(any(Path(arg).resolve() == Path(review['publicConfig']['path']).resolve()
                for arg in plan['modes']['kernel']['args']), 'Public plan must execute actual config')
    require(Path(review['publicLedger']['path']).resolve() ==
            (Path(plan['outputPrefix'] + '-kernel') / 'resource-ledger.json').resolve(), 'Exact owned public ledger')
    clean(read(review['publicLedger']), review['publicPlan'], plan)
    evidence = read(review['publicEvidence'])
    require(evidence['passed'] is True and evidence['completed'] is True, 'Actual completed public capture required')
    require(review['publicEvents']['bytes'] <= 16 * 1048576, 'Events 16 MiB bound')
    old_run = read(manifest['roles']['publicRun'])
    require(run['sources'] == old_run['sources'] and same(run['nativeNormalDistinction'], manifest['roles']['normalDistinction']),
            'Original three complete PLY sources and normal authority must remain exact')
    for source in run['sources']:
        check(source)
    guard()
    OUT.mkdir()
    proof = []
    public_edits = [
        ("const approvedPlan = path.resolve(here, '../public-profile-plan.ACTUAL.json');", "const approvedPlan = path.resolve(manifest.roles.publicPlan.path);"),
        ("assert.equal(cfg.publicPlan.sha256, '4bc54b998c7c60bfa1067729aa803995236f9ad01ebfa701bbd0f86364356d79', 'Only root-approved publicR2 plan; futureR3 needs reviewed rebind');",
         "assert.equal(cfg.publicPlan.sha256, '" + review['publicPlan']['sha256'] + "', 'Only root-reviewed ACTUAL publicR5 plan');"),
        ("assert.equal(path.resolve(cfg.publicEvidence.path), path.resolve(here, '../harness-output/evidence.json'));", "assert.deepEqual(cfg.publicEvidence, manifest.roles.publicEvidence);"),
        ("assert.equal(path.resolve(cfg.publicEvents.path), path.resolve(here, '../harness-output/public-controller-events.jsonl'));", "assert.deepEqual(cfg.publicEvents, manifest.roles.publicEvents);"),
        ("const configPath = path.resolve(here, '../browser-config.ACTUAL.json');", "const configPath = path.resolve(manifest.roles.publicConfig.path);"),
        ("assert.equal(hash(configPath), 'e066a9719926e0be8712f41ce3635590e56827a797bcbd6292f23a18018c555c');",
         "assert.equal(hash(configPath), '" + review['publicConfig']['sha256'] + "');"),
        ("// The immutable approved config/run/source/build chain binds scanforge-c5282a283ba2a915,\n// the reviewed1756 diagnostic copy and exact original3 source pins; no caller build override.",
         "// The fresh root-reviewed ACTUAL R3 manifest pins the post-PLY parent, diagnostic source/build\n// and exact original3 source pins; no caller build override."),
    ]
    public_pin = derive(BASE / 'bind-public.mjs', public_edits, proof)
    native_edits = [
        ("ROOT = HERE.parents[1]", "ROOT = HERE.parent"),
        ("if Path(authority[key]['path']).resolve() != (HERE.parent / 'harness-output' / name).resolve():", "if authority[key] != manifest['roles'][key]:"),
        ("Only approved publicR2 source/config/plan authority", "Only reviewed actual publicR5 source/config/plan authority"),
        ("Only exact owned publicR2 evidence/events", "Only exact pinned publicR5 evidence/events"),
        ("preservedProcesses=[dict(pid=37580, port=5173, executable='C:/Program Files/nodejs/node.exe',\n                                             startFileTime='134368579097612184')])",
         "preservedProcesses=[dict(pid=50388, port=5173, executable='C:/Program Files/nodejs/node.exe',\n                                             startFileTime='134370496637591985')])"),
        ("'-r1'))", "'-r5'))"),
    ]
    native_pin = derive(BASE / 'bind-native.py', native_edits, proof)
    fixture_pin = derive(BASE / 'contract_fixture.py', [
        ("publicEvidence=dict(path=str(HERE.parent / 'harness-output' / 'evidence.json')),\n                     publicEvents=dict(path=str(HERE.parent / 'harness-output' / 'public-controller-events.jsonl')))",
         "publicEvidence=copy.deepcopy(manifest['roles']['publicEvidence']),\n                     publicEvents=copy.deepcopy(manifest['roles']['publicEvents']))")], proof)
    # Unchanged import siblings preserve every original callback/scalar/clock and six-field contract.
    copies = {}
    for name in ('launcher_derivations.py', 'standalone.mjs', 'source-stage-proof.json'):
        source = BASE / name
        with (OUT / name).open('xb') as stream:
            stream.write(source.read_bytes())
        copies[name] = pin(OUT / name)
    for role in ('adapter', 'sourceBindings'):
        source = manifest['roles'][role]
        target = HERE / Path(source['path']).name
        require(not target.exists(), 'Exclusive approved adapter sibling')
        with target.open('xb') as stream:
            stream.write(Path(source['path']).read_bytes())
        copies[role] = pin(target)
        require(copies[role]['sha256'] == source['sha256'], 'Exact adapter sibling bytes')
    # Explicit old-path to new-pin table: never recursively rewrite historical authority.
    mapping = {str((BASE / name).resolve()).casefold(): pin(OUT / name) for name in
               ('bind-public.mjs', 'bind-native.py', 'contract_fixture.py', 'launcher_derivations.py', 'standalone.mjs', 'source-stage-proof.json')}
    for role in ('adapter', 'sourceBindings'):
        mapping[str(Path(manifest['roles'][role]['path']).resolve()).casefold()] = copies[role]
    for role in ('publicPlan', 'publicConfig', 'publicRun'):
        mapping[str(Path(manifest['roles'][role]['path']).resolve()).casefold()] = review[role]
    old_owned_docs = {str((BASE / name).resolve()).casefold() for name in ('README.md', 'COMMANDS.txt')}
    manifest['pins'] = unique([mapping.get(str(Path(value['path']).resolve()).casefold(), value)
                               for value in manifest['pins'] if str(Path(value['path']).resolve()).casefold() not in old_owned_docs] +
                              [review[key] for key in required] + [review_pin, pin(__file__)])
    for role, value in list(manifest['roles'].items()):
        manifest['roles'][role] = mapping.get(str(Path(value['path']).resolve()).casefold(), value)
    manifest['roles'].update({key: review[key] for key in required})
    manifest['roles']['publicBinder'] = public_pin
    manifest['roles']['rootReview'] = review_pin
    manifest['status'] = 'ACTUAL_PUBLIC_R5_AUTHORITY_BOUND_NATIVE_UNRUN'
    manifest_pin = write(OUT / 'source-manifest.json', manifest)
    authority = {key: review[key] for key in ('publicPlan', 'publicLedger', 'publicEvidence', 'publicEvents')}
    authority.update({key: manifest['roles'][key] for key in ('originalInputs', 'normalDistinction')})
    authority['status'] = 'ACTUAL_PUBLIC_R5_ROOT_REVIEWED_NATIVE_UNRUN'
    authority_pin = write(OUT / 'authority-config.ACTUAL.json', authority)
    proof_pin = write(OUT / 'r1-to-r5-source-proof.json', dict(nativeExecuted=False, testsExecuted=False,
        metadataOnly=True, rootReview=review_pin, basisSeal=pin(BASE / 'seal.json'), changes=proof,
        unchangedNativeHelpers=[manifest['roles'][key] for key in ('inputHelper', 'producerDeriver', 'controllerHelper', 'controllerDeriver', 'setterHelper', 'setterDeriver')]))
    rows = [dict(path=file.relative_to(OUT).as_posix(), bytes=file.stat().st_size, sha256=pin(file)['sha256'])
            for file in sorted(OUT.iterdir()) if file.is_file()]
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    receipt = write(OUT / 'source-receipt.json', dict(snapshotPath=OUT.as_posix(), tree='runtime-binding-r5-' + digest,
        sourceManifestSha256=digest, entries=rows))
    plans = []
    for kind in ('syntax', 'fixtures'):
        template = read(pin(BASE / ('owned-node-' + kind + '-plan.json')))
        require(template['modes']['focused']['guardMiB'] == 3072 and template['modes']['focused']['jobMiB'] == 2048,
                'Retained focused lane changed')
        template.update(cwd=OUT.as_posix(), sourceRoots=[row['path'] for row in rows], sourceReceipt=receipt,
            expectedTree='runtime-binding-r5-' + digest, expectedSourceManifestSha256=digest,
            preservedProcesses=[SERVER], owner='public-matched-runtime-binding-r5-' + kind,
            outputPrefix=(HERE / ('mvp-owned-node-public-matched-runtime-binding-r5-' + kind)).as_posix(),
            frozenInputs=unique(template['frozenInputs'] + manifest['pins'] + [manifest_pin, authority_pin, proof_pin, receipt] +
                               [pin(OUT / row['path']) for row in rows]))
        template['modes'] = {'focused': copy.deepcopy(template['modes']['focused'])}
        template['modes']['focused']['args'] = ['--max-old-space-size=384', (OUT / 'standalone.mjs').as_posix(), kind]
        require(not Path(template['outputPrefix'] + '-focused').exists(), 'Preserve existing validation outputs')
        plans.append(write(OUT / ('owned-node-' + kind + '-plan.json'), template))
    write(OUT / 'seal.json', dict(status='ACTUAL_PUBLIC_R5_BOUND_NATIVE_AND_VALIDATION_UNRUN',
        nativeExecuted=False, testsExecuted=False, rootReview=review_pin, sourceManifest=manifest_pin,
        sourceReceipt=receipt, proof=proof_pin, authority=authority_pin, plans=plans,
        files=[pin(file) for file in sorted(OUT.iterdir()) if file.is_file()]))
    print(json.dumps(dict(prepared=OUT.as_posix(), nativeExecuted=False, testsExecuted=False,
                          rootMustRunStandaloneThenBindPublic=True)))


if __name__ == '__main__':
    main()
