"""sentry_config — 활성화 게이트 / release 문자열 / 스크러빙 정책."""
import asyncio

import pytest

import sentry_config


class TestEnableGate:
    def test_disabled_env_is_hard_off(self):
        """SIDECAR_DISABLE_SENTRY는 frozen/smoke보다 우선한다 (테스트 보호막)."""
        env = {"SIDECAR_DISABLE_SENTRY": "1", "SIDECAR_VERSION": "1.1.32",
               "SIDECAR_SENTRY_SMOKE": "1"}
        assert sentry_config.is_enabled(env, frozen=True) is False

    def test_bare_dev_venv_is_off(self):
        """pnpm dev로 직접 띄운 venv 사이드카는 꺼져 있어야 한다."""
        assert sentry_config.is_enabled({}, frozen=False) is False

    def test_spawned_by_tauri_is_on(self):
        assert sentry_config.is_enabled({"SIDECAR_VERSION": "1.1.32"}, frozen=False) is True

    def test_frozen_is_on(self):
        assert sentry_config.is_enabled({}, frozen=True) is True

    @pytest.mark.parametrize("value", ["1", "true"])
    def test_smoke_opt_in_is_on(self, value):
        assert sentry_config.is_enabled({"SIDECAR_SENTRY_SMOKE": value}, frozen=False) is True

    def test_smoke_other_values_are_off(self):
        assert sentry_config.is_enabled({"SIDECAR_SENTRY_SMOKE": "0"}, frozen=False) is False


class TestReleaseAndEnvironment:
    def test_release_uses_app_name_not_crate_name(self):
        assert sentry_config.release_name({"SIDECAR_VERSION": "1.1.32"}) == "first-crack@1.1.32"

    @pytest.mark.parametrize("value", ["", "unknown", "v1.1.32", "1.1"])
    def test_release_falls_back_to_unknown(self, value):
        assert sentry_config.release_name({"SIDECAR_VERSION": value}) == "first-crack@unknown"

    def test_release_missing_env(self):
        assert sentry_config.release_name({}) == "first-crack@unknown"

    def test_environment_production_when_spawned_or_frozen(self):
        assert sentry_config.environment_name({"SIDECAR_VERSION": "1.1.32"}, frozen=False) == "production"
        assert sentry_config.environment_name({}, frozen=True) == "production"

    def test_environment_development_for_smoke(self):
        assert sentry_config.environment_name({"SIDECAR_SENTRY_SMOKE": "1"}, frozen=False) == "development"


class TestScrubbing:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("connect failed host=10.0.0.2 attempt=3", "connect failed host=[redacted] attempt=3"),
            ("comport=/dev/tty.usbserial-1420 busy", "comport=[redacted] busy"),
            ("Authorization: Bearer abc.def", "Authorization: [redacted]"),
            ("SIDECAR_TOKEN=deadbeefcafe", "SIDECAR_TOKEN=[redacted]"),
            ("GET https://api.dev/v1?key=v failed", "GET https://api.dev/v1?[redacted] failed"),
        ],
    )
    def test_scrub_text(self, raw, expected):
        assert sentry_config.scrub_text(raw) == expected

    def test_scrub_mapping_keys(self):
        scrubbed = sentry_config.scrub(
            {"protocol": "modbus_tcp", "host": "10.0.0.2", "password": "hunter2", "nested": {"comport": "COM3"}}
        )
        assert scrubbed == {
            "protocol": "modbus_tcp",
            "host": "[redacted]",
            "password": "[redacted]",
            "nested": {"comport": "[redacted]"},
        }

    def test_scrub_depth_ceiling(self):
        deep = {"a": {"b": {"c": {"d": {"e": {"f": "leaf"}}}}}}
        assert sentry_config.scrub(deep)["a"]["b"]["c"]["d"]["e"] == "[redacted]"

    def test_scrub_local_file_paths(self):
        assert "hanseungheon" not in sentry_config.scrub_text(
            "failed to open /Users/hanseungheon/Library/Application Support/x.log"
        )


class TestActionability:
    @pytest.mark.parametrize("status", [400, 401, 404, 409])
    def test_expected_4xx_dropped(self, status):
        assert sentry_config.is_actionable(_HttpError(status)) is False

    def test_rate_limit_kept(self):
        assert sentry_config.is_actionable(_HttpError(429)) is True

    def test_5xx_kept(self):
        assert sentry_config.is_actionable(_HttpError(502)) is True

    @pytest.mark.parametrize("exc", [asyncio.CancelledError(), KeyboardInterrupt(), SystemExit()])
    def test_cancel_and_clean_shutdown_dropped(self, exc):
        assert sentry_config.is_actionable(exc) is False

    def test_unhandled_exception_kept(self):
        assert sentry_config.is_actionable(OSError("PLC unreachable")) is True

    def test_classified_hardware_exception_kept(self):
        """Manager capture_exception of a dead PLC still has to be diagnosable."""
        assert sentry_config.is_actionable(RuntimeError("BT out of range (0.0)")) is True

    def test_missing_serial_port_is_user_configuration(self):
        """FC-1Y: 빈 comport는 설정 문제라 이슈로 남기지 않는다. 실제 포트 실패는 남긴다."""
        assert sentry_config.is_actionable(ValueError("MODBUS serial: comport가 비어 있음.")) is False
        assert sentry_config.is_actionable(ValueError("Kaleido Serial 모드: comport가 비어 있음.")) is False
        assert sentry_config.is_actionable(ConnectionError("MODBUS 연결 실패: /dev/ttyUSB0")) is True


class _HttpError(Exception):
    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


class TestBeforeSend:
    def test_drops_non_actionable(self):
        event = {"message": "unauthorized"}
        assert sentry_config.before_send(event, {"exc_info": (type(_HttpError(401)), _HttpError(401), None)}) is None

    def test_drops_snap7_library_timeout_logs(self):
        """FC-1N: snap7.common ERROR logs are PLC recv timeouts, not a separate bug."""
        event = {
            "logger": "snap7.common",
            "message": "b' ISO : An error occurred during recv TCP : Connection timed out'",
        }
        assert sentry_config.before_send(event, {}) is None

    def test_keeps_manager_classified_disconnect(self):
        event = {"logger": "manager", "message": "읽기 실패: BT out of range (0.0)"}
        assert sentry_config.before_send(event, {}) is not None

    def test_scrubs_surviving_event(self):
        event = {
            "message": "connect failed host=10.0.0.2",
            "contexts": {"connection": {"comport": "COM3"}},
            "breadcrumbs": {"values": [{"message": "token=abc", "data": {"host": "10.0.0.2"}}]},
        }
        out = sentry_config.before_send(event, {})
        assert out is not None
        assert out["message"] == "connect failed host=[redacted]"
        assert out["contexts"]["connection"]["comport"] == "[redacted]"
        assert out["breadcrumbs"]["values"][0]["message"] == "token=[redacted]"
        assert out["breadcrumbs"]["values"][0]["data"]["host"] == "[redacted]"

    def test_before_breadcrumb_scrubs(self):
        crumb = sentry_config.before_breadcrumb({"message": "reconnect failed: host=10.0.0.2"}, {})
        assert crumb["message"] == "reconnect failed: host=[redacted]"
