"""Version-checked Traditional Chinese UI addon for Codex Agent View 0.5.6.

Only public/app.js and public/index.html are modified. The upstream Apache-2.0
package remains a separately installed dependency. Hooks and authentication
implementation are left unchanged; no authentication values are read.
"""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile

HERE = Path(__file__).resolve().parent
BASE_HASHES = {
    'app.js': 'cb7701d1e5fb861980111094c0119f93e95b77f6d11aaf8ef7cbf6e382d96746',
    'index.html': 'f6e9f75551139db6a310cc6f2f602ad7aa9c855130a77df77864c9f4e9e9a0ee',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_messages():
    value = json.loads((HERE/'agentview.zh-TW.json').read_text(encoding='utf-8'))
    if not isinstance(value, dict) or not value or not all(isinstance(k, str) and isinstance(v, str) and v for k, v in value.items()):
        raise ValueError('Invalid Traditional Chinese message dictionary')
    return value


def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Unsupported upstream UI layout; no changes written')
    return source.replace(old, new, 1)


def transform(original_js, original_html):
    if sha(original_js) != BASE_HASHES['app.js'] or sha(original_html) != BASE_HASHES['index.html']:
        raise ValueError('Only unmodified upstream 0.5.6 public assets are supported')
    messages = load_messages()
    js, page = original_js.decode('utf-8'), original_html.decode('utf-8')
    english = js.split('  en: Object.freeze({', 1)[1].split('  ko: Object.freeze({', 1)[0]
    pairs = re.findall(r'^    (\w+): ("(?:[^"\\]|\\.)*"),?$', english, flags=re.M)
    source_messages = {k: json.loads(v) for k, v in pairs}
    if set(messages) != set(source_messages):
        raise ValueError('Translation keys differ from upstream: '+repr(sorted(set(messages)^set(source_messages))))
    for key, value in messages.items():
        if sorted(re.findall(r'\{(\w+)\}', value)) != sorted(re.findall(r'\{(\w+)\}', source_messages[key])):
            raise ValueError('Translation placeholders differ: '+key)
    js = once(js, 'const LANGUAGE_KEY = "codex-agent-view-language";',
              'const LANGUAGE_KEY = "codex-agent-view-language-zh-tw-v1";')
    js = once(js, 'const SUPPORTED_LANGUAGES = new Set(["en", "ko", "es"]);',
              'const SUPPORTED_LANGUAGES = new Set(["en", "ko", "es", "zh-TW"]);')
    block = '  "zh-TW": Object.freeze('+json.dumps(messages, ensure_ascii=False, indent=4)+'),\n'
    js = once(js, 'const MESSAGES = Object.freeze({\n', 'const MESSAGES = Object.freeze({\n'+block)
    old = '''function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return SUPPORTED_LANGUAGES.has(stored) ? stored : "en";
  } catch {
    return "en";
  }
}'''
    js = once(js, old, old.replace('"en"', '"zh-TW"'))
    js = once(js, 'currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "en";',
              'currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "zh-TW";')
    page = once(page, '<html lang="en">', '<html lang="zh-Hant">')
    page = once(page, '<title>Codex Agent View</title>', '<title>Codex 代理工作看板</title>')
    page = once(page, '<strong>Codex Agent View</strong>', '<strong>Codex 代理工作看板</strong>')
    page = once(page, '<option value="en">English</option>', '<option value="zh-TW">繁體中文</option>\n              <option value="en">English</option>')
    for key, value in messages.items():
        pattern = r'(<[\w-]+\b[^>]*\bdata-i18n="'+re.escape(key)+r'"[^>]*>)[^<]*(</[\w-]+>)'
        page = re.sub(pattern, lambda m: m[1]+html.escape(value, quote=False)+m[2], page)
    def translate_attributes(match):
        tag = match[0]
        for marker, attribute in [('aria-label', 'aria-label'), ('placeholder', 'placeholder')]:
            key = re.search(r'\bdata-i18n-'+marker+r'="([^"]+)"', tag)
            if key:
                if key[1] not in messages:
                    raise ValueError('Unknown HTML translation key: '+key[1])
                tag = re.sub(r'(?<![\w:-])'+attribute+r'="[^"]*"', lambda _: attribute+'="'+html.escape(messages[key[1]], quote=True)+'"', tag)
        return tag
    page = re.sub(r'<[^>]+>', translate_attributes, page)
    page = once(page, 'content="A clear, live view of Codex work and the agents moving it forward."',
                'content="'+html.escape(messages['metaDescription'], quote=True)+'"')
    # The untouched suffix includes the entire auth, polling and state logic.
    marker = '\nfunction isExactLiveFragment(entries) {'
    if js.split(marker, 1)[1].replace('currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "zh-TW";',
                                     'currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "en";') != original_js.decode('utf-8').split(marker, 1)[1]:
        raise ValueError('Unexpected non-localization implementation change')
    return {'app.js': js.encode('utf-8'), 'index.html': page.encode('utf-8')}, len(messages)


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name+'.zh-tw-', suffix='.tmp', delete=False) as f:
        temp = Path(f.name)
        f.write(data)
    os.replace(temp, path)


