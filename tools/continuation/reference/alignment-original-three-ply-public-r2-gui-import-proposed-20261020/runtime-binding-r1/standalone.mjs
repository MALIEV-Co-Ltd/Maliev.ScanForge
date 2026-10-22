import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const execute = (file, args) => execFileSync(file, args,
  {shell: false, windowsHide: true, timeout: 30000, maxBuffer: 65536, encoding: 'utf8'});
if (process.argv[2] === 'syntax') {
  for (const name of ['bind-public.mjs', 'standalone.mjs']) execute(process.execPath, ['--check', path.join(here, name)]);
  process.stdout.write(execute('C:/Python314/python.exe', ['-I', '-B', '-c',
    'import pathlib,sys; [compile(pathlib.Path(p).read_text(encoding="utf-8-sig"),p,"exec") for p in sys.argv[1:]]; print("COMPILE_ONLY_3_PASS")',
    ...['bind-native.py', 'launcher_derivations.py', 'contract_fixture.py'].map(name => path.join(here, name))]));
} else {
  assert.equal(process.argv[2], 'fixtures');
  const folder = fs.mkdtempSync(path.join(here, 'fixture-owned-'));
  try {
    process.stdout.write(execute('C:/Python314/python.exe', ['-I', '-B', path.join(here, 'contract_fixture.py'), folder]));
    for (const kind of ['producer', 'controller', 'setter']) execute(process.execPath, ['--check', path.join(folder, kind + '.mjs')]);
  } finally {
    for (const kind of ['producer', 'controller', 'setter']) {
      const file = path.join(folder, kind + '.mjs');
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(folder);
  }
}
