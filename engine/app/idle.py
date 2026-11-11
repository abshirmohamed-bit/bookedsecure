"""Sleep when there is nothing to do.

Fly bills a machine for the seconds it runs. An Engine that is used for an
hour a day should cost an hour a day, so the Engine stops itself once it has
been quiet for a while and Fly's proxy starts it again on the next request.

The Engine decides this, not Fly's proxy. The proxy only counts inbound
requests: a render takes minutes and makes no requests at all, so the proxy
would stop the machine mid-encode. What the proxy cannot see, this module
can — it refuses to sleep while any job, import or export is in flight, or
while an event still owes the app a webhook.
"""
from __future__ import annotations

import logging
import os
import signal
import time

log = logging.getLogger("engine.idle")

# Fly's own health check hits /v1/health every 30 seconds. Counting that as
# activity would keep the machine awake forever, which is the whole bug this
# module exists to avoid.
IGNORED_PATHS = {"/v1/health", "/docs", "/openapi.json", "/redoc"}

# Boot counts as activity: a machine woken by a request should not shut down
# again before anyone has had a chance to use it.
_last_seen = time.monotonic()
_asked_to_stop = False
_server = None  # set by app/__main__.py; see stop_now()


def use_server(server) -> None:
    """Remember the server so it can be asked to stop cleanly."""
    global _server
    _server = server


def touch() -> None:
    """Someone used the Engine. Called for every request worth counting."""
    global _last_seen
    _last_seen = time.monotonic()


def counts(path: str) -> bool:
    return path not in IGNORED_PATHS


def quiet_for() -> float:
    """Seconds since the last request that counted."""
    return time.monotonic() - _last_seen


def work_in_flight() -> bool:
    """True while anything would be lost by stopping now.

    `awaiting_confirmation` is deliberately absent: a job parked for a person
    to look at can wait days, and waiting awake costs money for nothing.
    """
    from sqlmodel import select

    from .config import settings
    from .db import session
    from .models import Asset, Export, ImportTask, Job, WebhookEvent
    from .webhooks import BACKOFF_SECONDS

    busy = ("queued", "processing")
    with session() as s:
        for model in (Job, Export, ImportTask):
            if s.exec(select(model).where(model.status.in_(busy))).first():  # type: ignore[attr-defined]
                return True
        if s.exec(select(Asset).where(Asset.status == "importing", Asset.deleted_at == None)).first():  # noqa: E711
            return True
        # A finished clip the app was never told about is a clip the person
        # never sees. Give the outbox its retries before going quiet.
        #
        # Only when there is somewhere to send them: with no webhook_url,
        # deliver_due() returns without touching the rows, so every event ever
        # queued stays undelivered and the machine would never sleep again.
        # The same guard, in the same place, as the delivery it is waiting on.
        if settings().webhook_url and s.exec(
            select(WebhookEvent)
            .where(WebhookEvent.delivered_at == None)  # noqa: E711
            .where(WebhookEvent.attempts < len(BACKOFF_SECONDS))
        ).first():
            return True
    return False


def should_sleep(after_s: float) -> bool:
    if after_s <= 0 or _asked_to_stop:
        return False
    if quiet_for() < after_s:
        return False
    return not work_in_flight()


def sleep_if_idle() -> bool:
    """Stop the machine if it has been quiet and is empty. Safe to call often."""
    from .config import settings

    after_s = settings().idle_shutdown_s
    if not should_sleep(after_s):
        return False
    return stop_now(f"idle for {quiet_for():.0f}s with nothing in flight")


def stop_now(why: str) -> bool:
    """Shut down the way a deploy does, but with a clean exit code.

    `should_exit` is the same path uvicorn's own signal handler takes: stop
    accepting connections, let the open ones finish, run the lifespan shutdown
    so the worker drains, then exit 0. Fly reads exit 0 as "stopped on
    purpose" and leaves the machine alone until the next request.

    Signalling ourselves instead would exit 143 — uvicorn re-raises the signal
    it caught — and Fly would restart the machine, which is the one outcome
    this whole module exists to avoid. The fallback is only for a dev server
    started through the uvicorn CLI, where the exit code does not matter.
    """
    global _asked_to_stop
    if _asked_to_stop:
        return False
    _asked_to_stop = True
    log.info("sleeping: %s", why)
    if _server is not None:
        _server.should_exit = True
    else:
        log.warning("no server registered; signalling instead (exit code will be 143)")
        os.kill(os.getpid(), signal.SIGTERM)
    return True