def update_root(root, apply):
    root = root.resolve()
    version = json.loads((root/'package.json').read_text(encoding='utf-8'))
    if (version.get('name'), version.get('version')) != ('codex-agent-view', '0.5.6'):
        raise ValueError('Supported dependency: codex-agent-view 0.5.6 only')
    backup_base = Path(os.environ.get('LOCALAPPDATA', str(Path.home()/'.local/share')))/'CodexLocalBoard/agentview-ui-backups'
    backup = backup_base/(sha(str(root).encode('utf-8'))[:20]+'-0.5.6')
    originals = {}
    current = {}
    for name in BASE_HASHES:
        path = root/'public'/name
        current[name] = path.read_bytes()
        if sha(current[name]) == BASE_HASHES[name]:
            originals[name] = current[name]
        else:
            original = (backup/name).read_bytes()
            if sha(original) != BASE_HASHES[name]:
                raise ValueError('Original UI backup hash mismatch')
            originals[name] = original
    translated, keys = transform(originals['app.js'], originals['index.html'])
    for name, data in current.items():
        if sha(data) not in {BASE_HASHES[name], sha(translated[name])}:
            raise ValueError('Existing UI contains unrelated changes; refusing overwrite')
    changed = [name for name in current if current[name] != translated[name]]
    if apply and changed:
        backup.mkdir(parents=True, exist_ok=True)
        for name, data in originals.items():
            target = backup/name
            if not target.exists():
                target.write_bytes(data)
            if sha(target.read_bytes()) != BASE_HASHES[name]:
                raise ValueError('Conflicting UI backup; no changes written')
        for name in changed:
            atomic_write(root/'public'/name, translated[name])
    return {'package_version':'0.5.6', 'translation_keys':keys, 'apply':apply,
            'changed_public_files':changed, 'result':'patched' if apply and changed else 'already_patched' if not changed else 'ready',
            'public_hashes':{name:sha(data) for name,data in translated.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--root', type=Path, action='append', help='Installed codex-agent-view package root; may repeat')
    args = parser.parse_args()
    defaults = [Path(os.environ.get('APPDATA', str(Path.home()/'.npm')))/'npm/node_modules/codex-agent-view',
                Path.home()/'.codex-agent-view/marketplace/plugins/codex-agent-view',
                Path(os.environ.get('CODEX_HOME', str(Path.home()/'.codex')))/'plugins/cache/codex-agent-view/codex-agent-view/0.5.6']
    roots = args.root if args.root is not None else [p for p in defaults if (p/'package.json').is_file()]
    if not roots:
        parser.error('No supported installed package found. Install 0.5.6, or pass --root.')
    try:
        results = [update_root(root, args.apply) for root in roots]
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, str(error)+'\n')
    print(json.dumps({'targets':len(results),'results':results}, ensure_ascii=True))


if __name__ == '__main__':
    main()
