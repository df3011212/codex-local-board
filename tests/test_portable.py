"""Own synthetic archives test the builder without bundling upstream code."""
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import make_portable as portable


def node_archive(*, duplicate=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(f"{portable.NODE_ARCHIVE}/node.exe", b"MZ synthetic, not executable")
        archive.writestr(f"{portable.NODE_ARCHIVE}/LICENSE", "Synthetic license fixture")
        # Unselected paths are never extracted, even if present in an archive.
        archive.writestr("../../unselected.txt", "not written")
        if duplicate:
            archive.writestr(f"{portable.NODE_ARCHIVE}/node.exe", b"MZ duplicate")
    return stream.getvalue()


def package_archive(*, extra=None, link=False):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name in sorted(portable.PACKAGE_FILES):
            data = (json.dumps({"name": "codex-agent-view", "version": "0.5.6"}).encode()
                    if name == "package.json" else b"Synthetic fixture")
            item = tarfile.TarInfo("package/" + name)
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
        if extra:
            item = tarfile.TarInfo(extra)
            if link:
                item.type, item.linkname = tarfile.SYMTYPE, "../outside"
            archive.addfile(item)
    return stream.getvalue()


class PortableTests(unittest.TestCase):
    def test_real_integrity_check_and_no_redirect(self):
        for kind in ("node", "package"):
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                portable.verify_archive(b"untrusted bytes", kind)
        with self.assertRaises(ValueError):
            portable.download("http://untrusted.invalid/archive")
        with self.assertRaises(ValueError):
            portable.NoRedirect().redirect_request(None, None, 302, "", {}, "http://bad.invalid")

    def test_archive_members_and_limits(self):
        result = portable.node_files(node_archive())
        self.assertEqual(set(result), {"runtime/node.exe", "runtime/LICENSE"})
        self.assertEqual(set(portable.package_files(package_archive())), portable.PACKAGE_FILES)
        for name, link in (("package/../../escape", False), ("package/linked", True),
                           ("package/new-code.mjs", False)):
            with self.assertRaises(ValueError):
                portable.package_files(package_archive(extra=name, link=link))

    def test_assembly_relative_launcher_license_and_preservation(self):
        with tempfile.TemporaryDirectory(prefix="board portable test ") as tmp:
            output = Path(tmp) / "portable folder with spaces"
            with mock.patch.object(portable, "verify_archive") as verify:
                manifest = portable.assemble(output, node_archive(), package_archive(), chinese=False)
            self.assertEqual(verify.call_count, 2)
            launcher = (output / "Open-All-Agents.cmd").read_text()
            self.assertIn('"%~dp0runtime\\node.exe"', launcher)
            self.assertIn('set "CODEX_THREAD_ID="', launcher)
            self.assertIn("open >nul 2>nul", launcher)
            for forbidden in ("powershell", "APPDATA", "npm.cmd", "-ExecutionPolicy", "start "):
                self.assertNotIn(forbidden, launcher)
            self.assertTrue((output / "runtime/LICENSE").is_file())
            self.assertTrue((output / "vendor/codex-agent-view/NOTICE").is_file())
            self.assertFalse((Path(tmp) / "unselected.txt").exists())
            self.assertFalse((output / "runtime.json").exists())
            self.assertEqual(len(manifest["files"]), 27 + len(portable.BOARD_FILES))
            self.assertTrue((output / "Open-Board.cmd").is_file())
            for filename in ("private-access.mjs", "Open-Phone-Board.cmd", "Close-Phone-Board.cmd", "Check-Phone-Board.cmd"):
                self.assertIn(filename, portable.BOARD_FILES)
                self.assertEqual((output / filename).read_bytes(), (portable.HERE / filename).read_bytes())
            self.assertTrue((output / "agent_report.mjs").is_file())
            self.assertIn("web/plan-handoff.js", portable.BOARD_FILES)
            self.assertEqual((output / "web/plan-handoff.js").read_bytes(),
                             (portable.HERE / "web/plan-handoff.js").read_bytes())
            before = (output / "manifest.sha256.json").read_bytes()
            with self.assertRaisesRegex(ValueError, "already exists"):
                portable.assemble(output, b"invalid", b"invalid")
            self.assertEqual((output / "manifest.sha256.json").read_bytes(), before)

    def test_primary_board_does_not_require_agent_view(self):
        with tempfile.TemporaryDirectory(prefix="board primary portable ") as tmp:
            output = Path(tmp) / "primary"
            with mock.patch.object(portable, "verify_archive") as verify:
                manifest = portable.assemble(output, node_archive())
            self.assertEqual(verify.call_count, 1)
            self.assertEqual(manifest["board_version"], 2)
            self.assertIsNone(manifest["agent_view_version"])
            self.assertFalse((output / "vendor").exists())
            self.assertTrue((output / "Open-Board.cmd").is_file())
            self.assertTrue((output / "web/plan-handoff.js").is_file())
            self.assertFalse((output / "state-v2.json").exists())


if __name__ == "__main__":
    unittest.main()
