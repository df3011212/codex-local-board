#!/usr/bin/env node

import {
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startMonitorServer } from "../src/runtime/server.mjs";
import {
  DEFAULT_PORT,
  LOOPBACK_HOST,
  ensureViewerToken,
  readRuntimeInfo,
  readViewerToken,
  removeRuntimeInfo,
  removeViewerToken,
  runtimeDirectory,
  runtimeFile,
  viewerCredentialFile,
} from "../src/runtime/config.mjs";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PLUGIN_ID = "codex-agent-view@codex-agent-view";
const MARKETPLACE_NAME = "codex-agent-view";
const PLUGIN_BUNDLE_RELATIVE_PATH = join("plugins", "codex-agent-view");
const INSTALLED_MARKETPLACE_PLUGIN_SOURCE = "./plugins/codex-agent-view";
const BUNDLE_MARKER = ".codex-agent-view-owned.json";
const BUNDLE_MARKER_SCHEMA_VERSION = 1;
const PREPARE_LIVE_VIEW_WAIT_MS = 2_000;
const PREPARE_LIVE_VIEW_POLL_MS = 40;
const VIEWER_GRANT_TIMEOUT_MS = 1_000;
const MAX_BOOTSTRAP_CREDENTIAL_LENGTH = 1_024;
const SIGNED_BOOTSTRAP_CREDENTIAL_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const OWNERSHIP_PROOF_DOMAIN = "codex-agent-view/runtime-ownership/v1";
const OWNERSHIP_PROOF_TIMEOUT_MS = 1_000;
const EXTERNAL_BROWSER_OPEN_TIMEOUT_MS = 3_000;
const KNOWN_PRE_PROOF_MANAGED_VERSIONS = new Set([
  "0.2.0", "0.2.1",
  "0.3.0", "0.3.1", "0.3.2",
  "0.4.0", "0.4.1", "0.4.2", "0.4.3", "0.4.4", "0.4.5", "0.4.6", "0.4.7",
]);
const CANONICAL_THREAD_ID_PATTERN =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PLUGIN_INSTALL_ENTRIES = [
  ".codex-plugin",
  "assets",
  "bin",
  "hooks",
  "public",
  "scripts",
  "skills",
  "src",
  "LICENSE",
  "NOTICE",
  "README.md",
  "package.json",
];

async function packageVersion() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

function printHelp() {
  process.stdout.write(`Codex Agent View

Usage:
  codex-agent-view start [--port <port>] [--open]
  codex-agent-view open
  codex-agent-view status [--json]
  codex-agent-view doctor [--json]
  codex-agent-view install
  codex-agent-view uninstall [--purge]
  codex-agent-view --version

The monitor is read-only and binds only to 127.0.0.1.
Start prints the local URL without opening an external browser unless --open is set.
Open prepares an authenticated live view and launches it in the default browser.
`);
}

class LiveViewPreparationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseStartArgs(args) {
  let open = false;
  let legacyNoOpen = false;
  let port = DEFAULT_PORT;
  let portSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--open") {
      open = true;
      continue;
    }
    if (argument === "--no-open") {
      legacyNoOpen = true;
      continue;
    }
    if (argument === "--port") {
      if (portSeen) {
        throw new Error("--port may only be specified once");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--port requires a value");
      }
      port = Number(value);
      portSeen = true;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown start option: ${argument}`);
    }
    throw new Error(`unexpected start argument: ${argument}`);
  }

  if (open && legacyNoOpen) {
    throw new Error("--open and --no-open cannot be used together");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }

  return { open, port };
}

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? 1, stderr, stdout };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with ${result.code}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

function externalBrowserCommand(url) {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") {
    return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  }
  return ["xdg-open", [url]];
}

function openExternalBrowser(url) {
  const [command, args] = externalBrowserCommand(url);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: "ignore",
    });
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      settle(reject, new LiveViewPreparationError("browser_open_timeout"));
    }, EXTERNAL_BROWSER_OPEN_TIMEOUT_MS);
    child.once("error", () => {
      settle(reject, new LiveViewPreparationError("browser_open_failed"));
    });
    child.once("close", (code) => {
      if (code === 0) {
        settle(resolvePromise);
        return;
      }
      settle(reject, new LiveViewPreparationError("browser_open_failed"));
    });
  });
}

async function start(args) {
  const options = parseStartArgs(args);

  const runtime = await inspectRuntime();
  if (runtime.kind === "unknown") {
    throw new Error(
      `refusing to replace unrecognized runtime file at ${runtimeFile()}; move it explicitly and retry`,
    );
  }
  if (runtime.kind === "valid" && (await runtimeResponds(runtime.info))) {
    throw new Error("a Codex Agent View monitor is already running; stop it before starting another");
  }

  const viewerToken = await ensureViewerToken();
  const monitor = await startMonitorServer({
    port: options.port,
    viewerToken,
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await monitor.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(`Codex Agent View is running at ${monitor.url}\n`);
  process.stdout.write("Press Ctrl+C to stop the in-memory monitor.\n");
  if (options.open) {
    try {
      await openExternalBrowser(monitor.url);
    } catch (error) {
      await monitor.close();
      throw error;
    }
  }
}

async function fetchState() {
  const runtime = await readRuntimeInfo();
  if ((await runtimeEndpointState(runtime)) !== "owned") {
    throw new Error("the runtime endpoint was not identified as an owned monitor");
  }
  const response = await fetch(`http://${runtime.host}:${runtime.port}/api/state`, {
    headers: { authorization: `Bearer ${runtime.token}` },
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) {
    throw new Error(`monitor returned HTTP ${response.status}`);
  }
  return response.json();
}

async function status(args) {
  const snapshot = await fetchState();
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const agents = sessions.reduce(
    (count, session) => count + (Array.isArray(session.agents) ? session.agents.length : 0),
    0,
  );
  process.stdout.write(`${sessions.length} task(s), ${agents} subagent(s) observed.\n`);
  if (!Number.isFinite(snapshot.updated_at_ms) || snapshot.updated_at_ms <= 0) {
    process.stdout.write(
      "No hook event has reached this monitor yet. The monitor can be healthy while Codex skips an untrusted or not-yet-loaded hook. Run `codex-agent-view doctor`, review `/hooks` in Codex CLI, then use a new task.\n",
    );
  }
  for (const session of sessions) {
    process.stdout.write(`- ${session.session_id}: ${session.status} (${session.agents.length} agents)\n`);
  }
}

function parsePluginList(result) {
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed.installed) ? parsed.installed : [];
  } catch {
    return null;
  }
}

async function inspectInstalledHookBundle(pluginEntry) {
  const sourcePath = pluginEntry?.source?.path;
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return {
      hooks_file: false,
      sender_file: false,
      source_path: null,
      wiring_ok: false,
    };
  }
  const hooksPath = join(sourcePath, "hooks", "hooks.json");
  const senderPath = join(sourcePath, "scripts", "send-hook.mjs");
  const hooks = await readJsonRegularFile(hooksPath);
  const sender = await pathExists(senderPath);
  const hookGroups = hooks?.hooks;
  const expectedEvents = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
  ];
  const hooksFile = hookGroups && typeof hookGroups === "object";
  const declaredEvents = hooksFile
    ? expectedEvents.filter((event) => Array.isArray(hookGroups[event]))
    : [];
  return {
    declared_events: declaredEvents,
    hooks_file: Boolean(hooksFile),
    sender_file: Boolean(sender?.isFile() && !sender.isSymbolicLink()),
    source_path: sourcePath,
    wiring_ok:
      Boolean(hooksFile) &&
      declaredEvents.length === expectedEvents.length &&
      Boolean(sender?.isFile() && !sender.isSymbolicLink()),
  };
}

