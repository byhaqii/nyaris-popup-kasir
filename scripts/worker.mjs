import { setTimeout } from "node:timers/promises";
import { drain } from "../lib/sheets.mjs";
import { join } from "node:path";
import { lockWorker } from "./worker-lock.mjs";
const guard = lockWorker(
  process.env.POS_DATA_DIR || join(process.cwd(), "data"),
);
process.on("exit", () => guard.close());
while (true) {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) await drain();
  } catch (e) {
    console.error("Sync worker:", e.code || e.name);
  }
  await setTimeout(5000);
}
