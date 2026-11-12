"""The numbers BookedSecure uses to say when to move to an ISP proxy plan."""
from datetime import datetime, timedelta, timezone

from app.pipeline import proxy_health


def test_the_mode_comes_from_the_port():
    assert proxy_health.mode_of("http://u:p@gw.dataimpulse.com:10000") == "sticky"
    assert proxy_health.mode_of("http://u:p@gw.dataimpulse.com:19999") == "sticky"
    assert proxy_health.mode_of("http://u:p@gw.dataimpulse.com:823") == "rotating"
    assert proxy_health.mode_of("http://u:p@isp.example.com:8000") == "other"
    assert proxy_health.mode_of("") == "none"


def test_a_bot_check_is_told_apart_from_other_failures():
    assert proxy_health.outcome_of(0, "") == "ok"
    assert proxy_health.outcome_of(1, "ERROR: Sign in to confirm you're not a bot") == "blocked"
    assert proxy_health.outcome_of(1, "ERROR: unable to download video data: HTTP Error 403: Forbidden") == "blocked"
    assert proxy_health.outcome_of(1, "ERROR: Private video") == "failed"
    assert proxy_health.outcome_of(None, "", stalled=True) == "stalled"


def test_the_week_is_summed_from_downloads_and_failures(api):
    from app.db import session
    from app.ids import new_id
    from app.models import Asset, Job, ProxyDownload

    now = datetime.now(timezone.utc)
    with session() as s:
        for _ in range(2):
            s.add(ProxyDownload(kind="whole", via_proxy=True, mode="rotating", outcome="ok", bytes=20_000_000, seconds=100))
        s.add(ProxyDownload(kind="audio", via_proxy=True, mode="rotating", outcome="ok", bytes=1_000_000, seconds=1))  # too small to time
        s.add(ProxyDownload(kind="section", via_proxy=True, mode="rotating", outcome="blocked"))
        s.add(ProxyDownload(kind="whole", via_proxy=True, mode="sticky", outcome="ok", bytes=50_000_000, seconds=10,
                            created_at=now - timedelta(days=9)))           # outside the week
        s.add(Asset(id=new_id("ast"), status="failed", error="YouTube would not serve this video to the Engine"))
        s.add(Asset(id=new_id("ast"), status="failed", error="That video is private."))
        s.add(Asset(id=new_id("ast"), status="ready", lean=True))
        s.add(Asset(id=new_id("ast"), status="ready", lean=True, parent_id="x"))                   # a section, not a link
        s.add(Job(id=new_id("job"), asset_id="a", status="failed", error="ERROR: Sign in to confirm you're not a bot"))
        s.commit()
    got = proxy_health.summary(days=7)
    assert got["bot_check_failures"] >= 2
    assert got["proxy_speed_mb_s"] == 0.2          # 40 MB in 200 s; the tiny audio and the old one are left out
    assert got["speed_samples"] == 2
    assert got["long_links_clipped"] >= 1
    assert got["proxy_refusals"] >= 1


def test_the_summary_route_needs_the_key(api):
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/v1/proxy/health").status_code == 401
    body = api.get("/v1/proxy/health").json()
    assert {"bot_check_failures", "proxy_speed_mb_s", "long_links_clipped", "proxy_mode"} <= set(body)


def test_a_dragged_caption_position_places_the_line():
    from app.pipeline.caption import BY_ID, build_ass, free_y

    words = [{"text": "hello", "start_ms": 0, "end_ms": 500}, {"text": "there", "start_ms": 500, "end_ms": 900}]
    style = BY_ID["bold_white"]
    def margin(ass):
        line = next(l for l in ass.splitlines() if l.startswith("Style:"))
        return int(line.split(",")[-2])
    top = margin(build_ass(words, style, 1080, 1920, y=0.2))
    low = margin(build_ass(words, style, 1080, 1920, y=0.8))
    preset = margin(build_ass(words, style, 1080, 1920, position="lower"))
    assert top > low                     # higher on screen = further from the bottom edge
    assert abs(low - 1920 * 0.2) < 200   # around a fifth up from the bottom
    assert preset != top
    assert free_y("nope") is None and free_y(2) == 0.95 and free_y(-1) == 0.05
