from app.pipeline.ingest import link_format, max_link_height


def test_caps_at_1080_by_default(monkeypatch):
    monkeypatch.delenv("YTDLP_MAX_HEIGHT", raising=False)
    assert max_link_height() == 1080
    assert link_format().startswith("bv*[height<=1080][vcodec^=avc1][protocol^=http]+ba[ext=m4a]")


def test_env_sets_the_cap_within_bounds(monkeypatch):
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "720")
    assert max_link_height() == 720
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "99999")
    assert max_link_height() == 2160
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "junk")
    assert max_link_height() == 1080


def test_uncapped_choice_is_only_the_last_resort():
    choices = link_format(1080).split("/")
    assert choices[-2:] == ["bv*+ba", "b"]
    assert all("height<=1080" in c for c in choices[:-2])
    assert all("protocol^=http" in c for c in choices[:3])


def test_a_refused_stream_counts_as_blocked():
    from app.pipeline.ytdlp_opts import looks_blocked
    assert looks_blocked("ERROR: The downloaded file is empty")
    assert looks_blocked("ERROR: unable to download video data: HTTP Error 403: Forbidden")
    assert looks_blocked("HTTP Error 429: Too Many Requests")
    assert not looks_blocked("ERROR: [youtube] abc: Private video")
    assert not looks_blocked("ERROR: [youtube] abc: This video is unavailable")


def test_a_client_without_the_format_is_worth_another_route():
    from app.pipeline.ingest import _route_lacks_format
    assert _route_lacks_format("ERROR: [youtube] abc: Requested format is not available. Use --list-formats")
    assert not _route_lacks_format("ERROR: [youtube] abc: Private video")


def test_a_stalled_download_is_stopped_not_retried(monkeypatch, tmp_path):
    import subprocess
    import pytest
    from app.errors import EngineError
    from app.pipeline import ingest

    calls = []

    def stalls(cmd, timeout, on_progress, dest=None, idle=None):
        calls.append(cmd)
        assert idle == ingest.SECTION_IDLE_S      # sections are judged by bytes arriving, not total time
        raise subprocess.TimeoutExpired(cmd, timeout)

    monkeypatch.setattr(ingest.shutil, "which", lambda name: "/usr/bin/yt-dlp")
    monkeypatch.setattr(ingest, "_run_with_progress", stalls)
    with pytest.raises(EngineError, match="stalled"):
        ingest.fetch_section("https://www.youtube.com/watch?v=x", tmp_path / "s.mp4", 0, 10_000)
    assert len(calls) == 1


def test_the_watchdog_stops_silence_but_not_a_slow_download(tmp_path):
    import subprocess
    import sys
    import pytest
    from app.pipeline import ingest

    dest = tmp_path / "v.mp4"
    # Writes a little every 0.5 s for 5 s: slow but alive, so it must finish.
    slow = subprocess.Popen([sys.executable, "-c",
        "import time,sys\nfor i in range(10):\n open(sys.argv[1]+'.part','ab').write(b'x'*10)\n time.sleep(0.5)",
        str(dest)])
    ingest._watch(slow, dest, timeout=60, idle=3)
    assert slow.returncode == 0
    # Writes nothing: stopped once nothing has arrived for the idle time.
    silent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    with pytest.raises(subprocess.TimeoutExpired):
        ingest._watch(silent, tmp_path / "w.mp4", timeout=60, idle=3)
