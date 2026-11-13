import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentMode } from "./development-mode.mjs";
import { developmentNode } from "./node-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const selected = developmentMode(root, process.env), supplied = process.argv.slice(2);
  const mode = supplied[0] === "--app" ? "app" : selected, args = supplied[0] === "--app" ? supplied.slice(1) : supplied;
  const node = developmentNode(root, process.env);
  if (node !== process.execPath) console.log("Using the compatible Node runtime recorded by local setup; system Node is unchanged.");
  if (mode === "demo" && args.length) throw new Error("The local demo uses exactly http://localhost:3000. Use dev:app for explicitly configured custom Next options.");
  console.log(mode === "demo" ? "Using the saved, owned local demo configuration. No .env file or credentials are copied." : "Using explicit application environment configuration. For the fictional local demo use npm run demo:setup, then npm run demo.");
  const child = spawn(node, mode === "demo" ? [path.join(root, "scripts", "demo.mjs"), "start"] : [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", ...args], { cwd: root, env: process.env, windowsHide: true, stdio: "inherit" });
  child.on("error", () => { console.error("Could not launch the development server."); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
} catch (error) { console.error(error.message); process.exitCode = 1; }
