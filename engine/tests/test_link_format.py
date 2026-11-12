from app.pipeline.ingest import link_format, max_link_height


def test_caps_at_1080_by_default(monkeypatch):
    monkeypatch.delenv("YTDLP_MAX_HEIGHT", raising=False)
    assert max_link_height() == 1080
    assert link_format().startswith("bestvideo[height<=1080]+bestaudio")


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
