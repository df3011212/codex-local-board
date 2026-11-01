const NORMALIZED_EVENT_TYPES = Object.freeze({
  PermissionRequest: "permission_requested",
  PostToolUse: "tool_completed",
  PreToolUse: "tool_started",
  SessionEnd: "session_ended",
  SessionStart: "session_started",
  Stop: "turn_stopped",
  SubagentStart: "subagent_started",
  SubagentStop: "subagent_stopped",
  UserPromptSubmit: "turn_started",
});

const SESSION_EVENT_TYPES = new Set(["session_started", "session_ended"]);
const SESSION_START_SOURCES = new Set([
  "startup",
  "resume",
  "clear",
  "compact",
]);

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;
const MAX_WORKSPACE_LABEL_LENGTH = 120;
const MAX_PROMPT_INSPECTION_LENGTH = 4_096;
const MAX_TASK_SUMMARY_LENGTH = 180;
const OBSERVED_SPAWN_AGENT_TOOL_NAME = "collaborationspawn_agent";
const AMBIENT_BROWSER_CONTEXT_OPEN =
  '<in-app-browser-context source="ambient-ui-state">';
const AMBIENT_BROWSER_CONTEXT_CLOSE = "</in-app-browser-context>";
const USER_REQUEST_DELIMITER = "## My request for Codex:";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f-\u009f]/g;

const URL =
  /\b[A-Z][A-Z0-9+.-]*:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/giu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const LABELED_CREDENTIAL =
  /\b(?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|credential|key|password|passwd|private[_-]?key|refresh[_-]?token|secret|token)\b\s*(?:=|:)\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu;
