import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentNode } from "./node-runtime.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const node = developmentNode(root, process.env);
  const child = spawn(node, [path.join(root, "scripts", "demo.mjs"), ...process.argv.slice(2)], { cwd: root, env: process.env, windowsHide: true, stdio: "inherit" });
  child.on("error", () => { console.error("Could not start the local demo command."); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
} catch (error) { console.error(error.message); process.exitCode = 1; }
