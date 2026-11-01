#!/usr/bin/env node

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { startMonitorServer } from "../src/runtime/server.mjs";
import {
  autoStartPort,
  ensureViewerToken,
  readRuntimeInfo,
} from "../src/runtime/config.mjs";

const HEALTH_TIMEOUT_MS = 350;
const OWNER_CHECK_INTERVAL_MS = 1_000;
const OWNER_FILE = fileURLToPath(
  new URL("../.codex-plugin/plugin.json", import.meta.url),
);

async function currentMonitorIsHealthy() {
  try {
    const runtime = await readRuntimeInfo();
    const response = await fetch(
      `http://${runtime.host}:${runtime.port}/api/state`,
      {
        headers: { authorization: `Bearer ${runtime.token}` },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  let monitor;
  let ownerCheck;
  let stopRequested = false;
  let stopping = false;
  const stop = async () => {
    stopRequested = true;
    if (!monitor || stopping) {
      return;
    }
    stopping = true;
    clearInterval(ownerCheck);
    try {
      await monitor.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (await currentMonitorIsHealthy()) {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    return;
  }

  try {
    const viewerToken = await ensureViewerToken();
    monitor = await startMonitorServer({
      port: autoStartPort(),
      viewerToken,
    });
  } catch (error) {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    throw error;
  }
  if (stopRequested) {
    await stop();
    return;
  }

  // An npm/plugin uninstall removes this owned bundle. The detached monitor
  // then shuts itself down and removes only the runtime file it still owns.
  ownerCheck = setInterval(async () => {
    try {
      await access(OWNER_FILE);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        await stop();
      }
    }
  }, OWNER_CHECK_INTERVAL_MS);
  ownerCheck.unref();
}

// Auto-start is an internal hook implementation detail. It must never write a
// tokenized URL, a local path, or hook-derived data to stdout/stderr.
main().catch(() => {
  process.exitCode = 0;
});
