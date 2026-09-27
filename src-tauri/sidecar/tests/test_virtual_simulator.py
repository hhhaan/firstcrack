"""가상 로스터의 제어 반응과 배치 경계 계약."""

from adapters.virtual import VirtualMachineAdapter


async def test_heat_and_fan_change_bt_et_with_thermal_lag():
    now = [100.0]
    adapter = VirtualMachineAdapter(clock=lambda: now[0])
    await adapter.connect()
    baseline = await adapter.read()

    await adapter.control(heater=100)
    heating = []
    for _ in range(90):
        now[0] += 1
        heating.append(await adapter.read())

    assert heating[0].et > baseline.et
    assert heating[0].bt >= baseline.bt
    assert heating[29].et - baseline.et > heating[29].bt - baseline.bt + 10
    assert heating[-1].bt > baseline.bt + 10
    assert all(b.et >= a.et and b.bt >= a.bt for a, b in zip(heating, heating[1:]))
    assert max(b.et - a.et for a, b in zip(heating, heating[1:])) < 2

    await adapter.control(heater=0, fan=80)
    cooling = []
    for _ in range(90):
        now[0] += 1
        cooling.append(await adapter.read())

    assert cooling[-1].et < heating[-1].et - 40
    assert cooling[-1].bt < heating[-1].bt - 5
    assert cooling[-1].heater == 0
    assert cooling[-1].fan == 80


async def test_charge_and_reset_keep_temperature_and_connection_continuous():
    now = [100.0]
    adapter = VirtualMachineAdapter(clock=lambda: now[0])
    await adapter.connect()
    await adapter.enter_standby()
    now[0] += 12
    before_charge = await adapter.read()
    await adapter.start_roast()
    after_charge = await adapter.read()
    assert (after_charge.bt, after_charge.et) == (before_charge.bt, before_charge.et)

    now[0] += 30
    roasting = await adapter.read()
    assert roasting.bt < after_charge.bt
    await adapter.reset_roast()
    after_reset = await adapter.read()
    assert adapter.connected
    assert abs(after_reset.bt - roasting.bt) <= 0.1
    assert abs(after_reset.et - roasting.et) <= 0.1

    now[0] += 5
    assert (await adapter.read()).bt > after_reset.bt


async def test_heater_off_cools_through_the_whole_roast():
    now = [100.0]
    adapter = VirtualMachineAdapter(clock=lambda: now[0])
    await adapter.connect()
    await adapter.start_roast()
    await adapter.control(heater=0)

    readings = []
    for elapsed in (60, 180, 420, 780):
        now[0] = 100.0 + elapsed
        readings.append(await adapter.read())

    assert all(b.et < a.et and b.bt < a.bt for a, b in zip(readings, readings[1:]))
