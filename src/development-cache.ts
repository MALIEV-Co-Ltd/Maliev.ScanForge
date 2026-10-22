/** Remove only this application's static offline cache before mounting the live dev UI. */
export async function clearDevelopmentCache(
  workers: ServiceWorkerContainer,
  storage: CacheStorage,
  workerUrl: string,
): Promise<boolean> {
  const registrations = await workers.getRegistrations();
  for (const registration of registrations) {
    const ours = [
      registration.active,
      registration.waiting,
      registration.installing,
    ].some((worker) => worker?.scriptURL === workerUrl);
    if (ours) await registration.unregister();
  }
  for (const key of await storage.keys())
    if (key.startsWith("scanforge-")) await storage.delete(key);
  return workers.controller?.scriptURL === workerUrl;
}
