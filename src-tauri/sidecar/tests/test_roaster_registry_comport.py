"""Modbus RTU serial port is required in the Python registry (#771-7)."""

from roaster_registry import PROTOCOL_FORM_FIELDS


def test_modbus_comport_field_is_required():
    modbus = PROTOCOL_FORM_FIELDS["modbus"]
    comport = next(field for field in modbus if field["key"] == "comport")
    assert comport["required"] is True


def test_kaleido_comport_stays_optional():
    kaleido = PROTOCOL_FORM_FIELDS["kaleido"]
    comport = next(field for field in kaleido if field["key"] == "comport")
    assert comport["required"] is False
