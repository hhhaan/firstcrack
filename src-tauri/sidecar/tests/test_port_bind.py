"""Tests for bind guards so a taken :9999 does not hard-crash (FC-J)."""
import errno
import http.server
import socket
import threading
import unittest.mock as mock
from collections.abc import Callable

import pytest


def _serve_status(status: int) -> tuple[str, int, Callable[[], None]]:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            self.send_response(status if path == "/status" else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]

    def stop() -> None:
        server.shutdown()
        server.server_close()

    return host, port, stop


class TestIsAddrInUseError:
    def test_eaddrinuse_is_detected(self):
        from main import _is_addr_in_use_error

        assert _is_addr_in_use_error(OSError(errno.EADDRINUSE, "address already in use")) is True

    def test_other_oserror_is_not(self):
        from main import _is_addr_in_use_error

        assert _is_addr_in_use_error(OSError(errno.ECONNREFUSED, "refused")) is False

    def test_non_oserror_is_not(self):
        from main import _is_addr_in_use_error

        assert _is_addr_in_use_error(RuntimeError("nope")) is False


class TestExitIfPortTaken:
    def test_free_port_allows_bind(self):
        from main import _exit_if_port_taken

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        host, port = sock.getsockname()[:2]
        sock.close()
        _exit_if_port_taken(host, port, timeout=0.2)

    def test_healthy_sidecar_exits_successfully(self):
        from main import _exit_if_port_taken

        host, port, stop = _serve_status(200)
        try:
            with pytest.raises(SystemExit) as exc:
                _exit_if_port_taken(host, port, timeout=0.5)
            assert exc.value.code == 0
        finally:
            stop()

    def test_token_protected_sidecar_exits_successfully(self):
        """401 on /status still means our sidecar is already serving."""
        from main import _exit_if_port_taken

        host, port, stop = _serve_status(401)
        try:
            with pytest.raises(SystemExit) as exc:
                _exit_if_port_taken(host, port, timeout=0.5)
            assert exc.value.code == 0
        finally:
            stop()

    def test_foreign_http_occupant_exits_handled(self):
        from main import _exit_if_port_taken

        host, port, stop = _serve_status(404)
        try:
            with pytest.raises(SystemExit) as exc:
                _exit_if_port_taken(host, port, timeout=0.5)
            assert exc.value.code == 1
        finally:
            stop()

    def test_non_http_listener_exits_handled(self):
        from main import _exit_if_port_taken

        sock = socket.socket()
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        host, port = sock.getsockname()[:2]
        try:
            with pytest.raises(SystemExit) as exc:
                _exit_if_port_taken(host, port, timeout=0.3)
            assert exc.value.code == 1
        finally:
            sock.close()


class TestRunBindConflict:
    def test_run_reuses_healthy_occupant_without_bind(self, monkeypatch):
        from main import _run

        host, port, stop = _serve_status(200)
        monkeypatch.delenv("SIDECAR_PARENT_PID", raising=False)
        monkeypatch.setattr("main.SIDECAR_HOST", host)
        monkeypatch.setattr("main.SIDECAR_PORT", port)
        try:
            with mock.patch("main.web.run_app") as run_app:
                with pytest.raises(SystemExit) as exc:
                    _run()
            assert exc.value.code == 0
            run_app.assert_not_called()
        finally:
            stop()

    def test_eaddrinuse_from_run_app_exits_handled(self, monkeypatch):
        from main import _run

        monkeypatch.delenv("SIDECAR_PARENT_PID", raising=False)
        with mock.patch("main._exit_if_port_taken"):
            with mock.patch(
                "main.web.run_app",
                side_effect=OSError(errno.EADDRINUSE, "address already in use"),
            ):
                with pytest.raises(SystemExit) as exc:
                    _run()
        assert exc.value.code == 1

    def test_other_oserror_from_run_app_propagates(self, monkeypatch):
        from main import _run

        monkeypatch.delenv("SIDECAR_PARENT_PID", raising=False)
        with mock.patch("main._exit_if_port_taken"):
            with mock.patch(
                "main.web.run_app",
                side_effect=OSError(errno.EPERM, "operation not permitted"),
            ):
                with pytest.raises(OSError) as exc:
                    _run()
        assert exc.value.errno == errno.EPERM
