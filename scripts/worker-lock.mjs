import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
// This dedicated SQLite writer lock is released by the OS if the worker exits.
export function lockWorker(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const guard = new DatabaseSync(join(dir, "worker-lock.sqlite"));
  try {
    guard.exec("BEGIN EXCLUSIVE");
    return guard;
  } catch {
    guard.close();
    throw Error("A sync worker already owns this data directory.");
  }
}
