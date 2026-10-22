import assert from 'node:assert/strict';
import {importOriginalPlyViaGui} from './public-gui-ply-input.mjs';

const sources = [0, 1, 2].map(i => ({
  name: `ply-${i + 1}.ply`,
  path: `B:/temp/alignment-example-files/ply-${i + 1}.ply`,
  bytes: 10 + i,
  sha256: String(i + 1).repeat(64),
}));

function fake({units = 'mm', inputCount = 1} = {}) {
  const operations = [];
  let pending;
  const objects = [];
  const page = {
    locator(selector) {
      assert.equal(selector, 'input[type="file"][multiple][accept*=".ply"]');
      return {
        count: async () => inputCount,
        setInputFiles: async file => {
          assert.equal(objects.length, operations.filter(row => row[0] === 'file').length);
          pending = file.split('/').at(-1);
          operations.push(['file', file]);
        },
      };
    },
    getByRole(role, options) {
      assert.equal(role, 'dialog');
      assert.deepEqual(options, {name: 'Import scan', exact: true});
      return {
        waitFor: async () => {},
        locator(selector) {
          assert.equal(selector, 'select');
          return {inputValue: async () => units};
        },
        getByRole(buttonRole, buttonOptions) {
          assert.equal(buttonRole, 'button');
          assert.deepEqual(buttonOptions, {name: 'Import', exact: true});
          return {
            click: async () => {
              assert.equal(typeof pending, 'string');
              objects.push({name: pending});
              operations.push(['import', pending]);
            },
          };
        },
      };
    },
  };
  const call = async name => {
    assert(['project_get', 'session_get'].includes(name), 'No artifact/API-import workaround');
    return {result: name === 'project_get' ? {objects: [...objects]} : {busy: false}};
  };
  return {
    page,
    call,
    operations,
    waitUntil: async predicate => assert.equal(await predicate(), true),
    check: () => {},
  };
}

const normal = fake();
const result = await importOriginalPlyViaGui({sources, ...normal});
assert.equal(result.length, 3);
assert.deepEqual(normal.operations, sources.flatMap(source => [
  ['file', source.path], ['import', source.name],
]));
assert(result.every(row => row.publicImportCompleted && row.placement === 'Unchanged public placeAtOrigin:true'));
await assert.rejects(() => importOriginalPlyViaGui({sources, ...fake({units: 'in'})}));
await assert.rejects(() => importOriginalPlyViaGui({sources, ...fake({inputCount: 2})}));
const wrong = structuredClone(sources);
wrong[1].path = 'B:/temp/alignment-example-files/scan-2.stl';
await assert.rejects(() => importOriginalPlyViaGui({sources: wrong, ...fake()}));
console.log(JSON.stringify({checks: 4, failures: 0, scope: 'Fake GUI import ordering/default units/route bounds only; actual browser UNRUN'}));
