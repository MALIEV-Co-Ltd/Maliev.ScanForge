import assert from "node:assert/strict";
import { chromium } from "playwright";

const mode = process.env.SCANFORGE_M2_ARRAY_RESTORE;
assert(["from", "preallocated"].includes(mode), "Select a restore mode");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--js-flags=--max-old-space-size=2048"],
});
try {
  const page = await browser.newPage();
  const result = await page.evaluate((restoreMode) => {
    const count = 3700757 * 9;
    const input = new Float64Array(count);
    for (let i = 0; i < count; i++) input[i] = 100000000 + (i % 37) / 4;
    input[0] = -0;
    const before = performance.memory.usedJSHeapSize;
    const start = performance.now();
    let output;
    if (restoreMode === "from") output = Array.from(input);
    else {
      output = new Array(count);
      for (let i = 0; i < count; i++) output[i] = input[i];
    }
    const after = performance.memory.usedJSHeapSize;
    if (!Object.is(output[0], -0) || output.length !== count)
      throw Error("restore changed length or signed zero");
    for (let i = 1; i < count; i += 997)
      if (!Object.is(output[i], input[i]))
        throw Error(`coordinate mismatch at ${i}`);
    window.__m2Retained = { input, output };
    return {
      mode: restoreMode,
      count,
      before,
      after,
      elapsedMs: performance.now() - start,
    };
  }, mode);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
