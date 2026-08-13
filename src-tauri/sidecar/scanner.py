"""LAN TCP port probe for network roaster discovery (Phase 1).

TCP connect only — no protocol handshake. Soft-fails to empty list.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from collections.abc import Iterable

_log = logging.getLogger(__name__)

# protocol query key → default TCP port
PROTOCOL_PORTS: dict[str, int] = {
    "s7": 102,
    "modbus_tcp": 502,
    "kaleido": 80,
    "probat_ws": 80,
}

CONNECT_TIMEOUT_S = 0.5
SEMAPHORE_LIMIT = 100
# Phase 1: only /24 (or tighter). Skip larger nets.
MAX_NETWORK_HOSTS = 256


def local_ipv4_networks() -> list[ipaddress.IPv4Network]:
    """Derive /24 networks from local non-loopback IPv4 addresses (no hardcode)."""
    networks: list[ipaddress.IPv4Network] = []
    seen: set[str] = set()

    def _add(ip: str) -> None:
        if not ip or ip.startswith("127."):
            return
        try:
            net = ipaddress.IPv4Network(f"{ip}/24", strict=False)
        except ValueError:
            return
        key = str(net)
        if key not in seen:
            seen.add(key)
            networks.append(net)

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            _add(info[4][0])
    except OSError:
        _log.warning("local hostname IPv4 enumerate failed", exc_info=True)

    # Primary outbound interface (works when hostname has no useful A record)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            _add(s.getsockname()[0])
    except OSError:
        pass

    return networks


def candidate_hosts(
    networks: Iterable[ipaddress.IPv4Network],
    *,
    max_hosts: int = MAX_NETWORK_HOSTS,
) -> list[str]:
    hosts: list[str] = []
    seen: set[str] = set()
    for net in networks:
        if net.num_addresses > MAX_NETWORK_HOSTS:
            continue
        for host in net.hosts():
            h = str(host)
            if h in seen:
                continue
            seen.add(h)
            hosts.append(h)
            if len(hosts) >= max_hosts:
                return hosts
    return hosts


async def _probe(host: str, port: int, sem: asyncio.Semaphore) -> str | None:
    async with sem:
        try:
            _reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=CONNECT_TIMEOUT_S,
            )
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return host
        except Exception:
            return None


async def scan_port(port: int, hosts: list[str] | None = None) -> list[dict[str, str]]:
    """Probe hosts for an open TCP port. Returns sorted ``[{host}]``."""
    try:
        if hosts is None:
            # gethostname/getaddrinfo block the loop on macOS mDNS (#211)
            networks = await asyncio.to_thread(local_ipv4_networks)
            hosts = candidate_hosts(networks)
        if not hosts:
            return []
        sem = asyncio.Semaphore(SEMAPHORE_LIMIT)
        results = await asyncio.gather(*(_probe(h, port, sem) for h in hosts))
        found = sorted({h for h in results if h is not None})
        return [{"host": h} for h in found]
    except Exception:
        _log.warning("network scan failed (port=%s)", port, exc_info=True)
        return []


async def scan_protocol(protocol: str) -> list[dict[str, str]]:
    """Scan using PROTOCOL_PORTS. Raises ValueError for unknown protocol."""
    port = PROTOCOL_PORTS.get(protocol)
    if port is None:
        raise ValueError(f"unknown protocol: {protocol}")
    return await scan_port(port)
