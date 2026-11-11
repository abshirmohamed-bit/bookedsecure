"""The machine may only stop itself when stopping costs nothing."""
from __future__ import annotations

import time

import pytest
from sqlmodel import delete, select

from app import idle
from app.db import session
from app.ids import new_id
from app.models import Asset, Export, ImportTask, Job, Project, WebhookEvent


@pytest.fixture(autouse=True)
def clean(api):
    """Start each case from a quiet, empty Engine."""
    _reset()
    idle._asked_to_stop = False
    idle.touch()
    yield
    _reset()
    idle._asked_to_stop = False


def _reset() -> None:
    with session() as s:
        for model in (Job, Export, ImportTask, WebhookEvent):
            s.exec(delete(model))
        for asset in s.exec(select(Asset)).all():
            asset.status = "ready"
            s.add(asset)
        s.commit()


def _quiet(seconds: float) -> None:
    """Pretend the last request was this long ago."""
    idle._last_seen = time.monotonic() - seconds


def test_health_checks_do_not_count_as_use():
    # Fly pings /v1/health every 30s. If that counted, nothing would ever sleep.
    assert not idle.counts("/v1/health")
    assert idle.counts("/v1/jobs/job_1")
    assert idle.counts("/media/clip.mp4")


def test_a_recent_request_keeps_it_awake():
    _quiet(5)
    assert idle.should_sleep(600) is False


def test_quiet_and_empty_may_sleep():
    _quiet(700)
    assert idle.should_sleep(600) is True


def test_zero_means_run_around_the_clock():
    _quiet(10_000)
    assert idle.should_sleep(0) is False


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_a_job_in_flight_blocks_sleep(status):
    with session() as s:
        s.add(Job(id=new_id("job"), asset_id="ast_x", status=status))
        s.commit()
    _quiet(700)
    assert idle.work_in_flight() is True
    assert idle.should_sleep(600) is False


def test_a_job_awaiting_a_person_does_not_block_sleep():
    # Someone may not come back for days; waiting awake costs money for nothing.
    with session() as s:
        s.add(Job(id=new_id("job"), asset_id="ast_x", status="awaiting_confirmation"))
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is True


def test_a_render_in_flight_blocks_sleep():
    with session() as s:
        s.add(Export(id=new_id("exp"), project_id="prj_x", status="processing"))
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is False


def test_an_import_in_flight_blocks_sleep():
    with session() as s:
        s.add(ImportTask(asset_id="ast_y", status="queued"))
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is False


def test_an_importing_asset_blocks_sleep(uploaded_asset):
    with session() as s:
        asset = s.get(Asset, uploaded_asset)
        asset.status = "importing"
        s.add(asset)
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is False


def test_an_undelivered_webhook_blocks_sleep(monkeypatch):
    # A finished clip the app was never told about is a clip nobody sees.
    monkeypatch.setenv("WEBHOOK_URL", "https://app.test/hooks/engine")
    from app.config import settings

    settings.cache_clear()
    try:
        with session() as s:
            s.add(WebhookEvent(id=new_id("evt"), event="job.completed", data={}))
            s.commit()
        _quiet(700)
        assert idle.should_sleep(600) is False
    finally:
        settings.cache_clear()


def test_an_undelivered_webhook_with_nowhere_to_send_it_does_not_block():
    """deliver_due() ignores the outbox when webhook_url is unset.

    Without this guard the first event ever queued would keep the machine
    awake for the rest of its life — the exact bill this module prevents.
    """
    with session() as s:
        s.add(WebhookEvent(id=new_id("evt"), event="job.completed", data={}))
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is True


def test_a_webhook_out_of_retries_stops_blocking():
    from app.webhooks import BACKOFF_SECONDS

    with session() as s:
        s.add(WebhookEvent(id=new_id("evt"), event="job.completed", data={},
                           attempts=len(BACKOFF_SECONDS)))
        s.commit()
    _quiet(700)
    assert idle.should_sleep(600) is True


def test_sleeping_signals_the_server_once(monkeypatch):
    sent: list[tuple[int, int]] = []
    monkeypatch.setattr(idle.os, "kill", lambda pid, sig: sent.append((pid, sig)))
    monkeypatch.setenv("IDLE_SHUTDOWN_S", "600")
    from app.config import settings

    settings.cache_clear()
    try:
        _quiet(700)
        assert idle.sleep_if_idle() is True
        assert len(sent) == 1
        assert sent[0][1] == idle.signal.SIGTERM
        # Asking twice must not signal twice: uvicorn is already draining.
        _quiet(700)
        assert idle.sleep_if_idle() is False
        assert len(sent) == 1
    finally:
        settings.cache_clear()


def test_off_by_default_so_development_is_unaffected():
    from app.config import Settings

    assert Settings().idle_shutdown_s == 0


def test_a_real_request_resets_the_clock_but_a_health_check_does_not(api):
    """The wiring, not just the rule: this is what goes wrong in production."""
    _quiet(700)
    api.get("/v1/health")
    assert idle.quiet_for() > 600, "health checks must not keep the machine awake"

    api.get("/v1/assets")
    assert idle.quiet_for() < 5, "a real request must count as use"
