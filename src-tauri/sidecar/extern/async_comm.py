#
# ABOUT
# Generic asyncio communication for Artisan

# LICENSE
# This program or module is free software: you can redistribute it and/or
# modify it under the terms of the GNU General Public License as published
# by the Free Software Foundation, either version 2 of the License, or
# version 3 of the License, or (at your option) any later version. It is
# provided for educational purposes and is distributed in the hope that
# it will be useful, but WITHOUT ANY WARRANTY; without even the implied
# warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
# the GNU General Public License for more details.

# AUTHOR
# Marko Luther, 2026

import logging
import asyncio

from contextlib import suppress
from threading import Thread
from typing import Final


_log: Final[logging.Logger] = logging.getLogger(__name__)


# An AsyncLoopThread instance holds a thread and an asyncio loop running in that thread.
# On object deletion the loop is terminated and the thread is ended.
class AsyncLoopThread:

    __slots__ = [ '__loop', '__thread' ]

    def __init__(self) -> None:

        def start_background_loop(loop:asyncio.AbstractEventLoop) -> None:
            asyncio.set_event_loop(loop)
            try:
                # run_forever() returns after calling loop.stop()
                loop.run_forever()
                # clean up tasks
                for task in asyncio.all_tasks(loop):
                    task.cancel()
                for t in [t for t in asyncio.all_tasks(loop) if not (t.done() or t.cancelled())]:
                    with suppress(asyncio.CancelledError):
                        loop.run_until_complete(t)
            except Exception:  # pylint: disable=broad-except
                pass
            finally:
                loop.close()

        self.__loop:asyncio.AbstractEventLoop = asyncio.new_event_loop()
        self.__thread:Thread = Thread(target=start_background_loop, args=(self.__loop,), daemon=True)
        self.__thread.start()

    def __del__(self) -> None:
        if not self.__loop.is_closed():
            self.__loop.call_soon_threadsafe(self.__loop.stop)
#        self.__thread.join()
# WARNING: we don't join and expect the clients running on this thread to stop them
# (using self._running) to finally get rid of this thread to prevent hangs

    # ── 로컬 추가 (fc-desktop) ─────────────────────────────
    def stop(self, timeout: float = 2.0) -> bool:
        """루프를 멈추고 스레드 종료를 기다린다. 시한 내 종료 시 True."""
        if not self.__loop.is_closed():
            with suppress(RuntimeError):
                self.__loop.call_soon_threadsafe(self.__loop.stop)
        self.__thread.join(timeout)
        return not self.__thread.is_alive()

    @property
    def loop(self) -> asyncio.AbstractEventLoop:
        return self.__loop
