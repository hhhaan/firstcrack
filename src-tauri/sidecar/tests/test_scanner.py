"""Unit tests for LAN TCP scanner (Phase 1)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import threading
import time

import pytest

from scanner import (
    PROTOCOL_PORTS,
    candidate_hosts,
    local_ipv4_networks,
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


async def test_scan_detects_open_local_listener():
    # Bind ephemeral port on 127.0.0.1
    server = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
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


def test_local_ipv4_networks_is_sync():
    nets = local_ipv4_networks()
    assert not asyncio.iscoroutine(nets)
    assert isinstance(nets, list)
    assert all(isinstance(n, ipaddress.IPv4Network) for n in nets)


async def test_scan_dns_does_not_block_event_loop(monkeypatch):
    """gethostname must run off the event-loop thread; other tasks keep progressing."""
    loop_ident = threading.get_ident()
    dns_idents: list[int] = []
    ticks = 0

    def slow_gethostname() -> str:
        dns_idents.append(threading.get_ident())
        time.sleep(0.25)
        return "localhost"

    real_socket = socket.socket

    def socket_no_udp(*args, **kwargs):
        sock_type = args[1] if len(args) > 1 else kwargs.get("type", socket.SOCK_STREAM)
        if sock_type == socket.SOCK_DGRAM:
            raise OSError("skip outbound iface")
        return real_socket(*args, **kwargs)

    monkeypatch.setattr(socket, "gethostname", slow_gethostname)
    monkeypatch.setattr(socket, "socket", socket_no_udp)

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.05)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        found = await asyncio.wait_for(scan_protocol("s7"), timeout=2.0)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert found == []
    assert dns_idents
    assert all(ident != loop_ident for ident in dns_idents)
    assert ticks >= 3
