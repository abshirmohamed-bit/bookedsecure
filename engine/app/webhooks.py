"""Signed webhook outbox.

Base44 verifies `x-crayz-signature: t=<unix>,v1=<hex>` as an HMAC-SHA256 over
"<t>.<raw body>", so the signature is computed over the exact bytes we send.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
from sqlmodel import select

from .config import settings
from .db import session
from .ids import new_id
from .models import WebhookEvent, utcnow

BACKOFF_SECONDS = [30, 60, 120, 240, 480]


def sign(body: bytes, secret: str, t: int) -> str:
    mac = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256)
    return mac.hexdigest()


def emit(event: str, data: dict) -> str:
    """Queue an event. Delivery happens in the background so callers never block."""
    ev = WebhookEvent(id=new_id("evt"), event=event, data=data)
    with session() as s:
        s.add(ev)
        s.commit()
    return ev.id


def deliver_due(now: datetime | None = None, client: httpx.Client | None = None) -> int:
    """Send every event that is due. Returns how many were delivered."""
    s_cfg = settings()
    if not s_cfg.webhook_url:
        return 0
    now = now or utcnow()
    sent = 0
    owned = client is None
    client = client or httpx.Client(timeout=10)
    try:
        with session() as s:
            due = s.exec(
                select(WebhookEvent)
                .where(WebhookEvent.delivered_at == None)  # noqa: E711
                .where(WebhookEvent.attempts < len(BACKOFF_SECONDS))
            ).all()
            for ev in due:
                if ev.next_attempt_at and _aware(ev.next_attempt_at) > now:
                    continue
                body = json.dumps(
                    {
                        "id": ev.id,
                        # "type" is what the app reads; "event" stays as an alias.
                        "type": ev.event,
                        "event": ev.event,
                        "created_at": _aware(ev.created_at).isoformat(),
                        "data": ev.data,
                    },
                    separators=(",", ":"),
                ).encode()
                t = int(now.timestamp())
                headers = {
                    "content-type": "application/json",
                    "x-crayz-signature": f"t={t},v1={sign(body, s_cfg.webhook_secret, t)}",
                }
                try:
                    r = client.post(s_cfg.webhook_url, content=body, headers=headers)
                    ok = 200 <= r.status_code < 300
                    ev.last_status = str(r.status_code)
                except Exception as e:  # network error, try again later
                    ok = False
                    ev.last_status = type(e).__name__
                ev.attempts += 1
                if ok:
                    ev.delivered_at = now
                    sent += 1
                else:
                    wait = BACKOFF_SECONDS[min(ev.attempts, len(BACKOFF_SECONDS)) - 1]
                    ev.next_attempt_at = now + timedelta(seconds=wait)
                s.add(ev)
            s.commit()
    finally:
        if owned:
            client.close()
    return sent


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
