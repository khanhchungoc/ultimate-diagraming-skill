"""Unit tests for scripts/save_helper.py. Run: python3 dev/tests/unit/test_save_helper.py"""

from __future__ import annotations

import http.client
import json
import os
import re
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import disk_format  # noqa: E402
import save_helper  # noqa: E402

SAMPLE_HTML = REPO_ROOT / "dev" / "samples" / "example-flowchart.html"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _http_request(
    port: int,
    method: str,
    path: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, resp.read()
    finally:
        conn.close()


def _load_sample_data(html_text: str) -> dict:
    m = save_helper.DATA_BLOCK_RE.search(html_text)
    assert m, "sample HTML missing diagram-data"
    body = html_text[m.start(1) + len(m.group(1)): m.start(2)]
    return json.loads(body)


def test_opt_in_config_and_layout_hook() -> None:
    with tempfile.TemporaryDirectory() as d:
        cache = Path(d) / "cache"
        target = Path(d) / "flow.html"
        target.write_text("<html></html>", encoding="utf-8")
        sid = save_helper.generate_save_id()

        env = {
            save_helper.CACHE_DIR_ENV: str(cache),
            save_helper.ALLOW_HEADLESS_ENV: "1",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            for k in (save_helper.OPT_OUT_ENV, "CI", "GITHUB_ACTIONS", "SSH_CONNECTION", "SSH_CLIENT"):
                os.environ.pop(k, None)

            # Unset -> does NOT start helper, returns first-run [INFO] line, still registers ID
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                note = save_helper.handle_layout_output(target, sid)
                assert note == save_helper.FIRST_RUN_INFO_LINE
                ensure_mock.assert_not_called()
            assert save_helper.lookup_registered_id(sid) is not None

            # Disable -> returns None, never starts helper
            save_helper.set_direct_save_enabled(False)
            assert save_helper.get_direct_save_enabled() is False
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert save_helper.handle_layout_output(target, sid) is None
                ensure_mock.assert_not_called()

            # Enable -> starts helper, returns None
            save_helper.set_direct_save_enabled(True)
            assert save_helper.get_direct_save_enabled() is True
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert save_helper.handle_layout_output(target, sid) is None
                ensure_mock.assert_called_once()

            # OPT_OUT_ENV overrides enabled=True
            os.environ[save_helper.OPT_OUT_ENV] = "1"
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert save_helper.handle_layout_output(target, sid) is None
                ensure_mock.assert_not_called()


def test_stamp_and_http_save_and_security() -> None:
    base_html = SAMPLE_HTML.read_text(encoding="utf-8")
    assert save_helper.extract_save_id(base_html) is None, "example HTML must stay deterministic without save ID"

    with tempfile.TemporaryDirectory() as d:
        cache = Path(d) / "cache"
        diagram = Path(d) / "flow.html"
        sid = save_helper.generate_save_id()
        stamped = save_helper.stamp_save_id(base_html, sid)
        assert save_helper.extract_save_id(stamped) == sid
        assert disk_format.stamp_reading_guide(stamped) == stamped
        diagram.write_text(stamped, encoding="utf-8")

        port = _free_port()
        with mock.patch.dict(os.environ, {save_helper.CACHE_DIR_ENV: str(cache)}, clear=False):
            save_helper.register_save_id(sid, diagram)

            srv = save_helper.SaveHelperServer(("127.0.0.1", port), idle_timeout=30)
            thread = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            thread.start()
            try:
                assert save_helper.probe_health(port, timeout=1.0)

                # CORS preflight
                st, hdrs, _ = _http_request(port, "OPTIONS", "/save", headers={"Origin": "null"})
                assert st == 204
                assert hdrs.get("access-control-allow-origin") == "null"
                assert "x-ultimate-diagram-save" in hdrs.get("access-control-allow-headers", "").lower()

                # Valid save on file:// (Origin: null)
                data = _load_sample_data(stamped)
                data["title"] = "Saved & <Verified>"
                body = json.dumps({"path": str(diagram), "saveId": sid, "data": data, "title": data["title"]}).encode("utf-8")
                st, _, raw = _http_request(
                    port, "POST", "/save", body=body,
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 200, raw
                assert json.loads(raw) == {"ok": True, "name": "flow.html"}

                saved_text = diagram.read_text(encoding="utf-8")
                assert "<title>Saved &amp; &lt;Verified&gt;</title>" in saved_text
                assert "Saved &amp; &lt;Verified&gt;</h1>" in saved_text
                assert disk_format.stamp_reading_guide(saved_text) == saved_text
                # Editor code after the data block stays intact byte-for-byte
                marker = "<!-- end diagram-data -->"
                orig_tail = save_helper.H1_TITLE_RE.sub(
                    lambda m: f"{m.group(1)}Saved &amp; &lt;Verified&gt;{m.group(2)}",
                    stamped.split(marker, 1)[1],
                    count=1,
                )
                assert saved_text.split(marker, 1)[1] == orig_tail

                # Survives moving/renaming the file on file://
                moved = Path(d) / "renamed-flow.html"
                diagram.rename(moved)
                data["title"] = "Moved Title"
                body2 = json.dumps({"path": str(moved), "saveId": sid, "data": data, "title": data["title"]}).encode("utf-8")
                st, _, raw = _http_request(
                    port, "POST", "/save", body=body2,
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 200 and json.loads(raw)["name"] == "renamed-flow.html"
                assert "<title>Moved Title</title>" in moved.read_text(encoding="utf-8")

                # Loopback preview (path=None) resolves registered path (updated after rename)
                data["title"] = "Preview Title"
                body3 = json.dumps({"path": None, "saveId": sid, "data": data, "title": data["title"]}).encode("utf-8")
                st, _, raw = _http_request(
                    port, "POST", "/save", body=body3,
                    headers={
                        "Origin": "http://127.0.0.1:5500",
                        "Content-Type": "application/json",
                        "X-Ultimate-Diagram-Save": "1",
                    },
                )
                assert st == 200 and json.loads(raw)["name"] == "renamed-flow.html"
                assert "<title>Preview Title</title>" in moved.read_text(encoding="utf-8")

                # Security rejections
                # 1. Remote Origin
                st, _, _ = _http_request(
                    port, "POST", "/save", body=body2,
                    headers={"Origin": "https://evil.com", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 403

                # 2. Missing Origin
                st, _, _ = _http_request(
                    port, "POST", "/save", body=body2,
                    headers={"Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 403

                # 3. Missing custom header
                st, _, _ = _http_request(
                    port, "POST", "/save", body=body2,
                    headers={"Origin": "null", "Content-Type": "application/json"},
                )
                assert st == 403

                # 4. Unregistered saveId
                bad_id = save_helper.generate_save_id()
                st, _, _ = _http_request(
                    port, "POST", "/save",
                    body=json.dumps({"path": str(moved), "saveId": bad_id, "data": data}).encode("utf-8"),
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 403

                # 5. Mismatched on-disk ID
                other = Path(d) / "other.html"
                other_id = save_helper.generate_save_id()
                other.write_text(save_helper.stamp_save_id(base_html, other_id), encoding="utf-8")
                st, _, _ = _http_request(
                    port, "POST", "/save",
                    body=json.dumps({"path": str(other), "saveId": sid, "data": data}).encode("utf-8"),
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 403

                # 6. Unknown diagramType
                bad_data = {**data, "diagramType": "not-a-type"}
                st, _, _ = _http_request(
                    port, "POST", "/save",
                    body=json.dumps({"path": str(moved), "saveId": sid, "data": bad_data}).encode("utf-8"),
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 400

                # 7. Non-HTML target
                txt = Path(d) / "notes.txt"
                txt.write_text(moved.read_text(encoding="utf-8"), encoding="utf-8")
                st, _, _ = _http_request(
                    port, "POST", "/save",
                    body=json.dumps({"path": str(txt), "saveId": sid, "data": data}).encode("utf-8"),
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 403

                # 8. Missing diagram-data block
                nodata = Path(d) / "nodata.html"
                nodata.write_text(f'<html><head><meta name="diagram-save-id" content="{sid}"></head></html>', encoding="utf-8")
                st, _, _ = _http_request(
                    port, "POST", "/save",
                    body=json.dumps({"path": str(nodata), "saveId": sid, "data": data}).encode("utf-8"),
                    headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                )
                assert st == 400

                # 9. Symlink target (POSIX)
                if sys.platform != "win32":
                    link = Path(d) / "link.html"
                    link.symlink_to(moved)
                    st, _, _ = _http_request(
                        port, "POST", "/save",
                        body=json.dumps({"path": str(link), "saveId": sid, "data": data}).encode("utf-8"),
                        headers={"Origin": "null", "Content-Type": "application/json", "X-Ultimate-Diagram-Save": "1"},
                    )
                    assert st == 403

                # 10. Oversized Content-Length
                st, _, _ = _http_request(
                    port, "POST", "/save", body=b"{}",
                    headers={
                        "Origin": "null",
                        "Content-Type": "application/json",
                        "X-Ultimate-Diagram-Save": "1",
                        "Content-Length": str(save_helper.MAX_BODY_BYTES + 1),
                    },
                )
                assert st == 413
            finally:
                srv.shutdown()
                srv.server_close()


def test_idle_shutdown_cleans_state() -> None:
    with tempfile.TemporaryDirectory() as d:
        cache = Path(d) / "cache"
        port = _free_port()
        with mock.patch.dict(os.environ, {save_helper.CACHE_DIR_ENV: str(cache)}, clear=False):
            t0 = time.monotonic()
            bound = save_helper.serve_forever(ports=(port,), idle_timeout=0.35, write_state=True)
            elapsed = time.monotonic() - t0
            assert bound == port
            assert elapsed < 3.0
            assert not save_helper.server_state_path().exists()


def test_session_start_hook_starts_helper_when_opted_in() -> None:
    import version_check
    with tempfile.TemporaryDirectory() as d:
        cache = Path(d) / "cache"
        env = {
            save_helper.CACHE_DIR_ENV: str(cache),
            save_helper.ALLOW_HEADLESS_ENV: "1",
            version_check.OPT_OUT_ENV: "1",  # update check off, save helper still honors its own opt-in
        }
        with mock.patch.dict(os.environ, env, clear=False):
            for k in (save_helper.OPT_OUT_ENV, "CI", "GITHUB_ACTIONS", "SSH_CONNECTION", "SSH_CLIENT"):
                os.environ.pop(k, None)

            # Unset -> does not start
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert version_check.run_hook("claude") == ""
                ensure_mock.assert_not_called()

            # Disabled -> does not start
            save_helper.set_direct_save_enabled(False)
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert version_check.run_hook("gemini") == ""
                ensure_mock.assert_not_called()

            # Enabled -> starts on SessionStart even when update check is disabled
            save_helper.set_direct_save_enabled(True)
            with mock.patch.object(save_helper, "ensure_running") as ensure_mock:
                assert version_check.run_hook("claude") == ""
                ensure_mock.assert_called_once()


def main() -> None:
    test_opt_in_config_and_layout_hook()
    test_stamp_and_http_save_and_security()
    test_idle_shutdown_cleans_state()
    test_session_start_hook_starts_helper_when_opted_in()
    print("[PASS] save_helper.py")


if __name__ == "__main__":
    main()