async function doctor(args) {
  const codex = await run("codex", ["--version"], { allowFailure: true });
  let monitor = { ok: false, message: "not running" };
  try {
    const snapshot = await fetchState();
    monitor = {
      events_received:
        Number.isFinite(snapshot.updated_at_ms) && snapshot.updated_at_ms > 0,
      ok: true,
      sessions: snapshot.sessions?.length || 0,
      updated_at_ms:
        Number.isFinite(snapshot.updated_at_ms) && snapshot.updated_at_ms > 0
          ? snapshot.updated_at_ms
          : null,
    };
  } catch (error) {
    monitor = { ok: false, message: error.message };
  }
  const plugins = await run("codex", ["plugin", "list", "--json"], {
    allowFailure: true,
  });
  const pluginList = parsePluginList(plugins);
  const pluginEntry = pluginList?.find((entry) => entry.pluginId === PLUGIN_ID) || null;
  const hookBundle = await inspectInstalledHookBundle(pluginEntry);
  const diagnostics = [];
  if (codex.code !== 0) {
    diagnostics.push({
      action: "Install or repair Codex CLI so `codex --version` succeeds.",
      code: "codex_cli_unavailable",
      severity: "error",
    });
  }
  if (pluginList === null) {
    diagnostics.push({
      action: "Check `codex plugin list --json` and the installed Codex CLI version.",
      code: "plugin_list_unavailable",
      severity: "error",
    });
  } else if (!pluginEntry) {
    diagnostics.push({
      action: "Run `codex-agent-view install`.",
      code: "plugin_not_installed",
      severity: "error",
    });
  } else if (pluginEntry.enabled !== true) {
    diagnostics.push({
      action: "Enable Codex Agent View in the Codex plugin browser, then start a new task.",
      code: "plugin_disabled",
      severity: "error",
    });
  }
  if (pluginEntry && !hookBundle.wiring_ok) {
    diagnostics.push({
      action: "Run `codex-agent-view install` again to restore the owned plugin bundle.",
      code: "hook_bundle_invalid",
      severity: "error",
    });
  }
  if (pluginEntry && pluginEntry.version !== (await packageVersion())) {
    diagnostics.push({
      action: "Run `codex-agent-view install` to align the installed plugin with this CLI package.",
      code: "plugin_version_mismatch",
      severity: "warning",
    });
  }
  if (!monitor.ok) {
    diagnostics.push({
      action: "Run `codex-agent-view start` before expecting live task events.",
      code: "monitor_not_running",
      severity: "warning",
    });
  }
  if (pluginEntry) {
    diagnostics.push({
      action: "Review the current plugin hook definition in interactive Codex CLI `/hooks`.",
      code: "hook_trust_unverified",
      severity: "info",
    });
  }
  if (monitor.ok && monitor.events_received === false) {
    diagnostics.push({
      action:
        "Open Codex CLI, review and trust the current definition in `/hooks`, then start a new task. Restart a Codex app process that was already open during installation.",
      code: "no_hook_events_observed",
      severity: "warning",
    });
  }
  const report = {
    codex: { ok: codex.code === 0, version: codex.stdout.trim() || null },
    diagnostics,
    hook: {
      ...hookBundle,
      trust: pluginEntry ? "unknown" : "not_applicable",
      trust_note: pluginEntry
        ? "Codex CLI does not expose persisted hook trust through `plugin list --json`; review `/hooks` interactively."
        : null,
    },
    monitor,
    plugin: {
      enabled: pluginEntry?.enabled === true,
      installed: Boolean(pluginEntry),
      source_path: pluginEntry?.source?.path || null,
      version: pluginEntry?.version || null,
    },
    runtime_directory: runtimeDirectory(),
  };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Codex CLI: ${report.codex.ok ? report.codex.version : "not available"}\n`);
  process.stdout.write(
    `Plugin: ${report.plugin.installed ? `installed (${report.plugin.enabled ? "enabled" : "disabled"})` : "not installed"}\n`,
  );
  if (report.plugin.installed) {
    process.stdout.write(`Hook bundle: ${report.hook.wiring_ok ? "valid" : "invalid"}\n`);
    process.stdout.write("Hook trust: unknown (Codex exposes review through interactive `/hooks`)\n");
  }
  process.stdout.write(`Monitor: ${monitor.ok ? "running" : monitor.message}\n`);
  if (monitor.ok) {
    process.stdout.write(`Hook events: ${monitor.events_received ? "observed" : "none observed"}\n`);
  }
  for (const diagnostic of diagnostics) {
    process.stdout.write(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.action}\n`);
  }
}

async function pathExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRuntimeRootIsNotSymlink(root) {
  const stats = await pathExists(root);
  if (stats?.isSymbolicLink()) {
    throw new Error(`refusing symbolic link runtime directory at ${root}`);
  }
}

