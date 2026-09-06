"""#346 D/E packaging contracts — fail if onedir or Sentry ACL is reverted."""

from __future__ import annotations

import json
from pathlib import Path

SIDECAR_DIR = Path(__file__).resolve().parents[1]
SRC_TAURI = SIDECAR_DIR.parent


def test_sidecar_spec_is_onedir() -> None:
    spec = (SIDECAR_DIR / "sidecar.spec").read_text(encoding="utf-8")
    assert "COLLECT(" in spec
    assert "exclude_binaries=True" in spec
    assert "name='sidecar'" in spec


def test_desktop_bundle_uses_onedir_resource() -> None:
    resource_dir = SRC_TAURI / "binaries" / "sidecar"
    assert resource_dir.is_dir(), "tauri-build requires binaries/sidecar to exist"
    for name in ("tauri.macos.conf.json", "tauri.windows.conf.json"):
        conf = json.loads((SRC_TAURI / name).read_text(encoding="utf-8"))
        bundle = conf["bundle"]
        assert "externalBin" not in bundle
        assert bundle["resources"]["binaries/sidecar"] == "sidecar"


def test_desktop_capabilities_allow_sentry_breadcrumbs() -> None:
    cap = json.loads((SRC_TAURI / "capabilities" / "default.json").read_text(encoding="utf-8"))
    assert "sentry:default" in cap["permissions"]
