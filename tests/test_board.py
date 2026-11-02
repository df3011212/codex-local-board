"""Real loopback HTTP and concurrent CLI persistence checks; no external services."""
from concurrent.futures import ThreadPoolExecutor
import copy
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import board
import server


class Fixture(unittest.TestCase):
    def setUp(self):
        test_root = ROOT/'test-results'
        test_root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='board-test-', dir=test_root)
        self.directory = Path(self.temporary.name).resolve()
        # Verify the sole recursive cleanup target before TemporaryDirectory can
        # remove it. Never enumerate unrelated user or repository directories.
        assert self.directory.parent == test_root.resolve()
        self.state_path, self.config_path = self.directory/'state.json', self.directory/'config.json'
        self.state = json.loads((ROOT/'state.example.json').read_text('utf-8'))
        self.config = json.loads((ROOT/'config.example.json').read_text('utf-8'))
        board.atomic_write(self.state_path, self.state)
        board.atomic_write(self.config_path, self.config, board.MAX_CONFIG_BYTES, board.validate_config)

    def tearDown(self):
        assert self.directory.parent == (ROOT/'test-results').resolve()
        self.temporary.cleanup()

    def cli(self, *arguments):
        return subprocess.run([sys.executable, str(ROOT/'update_state.py'), '--state', str(self.state_path), '--config', str(self.config_path), *arguments], capture_output=True, timeout=10)


class StorageTests(Fixture):
    def test_status_unknown_id_and_oversize_fail_without_changing_state(self):
        before = self.state_path.read_bytes()
        for arguments in (
            ('set-task', '--project', 'website-demo', '--id', 'missing', '--status', 'done'),
            ('set-task', '--project', 'website-demo', '--id', 'requirements', '--status', 'invented'),
            ('set-task', '--project', 'website-demo', '--id', 'requirements', '--detail', 'x'*1201),
        ):
            result = self.cli(*arguments)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.state_path.read_bytes(), before)

    def test_event_count_is_bounded_and_concurrent_writers_do_not_lose_events(self):
        def write(index):
            return self.cli('event', '--project', 'website-demo', '--text', f'Concurrent event {index}')
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(write, range(12)))
        self.assertTrue(all(r.returncode == 0 for r in results), [r.stderr for r in results])
        saved = board.read_document(self.state_path, board.MAX_STATE_BYTES, board.validate_state)
        self.assertEqual({r['text'] for r in saved['projects'][0]['events']}, {f'Concurrent event {i}' for i in range(12)})
        saved['projects'][0]['events'] = [{'at': board.now(), 'text': f'Old {i}'} for i in range(30)]
        board.atomic_write(self.state_path, saved)
        self.assertEqual(self.cli('event', '--project', 'website-demo', '--text', 'Last').returncode, 0)
        events = json.loads(self.state_path.read_text('utf-8'))['projects'][0]['events']
        self.assertEqual(len(events), 30)
        self.assertEqual(events[0]['text'], 'Old 1')
        self.assertEqual(events[-1]['text'], 'Last')

    def test_init_preserves_existing_config_and_checkpoint(self):
        self.config['title'] = 'Custom local title'
        board.atomic_write(self.config_path, self.config, board.MAX_CONFIG_BYTES, board.validate_config)
        before = self.state_path.read_bytes(), self.config_path.read_bytes()
        self.assertEqual(self.cli('init').returncode, 0)
        self.assertEqual((self.state_path.read_bytes(), self.config_path.read_bytes()), before)

    def test_schema_and_total_encoded_bytes_are_bounded(self):
        changed = copy.deepcopy(self.state)
        changed['private_conversation'] = 'unsupported field'
        with self.assertRaises(ValueError):
            board.validate_state(changed)
        changed = copy.deepcopy(self.state)
        changed['projects'][0]['tasks'][0]['group'] = 'unknown'
        with self.assertRaises(ValueError):
            board.validate_state(changed)
        changed = copy.deepcopy(self.state)
        changed['projects'][0]['tasks'] = [{'id': f't{i}', 'title': 'Known task', 'group': 'delivery', 'status': 'pending', 'detail': '\u4e2d'*1200} for i in range(200)]
        before = self.state_path.read_bytes()
        with self.assertRaises(ValueError):
            board.atomic_write(self.state_path, changed)
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertFalse(list(self.directory.glob('*.tmp')))


class HTTPTests(Fixture):
    def setUp(self):
        super().setUp()
        self.http = server.create_server(self.state_path, self.config_path, 0)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join(timeout=3)
        super().tearDown()

    def request(self, path='/', method='GET', host=None, duplicate_host=False):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        connection.putrequest(method, path, skip_host=True)
        if host is not False:
            connection.putheader('Host', host or f'127.0.0.1:{self.http.server_port}')
        if duplicate_host:
            connection.putheader('Host', f'localhost:{self.http.server_port}')
        connection.endheaders()
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_fixed_routes_headers_dynamic_files_and_nonce(self):
        status, headers, html = self.request()
        self.assertEqual(status, 200)
        self.assertIn(b'lang="zh-Hant"', html)
        self.assertNotIn(b'__BOARD_NONCE__', html)
        self.assertIn("script-src 'nonce-", headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertNotEqual(html, self.request()[2])
        for path in ('/app.js', '/styles.css', '/config.json', '/state.json'):
            self.assertEqual(self.request(path)[0], 200)
        changed = copy.deepcopy(self.state); changed['projects'][0]['summary'] = 'Dynamically updated'
        board.atomic_write(self.state_path, changed)
        self.assertEqual(json.loads(self.request('/state.json')[2])['projects'][0]['summary'], 'Dynamically updated')
        self.assertEqual(self.http.server_address[0], '127.0.0.1')

    def test_paths_host_and_methods_cannot_write_or_read_other_files(self):
        before = self.state_path.read_bytes()
        for path in ('/server.py', '/../state.json', '/%2e%2e/server.py', '/state.json?x=1', '/.runtime/server.json', '/config.example.json'):
            self.assertEqual(self.request(path)[0], 404, path)
        for host in ('example.invalid', f'127.0.0.1:{self.http.server_port}.example.invalid', '127.0.0.1', False):
            self.assertEqual(self.request(host=host)[0], 403, host)
        self.assertEqual(self.request(duplicate_host=True)[0], 403)
        self.assertEqual(self.request(host=f'localhost:{self.http.server_port}')[0], 200)
        for method in ('HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE', 'BOGUS'):
            self.assertEqual(self.request('/state.json', method=method)[0], 405, method)
        self.assertEqual(self.state_path.read_bytes(), before)

    def test_oversize_invalid_json_and_invalid_schema_fail_closed(self):
        for raw in (b'x'*(board.MAX_STATE_BYTES+1), b'{', b'{"schema_version":1,"projects":"invalid"}'):
            self.state_path.write_bytes(raw)
            status, _, body = self.request('/state.json')
            self.assertEqual(status, 503)
            self.assertIn(b'Checkpoint temporarily unavailable', body)
            if len(raw) > 1:
                self.assertNotIn(raw[:100], body)


if __name__ == '__main__':
    unittest.main()