const BEARER_CREDENTIAL = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu;
const PREFIXED_SECRET =
  /\b(?:AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/gu;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/giu;
const WINDOWS_ABSOLUTE_PATH =
  /(^|[\s("'`=:[{])[A-Za-z]:[\\/][^\s<>"'`)\]},;]*/gu;
const UNC_ABSOLUTE_PATH =
  /(^|[\s("'`=:[{])\\\\[^\s<>"'`)\]},;]+(?:\\[^\s<>"'`)\]},;]+)+/gu;
const POSIX_ABSOLUTE_PATH =
  /(^|[\s("'`=:[{])\/(?!\/)[^\s<>"'`)\]},;]*(?:\/[^\s<>"'`)\]},;]+)*/gu;
const OPAQUE_SINGLE_TOKEN = /^[A-Za-z0-9+/_=.:-]+$/u;
const LONG_HEXADECIMAL_TOKEN = /^[A-F0-9]{40,}$/iu;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, maxLength = MAX_IDENTIFIER_LENGTH) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function ignored(code, diagnosedAtMs, field) {
  return {
    status: "ignored",
    diagnostic: {
      code,
      diagnosed_at_ms: diagnosedAtMs,
      ...(field ? { field } : {}),
    },
  };
}

function requiredString(payload, field, diagnosedAtMs, maxLength) {
  if (!(field in payload)) {
    return ignored("missing_required_field", diagnosedAtMs, field);
  }

  if (!isBoundedString(payload[field], maxLength)) {
    return ignored("invalid_field", diagnosedAtMs, field);
  }

  return null;
}

function resolveReceivedAtMs(options) {
  const receivedAtMs = options?.receivedAtMs ?? Date.now();
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) {
    throw new TypeError("receivedAtMs must be a non-negative safe integer");
  }
  return receivedAtMs;
}

function commonEvent(payload, type, receivedAtMs) {
  return {
    schema_version: 1,
    source: "hook",
    type,
    session_id: payload.session_id,
    received_at_ms: receivedAtMs,
    ...(typeof payload.turn_id === "string" ? { turn_id: payload.turn_id } : {}),
  };
}

function optionalWorkspaceLabel(payload) {
  if (typeof payload.workspace_label !== "string") {
    return null;
  }
  const label = payload.workspace_label.trim();
  if (
    label.length === 0 ||
    label.length > MAX_WORKSPACE_LABEL_LENGTH ||
    CONTROL_CHARACTERS.test(label)
  ) {
    return null;
  }
  return label;
}

function replaceAbsolutePaths(value) {
  return value
    .replace(UNC_ABSOLUTE_PATH, (_match, prefix) => `${prefix}[path]`)
    .replace(WINDOWS_ABSOLUTE_PATH, (_match, prefix) => `${prefix}[path]`)
    .replace(POSIX_ABSOLUTE_PATH, (_match, prefix) => `${prefix}[path]`);
}

function stripLeadingAmbientBrowserContext(value) {
  const withoutLeadingWhitespace = value.trimStart();
  if (!withoutLeadingWhitespace.startsWith(AMBIENT_BROWSER_CONTEXT_OPEN)) {
    return value;
  }

  const closeAt = withoutLeadingWhitespace.indexOf(
    AMBIENT_BROWSER_CONTEXT_CLOSE,
    AMBIENT_BROWSER_CONTEXT_OPEN.length,
  );
  if (closeAt === -1) {
    return null;
  }

  const remainder = withoutLeadingWhitespace.slice(
    closeAt + AMBIENT_BROWSER_CONTEXT_CLOSE.length,
  );
  const delimiterCandidate = remainder.trimStart();
  if (!delimiterCandidate.startsWith(USER_REQUEST_DELIMITER)) {
    return remainder;
  }

  const afterDelimiter = delimiterCandidate.slice(USER_REQUEST_DELIMITER.length);
  if (afterDelimiter.length > 0 && !/^[\r\n]/u.test(afterDelimiter)) {
    return remainder;
  }
  return afterDelimiter;
}

/**
 * Derive a short, display-safe hint from an untrusted UserPromptSubmit prompt.
 * The caller must discard the raw prompt after this synchronous derivation.
 */
export function deriveTaskSummary(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const summaryCandidate = stripLeadingAmbientBrowserContext(
    value.slice(0, MAX_PROMPT_INSPECTION_LENGTH),
  );
  if (summaryCandidate === null) {
    return null;
  }

  let summary = summaryCandidate
    .replace(PRIVATE_KEY_BLOCK, "[credential]")
    .replace(CONTROL_CHARACTERS_GLOBAL, " ")
    .replace(URL, "[link]")
    .replace(EMAIL, "[email]")
    .replace(LABELED_CREDENTIAL, "[credential]")
    .replace(BEARER_CREDENTIAL, "[credential]")
    .replace(PREFIXED_SECRET, "[credential]")
    .replace(JWT, "[credential]");
  summary = replaceAbsolutePaths(summary).replace(/\s+/gu, " ").trim();

  if (!summary || !summary.replace(/\[(?:credential|email|link|path)\]/gu, "").trim()) {
    return null;
  }

  const characters = Array.from(summary);
  if (characters.length <= MAX_TASK_SUMMARY_LENGTH) {
    return summary;
  }

  const bounded = characters
    .slice(0, MAX_TASK_SUMMARY_LENGTH - 1)
    .join("")
    .trimEnd();
  const lastSpace = bounded.lastIndexOf(" ");
  const readableBoundary = lastSpace >= Math.floor(MAX_TASK_SUMMARY_LENGTH * 0.6);
  return `${readableBoundary ? bounded.slice(0, lastSpace) : bounded}…`;
}

function isOpaqueSummaryValue(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || /\s/u.test(candidate)) {
    return false;
  }
  if (/^gAAAA[A-Za-z0-9_-]+={0,2}$/u.test(candidate)) {
    return true;
  }
  return (
    (candidate.length >= 64 && OPAQUE_SINGLE_TOKEN.test(candidate)) ||
    LONG_HEXADECIMAL_TOKEN.test(candidate)
  );
}

/** Sanitize a potential assignment label and reject opaque machine values. */
export function deriveAssignmentSummary(value) {
  if (isOpaqueSummaryValue(value)) {
    return null;
  }
  const summary = deriveTaskSummary(value);
  return summary && !isOpaqueSummaryValue(summary) ? summary : null;
}

function deriveSpawnTaskName(value) {
  if (!isBoundedString(value, MAX_LABEL_LENGTH) || isOpaqueSummaryValue(value)) {
    return null;
  }
  const sanitized = deriveAssignmentSummary(value);
  if (!sanitized) {
    return null;
  }
  const humanized = sanitized.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
  return humanized && !isOpaqueSummaryValue(humanized) ? humanized : null;
}

/** Prefer a readable spawn message, then fall back to a safe task_name label. */
export function deriveSpawnAssignmentSummary(toolInput) {
  if (
    !isObject(toolInput) ||
    !isBoundedString(toolInput.task_name, MAX_LABEL_LENGTH) ||
    typeof toolInput.message !== "string"
  ) {
    return null;
  }
  const taskName = deriveSpawnTaskName(toolInput.task_name);
  const message = deriveAssignmentSummary(toolInput.message);
  return message ?? taskName;
}

/**
 * Validate an untrusted Codex hook payload and retain only monitor-safe fields.
 * Raw prompts, tool input/output, paths, and assistant messages are never copied.
 */
export function normalizeHookPayload(payload, options = {}) {
  const receivedAtMs = resolveReceivedAtMs(options);
  if (!isObject(payload)) {
    return ignored("malformed_payload", receivedAtMs);
  }

  const eventNameError = requiredString(
    payload,
    "hook_event_name",
    receivedAtMs,
    MAX_LABEL_LENGTH,
  );
  if (eventNameError) {
    return eventNameError;
  }

  const type = NORMALIZED_EVENT_TYPES[payload.hook_event_name];
  if (!type) {
    return ignored("unsupported_hook_event", receivedAtMs, "hook_event_name");
  }

  const commonFields = SESSION_EVENT_TYPES.has(type)
    ? ["session_id"]
    : ["session_id", "turn_id"];
  for (const field of commonFields) {
    const error = requiredString(payload, field, receivedAtMs);
    if (error) {
      return error;
    }
  }

  const event = commonEvent(payload, type, receivedAtMs);
  if (
    type === "session_started" &&
    typeof payload.source === "string" &&
    SESSION_START_SOURCES.has(payload.source)
  ) {
    event.session_start_source = payload.source;
  }
  const workspaceLabel = optionalWorkspaceLabel(payload);
  if (workspaceLabel) {
    event.workspace_label = workspaceLabel;
  }

  if (type === "turn_started") {
    const taskSummary = deriveTaskSummary(
      typeof payload.task_summary === "string"
        ? payload.task_summary
        : payload.prompt,
    );
    if (taskSummary) {
      event.task_summary = taskSummary;
    }
  }

  if (type === "subagent_started" || type === "subagent_stopped") {
    for (const [field, maxLength] of [
      ["agent_id", MAX_IDENTIFIER_LENGTH],
      ["agent_type", MAX_LABEL_LENGTH],
    ]) {
      const error = requiredString(payload, field, receivedAtMs, maxLength);
      if (error) {
        return error;
      }
    }

    event.agent_id = payload.agent_id;
    event.agent_type = payload.agent_type;
  }

  if (type === "tool_started" || type === "tool_completed") {
    for (const [field, maxLength] of [
      ["tool_name", MAX_LABEL_LENGTH],
      ["tool_use_id", MAX_IDENTIFIER_LENGTH],
    ]) {
      const error = requiredString(payload, field, receivedAtMs, maxLength);
      if (error) {
        return error;
      }
    }

    event.tool_name = payload.tool_name;
    event.tool_use_id = payload.tool_use_id;

    if (
      type === "tool_started" &&
      payload.tool_name === OBSERVED_SPAWN_AGENT_TOOL_NAME
    ) {
      event.spawn_assignment_observed = true;
      let assignmentSummary = null;
      if (
        isObject(payload.tool_input) &&
        isBoundedString(payload.tool_input.task_name, MAX_LABEL_LENGTH) &&
        typeof payload.tool_input.message === "string"
      ) {
        assignmentSummary = deriveSpawnAssignmentSummary(payload.tool_input);
      } else if (
        payload.spawn_assignment_observed === true &&
        typeof payload.assignment_summary === "string"
      ) {
        assignmentSummary = deriveAssignmentSummary(payload.assignment_summary);
      }
      if (assignmentSummary) {
        event.assignment_summary = assignmentSummary;
      }
    }
  }

  if (type === "permission_requested") {
    const error = requiredString(
      payload,
      "tool_name",
      receivedAtMs,
      MAX_LABEL_LENGTH,
    );
    if (error) {
      return error;
    }

    event.tool_name = payload.tool_name;
  }

  return { status: "accepted", event };
}
