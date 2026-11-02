"""Fixed-route, GET-only, loopback checkpoint board. Python standard library."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket

from board import ROOT, MAX_CONFIG_BYTES, MAX_STATE_BYTES, read_document, validate_config, validate_state


class Handler(BaseHTTPRequestHandler):
    server_version = 'CodexLocalBoard/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def trusted_host(self):
        values = self.headers.get_all('Host', [])
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        return len(values) == 1 and values[0].lower() in allowed

    def do_GET(self):
        if not self.trusted_host():
            self.send_error(403); return
        routes = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/styles.css': ('styles.css', 'text/css; charset=utf-8')}
        nonce = secrets.token_urlsafe(20)
        try:
            if self.path == '/state.json':
                value = read_document(self.server.state_path, MAX_STATE_BYTES, validate_state)
                data = json.dumps(value, ensure_ascii=False).encode('utf-8')
                kind = 'application/json; charset=utf-8'
            elif self.path == '/config.json':
                value = read_document(self.server.config_path, MAX_CONFIG_BYTES, validate_config)
                data = json.dumps(value, ensure_ascii=False).encode('utf-8')
                kind = 'application/json; charset=utf-8'
            elif self.path in routes:
                filename, kind = routes[self.path]
                data = (ROOT/'web'/filename).read_bytes()
                if self.path == '/':
                    data = data.replace(b'__BOARD_NONCE__', nonce.encode('ascii'))
            else:
                self.send_error(404); return
        except (OSError, ValueError, TypeError, UnicodeError):
            self.send_error(503, 'Checkpoint temporarily unavailable'); return
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def reject_method(self):
        self.send_error(405 if self.trusted_host() else 403)

    def __getattr__(self, name):
        if name.startswith('do_'):
            return self.reject_method
        raise AttributeError(name)

    def log_message(self, *_args):
        pass


class LoopbackServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != 'nt'
    allow_reuse_port = False

    def server_bind(self):
        # Windows SO_REUSEADDR can permit two listeners on the same address.
        # Use the OS's exclusive ownership guarantee instead.
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def create_server(state_path, config_path, port):
    server = LoopbackServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.state_path, server.config_path = Path(state_path), Path(config_path)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--state', type=Path, default=ROOT/'state.json')
    parser.add_argument('--config', type=Path, default=ROOT/'config.json')
    parser.add_argument('--check', action='store_true', help='Validate files without starting a server')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Port must be 1024–65535')
    try:
        read_document(args.state, MAX_STATE_BYTES, validate_state)
        read_document(args.config, MAX_CONFIG_BYTES, validate_config)
    except (OSError, ValueError, TypeError, UnicodeError):
        parser.error('Invalid or missing local state/config. Run update_state.py init first.')
    if args.check:
        print('Local checkpoint files valid; no server started.'); return
    try:
        server = create_server(args.state, args.config, args.port)
    except OSError:
        parser.error('Loopback port unavailable; select a different --port.')
    print(f'Local checkpoint board: http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
