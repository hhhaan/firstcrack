"""Behavioral tests for ModbusAdapter.

These tests verify the Modbus adapter's decoding logic, retry behavior,
and protocol handling using mocked pymodbus clients. No hardware needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pymodbus.framer import FramerType

from adapters.modbus import ModbusAdapter, _bcd_decode


# ---------------------------------------------------------------------------
# _bcd_decode pure function tests
# ---------------------------------------------------------------------------

class TestBcdDecode:
    def test_decode_single_digit(self):
        assert _bcd_decode(0x5) == 5

    def test_decode_two_digits(self):
        assert _bcd_decode(0x12) == 12

    def test_decode_three_digits(self):
        assert _bcd_decode(0x212) == 212

    def test_decode_four_digits(self):
        assert _bcd_decode(0x1234) == 1234

    def test_decode_zero(self):
        assert _bcd_decode(0x0) == 0

    def test_decode_max_16bit(self):
        assert _bcd_decode(0x9999) == 9999


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def modbus_regs():
    return {
        "BT": {"register": 100, "func": 3, "unit_id": 1, "float": False, "div": 0, "mode": "C", "signed": False},
        "ET": {"register": 102, "func": 3, "unit_id": 1, "float": False, "div": 0, "mode": "C", "signed": False},
        "drum": {"register": 104, "func": 3, "unit_id": 1, "float": False, "div": 0, "mode": "C", "signed": False},
    }


@pytest.fixture
def adapter(modbus_regs):
    return ModbusAdapter(
        mode="tcp",
        host="192.168.1.100",
        port=502,
        modbus_registers=modbus_regs,
    )


# ---------------------------------------------------------------------------
# __init__ tests
# ---------------------------------------------------------------------------

class TestInit:
    def test_default_read_retries_tcp(self):
        a = ModbusAdapter(mode="tcp", modbus_registers={"BT": {"register": 0, "func": 3, "unit_id": 1}})
        assert a._read_retries == 1

    def test_default_read_retries_rtu(self):
        a = ModbusAdapter(mode="rtu", modbus_registers={"BT": {"register": 0, "func": 3, "unit_id": 1}})
        assert a._read_retries == 1

    def test_word_order_default_little(self):
        a = ModbusAdapter(modbus_registers={"BT": {"register": 0, "func": 3, "unit_id": 1}})
        assert a._word_order == "little"

    def test_word_order_big(self):
        a = ModbusAdapter(word_order="big", modbus_registers={"BT": {"register": 0, "func": 3, "unit_id": 1}})
        assert a._word_order == "big"


# ---------------------------------------------------------------------------
# connect() tests
# ---------------------------------------------------------------------------

class TestConnect:
    @patch("pymodbus.client.AsyncModbusTcpClient")
    async def test_tcp_connect_creates_client(self, MockClient, adapter):
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = True
        MockClient.return_value = instance

        await adapter.connect()

        MockClient.assert_called_once_with(host="192.168.1.100", port=502, timeout=pytest.approx(0.25))
        instance.connect.assert_awaited_once()

    @patch("pymodbus.client.AsyncModbusSerialClient")
    async def test_rtu_connect_creates_client(self, MockClient):
        regs = {"BT": {"register": 0, "func": 3, "unit_id": 1}}
        a = ModbusAdapter(mode="rtu", comport="/dev/ttyUSB0", baudrate=9600, modbus_registers=regs)
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = True
        MockClient.return_value = instance

        await a.connect()

        MockClient.assert_called_once()
        kwargs = MockClient.call_args.kwargs
        assert kwargs["port"] == "/dev/ttyUSB0"
        assert kwargs["baudrate"] == 9600
        assert kwargs["framer"] == FramerType.RTU

    @patch("pymodbus.client.AsyncModbusSerialClient")
    async def test_ascii_connect_uses_ascii_framer(self, MockClient):
        regs = {"BT": {"register": 0, "func": 3, "unit_id": 1}}
        a = ModbusAdapter(mode="ascii", comport="/dev/ttyUSB0", baudrate=9600, modbus_registers=regs)
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = True
        MockClient.return_value = instance

        await a.connect()

        kwargs = MockClient.call_args.kwargs
        assert kwargs["framer"] == FramerType.ASCII
        # ascii는 시리얼 계열 — RTU와 동일하게 retry 1회
        assert a._read_retries == 1

    @patch("pymodbus.client.AsyncModbusUdpClient")
    async def test_udp_connect_creates_client(self, MockClient):
        regs = {"BT": {"register": 0, "func": 3, "unit_id": 1}}
        a = ModbusAdapter(mode="udp", host="192.168.1.50", port=502, modbus_registers=regs)
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = True
        MockClient.return_value = instance

        await a.connect()

        kwargs = MockClient.call_args.kwargs
        assert kwargs["host"] == "192.168.1.50"
        assert kwargs["port"] == 502
        # UDP는 pymodbus 내부 retry가 요청을 중복 전송하므로 0 고정 (Artisan 동일)
        assert kwargs["retries"] == 0
        # 앱 레벨 retry는 새 transaction으로 나가므로 UDP도 1회 허용
        assert a._read_retries == 1

    @patch("pymodbus.client.AsyncModbusTcpClient")
    async def test_connect_empty_registers_raises(self, MockClient, adapter):
        a = ModbusAdapter(mode="tcp", host="127.0.0.1", modbus_registers={})
        with pytest.raises(ValueError, match="modbus_registers"):
            await a.connect()

    @patch("pymodbus.client.AsyncModbusTcpClient")
    async def test_connect_failure_raises_connection_error(self, MockClient, adapter):
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = False
        MockClient.return_value = instance

        with pytest.raises(ConnectionError, match="MODBUS 연결 실패"):
            await adapter.connect()

    @patch("pymodbus.client.AsyncModbusTcpClient")
    async def test_connect_sets_client(self, MockClient, adapter):
        instance = AsyncMock()
        instance.connect = AsyncMock()
        instance.connected = True
        MockClient.return_value = instance

        await adapter.connect()
        assert adapter._client is instance

    @patch("pymodbus.client.AsyncModbusTcpClient")
    async def test_connect_twice_replaces_client(self, MockClient, adapter):
        first = AsyncMock()
        first.connected = True
        first.connect = AsyncMock()
        MockClient.return_value = first
        await adapter.connect()

        second = AsyncMock()
        second.connected = True
        second.connect = AsyncMock()
        MockClient.return_value = second
        await adapter.connect()
        assert adapter._client is second


# ---------------------------------------------------------------------------
# _read_channel() — register decoding tests
# ---------------------------------------------------------------------------

class MockModbusResponse:
    """Simulates pymodbus register response."""
    def __init__(self, registers=None, bits=None):
        self.registers = registers or []
        self.bits = bits

    def isError(self):
        return False


class TestReadChannel:
    @pytest.fixture
    def connected_adapter(self, adapter):
        client = AsyncMock()
        client.connected = True
        adapter._client = client
        return adapter

    async def _mock_read(self, a, func, register, count, unit_id, registers):
        async def mock_read_fn(*args, **kwargs):
            return MockModbusResponse(registers=registers)
        cl = a._client

        if func == 1:
            cl.read_coils = AsyncMock(side_effect=mock_read_fn)
        elif func == 2:
            cl.read_discrete_inputs = AsyncMock(side_effect=mock_read_fn)
        elif func == 3:
            cl.read_holding_registers = AsyncMock(side_effect=mock_read_fn)
        else:
            cl.read_input_registers = AsyncMock(side_effect=mock_read_fn)

        return await a._read_channel({
            "register": register, "func": func, "unit_id": unit_id,
            "float": False, "div": 0, "mode": "C", "signed": False,
        })

    async def test_read_int_value(self, connected_adapter):
        val = await self._mock_read(connected_adapter, 3, 100, 1, 1, [1850])
        assert val == 1850.0

    async def test_read_div_1(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 1, "mode": "C", "signed": False}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[1850]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 185.0  # 1850 ÷ 10

    async def test_read_div_2(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 2, "mode": "C", "signed": False}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[18500]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 185.0  # 18500 ÷ 100

    async def test_negative_signed(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": True}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0xFF00]))
        val = await connected_adapter._read_channel(cfg)
        assert val == -256.0  # 0xFF00 → -256

    async def test_positive_signed(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": True}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0x00FF]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 255.0

    async def test_f_to_c_conversion(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 0, "mode": "F", "signed": False}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[212]))  # 212°F
        val = await connected_adapter._read_channel(cfg)
        assert val == pytest.approx(100.0, abs=0.1)  # (212-32)*5/9 = 100°C

    async def test_float_word_order_little(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": True, "div": 0, "mode": "C", "signed": False}
        connected_adapter._word_order = "little"
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0x0000, 0x4334]))
        val = await connected_adapter._read_channel(cfg)
        assert val == pytest.approx(180.0, abs=0.1)

    async def test_float_word_order_big(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": True, "div": 0, "mode": "C", "signed": False}
        connected_adapter._word_order = "big"
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0x4334, 0x0000]))
        val = await connected_adapter._read_channel(cfg)
        assert val == pytest.approx(180.0, abs=0.1)

    async def test_bcd16_decode(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": False,
               "bcd_as_int": True}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0x0212]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 212.0

    async def test_bcd32_decode(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": False,
               "bcd": True}
        connected_adapter._word_order = "little"
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[0x0212, 0x0000]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 212.0

    async def test_read_coils_func1(self, connected_adapter):
        cfg = {"register": 0, "func": 1, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": False}
        cl = connected_adapter._client
        cl.read_coils = AsyncMock(return_value=MockModbusResponse(bits=[True]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 1.0

    async def test_read_discrete_inputs_func2(self, connected_adapter):
        cfg = {"register": 0, "func": 2, "unit_id": 1,
               "float": False, "div": 0, "mode": "C", "signed": False}
        cl = connected_adapter._client
        cl.read_discrete_inputs = AsyncMock(return_value=MockModbusResponse(bits=[False]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 0.0

    async def test_rounds_to_one_decimal(self, connected_adapter):
        cfg = {"register": 100, "func": 3, "unit_id": 1,
               "float": False, "div": 2, "mode": "C", "signed": False}
        cl = connected_adapter._client
        cl.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[18534]))
        val = await connected_adapter._read_channel(cfg)
        assert val == 185.3  # 18534 ÷ 100 = 185.34 → round(185.34, 1) = 185.3

    async def test_retry_on_failure(self):
        regs = {"BT": {"register": 100, "func": 3, "unit_id": 1,
                       "float": False, "div": 1, "mode": "C", "signed": False}}
        a = ModbusAdapter(mode="rtu", comport="/dev/ttyUSB0", modbus_registers=regs)
        client = AsyncMock()
        client.connected = True
        a._client = client
        client.read_holding_registers = AsyncMock(side_effect=[IOError("timeout"), MockModbusResponse(registers=[1500])])
        val = await a._read_channel(regs["BT"])
        assert val == 150.0  # 1500 ÷ 10
        assert client.read_holding_registers.call_count == 2


# ---------------------------------------------------------------------------
# read() tests
# ---------------------------------------------------------------------------

class TestRead:
    async def test_read_returns_reading(self, adapter):
        client = AsyncMock()
        client.connected = True

        async def mock_read(register, **kw):
            if register == 100:
                return MockModbusResponse(registers=[1800])
            if register == 102:
                return MockModbusResponse(registers=[2200])
            return MockModbusResponse(registers=[500])
        client.read_coils = AsyncMock()
        client.read_discrete_inputs = AsyncMock()
        client.read_holding_registers = AsyncMock(side_effect=mock_read)
        client.read_input_registers = AsyncMock()
        adapter._client = client
        adapter._read_retries = 0

        result = await adapter.read()

        assert result.bt == 1800.0
        assert result.et == 2200.0
        assert result.drum == 500.0
        assert result.heater == 0.0
        assert result.fan == 0.0

    async def test_read_not_connected_raises(self, adapter):
        adapter._client = None
        with pytest.raises(ConnectionError, match="연결되지 않음"):
            await adapter.read()

    async def test_read_client_disconnected_raises(self, adapter):
        client = AsyncMock()
        client.connected = False
        adapter._client = client
        with pytest.raises(ConnectionError, match="연결되지 않음"):
            await adapter.read()

    async def test_read_with_only_bt_channel(self):
        regs = {"BT": {"register": 10, "func": 3, "unit_id": 1,
                       "float": False, "div": 1, "mode": "C", "signed": False}}
        a = ModbusAdapter(mode="tcp", modbus_registers=regs)
        client = AsyncMock()
        client.connected = True
        client.read_holding_registers = AsyncMock(return_value=MockModbusResponse(registers=[1500]))
        a._client = client
        a._read_retries = 0

        result = await a.read()
        assert result.bt == 150.0
        assert result.et == -1.0  # default when no ET config
        assert result.drum == 0.0  # default when no drum config

    async def test_read_error_response_raises(self, adapter):
        client = AsyncMock()
        client.connected = True
        err = MagicMock()
        err.isError.return_value = True
        client.read_holding_registers = AsyncMock(return_value=err)
        adapter._client = client
        adapter._read_retries = 0

        with pytest.raises(IOError, match="MODBUS 오류"):
            await adapter.read()


# ---------------------------------------------------------------------------
# disconnect() tests
# ---------------------------------------------------------------------------

class TestDisconnect:
    async def test_disconnect_closes_client(self, adapter):
        client = AsyncMock()
        client.connected = True
        adapter._client = client
        adapter._read_retries = 0

        await adapter.disconnect()
        client.close.assert_called_once()
        assert adapter._client is None

    async def test_disconnect_no_client_does_nothing(self, adapter):
        adapter._client = None
        await adapter.disconnect()  # should not raise

    async def test_disconnect_close_failure_logged(self, adapter, caplog):
        client = AsyncMock()
        client.connected = True
        client.close.side_effect = OSError("port busy")
        adapter._client = client

        await adapter.disconnect()  # should not raise
        assert adapter._client is None


# ---------------------------------------------------------------------------
# connected property tests
# ---------------------------------------------------------------------------

class TestConnected:
    def test_not_connected_when_no_client(self, adapter):
        adapter._client = None
        assert adapter.connected is False

    def test_connected_when_client_connected(self, adapter):
        client = MagicMock()
        client.connected = True
        adapter._client = client
        assert adapter.connected is True

    def test_not_connected_when_client_disconnected(self, adapter):
        client = MagicMock()
        client.connected = False
        adapter._client = client
        assert adapter.connected is False


# ---------------------------------------------------------------------------
# control() tests
# ---------------------------------------------------------------------------

class TestControl:
    async def test_control_is_unavailable(self, adapter):
        from control_guard import ControlUnavailable

        with pytest.raises(ControlUnavailable):
            await adapter.control(heater=80, fan=60, drum=50)
