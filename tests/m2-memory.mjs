import { totalmem } from "node:os";

// M2 validation is allowed to use the machine's reported physical memory.
export const m2BrowserHeapFlag = `--js-flags=--max-old-space-size=${Math.floor(totalmem() / 1024 / 1024)}`;
