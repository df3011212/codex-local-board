"""Synthetic UI fixture tests. No upstream full JS or installed package is copied."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import agentview_zh_tw as addon


def synthetic_assets():
    # A small authored API-shaped fixture, not a redistributed vendor resource.
    messages = addon.load_messages()
    english = '\n'.join('    '+key+': '+json.dumps('fixture '+ ' '.join(re.findall(r'\{\w+\}', value)))+',' for key, value in messages.items())
    js = '''const LANGUAGE_KEY = "codex-agent-view-language";
const SUPPORTED_LANGUAGES = new Set(["en", "ko", "es"]);
const MESSAGES = Object.freeze({
  en: Object.freeze({
'''+english+'''
  }),
  ko: Object.freeze({})
});
function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return SUPPORTED_LANGUAGES.has(stored) ? stored : "en";
  } catch {
    return "en";
  }
}
function isExactLiveFragment(entries) { return false; }
function setLanguage(value) {
  currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "en";
}
const authenticationSentinel = "retain authentication implementation";
'''
    page = '''<html lang="en"><head><title>Codex Agent View</title>
<meta content="A clear, live view of Codex work and the agents moving it forward."></head>
<body><strong>Codex Agent View</strong><select><option value="en">English</option></select>
<label data-i18n="languageLabel">Language</label>
<input data-i18n-placeholder="languageLabel" placeholder="Language">
</body></html>'''
    return js.encode(), page.encode()


class AddonTests(unittest.TestCase):
    def setUp(self):
        test_root = ROOT/'test-results'; test_root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='addon-test-', dir=test_root)
        self.directory = Path(self.temporary.name).resolve()
        assert self.directory.parent == test_root.resolve()
        self.package = self.directory/'package'; (self.package/'public').mkdir(parents=True)
        self.js, self.page = synthetic_assets()
        (self.package/'package.json').write_text(json.dumps({'name':'codex-agent-view','version':'0.5.6'}))
        (self.package/'public/app.js').write_bytes(self.js)
        (self.package/'public/index.html').write_bytes(self.page)
        (self.package/'hooks.json').write_bytes(b'hook sentinel')
        (self.package/'auth.js').write_bytes(b'auth sentinel')
        self.hashes = {'app.js': addon.sha(self.js), 'index.html': addon.sha(self.page)}

    def tearDown(self):
        assert self.directory.parent == (ROOT/'test-results').resolve()
        self.temporary.cleanup()

    def test_wrong_version_and_unrelated_assets_are_not_overwritten(self):
        (self.package/'package.json').write_text(json.dumps({'name':'codex-agent-view','version':'9.0.0'}))
        with self.assertRaises(ValueError): addon.update_root(self.package, True)
        self.assertEqual((self.package/'public/app.js').read_bytes(), self.js)
        (self.package/'package.json').write_text(json.dumps({'name':'codex-agent-view','version':'0.5.6'}))
        with patch.dict(os.environ, {'LOCALAPPDATA':str(self.directory/'private')}):
            with self.assertRaises((OSError, ValueError)): addon.update_root(self.package, True)
        self.assertEqual((self.package/'public/app.js').read_bytes(), self.js)

    def test_versioned_hash_fixture_dry_run_apply_idempotence_and_sentinels(self):
        with patch.object(addon, 'BASE_HASHES', self.hashes), patch.dict(os.environ, {'LOCALAPPDATA':str(self.directory/'private')}):
            preview = addon.update_root(self.package, False)
            self.assertEqual(preview['result'], 'ready')
            self.assertEqual((self.package/'public/app.js').read_bytes(), self.js)
            first = addon.update_root(self.package, True)
            second = addon.update_root(self.package, True)
            self.assertEqual(first['result'], 'patched')
            self.assertEqual(second['result'], 'already_patched')
            self.assertEqual(second['changed_public_files'], [])
            self.assertEqual(first['translation_keys'], 160)
            translated = (self.package/'public/app.js').read_text('utf-8')
            self.assertIn('codex-agent-view-language-zh-tw-v1', translated)
            self.assertIn('return "zh-TW";', translated)
            self.assertIn('authenticationSentinel = "retain authentication implementation"', translated)
            self.assertIn('<html lang="zh-Hant">', (self.package/'public/index.html').read_text('utf-8'))
            self.assertEqual((self.package/'hooks.json').read_bytes(), b'hook sentinel')
            self.assertEqual((self.package/'auth.js').read_bytes(), b'auth sentinel')

    def test_placeholder_mismatch_is_refused(self):
        messages = addon.load_messages(); key = next(iter(messages)); messages[key] += '{inventedPlaceholder}'
        with patch.object(addon, 'BASE_HASHES', self.hashes), patch.object(addon, 'load_messages', return_value=messages):
            with self.assertRaises(ValueError): addon.transform(self.js, self.page)


if __name__ == '__main__': unittest.main()
