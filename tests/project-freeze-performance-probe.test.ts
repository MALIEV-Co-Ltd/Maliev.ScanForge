import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';

it('shows freezing an accessor array does not disable its setter', () => {
  let external = 0;
  const values = [1, 2];
  Object.defineProperty(values, '1', {get: () => 2, set: value => { external = value; }, configurable: true});
  Object.freeze(values);
  expect(Object.isFrozen(values)).toBe(true);
  expect(Reflect.set(values, '1', 123)).toBe(true);
  expect(external).toBe(123);
});

it('measures freezing one large numeric array in isolation', () => {
  const count = 33_263_505;
  const values = Array.from({length: count}, (_, i) => i % 1000 / 3);
  const before = process.memoryUsage();
  const start = performance.now();
  Object.freeze(values);
  const elapsedMs = performance.now() - start;
  expect(Object.isFrozen(values)).toBe(true);
  expect(Reflect.set(values, '0', 999)).toBe(false);
  expect(values[0]).toBe(0);
  const after = process.memoryUsage();
  writeFileSync('C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-freeze-performance-r2-20261105.json', JSON.stringify({count, elapsedMs, before, after}));
}, 120000);
