"""Tests for PhidgetAdapter read contract (H1).

핵심 계약: BT 읽기 실패는 예외로 전파돼야 manager의 stale/재연결 경로가 작동한다.
ET는 선택 채널이라 실패해도 -1.0 soft-fail로 로스팅을 계속한다.
"""
import asyncio
import threading
import unittest.mock as mock

import pytest

from adapters.phidget import PhidgetAdapter


def _sensor(value: float | None = None, exc: Exception | None = None):
    s = mock.MagicMock()
    if exc is not None:
        s.getTemperature.side_effect = exc
    else:
        s.getTemperature.return_value = value
    return s


class TestPhidgetRead:
    async def test_bt_failure_propagates(self):
        """BT getTemperature 예외는 삼키지 않고 read()로 전파돼야 한다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(exc=RuntimeError("EPHIDGET_NOTATTACHED"))
        adapter._sensor_et = _sensor(210.0)

        with pytest.raises(RuntimeError, match="EPHIDGET_NOTATTACHED"):
            await adapter.read()

    async def test_et_failure_soft_fails(self):
        """ET만 실패하면 BT는 정상값, ET는 -1.0으로 반환한다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(185.44)
        adapter._sensor_et = _sensor(exc=RuntimeError("EPHIDGET_NOTATTACHED"))

        reading = await adapter.read()
        assert reading.bt == 185.4
        assert reading.et == -1.0

    async def test_missing_et_channel_returns_sentinel(self):
        adapter = PhidgetAdapter(channel_et=None)
        adapter._sensor_bt = _sensor(180.0)
        adapter._sensor_et = None

        reading = await adapter.read()
        assert reading.bt == 180.0
        assert reading.et == -1.0

    async def test_heater_channel_is_none_not_zero(self):
        """열전대만 있는 장치는 화력 채널이 없다 — 0은 '측정 0'과 구분되지 않는다."""
        adapter = PhidgetAdapter()
        adapter._sensor_bt = _sensor(180.0)
        adapter._sensor_et = _sensor(210.0)

        reading = await adapter.read()
        assert reading.heater is None

    async def test_read_without_connect_raises(self):
        adapter = PhidgetAdapter()
        with pytest.raises(ConnectionError):
            await adapter.read()


class TestConnectCancellation:
    """openWaitForAttachment(5s)는 중단 불가 — 뒤늦은 완료를 사후 차단해야 한다 (#208)."""

    @pytest.fixture(autouse=True)
    def discovered_sensor(self, monkeypatch):
        monkeypatch.setattr(PhidgetAdapter, "_discover", lambda *_: {(89, 123, 0, 0)})
        monkeypatch.setattr(PhidgetAdapter, "_configure_sensor", lambda *_: None)

    async def test_late_attach_after_session_bump_is_discarded(self):
        adapter = PhidgetAdapter(channel_et=None)
        sensor = mock.MagicMock()

        def bump_session(_timeout):
            adapter._session += 1  # attach 대기 중 disconnect 상당

        sensor.openWaitForAttachment.side_effect = bump_session

        with mock.patch.object(PhidgetAdapter, "_make_sensor", return_value=sensor):
            with pytest.raises(ConnectionError, match="취소"):
                await adapter.connect()

        assert adapter._sensor_bt is None, "취소된 시도가 센서를 바인딩하면 안 된다"
        assert adapter.connected is False
        assert sensor.close.call_count == 1, "열린 핸들은 닫아야 한다 (누수 방지)"

    async def test_normal_connect_binds_sensors(self):
        adapter = PhidgetAdapter(channel_et=None)
        sensor = mock.MagicMock()

        with mock.patch.object(PhidgetAdapter, "_make_sensor", return_value=sensor):
            await adapter.connect()

        assert adapter._sensor_bt is sensor
        assert adapter.connected is True

    async def test_disconnect_bumps_session(self):
        adapter = PhidgetAdapter()
        before = adapter._session
        await adapter.disconnect()
        assert adapter._session == before + 1


def _identified_sensor(address, value=180.0):
    sensor = _sensor(value)
    for method, result in zip(("getDeviceID", "getDeviceSerialNumber", "getHubPort", "getChannel"), address):
        getattr(sensor, method).return_value = result
    return sensor