async function readJsonRegularFile(path) {
  const stats = await pathExists(path);
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function inspectRuntime() {
  const path = runtimeFile();
  const stats = await pathExists(path);
  if (!stats) {
    return { kind: "absent", path };
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { kind: "unknown", path };
  }
  try {
    return { info: await readRuntimeInfo(), kind: "valid", path };
  } catch {
    return { kind: "unknown", path };
  }
}

async function inspectViewerCredential() {
  const path = viewerCredentialFile();
  const stats = await pathExists(path);
  if (!stats) {
    return { kind: "absent", path };
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { kind: "unknown", path };
  }
  try {
    return { kind: "valid", path, token: await readViewerToken() };
  } catch {
    return { kind: "unknown", path };
  }
}

async function revokeViewerCredential(preflight) {
  if (preflight.kind === "absent") {
    return { preserved: false, removed: false };
  }
  if (preflight.kind === "unknown") {
    return { preserved: true, removed: false };
  }
  if (await removeViewerToken(preflight.token)) {
    return { preserved: false, removed: true };
  }
  const current = await inspectViewerCredential();
  return {
    preserved: current.kind !== "absent",
    removed: current.kind === "absent",
  };
}

async function legacyRuntimeEndpointState(runtime) {
  try {
    const response = await fetch(`http://${runtime.host}:${runtime.port}/api/state`, {
      headers: { authorization: `Bearer ${runtime.token}` },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return "unrelated";
    }
    const snapshot = await response.json().catch(() => null);
    return snapshot?.schema_version === 1 && snapshot?.source_of_truth === "hook"
      ? "owned"
      : "unrelated";
  } catch {
    return "absent";
  }
}

async function runtimeEndpointState(
  runtime,
  { allowLegacyBearerProbe = false } = {},
) {
  const ownership = await runtimeOwnershipState(runtime);
  if (ownership !== "unrelated" || !allowLegacyBearerProbe) {
    return ownership;
  }
  return legacyRuntimeEndpointState(runtime);
}

async function runtimeResponds(runtime, options) {
  return (await runtimeEndpointState(runtime, options)) === "owned";
}

function expectedOwnershipProof(nonce, runtimeToken) {
  return createHmac("sha256", runtimeToken)
    .update(OWNERSHIP_PROOF_DOMAIN)
    .update("\0")
    .update(nonce)
    .digest("base64url");
}

async function runtimeOwnershipState(runtime) {
  const nonce = randomBytes(32).toString("base64url");
  let response;
  try {
    response = await fetch(
      `http://${runtime.host}:${runtime.port}/api/internal/ownership-proof`,
      {
        body: JSON.stringify({ nonce }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(OWNERSHIP_PROOF_TIMEOUT_MS),
      },
    );
  } catch {
    return "absent";
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    return "unrelated";
  }
  const payload = await response.json().catch(() => null);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(",") !== "proof,status" ||
    payload.status !== "owned" ||
    typeof payload.proof !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.proof)
  ) {
    return "unrelated";
  }
  const supplied = Buffer.from(payload.proof);
  const expected = Buffer.from(expectedOwnershipProof(nonce, runtime.token));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? "owned"
    : "unrelated";
}

async function inspectInstalledBundleForLiveView() {
  const destination = join(runtimeDirectory(), "marketplace");
  const stats = await pathExists(destination);
  if (!stats) {
    throw new LiveViewPreparationError("plugin_not_installed");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LiveViewPreparationError("plugin_bundle_unowned");
  }

  const marker = await readJsonRegularFile(join(destination, BUNDLE_MARKER));
  if (
    marker?.schema_version !== BUNDLE_MARKER_SCHEMA_VERSION ||
    marker?.package !== MARKETPLACE_NAME ||
    marker?.plugin_id !== PLUGIN_ID
  ) {
    throw new LiveViewPreparationError("plugin_bundle_unowned");
  }

  const installedBundle = await inspectManagedBundleLayout(destination);
  if (installedBundle === null) {
    throw new LiveViewPreparationError("plugin_bundle_invalid");
  }
  if (installedBundle.version !== (await packageVersion())) {
    throw new LiveViewPreparationError("plugin_version_mismatch");
  }
}

function autoStartEnvironment() {
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
    [fileURLToPath(new URL("../scripts/auto-start-monitor.mjs", import.meta.url))],
    {
      detached: true,
      env: autoStartEnvironment(),
      shell: false,
      stdio: "ignore",
    },
  );
  child.on("error", () => {});
  child.unref();
}

