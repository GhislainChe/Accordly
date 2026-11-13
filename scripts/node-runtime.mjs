import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export function supportsNode(version) {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return !!match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 18));
}
export function developmentNode(root, env, version = process.versions.node) {
  if (supportsNode(version)) return process.execPath;
  let candidate = env.ACCORDLY_NODE_BINARY;
  const file = path.join(root, ".demo", "state.json");
  if (!candidate && existsSync(file)) {
    let state;
    try { state = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("Private demo state is unreadable. Inspect setup locally; no values were printed."); }
    if (/^accordly-demo-[a-f0-9]{8}$/.test(state.project)) candidate = state.nodeExecutable;
  }
  const hint = `Accordly requires Node 22.18+ (Node 24 LTS recommended); current Node is ${version}. Run demo:setup using a compatible installed Node, or set ACCORDLY_NODE_BINARY to it. No server was started.`;
  if (!candidate || !path.isAbsolute(candidate) || !["node", "node.exe"].includes(path.basename(candidate).toLowerCase()) || !existsSync(candidate)) throw new Error(hint);
  // The private setup records the executable that actually ran it. Probe the
  // installed binary without a shell; never download or globally replace Node.
  const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (probe.status !== 0 || !supportsNode(probe.stdout.trim())) throw new Error(hint);
  return candidate;
}
