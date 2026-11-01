import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createMonitorStore } from "../core/index.mjs";
import {
  DEFAULT_PORT,
  LOOPBACK_HOST,
  MAX_EVENT_BODY_BYTES,
  RUNTIME_SCHEMA_VERSION,
  createRuntimeToken,
  removeRuntimeInfo,
  writeRuntimeInfo,
} from "./config.mjs";

const STATIC_FILES = new Map([
  ["/", { url: new URL("../../public/index.html", import.meta.url), type: "text/html; charset=utf-8" }],
  ["/assets/app.js", { url: new URL("../../public/app.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/assets/styles.css", { url: new URL("../../public/styles.css", import.meta.url), type: "text/css; charset=utf-8" }],
]);

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const RECOVERY_HEADER = "x-codex-agent-view-recovery";
const ACCESS_HEADER = "x-codex-agent-view-access";
const BOOTSTRAP_SCOPE = "viewer_bootstrap";
const RECOVERY_SCOPE = "viewer_recovery";
const ACCESS_SCOPE = "viewer_access";
const BOOTSTRAP_TTL_MS = 60 * 1_000;
const RECOVERY_TTL_MS = 30 * 60 * 1_000;
const ACCESS_TTL_MS = 15 * 60 * 1_000;
const MAX_SIGNED_CREDENTIAL_LENGTH = 1_024;
const MAX_USED_BOOTSTRAP_GRANTS = 256;
const OWNERSHIP_PROOF_DOMAIN = "codex-agent-view/runtime-ownership/v1";
const OWNERSHIP_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sendJson(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function isOriginFormRequestTarget(value) {
  return (
    typeof value === "string" &&
    /^\/(?!\/)/.test(value) &&
    !value.includes("\\")
  );
}

function hasToken(request, token) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function signCredential(payload, signingToken) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingToken)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function createSignedCredential({
  audience,
  excludeSessionId = null,
  grantId,
  familyExpiresAtMs,
  nowMs,
  scope,
  ttlMs,
  signingToken,
}) {
  const expiresAtMs = Math.min(nowMs + ttlMs, familyExpiresAtMs);
  const payload = {
    aud: audience,
    exclude_session_id: excludeSessionId,
    exp: expiresAtMs,
    family_exp: familyExpiresAtMs,
    scope,
    v: 1,
  };
  if (scope === BOOTSTRAP_SCOPE) {
    payload.jti = grantId;
  }
  return {
    credential: signCredential(payload, signingToken),
    expiresAtMs,
  };
}

function validateSignedCredential(
  credential,
  { audience, nowMs, scope, ttlMs, signingToken },
) {
  if (
    typeof credential !== "string" ||
    credential.length === 0 ||
    credential.length > MAX_SIGNED_CREDENTIAL_LENGTH
  ) {
    return null;
  }
  const parts = credential.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    return null;
  }
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = createHmac("sha256", signingToken)
    .update(encodedPayload)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const expectedKeys = scope === BOOTSTRAP_SCOPE
    ? "aud,exclude_session_id,exp,family_exp,jti,scope,v"
    : "aud,exclude_session_id,exp,family_exp,scope,v";
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(",") !== expectedKeys ||
    payload.v !== 1 ||
    payload.scope !== scope ||
    payload.aud !== audience ||
    !(
      payload.exclude_session_id === null ||
      (
        typeof payload.exclude_session_id === "string" &&
        CANONICAL_SESSION_ID_PATTERN.test(payload.exclude_session_id)
      )
    ) ||
    (scope === BOOTSTRAP_SCOPE && !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)) ||
    !Number.isSafeInteger(payload.exp) ||
    !Number.isSafeInteger(payload.family_exp) ||
    payload.exp <= nowMs ||
    payload.exp > nowMs + ttlMs ||
    payload.family_exp <= nowMs ||
    payload.exp > payload.family_exp
  ) {
    return null;
  }
  return payload;
}

function createOwnershipProof(nonce, runtimeToken) {
  return createHmac("sha256", runtimeToken)
    .update(OWNERSHIP_PROOF_DOMAIN)
    .update("\0")
    .update(nonce)
    .digest("base64url");
}

