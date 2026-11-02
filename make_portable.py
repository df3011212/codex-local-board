"""Build a Windows x64 semantic-board launcher from pinned official Node.

This does not register hooks, change Codex trust, start a monitor or open a browser.
Python 3.10+; no npm or installed Node is needed for the build itself.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request
import zipfile

NODE_VERSION = "24.22.2"
NODE_ARCHIVE = f"node-v{NODE_VERSION}-win-x64"
NODE_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/{NODE_ARCHIVE}.zip"
NODE_SHA256 = "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2"
PACKAGE_URL = "https://registry.npmjs.org/codex-agent-view/-/codex-agent-view-0.5.6.tgz"
PACKAGE_SHA512 = "0BIt98xDH1eDvqbI7OeGzwGcwv5YxanwJJ3YeduqN6ubiZiHW3M3x6iuql8LUAKs4k8THXf7YeE6L23bfvROkQ=="
MAX_DOWNLOAD = 128 * 1024 * 1024
HERE = Path(__file__).resolve().parent
BOARD_FILES = frozenset({
    ".gitignore", "LICENSE", "README.md", "board-node.mjs", "agent_report.mjs", "open-board.mjs",
    "install-agent-guidance.mjs", "Open-Board.cmd", "Close-Board.cmd",
    "config.example.json", "state.example.json", "web/index.html", "web/app.js",
    "web/styles.css", "web/plan-handoff.js", "docs/agent-guidance.template.md",
    "codex-observer.mjs",
    "codex-titles.mjs", "codex-execution.mjs", "project-plan.mjs", "plan_report.mjs", "使用說明.txt", "sync-all.mjs", "Sync-All-Chats.cmd",
})
PACKAGE_FILES = frozenset({
    "LICENSE", "NOTICE", "package.json", "README.ko.md", "README.md",
    ".agents/plugins/marketplace.json", ".codex-plugin/plugin.json",
    "assets/logo-dark.svg", "assets/logo.svg", "bin/codex-agent-view.mjs",
    "hooks/hooks.json", "public/app.js", "public/index.html", "public/styles.css",
    "scripts/auto-start-monitor.mjs", "scripts/capture-hook.mjs",
    "scripts/send-hook.mjs", "skills/codex-agent-view/SKILL.md", "src/core/index.mjs",
    "src/core/monitor-store.mjs", "src/core/normalize-hook-payload.mjs",
    "src/runtime/config.mjs", "src/runtime/server.mjs",
})

LAUNCHER = r'''@echo off
setlocal
set "CODEX_THREAD_ID="
if not exist "%~dp0runtime\node.exe" goto missing
if not exist "%~dp0vendor\codex-agent-view\bin\codex-agent-view.mjs" goto missing
"%~dp0runtime\node.exe" "%~dp0vendor\codex-agent-view\bin\codex-agent-view.mjs" open >nul 2>nul
set "CAV_EXIT=%ERRORLEVEL%"
if not "%CAV_EXIT%"=="0" goto failed
echo Agent View opened in your default browser.
endlocal & exit /b 0
:missing
echo The portable launcher is incomplete. Keep this entire folder together.
pause
endlocal & exit /b 2
:failed
echo Agent View could not open. Exit code: %CAV_EXIT%.
echo Run the documented read-only doctor command to inspect installation.
pause
endlocal & exit /b %CAV_EXIT%
'''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Unexpected download redirect; no archive accepted")


def download(url):
    if url not in {NODE_URL, PACKAGE_URL}:
        raise ValueError("Only the pinned official archive URLs are allowed")
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(url, timeout=30) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_DOWNLOAD:
            raise ValueError("Archive exceeds download limit")
        chunks, count = [], 0
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_DOWNLOAD:
                raise ValueError("Archive exceeds download limit")
            chunks.append(chunk)
    return b"".join(chunks)


def verify_archive(data, kind):
    if kind == "node":
        actual, expected = hashlib.sha256(data).hexdigest(), NODE_SHA256
    elif kind == "package":
        actual = base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
        expected = PACKAGE_SHA512
    else:
        raise ValueError("Unknown archive type")
    if actual != expected:
        raise ValueError("Official archive integrity mismatch; nothing installed")


def node_files(data):
    wanted = {f"{NODE_ARCHIVE}/node.exe": "runtime/node.exe",
              f"{NODE_ARCHIVE}/LICENSE": "runtime/LICENSE"}
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            if entry.filename not in wanted:
                continue
            name = wanted[entry.filename]
            mode = (entry.external_attr >> 16) & 0o170000
            if name in result or mode == 0o120000 or entry.file_size > MAX_DOWNLOAD:
                raise ValueError("Unexpected Node archive layout")
            result[name] = archive.read(entry)
    if set(result) != set(wanted.values()) or not result["runtime/node.exe"].startswith(b"MZ"):
        raise ValueError("Node executable or license missing from official archive")
    return result


def package_files(data):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        total = 0
        for entry in archive:
            if entry.isdir():
                continue
            path = PurePosixPath(entry.name)
            if not entry.isfile() or "\\" in entry.name or path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe package archive member")
            if not entry.name.startswith("package/"):
                raise ValueError("Unexpected package archive prefix")
            name = entry.name[len("package/"):]
            if name not in PACKAGE_FILES or name in result or entry.size > 1024 * 1024:
                raise ValueError("Unexpected package archive layout")
            total += entry.size
            if total > 2 * 1024 * 1024:
                raise ValueError("Unpacked package exceeds limit")
            with archive.extractfile(entry) as stream:
                result[name] = stream.read()
    if set(result) != PACKAGE_FILES:
        raise ValueError("Official package file list differs from pinned 0.5.6")
    metadata = json.loads(result["package.json"])
    if metadata.get("name") != "codex-agent-view" or metadata.get("version") != "0.5.6":
        raise ValueError("Unexpected Agent View version")
    if metadata.get("dependencies") or metadata.get("scripts", {}).get("postinstall"):
        raise ValueError("Unexpected external runtime dependency or postinstall")
    return result


def assemble(output, node_archive, package_archive=None, *, chinese=True):
    output = Path(output).expanduser().resolve()
    if output.exists():
        raise ValueError("Output already exists; choose a new folder to preserve its files")
    verify_archive(node_archive, "node")
    payload = node_files(node_archive)
    for name in BOARD_FILES:
        source = HERE / name
        if source.is_symlink() or not source.is_file():
            raise ValueError("Semantic board source missing or linked: " + name)
        payload[name] = source.read_bytes()
    if package_archive is not None:
        verify_archive(package_archive, "package")
        package = package_files(package_archive)
        if chinese:
            from agentview_zh_tw import transform
            translated, _ = transform(package["public/app.js"], package["public/index.html"])
            package.update({"public/" + name: value for name, value in translated.items()})
        payload.update({"vendor/codex-agent-view/" + name: value for name, value in package.items()})
        payload["Open-All-Agents.cmd"] = LAUNCHER.replace("\n", "\r\n").encode("ascii")
    changed = "public/app.js, public/index.html (Traditional Chinese UI only)" if chinese and package_archive is not None else "none"
    payload["LOCAL-MODIFICATIONS.txt"] = (
        "Codex Agent View 0.5.6: https://github.com/JunhoYoon95/codex-agent-view\n"
        "Upstream Apache-2.0 license and NOTICE are retained under vendor/codex-agent-view.\n"
        "Node.js 24.22.2: https://nodejs.org/; full license under runtime/LICENSE.\n"
        f"Modified upstream files: {changed}. Hooks/authentication/state logic unchanged.\n"
        "Primary entry: Open-Board.cmd, the original MIT semantic board.\n"
        "Optional Agent View entry: Open-All-Agents.cmd, only with --with-agent-view.\n"
        "No private Codex settings, credentials or runtime data are included.\n"
        "The builder did not install guidance/hooks, change trust or start/open a monitor.\n"
    ).encode("utf-8")
    manifest = {
        "board_version": 2, "agent_view_version": "0.5.6" if package_archive is not None else None,
        "node_version": NODE_VERSION, "official_archives_verified": True, "chinese_ui": chinese,
        "node_archive_sha256": NODE_SHA256,
        "package_archive_sha512_base64": PACKAGE_SHA512 if package_archive is not None else None,
        "files": [{"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(payload.items())],
    }
    payload["manifest.sha256.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    output.mkdir(parents=True)
    for name, value in payload.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(value)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New Windows x64 portable folder")
    parser.add_argument("--with-agent-view", action="store_true", help="Also download the advanced external Agent View")
    parser.add_argument("--english", action="store_true", help="Keep optional Agent View's original UI")
    args = parser.parse_args()
    if args.output.expanduser().resolve().exists():
        parser.error("Output already exists; nothing overwritten")
    try:
        print("Downloading pinned official Node.js archive...")
        manifest = assemble(args.output, download(NODE_URL), download(PACKAGE_URL) if args.with_agent_view else None, chinese=not args.english)
    except (ValueError, OSError, tarfile.TarError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Portable build failed: {error}\n")
    print(f"Created {len(manifest['files']) + 1} files. No plugin install or browser launch was performed.")
    print("Open Open-Board.cmd in the new folder. Install semantic guidance separately after review.")


if __name__ == "__main__":
    main()
