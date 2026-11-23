import { expect, it } from 'vitest';
import { packProjectTransport, unpackProjectTransport } from '../src/project-transport';

it('rejects a candidate changed after an earlier value was compared', async () => {
  const source = Array.from({length:65538}, (_, i) => i);
  const { packet } = await packProjectTransport({source});
  const proxy = new Proxy(source, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver);
      if (key === '65537') target[0] = 999;
      return result;
    },
  });
  await expect(unpackProjectTransport(packet, {
    reuseNumericArray: async () => proxy,
    releaseOwnedNumericBuffers: true,
  })).rejects.toThrow(/changed/i);
});
