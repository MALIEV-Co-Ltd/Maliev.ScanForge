"""Synthetic pure contracts only. No capture acceptance, staging, native imports or engine."""
import copy
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def rejected(action):
    try:
        action()
    except (ValueError, KeyError):
        return
    raise AssertionError('Expected fail-closed contract rejection')


def main():
    binding = load('bind-native')
    derive = load('launcher_derivations').derive
    manifest = json.loads((HERE / 'source-manifest.json').read_text())
    output = Path(sys.argv[1]).resolve()
    assert output.parent == HERE and output.name.startswith('fixture-owned-') and output.is_dir()
    checks = 0
    for kind in ('producer', 'controller', 'setter'):
        original = Path(manifest['roles'][kind + 'Launcher']['path']).read_bytes()
        text, changes, inverse = derive(original.decode(), kind)
        assert changes and inverse.encode() == original and text != original.decode()
        (output / (kind + '.mjs')).write_text(text, encoding='utf-8', newline='')
        rejected(lambda: derive('', kind))
        rejected(lambda: derive(original.decode() + original.decode(), kind))
        checks += 3
        plan = json.loads(Path(manifest['roles'][kind + 'Plan']['path']).read_text(encoding='utf-8-sig'))
        mode = binding.kernel_mode(plan, kind)
        assert mode == plan['modes']['kernel'] and mode is not plan['modes']['kernel']
        altered = copy.deepcopy(plan)
        altered['modes']['kernel']['jobMiB'] += 1
        rejected(lambda: binding.kernel_mode(altered, kind))
        checks += 2
    producer = (output / 'producer.mjs').read_text()
    controller = (output / 'controller.mjs').read_text()
    setter = (output / 'setter.mjs').read_text()
    assert 'recipe.producer,recipe.config' in producer and 'config.nativeVertexNormalsSha256' not in producer
    assert 'recipe.script,recipe.config' in controller and "phase('verify-original-ply-reference'" not in controller
    assert 'config.canonicalResult.path' not in setter and 'source.faces' not in setter
    assert 'public-final-indexed-comparison.json' in setter and 'indexedFinalCompared: true' in setter
    checks += 4
    authority = dict(status='ACTUAL_PUBLIC_CAPTURE_BOUND_NATIVE_UNRUN', nativeAcceptance=False,
                     publicPlan=manifest['roles']['publicPlan'], bindingSource=manifest['roles']['publicBinder'],
                     approvedConfig=manifest['roles']['publicConfig'], originalInputs=manifest['roles']['originalInputs'],
                     normalDistinction=manifest['roles']['normalDistinction'],
                     publicEvidence=dict(path=str(HERE.parent / 'harness-output' / 'evidence.json')),
                     publicEvents=dict(path=str(HERE.parent / 'harness-output' / 'public-controller-events.jsonl')))
    binding.validate_authority(manifest, authority)  # Shape only, never physical/public/native acceptance.
    for field in ('publicPlan', 'bindingSource', 'approvedConfig', 'originalInputs', 'normalDistinction'):
        bad = copy.deepcopy(authority)
        bad[field]['sha256'] = '0' * 64
        rejected(lambda: binding.validate_authority(manifest, bad))
        checks += 1
    for field in ('publicEvidence', 'publicEvents'):
        bad = copy.deepcopy(authority)
        bad[field]['path'] = str(HERE / 'untrusted.json')
        rejected(lambda: binding.validate_authority(manifest, bad))
        checks += 1
    bad = copy.deepcopy(authority)
    bad['nativeAcceptance'] = True
    rejected(lambda: binding.validate_authority(manifest, bad))
    checks += 1
    print(json.dumps(dict(scope='SYNTHETIC_CONTRACT_ONLY', checks=checks, failures=0, nativeExecuted=False,
                         publicPhysicalAcceptance=False, nativeAcceptance=False)))


if __name__ == '__main__':
    main()
