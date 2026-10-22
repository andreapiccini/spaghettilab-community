#!/usr/bin/env python3
"""Local, authenticated operator commands for the Maker Faire Chromium extension."""
import argparse
from functools import partial
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'spaghettilab-kiosk'
PORT = 8767
ACTIONS = {'italiano', 'inglese', 'demo', 'questionario', 'salva-base', 'ripristina', 'stop', 'dashboard', 'svuota'}

class Dashboard:
    """Serve a compiled release only while the presentation tab is in use."""
    def __init__(self, directory=None, port=8080):
        self.directory = Path(directory or Path.home() / '.local/share/spaghettilab-kiosk/dashboard-web')
        self.port = port
        self.server = None
        self.thread = None

    @property
    def running(self):
        return self.server is not None

    def start(self):
        if self.running:
            return
        if not (self.directory / 'index.html').is_file():
            raise ValueError('Dashboard non compilata: installa prima la versione web da presentazione.')
        class StaticHandler(SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def copyfile(self, source, outputfile):
                try:
                    super().copyfile(source, outputfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Closing the dashboard may cancel an asset download.
        try:
            self.server = ThreadingHTTPServer(('127.0.0.1', self.port), partial(StaticHandler, directory=str(self.directory)))
        except OSError as error:
            raise ValueError(f'Impossibile avviare la dashboard sulla porta {self.port}: {error}') from error
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.1}, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=2)
            self.server = None
            self.thread = None


class Commands:
    def __init__(self, dashboard=None):
        self.dashboard = dashboard or Dashboard()
        self.condition = threading.Condition()
        self.sequence = int(time.time() * 1000)
        self.pending = None
        self.result = None
        self.last_poll = 0
        self.browser = {}

    def next(self, after):
        with self.condition:
            self.last_poll = time.monotonic()
            self.condition.wait_for(lambda: self.pending is not None and self.pending['id'] > after and self.pending['expires'] > time.time(), 15)
            self.last_poll = time.monotonic()
            job = self.pending
            return job if job and job['id'] > after and job['expires'] > time.time() else None

    def submit(self, action):
        with self.condition:
            if self.pending:
                raise ValueError('Un comando è già in corso. Controlla stato prima di riprovare.')
            if action == 'dashboard':
                self.dashboard.start()
            self.sequence += 1
            job = {'id': self.sequence, 'action': 'salva-base' if action == 'svuota' else action, 'intent': 'clear-project' if action == 'svuota' else '', 'expires': time.time() + 120}
            self.pending = job
            self.result = None
            self.condition.notify_all()
            done = self.condition.wait_for(lambda: self.result and self.result['id'] == job['id'], 125)
            if not done:
                self.pending = None
                return {'ok': False, 'error': 'Nessuna conferma dal browser. Controlla stato: non ripetere un ripristino senza verificarlo.'}
            result = self.result
            self.pending = None
            return result

    def acknowledge(self, result):
        with self.condition:
            if self.pending and result.get('id') == self.pending['id']:
                leaving_dashboard = self.pending['action'] in {'demo', 'italiano', 'inglese', 'questionario', 'ripristina'}
                if (result.get('ok') and leaving_dashboard) or (not result.get('ok') and self.pending['action'] == 'dashboard'):
                    self.dashboard.stop()
                if self.pending.get('intent') == 'clear-project' and result.get('ok') and result.get('operation') != 'clear-project':
                    result = {**result, 'ok': False, 'error': 'Reset non confermato: controllo del canvas non aggiornato.'}
                self.result = result
                self.browser = result.get('state', {})
                self.condition.notify_all()

    def status(self):
        with self.condition:
            return {'connected': time.monotonic() - self.last_poll < 35,
                    'pending': self.pending, 'lastResult': self.result, 'browser': self.browser,
                    'dashboard': {'running': self.dashboard.running, 'url': 'http://127.0.0.1:8080'}}


def token():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = ROOT / 'token'
    if not path.exists():
        path.write_text(secrets.token_urlsafe(32))
    path.chmod(0o600)
    return path.read_text().strip()


def handler(commands, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log questionnaire URLs, responses or authorization headers.

        def reply(self, data, code=200):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            origin = self.headers.get('Origin', '')
            if self.path == '/app-intent' and origin in {'http://localhost:5173', 'http://127.0.0.1:5173'}:
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authenticated(self):
            valid = hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + secret)
            if not valid:
                self.reply({'ok': False, 'error': 'Unauthorized'}, 401)
            return valid

        def do_GET(self):
            if self.path == '/app-intent':
                if self.headers.get('Origin') not in {'http://localhost:5173', 'http://127.0.0.1:5173'}:
                    return self.reply({'ok': False}, 403)
                with commands.condition:
                    pending = commands.pending
                    if not pending or pending['action'] != 'salva-base' or pending['expires'] <= time.time():
                        return self.reply({'ok': False}, 409)
                    return self.reply({'intent': pending.get('intent', '')})
            if not self.authenticated():
                return
            if self.path == '/status':
                self.reply(commands.status())
            elif self.path.startswith('/next?after='):
                try:
                    after = int(self.path.split('=', 1)[1])
                except ValueError:
                    return self.reply({'error': 'Invalid cursor'}, 400)
                self.reply({'command': commands.next(after)})
            else:
                self.reply({'error': 'Not found'}, 404)

        def do_POST(self):
            if not self.authenticated():
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 8192:
                    raise ValueError('Invalid body length')
                data = json.loads(self.rfile.read(length))
                if self.path == '/command' and data.get('action') in ACTIONS:
                    self.reply(commands.submit(data['action']))
                elif self.path == '/ack':
                    commands.acknowledge(data)
                    self.reply({'ok': True})
                else:
                    self.reply({'error': 'Invalid command'}, 400)
            except (ValueError, TypeError) as error:
                self.reply({'ok': False, 'error': str(error)}, 400)
    return Handler


def main():
    parser = argparse.ArgumentParser(description='Questionari e demo Maker Faire')
    parser.add_argument('command', choices=['serve', 'stato', 'init', *sorted(ACTIONS)])
    args = parser.parse_args()
    secret = token()
    if args.command == 'init':
        print('Configurazione pronta')
        return
    if args.command == 'serve':
        server = ThreadingHTTPServer(('127.0.0.1', PORT), handler(Commands(), secret))
        server.daemon_threads = True
        server.serve_forever()
        return
    body = None if args.command == 'stato' else json.dumps({'action': args.command}).encode()
    request = Request(f'http://127.0.0.1:{PORT}/' + ('status' if body is None else 'command'), data=body,
                      headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=130) as response:
            result = json.load(response)
        if args.command == 'svuota' and result.get('ok'):
            show = Request(f'http://127.0.0.1:{PORT}/command', data=json.dumps({'action': 'demo'}).encode(), headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'})
            with urlopen(show, timeout=130) as response:
                view = json.load(response)
            result['view'] = view
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result.get('ok') is False:
            raise SystemExit(1)
    except (HTTPError, URLError, TimeoutError) as error:
        parser.exit(1, f'Comando non confermato: {error}. Controlla spaghettilab-fiera stato.\n')

if __name__ == '__main__':
    main()
