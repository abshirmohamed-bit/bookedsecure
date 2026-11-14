"""The style review: each clip's look is matched to what the clip shows.

Synthetic faces, turns, detail and words, as in test_shots, so every rule is
checked without a video.
"""
from __future__ import annotations

from dataclasses import replace

from app.pipeline import checks
from app.pipeline import shots as P
from app.pipeline import style
from app.pipeline.speaker import DETAIL_BINS, FaceTrack, Turn

from test_shots import flat_detail, inputs, person


def words(start=0, end=10000, every=400, length=300):
    return [{"text": "w", "start_ms": ms, "end_ms": ms + length} for ms in range(start, end, every)]


def back_and_forth(end=10000, step=1250):
    return [Turn(a, a + step, 1 if (a // step) % 2 == 0 else 2, 0.9) for a in range(0, end, step)]


def test_two_people_apart_talking_back_and_forth_get_a_split_screen():
    inp = inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=back_and_forth(), words=words())
    r = style.review(inp)
    assert r["vibe"] == "conversation"
    assert r["layout"] == "split" and r["picked_by"] == "engine"
    assert r["fit"] >= 0.9
    assert "own half" in r["why"]


def test_one_person_to_camera_follows_the_speaker():
    inp = inputs(tracks=[person(1, 0.5)], turns=[Turn(0, 10000, 1, 0.9)], words=words())
    r = style.review(inp)
    assert r["vibe"] == "talking_head" and r["layout"] == "full-video"


def test_a_screen_recording_with_a_corner_camera_is_screen_plus_speaker():
    inp = inputs(tracks=[person(1, 0.9, y=0.85, w=0.06, h=0.08)], detail=flat_detail(), words=words())
    r = style.review(inp)
    assert r["vibe"] == "screen_speaker" and r["layout"] == "screen"


def test_a_group_where_everyone_talks_is_a_grid():
    tracks = [person(1, 0.15), person(2, 0.5), person(3, 0.85)]
    turns = [Turn(a, a + 1000, 1 + (a // 1000) % 3, 0.9) for a in range(0, 10000, 1000)]
    r = style.review(inputs(tracks=tracks, turns=turns, words=words()))
    assert r["vibe"] == "group" and r["layout"] == "grid"


def test_narrated_footage_with_nobody_in_it_is_headline_and_captions():
    busy = [(ms, [0.1] * DETAIL_BINS, 0.2) for ms in range(0, 10000, 500)]
    r = style.review(inputs(detail=busy, words=words()))
    assert r["vibe"] == "narrated" and r["layout"] == "title-subtitles"
    # ...but without a headline to show, the whole picture over a blur.
    r = style.review(inputs(detail=busy, words=words()), has_title=False)
    assert r["layout"] == "streamer"


def test_wide_scenes_without_talk_are_shown_whole():
    busy = [(ms, [0.1] * DETAIL_BINS, 0.2) for ms in range(0, 10000, 500)]
    r = style.review(inputs(detail=busy, words=[]))
    assert r["vibe"] == "wide" and r["layout"] == "streamer"


def test_the_owners_layout_is_kept_and_a_poor_fit_is_explained():
    inp = inputs(tracks=[person(1, 0.5)], turns=[Turn(0, 10000, 1, 0.9)], words=words())
    r = style.review(inp, requested="split", request_source="request")
    assert r["layout"] == "split" and r["picked_by"] == "owner"
    assert r["fit"] == 0
    assert r["note"].startswith("You asked for Split screen, which needs two people")
    assert "Follow the speaker suits it better" in r["note"]
    assert r["suggested"] == "full-video"


def test_a_good_fit_for_the_owners_layout_has_no_note():
    inp = inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=back_and_forth(), words=words())
    r = style.review(inp, requested="split", request_source="options")
    assert r["layout"] == "split" and r["note"] is None


def test_a_layout_that_would_barely_apply_falls_back_to_shot_by_shot():
    # Two people apart for only the first 2 s of 10, then one person.
    tracks = [person(1, 0.2, end=2000), person(2, 0.8, end=2000), person(3, 0.5, start=2000)]
    turns = [Turn(0, 1000, 1, 0.9), Turn(1000, 2000, 2, 0.9), Turn(2000, 10000, 3, 0.9)]
    inp = inputs(tracks=tracks, turns=turns, cuts=[2000], words=words())
    r = style.review(inp)
    assert r["layout"] != "split"


def test_the_request_words_name_a_layout():
    assert style.requested_from("Podcast clips, split screen please") == "split"
    assert style.requested_from("keep the whole picture, no cropping") == "streamer"
    assert style.requested_from("it's a gameplay stream") == "screen"
    assert style.requested_from("picture-in-picture with my reaction") == "pip"
    assert style.requested_from("headline and captions, like a podcast poster") == "title-subtitles"
    assert style.requested_from("find the funniest bits") is None
    assert style.requested_for_job({"formats": ["grid"], "prompt": "split screen"}) == ("grid", "options")
    assert style.requested_for_job({"formats": ["auto"], "prompt": "split screen"}) == ("split", "request")
    assert style.requested_for_job({"formats": ["auto"], "prompt": ""}) == (None, None)


def test_the_summary_counts_looks_and_keeps_notes():
    s = style.summary([{"name": "Split screen", "note": None, "index": 1},
                       {"name": "Split screen", "note": None, "index": 2},
                       {"name": "Follow the speaker", "note": "You asked for…", "index": 3}])
    assert s == {"layouts": {"Split screen": 2, "Follow the speaker": 1}, "notes": [{"index": 3, "note": "You asked for…"}]}


# --- checks --------------------------------------------------------------

def body(tid, x, y=0.55, w=0.16, h=0.8, start=0, end=10000, step=500):
    return FaceTrack(id=tid, boxes=[(ms, (x, y, w, h)) for ms in range(start, end, step)])


def test_a_crop_on_the_body_keeps_the_subject_in_frame():
    inp = inputs(tracks=[person(1, 0.5, y=0.25, w=0.05, h=0.1)], bodies=[body(1, 0.5)])
    plan = P.plan(inp)
    assert checks.subject_in_frame(plan, inp) == 1.0


def test_a_crop_away_from_the_body_scores_it_out_of_frame():
    inp = inputs(bodies=[body(1, 0.15)])
    plan = [P.Shot(0, 10000, "fill", window=P.Box(1300, 0, 608, 1080))]
    assert checks.subject_in_frame(plan, inp) == 0.0
    assert checks.subject_in_frame(plan, inputs()) is None


def label(x, y, w, h, start=0, end=10000):
    return [(ms, [(x, y, w, h)]) for ms in range(start, end, 250)]


def test_a_label_cut_by_the_crop_edge_is_sliced_text():
    inp = inputs(texts=label(0.25, 0.8, 0.2, 0.05))     # 480..864 px across
    sliced = [P.Shot(0, 10000, "fill", window=P.Box(700, 0, 608, 1080))]
    whole = [P.Shot(0, 10000, "fill", window=P.Box(300, 0, 608, 1080))]
    out = [P.Shot(0, 10000, "fill", window=P.Box(1100, 0, 608, 1080))]
    assert checks.text_sliced(sliced, inp) == 1.0
    assert checks.text_sliced(whole, inp) == 0.0
    assert checks.text_sliced(out, inp) == 0.0
    assert checks.text_sliced([P.Shot(0, 10000, "fit")], inp) == 0.0


def test_the_plan_itself_never_slices_a_label_beside_the_speaker():
    inp = inputs(tracks=[person(1, 0.5)], texts=label(0.62, 0.7, 0.12, 0.05))
    plan = P.plan(inp)
    assert checks.text_sliced(plan, inp) == 0.0


def test_the_review_reports_its_checks():
    inp = inputs(tracks=[person(1, 0.5, y=0.25, w=0.05, h=0.1)], bodies=[body(1, 0.5)], words=words())
    r = style.review(inp)
    assert r["checks"]["subject_in_frame"] == 1.0
    assert r["checks"]["text_sliced"] is None
