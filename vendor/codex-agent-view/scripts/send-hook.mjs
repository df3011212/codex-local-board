#!/usr/bin/env node

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { minimizePayload } from "./capture-hook.mjs";
import {
  deriveSpawnAssignmentSummary,
  deriveTaskSummary,
} from "../src/core/normalize-hook-payload.mjs";
import { readRuntimeInfo } from "../src/runtime/config.mjs";

const MAX_STDIN_BYTES = 2 * 1024 * 1024;
const SEND_TIMEOUT_MS = 500;
const AUTO_START_WAIT_MS = 1_600;
const AUTO_START_POLL_MS = 40;
const MAX_WORKSPACE_LABEL_LENGTH = 120;
const OBSERVED_SPAWN_AGENT_TOOL_NAME = "collaborationspawn_agent";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

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
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new TypeError("hook payload must be a JSON object");
  }
  return payload;
}

function debug(code) {
  if (process.env.CODEX_AGENT_VIEW_DEBUG === "1") {
    process.stderr.write(`codex-agent-view hook sender: ${code}\n`);
  }
}

function deriveWorkspaceLabel(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    return null;
  }

  const label = basename(cwd)
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WORKSPACE_LABEL_LENGTH)
    .trim();
  return label || null;
}

function monitorEnvelope(payload) {
  const minimized = minimizePayload(payload);
  const workspaceLabel = deriveWorkspaceLabel(payload.cwd);
  const taskSummary =
    payload.hook_event_name === "UserPromptSubmit"
      ? deriveTaskSummary(payload.prompt)
      : null;
  const spawnAssignmentObserved =
    payload.hook_event_name === "PreToolUse" &&
    payload.tool_name === OBSERVED_SPAWN_AGENT_TOOL_NAME;
  const assignmentSummary = spawnAssignmentObserved
    ? deriveSpawnAssignmentSummary(payload.tool_input)
    : null;
  return {
    ...minimized,
    ...(workspaceLabel ? { workspace_label: workspaceLabel } : {}),
    ...(taskSummary ? { task_summary: taskSummary } : {}),
    ...(spawnAssignmentObserved ? { spawn_assignment_observed: true } : {}),
    ...(assignmentSummary ? { assignment_summary: assignmentSummary } : {}),
  };
}

async function sendToRuntime(runtime, envelope) {
  const response = await fetch(
    `http://${runtime.host}:${runtime.port}/api/events`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`monitor returned HTTP ${response.status}`);
  }
}

function childEnvironment() {
  const env = {};
  for (const key of [
    "CODEX_AGENT_VIEW_AUTO_START_PORT",
    "CODEX_AGENT_VIEW_RUNTIME_DIR",
    "SystemRoot",
  ]) {
    if (typeof process.env[key] === "string") {
      env[key] = process.env[key];
    }
  }
  return env;
}

function startMonitorDetached() {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./auto-start-monitor.mjs", import.meta.url))],
    {
      detached: true,
      env: childEnvironment(),
      shell: false,
      stdio: "ignore",
    },
  );
  child.on("error", () => {});
  child.unref();
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function tryDelivery(envelope) {
  try {
    await sendToRuntime(await readRuntimeInfo(), envelope);
    return true;
  } catch {
    return false;
  }
}

async function send(payload) {
  const envelope = monitorEnvelope(payload);
  if (await tryDelivery(envelope)) {
    return;
  }

  startMonitorDetached();
  const deadline = Date.now() + AUTO_START_WAIT_MS;
  do {
    await delay(AUTO_START_POLL_MS);
    if (await tryDelivery(envelope)) {
      return;
    }
  } while (Date.now() < deadline);

  throw new Error("monitor auto-start delivery timed out");
}

async function main() {
  try {
    await send(await readStdin());
  } catch {
    // Monitoring is fail-open: an unavailable companion must not block Codex.
    debug("delivery_failed");
  }
  process.stdout.write("{}\n");
}

main().catch(() => {
  debug("unexpected_failure");
  process.stdout.write("{}\n");
});
