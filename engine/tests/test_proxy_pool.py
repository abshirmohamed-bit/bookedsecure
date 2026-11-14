"""Several proxies, healthiest first: a refused or empty one hands over by itself."""
from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.pipeline import ingest, proxy_pool, ytdlp_opts

A = "http://user:pw@isp-one.test:8000"
B = "http://user:pw@isp-two.test:8000"
NOW = datetime(2026, 11, 15, 1, 0, tzinfo=timezone.utc)


@pytest.fixture
def pool(monkeypatch, tmp_path):
    monkeypatch.setenv("YTDLP_PROXY", A)
    monkeypatch.setenv("YTDLP_PROXIES", f"{B}, {A}")
    monkeypatch.delenv("YTDLP_PROXY_ALWAYS", raising=False)
    monkeypatch.setenv("YTDLP_PROXY_ROUNDS", "1")
    monkeypatch.setattr(proxy_pool, "_path", lambda: tmp_path / "proxy_state.json")
    ingest._ROUTES.clear()


def test_every_proxy_is_listed_once_with_the_first_secret_first(pool):
    assert proxy_pool.proxies() == [A, B]
    assert proxy_pool.label(A) == "isp-one.test:8000"


def test_each_round_goes_through_every_proxy(pool):
    proxied = [p for _, p in ytdlp_opts.attempts() if p]
    n = len(ytdlp_opts.PLAYER_CLIENTS)
    assert proxied == [A] * n + [B] * n


def test_a_proxy_refused_three_times_in_a_row_is_benched_and_goes_last(pool):
    for _ in range(proxy_pool.BENCH_AFTER):
        proxy_pool.report(A, "blocked", now=NOW)
    assert proxy_pool.ordered(NOW) == [B, A]
    status = {s["label"]: s for s in proxy_pool.status(NOW)}
    assert status["isp-one.test:8000"]["state"] == "benched"
    assert "pw" not in str(status)
    # The bench passes, and a working download clears the record.
    later = NOW + timedelta(minutes=proxy_pool.BENCH_MINUTES + 1)
    assert proxy_pool.ordered(later) == [A, B]


def test_benches_grow_when_a_proxy_keeps_being_refused(pool):
    for _ in range(2 * proxy_pool.BENCH_AFTER):
        proxy_pool.report(A, "blocked", now=NOW)
    e = proxy_pool._load()[proxy_pool.key(A)]
    until = datetime.fromisoformat(e["benched_until"])
    assert until - NOW == timedelta(minutes=2 * proxy_pool.BENCH_MINUTES)


def test_the_faster_proxy_goes_first(pool):
    proxy_pool.report(A, "ok", bytes_=20_000_000, seconds=100, now=NOW)   # 0.2 MB/s
    proxy_pool.report(B, "ok", bytes_=20_000_000, seconds=10, now=NOW)    # 2 MB/s
    assert proxy_pool.ordered(NOW) == [B, A]


def test_an_empty_proxy_hands_over_to_the_next(pool, monkeypatch, tmp_path):
    seen: list[str] = []
    blocked = "ERROR: Sign in to confirm you're not a bot"
    empty = "ERROR: Tunnel connection failed: 407 TRAFFIC_EXHAUSTED"
    n = len(ytdlp_opts.PLAYER_CLIENTS)

    def run(cmd, **kw):
        via = cmd[cmd.index("--proxy") + 1] if "--proxy" in cmd else ""
        seen.append(via)
        out = blocked if not via else empty if via == A else None
        if out is None:
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"video")
        return subprocess.CompletedProcess(cmd, 0 if out is None else 1, "", out or "")

    monkeypatch.setattr(ingest.shutil, "which", lambda _: "/usr/bin/yt-dlp")
    monkeypatch.setattr(subprocess, "run", run)
    ingest._ytdlp("https://youtu.be/x", tmp_path / "v.mp4")
    assert seen == [""] * n + [A, B], "one try on the empty proxy, then the next one"
    assert proxy_pool.ordered()[0] == B
