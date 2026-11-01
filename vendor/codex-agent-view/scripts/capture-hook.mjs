#!/usr/bin/env node

import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_STDIN_BYTES = 2 * 1024 * 1024;
const SAFE_METADATA_FIELDS = new Set([
  "agent_id",
  "agent_type",
  "hook_event_name",
  "model",
  "permission_mode",
  "reason",
  "session_id",
  "source",
  "stop_hook_active",
  "tool_name",
  "tool_use_id",
  "trigger",
  "turn_id",
]);

function summarizePrivateValue(value) {
  if (value === null) {
    return { redacted: true, type: "null" };
  }

  if (Array.isArray(value)) {
    return { redacted: true, type: "array", length: value.length };
  }

  if (typeof value === "object") {
    return {
      redacted: true,
      type: "object",
      keys: Object.keys(value).sort(),
    };
  }

  return {
    redacted: true,
    type: typeof value,
    length: typeof value === "string" ? value.length : undefined,
  };
}

export function minimizePayload(payload, captureFull = false) {
  if (captureFull) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      SAFE_METADATA_FIELDS.has(key) ? value : summarizePrivateValue(value),
    ]),
  );
}

export function capturePath(env = process.env, cwd = process.cwd()) {
  const base = env.CODEX_AGENT_VIEW_CAPTURE_DIR
    ? resolve(env.CODEX_AGENT_VIEW_CAPTURE_DIR)
    : env.PLUGIN_DATA
      ? resolve(env.PLUGIN_DATA, "captures")
      : resolve(cwd, ".codex-agent-view", "captures");

  return { directory: base, file: resolve(base, "events.jsonl") };
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_STDIN_BYTES) {
      throw new Error(`hook payload exceeds ${MAX_STDIN_BYTES} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw);
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new TypeError("hook payload must be a JSON object");
  }

  const { directory, file } = capturePath();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const flags =
    constants.O_APPEND |
    constants.O_CREAT |
    constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(file, flags, 0o600);

  const record = {
    schema_version: 1,
    captured_at_ms: Date.now(),
    payload: minimizePayload(
      payload,
      process.env.CODEX_AGENT_VIEW_CAPTURE_FULL === "1",
    ),
  };

  try {
    chmodSync(file, 0o600);
    appendFileSync(descriptor, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
    });
  } finally {
    closeSync(descriptor);
  }

  // A neutral JSON object is valid for every captured event and is required by
  // events such as SubagentStop when a successful hook writes to stdout.
  process.stdout.write("{}\n");
}

const isDirectRun =
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(resolve(process.argv[1]));

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`codex-agent-view hook capture failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
