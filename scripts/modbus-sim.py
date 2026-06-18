#!/usr/bin/env python3
"""
MODBUS TCP 시뮬레이터 — 프로덕션 환경에서 하드웨어 연동 테스트용.

pymodbus 없이 순수 socket으로 MODBUS TCP 프로토콜 구현.
사이드카의 ModbusAdapter가 연결하면 실제 와이어 포맷으로 end-to-end 테스트 가능.

사용법:
    src-tauri/sidecar/.venv/bin/python scripts/modbus-sim.py [--port 8502]

연결 설정 (UI에서):
    브랜드: Diedrich / 모델: CR / IP: 127.0.0.1 / Port: 8502 / Mode: tcp

레지스터 맵 (Diedrich CR):
    register 0-1: BT (IEEE 754 float, word_order=little)
    register 4-5: ET (IEEE 754 float, word_order=little)
"""

import argparse
import logging
import struct
import socket
import threading
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger("modbus-sim")


# ── 로스팅 프로파일 ────────────────────────────────────────
def _build_profile() -> dict[str, list[float]]:
    times: list[float] = []
    bts: list[float] = []
    ets: list[float] = []
    for t in range(0, 781, 1):
        if t <= 20:
            bt = 200.0 - (22.0 * t) / 20.0
        elif t <= 120:
            bt = 178.0 - (33.0 * (t - 20)) / 100.0
        elif t <= 180:
            bt = 145.0 + (7.0 * (t - 120)) / 60.0
        elif t <= 360:
            bt = 152.0 + (22.0 * (t - 180)) / 180.0
        elif t <= 540:
            bt = 174.0 + (19.0 * (t - 360)) / 180.0
        elif t <= 660:
            bt = 193.0 + (7.0 * (t - 540)) / 120.0
        else:
            bt = 200.0 + (8.0 * (t - 660)) / 120.0

        if t <= 30:
            et = 230.0 - (12.0 * t) / 30.0
        elif t <= 90:
            et = 218.0 + (6.0 * (t - 30)) / 60.0
        elif t <= 420:
            et = 224.0 + (10.0 * (t - 90)) / 330.0
        else:
            et = 234.0 + (8.0 * (t - 420)) / 360.0

        times.append(float(t))
        bts.append(round(bt, 2))
        ets.append(round(et, 2))
    return {"timex": times, "bt": bts, "et": ets}


_PROFILE = _build_profile()
_PHASE_DURATION = _PROFILE["timex"][-1]
_start_time = time.monotonic()


def _noise(scale: float = 0.3) -> float:
    import random
    return (random.random() * 2 - 1) * scale


def _get_temps() -> tuple[float, float]:
    """현재 시점의 BT/ET 온도 반환."""
    elapsed = time.monotonic() - _start_time
    t = min(elapsed, _PHASE_DURATION)
    idx = int(t)
    if idx >= len(_PROFILE["bt"]):
        idx = len(_PROFILE["bt"]) - 1
    return (
        _PROFILE["bt"][idx] + _noise(0.4),
        _PROFILE["et"][idx] + _noise(0.3),
    )


def _float_to_regs_le(value: float) -> tuple[int, int]:
    """IEEE 754 float → [low_word, high_word] (little-endian word order)."""
    raw = struct.pack(">f", value)
    low, high = struct.unpack(">HH", raw)
    return low, high


# ── MODBUS 핸들러 ─────────────────────────────────────────
_MODBUS_FUNCTIONS: dict[int, str] = {
    1: "Read Coils",
    2: "Read Discrete Inputs",
    3: "Read Holding Registers",
    4: "Read Input Registers",
}


def _handle_request(data: bytes) -> bytes | None:
    """MODBUS TCP 요청을 파싱하고 응답을 생성한다."""
    if len(data) < 8:
        return None

    tid = data[0:2]          # Transaction ID
    pid = data[2:4]          # Protocol ID (=0)
    # length = data[4:6]     # 남은 바이트 수
    unit_id = data[6]        # Unit ID (slave address)
    func = data[7]           # Function code

    if func not in (3, 4):   # Read Holding/Input Registers만 처리
        _log.warning(f"미지원 function code: {func}")
        return tid + pid + bytes([0, 3]) + bytes([unit_id, func | 0x80, 0x01])

    if len(data) < 12:
        return None

    start_reg = (data[8] << 8) | data[9]
    reg_count = (data[10] << 8) | data[11]

    bt, et = _get_temps()
    registers: dict[int, tuple[int, int]] = {
        0: _float_to_regs_le(bt),   # BT: register 0-1
        4: _float_to_regs_le(et),   # ET: register 4-5
    }

    # 요청된 레지스터 범위에 대한 응답 데이터 조립
    resp_data = bytearray()
    for i in range(start_reg, start_reg + reg_count):
        if i in registers:
            if i % 2 == 0:
                resp_data.extend(struct.pack(">HH", registers[i][1], registers[i][0]))
            else:
                resp_data.extend(struct.pack(">H", 0))
        else:
            resp_data.extend(struct.pack(">H", 0))

    byte_count = len(resp_data)
    length = 2 + byte_count  # unit_id(1) + func(1) + byte_count(1) + data
    return tid + pid + struct.pack(">H", length) + bytes([unit_id, func, byte_count]) + resp_data


# ── TCP 서버 ───────────────────────────────────────────────
def _handle_client(conn: socket.socket) -> None:
    """클라이언트 연결 처리."""
    with conn:
        while True:
            header = conn.recv(8)
            if len(header) < 8:
                break
            length = (header[4] << 8) | header[5]
            body = conn.recv(length)
            if len(body) < length:
                break
            resp = _handle_request(header + body)
            if resp:
                conn.sendall(resp)


def main() -> None:
    parser = argparse.ArgumentParser(description="MODBUS TCP 로스팅 시뮬레이터")
    parser.add_argument("--port", type=int, default=8502, help="listen port (default: 8502)")
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", args.port))
    server.listen(5)

    print(f"🔌 MODBUS 로스팅 시뮬레이터 시작 — 127.0.0.1:{args.port}")
    print(f"   레지스터 0-1: BT (float), 레지스터 4-5: ET (float)")
    print(f"   13분 로스팅 프로파일 자동 재생 (Ctrl+C 종료)")
    print(f"   → UI에서 Diedrich CR, host=127.0.0.1, port={args.port} 로 연결")
    print()

    try:
        while True:
            conn, addr = server.accept()
            _log.info(f"연결: {addr}")
            t = threading.Thread(target=_handle_client, args=(conn,), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print("\n🛑 시뮬레이터 종료")
    finally:
        server.close()


if __name__ == "__main__":
    main()