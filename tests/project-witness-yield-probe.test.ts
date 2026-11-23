import { afterEach, expect, it, vi } from 'vitest';
import { packProjectTransport, unpackProjectTransport } from '../src/project-transport';
afterEach(() => vi.unstubAllGlobals());
it('revalidates a reused array after the cooperative publication yield', async () => {
  const values = Array.from({length:65536}, (_, i) => i);
  const { packet } = await packProjectTransport({values}, {cooperative:false});
  vi.stubGlobal('scheduler', { yield: async () => { values[0] = 999; } });
  await expect(unpackProjectTransport(packet, { reuseNumericArray: async () => values })).rejects.toThrow(/changed/i);
});
