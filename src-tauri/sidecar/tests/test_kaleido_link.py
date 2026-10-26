"""Kaleido 프레임과 세션. 소켓 없이 큐로 기기를 흉내 낸다."""

import asyncio

import pytest

from adapters.kaleido_link import KaleidoLink, frame, parse_status


class QueuePipe:
    def __init__(self) -> None:
        self.sent: asyncio.Queue[str] = asyncio.Queue()
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False

    async def send_line(self, line: str) -> None:
        await self.sent.put(line)

    async def next_line(self) -> str:
        return await self.incoming.get()

    async def aclose(self) -> None:
        self.closed = True


def test_frame_and_status_line():
    assert frame("PI") == "{[PI]}\n"
    assert frame("TU", "C") == "{[TU C]}\n"
    assert frame("RD", "A0") == "{[RD A0]}\n"

    assert parse_status("not a frame") is None
    assert parse_status("{1}") == {"sid": 1}
    assert parse_status("{1,TU:C}") == {"sid": 1, "TU": "C"}
    parsed = parse_status("{1,BT:180.5,ET:200,HP:0,FC:30.2,RC:10}")
    assert parsed == {"sid": 1, "BT": 180.5, "ET": 200.0, "HP": 0, "FC": 30, "RC": 10}


async def _script(pipe: QueuePipe, rounds: list[tuple[str, str]]) -> None:
    for command, reply in rounds:
        got = await asyncio.wait_for(pipe.sent.get(), 1)
        assert got == command
        await pipe.incoming.put(reply)


async def test_session_handshakes_then_samples_and_closes():
    pipe = QueuePipe()

    async def opener(**_: object) -> QueuePipe:
        return pipe

    link = KaleidoLink(opener)
    script = asyncio.create_task(
        _script(
            pipe,
            [
                ("{[PI]}\n", "{1}"),
                ("{[TU C]}\n", "{1,TU:C}"),
                ("{[SC AR]}\n", "{1,SC:AR}"),
                ("{[RD A0]}\n", "{1,BT:181.2,ET:210,HP:0,FC:40,RC:12}"),
                ("{[CL AR]}\n", "{1,SN:k}"),
            ],
        )
    )

    await link.start_session(unit="C", host="127.0.0.1", port=80, path="ws", serial=None)
    for _ in range(50):
        if link.snapshot().get("TU") == "C":
            break
        await asyncio.sleep(0.02)
    assert link.snapshot()["sid"] == 1
    assert link.snapshot()["TU"] == "C"

    assert await link.read_temperatures() == (181.2, 210.0)
    assert link.snapshot()["HP"] == 0

    await link.shutdown()
    await script
    assert pipe.closed is True

    with pytest.raises(ConnectionError):
        await link.read_temperatures()


async def test_unanswered_close_still_releases_the_pipe():
    pipe = QueuePipe()

    async def opener(**_: object) -> QueuePipe:
        return pipe

    link = KaleidoLink(opener)
    script = asyncio.create_task(
        _script(
            pipe,
            [
                ("{[PI]}\n", "{1}"),
                ("{[TU C]}\n", "{1,TU:C}"),
                ("{[SC AR]}\n", "{1,SC:AR}"),
            ],
        )
    )
    await link.start_session(unit="C", host="127.0.0.1", port=80, path="ws", serial=None)
    for _ in range(50):
        if link.snapshot().get("TU") == "C":
            break
        await asyncio.sleep(0.02)
    await script

    await link.shutdown()
    assert pipe.closed is True
    close_frame = await asyncio.wait_for(pipe.sent.get(), 1)
    assert close_frame == "{[CL AR]}\n"
