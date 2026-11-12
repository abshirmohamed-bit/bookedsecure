"""Passing download failures are retried instead of failing the video."""
from __future__ import annotations

from app.errors import EngineError, TransientFetch
from app.pipeline import ytdlp_opts


def test_youtube_reload_and_dropped_connections_are_passing_failures():
    assert ytdlp_opts.looks_transient("ERROR: [youtube] r0-IoohQdmE: The page needs to be reloaded.")
    assert ytdlp_opts.looks_transient("[SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol")
    assert not ytdlp_opts.looks_transient("ERROR: Video unavailable. This video is private")


def test_a_transient_fetch_is_still_an_engine_error_but_marked_retryable():
    e = TransientFetch("Could not fetch that link")
    assert isinstance(e, EngineError) and e.transient
    assert not EngineError("VALIDATION_ERROR", "x").transient


def test_run_ytdlp_raises_a_transient_fetch_after_every_route_hiccups(tmp_path, monkeypatch):
    import subprocess

    from app.pipeline import ingest

    calls = []

    class P:
        returncode = 1
        stdout = ""
        stderr = "ERROR: [youtube] abc: The page needs to be reloaded."

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return P()

    monkeypatch.setattr(ingest.shutil, "which", lambda _: "yt-dlp")
    monkeypatch.setattr(subprocess, "run", fake_run)
    ingest._ROUTES.clear()
    try:
        ingest.run_ytdlp("https://www.youtube.com/watch?v=abc", tmp_path / "x.mp4", [])
    except TransientFetch:
        pass
    else:
        raise AssertionError("expected a TransientFetch")
    assert len(calls) > 1, "a hiccup is worth the next route"
