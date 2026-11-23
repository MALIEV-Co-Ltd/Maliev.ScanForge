// Diagnostic only: send artifact-read replies from a disposable worker.
self.onmessage = async ({ data }) => {
  try {
    const response = await fetch(data.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data.body),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
    self.postMessage({ ok: true });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
