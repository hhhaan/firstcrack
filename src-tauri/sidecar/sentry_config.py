"""
사이드카 Sentry 단일 통합 지점.

프론트엔드(`src/shared/lib/sentry.ts`)·Rust(`src-tauri/src/sentry_config.rs`)와 같은
프로젝트 하나를 쓰고 `runtime` 태그로만 갈린다. 정책도 셋이 동일하다:

- 자동 활성은 **패키징/Tauri spawn**일 때만. 맨손으로 띄운 venv 사이드카는 꺼져 있다.
  스모크 테스트는 `SIDECAR_SENTRY_SMOKE=1|true`로 명시 opt-in한다.
- `SIDECAR_DISABLE_SENTRY`는 하드 오프 — frozen/smoke보다 우선한다 (pytest 보호막).
- release는 앱 버전 기준 `first-crack@<semver>`. crate/패키지 이름을 쓰면
  프론트와 릴리스가 갈라져 이슈가 두 곳에 쌓인다.
- 조치 가능한 오류만 이슈로 남긴다. 예상된 4xx(401 토큰 불일치 포함)·취소·정상 종료는 버린다.
- 비밀·연결 대상·로컬 경로는 before_send/before_breadcrumb 한 곳에서만 지운다.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from typing import Any, Mapping

import sentry_sdk
from sentry_sdk.integrations.aiohttp import AioHttpIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

# DSN은 클라이언트 공개값 (프론트/Rust도 동일하게 하드코딩) — 빌드 시크릿 의존 제거
SENTRY_DSN = (
    "https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944"
)

REDACTED = "[redacted]"
MAX_DEPTH = 5

_TRUTHY = frozenset({"1", "true"})
_SEMVER = re.compile(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?")

_SENSITIVE_KEY = re.compile(r"password|token|secret|authorization|cookie", re.I)
_REDACTED_KEYS = frozenset({"host", "comport", "serial", "path", "query_string"})

# URL 쿼리는 통째로. 문자열/JSON 구분자에서 멈춰야 뒤따르는 본문이 함께 잘리지 않는다.
_URL_QUERY = re.compile(r"(https?://[^\s?]+)\?[^\s\"'<>)\]},;]*", re.I)
# `key=value` / `"key": "value"` 형태. Bearer/Basic 접두는 값에 포함해 함께 지운다.
# 키 앞을 고정하지 않아 `SIDECAR_TOKEN=…`처럼 접두사가 붙은 형태도 잡힌다.
_SENSITIVE_ASSIGNMENT = re.compile(
    r"(password|token|secret|authorization|cookie|host|comport|serial|path)"
    r"([\"']?\s*[=:]\s*[\"']?)(?:(?:bearer|basic|token)\s+)?[^\s\"',;)}\]&]+",
    re.I,
)
# 사용자 홈 아래 경로는 계정명이 그대로 PII다.
_HOME_PATH = re.compile(r"(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^\s\"',;)}\]]+")


def _env(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def _is_smoke(env: Mapping[str, str] | None = None) -> bool:
    return _env(env).get("SIDECAR_SENTRY_SMOKE", "").strip().lower() in _TRUTHY


def _is_frozen(frozen: bool | None) -> bool:
    return bool(getattr(sys, "frozen", False)) if frozen is None else frozen


def is_enabled(env: Mapping[str, str] | None = None, *, frozen: bool | None = None) -> bool:
    """패키징(frozen) 또는 Tauri spawn(SIDECAR_VERSION), 아니면 명시 스모크일 때만 켠다."""
    env = _env(env)
    if env.get("SIDECAR_DISABLE_SENTRY"):
        return False
    return _is_frozen(frozen) or bool(env.get("SIDECAR_VERSION")) or _is_smoke(env)


def release_name(env: Mapping[str, str] | None = None) -> str:
    version = _env(env).get("SIDECAR_VERSION", "").strip()
    return f"first-crack@{version if _SEMVER.fullmatch(version) else 'unknown'}"


def environment_name(env: Mapping[str, str] | None = None, *, frozen: bool | None = None) -> str:
    env = _env(env)
    if _is_smoke(env):
        return "development"
    return "production" if (_is_frozen(frozen) or env.get("SIDECAR_VERSION")) else "development"


def scrub_text(value: str) -> str:
    value = _URL_QUERY.sub(rf"\1?{REDACTED}", value)
    value = _SENSITIVE_ASSIGNMENT.sub(rf"\1\2{REDACTED}", value)
    return _HOME_PATH.sub(REDACTED, value)


def scrub(value: Any, depth: int = 0) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, (list, tuple)):
        if depth >= MAX_DEPTH:
            return REDACTED
        return [scrub(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return value
    if depth >= MAX_DEPTH:
        return REDACTED
    return {
        key: REDACTED
        if _SENSITIVE_KEY.search(str(key)) or str(key).lower() in _REDACTED_KEYS
        else scrub(item, depth + 1)
        for key, item in value.items()
    }


def is_actionable(exc: BaseException | None) -> bool:
    """미처리 예외·5xx·재시도 소진만 이슈. 취소/정상 종료/예상된 4xx는 버린다.

    429는 예외 — 레이트 리밋은 우리가 손봐야 하는 운영 문제다.
    """
    if exc is None:
        return True
    if isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt, SystemExit, GeneratorExit)):
        return False
    status = getattr(exc, "status", None)
    if not isinstance(status, int):
        status = getattr(exc, "status_code", None)
    if isinstance(status, int) and 400 <= status < 500:
        return status == 429
    return True


def _hint_exception(hint: Mapping[str, Any] | None) -> BaseException | None:
    exc_info = (hint or {}).get("exc_info")
    return exc_info[1] if exc_info else None


def before_send(event: dict[str, Any], hint: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not is_actionable(_hint_exception(hint)):
        return None
    if isinstance(event.get("message"), str):
        event["message"] = scrub_text(event["message"])
    for exception in (event.get("exception") or {}).get("values", []):
        if isinstance(exception.get("value"), str):
            exception["value"] = scrub_text(exception["value"])
    for key in ("extra", "contexts", "request", "breadcrumbs", "tags"):
        if event.get(key):
            event[key] = scrub(event[key])
    return event


def before_breadcrumb(
    crumb: dict[str, Any], hint: Mapping[str, Any] | None
) -> dict[str, Any] | None:
    if isinstance(crumb.get("message"), str):
        crumb["message"] = scrub_text(crumb["message"])
    if crumb.get("data"):
        crumb["data"] = scrub(crumb["data"])
    return crumb


def init(env: Mapping[str, str] | None = None, *, frozen: bool | None = None) -> bool:
    """활성 조건이면 SDK를 초기화한다. 초기화 여부를 반환."""
    if not is_enabled(env, frozen=frozen):
        return False

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=environment_name(env, frozen=frozen),
        release=release_name(env),
        traces_sample_rate=0.1,
        integrations=[AioHttpIntegration()],
        # LoggingIntegration 기본값은 ERROR 로그마다 이슈를 만든다 — 읽기 실패 한 번에
        # 이슈가 쌓여 "조치 가능한 것만" 정책이 무너진다. 캡처는 명시 호출로만.
        disabled_integrations=[LoggingIntegration()],
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=before_send,
        before_breadcrumb=before_breadcrumb,
    )
    sentry_sdk.set_tag("runtime", "sidecar")
    return True
