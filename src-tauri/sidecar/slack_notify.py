"""Optional Slack notify for critical sidecar failures.

Set env SLACK_WEBHOOK_URL (same as Edge/landing when desired).
No-op when unset. Never raises to callers.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

_log = logging.getLogger(__name__)

_WEBHOOK = os.environ.get("SLACK_WEBHOOK_URL", "").strip()


def _clean(value: object) -> str:
    """Prevent Slack mrkdwn injection from device/user-controlled strings."""
    return (
        str(value)
        .replace("`", " ")
        .replace("\r", " ")
        .replace("\n", " ")
        .replace("<", "‹")
        .replace(">", "›")
        .strip()
    )


def post_slack(text: str) -> bool:
    if not _WEBHOOK:
        return False
    try:
        req = urllib.request.Request(
            _WEBHOOK,
            data=json.dumps({"text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        # Best-effort only — never raise (malformed URL, HTTP errors, etc.)
        _log.warning("slack notify failed: %s", e)
        return False


def notify_hardware_error(
    *,
    event: str,
    roaster: str | None,
    protocol: str | None,
    exc: BaseException,
) -> None:
    msg = (
        f"*Sidecar hardware error*\n"
        f"• event: `{_clean(event)}`\n"
        f"• roaster: `{_clean(roaster or '—')}`\n"
        f"• protocol: `{_clean(protocol or '—')}`\n"
        f"• error: `{_clean(f'{type(exc).__name__}: {exc}')}`"
    )
    post_slack(msg)
