"""Unit tests for LAN TCP scanner (Phase 1)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket

import pytest

from scanner import (
    PROTOCOL_PORTS,
    candidate_hosts,
    scan_port,
    scan_protocol,
)


def test_protocol_ports_known():
    assert PROTOCOL_PORTS["s7"] == 102
    assert PROTOCOL_PORTS["modbus_tcp"] == 502
    assert PROTOCOL_PORTS["kaleido"] == 80
    assert PROTOCOL_PORTS["probat_ws"] == 80


def test_candidate_hosts_skips_large_net():
    big = ipaddress.IPv4Network("10.0.0.0/16")
    assert candidate_hosts([big]) == []


def test_candidate_hosts_enumerates_24():
    net = ipaddress.IPv4Network("192.168.50.0/24")
    hosts = candidate_hosts([net])
    assert "192.168.50.1" in hosts
    assert "192.168.50.254" in hosts
    assert "192.168.50.0" not in hosts
    assert "192.168.50.255" not in hosts


async def test_scan_protocol_unknown():
    with pytest.raises(ValueError, match="unknown protocol"):
        await scan_protocol("nope")


async def _close_writer(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    writer.close()
    await writer.wait_closed()


async def test_scan_detects_open_local_listener():
    # Bind ephemeral port on 127.0.0.1
    server = await asyncio.start_server(_close_writer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        found = await scan_port(port, hosts=["127.0.0.1"])
        assert found == [{"host": "127.0.0.1"}]
    finally:
        server.close()
        await server.wait_closed()


async def test_scan_closed_port_empty():
    # Pick a free port and do not listen
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        free_port = s.getsockname()[1]
    found = await scan_port(free_port, hosts=["127.0.0.1"])
    assert found == []
