import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.argv[2] === "dev");
process.env.PORT ||= "3430";
const require = createRequire(import.meta.url);
const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
  stdio: "inherit",
});
const args = process.argv.slice(2);
if (!args.includes("-H") && !args.includes("--hostname"))
  args.push("-H", "127.0.0.1");
const web = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), ...args],
  { stdio: "inherit" },
);
let exiting = false;
function stop(code) {
  if (exiting) return;
  exiting = true;
  worker.kill();
  web.kill();
  process.exitCode = code;
}
worker.on("exit", (code) => stop(code ?? 1));
web.on("exit", (code) => stop(code ?? 0));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
