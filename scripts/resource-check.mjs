import { freemem } from "node:os";
const available = freemem() / 1024 / 1024;
const required = 1536;
console.log(
  `Resource admission: ${Math.round(available)} MiB available; ${required} MiB required.`,
);
if (available < required) {
  console.error(
    "Build not admitted: wait for capacity; do not interrupt other tasks or reduce this guard.",
  );
  process.exit(1);
}
