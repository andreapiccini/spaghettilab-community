import importlib.util
from pathlib import Path
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('kiosk', Path(__file__).parents[1] / 'kiosk.py')
kiosk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kiosk)

class CommandsTest(unittest.TestCase):
    def test_command_waits_for_its_own_acknowledgment(self):
        queue = kiosk.Commands()
        results = []
        thread = threading.Thread(target=lambda: results.append(queue.submit('demo')))
        thread.start()
        job = queue.next(0)
        self.assertEqual(job['action'], 'demo')
        queue.acknowledge({'id': job['id'] - 1, 'ok': True})
        self.assertTrue(thread.is_alive())
        queue.acknowledge({'id': job['id'], 'ok': True})
        thread.join(1)
        self.assertEqual(results, [{'id': job['id'], 'ok': True}])
        self.assertIsNone(queue.status()['pending'])

    def test_concurrent_operator_commands_are_rejected(self):
        queue = kiosk.Commands()
        thread = threading.Thread(target=lambda: queue.submit('ripristina'))
        thread.start()
        job = queue.next(0)
        with self.assertRaises(ValueError):
            queue.submit('inglese')
        queue.acknowledge({'id': job['id'], 'ok': False, 'error': 'Stop non confermato'})
        thread.join(1)
        self.assertFalse(queue.status()['lastResult']['ok'])

    def test_server_binds_only_to_loopback_and_requires_token(self):
        import json
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        server = kiosk.ThreadingHTTPServer(('127.0.0.1', 0), kiosk.handler(kiosk.Commands(), 'test-only-token'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:' + str(server.server_port) + '/status'
        try:
            with self.assertRaises(HTTPError) as error:
                urlopen(url)
            self.assertEqual(error.exception.code, 401)
            error.exception.close()
            with urlopen(Request(url, headers={'Authorization': 'Bearer test-only-token'})) as response:
                self.assertFalse(json.load(response)['connected'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

class DashboardTest(unittest.TestCase):
    def test_static_server_starts_once_and_releases_port_when_stopped(self):
        import tempfile
        from urllib.request import urlopen
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'index.html').write_text('<title>Dashboard demo</title>')
            dashboard = kiosk.Dashboard(directory, port=0)
            self.assertFalse(dashboard.running)
            try:
                dashboard.start()
                first = dashboard.server
                dashboard.start()
                self.assertIs(first, dashboard.server)
                with urlopen('http://127.0.0.1:' + str(first.server_port), timeout=3) as response:
                    self.assertIn(b'Dashboard demo', response.read())
            finally:
                dashboard.stop()
            self.assertFalse(dashboard.running)
            self.assertIsNone(dashboard.thread)

    def test_return_to_demo_stops_dashboard_only_after_browser_confirms(self):
        from unittest.mock import Mock
        dashboard = Mock()
        queue = kiosk.Commands(dashboard)
        thread = threading.Thread(target=lambda: queue.submit('demo'))
        thread.start()
        job = queue.next(0)
        dashboard.stop.assert_not_called()
        queue.acknowledge({'id': job['id'], 'ok': True})
        thread.join(1)
        dashboard.stop.assert_called_once()

    def test_failed_switch_keeps_dashboard_available(self):
        from unittest.mock import Mock
        dashboard = Mock()
        queue = kiosk.Commands(dashboard)
        thread = threading.Thread(target=lambda: queue.submit('demo'))
        thread.start()
        job = queue.next(0)
        queue.acknowledge({'id': job['id'], 'ok': False})
        thread.join(1)
        dashboard.stop.assert_not_called()

if __name__ == '__main__':
    unittest.main()
