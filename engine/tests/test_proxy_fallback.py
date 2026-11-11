"""The proxy is metered by the gigabyte, so it is the last resort.

Every one of these is really a question about the bill: which attempts spend
residential bandwidth, and which do not.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.errors import EngineError
from app.pipeline import ingest, ytdlp_opts

PROXY = "http://user:pw@residential.test:8000"


@pytest.fixture
def with_proxy(monkeypatch):
    monkeypatch.setenv("YTDLP_PROXY", PROXY)
    monkeypatch.delenv("YTDLP_PROXY_ALWAYS", raising=False)


def test_without_a_proxy_nothing_changes(monkeypatch):
    monkeypatch.delenv("YTDLP_PROXY", raising=False)
    assert ytdlp_opts.attempts() == [(c, False) for c in ytdlp_opts.PLAYER_CLIENTS]


def test_direct_is_tried_on_every_client_before_the_proxy(with_proxy):
    got = ytdlp_opts.attempts()
    half = len(ytdlp_opts.PLAYER_CLIENTS)
    assert [p for _, p in got[:half]] == [False] * half, "free traffic first"
    assert [p for _, p in got[half:]] == [True] * half, "metered traffic last"
    assert [c for c, _ in got[:half]] == list(ytdlp_opts.PLAYER_CLIENTS)


def test_it_can_be_told_to_go_straight_to_the_proxy(with_proxy, monkeypatch):
    monkeypatch.setenv("YTDLP_PROXY_ALWAYS", "1")
    assert all(p for _, p in ytdlp_opts.attempts())


def test_the_proxy_is_only_in_the_attempts_that_asked_for_it(with_proxy):
    direct = ytdlp_opts.cli_args("tv", use_proxy=False)
    assert "--proxy" not in direct and PROXY not in direct

    metered = ytdlp_opts.cli_args("tv", use_proxy=True)
    assert metered[metered.index("--proxy") + 1] == PROXY

    assert "proxy" not in ytdlp_opts.api_opts("tv", use_proxy=False)
    assert ytdlp_opts.api_opts("tv", use_proxy=True)["proxy"] == PROXY


def _fake_runner(results, seen):
    """Stand in for yt-dlp, recording whether each call used the proxy."""
    def run(cmd, **kw):
        seen.append("--proxy" in cmd)
        out = results[min(len(seen) - 1, len(results) - 1)]
        if out is None:  # success: leave the file behind
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"video")
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return subprocess.CompletedProcess(cmd, 1, "", out)
    return run


def test_a_video_that_downloads_never_touches_the_proxy(with_proxy, monkeypatch, tmp_path):
    seen: list[bool] = []
    monkeypatch.setattr(ingest.shutil, "which", lambda _: "/usr/bin/yt-dlp")
    monkeypatch.setattr(subprocess, "run", _fake_runner([None], seen))
    ingest._ytdlp("https://youtu.be/ok", tmp_path / "v.mp4")
    assert seen == [False], "the usual case must cost nothing"


def test_a_dead_link_never_spends_metered_bandwidth(with_proxy, monkeypatch, tmp_path):
    # "Video unavailable" is not a refusal. Paying a residential provider to
    # be told the same thing again is money for nothing.
    seen: list[bool] = []
    monkeypatch.setattr(ingest.shutil, "which", lambda _: "/usr/bin/yt-dlp")
    monkeypatch.setattr(subprocess, "run", _fake_runner(["ERROR: Video unavailable"], seen))
    with pytest.raises(EngineError):
        ingest._ytdlp("https://youtu.be/gone", tmp_path / "v.mp4")
    assert seen == [False], "one attempt, no proxy"


def test_a_refusal_falls_back_to_the_proxy_and_succeeds(with_proxy, monkeypatch, tmp_path):
    seen: list[bool] = []
    blocked = "ERROR: Sign in to confirm you're not a bot"
    # Refused on all four clients, then served through the proxy.
    results = [blocked] * len(ytdlp_opts.PLAYER_CLIENTS) + [None]
    monkeypatch.setattr(ingest.shutil, "which", lambda _: "/usr/bin/yt-dlp")
    monkeypatch.setattr(subprocess, "run", _fake_runner(results, seen))
    ingest._ytdlp("https://youtu.be/blocked", tmp_path / "v.mp4")
    assert seen == [False] * len(ytdlp_opts.PLAYER_CLIENTS) + [True]
    assert (tmp_path / "v.mp4").exists()


def test_with_no_proxy_configured_a_refusal_still_reports_plainly(monkeypatch, tmp_path):
    monkeypatch.delenv("YTDLP_PROXY", raising=False)
    seen: list[bool] = []
    monkeypatch.setattr(ingest.shutil, "which", lambda _: "/usr/bin/yt-dlp")
    monkeypatch.setattr(subprocess, "run",
                        _fake_runner(["ERROR: Sign in to confirm you're not a bot"], seen))
    with pytest.raises(EngineError) as e:
        ingest._ytdlp("https://youtu.be/blocked", tmp_path / "v.mp4")
    assert "not a bot" in str(e.value)
    assert not any(seen)