async function liveViewRuntimeState() {
  const runtime = await inspectRuntime();
  if (runtime.kind === "unknown") {
    throw new LiveViewPreparationError("runtime_record_invalid");
  }
  if (runtime.kind === "absent") {
    return { kind: "not_running" };
  }
  const endpoint = await runtimeOwnershipState(runtime.info);
  if (endpoint === "owned") {
    return { info: runtime.info, kind: "owned" };
  }
  if (endpoint === "absent") {
    return { kind: "not_running" };
  }
  throw new LiveViewPreparationError("unowned_runtime");
}

function inheritedExcludedSessionId() {
  const inheritedThreadId = process.env.CODEX_THREAD_ID;
  return (
    typeof inheritedThreadId === "string" &&
    CANONICAL_THREAD_ID_PATTERN.test(inheritedThreadId)
      ? inheritedThreadId.toLowerCase()
      : null
  );
}

async function requestViewerGrant(runtime, excludeSessionId) {
  let response;
  try {
    response = await fetch(
      `http://${runtime.host}:${runtime.port}/api/internal/viewer-grant`,
      {
        body: JSON.stringify({ exclude_session_id: excludeSessionId }),
        headers: {
          authorization: `Bearer ${runtime.token}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(VIEWER_GRANT_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new LiveViewPreparationError(
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "viewer_grant_timeout"
        : "viewer_grant_unavailable",
    );
  }
  if (response.status !== 201) {
    await response.body?.cancel();
    throw new LiveViewPreparationError("viewer_grant_rejected");
  }
  const payload = await response.json().catch(() => null);
  const credential = payload?.bootstrap_credential;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(",") !==
      "bootstrap_credential,expires_in_ms,status" ||
    payload.status !== "granted" ||
    payload.expires_in_ms !== 60_000 ||
    typeof credential !== "string" ||
    credential.length > MAX_BOOTSTRAP_CREDENTIAL_LENGTH ||
    !SIGNED_BOOTSTRAP_CREDENTIAL_PATTERN.test(credential) ||
    credential === runtime.token ||
    credential === runtime.viewer_token
  ) {
    throw new LiveViewPreparationError("viewer_grant_invalid_response");
  }
  return credential;
}

function liveViewTarget(runtime, bootstrapCredential) {
  return `http://${LOOPBACK_HOST}:${runtime.port}/#grant=${encodeURIComponent(bootstrapCredential)}`;
}

async function prepareLiveViewTarget(args) {
  if (args.length > 0) {
    throw new LiveViewPreparationError("invalid_arguments");
  }
  await inspectInstalledBundleForLiveView();
  let runtime = await liveViewRuntimeState();
  if (runtime.kind !== "owned") {
    startMonitorDetached();
    const deadline = Date.now() + PREPARE_LIVE_VIEW_WAIT_MS;
    do {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, PREPARE_LIVE_VIEW_POLL_MS),
      );
      runtime = await liveViewRuntimeState();
      if (runtime.kind === "owned") break;
    } while (Date.now() < deadline);
  }
  if (runtime.kind !== "owned") {
    throw new LiveViewPreparationError("monitor_start_timeout");
  }
  const bootstrapCredential = await requestViewerGrant(
    runtime.info,
    inheritedExcludedSessionId(),
  );
  return liveViewTarget(runtime.info, bootstrapCredential);
}

async function openLiveView(args) {
  try {
    const target = await prepareLiveViewTarget(args);
    await openExternalBrowser(target);
    process.stdout.write("Codex Agent View opened in the default browser.\n");
  } catch (error) {
    const code = error instanceof LiveViewPreparationError
      ? error.code
      : "live_view_open_failed";
    process.stderr.write(`codex-agent-view: live view open failed (${code})\n`);
    process.exitCode = 1;
  }
}

async function stopRunningRuntime(preflight, options = {}) {
  if (preflight.kind !== "valid") {
    return false;
  }
  const endpointState = await runtimeEndpointState(preflight.info, options);
  if (endpointState === "absent") {
    return false;
  }
  if (endpointState === "unrelated") {
    throw new Error(
      "the runtime endpoint was not identified as an owned monitor; plugin and runtime files were preserved",
    );
  }

  let response;
  try {
    response = await fetch(
      `http://${preflight.info.host}:${preflight.info.port}/api/internal/shutdown`,
      {
        headers: { authorization: `Bearer ${preflight.info.token}` },
        method: "POST",
        signal: AbortSignal.timeout(1_500),
      },
    );
  } catch {
    throw new Error("the owned monitor could not be stopped; plugin files were preserved");
  }
  if (!response.ok) {
    throw new Error(
      `the owned monitor refused shutdown with HTTP ${response.status}; plugin files were preserved`,
    );
  }
  const result = await response.json().catch(() => null);
  if (result?.status !== "shutting_down") {
    throw new Error(
      "the owned monitor returned an invalid shutdown response; plugin files were preserved",
    );
  }

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const current = await inspectRuntime();
    if (current.kind === "absent") {
      return true;
    }
    if (current.kind === "unknown") {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      continue;
    }
    if (current.info.token !== preflight.info.token) {
      throw new Error(
        "runtime ownership changed during uninstall; new or unrecognized runtime data was preserved",
      );
    }
    if (!(await runtimeResponds(current.info, options))) {
      await removeRuntimeInfo(current.info.token);
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("the owned monitor did not stop in time; plugin files were preserved");
}

async function inspectPluginBundle(destination) {
  const stats = await pathExists(destination);
  if (!stats) {
    return { kind: "absent" };
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return { kind: "unmanaged" };
  }

  const marker = await readJsonRegularFile(join(destination, BUNDLE_MARKER));
  if (
    marker?.schema_version !== BUNDLE_MARKER_SCHEMA_VERSION ||
    marker?.package !== MARKETPLACE_NAME ||
    marker?.plugin_id !== PLUGIN_ID
  ) {
    return { kind: "unmanaged" };
  }
  const installedBundle = await inspectManagedBundleLayout(destination);
  if (installedBundle === null) {
    return { kind: "unmanaged" };
  }
  return {
    kind: "managed",
    layout: installedBundle.layout,
    version: installedBundle.version,
  };
}

async function inspectManagedBundleLayout(destination) {
  const candidates = [
    {
      layout: "subdirectory",
      path: join(destination, PLUGIN_BUNDLE_RELATIVE_PATH, ".codex-plugin", "plugin.json"),
    },
    {
      layout: "legacy-root",
      path: join(destination, ".codex-plugin", "plugin.json"),
    },
  ];
  const matches = [];
  for (const candidate of candidates) {
    const manifest = await readJsonRegularFile(candidate.path);
    if (
      manifest?.name === MARKETPLACE_NAME &&
      typeof manifest.version === "string"
    ) {
      matches.push({ layout: candidate.layout, version: manifest.version });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function legacyBearerProbeOptions(bundle) {
  return {
    allowLegacyBearerProbe:
      bundle.kind === "managed" &&
      KNOWN_PRE_PROOF_MANAGED_VERSIONS.has(bundle.version),
  };
}

function unmanagedBundleError(destination) {
  return new Error(
    `refusing to replace or remove unmanaged directory at ${destination}; its files were preserved`,
  );
}

async function removeManagedPluginBundle(destination) {
  const bundle = await inspectPluginBundle(destination);
  if (bundle.kind === "unmanaged") {
    throw unmanagedBundleError(destination);
  }
  if (bundle.kind === "managed") {
    await rm(destination, { force: true, recursive: true });
  }
}

async function copyPluginBundle(destination) {
  const root = runtimeDirectory();
  if (dirname(destination) !== root || destination === root) {
    throw new Error("refusing unsafe plugin destination");
  }
  await assertRuntimeRootIsNotSymlink(root);
  const existing = await inspectPluginBundle(destination);
  if (existing.kind === "unmanaged") {
    throw unmanagedBundleError(destination);
  }
  if (existing.kind === "managed") {
    await rm(destination, { force: true, recursive: true });
  }
  await mkdir(destination, { mode: 0o700, recursive: true });
  await cp(join(PACKAGE_ROOT, ".agents"), join(destination, ".agents"), {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
  const installedCatalogPath = join(destination, ".agents", "plugins", "marketplace.json");
  const installedCatalog = JSON.parse(await readFile(installedCatalogPath, "utf8"));
  const installedEntry = installedCatalog?.plugins?.find(
    (entry) => entry?.name === MARKETPLACE_NAME,
  );
  if (installedEntry?.source?.source !== "local") {
    throw new Error("the bundled marketplace catalog is invalid");
  }
  installedEntry.source.path = INSTALLED_MARKETPLACE_PLUGIN_SOURCE;
  await writeFile(installedCatalogPath, `${JSON.stringify(installedCatalog, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
  const pluginDestination = join(destination, PLUGIN_BUNDLE_RELATIVE_PATH);
  await mkdir(pluginDestination, { mode: 0o700, recursive: true });
  for (const entry of PLUGIN_INSTALL_ENTRIES) {
    const source = join(PACKAGE_ROOT, entry);
    if (!(await pathExists(source))) continue;
    await cp(source, join(pluginDestination, entry), {
      errorOnExist: true,
      force: false,
      recursive: true,
    });
  }
  await writeFile(
    join(destination, BUNDLE_MARKER),
    `${JSON.stringify(
      {
        package: MARKETPLACE_NAME,
        plugin_id: PLUGIN_ID,
        schema_version: BUNDLE_MARKER_SCHEMA_VERSION,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

async function configuredMarketplaces() {
  const result = await run("codex", ["plugin", "marketplace", "list", "--json"]);
  return JSON.parse(result.stdout).marketplaces || [];
}

async function install() {
  const destination = join(runtimeDirectory(), "marketplace");
  const marketplaces = await configuredMarketplaces();
  const existing = marketplaces.find((entry) => entry.name === MARKETPLACE_NAME);
  if (existing && resolve(existing.root) !== resolve(destination)) {
    throw new Error(
      `marketplace ${MARKETPLACE_NAME} already points to ${existing.root}; remove it explicitly before installing this npm bundle`,
    );
  }
  const bundle = await inspectPluginBundle(destination);
  if (bundle.kind === "unmanaged") {
    throw unmanagedBundleError(destination);
  }
  const runtime = await inspectRuntime();
  const seedToken = runtime.kind === "valid"
    ? runtime.info.viewer_token || runtime.info.token
    : undefined;
  await ensureViewerToken(process.env, { seedToken });
  if (runtime.kind === "valid") {
    await stopRunningRuntime(runtime, legacyBearerProbeOptions(bundle));
  }
  await copyPluginBundle(destination);
  if (!existing) {
    await run("codex", ["plugin", "marketplace", "add", destination, "--json"]);
  }
  await run("codex", ["plugin", "add", PLUGIN_ID, "--json"]);
  const verification = await run("codex", ["plugin", "list", "--json"], {
    allowFailure: true,
  });
  const installed = parsePluginList(verification)?.find(
    (entry) => entry.pluginId === PLUGIN_ID,
  );
  if (!installed) {
    throw new Error(
      "Codex did not report the plugin as installed after registration; run `codex-agent-view doctor` for details",
    );
  }
  if (installed.enabled !== true) {
    throw new Error(
      "the plugin was registered but is disabled; enable it in the Codex plugin browser, then run `codex-agent-view doctor`",
    );
  }
  process.stdout.write(`Installed ${PLUGIN_ID} from ${destination}.\n`);
  process.stdout.write("Registration verified: installed and enabled.\n");
  process.stdout.write(
    "Hook trust cannot be granted or inspected non-interactively. Review and trust this plugin's current hook definition in Codex CLI `/hooks`.\n",
  );
  process.stdout.write(
    "If Codex was already open during installation, restart it completely, then create a new task.\n",
  );
}

function isBroadRuntimeRoot(root) {
  const normalized = resolve(root);
  return (
    dirname(normalized) === normalized ||
    normalized === resolve(homedir()) ||
    normalized === resolve(process.cwd()) ||
    normalized === PACKAGE_ROOT
  );
}

async function purgeStaleRuntime(preflight, options = {}) {
  if (preflight.kind !== "valid") {
    return preflight.kind === "unknown";
  }

  const current = await inspectRuntime();
  if (current.kind === "absent") {
    return false;
  }
  if (current.kind !== "valid" || current.info.token !== preflight.info.token) {
    return true;
  }
  const endpointState = await runtimeEndpointState(current.info, options);
  if (endpointState === "owned") {
    throw new Error("the Codex Agent View monitor started during uninstall; runtime data was preserved");
  }
  if (endpointState === "unrelated") {
    return true;
  }
  await removeRuntimeInfo(current.info.token);
  return false;
}

async function removeRuntimeRootIfEmpty(root) {
  if (isBroadRuntimeRoot(root)) {
    return false;
  }
  try {
    await rmdir(root);
    return true;
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      error?.code === "ENOTEMPTY" ||
      error?.code === "EEXIST" ||
      error?.code === "ENOTDIR" ||
      error?.code === "EBUSY"
    ) {
      return false;
    }
    throw error;
  }
}

function parseUninstallArgs(args) {
  let purge = false;

  for (const argument of args) {
    if (argument === "--purge") {
      if (purge) {
        throw new Error("--purge may only be specified once");
      }
      purge = true;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown uninstall option: ${argument}`);
    }
    throw new Error(`unexpected uninstall argument: ${argument}`);
  }

  return { purge };
}

async function uninstall(args) {
  const { purge } = parseUninstallArgs(args);
  const root = runtimeDirectory();
  const bundle = join(root, "marketplace");
  if (dirname(bundle) !== root || bundle === root) {
    throw new Error("refusing unsafe plugin destination");
  }
  await assertRuntimeRootIsNotSymlink(root);
  const bundlePreflight = await inspectPluginBundle(bundle);
  if (bundlePreflight.kind === "unmanaged") {
    throw unmanagedBundleError(bundle);
  }

  const runtimePreflight = await inspectRuntime();
  const viewerPreflight = await inspectViewerCredential();
  const lifecycleProbeOptions = legacyBearerProbeOptions(bundlePreflight);
  const stoppedMonitor = await stopRunningRuntime(
    runtimePreflight,
    lifecycleProbeOptions,
  );

  await run("codex", ["plugin", "remove", PLUGIN_ID, "--json"], { allowFailure: true });
  await run("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"], {
    allowFailure: true,
  });
  await removeManagedPluginBundle(bundle);
  const viewerCredential = await revokeViewerCredential(viewerPreflight);
  if (purge) {
    const preservedRuntimeFile = await purgeStaleRuntime(
      runtimePreflight,
      lifecycleProbeOptions,
    );
    const removedRoot = await removeRuntimeRootIfEmpty(root);
    if (removedRoot) {
      process.stdout.write(`Removed plugin, marketplace, and runtime data from ${root}.\n`);
    } else {
      process.stdout.write(
        `Removed owned plugin and stale runtime files. Unrelated or unrecognized files at ${root} were preserved; review them before manual removal.\n`,
      );
    }
    if (preservedRuntimeFile) {
      process.stdout.write(
        `The unrecognized runtime file at ${runtimeFile()} was preserved.\n`,
      );
    }
    if (viewerCredential.preserved) {
      process.stdout.write(
        "The unrecognized or changed viewer credential was preserved for manual review.\n",
      );
    }
  } else {
    process.stdout.write(
      stoppedMonitor
        ? "Stopped the owned monitor and removed the plugin and marketplace bundle.\n"
        : "Removed plugin and marketplace bundle. Runtime data was preserved.\n",
    );
    if (viewerCredential.preserved) {
      process.stdout.write(
        "The unrecognized or changed viewer credential was preserved for manual review.\n",
      );
    }
  }
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${await packageVersion()}\n`);
  } else if (command === "start") {
    await start(args);
  } else if (command === "open") {
    await openLiveView(args);
  } else if (command === "status") {
    await status(args);
  } else if (command === "doctor") {
    await doctor(args);
  } else if (command === "install") {
    await install(args);
  } else if (command === "uninstall") {
    await uninstall(args);
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    printHelp();
    throw new Error(`unknown command: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`codex-agent-view: ${error.message}\n`);
  process.exitCode = 1;
});
