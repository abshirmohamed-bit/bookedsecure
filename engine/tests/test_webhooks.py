"""Signature format has to match what Base44's engineWebhook verifies."""
from __future__ import annotations

import hashlib
import hmac

from app.webhooks import sign


def test_signature_is_hmac_over_timestamp_dot_body():
    body = b'{"event":"test.ping"}'
    expected = hmac.new(b"secret", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert sign(body, "secret", 1700000000) == expected


def test_signature_changes_with_the_body():
    assert sign(b"a", "s", 1) != sign(b"b", "s", 1)


def test_asset_imported_carries_the_fields_the_app_reads():
    """The app's webhook applier reads these keys off data; nesting them would break it."""
    from app.models import Asset
    from app.pipeline.ingest import asset_event

    a = Asset(id="ast_1", name="talk.mp4", type="video", status="ready",
              length_s=61.5, size_bytes=2048, width=1920, height=1080)
    ev = asset_event(a)
    for key in ("asset_id", "url", "thumbnail_url", "length_ms", "size_bytes"):
        assert key in ev, key
    assert ev["asset_id"] == "ast_1"
    assert ev["length_ms"] == 61500, "the app stores milliseconds, the Engine keeps seconds"
    assert ev["asset"]["name"] == "talk.mp4", "the full asset stays available alongside"


def test_a_failed_import_says_so_instead_of_spinning():
    from app.db import session
    from app.errors import EngineError
    from app.models import Asset, WebhookEvent
    from app.pipeline import ingest
    from sqlmodel import select

    with session() as s:
        a = Asset(id="ast_fail", name="broken.mp4", type="video", status="importing")
        s.add(a)
        s.commit()
        ingest.mark_failed(s, a, EngineError("IMPORT_FAILED", "that link went nowhere"))
        s.refresh(a)
        assert a.status == "failed"
        assert "went nowhere" in (a.error or "")
        ev = next((event for event in s.exec(select(WebhookEvent).where(WebhookEvent.event == "asset.failed")).all()
                   if event.data.get("asset_id") == "ast_fail"), None)
        assert ev is not None and ev.data["asset_id"] == "ast_fail"


def test_the_delivered_body_names_the_event_as_type(monkeypatch):
    """The app reads the event off `type`; sending only `event` drops every one silently."""
    import json

    import httpx

    from app import webhooks
    from app.config import settings

    sent: list[dict] = []

    class FakeClient:
        def post(self, url, content=None, headers=None):
            sent.append({"body": json.loads(content), "headers": headers})
            return httpx.Response(200, request=httpx.Request("POST", url))

    cfg = settings()
    monkeypatch.setattr(cfg, "webhook_url", "https://app.example/api/public/hooks/engine", raising=False)
    monkeypatch.setattr(cfg, "webhook_secret", "shhh", raising=False)

    webhooks.emit("autoclip.completed", {"autoclip_id": "job_1", "clips": []})
    webhooks.deliver_due(client=FakeClient())  # type: ignore[arg-type]

    assert sent, "nothing was delivered"
    body = sent[-1]["body"]
    assert body["type"] == "autoclip.completed"
    assert body["event"] == body["type"], "the alias stays, but `type` is what counts"
    assert body["id"].startswith("evt_")
    assert sent[-1]["headers"]["x-crayz-signature"].startswith("t=")
