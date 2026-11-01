# Codex Agent View

> [Read in Korean](https://github.com/JunhoYoon95/codex-agent-view/blob/main/README.ko.md)

Codex Agent View is a lightweight, unofficial, read-only companion plugin for monitoring live Codex tasks and subagent activity locally in your browser. It shows the work Codex is handling, the participating agents, their assigned work when it can be verified, and their latest observable activity. Hook data stays on this device in bounded process memory, and one `@codex-agent-view` invocation opens the live view in the operating system's default browser.

Open each view with one lightweight `@codex-agent-view` invocation. Once open, live monitoring runs locally with no additional model calls. The Codex tasks and subagents being monitored continue their normal model and token usage.

It does not replace Codex, control tasks or agents, run a hosted service, send telemetry, or keep a persistent event history.

## Quick start

Install the current release from a regular terminal:

```bash
codex --version
```

If the `codex` executable on your PATH was installed through npm, update it and verify the selected version again:

```bash
npm install --global @openai/codex@latest
codex --version
```

If Codex came from another install channel, update it through that channel instead. Then install the plugin package:

```bash
npm install --global codex-agent-view@0.5.6
codex-agent-view install
```

The `0.5.6` installer copies the bundled plugin into a strict marketplace subdirectory before registration, avoiding the marketplace-root discovery failure in `0.5.5`.

The npm command installs the package. `codex-agent-view install` copies and explicitly registers its bundled local Codex plugin. `npm install` alone does not modify Codex settings, and this package has no `postinstall` script that does so.

Then:

1. In the Codex app's **Plugins** screen, confirm that **Codex Agent View** is installed and enabled.
2. In its **Hooks** section, choose **Review**, inspect `hooks/hooks.json` and the `node "${PLUGIN_ROOT}/scripts/send-hook.mjs"` command, then choose **Trust all** for the current definitions. Only if the app has no hook-review UI, use `/hooks` in the interactive Codex CLI.
3. Quit Codex completely and reopen it.
4. Create a new Codex task. Events from before installation are not replayed.

Persisted hook trust is not exposed by the current programmatic plugin status, so the browser and `doctor` cannot confirm that approval; verify it in the Codex app or interactive `/hooks` UI.

## Use

In a Codex app task, select and send:

```text
@codex-agent-view
```

That is the whole normal-use command. The plugin prepares or reuses its local monitor and opens an authenticated live view in your operating system's default browser.

- Do not select a separate `$show-agents` skill.
- Do not start the monitor in a terminal.
- Do not copy or manage a localhost URL.
- Closing the browser tab does not stop Codex work. Invoke `@codex-agent-view` again when you want a new authenticated tab.
- The task used to open the viewer is hidden from the view itself, so use a separate viewer task to monitor the work you care about.

The public Codex plugin API does not provide a reliable automatic app sidebar or in-app panel for this workflow, so the default browser is the supported display surface.

## What the view shows

The live view defaults to English and also supports Korean and Spanish. It refreshes every two seconds without collapsing agent details. The **Work status filter** matches each parent work item's current status only; nested agent statuses and recent activity history do not cause a card to match a different status.

Each work item can include a short, redacted request summary. Each agent card can show:

- **Assigned work** — no exact upstream correlation ID has been observed for this mapping. A bounded summary is therefore matched on a best-effort basis only when one verified spawn candidate and one newly observed agent are the sole candidates in the bounded window. In the currently observed official-app payload, the protected spawn message is opaque, so a safely humanized task label is the primary usable source. When several agents are spawned concurrently and the mapping is ambiguous, assignment details intentionally remain unavailable instead of being guessed; expired or protected values are likewise not displayed.
- **Current activity** — a human-readable description such as a file edit in progress or a recently completed terminal action. It is shown only when the observed tool lifecycle has the exact `turn_id` of one and only one agent.

These fields describe observable assignment and tool lifecycle signals, not an agent's internal reasoning. The monitor does not retain or display raw spawn messages, full prompts, full tool input, or full tool output. Missing or ambiguous information remains unavailable instead of being inferred from timing.

## Reconnect and recovery

The opened tab refreshes its short-lived read-only access only within one fixed credential-family lifetime.

- For a temporary connection or access error in the same previously authenticated tab, use **Reconnect**.
- A new tab has no inherited credential because recovery is stored in tab-scoped `sessionStorage`, not `localStorage`.
- If the tab was closed, the credential family expired, or the monitor restarted before the one-use grant was exchanged, invoke `@codex-agent-view` again.

The private target and credentials are passed directly to the browser launcher. They are not printed for users to copy.

## Privacy and trust boundary

- The monitor binds only to IPv4 loopback (`127.0.0.1`) and has no external telemetry, hosted backend, SQLite database, or remote event store.
- Live operational state exists only in bounded process memory and resets when the monitor restarts.
- The sender minimizes hook payloads before delivery. A short task summary is locally redacted and bounded; raw prompt and tool content are not retained by the normal monitor path.
- The plugin is read-only. It cannot stop tasks, send messages, answer permission requests, or approve actions.
- Hook commands execute locally with your user account's permissions. Review and explicitly trust the exact hook definition before use.

See [Privacy](docs/privacy.md), [Security](SECURITY.md), and [Terms](docs/terms.md) for the complete boundaries.

## Uninstall

Use the explicit lifecycle command from a terminal:

```bash
codex-agent-view uninstall
```

It authenticates and stops only an owned Codex Agent View monitor, then removes the plugin and copied marketplace registration. If ownership cannot be verified, it fails without deleting uncertain files or stopping another loopback service.

To also remove only recognized owned runtime data when safe:

```bash
codex-agent-view uninstall --purge
```

`--purge` preserves unrecognized files, unrelated services, non-empty directories, and separately stored opt-in diagnostic captures. Inspect and remove any such capture by its exact path; never delete a broad Codex or home directory as a cleanup shortcut.

## Release and project documentation

Release publication and verification evidence is recorded outside the immutable npm package README in [Distribution](docs/distribution.md), including registry digests, this-device compatible-CLI reinstall checks, CI, tags, and GitHub Releases. Those checks did not verify a clean cross-device first install; the compatibility failure above is now recorded separately.

npm publication is separate from submission to the Universal Plugins Directory. Directory validator compatibility, portal/reviewer acceptance, search exposure, and promptless plugin-card Quick start behavior remain unverified and are not claimed here.

- [Distribution and release evidence](docs/distribution.md)
- [Plugin directory submission status](docs/plugin-submission.md)
- [Technical findings](docs/phase-0-findings.md)
- [Roadmap](ROADMAP.md)
- [Support](SUPPORT.md)

Copyright 2026 Junho Yoon. Licensed under the Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
