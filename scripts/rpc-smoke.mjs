// End-to-end smoke test: drive a real `pi --mode rpc` process, send a prompt,
// and assert that the extension emits a `setWidget` UI request for the pinned
// question. No model output is required — the `input` event fires before the
// agent runs, so we exit as soon as the widget request is observed.
//
// Usage: node scripts/rpc-smoke.mjs
// Override the pi binary with PI_BIN=/path/to/pi.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "../extensions/pinned-question.ts");
const piBin = process.env.PI_BIN || "pi";
const prompt = process.env.SMOKE_PROMPT || "Hello from the pinned-question smoke test";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 25000);

const child = spawn(piBin, ["--mode", "rpc", "--no-session", "--extension", extension], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let stderr = "";
let done = false;

const timer = setTimeout(() => finish(1, `timed out after ${timeoutMs}ms`), timeoutMs);

function finish(code, message) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
  const prefix = code === 0 ? "PASS" : "FAIL";
  process.stdout.write(`${prefix}: ${message}\n`);
  if (code !== 0 && stderr.trim()) {
    process.stdout.write(`--- pi stderr (tail) ---\n${stderr.trim().split("\n").slice(-20).join("\n")}\n`);
  }
  process.exit(code);
}

child.on("error", (error) => finish(1, `failed to spawn '${piBin}': ${error.message}`));
child.on("exit", (code) => {
  if (!done) finish(1, `pi exited early with code ${code}`);
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      record.type === "extension_ui_request" &&
      record.method === "setWidget" &&
      record.widgetKey === "pinned-question" &&
      Array.isArray(record.widgetLines)
    ) {
      finish(0, `received setWidget -> ${JSON.stringify(record.widgetLines)}`);
    }
  }
});

// Give pi a moment to load the extension, then send a prompt.
setTimeout(() => {
  if (done) return;
  child.stdin.write(`${JSON.stringify({ id: "smoke-1", type: "prompt", message: prompt })}\n`);
}, 2500);