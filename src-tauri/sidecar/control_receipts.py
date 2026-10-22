"""Bounded immutable command observations and receipt cursors."""

from collections import deque
from copy import deepcopy
from typing import Any


class ReceiptJournal:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.next_sequence = 1
        self._entries: deque[dict[str, Any]] = deque(maxlen=2048)

    def append(self, attempt: dict[str, Any], **changes: Any) -> dict[str, Any]:
        sequence = self.next_sequence
        entry = {**attempt, **changes, "sequence": sequence,
                 "attempt_sequence": attempt["attempt_sequence"] or sequence}
        self._entries.append(entry)
        self.next_sequence += 1
        return entry

    def page(self, charge_id: str, after: int, limit: int, *, sealed: bool) -> dict[str, Any]:
        first = self._entries[0]["sequence"] if self._entries else self.next_sequence
        page = [deepcopy(row) for row in self._entries if row["sequence"] > after][:limit]
        next_after = page[-1]["sequence"] if page else after
        return {"session_id": self.session_id, "charge_id": charge_id, "first_available": first,
                "next_sequence": self.next_sequence, "next_after": next_after,
                "has_more": next_after < self.next_sequence - 1, "sealed": sealed,
                "gap": {"from": after + 1, "through": first - 1} if after + 1 < first else None,
                "receipts": page}
