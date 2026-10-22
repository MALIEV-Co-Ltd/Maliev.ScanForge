"""Late binding only. Never spawns native programs; root runs emitted original-v4 plans."""
import copy
import ctypes as C
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import time

HERE = Path(__file__).resolve().parent
RUN = HERE / 'actual-run'
ROOT = HERE.parents[1]
STARTED = time.monotonic()


def guard():
    if time.monotonic() - STARTED > 300:
        raise TimeoutError('Late metadata binding300s lease')
    class Memory(C.Structure):
        _fields_ = [('length', C.c_ulong), ('load', C.c_ulong)] + [(name, C.c_uint64) for name in
                    ('total', 'available', 'pageTotal', 'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]
    value = Memory();value.length = C.sizeof(value)
    if not C.WinDLL('kernel32', use_last_error=True).GlobalMemoryStatusEx(C.byref(value)) or value.available < 4096 * 1048576:
        raise RuntimeError('Unchanged4096 staging/phase admission')


def pin(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(65536):
            if time.monotonic() - STARTED > 300:
                raise TimeoutError('Metadata lease')
            digest.update(block)
    return dict(path=str(path), bytes=path.stat().st_size, sha256=digest.hexdigest())


def check(value):
    actual = pin(value['path'])
    if actual['sha256'] != value['sha256'] or ('bytes' in value and actual['bytes'] != value['bytes']):
        raise ValueError('Immutable input changed: ' + value['path'])


def read(value):
    check(value)
    if Path(value['path']).stat().st_size > 4 * 1048576:
        raise ValueError('JSON4MiB bound')
    return json.loads(Path(value['path']).read_text(encoding='utf-8-sig'))


def write(path, value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    if len(encoded) > 4 * 1048576:
        raise ValueError('Metadata4MiB bound')
    with Path(path).open('xb') as stream:
        stream.write(encoded)
    return pin(path)


def module(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem + '_late', path)
    value = importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


def unique(pins):
    result = {}
    for value in pins:
        key = str(Path(value['path']).resolve()).casefold()
        if key in result and result[key]['sha256'] != value['sha256']:
            raise ValueError('Conflicting immutable pin')
        result[key] = value
    return list(result.values())


def kernel_mode(template, role):
    expected_job = 2048 if role == 'setter' else 3072
    kernel = template['modes']['kernel']
    if (kernel['guardMiB'], kernel['heapMiB'], kernel['jobMiB'], kernel['leaseSeconds']) != (4096, 128, expected_job, 600):
        raise ValueError('Original native phase caps changed')
    return copy.deepcopy(kernel)


def validate_authority(manifest, authority):
    if authority['status'] != 'ACTUAL_PUBLIC_CAPTURE_BOUND_NATIVE_UNRUN' or authority['nativeAcceptance'] is not False:
        raise ValueError('No fabricated capture authority')
    for field, role in [('publicPlan', 'publicPlan'), ('bindingSource', 'publicBinder'),
                        ('approvedConfig', 'publicConfig'), ('originalInputs', 'originalInputs'),
                        ('normalDistinction', 'normalDistinction')]:
        if authority[field] != manifest['roles'][role]:
            raise ValueError('Only approved publicR2 source/config/plan authority')
    for key, name in [('publicEvidence', 'evidence.json'), ('publicEvents', 'public-controller-events.jsonl')]:
        if Path(authority[key]['path']).resolve() != (HERE.parent / 'harness-output' / name).resolve():
            raise ValueError('Only exact owned publicR2 evidence/events')


def prepare_phase(manifest, role, folder, files, recipe, launcher, source_config, ordinal=None):
    """Reuse exact historical phase limits/tools; replace source receipt/command/identity only."""
    template = read(manifest['roles'][role + 'Plan'])
    mode = kernel_mode(template, role)
    mode['args'] = ['--max-old-space-size=128', str(launcher), str(source_config)]
    if role == 'setter':
        mode['args'].append('capture')
    rows = [dict(path=str(Path(file).relative_to(folder)).replace('\\', '/'),
                 bytes=Path(file).stat().st_size, sha256=pin(file)['sha256']) for file in files]
    rows.sort(key=lambda row: row['path'])
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    receipt = write(folder / ('source-receipt' + (f'-{ordinal}' if ordinal is not None else '') + '.json'),
                    dict(snapshotPath=str(folder), tree='matched-native-' + digest, sourceManifestSha256=digest, entries=rows))
    dynamic = [pin(file) for file in files] + [receipt] + recipe['pins']
    template.update(cwd=str(folder), sourceRoots=[row['path'] for row in rows], sourceReceipt=receipt,
                    expectedTree='matched-native-' + digest, expectedSourceManifestSha256=digest,
                    owner='public-matched-native-' + role, status='ACTUAL_PRIORS_BOUND_NATIVE_UNRUN', modes={'kernel': mode},
                    frozenInputs=unique(template['frozenInputs'] + dynamic + manifest['pins']),
                    preservedProcesses=[dict(pid=37580, port=5173, executable='C:/Program Files/nodejs/node.exe',
                                             startFileTime='134368579097612184')])
    suffix = f'-{ordinal + 1}' if ordinal is not None else ''
    template['outputPrefix'] = str(ROOT / ('mvp-owned-node-public-matched-native-' + role + suffix + '-r1'))
    if Path(template['outputPrefix'] + '-kernel').exists():
        raise FileExistsError('Preserve existing actual kernel outputs')
    target = folder / ('kernel-plan' + (f'-{ordinal}' if ordinal is not None else '') + '.json')
    return write(target, template)


def stage(manifest, name, file_roles):
    target = RUN / name
    target.mkdir()
    for filename, role in file_roles:
        source = manifest['roles'][role];check(source)
        with Path(source['path']).open('rb') as reader, (target / filename).open('xb') as writer:
            shutil.copyfileobj(reader, writer, 65536)
        if pin(target / filename)['sha256'] != source['sha256']:
            raise ValueError('Byte-identical helper staging failed')
    return target


def derive_code(manifest, basis_role, deriver_path, target):
    source_pin = manifest['roles'][basis_role];check(source_pin)
    original = Path(source_pin['path']).read_bytes()
    candidate, changes, inverse = module(deriver_path).derive(original.decode('utf-8'))
    if inverse.encode() != original:
        raise ValueError('Exact native source inverse')
    compile(candidate, str(target), 'exec')
    with target.open('x', encoding='utf-8', newline='') as stream:
        stream.write(candidate)
    return pin(target)


def main():
    guard()
    if len(sys.argv) != 3 or sys.argv[2] != '--root-reviewed-actual-priors':
        raise ValueError('Explicit root-reviewed actual prior evidence required')
    action = sys.argv[1]
    manifest = json.loads((HERE / 'source-manifest.json').read_text())
    for value in manifest['pins']:
        check(value)
    authority = json.loads((RUN / 'capture-authority.json').read_text())
    validate_authority(manifest, authority)
    controller_api = module(manifest['roles']['controllerHelper']['path'])
    controller_api.clean(read(authority['publicLedger']), authority['publicPlan'])
    request = read(authority['request'])
    derivations = module(HERE / 'launcher_derivations.py')
    capture_pins = [authority[key] for key in ('request','publicEvidence','publicEvents','publicPlan','publicLedger','originalInputs','normalDistinction')]
    carrier_pins = []
    for source in request['sources']:
        carrier_pins += [source['originalPly'], source['queryNormalAuthority']['inputTriangles']]
        carrier_pins += [source[key] for key in ('originalIndexedPositions','authoredSetterNormals','publishedPositions','publishedAuthoredNormals')]
    for value in carrier_pins:
        check(value)
    public_ledger = read(authority['publicLedger'])
    if public_ledger.get('completed') is not True or public_ledger.get('mode') != 'kernel':
        raise ValueError('Actual public kernel terminal required')
    common = unique(capture_pins + carrier_pins + manifest['pins'] + [manifest['roles']['nativeImage']])
    if action == 'producers':
        folder = stage(manifest, 'native-input-stage-r2', [('captured_native_input.py','inputHelper'), ('prepare_captured_producer.py','producerDeriver')])
        candidate = folder / 'captured-native-producer.candidate.py'
        derive_code(manifest, 'producerBasis', folder / 'prepare_captured_producer.py', candidate)
        original = Path(manifest['roles']['producerLauncher']['path']).read_bytes()
        text, changes, inverse = derivations.derive(original.decode(), 'producer')
        if inverse.encode() != original:
            raise ValueError('Producer launcher inverse')
        launcher = folder / 'producer-native-step.mjs';launcher.write_text(text, newline='')
        api = module(folder / 'captured_native_input.py')
        plans = []
        for i, source in enumerate(request['sources']):
            run = folder / f'source-{i}';run.mkdir()
            config = run / 'producer-config.json';api.prepare_configuration(authority['request'], i, config)
            recipe = read(manifest['roles']['producerRecipe'])
            recipe.update(cwd=str(folder), producer=str(candidate), config=str(config), source=i, sourceInfo=source,
                          request=authority['request'], nativeOutputDirectory=str(folder / f'launcher-{i}'),
                          nativeReceipt=str(run / 'native-ply-producer.actual.json'),
                          cleanupReceipt=str(run / 'global-fine-canonical-mesh-controller-cleanup.json'),
                          pins=unique(common + [pin(candidate), pin(config), pin(folder / 'captured_native_input.py')]))
            recipe_path = folder / f'producer-recipe-{i}.json';write(recipe_path, recipe)
            files = [candidate, folder/'captured_native_input.py', folder/'prepare_captured_producer.py', launcher, config, recipe_path]
            plans.append(prepare_phase(manifest,'producer',folder,files,recipe,launcher,recipe_path,i))
        write(RUN / 'producer-plans.json', plans)
    elif action == 'controller':
        producer_plans = json.loads((RUN / 'producer-plans.json').read_text())
        entries = []
        producer_folder = RUN / 'native-input-stage-r2'
        for i, plan_pin in enumerate(producer_plans):
            plan = read(plan_pin)
            ledger_pin = pin(Path(plan['outputPrefix'] + '-kernel') / 'resource-ledger.json')
            controller_api.clean(read(ledger_pin), plan_pin)
            source_run = producer_folder / f'source-{i}'
            entries.append(dict(source=i, config=pin(source_run/'producer-config.json'), result=pin(source_run/'native-ply-producer.actual.json'),
                cleanup=pin(source_run/'global-fine-canonical-mesh-controller-cleanup.json'), plan=plan_pin, ledger=ledger_pin,
                producerSource=pin(producer_folder/'captured-native-producer.candidate.py')))
        folder = stage(manifest,'native-controller-stage-r2',[('controller_binding.py','controllerHelper'),('prepare_controller.py','controllerDeriver')])
        candidate = folder / 'captured-controller.candidate.py'
        derive_code(manifest,'controllerBasis',folder/'prepare_controller.py',candidate)
        config = dict(request=authority['request'], producers=entries, outputDirectory=str(folder/'controller-actual-r01'),
            inputHelper=pin(producer_folder/'captured_native_input.py'), producerGenerator=pin(producer_folder/'prepare_captured_producer.py'),
            producerBasis=manifest['roles']['producerBasis'], nativeImage=manifest['roles']['nativeImage'], compactFixtureGate=manifest['roles']['compactGate'])
        api = module(folder/'controller_binding.py')
        current = api.load(config)
        api.close(current, [])
        config_path = folder/'controller-config.ACTUAL.json';write(config_path,config)
        original=Path(manifest['roles']['controllerLauncher']['path']).read_bytes()
        text,changes,inverse=derivations.derive(original.decode(),'controller')
        if inverse.encode()!=original:raise ValueError('Controller launcher inverse')
        launcher=folder/'full-stl-step.mjs';launcher.write_text(text,newline='')
        recipe=read(manifest['roles']['controllerRecipe'])
        recipe.update(script=str(candidate),config=str(config_path),request=authority['request'],outputDirectory=str(folder/'launcher-actual-r01'),
            actualResult=str(folder/'controller-actual-r01/global-fine-canonical-mesh-controller-native-results.json'),
            comparisonReceipt=str(folder/'controller-actual-r01/public-controller-comparison.json'),
            compactFixtureReceipt=str(folder/'controller-actual-r01/compact-source-fixture.actual.json'),
            cleanupReceipt=str(folder/'controller-actual-r01/global-fine-canonical-mesh-controller-cleanup.json'),pins=unique(common+[pin(config_path),pin(candidate)]+[value for entry in entries for value in entry.values() if isinstance(value,dict)]))
        recipe_path=folder/'controller-recipe.json';write(recipe_path,recipe)
        files=[candidate,folder/'controller_binding.py',folder/'prepare_controller.py',config_path,launcher,recipe_path]
        write(RUN/'controller-plan.json',prepare_phase(manifest,'controller',folder,files,recipe,launcher,recipe_path))
    elif action == 'setter':
        prior=json.loads((RUN/'controller-plan.json').read_text());plan=read(prior)
        ledger=pin(Path(plan['outputPrefix']+'-kernel')/'resource-ledger.json');controller_api.clean(read(ledger),prior)
        controller_folder=RUN/'native-controller-stage-r2';out=controller_folder/'controller-actual-r01'
        folder=stage(manifest,'native-setter-stage-r1',[('setter_binding.py','setterHelper'),('prepare_setter.py','setterDeriver')])
        candidate=folder/'captured-setter.candidate.py';derive_code(manifest,'setterBasis',folder/'prepare_setter.py',candidate)
        pins=dict(observedRequest=authority['request'],actualControllerRaw=pin(out/'global-fine-canonical-mesh-controller-native-results.json'),
            actualControllerComparison=pin(out/'public-controller-comparison.json'),actualControllerPlan=prior,actualControllerLedger=ledger,
            actualControllerSource=pin(controller_folder/'captured-controller.candidate.py'))
        config_path=folder/'setter-config.ACTUAL.json';api=module(folder/'setter_binding.py')
        config=api.prepare_configuration(manifest['roles']['setterConfig'],pins,config_path)
        original=Path(manifest['roles']['setterLauncher']['path']).read_bytes()
        text,changes,inverse=derivations.derive(original.decode(),'setter')
        if inverse.encode()!=original:raise ValueError('Setter launcher inverse')
        launcher=folder/'run-capture-cli.mjs';launcher.write_text(text,newline='')
        # New adjacent config, preserving the factory-generated immutable one for provenance.
        config['originalCarrierPins']=carrier_pins
        config['pins']=unique(config['pins']+common+list(pins.values())+[pin(candidate),pin(folder/'setter_binding.py')])
        launch_config=folder/'setter-launch-config.ACTUAL.json';write(launch_config,config)
        files=[candidate,folder/'setter_binding.py',folder/'prepare_setter.py',config_path,launch_config,launcher]
        write(RUN/'setter-plan.json',prepare_phase(manifest,'setter',folder,files,config,launcher,launch_config))
    else:
        raise ValueError('Only producers/controller/setter late-binding phases')
    print(json.dumps(dict(prepared=action,nativeExecuted=False,requireRootKernelScheduling=True)))


if __name__ == '__main__':
    main()