class TestPhidgetConfiguration:
    @pytest.mark.parametrize("params", [
        {"channel_bt": -1}, {"channel_bt": 4}, {"channel_bt": 1.5}, {"channel_bt": True},
        {"bt_device_type": "TMP1200", "channel_bt": 1},
        {"et_device_type": "TMP1202", "channel_et": 1},
        {"bt_device_type": "bad"}, {"bt_device_type": False},
        {"bt_serial_number": 0}, {"bt_serial_number": 2147483648}, {"bt_serial_number": True},
        {"bt_hub_port": -1}, {"bt_hub_port": 6}, {"bt_hub_port": 1.5},
        {"device_type": "1048", "bt_hub_port": 0},
        {"bt_thermocouple_type": "R"}, {"bt_thermocouple_type": False},
        {"bt_rtd_type": "PT500"}, {"bt_rtd_wire_setup": 1}, {"bt_rtd_wire_setup": "3"},
    ])
    def test_invalid_parameters_rejected_before_open(self, params):
        with pytest.raises(ValueError):
            PhidgetAdapter(**params)

    def test_legacy_defaults_and_role_override_and_disabled_et(self):
        legacy = PhidgetAdapter(serial_number=123)
        assert legacy._roles["bt"]["serial"] == 123
        assert legacy._roles["et"]["channel"] == 1
        assert legacy._roles["bt"]["thermocouple_type"] == "K"
        adapter = PhidgetAdapter(device_type="1048", serial_number=123, bt_serial_number=None,
                                 bt_device_type="TMP1202", channel_et=None, et_device_type="ignored")
        assert adapter._roles["bt"]["serial"] is None
        assert adapter._roles["bt"]["rtd_type"] == "PT1000_3850"
        assert adapter._roles["bt"]["rtd_wire_setup"] == 4
        assert "et" not in adapter._roles

    @pytest.mark.parametrize("tc,expected", [("K", 2), ("J", 1), ("E", 3), ("T", 4)])
    def test_thermocouple_configuration_and_addressing(self, tc, expected):
        adapter = PhidgetAdapter(channel_et=None, bt_thermocouple_type=tc)
        address = (89, 123, 4, 0)
        sensor = _identified_sensor(address)
        with mock.patch("Phidget22.Devices.TemperatureSensor.TemperatureSensor", return_value=sensor):
            assert adapter._make_sensor("bt", address) is sensor
        sensor.setDeviceSerialNumber.assert_called_once_with(123)
        sensor.setHubPort.assert_called_once_with(4)
        sensor.setChannel.assert_called_once_with(0)
        sensor.setIsRemote.assert_called_once_with(False)
        attached = sensor.setOnAttachHandler.call_args.args[0]
        attached(sensor)
        attached(sensor)  # USB auto-reattach must reapply probe settings.
        assert sensor.setThermocoupleType.call_args_list == [mock.call(expected), mock.call(expected)]
        sensor.setRTDType.assert_not_called()

    @pytest.mark.parametrize("rtd,expected", [("PT100_3850", 1), ("PT1000_3850", 2),
                                             ("PT100_3920", 3), ("PT1000_3920", 4)])
    @pytest.mark.parametrize("wire,expected_wire", [(2, 1), (3, 2), (4, 3)])
    def test_rtd_type_and_wire_sdk_enum_mapping(self, rtd, expected, wire, expected_wire):
        adapter = PhidgetAdapter(device_type="TMP1202", channel_et=None,
                                 bt_rtd_type=rtd, bt_rtd_wire_setup=wire)
        address = (158, 123, 2, 0)
        sensor = _identified_sensor(address)
        adapter._configure_sensor(sensor, "bt", address)
        sensor.setRTDType.assert_called_once_with(expected)
        sensor.setRTDWireSetup.assert_called_once_with(expected_wire)
        sensor.setThermocoupleType.assert_not_called()

    def test_resolves_model_and_independent_addresses_and_rejects_ambiguity(self):
        available = {(26, 11, 0, 0), (89, 123, 0, 0), (89, 123, 0, 1), (90, 123, 2, 0)}
        adapter = PhidgetAdapter(et_device_type="TMP1200", channel_et=0, et_hub_port=2)
        assert adapter._resolve_addresses(available) == {"bt": (89, 123, 0, 0), "et": (90, 123, 2, 0)}
        with pytest.raises(ConnectionError, match="여러"):
            adapter._resolve_addresses(available | {(89, 456, 0, 0)})
        with pytest.raises(ConnectionError, match="찾을"):
            adapter._resolve_addresses({(26, 11, 0, 0)})

    def test_same_physical_channel_rejected(self):
        with pytest.raises(ValueError, match="서로 다른"):
            PhidgetAdapter(channel_et=0)._resolve_addresses({(89, 123, 0, 0)})

    def test_cached_identity_does_not_switch_after_disconnect(self):
        adapter = PhidgetAdapter(channel_et=None)
        adapter._addresses = adapter._resolve_addresses({(89, 123, 2, 0)})
        assert adapter._resolve_addresses({(89, 999, 2, 0)}) == {"bt": (89, 123, 2, 0)}

    def test_post_open_model_mismatch_rejected_before_configuration(self):
        adapter = PhidgetAdapter(channel_et=None)
        sensor = _identified_sensor((26, 123, 0, 0))
        with pytest.raises(ConnectionError, match="다릅니다"):
            adapter._configure_sensor(sensor, "bt", (89, 123, 0, 0))
        sensor.setThermocoupleType.assert_not_called()

    async def test_reattach_configuration_failure_invalidates_bt(self):
        adapter = PhidgetAdapter(channel_et=None)
        address = (89, 123, 2, 0)
        sensor = _identified_sensor(address)
        with mock.patch("Phidget22.Devices.TemperatureSensor.TemperatureSensor", return_value=sensor):
            adapter._sensor_bt = adapter._make_sensor("bt", address)
        sensor.setThermocoupleType.side_effect = RuntimeError("probe configuration")
        sensor.setOnAttachHandler.call_args.args[0](sensor)
        with pytest.raises(RuntimeError, match="probe configuration"):
            await adapter.read()

    @pytest.mark.parametrize("failing_role", ["bt", "et"])
    async def test_attach_failure_closes_every_created_handle(self, failing_role):
        addresses = [(89, 123, 0, 0), (89, 123, 0, 1)]
        sensors = [_identified_sensor(address) for address in addresses]
        sensors[0 if failing_role == "bt" else 1].openWaitForAttachment.side_effect = RuntimeError("attach failed")
        adapter = PhidgetAdapter()
        with mock.patch.object(adapter, "_discover", return_value=set(addresses)), \
             mock.patch.object(adapter, "_make_sensor", side_effect=sensors):
            with pytest.raises(RuntimeError, match="attach failed"):
                await adapter.connect()
        sensors[0].close.assert_called_once()
        assert sensors[1].close.call_count == (1 if failing_role == "et" else 0)
        assert not adapter.connected
        assert adapter._sensor_bt is None

    async def test_configuration_failure_closes_handles(self):
        address = (89, 123, 0, 0)
        sensor = _identified_sensor(address)
        sensor.setThermocoupleType.side_effect = RuntimeError("bad probe")
        adapter = PhidgetAdapter(channel_et=None)
        with mock.patch.object(adapter, "_discover", return_value={address}), \
             mock.patch.object(adapter, "_make_sensor", return_value=sensor):
            with pytest.raises(RuntimeError, match="bad probe"):
                await adapter.connect()
        sensor.close.assert_called_once()

    async def test_cancelled_await_closes_late_attach(self):
        address = (89, 123, 0, 0)
        sensor = _identified_sensor(address)
        started, released, closed = threading.Event(), threading.Event(), threading.Event()
        sensor.openWaitForAttachment.side_effect = lambda _: (started.set(), released.wait(2))
        sensor.close.side_effect = closed.set
        adapter = PhidgetAdapter(channel_et=None)
        with mock.patch.object(adapter, "_discover", return_value={address}), \
             mock.patch.object(adapter, "_make_sensor", return_value=sensor):
            task = asyncio.create_task(adapter.connect())
            assert await asyncio.to_thread(started.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            released.set()
            assert await asyncio.to_thread(closed.wait, 2)
        assert not adapter.connected
        assert adapter._sensor_bt is None

    def test_first_conversion_unknown_value_retries_only_until_ready(self):
        class UnknownValue(Exception):
            code = 51
        sensor = _sensor(180.0)
        sensor.getTemperature.side_effect = [UnknownValue(), 180.0]
        cancel = mock.Mock()
        cancel.is_set.return_value = False
        PhidgetAdapter._wait_for_temperature(sensor, cancel)
        assert sensor.getTemperature.call_count == 2
        cancel.wait.assert_called_once_with(0.05)
        sensor.getTemperature.side_effect = RuntimeError("not attached")
        with pytest.raises(RuntimeError, match="not attached"):
            PhidgetAdapter._wait_for_temperature(sensor, cancel)


class TestPhidgetDiscovery:
    @staticmethod
    def channel(address, *, temperature=True, remote=False):
        sensor = _identified_sensor(address)
        sensor.getChannelClass.return_value = 28 if temperature else 1
        sensor.getIsRemote.return_value = remote
        return sensor

    def test_discovers_all_local_channels_and_handles_detach(self):
        from Phidget22.ChannelClass import ChannelClass
        channels = [self.channel((89, 123, 0, 0)), self.channel((89, 456, 1, 0)),
                    self.channel((89, 999, 0, 0), remote=True), self.channel((89, 888, 0, 0), temperature=False)]
        for channel in channels[:3]:
            channel.getChannelClass.return_value = ChannelClass.PHIDCHCLASS_TEMPERATURESENSOR
        manager = mock.Mock()
        def opened():
            for channel in channels:
                manager.setOnAttachHandler.call_args.args[0](manager, channel)
            manager.setOnDetachHandler.call_args.args[0](manager, channels[1])
        manager.open.side_effect = opened
        cancel = mock.Mock()
        cancel.wait.return_value = False
        with mock.patch("Phidget22.Devices.Manager.Manager", return_value=manager):
            addresses = PhidgetAdapter()._discover(cancel)
        assert addresses == {(89, 123, 0, 0)}
        cancel.wait.assert_called_once_with(PhidgetAdapter._DISCOVERY_SECONDS)
        manager.close.assert_called_once()

    def test_discovery_closes_manager_on_cancellation_and_open_failure(self):
        manager = mock.Mock()
        cancel = threading.Event()
        cancel.set()
        with mock.patch("Phidget22.Devices.Manager.Manager", return_value=manager):
            with pytest.raises(ConnectionError, match="취소"):
                PhidgetAdapter()._discover(cancel)
        manager.close.assert_called_once()
        manager.reset_mock()
        manager.open.side_effect = RuntimeError("native failure")
        with mock.patch("Phidget22.Devices.Manager.Manager", return_value=manager):
            with pytest.raises(RuntimeError, match="native failure"):
                PhidgetAdapter()._discover(cancel)
        manager.close.assert_called_once()
