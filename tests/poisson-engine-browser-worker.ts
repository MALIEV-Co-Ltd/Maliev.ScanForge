import { reconstructPoisson } from "../src/poisson-reconstruction";
self.onmessage = async (event) => {
  try {
    const result = await reconstructPoisson(event.data);
    self.postMessage({
      ok: true,
      diagnostics: result.diagnostics,
      positions: Array.from(result.positions),
    });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
