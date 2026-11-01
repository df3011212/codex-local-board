import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 43127;
export const MAX_EVENT_BODY_BYTES = 64 * 1024;
export const RUNTIME_SCHEMA_VERSION = 1;
export const VIEWER_CREDENTIAL_SCHEMA_VERSION = 1;

const STRONG_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function autoStartPort(env = process.env) {
  const configured = env.CODEX_AGENT_VIEW_AUTO_START_PORT;
  if (configured === undefined || configured === "") {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(configured)) {
    throw new Error("invalid Codex Agent View auto-start port");
  }
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid Codex Agent View auto-start port");
  }
  return port;
}

export function runtimeDirectory(env = process.env) {
  return resolve(
    env.CODEX_AGENT_VIEW_RUNTIME_DIR || join(homedir(), ".codex-agent-view"),
  );
}

export function runtimeFile(env = process.env) {
  return join(runtimeDirectory(env), "runtime.json");
}

export function viewerCredentialFile(env = process.env) {
  return join(runtimeDirectory(env), "viewer-auth.json");
}

export function createRuntimeToken() {
  return randomBytes(32).toString("base64url");
}

function assertStrongToken(token, message) {
  if (typeof token !== "string" || !STRONG_TOKEN_PATTERN.test(token)) {
    throw new Error(message);
  }
}

export async function ensurePrivateDirectory(directory) {
  await rejectSymlink(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await rejectSymlink(directory);
  await chmod(directory, 0o700);
}

async function rejectSymlink(path) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`refusing symbolic link runtime path: ${path}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function requireRegularFile(path, description) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`refusing symbolic link ${description}: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`refusing non-regular ${description}: ${path}`);
  }
}

export async function readViewerToken(env = process.env) {
  const path = viewerCredentialFile(env);
  await rejectSymlink(dirname(path));
  await requireRegularFile(path, "viewer credential path");
  const raw = await readFile(path, "utf8");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid Codex Agent View viewer credential file");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema_version !== VIEWER_CREDENTIAL_SCHEMA_VERSION
  ) {
    throw new Error("invalid Codex Agent View viewer credential file");
  }
  assertStrongToken(
    value.token,
    "invalid Codex Agent View viewer credential file",
  );
  return value.token;
}

export async function ensureViewerToken(
  env = process.env,
  { seedToken = createRuntimeToken() } = {},
) {
  assertStrongToken(seedToken, "invalid Codex Agent View viewer token");

  const path = viewerCredentialFile(env);
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);

  try {
    const token = await readViewerToken(env);
    await chmod(path, 0o600);
    return token;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const temporaryPath = join(
    directory,
    `.viewer-auth-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  const serialized = `${JSON.stringify({
    schema_version: VIEWER_CREDENTIAL_SCHEMA_VERSION,
    token: seedToken,
  }, null, 2)}\n`;

  await writeFile(temporaryPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await chmod(temporaryPath, 0o600);
    try {
      await link(temporaryPath, path);
      await chmod(path, 0o600);
      return seedToken;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const token = await readViewerToken(env);
      await chmod(path, 0o600);
      return token;
    }
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

export async function removeViewerToken(expectedToken, env = process.env) {
  assertStrongToken(expectedToken, "invalid Codex Agent View viewer token");
  const path = viewerCredentialFile(env);
  try {
    const currentToken = await readViewerToken(env);
    if (currentToken !== expectedToken) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeRuntimeInfo(info, env = process.env) {
  const path = runtimeFile(env);
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  await rejectSymlink(path);

  const temporaryPath = join(
    directory,
    `.runtime-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  const serialized = `${JSON.stringify(info, null, 2)}\n`;
  await writeFile(temporaryPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return path;
}

export async function readRuntimeInfo(env = process.env) {
  const path = runtimeFile(env);
  await rejectSymlink(path);
  const raw = await readFile(path, "utf8");
  const value = JSON.parse(raw);
  if (
    value === null ||
    typeof value !== "object" ||
    value.schema_version !== RUNTIME_SCHEMA_VERSION ||
    value.host !== LOOPBACK_HOST ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.token !== "string" ||
    value.token.length < 32
  ) {
    throw new Error("invalid Codex Agent View runtime file");
  }
  if (value.viewer_token !== undefined) {
    assertStrongToken(
      value.viewer_token,
      "invalid Codex Agent View runtime file",
    );
  }
  return value;
}

export async function removeRuntimeInfo(expectedToken, env = process.env) {
  const path = runtimeFile(env);
  try {
    const current = await readRuntimeInfo(env);
    if (current.token !== expectedToken) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