function bearerValue(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return "";
  }
  return authorization.slice("Bearer ".length);
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_EVENT_BODY_BYTES) {
      const error = new Error("event body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (bytes === 0) {
    const error = new Error("event body is required");
    error.statusCode = 400;
    throw error;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("event body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

export async function startMonitorServer({
  host = LOOPBACK_HOST,
  port = DEFAULT_PORT,
  env = process.env,
  store = createMonitorStore(),
  token = createRuntimeToken(),
  viewerToken = createRuntimeToken(),
  now = Date.now,
} = {}) {
  if (host !== LOOPBACK_HOST) {
    throw new Error(`monitor server must bind to ${LOOPBACK_HOST}`);
  }

  const usedBootstrapGrants = new Map();
  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        sendJson(response, 503, { error: "monitor unavailable" });
        return;
      }
      const audience = `http://${LOOPBACK_HOST}:${address.port}`;
      const exactHost = `${LOOPBACK_HOST}:${address.port}`;
      if (
        request.headers.host !== exactHost ||
        !isOriginFormRequestTarget(request.url)
      ) {
        sendJson(response, 421, { error: "exact monitor authority required" });
        return;
      }

      const requestUrl = new URL(request.url, audience);
      const nowMs = now();
      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/internal/ownership-proof"
      ) {
        if (request.headers["content-type"] !== "application/json") {
          sendJson(response, 415, { error: "application/json required" });
          return;
        }
        const payload = await readJsonBody(request);
        if (
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          Object.keys(payload).join(",") !== "nonce" ||
          !OWNERSHIP_NONCE_PATTERN.test(payload.nonce)
        ) {
          sendJson(response, 400, { error: "invalid ownership challenge" });
          return;
        }
        sendJson(response, 200, {
          proof: createOwnershipProof(payload.nonce, token),
          status: "owned",
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/internal/viewer-grant"
      ) {
        if (!hasToken(request, token)) {
          sendJson(response, 401, { error: "authorization required" });
          return;
        }
        if (request.headers["content-type"] !== "application/json") {
          sendJson(response, 415, { error: "application/json required" });
          return;
        }
        const payload = await readJsonBody(request);
        if (
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          Object.keys(payload).join(",") !== "exclude_session_id" ||
          !(
            payload.exclude_session_id === null ||
            (
              typeof payload.exclude_session_id === "string" &&
              CANONICAL_SESSION_ID_PATTERN.test(payload.exclude_session_id)
            )
          )
        ) {
          sendJson(response, 400, { error: "invalid viewer grant request" });
          return;
        }
        const familyExpiresAtMs = nowMs + RECOVERY_TTL_MS;
        const bootstrap = createSignedCredential({
          audience,
          excludeSessionId: payload.exclude_session_id,
          familyExpiresAtMs,
          grantId: createRuntimeToken(),
          nowMs,
          scope: BOOTSTRAP_SCOPE,
          ttlMs: BOOTSTRAP_TTL_MS,
          signingToken: token,
        });
        sendJson(response, 201, {
          bootstrap_credential: bootstrap.credential,
          expires_in_ms: BOOTSTRAP_TTL_MS,
          status: "granted",
        });
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/state"
      ) {
        const suppliedBearer = bearerValue(request);
        const accessPayload = validateSignedCredential(suppliedBearer, {
          audience,
          nowMs,
          scope: ACCESS_SCOPE,
          ttlMs: ACCESS_TTL_MS,
          signingToken: viewerToken,
        });
        const runtimeAuthorized = hasToken(request, token);
        const rootViewerAuthorized = hasToken(request, viewerToken);
        if (
          !runtimeAuthorized &&
          !rootViewerAuthorized &&
          !accessPayload
        ) {
          sendJson(response, 401, { error: "authorization required" });
          return;
        }
        const requestedExclusion = request.headers["x-codex-agent-view-exclude-session"];
        const excludeSessionId = accessPayload?.exclude_session_id ?? (
          rootViewerAuthorized &&
          typeof requestedExclusion === "string" &&
          CANONICAL_SESSION_ID_PATTERN.test(requestedExclusion)
            ? requestedExclusion
            : null
        );
        const extraHeaders = {};
        if (rootViewerAuthorized || accessPayload) {
          const familyExpiresAtMs = accessPayload?.family_exp ?? (
            nowMs + RECOVERY_TTL_MS
          );
          const access = createSignedCredential({
            audience,
            excludeSessionId,
            familyExpiresAtMs,
            nowMs,
            scope: ACCESS_SCOPE,
            ttlMs: ACCESS_TTL_MS,
            signingToken: viewerToken,
          });
          extraHeaders[ACCESS_HEADER] = access.credential;
        }
        if (rootViewerAuthorized) {
          const familyExpiresAtMs = nowMs + RECOVERY_TTL_MS;
          const recovery = createSignedCredential({
            audience,
            excludeSessionId,
            familyExpiresAtMs,
            nowMs,
            scope: RECOVERY_SCOPE,
            ttlMs: RECOVERY_TTL_MS,
            signingToken: viewerToken,
          });
          extraHeaders[RECOVERY_HEADER] = recovery.credential;
        }
        sendJson(response, 200, store.getSnapshot(), {
          ...extraHeaders,
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/viewer/exchange"
      ) {
        if (
          request.headers.origin !== audience ||
          (
            request.headers["sec-fetch-site"] !== undefined &&
            request.headers["sec-fetch-site"] !== "same-origin"
          )
        ) {
          sendJson(response, 403, { error: "same-origin request required" });
          return;
        }
        if (request.headers["content-type"] !== "application/json") {
          sendJson(response, 415, { error: "application/json required" });
          return;
        }
        const payload = await readJsonBody(request);
        const exactPayload =
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          Object.keys(payload).join(",") !== "credential";
        const bootstrapPayload = exactPayload ? null : validateSignedCredential(
          payload.credential,
          {
            audience,
            nowMs,
            scope: BOOTSTRAP_SCOPE,
            ttlMs: BOOTSTRAP_TTL_MS,
            signingToken: token,
          },
        );
        const recoveryPayload = exactPayload || bootstrapPayload
          ? null
          : validateSignedCredential(payload.credential, {
            audience,
            nowMs,
            scope: RECOVERY_SCOPE,
            ttlMs: RECOVERY_TTL_MS,
            signingToken: viewerToken,
          });
        const credentialPayload = bootstrapPayload || recoveryPayload;
        if (!credentialPayload) {
          sendJson(response, 401, { error: "viewer exchange authorization required" });
          return;
        }
        if (bootstrapPayload) {
          for (const [grantId, expiresAtMs] of usedBootstrapGrants) {
            if (expiresAtMs <= nowMs) usedBootstrapGrants.delete(grantId);
          }
          if (usedBootstrapGrants.has(bootstrapPayload.jti)) {
            sendJson(response, 409, { error: "viewer grant already used" });
            return;
          }
          if (usedBootstrapGrants.size >= MAX_USED_BOOTSTRAP_GRANTS) {
            sendJson(response, 503, { error: "viewer grant capacity reached" });
            return;
          }
          usedBootstrapGrants.set(bootstrapPayload.jti, bootstrapPayload.exp);
        }
        const excludeSessionId = credentialPayload.exclude_session_id;
        const access = createSignedCredential({
          audience,
          excludeSessionId,
          familyExpiresAtMs: credentialPayload.family_exp,
          nowMs,
          scope: ACCESS_SCOPE,
          ttlMs: ACCESS_TTL_MS,
          signingToken: viewerToken,
        });
        const recovery = createSignedCredential({
          audience,
          excludeSessionId,
          familyExpiresAtMs: credentialPayload.family_exp,
          nowMs,
          scope: RECOVERY_SCOPE,
          ttlMs: RECOVERY_TTL_MS,
          signingToken: viewerToken,
        });
        sendJson(response, 200, {
          access_credential: access.credential,
          access_expires_in_ms: access.expiresAtMs - nowMs,
          excluded_session_id: excludeSessionId,
          recovery_credential: recovery.credential,
          recovery_expires_in_ms: recovery.expiresAtMs - nowMs,
          status: "exchanged",
        });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/") && !hasToken(request, token)) {
        sendJson(response, 401, { error: "authorization required" });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/events") {
        const payload = await readJsonBody(request);
        const result = store.ingest(payload, { receivedAtMs: now() });
        sendJson(response, 202, { status: result.status });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/internal/shutdown"
      ) {
        response.once("finish", () => {
          queueMicrotask(() => {
            void close().catch(() => {});
          });
        });
        sendJson(response, 202, { status: "shutting_down" });
        return;
      }

      const asset = request.method === "GET" ? STATIC_FILES.get(requestUrl.pathname) : null;
      if (asset) {
        const body = await readFile(fileURLToPath(asset.url));
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": asset.type,
        });
        response.end(body);
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, error?.statusCode || 500, {
        error: error?.statusCode ? error.message : "internal server error",
      });
    }
  });

  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 2_000;
  server.maxHeadersCount = 64;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("monitor server did not expose a TCP address");
  }

  const runtimeInfo = {
    schema_version: RUNTIME_SCHEMA_VERSION,
    host,
    port: address.port,
    token,
    viewer_token: viewerToken,
    pid: process.pid,
    started_at_ms: now(),
  };
  try {
    await writeRuntimeInfo(runtimeInfo, env);
  } catch (error) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    throw error;
  }

  let closePromise = null;
  async function close() {
    if (closePromise) {
      return closePromise;
    }
    closePromise = (async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections?.();
      });
      await removeRuntimeInfo(token, env);
    })();
    return closePromise;
  }

  return {
    close,
    runtimeInfo,
    server,
    store,
    url: `http://${host}:${address.port}/#token=${encodeURIComponent(viewerToken)}`,
  };
}
