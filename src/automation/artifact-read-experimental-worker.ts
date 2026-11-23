const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async ({data}: MessageEvent<Blob>) => {
  try {
    const bytes = new Uint8Array(await data.arrayBuffer());
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    worker.postMessage({base64: btoa(parts.join(""))});
  } catch (error) { worker.postMessage({error: String(error)}); }
};
