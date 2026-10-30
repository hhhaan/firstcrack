"""가상 머신은 BBP 뒤에 Charge 하락을 이어 재생한다. 자동 Charge가 그 하락을 본다."""

import pytest

from adapters.virtual import VirtualMachineAdapter, _BBP_END, _BBP_PROFILE, _ROAST_PROFILE


def test_bbp_meets_charge_without_including_the_roast():
    assert _BBP_PROFILE["timex"][-1] > 300
    assert _BBP_PROFILE["bt"][0] == pytest.approx(200.9)
    assert _BBP_PROFILE["bt"][-1] == pytest.approx(_ROAST_PROFILE["bt"][0], abs=1)
    assert min(_ROAST_PROFILE["bt"]) < 120
    assert _ROAST_PROFILE["bt"][-1] > 190


def test_preheat_plays_the_charge_drop_after_bbp(monkeypatch):
    monkeypatch.setattr("adapters.virtual.random.random", lambda: 0.5)
    now = {"t": 5_000.0}
    monkeypatch.setattr("adapters.virtual.time.monotonic", lambda: now["t"])

    adapter = VirtualMachineAdapter()
    adapter._connected = True
    adapter._connect_time = now["t"]

    at_bbp = adapter._read_preheat()
    assert at_bbp.bt == pytest.approx(200.9, abs=0.05)
    assert at_bbp.et == pytest.approx(247.1, abs=0.05)

    now["t"] += _BBP_END + 60
    into_crash = adapter._read_preheat()
    assert into_crash.bt == pytest.approx(118.1, abs=0.3)


def test_roasting_plays_absolute_recorded_temperatures(monkeypatch):
    monkeypatch.setattr("adapters.virtual.random.random", lambda: 0.5)
    now = {"t": 5_000.0}
    monkeypatch.setattr("adapters.virtual.time.monotonic", lambda: now["t"])

    adapter = VirtualMachineAdapter()
    adapter._connected = True
    adapter._roasting = True
    adapter._roast_start_time = now["t"]

    at_charge = adapter._read_roasting()
    assert at_charge.bt == pytest.approx(217.6, abs=0.05)
    assert at_charge.et == pytest.approx(255.3, abs=0.05)
    assert at_charge.heater == 60.0

    now["t"] += 60
    falling = adapter._read_roasting()
    assert falling.bt == pytest.approx(118.1, abs=0.3)

    now["t"] += 10_000
    at_end = adapter._read_roasting()
    assert at_end.bt == pytest.approx(_ROAST_PROFILE["bt"][-1], abs=0.05)


@pytest.mark.asyncio
async def test_heater_command_does_not_move_bean_temperature(monkeypatch):
    monkeypatch.setattr("adapters.virtual.random.random", lambda: 0.5)
    now = {"t": 5_000.0}
    monkeypatch.setattr("adapters.virtual.time.monotonic", lambda: now["t"])

    adapter = VirtualMachineAdapter()
    await adapter.connect()
    await adapter.start_roast()
    before = await adapter.read()
    await adapter.control(heater=100)
    after = await adapter.read()

    assert after.heater == 100
    assert after.bt == before.bt


@pytest.mark.asyncio
async def test_charge_during_the_drop_does_not_restart_it(monkeypatch):
    monkeypatch.setattr("adapters.virtual.random.random", lambda: 0.5)
    now = {"t": 8_000.0}
    monkeypatch.setattr("adapters.virtual.time.monotonic", lambda: now["t"])

    adapter = VirtualMachineAdapter()
    await adapter.connect()
    now["t"] += _BBP_END + 60
    before = await adapter.read()
    await adapter.start_roast()
    after = await adapter.read()

    assert before.bt == pytest.approx(118.1, abs=0.3)
    assert after.bt == before.bt
