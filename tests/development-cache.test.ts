import { expect, it, vi } from "vitest";
import { clearDevelopmentCache } from "../src/development-cache";

it.each(["active", "waiting", "installing"])(
  "unregisters our %s worker and preserves unrelated workers and caches",
  async (state) => {
    const url = "http://127.0.0.1:5173/sw.js";
    const unregister = vi.fn().mockResolvedValue(true);
    const foreign = vi.fn();
    const workers = {
      getRegistrations: async () => [
        { [state]: { scriptURL: url }, unregister },
        {
          active: { scriptURL: "http://127.0.0.1:5173/other/sw.js" },
          unregister: foreign,
        },
      ],
      controller: { scriptURL: url },
    };
    const storage = {
      keys: async () => ["scanforge-old", "other-project"],
      delete: vi.fn().mockResolvedValue(true),
    };
    expect(
      await clearDevelopmentCache(
        workers as unknown as ServiceWorkerContainer,
        storage as unknown as CacheStorage,
        url,
      ),
    ).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(foreign).not.toHaveBeenCalled();
    expect(storage.delete.mock.calls).toEqual([["scanforge-old"]]);
  },
);
it("does not reload when no application worker controls the page", async () => {
  const workers = { getRegistrations: async () => [], controller: null };
  const storage = { keys: async () => [], delete: vi.fn() };
  expect(
    await clearDevelopmentCache(
      workers as unknown as ServiceWorkerContainer,
      storage as unknown as CacheStorage,
      "http://127.0.0.1:5173/sw.js",
    ),
  ).toBe(false);
});
